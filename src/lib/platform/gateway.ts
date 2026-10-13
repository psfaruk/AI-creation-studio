// ============================================================
// gateway.ts — /api/v1/* রাউটগুলোর শেয়ার্ড যুক্তি (server-only)
//
// OpenAI-কম্প্যাটিবল প্রতিক্রিয়া + ব্যাকেন্ড-রাউটিং:
//  glm-4-plus   → zai.chat.completions.create (টেক্সট চ্যাট)
//  glm-5v-turbo → zai.chat.completions.createVision (মাল্টিমোডাল)
//  cogview-3    → zai.images.generations.create (ইমেজ)
//
// সততা: model-স্ট্রিং ব্যাকেন্ডে যেমন যায় তেমনই থাকে; প্রতিক্রিয়ার
// model-ক্ষেত্রে ব্যাকেন্ড যা served-model বলে তা-ই ফেরে। ৪২৯/ত্রুটি
// OpenAI-ফরম্যাটে সৎভাবে ফেরে — কোনো নীরব ফলব্যাক নয়।
// ============================================================

import { NextResponse } from 'next/server';
import { getZAI } from '@/lib/agent/llm';
import { findPlatformModel, type PlatformModel } from './platform-models';
import { logApiCall } from './api-keys';

/** OpenAI-স্টাইল ত্রুটি-প্রতিক্রিয়া */
export function openAIError(
  status: number,
  code: string,
  message: string,
  param?: string
): NextResponse {
  return NextResponse.json(
    {
      error: {
        message,
        type:
          status === 401
            ? 'authentication_error'
            : status === 403
              ? 'permission_error'
              : status === 429
                ? 'rate_limit_error'
                : status === 404
                  ? 'invalid_request_error'
                  : 'api_error',
        param: param ?? null,
        code,
      },
    },
    { status }
  );
}

export function bearerFrom(req: Request): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  return h;
}

// ------------------------------------------------------------
// চ্যাট-কমপ্লিশন — glm-4-plus (টেক্সট) ও glm-5v-turbo (ভিশন)
// ------------------------------------------------------------

/** OpenAI-বার্তার সাধারণ আকৃত */
export interface GatewayMessage {
  role: 'system' | 'user' | 'assistant';
  content: unknown; // string বা content-parts অ্যারে (ভিশন)
}

function textContentOf(content: unknown): string | null {
  if (typeof content === 'string') return content;
  return null;
}

/** বার্তাগুলোতে মাল্টিমোডাল অংশ আছে কি না */
function hasMultimodalContent(messages: GatewayMessage[]): boolean {
  return messages.some(m => Array.isArray(m.content));
}

/** মাল্টিমোডাল অংশকে SDK-র VisionMessage-রূপে স্বাভাবিক করা */
function toVisionContent(content: unknown): Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
> {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }];
  const out: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p.type === 'text' && typeof p.text === 'string') {
      out.push({ type: 'text', text: p.text });
    } else if (
      p.type === 'image_url' &&
      p.image_url &&
      typeof (p.image_url as Record<string, unknown>).url === 'string'
    ) {
      out.push({
        type: 'image_url',
        image_url: { url: (p.image_url as Record<string, unknown>).url as string },
      });
    }
  }
  return out.length > 0 ? out : [{ type: 'text', text: '' }];
}

/** কী-এর ভাষা-নির্দেশকে হালকা system-সংযোজনে রূপান্তর ('auto' = কিছু নয়) */
function languageDirective(lang: string): string | null {
  if (lang === 'bn') return 'Respond in Bengali (বাংলায় উত্তর দিন)।';
  if (lang === 'en') return 'Respond in English.';
  return null;
}

interface ChatCallResult {
  status: number;
  /** স্ট্রিম হলে SSE-বডি; নাহলে JSON-প্রতিক্রিয়া */
  streamBody?: ReadableStream<Uint8Array>;
  json?: Record<string, unknown>;
  error?: { code: string; message: string };
}

function errOf(status: number, code: string, message: string): ChatCallResult {
  return { status, error: { code, message } };
}

export async function callPlatformChat(input: {
  model: PlatformModel;
  messages: GatewayMessage[];
  stream: boolean;
  temperature?: number;
  maxTokens?: number;
  defaultLanguage: string;
}): Promise<ChatCallResult> {
  const { model, messages, stream } = input;
  const zai = await getZAI();

  // ভাষা-নির্দেশ (কী-বাইন্ডিং থেকে) — প্রথম system-বার্তার সাথে জুড়ে দেওয়া
  const directive = languageDirective(input.defaultLanguage);
  const msgs = directive
    ? [{ role: 'system' as const, content: directive }, ...messages]
    : messages;

  try {
    if (model.kind === 'vision') {
      const visionMessages = msgs.map(m => ({
        role: m.role,
        content: toVisionContent(m.content),
      }));
      const res: unknown = await zai.chat.completions.createVision({
        model: model.id,
        messages: visionMessages as never,
        ...(stream ? { stream: true } : {}),
        thinking: { type: 'disabled' },
      });
      return interpretChatResult(res, model.id, stream);
    }

    // টেক্সট-চ্যাট — মাল্টিমোডাল অংশ এসে দাঁড়ালে সৎ ত্রুটি
    if (hasMultimodalContent(msgs)) {
      return errOf(
        400,
        'multimodal_not_supported',
        `"${model.id}" টেক্সট-চ্যাট মডেল — image_url-কনটেন্ট পাঠাতে চাইলে "glm-5v-turbo" ব্যবহার করুন`
      );
    }
    const textMessages = msgs.map(m => ({
      role: m.role,
      content: textContentOf(m.content) ?? '',
    }));
    const res: unknown = await zai.chat.completions.create({
      model: model.id,
      messages: textMessages as never,
      ...(stream ? { stream: true } : {}),
      thinking: { type: 'disabled' },
    });
    return interpretChatResult(res, model.id, stream);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\b429\b|too many requests/i.test(msg)) {
      return errOf(
        429,
        'upstream_rate_limited',
        'ব্যাকেন্ড পাইপ এই মুহূর্তে রেট-লিমিটেড (৪২৯) — কিছুক্ষণ পরে আবার চেষ্টা করুন'
      );
    }
    return errOf(502, 'upstream_error', `ব্যাকেন্ড ত্রুটি: ${msg.slice(0, 200)}`);
  }
}

