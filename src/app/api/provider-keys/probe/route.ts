// ============================================================
// POST /api/provider-keys/probe — কাস্টম/লোকাল এন্ডপয়েন্টের সংযোগ-পরীক্ষা।
//
//  { provider: 'custom', baseURL?, key?, model?, chatTest?: boolean }
//   - baseURL/key/model না দিলে সেভ-করা কনফিগ ব্যবহৃত হয়
//   - GET {baseURL}/models → এন্ডপয়েন্টে সার্ভ-হওয়া মডেলের তালিকা
//   - model দিলে (বা সেভ-কনফিগে থাকলে) এক-শব্দের প্রকৃত চ্যাট-কল
//
// উদ্দেশ্য: ডায়ালগে "মডেল-তালিকা আনুন / সংযোগ পরীক্ষা" — সেভ-এর
// আগেই ইউজার দেখতে পারে এন্ডপয়েন্ট সার্ভার থেকে পৌঁছানো যায় কি না,
// কী ঠিক কি না, আর কোন কোন মডেল-নাম পাওয়া যায়।
//
// নিরাপত্তা: মালিক-সেশন লাগে; পাঠানো কী শুধু এই কলে ব্যবহৃত হয়,
// কোথাও সংরক্ষিত হয় না (সেভ আলাদা POST /api/provider-keys)।
// ============================================================
import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireOwner } from '@/lib/security';
import { checkRateLimit } from '@/lib/limits';
import { getCustomConfig, isValidBaseURLShape } from '@/lib/agent/provider-keys';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** টেস্ট-কলের সময়সীমা */
const TEST_TIMEOUT_MS = 20_000;

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`keys-test:${clientKey(req)}`, 30, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত পরীক্ষা — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  if (body?.provider !== 'custom') {
    return NextResponse.json({ error: 'শুধু কাস্টম-প্রোভাইডারের সংযোগ-পরীক্ষা সমর্থিত' }, { status: 400 });
  }

  // ---- ইনপুট-মান → সেভ-কনফিগ ফলব্যাক ----
  const saved = await getCustomConfig();
  const baseURL =
    typeof body?.baseURL === 'string' && body.baseURL.trim() !== '' ? body.baseURL.trim() : saved?.baseURL ?? '';
  const key =
    typeof body?.key === 'string' && body.key.trim() !== '' ? body.key.trim() : saved?.key ?? null;
  const model =
    typeof body?.model === 'string' && body.model.trim() !== '' ? body.model.trim() : saved?.model ?? '';
  const wantChatTest = body?.chatTest !== false; // ডিফল্ট: chat-test চালানো হয়

  if (!baseURL || !isValidBaseURLShape(baseURL)) {
    return NextResponse.json(
      { error: 'আগে Base URL দিন — http:// বা https:// দিয়ে শুরু হওয়া সম্পূর্ণ URL (যেমন http://localhost:11434/v1)' },
      { status: 400 }
    );
  }

  const client = new OpenAI({
    apiKey: key ?? 'local-no-key',
    baseURL,
    timeout: TEST_TIMEOUT_MS,
    maxRetries: 0,
  });

  // ---- ১. মডেল-তালিকা (GET /models) ----
  let models: string[] = [];
  let modelsError: string | null = null;
  try {
    const list = await client.models.list();
    const ids: string[] = [];
    const page = list as unknown as { data?: Array<{ id?: unknown }> };
    if (Array.isArray(page.data)) {
      // OpenAI SDK v5+ — ModelsPage.data অ্যারে
      for (const m of page.data) {
        if (typeof m?.id === 'string' && m.id.trim() !== '') ids.push(m.id);
      }
    } else {
      // পুরনো/বিকল্প আকার — async-iterable বা সরাসরি অ্যারে
      const iterable = list as unknown as AsyncIterable<{ id?: unknown }> | Array<{ id?: unknown }>;
      if (Array.isArray(iterable)) {
        for (const m of iterable) {
          if (typeof m?.id === 'string' && m.id.trim() !== '') ids.push(m.id);
        }
      } else {
        for await (const m of iterable) {
          if (typeof m?.id === 'string' && m.id.trim() !== '') ids.push(m.id);
        }
      }
    }
    // স্থিতিশীল ক্রম — ডায়ালগে সার্চ সহজ
    ids.sort((a, b) => a.localeCompare(b));
    models = ids.slice(0, 300); // অতি-বড় তালিকা থেকে রক্ষা
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    modelsError = msg.slice(0, 200);
  }

  // ---- ২. প্রকৃত চ্যাট-কল পরীক্ষা (মডেল-নাম থাকলে) ----
  let chat: { ok: boolean; content: string | null; servedModel: string | null; ms: number; error: string | null } | null =
    null;
  if (wantChatTest && model) {
    const t0 = Date.now();
    try {
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
        stream: false,
        max_tokens: 16,
      } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
      const content = res?.choices?.[0]?.message?.content;
      chat = {
        ok: typeof content === 'string' && content.trim().length > 0,
        content: typeof content === 'string' ? content.slice(0, 80) : null,
        servedModel: res?.model ?? model,
        ms: Date.now() - t0,
        error: typeof content === 'string' && content.trim().length > 0 ? null : 'খালি উত্তর এসেছে',
      };
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status;
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        status === 404 || status === 400
          ? 'এই নামের মডেল পাওয়া যায়নি — তালিকা থেকে সঠিক নাম বেছে নিন'
          : status === 401 || status === 403
            ? 'কী অবৈধ বা অনুমতি নেই'
            : 'নেটওয়ার্ক/সংযোগ ব্যর্থ — এন্ডপয়েন্ট চালু ও ঠিকানা সঠিক কি না দেখুন';
      chat = { ok: false, content: null, servedModel: null, ms: Date.now() - t0, error: `${hint} — ${msg.slice(0, 140)}` };
    }
  }

  // models-endpoint না-চলা লোকাল সার্ভারেও (শুধু /chat/completions চালু) সৎ ফলাফল
  const reachable = modelsError === null || (chat?.ok ?? false);
  return NextResponse.json({
    ok: reachable,
    baseURL,
    modelCount: models.length,
    models,
    ...(modelsError ? { modelsError } : {}),
    ...(chat ? { chat } : {}),
  });
}
