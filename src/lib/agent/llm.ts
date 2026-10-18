// ============================================================
// LLM adapter — z-ai-web-dev-sdk singleton + Bengali system prompt
// + tolerant JSON tool-call parser (native tool-calling নেই বলে JSON প্রোটোকল)।
//
// S9-গভীর-সমাধান (২০২৬-১০-১১-এর ৪২৯-ঘটনা থেকে):
//  - chatComplete-এর পুরনো বাজেট ছিল ৪ চেষ্টা × ৩ সে. ≈ ১৬ সে. —
//    মিনিট-দীর্ঘ ৪২৯-উইন্ডোতে রান ধাপ ০-তেই মরে যেত। এখন:
//    ৬ চেষ্টা (LLM_CHAT_RETRY_ATTEMPTS), base ৪ সে., max ৬০ সে.
//    (সব-ব্যর্থ-ক্ষেত্রেও অপেক্ষা-বাজেট ≈ ৪ মিনিট —
//    ১০-মিনিটের stale-sweepের মধ্যে)।
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
import { findChatModel, PROVIDERS } from './chat-models';
import { externalChatComplete } from './external-llm';
import { assertZaiConfiguredOrThrow, classifyZaiCreateError } from '@/lib/providers/sandbox-detect';

export { externalChatComplete, ExternalFatalError, ExternalRetryableError } from './external-llm';

/**
 * (A1-F05) চ্যাট-LLM কলের সর্বোচ্চ প্রচেষ্টা-সংখ্যা — নিচের withRetry-কল
 * এবং orchestrator-এর ব্যবহারকারী-দৃশ্যমান ৪২৯-নোট ("চেষ্টা n/৬") একই
 * ধ্রুবক থেকে পড়ে, যাতে দুই জায়গার মান কখনো আলাদা হয়ে না যায়।
 */
export const LLM_CHAT_RETRY_ATTEMPTS = 6;

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ------------------------------------------------------------
// (অডিট §A) সিস্টেম-রোল ফিক্স — আমাদের প্রোটোকলে সিস্টেম-প্রম্পটটি
// প্রথম assistant-বার্তা হিসেবে বহাল হয় (LLMMessage-র ইউনিয়নে 'system'
// নেই)। external-llm.ts এর toExternalMessages এটিকে আগেই সত্যিকারের
// system-রোলে রূপান্তর করে; Z.ai SDK-পথেও এখন একই রূপান্তর হয় —
// নইলে SDK প্রথম assistant-বার্তাটিকে নির্দেশনা নয় সাধারণ
// কথোপকথনের অংশ মনে করতে পারত।
// ------------------------------------------------------------

/** SDK-কে পাঠানোর আগে প্রথম assistant-বার্তাটিকে system-রোলে রূপান্তর */
export function toSdkMessages(
  messages: LLMMessage[]
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages.map((m, i) =>
    i === 0 && m.role === 'assistant'
      ? { role: 'system' as const, content: m.content }
      : { role: m.role, content: m.content }
  );
}

// Singleton SDK instance (module-level promise; globalThis-এ রাখা হয় যাতে
// dev-mode HMR-এ বারবার নতুন instance না হয়)।
const g = globalThis as unknown as { __zaiSingleton?: Promise<ZAI> };

