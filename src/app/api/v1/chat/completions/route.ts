// ============================================================
// POST /api/v1/chat/completions — OpenAI-কম্প্যাটিবল চ্যাট-কমপ্লিশন।
//
// অ্যাপের GLM-ব্যাকএন্ডগুলো (Z.ai SDK / Z.ai API / BigModel —
// কী-ডায়ালগের কনফিগ অনুযায়ী) বাইরের OpenAI-ক্লায়েন্টের কাছে
// একক OpenAI-শেপড API হিসেবে উন্মুক্ত:
//
//   POST https://<এই-অ্যাপ>/api/v1/chat/completions
//   Authorization: Bearer amai_sk_… (বা মালিক-সেশন টোকেন)
//   { "model": "glm-4-plus", "messages": [...], "stream": true }
//
// নীতি: সৎ রাউটিং (কোনো নীরব-ফলব্যাক নয়) — মডেল অজানা হলে
// 404 model_not_found; কী-প্রয়োজন হলে স্পষ্ট ত্রুটি।
// ============================================================

import { randomBytes } from 'crypto';
import { chatComplete } from '@/lib/agent/llm';
import type { LLMMessage } from '@/lib/agent/llm';
import { findChatModel, PROVIDERS } from '@/lib/agent/chat-models';
import { getProviderKey } from '@/lib/agent/provider-keys';
import { V1_CORS_HEADERS, resolveV1Model, v1Error, v1RequireBearer } from '@/lib/platform/v1-shared';
import { checkRateLimit } from '@/lib/limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** CORS প্রি-ফ্লাইট */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: V1_CORS_HEADERS });
}

const MAX_MESSAGES = 200;
const MAX_CONTENT_CHARS = 60_000;

/** OpenAI message-content (string বা parts-অ্যারে) → সাদা টেক্সট */
function contentToText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // [{type:'text', text:'…'}, …] — টেক্সট-অংশগুলো জোড়া
    const parts: string[] = [];
    for (const p of content) {
      if (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') {
        parts.push((p as { text: string }).text);
      }
    }
    if (parts.length > 0) return parts.join('\n');
    return null;
  }
  return null;
}

interface IncomingMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function parseMessages(raw: unknown): IncomingMessage[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'messages অবশ্যই অ-খালি অ্যারে হতে হবে' };
  }
  if (raw.length > MAX_MESSAGES) {
    return { error: `messages সর্বোচ্চ ${MAX_MESSAGES}টি হতে পারে` };
  }
  const out: IncomingMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') return { error: 'messages-এর এন্ট্রি অবজেক্ট হতে হবে' };
    const role = (m as { role?: unknown }).role;
    const text = contentToText((m as { content?: unknown }).content);
    if (typeof text !== 'string') {
      return { error: 'message-এর content অবশ্যই স্ট্রিং (বা টেক্সট-অংশের অ্যারে) হতে হবে' };
    }
    if (text.length > MAX_CONTENT_CHARS) {
      return { error: `message-এর content সর্বোচ্চ ${MAX_CONTENT_CHARS} অক্ষর` };
    }
    if (role === 'system' || role === 'user' || role === 'assistant') {
      out.push({ role, content: text });
    } else {
      return { error: "message-এর role অবশ্যই 'system' | 'user' | 'assistant' হবে" };
    }
  }
  return out;
}

/** OpenAI-বার্তা → অ্যাপ-প্রোটোকল (system-গুলো প্রথম assistant-বার্তায় একত্র) */
function toLlmMessages(messages: IncomingMessage[]): LLMMessage[] {
  const systemParts = messages.filter(m => m.role === 'system').map(m => m.content);
  const rest = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  const head: LLMMessage[] =
    systemParts.length > 0 ? [{ role: 'assistant', content: systemParts.join('\n\n') }] : [];
  return [...head, ...rest];
}

