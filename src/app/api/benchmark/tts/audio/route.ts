// GET /api/benchmark/tts/audio?run=<reportId>&file=<fileName>
// বেঞ্চমার্ক-রানের অডিও ফাইল (মানব-শ্রবণ পরীক্ষার জন্য)।
//
// নিরাপত্তা: run ও file উভয়ই কঠোর regex-যাচাইকৃত —
//   run  : /^ttsbn-[0-9]{8}-[0-9]{6}$/
//   file : /^[0-9]{2}-bn-[0-9]{3}\.(mp3|wav)$/
// এই প্যাটার্নে '/' বা '..' বসানো অসম্ভব — path traversal হতে পারে না।

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { benchmarkAudioDir } from '@/lib/agent/audio/tts-benchmark-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RUN_ID_RE = /^ttsbn-[0-9]{8}-[0-9]{6}$/;
const FILE_NAME_RE = /^[0-9]{2}-bn-[0-9]{3}\.(mp3|wav)$/;

export async function GET(req: NextRequest) {
  const run = req.nextUrl.searchParams.get('run') ?? '';
  const file = req.nextUrl.searchParams.get('file') ?? '';
  if (!RUN_ID_RE.test(run) || !FILE_NAME_RE.test(file)) {
    return NextResponse.json(
      { error: 'অনুরোধ অবৈধ — run অথবা file প্যারামিটার নির্ধারিত প্যাটার্নে মেলেনি।' },
      { status: 400 }
    );
  }
  const ext = file.endsWith('.wav') ? 'wav' : 'mp3';
  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(benchmarkAudioDir(run), file));
  } catch {
    return NextResponse.json({ error: 'অডিও ফাইলটি পাওয়া যায়নি — রানটি মুছে ফেলা হয়েছে বা ফাইলটি তৈরিই হয়নি।' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': ext === 'wav' ? 'audio/wav' : 'audio/mpeg',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
