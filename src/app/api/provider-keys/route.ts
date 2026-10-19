// ============================================================
// /api/provider-keys — এক্সটার্নাল প্রোভাইডারের API-কী + Base URL ব্যবস্থাপনা।
//
//  GET    → সব এক্সটার্নাল প্রোভাইডারের কী-অবস্থা (মাস্কড — raw কী কখনোই নয়)
//  POST   → { provider, key?, baseURL?, model? } — কী/Base URL/মডেল-নাম সংরক্ষণ
//           • GLM-প্রোভাইডার (zai-api/glm): key (বা বিদ্যমান কী) + baseURL?
//           • custom: baseURL + model বাধ্যতামূলক, key ঐচ্ছিক
//  DELETE → ?provider=glm — এন্ট্রি মুছে ফেলা (কী + Base URL + মডেল-নাম)
//
// সততা ও নিরাপত্তা:
//  - কী শুধু স্থানীয় ফাইলে থাকে (.gitignore-সুরক্ষিত, GitHub-এ যায় না)
//  - উত্তরে কেবল মাস্কড প্রিভিউ (sk-a1…b2c); Base URL ও মডেল-নাম গোপন নয় —
//    স্বাভাবিকভাবে ফেরে (ইউজার নিজেই যা লিখেছেন)
//  - শিথল আকৃতি-যাচাই: GLM-কী ৮–৫০০ অক্ষর সাদাস্থান-বিহীন;
//    custom-কী ১–৫০০ অক্ষর; Base URL বৈধ http(s) URL; মডেল-নাম ১–২০০ অক্ষর
//  - লাইট রেট-লিমিট: ২০ লেখা/ঘণ্টা (আইপি-ভিত্তিক)
// ============================================================
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { checkRateLimit } from '@/lib/limits';
import {
  clearProviderKey,
  isValidApiKeyShape,
  isValidBaseURLShape,
  isValidCustomKeyShape,
  isValidCustomModelShape,
  providerKeyStatuses,
  setCustomConfig,
  setProviderBaseURL,
  setProviderKey,
} from '@/lib/agent/provider-keys';
import { PROVIDERS, isExternalProvider, type ChatProviderId } from '@/lib/agent/chat-models';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

function parseProvider(raw: unknown): ChatProviderId | null {
  if (typeof raw !== 'string' || !(raw in PROVIDERS)) return null;
  const p = raw as ChatProviderId;
  return isExternalProvider(p) ? p : null;
}

/** GET → মাস্কড কী-অবস্থা + Base URL তথ্য */
export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const statuses = await providerKeyStatuses();
  return NextResponse.json({ providers: statuses });
}

