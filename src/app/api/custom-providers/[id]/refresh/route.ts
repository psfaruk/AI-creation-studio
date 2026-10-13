// ============================================================
// POST /api/custom-providers/[id]/refresh → সংরক্ষিত কী দিয়ে
// প্ল্যাটফর্মের GET /models-এ আবার লাইভ ডাক (কার্ড UI-র "রিফ্রেশ")।
//
// কী সার্ভারেই থাকে — ব্রাউজারে কখনোই ফেরে না। ফলাফল:
//   { ok, models: string[], host?, ms?, error? }
// (কিছু সংরক্ষণ করে না — সম্পাদনা-ডায়ালগে ব্যবহারকারী বেছে PATCH করে)
// ============================================================
import { NextResponse } from 'next/server';
import { listCustomProviders, probeProviderModels } from '@/lib/agent/custom-providers';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STORE_PATH = path.join(process.cwd(), 'storage', 'custom-providers.json');

type Ctx = { params: Promise<{ id: string }> };

/** আইডি দিয়ে সংরক্ষিত baseUrl+কী খোঁজা (কী বাইরে যায় না) */
async function getStored(id: string): Promise<{ baseUrl: string; apiKey: string } | null> {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const arr = JSON.parse(raw) as Array<{ id: string; baseUrl: string; apiKey: string }>;
    const hit = arr.find(p => p?.id === id && typeof p.baseUrl === 'string' && typeof p.apiKey === 'string');
    return hit ? { baseUrl: hit.baseUrl, apiKey: hit.apiKey } : null;
  } catch {
    return null;
  }
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  // আগে নিশ্চিত হই আইডিটি সত্যিই তালিকায় আছে (404-সৎতা)
  const providers = await listCustomProviders();
  if (!providers.some(p => p.id === id)) {
    return NextResponse.json({ ok: false, models: [], error: 'প্ল্যাটফর্মটি খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }
  const stored = await getStored(id);
  if (!stored) {
    return NextResponse.json({ ok: false, models: [], error: 'সংরক্ষিত কনফিগ পড়া যায়নি' }, { status: 500 });
  }
  const result = await probeProviderModels(stored.baseUrl, stored.apiKey);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
