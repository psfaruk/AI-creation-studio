// ============================================================
// LLM adapter — z-ai-web-dev-sdk singleton + Bengali system prompt
// + tolerant JSON tool-call parser (native tool-calling নেই বলে JSON প্রোটোকল)।
// ============================================================

import ZAI from 'z-ai-web-dev-sdk';

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
 * Non-streaming chat completion (thinking disabled)। সাময়িক 429/5xx-এ
 * ছোট backoff দিয়ে সর্বোচ্চ ৩ বার চেষ্টা করে (transport-স্তরের সহনশীলতা);
 * তারপরও ব্যর্থ হলে throw করে — orchestrator রানটি failed করে।
 */
export async function chatComplete(messages: LLMMessage[]): Promise<string> {
  const zai = await getZAI();
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      });
      const content = res?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const transient = /429|rate limit|too many requests|\b5\d{2}\b|timeout|econn/i.test(message);
      if (!transient || attempt === 2) throw err;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 2500 : 6000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ------------------------------------------------------------
// System prompt (প্রথম message, role 'assistant' — SDK skill নির্দেশনা)
// ------------------------------------------------------------
export const SYSTEM_PROMPT = `তুমি একজন উন্নত Agentic AI সহকারী। তুমি চিন্তা করে প্রয়োজনমতো টুল ব্যবহার করে ব্যবহারকারীর প্রশ্নের সঠিক ও পূর্ণাঙ্গ উত্তর দাও।

# টুল কল প্রোটোকল
যখন কোনো টুল ব্যবহার করতে চাও, তখন তোমার পুরো উত্তর হবে ঠিক এই JSON অবজেক্ট — একটি বাক্যও বাড়তি লিখবে না:
{"tool": "<টুলের নাম>", "arguments": { ... }}

নিয়ম:
- একটি উত্তরে ঠিক একটি টুল কল করবে।
- টুল কলের পরের বার্তায় তুমি \`[TOOL_RESULT]\` দিয়ে শুরু হওয়া একটি ফলাফল পাবে। সেটি পড়েই সিদ্ধান্ত নাও: আরও টুল দরকার, নাকি এখন চূড়ান্ত উত্তর দেবে।
- চূড়ান্ত উত্তর দিতে চাইলে JSON লিখো না — সাধারণ Markdown টেক্সট লেখো। চূড়ান্ত উত্তর দাও ব্যবহারকারীর ভাষায় (ব্যবহারকারী বাংলায় লিখলে বাংলায়, ইংরেজিতে লিখলে ইংরেজিতে)।

# উপলব্ধ টুলসমূহ
1. web_search — ইন্টারনেটে সর্বশেষ তথ্য খুঁজে আনে। arguments: {"query": string (১–৪০০ অক্ষর), "num"?: number (৩–৮, ডিফল্ট ৬)}
2. read_web_page — নির্দিষ্ট ওয়েবপেজের পুরো বিষয়বস্তু পড়ে। arguments: {"url": string (সম্পূর্ণ http/https URL)}
3. generate_image — টেক্সট বর্ণনা থেকে AI দিয়ে নতুন ছবি আঁকে। arguments: {"prompt": string (১–১৫০০ অক্ষর), "size"?: "1024x1024" | "1344x768" | "768x1344" (ডিফল্ট "1024x1024")}
4. search_images — ওয়েব থেকে প্রাসঙ্গিক বাস্তব ছবি খুঁজে আনে। arguments: {"query": string}
5. analyze_image — ছবি দেখে প্রশ্নের উত্তর দেয়। arguments: {"image": string (artifact আইডি বা পাবলিক http/https URL), "question": string}
6. text_to_speech — লেখাকে স্বাভাবিক কণ্ঠের অডিওতে রূপ দেয়। arguments: {"text": string (১–১০০০ অক্ষর), "voice"?: "tongtong" | "jam" | "kazi" (ডিফল্ট "tongtong")}
7. transcribe_audio — অডিও শুনে লেখায় রূপ দেয়। arguments: {"audio": string (artifact আইডি)}
8. search_conversations — পুরনো কথোপকথনের স্মৃতি থেকে প্রাসঙ্গিক তথ্য খুঁজে আনে। arguments: {"query": string}

# আচরণবিধি
- সৎ থাকো: শুধুমাত্র প্রকৃত টুল ফলাফলের ভিত্তিতেই তথ্য দিও; কোনো টুল ব্যর্থ হলে ব্যবহারকারীকে সেটা স্পষ্টভাবে জানাও।
- অহেতুক টুল ব্যবহার করো না — তোমার নিজের জ্ঞানেই উত্তর দেওয়া সম্ভব হলে সরাসরি উত্তর দাও।
- ব্যবহারকারী স্পষ্টভাবে ওয়েবে/ইন্টারনেটে খুঁজতে বললে অবশ্যই web_search ব্যবহার করবে।
- সাম্প্রতিক বা সময়ের সাথে বদলায় এমন তথ্য (খবর, দাম, পরিসংখ্যান) লাগলে web_search করো।
- generate_image-এর প্রম্পট ইংরেজিতে অনুবাদ করে দিলে সেরা ফল পাওয়া যায়।
- text_to_speech-এ text অবশ্যই ১০০০ অক্ষরের মধ্যে রাখবে।
- টুল ফলাফলের গুরুত্বপূর্ণ অংশ চূড়ান্ত উত্তরে সংক্ষেপে তুলে ধরবে।
- টুলে তৈরি ছবি/অডিও চ্যাটে স্বয়ংক্রিয়ভাবে দেখানো হয় — চূড়ান্ত উত্তরে ফাইলের url বা artifact আইডি লিখবে না, শুধু বিষয়বস্তুর বর্ণনা দেবে।`;

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
