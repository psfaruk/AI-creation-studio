// ============================================================
// REG-11 — production stage metrics (Phase-3 Workstream D)
//
// ai_video-র generateVideoClip এখন প্রতিটি শটের ধাপ-সময়
// (submit/poll/download/validate) + ক্যাশ-ফলাফল প্রোডাকশন-স্কোপড
// সঞ্চয়কারীতে (run-metrics.ts) জমে করে; প্রোডাকশন-শেষের এক-লাইন
// [production-metrics]-এ video.* ক্ষেত্র যোগ হয়। নীতি: LOW VOLUME
// (প্রতি-শট লাইন নয়), REDACTION (কেবল গণনা/সময়/এনাম), HONESTY।
//
// Isolation: t10-এর একই প্যাটার্ন — llm মক + fetch মক + প্রকৃত MP4
// ফিক্সচার + মিলিসেকেন্ড-স্কেল সীমা; মেট্রিকস-সঞ্চয়কারী গ্লোবাল টেস্টে
// রিসেট; কোনো provider/db/storage ছোঁয়া নেই।
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

let submitCount = 0;
const FIXTURE_STATE: { mp4: Buffer | null } = { mp4: null };

mock.module('@/lib/agent/llm', () => {
  return {
    getZAI: async () => ({
      video: {
        generations: {
          create: async () => {
            submitCount++;
            return { id: `mocktask-${submitCount}`, model: 'cogvideox-3' };
          },
        },
      },
      async: {
        result: {
          query: async () => ({
            task_status: 'SUCCESS',
            video_result: [{ url: 'mock://clip-latest' }],
          }),
        },
      },
    }),
    chatComplete: async () => {
      throw new Error('chatComplete should not be called in this test');
    },
    parseToolCall: () => null,
  };
});

const { generateVideoClip, AI_VIDEO_LIMITS } = await import('@/lib/agent/video/ai_video');
const {
  getProductionMetrics,
  clearProductionMetrics,
  logProductionMetrics,
  noteVideoStage,
  noteVideoShotOutcome,
  noteVideoShotRequested,
} = await import('@/lib/agent/run-metrics');
const { runFfmpeg, runWithFfmpegTracking } = await import('@/lib/media/ffmpeg');

const REAL_FETCH = globalThis.fetch;
const REAL_POLL_MS = AI_VIDEO_LIMITS.pollIntervalMs;
const REAL_COOLDOWN_MS = AI_VIDEO_LIMITS.postCompletionCooldownMs;
const ROOTS: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;

let fixtureMp4: Buffer;
let sharedCacheRoot: string;

// স্যুট-শুরুতে একবার: প্রকৃত ≥50KB অডিও-সহ MP4 + মিলিসেকেন্ড-স্কেল সীমা
// + ডিফল্ট ক্যাশ-রুট (storage/ কখনো ছোঁয়া হয় না)
{
  const dir = await mkdtemp(path.join(tmpdir(), 'reg11-fixture-'));
  ROOTS.push(dir);
  sharedCacheRoot = dir;
  const p = path.join(dir, 'fixture.mp4');
  await runFfmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=duration=3.5:size=480x270:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.5',
    '-c:v', 'libx264', '-b:v', '200k', '-minrate', '200k', '-maxrate', '200k',
    '-c:a', 'aac', '-b:a', '64k', '-shortest', '-pix_fmt', 'yuv420p', p,
  ], { label: 'REG-11 ফিক্সচার' });
  FIXTURE_STATE.mp4 = await readFile(p);
  if (FIXTURE_STATE.mp4.length < 50_000) throw new Error('REG-11 ফিক্সচার খুব ছোট');
  AI_VIDEO_LIMITS.pollIntervalMs = 250;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = 0;
}

beforeEach(() => {
  fixtureMp4 = FIXTURE_STATE.mp4!;
  submitCount = 0;
  resetShotCacheStatsForTests();
  (g as any).__aiVideoGate = undefined;
  g.__shotCacheRootOverride = sharedCacheRoot; // ডিফল্ট টেম্প-রুট — storage/ অপরিবৃত
  // মেট্রিকস-সঞ্চয়কারী গ্লোবাল ম্যাপ ফ্রেশ (নির্ধারক নাম — HMR-প্যাটার্ন)
  g.__productionMetricsAcc = undefined;
  globalThis.fetch = (async () => new Response(new Uint8Array(fixtureMp4), { status: 200 })) as typeof fetch;
});

