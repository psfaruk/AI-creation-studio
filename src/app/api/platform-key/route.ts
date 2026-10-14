// ============================================================
// /api/platform-key — অ্যাপের নিজস্ব /api/v1-এর Bearer-কী ব্যবস্থাপনা।
//
//  GET    → { hasKey, masked, createdAt } (?reveal=1 হলে raw কী —
//           মালিক নিজেই; অন্য ক্লায়েন্টে বসানোর জন্য)
//  POST   → কী তৈরি/ঘুরিয়ে (rotate) — নতুন raw কী একবার ফেরে
//  DELETE → কী রিভোক — /api/v1 তখন শুধু মালিক-সেশনে চলবে
//
// নিরাপত্তা: সব হ্যান্ডেল requireOwner-র পেছনে; কী
// storage/platform-key.json-এ (.gitignore-সুরক্ষিত, 0600)।
// ============================================================
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { checkRateLimit } from '@/lib/limits';
import {
  ensurePlatformKey,
  getPlatformKeyRecord,
  maskPlatformKey,
  revokePlatformKey,
  rotatePlatformKey,
} from '@/lib/platform/platform-key';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

/** GET → কী-অবস্থা (মাস্কড; ?reveal=1 হলে raw — মালিকের নিজের কপির জন্য) */
export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const record = await getPlatformKeyRecord();
  if (!record) {
    return NextResponse.json({ hasKey: false, masked: null, createdAt: null });
  }
  const reveal = new URL(req.url).searchParams.get('reveal') === '1';
  return NextResponse.json({
    hasKey: true,
    masked: maskPlatformKey(record.key),
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
    ...(reveal ? { key: record.key } : {}),
  });
}

/** POST → তৈরি (না থাকলে) বা ঘুরিয়ে নতুন কী — raw একবার ফেরে */
export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`pkey:${clientKey(req)}`, 10, 60 * 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত কী-পরিবর্তন — ${rl.retryAfterSec} সেকেন্ড পরে আবার` },
      { status: 429 }
    );
  }

  const existing = await getPlatformKeyRecord();
  const record = existing ? await rotatePlatformKey() : await ensurePlatformKey();
  return NextResponse.json({
    ok: true,
    key: record.key,
    createdAt: record.createdAt,
    rotatedAt: record.rotatedAt,
    message: existing
      ? 'নতুন কী ইস্যু হয়েছে — পুরনো কীটি আর কাজ করবে না; ক্লায়েন্টে নতুন কীটি বসান'
      : 'কী তৈরি হয়েছে — ক্লায়েন্টে বসিয়ে নিন',
  });
}

/** DELETE → কী রিভোক */
export async function DELETE(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  await revokePlatformKey();
  return NextResponse.json({ ok: true });
}
