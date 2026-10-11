// GET /api/artifacts/[id] → ArtifactMeta
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toArtifactMeta } from '@/lib/agent/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = await db.artifact.findUnique({ where: { id } });
  if (!artifact) {
    return NextResponse.json({ error: 'Artifact খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }
  return NextResponse.json(toArtifactMeta(artifact));
}
