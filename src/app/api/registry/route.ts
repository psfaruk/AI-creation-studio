// GET /api/registry — Model & License Registry (§৮)
// প্রথম কলে seed (idempotent upsert-by-key)
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { MODEL_SEED } from '@/lib/agent/model-registry-data';
import type { ModelEntryView } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function ensureSeeded(): Promise<void> {
  const count = await db.modelEntry.count();
  if (count >= MODEL_SEED.length) return;
  for (const entry of MODEL_SEED) {
    await db.modelEntry.upsert({
      where: { key: entry.key },
      create: {
        key: entry.key,
        name: entry.name,
        category: entry.category,
        provider: entry.provider,
        license: entry.license,
        licenseUrl: entry.licenseUrl ?? null,
        commercialUse: entry.commercialUse,
        status: entry.status,
        capabilitiesJson: JSON.stringify(entry.capabilities),
        hardwareNotes: entry.hardwareNotes ?? null,
        notes: entry.notes ?? null,
        verifiedAt: entry.status === 'enabled' ? new Date() : null,
        sortOrder: entry.sortOrder,
      },
      update: {
        name: entry.name,
        category: entry.category,
        provider: entry.provider,
        license: entry.license,
        licenseUrl: entry.licenseUrl ?? null,
        commercialUse: entry.commercialUse,
        status: entry.status,
        capabilitiesJson: JSON.stringify(entry.capabilities),
        hardwareNotes: entry.hardwareNotes ?? null,
        notes: entry.notes ?? null,
        sortOrder: entry.sortOrder,
      },
    });
  }
}

export async function GET() {
  await ensureSeeded();
  const rows = await db.modelEntry.findMany({ orderBy: { sortOrder: 'asc' } });
  const views: ModelEntryView[] = rows.map(r => {
    let capabilities: Record<string, unknown> = {};
    try {
      capabilities = JSON.parse(r.capabilitiesJson);
    } catch {
      capabilities = {};
    }
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      category: r.category as ModelEntryView['category'],
      provider: r.provider,
      license: r.license,
      licenseUrl: r.licenseUrl ?? undefined,
      commercialUse: r.commercialUse as ModelEntryView['commercialUse'],
      status: r.status as ModelEntryView['status'],
      capabilities,
      hardwareNotes: r.hardwareNotes ?? undefined,
      notes: r.notes ?? undefined,
      verifiedAt: r.verifiedAt?.toISOString(),
    };
  });
  return NextResponse.json(views);
}
