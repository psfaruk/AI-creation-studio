// GET /api/productions — সব প্রোডাকশনের তালিকা (stale sweep সহ)
// POST /api/productions — S9: LLM ছাড়াই সরাসরি প্রোডাকশন-প্রস্তাব তৈরি
//   (চ্যাট-LLM রেট-লিমিটেড হলেও স্টুডিও থেকে মিউজিক ভিডিও/ফিল্ম চালু যায়)
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { db } from '@/lib/db';
import { sweepStaleProductions } from '@/lib/agent/production/runner';
import { toProductionSummary } from '@/lib/agent/production/serialize';
import { createProduction } from '@/lib/agent/production/create';
import { checkRateLimit, RATE_LIMITS, checkDailyProductionQuota } from '@/lib/limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  await sweepStaleProductions();
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 50, 1), 100);
  const conversationsParam = url.searchParams.get('conversationId');

  const where = conversationsParam ? { conversationId: conversationsParam } : undefined;
  const productions = await db.production.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { _count: { select: { artifacts: true } } },
  });
  const views = productions.map(p => toProductionSummary(p, (p as any)._count?.artifacts ?? 0));
  return NextResponse.json(views);
}

/**
 * POST /api/productions — সরাসরি তৈরি (S9)।
 * body: { spec: CreativeJobSpec-এর আদি রূপ, conversationId?: string }
 *
 * - conversationId না দিলে নতুন কথোপকথন তৈরি হয় (শিরোনাম spec থেকে)।
 * - দৈনিক কোটা + স্থানীয় রেট-লিমিট প্রযোজ্য।
 * - ফেরত: ProductionSummary (awaiting_confirmation অবস্থায়) + adjustments/notes।
 */
export async function POST(req: Request) {
  // --- মালিক-সেশন (P0 নিরাপত্তা) ---
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  // --- স্থানীয় রেট-লিমিট (§১১ নিরাপত্তা) ---
  const rl = checkRateLimit(`prod-create:${clientKey(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত তৈরির অনুরোধ — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 30) } }
    );
  }

  // --- দৈনিক কোটা ---
  const quota = await checkDailyProductionQuota();
  if (!quota.allowed) {
    return NextResponse.json(
      { error: `আজকের প্রোডাকশন-কোটা (${quota.limit}) শেষ — আগামীকাল আবার চালু হবে` },
      { status: 429 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const spec = body?.spec;
  if (!spec || typeof spec !== 'object') {
    return NextResponse.json({ error: 'spec অবজেক্ট প্রয়োজন (যেমন: {"type":"music_video","title":"…","idea":"…"})' }, { status: 400 });
  }

  // কথোপকথন রিজলভ / তৈরি
  let conversationId: string;
  if (typeof body?.conversationId === 'string' && body.conversationId) {
    const existing = await db.conversation.findUnique({ where: { id: body.conversationId } });
    if (!existing) {
      return NextResponse.json({ error: 'কথোপকথন খুঁজে পাওয়া যায়নি' }, { status: 404 });
    }
    conversationId = existing.id;
  } else {
    const flatTitle = String(spec.title ?? spec.idea ?? spec.story ?? 'স্টুডিও প্রোডাকশন')
      .replace(/\s+/g, ' ')
      .trim();
    const title = '🎬 ' + flatTitle.slice(0, 40) + (flatTitle.length > 40 ? '…' : '');
    const conversation = await db.conversation.create({ data: { title } });
    conversationId = conversation.id;
  }

  // শেয়ার্ড তৈরি-পথ (propose_job-এর সমান যুক্তি + অটো-ওয়্যার)
  const created = await createProduction(spec, conversationId);
  if (!created.ok) {
    return NextResponse.json(
      {
        error: `স্পেক যাচাই ব্যর্থ: ${created.errors.join('; ')}`,
        ...(created.alternatives?.length ? { alternatives: created.alternatives } : {}),
      },
      { status: 400 }
    );
  }

  const production = await db.production.findUniqueOrThrow({
    where: { id: created.productionId },
    include: { _count: { select: { artifacts: true } } },
  });
  return NextResponse.json({
    production: toProductionSummary(production, (production as any)._count?.artifacts ?? 0),
    adjustments: created.caps.adjustments,
    notes: created.caps.notes,
    steps: created.caps.plannedSteps.map(s => s.title),
    conversationId,
    quota: { used: quota.used + 1, limit: quota.limit },
  });
}
