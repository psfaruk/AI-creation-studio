// ============================================================
// এক্সটার্নাল-প্রোভাইডার LLM — প্রকৃত OpenAI SDK (npm `openai`)
// দিয়ে DeepSeek / Z.ai API / BigModel / Groq / OpenRouter।
//
// কেন `openai` প্যাকেজটাই "রিয়েল DeepSeek SDK":
//  - DeepSeek-এর অফিসিয়াল ডকুমেন্টেশন (api-docs.deepseek.com,
//    "Your First API Call") বলে: "OpenAI SDK first: npm install openai"
//    — baseURL বদলেই কল প্রকৃত api.deepseek.com-এ যায়।
//  - npm-এ `deepseek-sdk` নামে ২০৮-বাইটের একটি প্লেসহোল্ডার প্যাকেজ
//    আছে (২০২৫-০২-১০, র‍্যান্ডম প্রকাশক, ১টি ফাইল) — সেটি ভুয়া;
//    ব্যবহার করলেই "রিয়েল" শর্ত ভাঙত।
//  - Z.ai (api.z.ai), BigModel, Groq, OpenRouter-ও নিজ নিজ ডকসে
//    OpenAI-কম্প্যাটিবল বলে একই SDK-তে চলে।
//
// সততার নিয়ম (আগের মতোই):
//  - প্রতিটি কল প্রোভাইডারের আসল endpoint-এ যায় — ব্যাকএন্ডে
//    কখনোই GLM/অন্য কিছু লুকিয়ে "DeepSeek" লেবেল নয়।
//  - ত্রুটি-বার্তায় প্রোভাইডারের নাম + HTTP কোড থাকে; ৪২৯-টেক্সট
//    থাকে যেন orchestrator-এর isRateLimitErrorText ধরতে পারে।
//  - DeepSeek V4-র থিংকিং-মোড টগল অফিসিয়াল extra_body-প্যারামিটারে
//    (thinking.type + reasoning_effort) — ক্যাটালগ-এন্ট্রি অনুযায়ী।
//  - Node.js runtime লাগে (সব কল-সাইট ইতিমধ্যে runtime='nodejs')।
// ============================================================

import OpenAI from 'openai';
import { PROVIDERS, type ChatModelOption, type ChatProviderId, type ModelVerificationEntry } from './chat-models';
import { getProviderKey } from './provider-keys';

/** llm.ts-এর LLMMessage-এর সাথে গঠনগতভাবে সামঞ্জস্যপূর্ণ (সার্কুলার-ইমপোর্ট এড়াতে স্থানীয়) */
export interface ExternalLLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** পুনঃচেষ্টা-যোগ্য নয় এমন সৎ-ত্রুটি (কী ভুল, ব্যালান্স শেষ, ...) */
export class ExternalFatalError extends Error {}
/** পুনঃচেষ্টা-যোগ্য (নেটওয়ার্ক/৫xx/খালি-উত্তর) */
export class ExternalRetryableError extends Error {}

/** SDK-স্টাইলের প্রথম assistant-বার্তাকে system-এ রূপান্তর (এক্সটার্নাল কনভেনশন) */
export function toExternalMessages(
  messages: ExternalLLMMessage[]
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return messages.map((m, i) =>
    i === 0 && m.role === 'assistant'
      ? { role: 'system' as const, content: m.content }
      : { role: m.role, content: m.content }
  );
}

// ------------------------------------------------------------
// OpenAI SDK ক্লায়েন্ট-ক্যাশ — প্রোভাইডার+কী অনুযায়ী (কী বদলালে নতুন)
// ------------------------------------------------------------

const g = globalThis as unknown as {
  __externalLlmClients?: Map<string, OpenAI>;
};

function getClient(provider: ChatProviderId, apiKey: string, defaultTimeoutMs: number): OpenAI {
  const info = PROVIDERS[provider];
  if (!info?.baseURL) {
    throw new ExternalFatalError(`${info?.label ?? provider}: এই প্রোভাইডারের API-কনফিগ অসম্পূর্ণ`);
  }
  if (!g.__externalLlmClients) g.__externalLlmClients = new Map();
  const cacheKey = `${provider}:${apiKey}`;
  const hit = g.__externalLlmClients.get(cacheKey);
  if (hit) return hit;

  const client = new OpenAI({
    apiKey,
    baseURL: info.baseURL,
    timeout: defaultTimeoutMs,
    // আমাদের নিজস্ব ২-চেষ্টা সিম্যান্টিক্স — SDK-র ভেতরের রিট্রাই নয়
    maxRetries: 0,
    defaultHeaders: provider === 'openrouter' ? { 'X-Title': 'AI Creative Studio' } : undefined,
  });

  // একই প্রোভাইডারের পুরনো-কী ক্লায়েন্ট বাদ (মেমোরি-লিক ও পুরনো কী-ব্যবহার রোধ)
  for (const k of Array.from(g.__externalLlmClients.keys())) {
    if (k.startsWith(`${provider}:`)) g.__externalLlmClients.delete(k);
  }
  g.__externalLlmClients.set(cacheKey, client);
  return client;
}

