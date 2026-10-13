// ============================================================
// /api/keys — কী-ব্যবস্থাপনা (মালিকানাধীন কনসোল; UI থেকে ডাকা)
//  GET  — তালিকা (মাস্কড + পরিসংখ্যানসহ)
//  POST — তৈরি { name, modelId, rateLimitPerMin?, defaultLanguage? }
//         → পূর্ণ কী একবারই ফেরে
// ============================================================

import { NextResponse } from 'next/server';
import { createApiKey, listApiKeys, platformModelOptions } from '@/lib/platform/api-keys';
import { readPlatformVerification } from '@/lib/platform/platform-models';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const [keys, verifications] = await Promise.all([listApiKeys(), readPlatformVerification()]);
    return NextResponse.json({
      keys,
      models: platformModelOptions().map(m => ({
        ...m,
        verification: verifications[m.id] ?? null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'কী-তালিকা পড়া যায়নি' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'অনুরোধ-বডি বৈধ JSON নয়' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name : '';
  const modelId = typeof body.modelId === 'string' ? body.modelId : '';
  const rateLimitPerMin = typeof body.rateLimitPerMin === 'number' ? body.rateLimitPerMin : undefined;
  const defaultLanguage =
    body.defaultLanguage === 'bn' || body.defaultLanguage === 'en' || body.defaultLanguage === 'auto'
      ? body.defaultLanguage
      : undefined;

  if (!name.trim()) {
    return NextResponse.json({ error: 'কী-এর নাম দিন' }, { status: 400 });
  }
  try {
    const created = await createApiKey({ name, modelId, rateLimitPerMin, defaultLanguage });
    return NextResponse.json({
      ...created,
      note: 'পূর্ণ কী এখনই একবার দেখানো হয়েছে — কপি করে রাখুন; সার্ভারে কেবল SHA-256 হ্যাশ থাকে',
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'কী তৈরি যায়নি' },
      { status: 400 }
    );
  }
}
