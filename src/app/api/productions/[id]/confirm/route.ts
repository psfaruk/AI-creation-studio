// POST /api/productions/[id]/confirm — ব্যবহারকারীর নিশ্চিতকরণ
// (ঐচ্ছিক spec-ওভাররাইড মার্জ করে পুনঃযাচাই → queued → চালু)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateSpec } from '@/lib/agent/capabilities';
import { startProduction } from '@/lib/agent/production/runner';
import { toProductionView } from '@/lib/agent/production/serialize';
import { checkRateLimit, checkDailyProductionQuota, RATE_LIMITS } from '@/lib/limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // --- রেট-লিমিট + দৈনিক কোটা (§১১ নিরাপত্তা) ---
  const rl = checkRateLimit(`confirm:${clientKey(req)}`, RATE_LIMITS.confirm.limit, RATE_LIMITS.confirm.windowMs);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `ঘণ্টায় নিশ্চিতকরণের সীমা পার — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 60) } }
    );
  }
  const quota = await checkDailyProductionQuota(40);
  if (!quota.allowed) {
    return NextResponse.json(
      { error: `আজকের প্রোডাকশন-কোটা (${quota.limit}) শেষ — আগামীকাল আবার চেষ্টা করুন` },
      { status: 403 }
    );
  }

  const { id } = await params;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const overrides = (body?.spec && typeof body.spec === 'object' ? body.spec : {}) as Record<string, unknown>;

  const production = await db.production.findUnique({ where: { id } });
  if (!production) {
    return NextResponse.json({ error: 'প্রোডাকশন খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }
  if (production.status !== 'awaiting_confirmation') {
    return NextResponse.json({ error: 'এই প্রোডাকশন এখন আর নিশ্চিত করা যাবে না' }, { status: 409 });
  }

  // বর্তমান spec + ওভাররাইড মার্জ → পুনঃযাচাই (§১৫)
  let current: Record<string, unknown>;
  try {
    current = JSON.parse(production.specJson);
  } catch {
    current = {};
  }
  const merged = { ...current, ...overrides, type: production.type };

  const validation = validateSpec(merged);
  if (!validation.ok || !validation.validated) {
    return NextResponse.json(
      { error: 'সেটিংস যাচাই ব্যর্থ', details: validation.errors, alternatives: validation.alternatives ?? [] },
      { status: 422 }
    );
  }

  const updated = await db.production.update({
    where: { id },
    data: { status: 'queued', specJson: JSON.stringify(validation.validated.spec) },
    include: { steps: { orderBy: { seq: 'asc' } }, artifacts: { orderBy: { createdAt: 'asc' } } },
  });

  startProduction(id);
  return NextResponse.json(toProductionView(updated, updated.steps, updated.artifacts));
}