// ------------------------------------------------------------
// রিকোয়েস্ট-বডি নির্মাণ (DeepSeek V4 থিংকিং-টগলসহ)
// ------------------------------------------------------------

function buildRequestBody(
  entry: ChatModelOption,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  opts?: { maxTokens?: number }
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: entry.apiModel,
    messages,
    stream: false,
    max_tokens: opts?.maxTokens ?? (entry.thinking === 'enabled' ? 8192 : 4096),
  };
  if (entry.provider === 'deepseek') {
    // অফিসিয়াল DeepSeek V4 প্যারামিটার (Thinking Mode গাইড):
    //   thinking.type = enabled/disabled, reasoning_effort = low/high/max
    // থিংকিং-মোডে temperature নীরবে উপেক্ষিত — তাই পাঠাই না।
    body.thinking = { type: entry.thinking ?? 'disabled' };
    if ((entry.thinking ?? 'disabled') === 'enabled') {
      body.reasoning_effort = entry.reasoningEffort ?? 'high';
    }
  } else {
    body.temperature = 0.7;
  }
  return body;
}

/** OpenAI SDK-র ত্রুটি থেকে HTTP স্ট্যাটাস (APIError-এ .status থাকে) */
function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : undefined;
}

// ------------------------------------------------------------
// চ্যাট-কমপ্লিশন (অ-স্ট্রিমিং) — llm.ts-এর chatComplete এটি ব্যবহার করে
// ------------------------------------------------------------

