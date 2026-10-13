// ============================================================
// PATCH  /api/custom-providers/[id] → প্ল্যাটফর্ম সম্পাদনা
//          { name?, language?, apiKey?, models?: string[] }
// DELETE /api/custom-providers/[id] → প্ল্যাটফর্ম সরানো
//
// apiKey খালি-স্ট্রিং হলে কী অপরিবর্তিত থাকে।
// ============================================================
import { NextResponse } from 'next/server';
import { removeCustomProvider, updateCustomProvider } from '@/lib/agent/custom-providers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const result = await updateCustomProvider(id, {
    name: b.name,
    language: b.language,
    apiKey: b.apiKey,
    models: b.models,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ provider: result.provider });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const removed = await removeCustomProvider(id);
  if (!removed) {
    return NextResponse.json({ error: 'প্ল্যাটফর্মটি খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
