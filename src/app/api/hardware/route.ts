// GET /api/hardware — নতুন পরিকল্পনা §১০: হার্ডওয়্যার-সচেতন মডেল-ম্যানেজার।
//
// হালকা রুট: measureHardware() (স্থানীয় পরিমাপ — ffmpeg/ffprobe/nvidia-smi সংস্করণ-প্রোব,
// কোনো স্বাস্থ্য-মডেল কল নয়) + computeHardwareVerdicts()।
// প্রোব-ফল ৬০ সেকেন্ড globalThis-এ ক্যাশে (HMR-নিরাপদ, system-info-এর healthCache-প্যাটার্ন)
// — বারবার কলে পুনঃ-প্রোব হয় না; সমান্তরাল কল একটিই প্রোবে যোগ দেয়।

import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { measureHardware } from '@/lib/system-info';
import { computeHardwareVerdicts } from '@/lib/agent/hardware-gate';
import type { HardwareManagerResponse, HardwareReport } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** ৬০ সেকেন্ড প্রোব-ক্যাশ TTL */
const HW_PROBE_TTL_MS = 60_000;

const g = globalThis as any;

interface CachedHardwareProbe {
  profile: HardwareReport;
  probedAt: string;
  expiresAt: number;
}

/** ক্যাশে-সহ হার্ডওয়্যার-প্রোব — TTL-এর ভেতরে পুনঃ-পরিমাপ নয়, চলমান প্রোবে যোগ */
async function probeHardwareCached(): Promise<CachedHardwareProbe> {
  const now = Date.now();
  const cached: CachedHardwareProbe | undefined = g.__hardwareProbeCache;
  if (cached && now < cached.expiresAt) return cached;

  // একই মুহূর্তে একাধিক অনুরোধ — একটিই প্রোব, বাকিরা সেই Promise-এ যোগ দেয়
  if (g.__hardwareProbeInFlight) return g.__hardwareProbeInFlight as Promise<CachedHardwareProbe>;

  const job = (async (): Promise<CachedHardwareProbe> => {
    const profile = await measureHardware();
    const entry: CachedHardwareProbe = {
      profile,
      probedAt: new Date().toISOString(),
      expiresAt: Date.now() + HW_PROBE_TTL_MS,
    };
    g.__hardwareProbeCache = entry;
    return entry;
  })();
  g.__hardwareProbeInFlight = job;
  try {
    return await job;
  } finally {
    g.__hardwareProbeInFlight = null;
  }
}

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  try {
    const { profile, probedAt } = await probeHardwareCached();
    const assessments = computeHardwareVerdicts(profile);
    const body: HardwareManagerResponse = { profile, assessments, probedAt };
    return NextResponse.json(body);
  } catch (err: any) {
    return NextResponse.json(
      { error: `হার্ডওয়্যার-প্রতিবেদন ব্যর্থ: ${String(err?.message ?? err).slice(0, 200)}` },
      { status: 500 }
    );
  }
}
