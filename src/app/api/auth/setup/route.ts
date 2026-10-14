// POST /api/auth/setup — প্রথমবারের মালিক-পাসকোড সেটআপ
//   body: { passcode: string } (৮–২০০ অক্ষর)
//
// সফল → { ok: true, token, expiresAt } + studio_session কুকি (৩০ দিন)।
// ইতিমধ্যে আরম্ভ হলে (নিজে আগে বসানো বা STUDIO_OWNER_PASSCODE env) → 403।
// পাসকোডের আকৃতি ভুল হলে → 400 invalid_passcode।

import { NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  setupOwnerPasscode,
} from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE}`;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const rawPasscode =
    body && typeof body === 'object' ? (body as Record<string, unknown>).passcode : undefined;
  const passcode = typeof rawPasscode === 'string' ? rawPasscode : '';

  try {
    const session = await setupOwnerPasscode(passcode);
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
  } catch (err) {
    const code = err instanceof Error ? err.message : '';
    if (code === 'invalid_passcode') {
      return NextResponse.json(
        { error: 'পাসকোড কমপক্ষে ৮ ও সর্বোচ্চ ২০০ অক্ষরের হতে হবে', code: 'invalid_passcode' },
        { status: 400 },
      );
    }
    if (code === 'already_initialized') {
      return NextResponse.json(
        { error: 'স্টুডিও ইতিমধ্যেই নিরাপদ করা হয়েছে — পাসকোড দিয়ে আনলক করুন', code: 'already_initialized' },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: 'সেটআপ ব্যর্থ হয়েছে', code: 'setup_failed' },
      { status: 500 },
    );
  }
}
