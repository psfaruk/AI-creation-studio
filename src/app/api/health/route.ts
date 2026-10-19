// GET /api/health — Railway healthcheckPath (Phase 2)
//
// নিরীক্ষণ-রিপোর্ট (কোনো গোপন মান ছাড়া):
//   { status: 'ok'|'degraded'|'error', checks: { database, storage,
//     ffmpeg, env, providers }, uptimeSeconds, timestamp }
//
// স্ট্যাটাস-ম্যাপিং: ডেটাবেস অসম্পর্কিত → 503 (কনটেইনার অসুস্থ);
// storage/ffmpeg/env-সমস্যা → 200 + status:'degraded' (অ্যাপ চলছে,
// মিডিয়া-পাইপলাইন সীমিত হতে পারে — সৎ-লেবেল)।
//
// কখনোই অথেনটিকেটেড নয় — এটি রেফারেন্সে সস্তা (db-ping + ১-বাইট
// ফাইল-প্রোব + ৬০-সেকেন্ড-ক্যাশড ffmpeg-প্রোব)।

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { healthStatusCode, probeFfmpeg, probeStorageWritable, runHealthChecks } from '@/lib/health';
import { zAiConfigured } from '@/lib/providers/sandbox-detect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const report = await runHealthChecks({
    countFn: () => db.conversation.count(),
    probeFfmpeg,
    probeStorage: probeStorageWritable,
    zaiConfigured: zAiConfigured,
  });
  // P4-ডায়াগনস্টিক: কোন কমিট লাইভ তা সৎভাবে দেখায় (Railway GitHub-
  // ইন্টিগ্রেশন রানটাইমে RAILWAY_GIT_COMMIT_SHA দেয়; লোকাল/dev-এ null)।
  // কোনো গোপন মান নয় — পাবলিক কমিট-SHA মাত্র।
  return NextResponse.json(
    { ...report, gitSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null },
    {
      status: healthStatusCode(report),
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
