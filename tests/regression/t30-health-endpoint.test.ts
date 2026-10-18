// ============================================================
// REGRESSION TEST 30 — /api/health কোর-যুক্তি (Phase 2)
//
// Boundaries:
//  - Module under test (REAL): src/lib/health.ts — runHealthChecks +
//    healthStatusCode + storageRoot। সম্পূর্ণ নির্ভরতা-ইনজেকশন:
//    কোনো db/fs/child_process স্পর্শ নেই → mock-free।
//  - No network, no DB, no SDK, no real storage write।
//
// Enforced contracts:
//  ১. সব-সবুজ ইনজেকশন → status 'ok', HTTP 200।
//  ২. ডেটাবেস-ব্যর্থতা → একমাত্র 'error' (503) — error-বার্তা সংরক্ষিত।
//  ৩. db-ping টাইমআউট (কখনো-না-মীমাংসিত promise) → সৎ timeout-বার্তা।
//  ৪. storage/ffmpeg/env ব্যর্থতা → 'degraded' (200) — অ্যাপ বেঁচে।
//  ৫. env: required-অনুপস্থিতি তালিকাভুক্ত; প্রোডাকশনে recommended-ও।
//  ৬. providers.zaiSdk: ইনজেক্ট করা সনাক্তকরণের সৎ প্রতিফলন।
//  ৭. কোনো গোপন মান রিপোর্টে ঢুকে না (কেবল কী-নাম/পথ/সংস্করণ)।
// ============================================================

import { describe, expect, test } from 'bun:test';
import {
  healthStatusCode,
  runHealthChecks,
  storageRoot,
  type EnvReport,
  type HealthDeps,
} from '@/lib/health';
import path from 'node:path';

// ---- নির্দোষ ভিত্তি-ইনজেকশন (সব-সবুজ) ----
const okDeps = (): HealthDeps => ({
  countFn: async () => 7,
  probeFfmpeg: async () => ({ ok: true, version: '7.1.5-0+deb13u1' }),
  probeStorage: async () => ({ ok: true, path: '/healthy/storage' }),
  envReport: fakeEnvReport({ production: false }),
  zaiConfigured: () => false,
});

/** খাঁটি সংশ্লেষিত EnvReport — validateEnv-এর আকৃতির মানোয়িত্তর */
function fakeEnvReport(opts: { production: boolean; missing?: string[] }): EnvReport {
  const missing = opts.missing ?? [];
  const mk = (key: string, level: 'required' | 'recommended' | 'optional') => ({
    key,
    level,
    ok: !missing.includes(key),
    note: 't30-সংশ্লেষিত',
  });
  return {
    production: opts.production,
    items: [
      mk('DATABASE_URL', 'required'),
      mk('STUDIO_OWNER_PASSCODE', opts.production ? 'required' : 'recommended'),
      mk('STUDIO_SESSION_SECRET', opts.production ? 'recommended' : 'optional'),
    ],
    ok: missing.length === 0,
  };
}

describe('t30 · runHealthChecks — সবুজ-পথ', () => {
  test('সব-সবুজ → status ok, 200, সব চেক-ঠিক', async () => {
    const report = await runHealthChecks(okDeps());
    expect(report.status).toBe('ok');
    expect(healthStatusCode(report)).toBe(200);
    expect(report.checks.database.ok).toBe(true);
    expect(report.checks.storage.ok).toBe(true);
    expect(report.checks.ffmpeg.ok).toBe(true);
    expect(report.checks.ffmpeg.version).toBe('7.1.5-0+deb13u1');
    expect(report.checks.env.ok).toBe(true);
    expect(report.checks.env.missingRequired).toEqual([]);
    expect(report.checks.env.missingRecommended).toEqual([]);
    expect(report.checks.providers.zaiSdk).toBe('not-configured');
    expect(report.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof report.timestamp).toBe('string');
  });

  test('db-লেটেন্সি অ-ঋণাত্মক সংখ্যা', async () => {
    const report = await runHealthChecks(okDeps());
    expect(report.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('zaiConfigured=true → providers.zaiSdk = configured', async () => {
    const report = await runHealthChecks({ ...okDeps(), zaiConfigured: () => true });
    expect(report.checks.providers.zaiSdk).toBe('configured');
  });
});

describe('t30 · runHealthChecks — ডেটাবেস (একমাত্র error-স্তর)', () => {
  test('countFn ব্যর্থ → status error, 503, বার্তা সংরক্ষিত', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      countFn: async () => {
        throw new Error('P1001: Can\'t reach database server');
      },
    });
    expect(report.status).toBe('error');
    expect(healthStatusCode(report)).toBe(503);
    expect(report.checks.database.ok).toBe(false);
    expect(report.checks.database.error).toContain("P1001");
  });

  test('db-ping টাইমআউট → সৎ timeout-বার্তা, 503', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      dbTimeoutMs: 25,
      countFn: () => new Promise<number>(() => {}), // কখনো মীমাংসিত হয় না
    });
    expect(report.checks.database.ok).toBe(false);
    expect(report.checks.database.error).toContain('timeout');
    expect(report.status).toBe('error');
    expect(healthStatusCode(report)).toBe(503);
  });

  test('db-ব্যর্থ হলেও বাকি প্রোবগুলোর ফলাফল রিপোর্টে থাকে', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      countFn: async () => {
        throw new Error('db down');
      },
    });
    expect(report.checks.storage.ok).toBe(true);
    expect(report.checks.ffmpeg.ok).toBe(true);
  });
});

