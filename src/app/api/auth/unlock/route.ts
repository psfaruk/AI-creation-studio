// POST /api/auth/unlock — মালিক-পাসকোড দিয়ে সেশন খোলা
//   body: { passcode: string }
//
// আইপি-ভিত্তিক রেট-লিমিট: ১৫ মিনিটে ৫টি ব্যর্থ চেষ্টার পর 429
// (retryAfterSec-সহ)। সফল হলে জানালা রিসেট + setup-এর মতোই
// { ok, token, expiresAt } + studio_session কুকি (৩০ দিন)।

import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  issueSession,
  registerUnlockFailure,
  resetUnlockLimit,
  unlockRateLimited,
  unlockRetryAfterSec,
  verifyOwnerPasscode,
} from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60) || 'local';
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}`;
}

export async function POST(req: Request) {
  const ip = clientIp(req);

  if (unlockRateLimited(ip)) {
    const retryAfterSec = unlockRetryAfterSec(ip);
    return NextResponse.json(
      {
        error: `অনেক বেশি ভুল চেষ্টা — ${retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন`,
        code: 'rate_limited',
        retryAfterSec,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec), 'Cache-Control': 'no-store' },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const rawPasscode =
    body && typeof body === 'object' ? (body as Record<string, unknown>).passcode : undefined;
  const passcode = typeof rawPasscode === 'string' ? rawPasscode : '';

  const ok = await verifyOwnerPasscode(passcode);
  if (!ok) {
    registerUnlockFailure(ip);
    return NextResponse.json(
      { error: 'ভুল পাসকোড', code: 'bad_passcode' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  resetUnlockLimit(ip);
  try {
    const session = issueSession();
    return NextResponse.json(
      {
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt.toISOString(),
      },
      {
        headers: {
          'Set-Cookie': sessionCookie(session.token),
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch {
    return NextResponse.json(
      { error: 'স্টুডিও এখনো নিরাপদ করা হয়নি — আগে সেটআপ করুন', code: 'not_initialized' },
      { status: 403 },
    );
  }
}
