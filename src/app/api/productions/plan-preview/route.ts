// POST /api/productions/plan-preview — Phase-5 §7: নিশ্চিতকরণের আগে
// সিনেম্যাটিক শট-পরিকল্পনার প্রিভিউ।
//
// নীতি:
//  - শূন্য-ব্যয়: কোনো প্রোভাইডার/LLM কল নেই — নির্ধারক পরিকল্পক + লোকাল
//    ffmpeg বিট-বিশ্লেষণ (আপলোড গানে, ক্যাশ-সহ)।
//  - একক সত্যের উৎস: পাইপলাইন যে ফাংশন ডাকে (planMusicVideo/
//    planShortFilmSkeleton) প্রিভিউও ঠিক সেটিই — প্রিভিউ/রান কখনো আলাদা হয় না।
//  - ক্লায়েন্ট-দাবি কখনো আস্থাভাজন নয়: spec আগে validateSpec-দিয়ে যাচাই
//    হয়, ওভাররাইড স্যানিটাইজ হয়, তারপর সার্ভারই পুরো পরিকল্পনা বানায়।
//  - সততা: বিট-উৎসের লেবেল (মাপা/গ্রিড-অনুমান/ফলব্যাক/নীরব), ডেলিভারি-
//    রায় (লোকাল-মোশন/প্রম্পট-নির্দেশিত/ডাউনগ্রেড), সীমা-নোট — সব সৎ।
import { NextResponse } from 'next/server';
import { writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { requireOwner } from '@/lib/security';
import { checkRateLimit } from '@/lib/limits';
import { db } from '@/lib/db';
import { validateSpec } from '@/lib/agent/capabilities';
import { readArtifactFile } from '@/lib/agent/storage';
import {
  buildMusicVideoPlanPreview,
  buildShortFilmPlanPreview,
} from '@/lib/agent/cinematic/preview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** স্পেক-অবজেক্টের সর্বোচ্চ আকার — JSON-স্ট্রিং হিসেবে (সীমাবদ্ধ ইনপুট) */
const MAX_SPEC_JSON = 20_000;

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

/**
 * ত্রুটি-বার্তা থেকে সার্ভারের ফাইল-সিস্টেম-পথ সরিয়ে '[ফাইল]'-এ বদলে দেয়
 * (নিরাপত্তা-গভীরতা)। ffprobe/ffmpeg-ব্যর্থতার বার্তায় টেম্প/স্টোরেজ-পথ
 * (যেমন /tmp/plan-preview-…wav) ঢুকে যায় — "কী ব্যর্থ হলো" তা সৎ থাকে,
 * কিন্তু অভ্যন্তরীণ পথ কখনো প্রতিক্রিয়ায় বাইরে যায় না।
 */
function sanitizeErrorMessage(raw: string): string {
  return raw
    .replace(
      // ১) টোকেনের মাঝে-থাকা পথ: 'input=/tmp/…', '…/home/…/storage/…' ইত্যাদি
      /[^\s'"`,;():]*\/(?:tmp|home|root|var|usr|etc|opt|srv|mnt|media|Users|private|storage)\b[^\s'"`,;():]*/g,
      '[ফাইল]'
    )
    .replace(
      // ২) স্পেস/কোট/ব্র্যাকেটের পরে শুরু হওয়া যেকোনো অ্যাবসোলিউট পথ-টোকেন
      //    (POSIX '/…' + Windows 'C:\…'); কোলোন-পরের বিবরণ ("x.wav: Invalid
      //    data") বজায় থাকে
      /(^|[\s'"`(])(?:\/[^\s'"`(),;:]+|[A-Za-z]:[\\/][^\s'"`(),;]+)/g,
      '$1[ফাইল]'
    )
    .slice(0, 200);
}

export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`plan-preview:${clientKey(req)}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত প্রিভিউ-অনুরোধ — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 30) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const spec = body?.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return NextResponse.json({ error: 'spec অবজেক্ট প্রয়োজন' }, { status: 400 });
  }
  try {
    if (JSON.stringify(spec).length > MAX_SPEC_JSON) {
      return NextResponse.json({ error: 'spec খুব বড়' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'spec পড়া যায়নি' }, { status: 400 });
  }
  const type = typeof spec?.type === 'string' ? spec.type : '';
  if (type !== 'music_video' && type !== 'short_film') {
    return NextResponse.json(
      { error: 'শট-পরিকল্পনার প্রিভিউ শুধু মিউজিক-ভিডিও ও শর্টফিল্মের জন্য' },
      { status: 400 }
    );
  }

  // §15-নিরাপত্তা: প্রিভিউও আসল validateSpec দিয়েই — অবৈধ স্পেক এখানেই
  // ধরা পড়ে (কনফার্ম-পথের সাথে একই আচরণ)
  const validation = validateSpec(spec);
  if (!validation.ok || !validation.validated) {
    return NextResponse.json(
      {
        error: 'সেটিংস যাচাই ব্যর্থ',
        // যাচাই-ত্রুটির বিবরণও পথ-মুক্ত (নিরাপত্তা-গভীরতা — REG-18j লক)
        details: validation.errors.map(sanitizeErrorMessage),
      },
      { status: 422 }
    );
  }
  const validSpec = validation.validated.spec;

  try {
    if (validSpec.type === 'music_video') {
      // আপলোড গান: কথোপকথনের মালিকানা + কেবল user_upload অডিও-আর্টিফ্যাক্ট —
      // (নিরাপত্তা) অন্য কথোপকথন/উৎসের আর্টিফ্যাক্ট পড়া যায় না
      let song: { id: string; storedAt: Date; file: string } | null = null;
      const conversationId =
        typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 64) : '';
      if (validSpec.songArtifactId && conversationId) {
        const conv = await db.conversation.findUnique({ where: { id: conversationId } });
        const art = conv
          ? await db.artifact.findUnique({ where: { id: validSpec.songArtifactId } })
          : null;
        if (
          art &&
          art.conversationId === conversationId &&
          art.kind === 'audio' &&
          art.origin === 'user_upload' &&
          art.storagePath
        ) {
          // স্টোরেজ-পাথ সরাসরি নয় — ফাইল পড়ে টেম্পে বসিয়ে বিশ্লেষণ (পাথ
          // বাইরে যায় না, মূল ফাইল অপরিবর্তিত থাকে)
          const tempFile = path.join(
            tmpdir(),
            `plan-preview-${art.id}-${Date.now()}${path.extname(art.fileName || '.bin')}`
          );
          try {
            const buf = await readArtifactFile(art.storagePath);
            await writeFile(tempFile, buf);
            song = { id: art.id, storedAt: art.createdAt, file: tempFile };
          } catch {
            song = null; // পড়া ব্যর্থ → সৎ ফলব্যাক: গান ছাড়া পরিকল্পনা
          }
        }
      }
      try {
        const preview = await buildMusicVideoPlanPreview({ spec: validSpec, song });
        return NextResponse.json({ ...preview });
      } finally {
        if (song) {
          await rm(song.file, { force: true }).catch(() => undefined);
        }
      }
    }

    // short_film — কাঠামোগত কঙ্কাল (সৎ লেবেলসহ)
    const preview = buildShortFilmPlanPreview({ spec: validSpec });
    return NextResponse.json({ ...preview });
  } catch (err) {
    // বিশ্লেষণ-ব্যর্থতা ইত্যাদি — সৎ ত্রুটি, কোনো গোপন-টেক্সট নয়।
    // ভেতরের ত্রুটি-বার্তায় সার্ভার-পথ থাকতে পারে — স্যানিটাইজ করে কেবল
    // "কী ব্যর্থ হলো" তা-ই বাইরে যায় (REG-18j লক)
    const msg = err instanceof Error ? err.message : 'অজানা ত্রুটি';
    return NextResponse.json({ error: sanitizeErrorMessage(msg) }, { status: 422 });
  }
}
