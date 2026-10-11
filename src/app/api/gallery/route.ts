// GET /api/gallery — সব artifact-এর গ্যালারি তালিকা (kind-ফিল্টারসহ)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toArtifactMeta } from '@/lib/agent/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const kindParam = url.searchParams.get('kind');
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 120, 1), 300);

  const kinds = ['image', 'audio', 'video', 'text'].filter(k => k === kindParam);
  const where = kinds.length > 0 ? { kind: kinds[0] } : {};
  const artifacts = await db.artifact.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { conversation: { select: { title: true } } },
  });
  const views = artifacts.map(a => ({
    ...toArtifactMeta(a),
    createdAt: a.createdAt.toISOString(),
    conversationTitle: (a as any).conversation?.title ?? '',
    origin: a.origin,
  }));
  return NextResponse.json(views);
}
