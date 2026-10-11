// GET /api/productions — সব প্রোডাকশনের তালিকা (stale sweep সহ)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sweepStaleProductions } from '@/lib/agent/production/runner';
import { toProductionSummary } from '@/lib/agent/production/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
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
