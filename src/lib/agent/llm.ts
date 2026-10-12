// ============================================================
// LLM adapter — z-ai-web-dev-sdk singleton + Bengali system prompt
// + tolerant JSON tool-call parser (native tool-calling নেই বলে JSON প্রোটোকল)।
//
// S9-গভীর-সমাধান (২০২৬-১০-১১-এর ৪২৯-ঘটনা থেকে):
//  - chatComplete-এর পুরনো বাজেট ছিল ৪ চেষ্টা × ৩ সে. ≈ ১৬ সে. —
//    মিনিট-দীর্ঘ ৪২৯-উইন্ডোতে রান ধাপ ০-তেই মরে যেত। এখন:
//    ৮ চেষ্টা, base ৫ সে., max ১০০ সে. (সব-ব্যর্থ-ক্ষেত্রেও
//    অপেক্ষা-বাজেট ≈ ৪ মিনিট — ১০-মিনিটের stale-sweepের মধ্যে)।
//  - চ্যানেল 'chat' — coordinator-কুলডাউন সৎ-অপেক্ষা + সিরিয়ালাইজড।
//  - onRateLimitWait-কলব্যাক — orchestrator এটি দিয়ে SSE-তে
//    "রেট-লিমিট, অপেক্ষা চলছে" নোট পাঠায়।
//  - ডিস্ক-ক্যাশ (storage/llm-chat/): একই context-এর পুনঃকল
//    (৪২৯-রিট্রাই, backtest-রিপ্লে) বিনা-API-খরচে ফেরে।
// ============================================================

import ZAI from 'z-ai-web-dev-sdk';
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { withRetry, type RetryWaitInfo } from './retry';
import { findChatModel, type ChatModelOption } from './chat-models';
import { externalChatComplete } from './external-llm';