export function getZAI(): Promise<ZAI> {
  if (!g.__zaiSingleton) {
    // ------------------------------------------------------------
    // Phase 1 (B-D1): প্রিফ্লাইট + সৎ শ্রেণিবিভাগ — এটিই সব SDK-কলের
    // (চ্যাট/ছবি/TTS/ASR/VLM/ছবি-সার্চ/ভিডিও) একমাত্র প্রমাণীকরণ-চোক-পয়েন্ট।
    // স্যান্ডবক্সের বাইরে (যেমন Railway) .z-ai-config নেই → প্রথম ব্যবহারেই
    // সৎ ProviderUnavailableError (রহস্যময় নেটওয়ার্ক-ত্রুটি নয়)।
    // ফলব্যাক-নীতি: TemporarilyUnavailableError-উত্তরাধিকারে পাইপলাইনের
    // সৎ-লোকাল-ফলব্যাক পথ (লেবেলসহ) অপরিবর্তিত থাকে।
    // ------------------------------------------------------------
    g.__zaiSingleton = (async () => {
      assertZaiConfiguredOrThrow('z-ai SDK (চ্যাট/ছবি/TTS/ASR/ভিডিও)');
      try {
        return await ZAI.create();
      } catch (err) {
        throw classifyZaiCreateError(err, 'z-ai SDK (চ্যাট/ছবি/TTS/ASR/ভিডিও)');
      }
    })();
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
  /**
   * (অডিট §B5) এক্সটার্নাল-প্রোভাইডারের ৪২৯-পুনঃচেষ্টার অপেক্ষা-নোট —
   * প্রতিটি অপেক্ষার আগে একবার (SDK-পথের onRateLimitWait-এর প্রতিরূপ;
   * external-llm.ts-এর onWait-এ thread হয়)।
   */
  onExternalWait?: (info: { attempt: number; totalAttempts: number; waitMs: number }) => void;
  /** ডিস্ক-ক্যাশ বাদ দিয়ে সরাসরি API (default: false = ক্যাশ চালু)। ডায়াগনস্টিক-মোড এটি ব্যবহার করে। */
  skipCache?: boolean;
  /**
   * (অডিট §C) লাইভ ক্যাশ-অবজারভেবিলিটি — প্রতিটি সফল কলের পর একবার ডাকা হয়:
   * ক্যাশ-হিট (latencyMs≈০), ক্যাশ-মিস বা ইচ্ছাকৃত বাইপাস (skipCache) —
   * প্রকৃত রাউটেড প্রোভাইডার + বাস্তব লেটেন্সিসহ। ব্যর্থ কলে ডাকা হয় না।
   */
  onMeta?: (meta: ChatCallMeta) => void;
  /**
   * লাইভ টোকেন-স্ট্রিম — প্রতিটি ডেল্টা-অংশ যথাসময়ে ফেরে।
   * (ডিস্ক-ক্যাশ-হিট বা নন-স্ট্রিম ফলব্যাকে ডেল্টা আসে না — তখন পুরো টেক্সট একবারে।)
   */
  onDelta?: (delta: string) => void;
  /** প্রতি রিট্রাই-এটেম্প্ট শুরুর আগে একবার ডাকা হয় (আংশিক-স্ট্রিম রিসেটের সংকেত) */
  onAttemptBegin?: () => void;
  /**
   * নির্বাচিত চ্যাট-মডেল ('' / undefined = SDK ডিফল্ট)।
   * ক্যাটালগের provider অনুযায়ী রাউট হয়:
   *   - 'zai' → z-ai-web-dev-sdk (বিল্ট-ইন, শেয়ার্ড রেট-লিমিট)
   *   - এক্সটার্নাল → সেই প্রোভাইডারের প্রকৃত API (নিজের কী)
   */
  model?: string;
  /**
   * এক্সটার্নাল-পথে max_tokens সীমা (ঐচ্ছিক; /api/v1 ক্লায়েন্টের
   * অনুরোধ থেকে আসে)। SDK-পথ এটি উপেক্ষা করে।
   */
  maxTokens?: number;
}

/**
 * (অডিট §C) একটি chatComplete-কলের পরিলেখ — orchestrator এটিকে
 * AgentRun.cacheStatus + AgentStep payload + SSE-নোটে পাঠায়।
 */
export interface ChatCallMeta {
  cache: 'hit' | 'miss' | 'bypass';
  provider: 'zai' | 'external';
  /** মানব-পাঠযোগ্য প্রোভাইডার-নাম (যেমন 'Z.ai API', 'GLM · BigModel') */
  providerLabel?: string;
  model?: string;
  latencyMs: number;
}

/** অনুরোধ-আইডি থেকে রোমান্টিক (কোয়ার্স) প্রোভাইডার — ক্যাশ-হিটের আগেই জানা যায় */
function coarseProviderOf(requestedId: string): 'zai' | 'external' {
  if (requestedId === '') return 'zai';
  const entry = findChatModel(requestedId);
  return entry && entry.provider !== 'zai' ? 'external' : 'zai';
}

// ------------------------------------------------------------
// Z.ai SDK স্ট্রিম-উত্তর ভোগ — raw SSE (ReadableStream/string) থেকে
// delta-content বের করে onDelta-তে পাঠায়, পুরো টেক্সট ফেরায়।
// (stream:true → ReadableStream of OpenAI-SSE-chunks; কিছু ব্যাকএন্ড
// পুরো-স্ট্রিং বা অবজেক্টও ফেরাতে পারে — তিনটি রূপই সামলানো হয়।)
// ------------------------------------------------------------

async function consumeZaiStream(res: unknown, onDelta?: (d: string) => void): Promise<string> {
  // রূপ ১: ReadableStream (raw SSE bytes)
  if (res && typeof (res as ReadableStream).getReader === 'function') {
    const reader = (res as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = sseBuf.indexOf('\n\n')) !== -1) {
        const rawEvent = sseBuf.slice(0, sep);
        sseBuf = sseBuf.slice(sep + 2);
        full += extractDeltaFromSseEvent(rawEvent, onDelta);
      }
    }
    return full;
  }
  // রূপ ২: পুরো SSE-স্ট্রিং একবারে
  if (typeof res === 'string') {
    return extractDeltaFromSseEvent(res.replace(/\r\n/g, '\n'), onDelta);
  }
  // রূপ ৩: সাধারণ নন-স্ট্রিম completion-অবজেক্ট
  const r = res as Record<string, unknown> | null;
  const content = (r?.choices as Array<Record<string, unknown>> | undefined)?.[0];
  const msg = (content?.message as Record<string, unknown> | undefined)?.content;
  if (typeof msg === 'string' && msg.length > 0) {
    onDelta?.(msg);
    return msg;
  }
  return '';
}