/** SDK-প্রতিক্রিয়াকে স্বাভাবিক OpenAI-রূপে চিনে নেওয়া */
function interpretChatResult(res: unknown, modelId: string, stream: boolean): ChatCallResult {
  // স্ট্রিম: ReadableStream (raw SSE) — পাসথ্রু
  if (stream) {
    if (res && typeof (res as ReadableStream).getReader === 'function') {
      return { status: 200, streamBody: res as ReadableStream<Uint8Array> };
    }
    if (typeof res === 'string') {
      return { status: 200, streamBody: sseFromString(res) };
    }
    // স্ট্রিম নয় এমন উত্তর এসে গেলে সেটিকেই সৎভাবে পাসথ্রু JSON করি
  }
  const r = res as Record<string, unknown> | null;
  const firstChoice =
    (r?.choices as Array<Record<string, unknown>> | undefined)?.[0] ?? undefined;
  const content = (firstChoice?.message as Record<string, unknown> | undefined)?.content;
  if (typeof content === 'string' && content.length > 0) {
    return {
      status: 200,
      json: {
        id: typeof r?.id === 'string' ? r.id : `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created:
          typeof r?.created === 'number' ? r.created : Math.floor(Date.now() / 1000),
        model: typeof r?.model === 'string' ? r.model : modelId,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content },
            finish_reason: (firstChoice?.finish_reason as string) ?? 'stop',
          },
        ],
        usage: (r?.usage as Record<string, unknown>) ?? undefined,
      },
    };
  }
  return errOf(502, 'empty_response', 'ব্যাকেন্ড থেকে খালি উত্তর এসেছে');
}

/** raw SSE-স্ট্রিং → ReadableStream (বাইট) */
function sseFromString(raw: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(enc.encode(raw));
      if (!raw.includes('data: [DONE]')) controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

/** SSE-পাসথ্রু প্রতিক্রিয়া (stream:true) — ব্যাকেন্ডের চাঙ্কগুলো হুবহু */
export function ssePassthroughResponse(
  body: ReadableStream<Uint8Array>,
  keyId: string,
  endpoint: string,
  modelId: string
): NextResponse {
  const t0 = Date.now();
  const wrapped = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = body.getReader();
      const dec = new TextDecoder();
      let gotDone = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (dec.decode(value, { stream: true }).includes('[DONE]')) gotDone = true;
          controller.enqueue(value);
        }
        if (!gotDone) controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      } catch {
        controller.enqueue(
          new TextEncoder().encode('data: {"error":{"message":"stream interrupted"}}\n\n')
        );
      } finally {
        controller.close();
        // স্ট্রিম-কলও লগ হয় (মোট latency সহ)
        void logApiCall({
          keyId,
          endpoint,
          model: modelId,
          status: 200,
          latencyMs: Date.now() - t0,
        });
      }
    },
  });
  return new NextResponse(wrapped, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ------------------------------------------------------------
// ইমেজ-জেনারেশন — cogview-3
// ------------------------------------------------------------

const IMAGE_SIZES = new Set([
  '1024x1024',
  '768x1344',
  '864x1152',
  '1344x768',
  '1152x864',
  '1440x720',
  '720x1440',
]);

export async function callPlatformImage(input: {
  model: PlatformModel;
  prompt: string;
  size?: string;
}): Promise<
  | { status: 200; json: Record<string, unknown>; servedMs: number }
  | { status: number; error: { code: string; message: string } }
> {
  const zai = await getZAI();
  const size = input.size && IMAGE_SIZES.has(input.size) ? input.size : '1024x1024';
  const t0 = Date.now();
  try {
    const res = await zai.images.generations.create({
      model: input.model.id,
      prompt: input.prompt.slice(0, 2000),
      size: size as never,
    });
    const b64 = res?.data?.[0]?.base64;
    if (typeof b64 !== 'string' || b64.length === 0) {
      return { status: 502, error: { code: 'empty_response', message: 'ব্যাকেন্ড খালি ছবি দিয়েছে' } };
    }
    return {
      status: 200,
      servedMs: Date.now() - t0,
      json: {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: b64, size }],
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/\b429\b|too many requests/i.test(msg)) {
      return {
        status: 429,
        error: {
          code: 'upstream_rate_limited',
          message: 'ব্যাকেন্ড পাইপ এই মুহূর্তে রেট-লিমিটেড (৪২৯) — কিছুক্ষণ পরে আবার',
        },
      };
    }
    return { status: 502, error: { code: 'upstream_error', message: `ব্যাকেন্ড ত্রুটি: ${msg.slice(0, 200)}` } };
  }
}
