// GET /api/system — §৯.১ + §১৩: হার্ডওয়্যার প্রতিবেদন + টুল-স্বাস্থ্য
// POST /api/system — স্বাস্থ্য-চেক জোর করে পুনরায় চালাও (ব্যয়সীমিত মাইক্রো-চেক)

import { NextRequest, NextResponse } from 'next/server';
import { measureHardware, runToolHealthChecks } from '@/lib/system-info';
import { ttsCacheStats } from '@/lib/agent/tts-cache';
import { llmCacheStats } from '@/lib/agent/llm';
import { coordinatorStatus } from '@/lib/agent/rate-limit-coordinator';
import { checkRateLimit, RATE_LIMITS } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientKey(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

export async function GET() {
  try {
    const [hardware, tools] = await Promise.all([measureHardware(), runToolHealthChecks()]);
    return NextResponse.json({
      hardware,
      tools,
      // §১১: TTS ডিস্ক-ক্যাশ/ডিডুপ-পরিসংখ্যান (hits=ক্যাশ-থেকে, misses=প্রকৃত API-কল)
      ttsCache: ttsCacheStats(),
      // S9: LLM-উত্তরের ডিস্ক-ক্যাশ পরিসংখ্যান
      llmCache: llmCacheStats(),
      // S9: রেট-লিমিট-কোঅর্ডিনেটরের সৎ-স্ট্যাটাস (কোন চ্যানেল কতক্ষণ ব্লকড)
      rateLimits: coordinatorStatus(),
      checkedAt: new Date().toISOString(),
      note: 'স্বাস্থ্য-চেক আসল মাইক্রো-কল দিয়ে (LLM/TTS) — ব্যয়বহুল মডেল (ছবি/ভিডিও) রেজিস্ট্রি-স্ট্যাটাস থেকে।',
    });
  } catch (err: any) {
    return NextResponse.json({ error: `সিস্টেম-প্রতিবেদন ব্যর্থ: ${String(err?.message ?? err).slice(0, 200)}` }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rl = checkRateLimit(`system-check:${clientKey(req)}`, RATE_LIMITS.systemCheck.limit, RATE_LIMITS.systemCheck.windowMs);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `অনেক স্বাস্থ্য-চেক চলছে — ${rl.retryAfterSec ?? 60} সেকেন্ড পরে আবার চেষ্টা করুন।` },
        { status: 429 }
      );
    }
    const [hardware, tools] = await Promise.all([measureHardware(), runToolHealthChecks({ force: true })]);
    return NextResponse.json({ hardware, tools, checkedAt: new Date().toISOString(), forced: true });
  } catch (err: any) {
    return NextResponse.json({ error: `স্বাস্থ্য-চেক ব্যর্থ: ${String(err?.message ?? err).slice(0, 200)}` }, { status: 500 });
  }
}
