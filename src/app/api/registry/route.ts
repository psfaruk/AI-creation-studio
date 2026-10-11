// GET /api/registry — Model & License Registry (§৮ + নতুন পরিকল্পনা §২ + §১)
// প্রতি কলে idempotent upsert-by-key (সস্তা — SQLite স্থানীয়, ~২৪ সারি)।
// নতুন ৪-মাত্রার স্ট্যাটাস + পঞ্চম মাত্রা (qualityStatus) + প্রোব-ইতিহাস সহ ফেরত দেয়।
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { MODEL_SEED } from '@/lib/agent/model-registry-data';
import type { ModelEntryView } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function ensureSeeded(): Promise<void> {
  for (const entry of MODEL_SEED) {
    const data = {
      name: entry.name,
      category: entry.category,
      provider: entry.provider,
      license: entry.license,
      licenseUrl: entry.licenseUrl ?? null,
      commercialUse: entry.commercialUse,
      status: entry.status,
      licenseStatus: entry.licenseStatus ?? null,
      providerStatus: entry.providerStatus ?? null,
      integrationStatus: entry.integrationStatus ?? null,
      runtimeStatus: entry.runtimeStatus ?? null,
      qualityStatus: entry.qualityStatus ?? null,
      apiEndpoint: entry.apiEndpoint ?? null,
      apiModelId: entry.apiModelId ?? null,
      lastTestedAt: entry.lastTestedAt ? new Date(`${entry.lastTestedAt}T12:00:00Z`) : null,
      lastTestNote: entry.lastTestNote ?? null,
      errorReason: entry.errorReason ?? null,
      toolsJson: JSON.stringify(entry.tools ?? []),
      capabilitiesJson: JSON.stringify(entry.capabilities),
      hardwareNotes: entry.hardwareNotes ?? null,
      notes: entry.notes ?? null,
      verifiedAt: entry.lastTestedAt ? new Date(`${entry.lastTestedAt}T12:00:00Z`) : null,
      sortOrder: entry.sortOrder,
    };
    await db.modelEntry.upsert({
      where: { key: entry.key },
      create: { key: entry.key, ...data },
      update: data,
    });
  }
  // seed থেকে বাদ-পড়া key (যেমন পুরোনো 'singing-tts' — এখন ace-step+yue-তে বিভক্ত) —
  // ডিলিট করা হয়, নইলে GET পুরোনো এন্ট্রিও ফিরিয়ে দিত। ModelEntry-র একমাত্র লেখক এই রুট।
  const seedKeys = MODEL_SEED.map(e => e.key);
  await db.modelEntry.deleteMany({ where: { key: { notIn: seedKeys } } });
}

export async function GET() {
  await ensureSeeded();
  const rows = await db.modelEntry.findMany({ orderBy: { sortOrder: 'asc' } });
  const views: ModelEntryView[] = rows.map(r => {
    let capabilities: Record<string, unknown> = {};
    let tools: string[] = [];
    try {
      capabilities = JSON.parse(r.capabilitiesJson);
    } catch {
      capabilities = {};
    }
    try {
      tools = JSON.parse(r.toolsJson ?? '[]');
    } catch {
      tools = [];
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
      licenseStatus: (r.licenseStatus ?? undefined) as ModelEntryView['licenseStatus'],
      providerStatus: (r.providerStatus ?? undefined) as ModelEntryView['providerStatus'],
      integrationStatus: (r.integrationStatus ?? undefined) as ModelEntryView['integrationStatus'],
      runtimeStatus: (r.runtimeStatus ?? undefined) as ModelEntryView['runtimeStatus'],
      qualityStatus: (r.qualityStatus ?? undefined) as ModelEntryView['qualityStatus'],
      apiEndpoint: r.apiEndpoint ?? undefined,
      apiModelId: r.apiModelId ?? undefined,
      lastTestedAt: r.lastTestedAt?.toISOString(),
      lastTestNote: r.lastTestNote ?? undefined,
      errorReason: r.errorReason ?? undefined,
      tools,
      capabilities,
      hardwareNotes: r.hardwareNotes ?? undefined,
      notes: r.notes ?? undefined,
      verifiedAt: r.verifiedAt?.toISOString(),
    };
  });
  return NextResponse.json(views);
}
