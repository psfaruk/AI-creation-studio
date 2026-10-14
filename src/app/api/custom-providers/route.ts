// ============================================================
// GET  /api/custom-providers → সংরক্ষিত কাস্টম API-প্ল্যাটফর্মের তালিকা
//                              (কী সবসময় মাস্কড)
// POST /api/custom-providers → নতুন প্ল্যাটফর্ম যোগ
//        { name?, baseUrl, apiKey, language?, models: string[] }
//
// কাস্টম-প্ল্যাটফর্ম = ব্যবহারকারীর নিজের OpenAI-কম্প্যাটিবল সিস্টেম
// (Base URL + API Key + মডেল-নির্বাচন + ভাষা)। মডেল-তালিকা আগে
// POST /api/custom-providers/probe দিয়ে লাইভ আনতে হয় — সেখান থেকে
// পছন্দের মডেলগুলো এখানে models-অ্যারেতে পাঠানো হয়।
// ============================================================
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { addCustomProvider, listCustomProviders } from '@/lib/agent/custom-providers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const providers = await listCustomProviders();
  return NextResponse.json({ providers });
}

export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const result = await addCustomProvider({
    name: b.name,
    baseUrl: b.baseUrl,
    apiKey: b.apiKey,
    language: b.language,
    models: b.models,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    provider: result.provider,
    ...('warning' in result && result.warning ? { warning: result.warning } : {}),
  });
}