describe('t30 · runHealthChecks — degraded (200, অ্যাপ বেঁচে)', () => {
  test('storage অলেখাযোগ্য → degraded, 200, পথ+বার্তা', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      probeStorage: async () => ({ ok: false, path: '/app/storage', error: 'EACCES: permission denied' }),
    });
    expect(report.status).toBe('degraded');
    expect(healthStatusCode(report)).toBe(200);
    expect(report.checks.storage.ok).toBe(false);
    expect(report.checks.storage.path).toBe('/app/storage');
    expect(report.checks.storage.error).toContain('EACCES');
  });

  test('ffmpeg অনুপস্থিত → degraded, version নেই, বার্তা আছে', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      probeFfmpeg: async () => ({ ok: false, error: 'spawn ffmpeg ENOENT' }),
    });
    expect(report.status).toBe('degraded');
    expect(healthStatusCode(report)).toBe(200);
    expect(report.checks.ffmpeg.ok).toBe(false);
    expect(report.checks.ffmpeg.version).toBeUndefined();
    expect(report.checks.ffmpeg.error).toContain('ENOENT');
  });

  test('env required-অনুপস্থিত → degraded + missingRequired তালিকা', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      envReport: fakeEnvReport({ production: true, missing: ['DATABASE_URL'] }),
    });
    expect(report.status).toBe('degraded');
    expect(report.checks.env.ok).toBe(false);
    expect(report.checks.env.missingRequired).toEqual(['DATABASE_URL']);
    expect(report.checks.env.production).toBe(true);
  });

  test('প্রোডাকশনে recommended-অনুপস্থিতিও degraded — dev-মোডে নয়', async () => {
    const prod = await runHealthChecks({
      ...okDeps(),
      envReport: fakeEnvReport({ production: true, missing: ['STUDIO_SESSION_SECRET'] }),
    });
    expect(prod.status).toBe('degraded');
    expect(prod.checks.env.missingRecommended).toEqual(['STUDIO_SESSION_SECRET']);

    const dev = await runHealthChecks({
      ...okDeps(),
      envReport: fakeEnvReport({ production: false, missing: ['STUDIO_SESSION_SECRET'] }),
    });
    expect(dev.status).toBe('ok');
  });

  test('storage+ffmpeg দুটোই ব্যর্থ + db সবুজ → এখনো degraded (503 নয়)', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      probeStorage: async () => ({ ok: false, path: '/x', error: 'EROFS' }),
      probeFfmpeg: async () => ({ ok: false, error: 'ENOENT' }),
    });
    expect(report.status).toBe('degraded');
    expect(healthStatusCode(report)).toBe(200);
  });
});

describe('t30 · গোপন-নিরপেক্ষতা ও পথ-চুক্তি', () => {
  test('ত্রুটি-বার্তায় URL-ক্রেডেনশিয়াল মাস্ক হয় (db-সংযোগ-স্ট্রিং ফাঁস রোধ)', async () => {
    const report = await runHealthChecks({
      countFn: async () => {
        throw new Error("P1001: Can't reach postgres://studio:SuperSecret123@db.railway.internal:5432/studio");
      },
      probeFfmpeg: async () => ({ ok: false, error: 'redis://default:hunter2@redis.internal:6379 unreachable' }),
      probeStorage: async () => ({ ok: true, path: '/x' }),
      envReport: fakeEnvReport({ production: false }),
      zaiConfigured: () => false,
    });
    const json = JSON.stringify(report);
    expect(json).not.toContain('SuperSecret123');
    expect(json).not.toContain('hunter2');
    expect(json).toContain('***@');
    expect(report.checks.database.error).toContain('P1001');
  });

  test('env-চেক কেবল কী-নাম তালিকাভুক্ত করে — কোনো মান নয়', async () => {
    const report = await runHealthChecks({
      ...okDeps(),
      envReport: fakeEnvReport({ production: true, missing: ['STUDIO_OWNER_PASSCODE'] }),
    });
    const json = JSON.stringify(report.checks.env);
    expect(json).toContain('STUDIO_OWNER_PASSCODE'); // কী-নাম — হ্যাঁ
    expect(report.checks.env.missingRequired).toEqual(['STUDIO_OWNER_PASSCODE']);
    // মান-বহন করার ক্ষমতাই নেই — স্কিমায় কেবল নাম-তালিকা
    expect(Object.keys(report.checks.env)).toEqual(['ok', 'production', 'missingRequired', 'missingRecommended']);
  });

  test('storageRoot — process.cwd() ভিত্তিক storage-পথ (চুক্তি)', () => {
    expect(storageRoot()).toBe(path.join(process.cwd(), 'storage'));
  });
});