export async function externalChatComplete(
  messages: ExternalLLMMessage[],
  entry: ChatModelOption,
  opts?: {
    timeoutMs?: number;
    maxTokens?: number;
    /** লাইভ টোকেন-স্ট্রিম (llm.ts chatComplete থেকে আসে) */
    onDelta?: (delta: string) => void;
    onAttemptBegin?: () => void;
  }
): Promise<string> {
  const providerInfo = PROVIDERS[entry.provider];
  const apiModel = entry.apiModel;
  if (!providerInfo?.baseURL || !apiModel) {
    throw new ExternalFatalError(`${providerInfo?.label ?? entry.id}: এই এন্ট্রিতে API-কনফিগ অসম্পূর্ণ`);
  }
  const key = await getProviderKey(entry.provider);
  if (!key) {
    throw new ExternalFatalError(
      `${providerInfo.label}: API কী যোগ করা হয়নি — মডেল-তালিকার "কী যোগ করুন" থেকে কী দিন`
    );
  }

  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const client = getClient(entry.provider, key, timeoutMs);

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      opts?.onAttemptBegin?.();
      if (opts?.onDelta) {
        // স্ট্রিমিং-পথ — প্রকৃত OpenAI SDK stream (টোকেন-বাই-টোকেন)
        const body = { ...buildRequestBody(entry, toExternalMessages(messages), opts), stream: true };
        const stream = (await client.chat.completions.create(
          body as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          { timeout: timeoutMs }
        )) as unknown as AsyncIterable<{
          choices?: Array<{ delta?: { content?: unknown } }>;
        }>;
        let full = '';
        for await (const chunk of stream) {
          const d = chunk?.choices?.[0]?.delta?.content;
          if (typeof d === 'string' && d.length > 0) {
            full += d;
            opts.onDelta(d);
          }
        }
        if (full.trim() !== '') return full;
        lastErr = new ExternalRetryableError('খালি উত্তর এসেছে');
      } else {
        const res = await client.chat.completions.create(
          buildRequestBody(entry, toExternalMessages(messages), opts) as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
          { timeout: timeoutMs }
        );
        const content = res?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.trim() !== '') return content;
        lastErr = new ExternalRetryableError('খালি উত্তর এসেছে');
      }
    } catch (err) {
      const status = statusOf(err);
      const errText = err instanceof Error ? err.message : String(err);

      if (status === 401 || status === 403) {
        throw new ExternalFatalError(`${providerInfo.label}: API কী অবৈধ বা অনুমতি নেই (HTTP ${status})`);
      }
      if (status === 402) {
        throw new ExternalFatalError(`${providerInfo.label}: অ্যাকাউন্টে ব্যালান্স শেষ (HTTP 402) — রিচার্জ করুন`);
      }
      if (status === 429) {
        // সৎ ৪২৯ — orchestrator-এর isRateLimitErrorText যেন ধরতে পারে
        throw new ExternalFatalError(
          `${providerInfo.label}: রেট-লিমিট (HTTP 429) — কিছুক্ষণ পরে আবার চেষ্টা করুন`
        );
      }
      if (status === 404 || status === 400) {
        throw new ExternalFatalError(
          `${providerInfo.label}: মডেল-আইডি/অনুরোধ গৃহীত হয়নি (HTTP ${status}) — মডেল-তালিকা বদলেছে হতে পারে; "যাচাই করুন" চালান`
        );
      }
      if (status != null && status >= 500) {
        lastErr = new ExternalRetryableError(`${providerInfo.label}: সার্ভার-ত্রুটি (HTTP ${status})`);
      } else if (/abort|timed? ?out|timeout/i.test(errText)) {
        lastErr = new ExternalRetryableError(`সময়শেষ (টাইমআউট > ${Math.round(timeoutMs / 1000)} সে.)`);
      } else {
        // নেটওয়ার্ক/সংযোগ/অজানা — পুনঃচেষ্টা-যোগ্য
        lastErr = new ExternalRetryableError(`${providerInfo.label}: ${errText.slice(0, 160)}`);
      }
    }
    if (attempt === 2) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${providerInfo.label}: ${msg}`);
}

// ------------------------------------------------------------
// মডেল-যাচাই (POST /api/models) — প্রকৃত ছোট কল প্রোভাইডারের API-তে
// ------------------------------------------------------------

/** যাচাই-কলের সময়সীমা */
const VERIFY_TIMEOUT_MS = 30_000;

export async function verifyExternalModel(
  entry: ChatModelOption,
  key: string | null
): Promise<ModelVerificationEntry> {
  const providerInfo = PROVIDERS[entry.provider];
  const t0 = Date.now();
  if (!key) {
    return {
      ok: false,
      needsKey: true,
      error: `${providerInfo.label}: API কী যোগ করা হয়নি`,
      testedAt: new Date().toISOString(),
    };
  }
  try {
    const client = getClient(entry.provider, key, VERIFY_TIMEOUT_MS);
    const body: Record<string, unknown> = {
      model: entry.apiModel,
      messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
      stream: false,
      max_tokens: 8,
    };
    // যাচাই-কলে থিংকিং বন্ধ — ৮ টোকেনের বাজেটে সরাসরি উত্তর আসুক
    // (থিংকিং-মোডে CoT-ই আগে বসে যেত)। মডেল-আইডি/endpoint একই থাকে।
    if (entry.provider === 'deepseek') body.thinking = { type: 'disabled' };

    const res = await client.chat.completions.create(
      body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { timeout: VERIFY_TIMEOUT_MS }
    );
    const content = res?.choices?.[0]?.message?.content;
    const ok = typeof content === 'string' && content.trim().length > 0;
    return {
      ok,
      servedModel: res?.model ?? entry.apiModel,
      ms: Date.now() - t0,
      testedAt: new Date().toISOString(),
      ...(ok ? {} : { error: 'খালি উত্তর' }),
    };
  } catch (err) {
    const status = statusOf(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (status === 429) {
      return {
        ok: false,
        rateLimited: true,
        error: `${providerInfo.label}: রেট-লিমিট (HTTP 429) — কিছুক্ষণ পরে আবার`,
        testedAt: new Date().toISOString(),
      };
    }
    const reason =
      status === 401 || status === 403
        ? 'কী অবৈধ/অনুমতি নেই'
        : status === 402
          ? 'ব্যালান্স শেষ'
          : status === 404 || status === 400
            ? 'মডেল-আইডি এখন নেই (তালিকা বদলেছে)'
            : status != null
              ? `HTTP ${status}`
              : 'নেটওয়ার্ক/সংযোগ ব্যর্থ';
    return {
      ok: false,
      error: `${providerInfo.label}: ${reason} — ${msg.slice(0, 120)}`,
      testedAt: new Date().toISOString(),
    };
  }
}
