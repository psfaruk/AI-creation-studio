// POST /api/productions/[id]/revise — পূর্বের ফলাফলের সংশোধন-প্রস্তাব
// (মাস্টার প্ল্যান §১৬ Preview & Revision — revision চেইন)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateSpec } from '@/lib/agent/capabilities';
import { toProductionView } from '@/lib/agent/production/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const overrides = (body?.spec && typeof body.spec === 'object' ? body.spec : {}) as Record<string, unknown>;

  const parent = await db.production.findUnique({ where: { id } });
  if (!parent) {
    return NextResponse.json({ error: 'মূল প্রোডাকশন খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }

  let current: Record<string, unknown>;
  try {
    current = JSON.parse(parent.specJson);
  } catch {
    current = {};
  }
  const merged = { ...current, ...overrides, type: parent.type };

  const validation = validateSpec(merged);
  if (!validation.ok || !validation.validated) {
    return NextResponse.json(
      { error: 'সংশোধিত সেটিংস যাচাই ব্যর্থ', details: validation.errors },
      { status: 422 }
    );
  }

  const revision = await db.production.create({
    data: {
      conversationId: parent.conversationId,
      type: parent.type,
      title: `${parent.title} — সংশোধন`,
      status: 'awaiting_confirmation',
      specJson: JSON.stringify(validation.validated.spec),
      parentProductionId: parent.id,
    },
    include: { steps: { orderBy: { seq: 'asc' } }, artifacts: { orderBy: { createdAt: 'asc' } } },
  });

  return NextResponse.json(toProductionView(revision, revision.steps, revision.artifacts));
}
