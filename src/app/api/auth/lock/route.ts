// POST /api/auth/lock — মালিক-সেশন বন্ধ (সাইডবারের লক-বাটন)
//
// বৈধ সেশন লাগবে; সফল হলে কুকি মুছে যায় (Max-Age=0) → { ok: true }।
// টোকেন localStorage-এও থাকে — ক্লায়েন্ট সেটি নিজে সরিয়ে রিলোড করে।

import { NextResponse } from 'next/server';
import { SESSION_COOKIE, requireOwner } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    { ok: true },
    {
      headers: {
        'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
        'Cache-Control': 'no-store',
      },
    },
  );
}
