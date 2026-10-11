// POST /api/productions/[id]/cancel — চলমান/অপেক্ষমাণ প্রোডাকশন বাতিল
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { toProductionView } from '@/lib/agent/production/serialize';
import { emitProduction } from '@/lib/agent/production/bus';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const production = await db.production.findUnique({ where: { id } });
  if (!production) {
    return NextResponse.json({ error: 'প্রোডাকশন খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }

  if (production.status === 'awaiting_confirmation' || production.status === 'queued') {
    const updated = await db.production.update({
      where: { id },
      data: { status: 'cancelled', finishedAt: new Date() },
      include: { steps: { orderBy: { seq: 'asc' } }, artifacts: { orderBy: { createdAt: 'asc' } } },
    });
    emitProduction(id, { type: 'production_finished', productionId: id, status: 'cancelled' });
    return NextResponse.json(toProductionView(updated, updated.steps, updated.artifacts));
  }

  if (production.status === 'running' || production.status === 'validating') {
    // runner ধাপের মাঝে দেখে নিজেই cancelled করবে
    await db.production.update({ where: { id }, data: { status: 'cancelling' } });
    return NextResponse.json({ ok: true, message: 'বাতিলের অনুরোধ নথিভুক্ত — চলছে' });
  }

  return NextResponse.json({ error: 'এই প্রোডাকশন আর বাতিলযোগ্য নয়' }, { status: 409 });
}