/** একটি raw SSE-ইভেন্ট-ব্লক (data:-লাইনসমূহ) থেকে delta-content যোগ করে ফেরায় */
function extractDeltaFromSseEvent(rawEvent: string, onDelta?: (d: string) => void): string {
  let out = '';
  for (const line of rawEvent.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const chunk = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        out += delta;
        onDelta?.(delta);
      }
    } catch {
      // malformed chunk — উপেক্ষা
    }
  }
  return out;
}

// ------------------------------------------------------------
// এক্সটার্নাল-প্রোভাইডার পথ (Z.ai API / BigModel — উভয়ই GLM) —
// বাস্তবায়ন external-llm.ts-এ: প্রকৃত OpenAI SDK (npm `openai`) +
// প্রোভাইডারের আসল endpoint। এন্ডপয়েন্ট-মিশ্রণ/ক্রস-ফলব্যাক নেই।
// ------------------------------------------------------------

/**
 * Non-streaming chat completion (thinking disabled)।
 * রাউটিং: ক্যাটালগের provider অনুযায়ী —
 *   'zai' → SDK-পথ (S9: ৬ চেষ্টা + চ্যানেল-কুলডাউন-সৎ-অপেক্ষা + full-jitter)
 *   এক্সটার্নাল → প্রোভাইডারের প্রকৃত API (২ চেষ্টা, সৎ HTTP-ম্যাপিং)
 * একই context ডিস্ক-ক্যাশ থেকে ফেরে (উভয় পথেই)।
 * (অডিট §C) প্রতিটি সফল কলের ক্যাশ-অবস্থা + প্রোভাইডার + লেটেন্সি onMeta-য় যায়।
 */