// shot_cache রিসেট হেল্পার — ai_video থেকে (মক-পরে ইম্পোর্ট)
const { resetShotCacheStatsForTests } = await import('@/lib/agent/video/shot_cache');

afterAll(async () => {
  AI_VIDEO_LIMITS.pollIntervalMs = REAL_POLL_MS;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = REAL_COOLDOWN_MS;
  globalThis.fetch = REAL_FETCH;
  delete g.__shotCacheRootOverride;
  await Promise.all(ROOTS.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
});

const REQ = { prompt: 'Misty morning river', durationSec: 5, quality: 'speed' as const };

describe('REG-11: production stage metrics (Phase-3 D)', () => {
  test('REG-11a: stage durations recorded per tracked production (submit/poll/download/validate ≥ 0)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'reg11a-'));
    ROOTS.push(root);
    g.__shotCacheRootOverride = root;

    // ট্র্যাকড-স্কোপের বাইরে: কোনো সঞ্চয়কারীই তৈরি হয় না (চ্যাট-পথ) —
    // getProductionMetrics(আইডি) ধরেই নেয়-ঢেকে তৈরি করে, তাই ম্যাপ সরাসরি দেখি
    expect(getProductionMetrics(null)).toBeNull(); // null-স্কোপ = কাঠামোগতভাবে স্কিপ
    await generateVideoClip({ ...REQ, prompt: 'outside scope' });
    const mapBefore = (g as any).__productionMetricsAcc as Map<string, unknown> | undefined;
    expect(mapBefore?.has('reg11a-prod') ?? false).toBe(false); // স্কোপ-বাইরের কলে কী-ই জন্মায়নি

    // ট্র্যাকড-স্কোপের ভেতরে: ধাপ-সময় + ফলাফল জমে
    await runWithFfmpegTracking('reg11a-prod', async () => {
      await generateVideoClip({ ...REQ });
    });
    const acc = getProductionMetrics('reg11a-prod');
    expect(acc).toBeTruthy();
    expect(acc!.shotsRequested).toBe(1);
    expect(acc!.providerSubmits).toBe(1); // মিস → প্রকৃত সাবমিট
    expect(acc!.cacheStores).toBe(1); // যাচাই-সফল → স্টোর
    expect(acc!.submitMsTotal).toBeGreaterThanOrEqual(0);
    expect(acc!.pollMsTotal).toBeGreaterThanOrEqual(0);
    expect(acc!.downloadMsTotal).toBeGreaterThanOrEqual(0);
    expect(acc!.validateMsTotal).toBeGreaterThanOrEqual(0);
    // ফ্রেশ গেটে সাবমিট-ধাপ তাৎক্ষণিক — তবে পোল ঘটনাটি ঘটেছেই (মক তাৎক্ষণিক SUCCESS)
    expect(acc!.submitMsTotal + acc!.pollMsTotal + acc!.downloadMsTotal + acc!.validateMsTotal)
      .toBeGreaterThanOrEqual(0);
    clearProductionMetrics('reg11a-prod');
  });

  test('REG-11b: redaction — no prompt/URL/user content in accumulator or metrics line', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'reg11b-'));
    ROOTS.push(root);
    g.__shotCacheRootOverride = root;
    const CANARY = 'CANARY-PROMPT-SECRET-ханter';

    // ক্যানারি-প্রম্পটসহ ট্র্যাকড জেনারেশন — সঞ্চয়কারীতে কেবল সংখ্যা ঢোকে
    await runWithFfmpegTracking('reg11b-prod', async () => {
      await generateVideoClip({ ...REQ, prompt: `secret ${CANARY} text` });
    });
    const acc = getProductionMetrics('reg11b-prod')!;
    const accJson = JSON.stringify(acc);
    expect(accJson.includes(CANARY)).toBe(false);
    expect(accJson.includes('mock://')).toBe(false); // URL-ও নয়
    // কেবল সংখ্যা-ক্ষেত্রই আছে
    for (const v of Object.values(acc)) {
      expect(typeof v).toBe('number');
    }

    // মেট্রিকস-লাইনেও একই — console ক্যাপচার করে যাচাই
    const lines: string[] = [];
    const origLog = console.log;
    console.log = ((...args: unknown[]) => { lines.push(String(args[0])); }) as typeof console.log;
    try {
      logProductionMetrics({
        productionId: 'reg11b-prod',
        type: 'motion_video',
        outcome: 'completed',
        queueWaitMs: 10,
        durationMs: 5000,
        stepsDone: 8,
        stepsFailed: 0,
        artifacts: 1,
        errorCategoryHint: null,
        video: {
          shotsRequested: acc.shotsRequested,
          shotsFromCache: acc.shotsFromCache,
          shotsJoined: acc.shotsJoined,
          providerSubmits: acc.providerSubmits,
          shotsBypassed: acc.shotsBypassed,
          cacheStores: acc.cacheStores,
          cacheInvalid: acc.cacheInvalid,
          submitMs: acc.submitMsTotal,
          pollMs: acc.pollMsTotal,
          downloadMs: acc.downloadMsTotal,
          validateMs: acc.validateMsTotal,
        },
      });
    } finally {
      console.log = origLog;
    }
    const line = lines.find(l => l.startsWith('[production-metrics]'));
    expect(line).toBeTruthy();
    expect(line!.includes(CANARY)).toBe(false);
    expect(line!.includes('mock://')).toBe(false);
    const parsed = JSON.parse(line!.slice('[production-metrics] '.length));
    expect(parsed.video.providerSubmits).toBe(1);
    expect(parsed.video.shotsRequested).toBe(1);
    // সব video-মান সংখ্যা — কাঠামোগত রিড্যাকশনের প্রমাণ
    for (const v of Object.values(parsed.video)) expect(typeof v).toBe('number');
    clearProductionMetrics('reg11b-prod');
  });

  test('REG-11c: accumulator lifecycle — clear works, map bounded (safety valve)', async () => {
    // সঞ্চয়কারী তৈরি + মুছে ফেলা → পরের গেট নতুন (শূন্য) সঞ্চয়কারী দেয়
    const acc1 = getProductionMetrics('reg11c-prod')!;
    noteVideoShotRequested('reg11c-prod');
    noteVideoStage('reg11c-prod', 'submit', 5);
    expect(acc1.shotsRequested).toBe(1);
    clearProductionMetrics('reg11c-prod');
    const acc2 = getProductionMetrics('reg11c-prod')!;
    expect(acc2.shotsRequested).toBe(0); // নতুন সঞ্চয়কারী — পুরোনো গণনা নেই
    clearProductionMetrics('reg11c-prod');

    // নিরাপত্তা-ভালভ: ২০০-এর বেশি সঞ্চয়কারী জমে থাকতে পারে না
    for (let i = 0; i < 205; i++) {
      noteVideoShotRequested(`reg11c-flood-${i}`);
    }
    const map = (g as any).__productionMetricsAcc as Map<string, unknown>;
    expect(map.size).toBeLessThanOrEqual(200);
    for (let i = 0; i < 205; i++) clearProductionMetrics(`reg11c-flood-${i}`);
  });

  test('REG-11d: counters coherent — requested = cache + joined + provider + bypassed', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'reg11d-'));
    ROOTS.push(root);
    g.__shotCacheRootOverride = root;

    await runWithFfmpegTracking('reg11d-prod', async () => {
      // ১) মিস → প্রকৃত জেনারেশন (providerSubmits)
      await generateVideoClip({ ...REQ });
      // ২) একই অনুরোধ → ক্যাশ-হিট (shotsFromCache)
      await generateVideoClip({ ...REQ });
      // ৩) ভিন্ন অনুরোধে দুটি সমবর্তী কল → ১ জেনারেশন + ১ যোগ (joined)
      await Promise.all([
        generateVideoClip({ ...REQ, prompt: 'joined prompt variant' }),
        generateVideoClip({ ...REQ, prompt: 'joined prompt variant' }),
      ]);
      // ৪) বাইপাস কল (shotsBypassed)
      await generateVideoClip({ ...REQ, prompt: 'bypassed variant' }, { bypassCache: true });
    });

    const acc = getProductionMetrics('reg11d-prod')!;
    expect(acc.shotsRequested).toBe(5); // মোট কল
    expect(acc.shotsFromCache).toBe(1);
    expect(acc.shotsJoined).toBe(1);
    expect(acc.providerSubmits).toBe(2); // প্রথম + joined-জোড়ার মালিক
    expect(acc.shotsBypassed).toBe(1);
    // অভেদ: প্রতিটি কল ঠিক একটি ফলাফলে গণনা হয়েছে
    expect(acc.shotsFromCache + acc.shotsJoined + acc.providerSubmits + acc.shotsBypassed).toBe(acc.shotsRequested);
    expect(acc.cacheStores).toBe(2); // প্রথম + joined-জোড়া (বাইপাস স্টোর করে না)
    clearProductionMetrics('reg11d-prod');
  });
});
