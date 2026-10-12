// ============================================================
// /api/provider-keys — এক্সটার্নাল প্রোভাইডারের API-কী ব্যবস্থাপনা।
//
//  GET    → সব এক্সটার্নাল প্রোভাইডারের কী-অবস্থা (মাস্কড — raw কী কখনোই নয়)
//  POST   → { provider, key } — কী সংরক্ষণ (storage/provider-keys.json, 0600)
//  DELETE → ?provider=deepseek — কী মুছে ফেলা
//
// সততা ও নিরাপত্তা:
//  - কী শুধু স্থানীয় ফাইলে থাকে (.gitignore-সুরক্ষিত, GitHub-এ যায় না)
//  - উত্তরে কেবল মাস্কড প্রিভিউ (sk-a1…b2c)
//  - শিথল আকৃতি-যাচাই (৮–৫০০ অক্ষর, ভেতরে সাদাস্থান নয়)
//  - লাইট রেট-লিমিট: ২০ লেখা/ঘণ্টা (আইপি-ভিত্তিক)
// ============================================================
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/limits';
import {
  clearProviderKey,
  isValidApiKeyShape,
  providerKeyStatuses,
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

/** GET → মাস্কড কী-অবস্থা */
export async function GET() {
  const statuses = await providerKeyStatuses();
  return NextResponse.json({ providers: statuses });
}

/** POST → কী সংরক্ষণ */
export async function POST(req: Request) {
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
  if (!isValidApiKeyShape(body?.key)) {
    return NextResponse.json(
      { error: 'কী-এর আকৃতি সঠিক নয় — ৮–৫০০ অক্ষরের, ভেতরে সাদাস্থান-বিহীন মান দিন' },
      { status: 400 }
    );
  }

  try {
    await setProviderKey(provider, body.key as string);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'কী সংরক্ষণ ব্যর্থ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const statuses = await providerKeyStatuses();
  return NextResponse.json({ ok: true, providers: statuses });
}

/** DELETE → কী মুছে ফেলা */
export async function DELETE(req: Request) {
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
    const msg = err instanceof Error ? err.message : 'কী মুছে ফেলা ব্যর্থ';
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const statuses = await providerKeyStatuses();
  return NextResponse.json({ ok: true, providers: statuses });
}