/** POST → কী/Base URL/মডেল-নাম সংরক্ষণ */
export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`keys:${clientKey(req)}`, 20, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত কী-পরিবর্তন — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }

  const provider = parseProvider(body?.provider);
  if (!provider) {
    return NextResponse.json({ error: 'অজানা এক্সটার্নাল প্রোভাইডার' }, { status: 400 });
  }

  // ================= custom-প্রোভাইডারের নিজস্ব পথ =================
  // { baseURL, model, key? } — baseURL ও model বাধ্যতামূলক, key ঐচ্ছিক
  if (provider === 'custom') {
    const baseURL = typeof body?.baseURL === 'string' ? body.baseURL.trim() : '';
    const model = typeof body?.model === 'string' ? body.model.trim() : '';
    const key = typeof body?.key === 'string' ? body.key.trim() : '';

    if (!baseURL || !isValidBaseURLShape(baseURL)) {
      return NextResponse.json(
        { error: 'Base URL সঠিক নয় — http:// বা https:// দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন (যেমন http://localhost:11434/v1)' },
        { status: 400 }
      );
    }
    if (!model || !isValidCustomModelShape(model)) {
      return NextResponse.json(
        { error: 'মডেলের নাম দিন (যেমন llama3.2, qwen2.5:7b) — এন্ডপয়েন্টে যে নামে মডেল সার্ভ হয়' },
        { status: 400 }
      );
    }
    if (key !== '' && !isValidCustomKeyShape(key)) {
      return NextResponse.json(
        { error: 'API কী-র আকৃতি সঠিক নয় (১–৫০০ অক্ষর, ভেতরে সাদাস্থান নয়) — লোকাল সার্ভারে কী না লাগলে খালি রাখুন' },
        { status: 400 }
      );
    }

    try {
      await setCustomConfig({ baseURL, model, key: key !== '' ? key : null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'সংরক্ষণ ব্যর্থ';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    const statuses = await providerKeyStatuses();
    return NextResponse.json({ ok: true, providers: statuses });
  }

  // ================= GLM-প্রোভাইডারের পথ (আগের মতোই) =================

  // ---- কী (ঐচ্ছিক — শুধু Base URL বদলাতে চাইলে কী-সহ পুনঃপাঠ লাগে না) ----
  const hasKey = typeof body?.key === 'string' && body.key.trim() !== '';
  if (body?.key != null && !hasKey) {
    return NextResponse.json({ error: 'কী-এর মান খালি — কী বদলাতে চাইলে পুরো কীটি দিন' }, { status: 400 });
  }
  if (hasKey && !isValidApiKeyShape(body.key)) {
    return NextResponse.json(
      { error: 'কী-এর আকৃতি সঠিক নয় — ৮–৫০০ অক্ষরের, ভেতরে সাদাস্থান-বিহীন মান দিন' },
      { status: 400 }
    );
  }
  // ---- Base URL (ঐচ্ছিক — ''/null = ডিফল্টে ফেরানো) ----
  const hasBaseURL = body?.baseURL !== undefined;
  let baseURLValue: string | null = null;
  if (hasBaseURL) {
    if (body.baseURL === null) {
      baseURLValue = null;
    } else if (typeof body.baseURL === 'string') {
      const t = body.baseURL.trim();
      baseURLValue = t === '' ? null : t;
      if (baseURLValue !== null && !isValidBaseURLShape(baseURLValue)) {
        return NextResponse.json(
          { error: 'Base URL সঠিক নয় — http:// বা https:// দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন (যেমন https://api.z.ai/api/paas/v4)' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json({ error: 'baseURL মান সঠিক নয় (স্ট্রিং বা null হতে হবে)' }, { status: 400 });
    }
  }

  if (!hasKey && !hasBaseURL) {
    return NextResponse.json({ error: 'কী বা Base URL — অন্তত একটি পাঠান' }, { status: 400 });
  }

  try {
    if (hasKey) {
      // কী-সহ সেভ — baseURL পাঠালে একসাথে বসে (না পাঠালে পুরনো ওভাররাইড অক্ষত)
      await setProviderKey(provider, body.key as string, hasBaseURL ? baseURLValue : undefined);
    } else if (hasBaseURL) {
      // শুধু Base URL আপডেট — বিদ্যমান কী অক্ষত থাকে (কী না থাকলে no-op)
      await setProviderBaseURL(provider, baseURLValue);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'সংরক্ষণ ব্যর্থ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const statuses = await providerKeyStatuses();
  return NextResponse.json({ ok: true, providers: statuses });
}

/** DELETE → এন্ট্রি মুছে ফেলা (কী + Base URL-ওভাররাইড) */
export async function DELETE(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`keys:${clientKey(req)}`, 20, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'অনেক দ্রুত অনুরোধ — কিছুক্ষণ পরে চেষ্টা করুন' }, { status: 429 });
  }

  const url = new URL(req.url);
  const provider = parseProvider(url.searchParams.get('provider'));
  if (!provider) {
    return NextResponse.json({ error: 'অজানা এক্সটার্নাল প্রোভাইডার' }, { status: 400 });
  }

  try {
    await clearProviderKey(provider);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'মুছে ফেলা ব্যর্থ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const statuses = await providerKeyStatuses();
  return NextResponse.json({ ok: true, providers: statuses });
}
