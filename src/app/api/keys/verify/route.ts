// ============================================================
// POST /api/keys/verify — প্ল্যাটফর্ম-মডেলের লাইভ-যাচাই
//
// "This platform only lists models verified with live API calls
//  — no fake labels." — এই এন্ডপয়েন্ট সেই যাচাইটাই চালায়:
// প্রতিটি মডেলে ছোট প্রকৃত কল দিয়ে served-model নিশ্চিত করে ও
// storage/platform-verification.json-এ ফলাফল জমায়।
//
// বডি: { model?: 'glm-4-plus' | 'glm-5v-turbo' | 'cogview-3' }
//  - model দিলে শুধু সেটি; না দিলে chat+vision (images ~৬৬সে.
//    ধীরগতির বলে স্বয়ংক্রিয় সেটে নেই — আলাদা করে ডাকুন)।
// ============================================================

import { NextResponse } from 'next/server';
import { getZAI } from '@/lib/agent/llm';
import {
  writePlatformVerificationEntry,
  type PlatformVerificationEntry,
} from '@/lib/platform/platform-models';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function verifyChat(): Promise<PlatformVerificationEntry> {
  const t0 = Date.now();
  try {
    const zai = await getZAI();
    const res = (await zai.chat.completions.create({
      model: 'glm-4-plus',
      messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
      thinking: { type: 'disabled' },
    })) as Record<string, unknown>;
    const content = (
      (res?.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
        | Record<string, unknown>
        | undefined
    )?.content;
    const ok = typeof content === 'string' && content.trim().length > 0;
    return {
      ok,
      servedModel: (res?.model as string) ?? 'glm-4-plus',
      ms: Date.now() - t0,
      ...(ok ? {} : { error: 'খালি উত্তর' }),
      testedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return makeErr(msg, t0);
  }
}

async function verifyVision(): Promise<PlatformVerificationEntry> {
  const t0 = Date.now();
  try {
    const zai = await getZAI();
    const res = (await zai.chat.completions.createVision({
      model: 'glm-5v-turbo',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'One word: what color is this image?' },
            { type: 'image_url', image_url: { url: PNG_1PX } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    })) as Record<string, unknown>;
    const content = (
      (res?.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as
        | Record<string, unknown>
        | undefined
    )?.content;
    const ok = typeof content === 'string' && content.trim().length > 0;
    return {
      ok,
      servedModel: (res?.model as string) ?? 'glm-5v-turbo',
      ms: Date.now() - t0,
      ...(ok ? {} : { error: 'খালি উত্তর' }),
      testedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return makeErr(msg, t0);
  }
}

async function verifyImage(): Promise<PlatformVerificationEntry> {
  const t0 = Date.now();
  try {
    const zai = await getZAI();
    const res = await zai.images.generations.create({
      model: 'cogview-3',
      prompt: 'a small red circle on white background',
      size: '1024x1024',
    });
    const b64 = res?.data?.[0]?.base64;
    const ok = typeof b64 === 'string' && b64.length > 1000;
    return {
      ok,
      servedModel: 'cogview-3',
      ms: Date.now() - t0,
      ...(ok ? {} : { error: 'খালি/অসম্পূর্ণ ছবি' }),
      testedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return makeErr(msg, t0);
  }
}

function makeErr(msg: string, t0: number): PlatformVerificationEntry {
  const rateLimited = /\b429\b|too many requests/i.test(msg);
  return {
    ok: false,
    rateLimited,
    ...(rateLimited
      ? { error: 'রেট-লিমিট (৪২৯) — সাময়িক; কিছুক্ষণ পরে আবার যাচাই করুন' }
      : { error: msg.slice(0, 200) }),
    ms: Date.now() - t0,
    testedAt: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // বডি ছাড়াও চলবে — ডিফল্ট সেট
  }
  const target = typeof body.model === 'string' ? body.model : '';

  const results: Record<string, PlatformVerificationEntry> = {};
  // ছবি-যাচাই (~৬০-৯০ সে.) ধীর বলে কেবল স্পষ্টভাবে চাইলেই চলে
  if (target === 'cogview-3') {
    results['cogview-3'] = await verifyImage();
  }
  if (target === 'glm-4-plus' || target === '') {
    results['glm-4-plus'] = await verifyChat();
  }
  if (target === 'glm-5v-turbo' || target === '') {
    // চ্যাট-যাচাইয়ের পর সামান্য বিরতি — শেয়ার্ড পাইপে ৪২৯ এড়াতে
    if (results['glm-4-plus']) await new Promise(r => setTimeout(r, 3000));
    results['glm-5v-turbo'] = await verifyVision();
  }

  for (const [id, entry] of Object.entries(results)) {
    await writePlatformVerificationEntry(id, entry);
  }

  if (Object.keys(results).length === 0) {
    return NextResponse.json(
      { error: 'অজানা মডেল — glm-4-plus | glm-5v-turbo | cogview-3' },
      { status: 400 }
    );
  }

  return NextResponse.json({ results });
}