export { externalChatComplete, ExternalFatalError, ExternalRetryableError } from './external-llm';

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Singleton SDK instance (module-level promise; globalThis-এ রাখা হয় যাতে
// dev-mode HMR-এ বারবার নতুন instance না হয়)।
const g = globalThis as unknown as { __zaiSingleton?: Promise<ZAI> };

export function getZAI(): Promise<ZAI> {
  if (!g.__zaiSingleton) {
    g.__zaiSingleton = ZAI.create();
  }
  return g.__zaiSingleton;
}

// ------------------------------------------------------------
// S9: LLM-উত্তরের ডিস্ক-ক্যাশ — একই context = একই উত্তর (নির্ধারক)
// ------------------------------------------------------------

const PROJECT_ROOT = process.cwd();
const LLM_CACHE_DIR = path.join(PROJECT_ROOT, 'storage', 'llm-chat');
/** ক্যাশ-এন্ট্রির সময়সীমা */
const LLM_CACHE_TTL_MS = 12 * 60 * 60 * 1000; // ১২ ঘণ্টা

export interface LlmCacheStats {
  hits: number;
  misses: number;
}

const gStats = globalThis as unknown as { __llmCacheStats?: LlmCacheStats };
function stats(): LlmCacheStats {
  if (!gStats.__llmCacheStats) gStats.__llmCacheStats = { hits: 0, misses: 0 };
  return gStats.__llmCacheStats;
}

export function llmCacheStats(): LlmCacheStats {
  return { ...stats() };
}

function cacheKeyOf(messages: LLMMessage[], model?: string): string {
  return createHash('sha1')
    .update(JSON.stringify({ model: model ?? '', messages }))
    .digest('hex');
}

async function readLlmCache(key: string): Promise<string | null> {
  try {
    const raw = await readFile(path.join(LLM_CACHE_DIR, `${key}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { text?: string; createdAt?: string };
    if (typeof parsed?.text !== 'string' || parsed.text.length === 0) return null;
    const age = parsed.createdAt ? Date.now() - Date.parse(parsed.createdAt) : Infinity;
    if (!Number.isFinite(age) || age > LLM_CACHE_TTL_MS) return null;
    return parsed.text;
  } catch {
    return null;
  }
}

async function writeLlmCache(key: string, text: string): Promise<void> {
  try {
    await mkdir(LLM_CACHE_DIR, { recursive: true });
    await writeFile(
      path.join(LLM_CACHE_DIR, `${key}.json`),
      JSON.stringify({ text, createdAt: new Date().toISOString() }),
      'utf8'
    );
  } catch {
    // নীরব — ক্যাশ-ব্যর্থতা মূল ফলাফলকে স্পর্শ করবে না
  }
}

export interface ChatCompleteOptions {
  /** রেট-লিমিট-অপেক্ষার নোট (UI-স্ট্যাটাসের জন্য) — Z.ai SDK-পথের জন্য */
  onRateLimitWait?: (info: RetryWaitInfo) => void;
  /** ডিস্ক-ক্যাশ বাদ দিয়ে সরাসরি API (default: false = ক্যাশ চালু) */
  skipCache?: boolean;
  /**
   * নির্বাচিত চ্যাট-মডেল ('' / undefined = SDK ডিফল্ট)।
   * ক্যাটালগের provider অনুযায়ী রাউট হয়:
   *   - 'zai' → z-ai-web-dev-sdk (বিল্ট-ইন, শেয়ার্ড রেট-লিমিট)
   *   - এক্সটার্নাল → সেই প্রোভাইডারের প্রকৃত API (নিজের কী)
   */
  model?: string;
}

// ------------------------------------------------------------
// এক্সটার্নাল প্রোভাইডার-পথ (DeepSeek / Z.ai API / BigModel / Groq /
// OpenRouter) — বাস্তবায়ন এখন external-llm.ts-এ: প্রকৃত OpenAI SDK
// (npm `openai`) + প্রোভাইডারের আসল endpoint। DeepSeek-এর অফিসিয়াল
// ডকস (api-docs.deepseek.com) অনুযায়ী এটিই "রিয়েল DeepSeek SDK"-পথ
// (npm install openai + DeepSeek baseURL)।
// ------------------------------------------------------------

/**
 * Non-streaming chat completion (thinking disabled)।
 * রাউটিং: ক্যাটালগের provider অনুযায়ী —
 *   'zai' → SDK-পথ (S9: ৬ চেষ্টা + চ্যানেল-কুলডাউন-সৎ-অপেক্ষা + full-jitter)
 *   এক্সটার্নাল → প্রোভাইডারের প্রকৃত API (২ চেষ্টা, সৎ HTTP-ম্যাপিং)
 * একই context ডিস্ক-ক্যাশ থেকে ফেরে (উভয় পথেই)।
 */
export async function chatComplete(
  messages: LLMMessage[],
  opts?: ChatCompleteOptions
): Promise<string> {
  const key = cacheKeyOf(messages, opts?.model);
  if (!opts?.skipCache) {
    const cached = await readLlmCache(key);
    if (cached != null) {
      stats().hits++;
      return cached;
    }
  }
  stats().misses++;

  // ---- এক্সটার্নাল-প্রোভাইডার রাউটিং ----
  const requestedId = opts?.model && opts.model.trim() !== '' ? opts.model.trim() : '';
  const entry = requestedId !== '' ? findChatModel(requestedId) : undefined;
  if (entry && entry.provider !== 'zai') {
    const text = await externalChatComplete(messages, entry);
    if (text && text.length > 0) {
      await writeLlmCache(key, text);
    }
    return text;
  }

  // ---- Z.ai SDK-পথ (আগের মতোই) ----
  const zai = await getZAI();
  const model = requestedId !== '' ? requestedId : undefined;
  const text = await withRetry(
    async () => {
      const res = await zai.chat.completions.create({
        messages,
        ...(model ? { model } : {}),
        thinking: { type: 'disabled' },
      });
      const content = res?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    },
    'LLM (চ্যাট)',
    6, // S9: ৬ চেষ্টা — মোট অপেক্ষা-বাজেট ≈৪–৫ মিনিট (১০-মিনিটের stale-sweepের মধ্যে)
    4000, // base ৪ সে.
    {
      maxDelayMs: 60_000, // একক সর্বোচ্চ অপেক্ষা ৬০ সে.
      channel: 'chat',
      cooldownBudgetMs: 90_000, // প্রতি চেষ্টায় কুলডাউন-অপেক্ষার সীমা ৯০ সে.
      ...(opts?.onRateLimitWait ? { onWait: opts.onRateLimitWait } : {}),
    }
  );
  if (text && text.length > 0) {
    await writeLlmCache(key, text);
  }
  return text;
}

// ------------------------------------------------------------
// System prompt এখন prompts.ts-এ (রেজিস্ট্রি-চালিত, স্টুডিও টুলসহ)
// ------------------------------------------------------------

// ------------------------------------------------------------
// Tolerant JSON tool-call parser
// ------------------------------------------------------------
export interface ToolCallRequest {
  tool: string;
  arguments: Record<string, unknown>;
}

function extractToolCall(obj: unknown): ToolCallRequest | null {
  if (!obj || typeof obj !== 'object') return null;
  let target = obj as Record<string, unknown>;
  // অ্যারে হলে প্রথম অবজেক্ট এলিমেন্ট নাও
  if (Array.isArray(target)) {
    const first = target.find(it => it && typeof it === 'object' && !Array.isArray(it));
    if (!first) return null;
    target = first as Record<string, unknown>;
  }
  // {"tool_call": {"tool": ..., "arguments": ...}} আকারও গ্রহণ করো
  if (
    typeof target.tool !== 'string' &&
    target.tool_call &&
    typeof target.tool_call === 'object' &&
    !Array.isArray(target.tool_call)
  ) {
    target = target.tool_call as Record<string, unknown>;
  }
  const tool = target.tool;
  if (typeof tool !== 'string' || tool.trim() === '') return null;
  let args = target.arguments;
  if (args === undefined) args = {};
  if (typeof args !== 'object' || args === null || Array.isArray(args)) return null;
  return { tool: tool.trim(), arguments: args as Record<string, unknown> };
}

/**
 * টেক্সট থেকে টুল কল বের করে। কৌশল (tolerant):
 *  ১) পুরো trimmed টেক্সটকে JSON হিসেবে
 *  ২) ```json ...``` fenced ব্লক
 *  ৩) প্রথম `{` থেকে শেষ `}` পর্যন্ত
 * কোনোটা গ্রহণযোগ্য হলে {tool, arguments}, নাহলে null (= চূড়ান্ত উত্তর)।
 */
export function parseToolCall(text: string): ToolCallRequest | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].trim()) candidates.push(fence[1].trim());

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const extracted = extractToolCall(parsed);
    if (extracted) return extracted;
  }
  return null;
}
