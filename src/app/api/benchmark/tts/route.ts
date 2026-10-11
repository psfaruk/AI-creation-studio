// GET    /api/benchmark/tts — বেঞ্চমার্ক-অবস্থা (current + latest)
// POST   /api/benchmark/tts — নতুন রান শুরু {scope: 'quick'|'full'} (ডিফল্ট 'quick')
//                           → 202 {started, reportId} | 409 (রান চলমান) | 400 (অবৈধ scope)
// DELETE /api/benchmark/tts — চলমান রান বাতিলের অনুরোধ {requested}
//
// সততা: 'pass' কখনোই "যাচাইকৃত বাংলা উচ্চারণ" নয় — শুধু যন্ত্র-পরীক্ষা
// পাস; মানব-শ্রবণ পরীক্ষা বাধ্যতামূলক (রিপোর্টের honestNote-এ সর্বদা লেখা)।

import { NextRequest, NextResponse } from 'next/server';
import { cancelTtsBenchmark, getTtsBenchmarkState, startTtsBenchmark } from '@/lib/agent/audio/tts-benchmark-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const state = await getTtsBenchmarkState();
    return NextResponse.json(state);
  } catch (err: any) {
    return NextResponse.json(
      { error: `বেঞ্চমার্ক-অবস্থা পড়া যায়নি: ${String(err?.message ?? err).slice(0, 160)}` },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  // বডি ঐচ্ছিক — না থাকলে/খালি হলে 'quick'
  let scope: unknown = 'quick';
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && 'scope' in body) scope = (body as Record<string, unknown>).scope;
  } catch {
    // বডি নেই/পার্স-ব্যর্থ — ডিফল্টই থাক
  }
  if (scope !== 'quick' && scope !== 'full') {
    return NextResponse.json(
      { error: "scope অবৈধ — শুধুমাত্র 'quick' (৮ বাক্যের দ্রুত-প্রোব) বা 'full' (৬০ বাক্য) অনুমোদিত।" },
      { status: 400 }
    );
  }
  const started = startTtsBenchmark(scope);
  if (!started.started) {
    return NextResponse.json({ error: started.reason }, { status: 409 });
  }
  return NextResponse.json({ started: true, reportId: started.reportId }, { status: 202 });
}

export async function DELETE() {
  return NextResponse.json({ requested: cancelTtsBenchmark() });
}
