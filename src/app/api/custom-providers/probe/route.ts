// ============================================================
// POST /api/custom-providers/probe → প্ল্যাটফর্মের আসল GET /models-এ
// Bearer কী-সহ লাইভ ডাক (কিছু সংরক্ষণ করে না)।
//
//  body: { baseUrl, apiKey }  →  { ok, models: string[], host?, ms?, error? }
//
// যোগ-ডায়ালগের "মডেল তালিকা আনুন" বাটন এটি ব্যবহার করে — কী
// ব্রাউজারে থাকে, সার্ভার কেবল একবার প্রোব করে ফলাফল ফেরায়।
// প্ল্যাটফর্মে /models না থাকলে সৎ ত্রুটি — তখন মডেল-নাম হাতে
// লিখে যোগ করা যায় (ডায়ালগে ঘর আছে)।
// ============================================================
import { NextResponse } from 'next/server';
import { probeProviderModels } from '@/lib/agent/custom-providers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.baseUrl !== 'string' || typeof b.apiKey !== 'string') {
    return NextResponse.json({ error: 'baseUrl ও apiKey দুটোই লাগবে' }, { status: 400 });
  }
  const result = await probeProviderModels(b.baseUrl, b.apiKey);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