export async function chatComplete(
  messages: LLMMessage[],
  opts?: ChatCompleteOptions
): Promise<string> {
  const key = cacheKeyOf(messages, opts?.model);
  const requestedId = opts?.model && opts.model.trim() !== '' ? opts.model.trim() : '';
  if (!opts?.skipCache) {
    const cached = await readLlmCache(key);
    if (cached != null) {
      stats().hits++;
      // ক্যাশ-হিট: প্রকৃত API-কল হয়নি — লেটেন্সি ≈০; প্রোভাইডার অনুরোধ-আইডি থেকেই নির্ণীত
      opts?.onMeta?.({
        cache: 'hit',
        provider: coarseProviderOf(requestedId),
        ...(requestedId !== '' ? { model: requestedId } : {}),
        latencyMs: 0,
      });
      return cached;
    }
  }
  stats().misses++;

  // ---- এক্সটার্নাল-প্রোভাইডার রাউটিং ----
  const externalOpts: {
    onDelta?: (delta: string) => void;
    onAttemptBegin?: () => void;
    onWait?: (info: { attempt: number; totalAttempts: number; waitMs: number }) => void;
    maxTokens?: number;
  } = {
    ...(opts?.onDelta
      ? { onDelta: opts.onDelta, ...(opts.onAttemptBegin ? { onAttemptBegin: opts.onAttemptBegin } : {}) }
      : {}),
    // (অডিট §B5) ৪২৯-অপেক্ষা-নোটের পাসথ্রু — orchestrator-এর run_note-এর উৎস
    ...(opts?.onExternalWait ? { onWait: opts.onExternalWait } : {}),
  };
  if (opts?.maxTokens != null && Number.isFinite(opts.maxTokens) && opts.maxTokens > 0) {
    externalOpts.maxTokens = Math.min(8192, Math.floor(opts.maxTokens));
  }
  const emitMissOrBypass = (
    provider: ChatCallMeta['provider'],
    providerLabel: string | undefined,
    t0: number
  ) => {
    opts?.onMeta?.({
      cache: opts?.skipCache ? 'bypass' : 'miss',
      provider,
      ...(providerLabel ? { providerLabel } : {}),
      ...(requestedId !== '' ? { model: requestedId } : {}),
      latencyMs: Math.max(0, Date.now() - t0),
    });
  };

  // ---- এক্সটার্নাল GLM-প্রোভাইডার (zai-api / glm — নিজের কী) ----
  const entry = requestedId !== '' ? findChatModel(requestedId) : undefined;
  if (entry && entry.provider !== 'zai') {
    const t0 = Date.now();
    const text = await externalChatComplete(messages, entry, externalOpts);
    if (text && text.length > 0) {
      emitMissOrBypass('external', PROVIDERS[entry.provider]?.label, t0);
      await writeLlmCache(key, text);
    }
    return text;
  }

  // ---- Z.ai SDK-পথ (স্ট্রিমিংসহ — স্মুথ লাইভ-আউটপুটের উৎস) ----
  const zai = await getZAI();
  const model = requestedId !== '' ? requestedId : undefined;
  const t0 = Date.now();
  const text = await withRetry(
    async () => {
      opts?.onAttemptBegin?.();
      const res = await zai.chat.completions.create({
        // (অডিট §A) সিস্টেম-প্রম্পট = প্রথম assistant-বার্তা → সত্যিকারের
        // system-রোলে পাঠানো হয় (SDK-র টাইপ ChatMessage এ রোল-ইউনিয়নে
        // 'system' আছে — external-llm.ts-এর toExternalMessages-এর মতোই)।
        messages: toSdkMessages(messages),
        ...(model ? { model } : {}),
        stream: true,
        thinking: { type: 'disabled' },
      });
      const content = await consumeZaiStream(res, opts?.onDelta);
      return typeof content === 'string' ? content : '';
    },
    'LLM (চ্যাট)',
    LLM_CHAT_RETRY_ATTEMPTS, // S9: ৬ চেষ্টা — মোট অপেক্ষা-বাজেট ≈৪–৫ মিনিট (১০-মিনিটের stale-sweepের মধ্যে)
    4000, // base ৪ সে.
    {
      maxDelayMs: 60_000, // একক সর্বোচ্চ অপেক্ষা ৬০ সে.
      channel: 'chat',
      cooldownBudgetMs: 90_000, // প্রতি চেষ্টায় কুলডাউন-অপেক্ষার সীমা ৯০ সে.
      ...(opts?.onRateLimitWait ? { onWait: opts.onRateLimitWait } : {}),
    }
  );
  if (text && text.length > 0) {
    emitMissOrBypass('zai', PROVIDERS.zai?.label, t0);
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
