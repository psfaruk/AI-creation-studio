// ============================================================
// LLM adapter — z-ai-web-dev-sdk singleton + Bengali system prompt
// + tolerant JSON tool-call parser (native tool-calling নেই বলে JSON প্রোটোকল)।
// ============================================================

import ZAI from 'z-ai-web-dev-sdk';
import { withRetry } from './retry';

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

/**
 * Non-streaming chat completion (thinking disabled)।
 * §১০-সংশোধন (S8-3): আগের পুরনো নির্দিষ্ট-বিরতির রিট্রাই-র বদলে এখন
 * retry.ts-র withRetry — Retry-After-সচেতন + full-jitter ব্যাকঅফ (৪ চেষ্টা);
 * ৪২৯-নিঃশেষে TemporarilyUnavailableError (সাময়িক, লাইসেন্স-সমস্যা নয়)।
 */
export async function chatComplete(messages: LLMMessage[]): Promise<string> {
  const zai = await getZAI();
  return withRetry(
    async () => {
      const res = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      });
      const content = res?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    },
    'LLM (চ্যাট)',
    4,
    3000
  );
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
 *  ৩) প্রথম \`{\` থেকে শেষ \`}\` পর্যন্ত
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