export async function POST(req: Request) {
  // --- Bearer-যাচাই (প্ল্যাটফর্ম-কী বা মালিক-সেশন) ---
  const auth = await v1RequireBearer(req);
  if (!auth.ok) return auth.response ?? v1Error(401, 'অননুমোদিত', 'authentication_error');

  // --- লাইট রেট-লিমিট (৩০ অনুরোধ/মিনিট/টোকেন) ---
  const rl = checkRateLimit(`v1c:${auth.fingerprint ?? 'anon'}`, 30, 60_000);
  if (!rl.allowed) {
    return v1Error(429, `রেট-লিমিট — ${rl.retryAfterSec ?? 60} সেকেন্ড পরে আবার`, 'rate_limit_error');
  }

  // --- বডি-পার্স ---
  let body: any;
  try {
    body = await req.json();
  } catch {
    return v1Error(400, 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)', 'invalid_request_error');
  }

  // --- মডেল রাউটিং (সৎ allowlist) ---
  const catalogId = resolveV1Model(body?.model);
  if (catalogId === null) {
    return v1Error(
      404,
      `অজানা মডেল: '${String(body?.model ?? '')}' — প্রাপ্য মডেল: glm-4-plus (কী লাগে না), glm-5.3, glm-5.3-flash, glm-4-flash, glm-4-air, glm-plus-cn`,
      'invalid_request_error',
      'model_not_found'
    );
  }

  // --- এক্সটার্নাল-মডেল হলে কী-প্রাপ্যতা আগেই সৎ-যাচাই ---
  const entry = catalogId !== '' ? findChatModel(catalogId) : undefined;
  if (entry && entry.provider !== 'zai') {
    const key = await getProviderKey(entry.provider);
    if (!key) {
      return v1Error(
        400,
        `${PROVIDERS[entry.provider].label}: এই মডেলের জন্য API কী যোগ করা হয়নি — স্টুডিওর কী-ডায়ালগে (${PROVIDERS[entry.provider].label}) কী দিন, অথবা glm-4-plus (কী-বিহীন) ব্যবহার করুন`,
        'invalid_request_error'
      );
    }
  }

  // --- messages ---
  const parsed = parseMessages(body?.messages);
  if (parsed instanceof Array === false) {
    return v1Error(400, (parsed as { error: string }).error, 'invalid_request_error');
  }
  const llmMessages = toLlmMessages(parsed as IncomingMessage[]);
  if (llmMessages.length === 0) {
    return v1Error(400, 'কোনো বার্তা নেই', 'invalid_request_error');
  }

  // --- বাকি প্যারামিটার ---
  const stream = body?.stream === true;
  let maxTokens: number | undefined;
  if (body?.max_tokens != null) {
    const n = Number(body.max_tokens);
    if (!Number.isFinite(n) || n < 1) {
      return v1Error(400, 'max_tokens সঠিক নয়', 'invalid_request_error');
    }
    maxTokens = Math.min(8192, Math.floor(n));
  }
  // temperature গ্রহণযোগ্য — এক্সটার্নাল-পথ 0.7 নির্দিষ্ট ব্যবহার করে (নীরব উপেক্ষা)

  const completionId = `chatcmpl-${randomBytes(12).toString('hex')}`;
  const created = Math.floor(Date.now() / 1000);
  const requestedModel =
    typeof body?.model === 'string' && body.model.trim() !== '' ? body.model.trim() : 'glm-4-plus';

  // ---------------- স্ট্রিমিং ----------------
  if (stream) {
    const encoder = new TextEncoder();
    const sseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      ...V1_CORS_HEADERS,
    };

    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (payload: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        const chunkOf = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
          id: completionId,
          object: 'chat.completion.chunk',
          created,
          model: requestedModel,
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        });

        try {
          send(chunkOf({ role: 'assistant', content: '' }));
          let accumulated = '';
          const text = await chatComplete(llmMessages, {
            model: catalogId,
            skipCache: true,
            ...(maxTokens != null ? { maxTokens } : {}),
            onDelta: d => {
              accumulated += d;
              send(chunkOf({ content: d }));
            },
          });
          // ডেল্টা-পথ ব্যর্থ হলেও পুরো টেক্সট যেন না হারায় (নন-স্ট্রিম ফলব্যাক)
          const rest = text.startsWith(accumulated) ? text.slice(accumulated.length) : '';
          if (rest) send(chunkOf({ content: rest }));
          send(chunkOf({}, 'stop'));
          send('[DONE]');
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'অজানা ত্রুটি';
          send({ error: { message: msg.slice(0, 300), type: 'server_error' } });
          send('[DONE]');
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // ইতিমধ্যে বন্ধ
          }
        }
      },
    });

    return new Response(streamBody, { headers: sseHeaders });
  }

  // ---------------- নন-স্ট্রিমিং ----------------
  try {
    const text = await chatComplete(llmMessages, {
      model: catalogId,
      skipCache: true,
      ...(maxTokens != null ? { maxTokens } : {}),
    });
    if (!text || text.trim() === '') {
      return v1Error(502, 'ব্যাকএন্ড থেকে খালি উত্তর এসেছে — আবার চেষ্টা করুন', 'server_error');
    }
    return Response.json(
      {
        id: completionId,
        object: 'chat.completion',
        created,
        model: requestedModel,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
      },
      { headers: V1_CORS_HEADERS }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'অজানা ত্রুটি';
    return v1Error(502, msg.slice(0, 300), 'server_error');
  }
}
