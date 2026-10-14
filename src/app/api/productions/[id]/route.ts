// GET /api/productions/[id] — একটি প্রোডাকশনের পূর্ণ ভিউ (steps + artifacts)
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { db } from '@/lib/db';
import { toProductionView } from '@/lib/agent/production/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const production = await db.production.findUnique({
    where: { id },
    include: {
      steps: { orderBy: { seq: 'asc' } },
      artifacts: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!production) {
    return NextResponse.json({ error: 'প্রোডাকশন খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }
  const view = toProductionView(production, production.steps, production.artifacts);
  return NextResponse.json(view);
}
