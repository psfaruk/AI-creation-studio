// GET /api/productions/config-panel?type=&conversationId=
// Phase-4 C+D: চ্যাট-নেটিভ কনফিগারেশন প্যানেলের সার্ভার-মালিকানাধীন
// স্কিমা-চুক্তি। সব অপশন/সীমা capabilities.ts থেকে (একক সত্যের উৎস)।
// মিউজিক ভিডিও হলে কথোপকথনের আপলোড-করা গানের তালিকাও যায়
// (শুধু আইডি+নাম — কোনো URL/গোপন তথ্য নয়)।
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/limits';
import { buildConfigPanel } from '@/lib/agent/config-panel';
import type { ProductionType } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_TYPES: ProductionType[] = ['image', 'audio', 'motion_video', 'music_video', 'short_film'];

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`config-panel:${clientKey(req)}`, 30, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত অনুরোধ — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 30) } }
    );
  }

  const url = new URL(req.url);
  const typeParam = url.searchParams.get('type') ?? '';
  if (!VALID_TYPES.includes(typeParam as ProductionType)) {
    return NextResponse.json(
      { error: `অজানা প্রকার — হতে হবে: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    );
  }
  const type = typeParam as ProductionType;

  // কথোপকথনের আপলোড-করা অডিও (গান) — মিউজিক ভিডিওর উৎস-নির্বাচনে
  let songs: { id: string; fileName: string }[] = [];
  const conversationId = url.searchParams.get('conversationId');
  if (type === 'music_video' && conversationId) {
    const conv = await db.conversation.findUnique({ where: { id: conversationId } });
    if (conv) {
      const audios = await db.artifact.findMany({
        where: { conversationId, kind: 'audio', origin: 'user_upload' },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, fileName: true },
      });
      songs = audios.map(a => ({ id: a.id, fileName: a.fileName }));
    }
  }

  const panel = buildConfigPanel(type);
  return NextResponse.json({ ...panel, ...(type === 'music_video' ? { sourceOptions: { songs } } : {}) });
}
