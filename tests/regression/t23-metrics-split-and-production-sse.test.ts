// ============================================================
// REGRESSION TEST 23 — D-8 মেট্রিক-বিভাজন + F3 স্টেজ + PART G
// ত্রুটি-বিবরণ + প্রোডাকশন-SSE রাউট (B8-শূন্যস্থান)
//
// পটভূমি (D-8/B6): পুরনো queueWaitMs = startedAt−createdAt — এতে
// ব্যবহারকারীর নিশ্চিতকরণ-অপেক্ষাও ঢুকে যেত (প্রকৃত রানে ১,০৮৭,৭৯০ms
// "সারি-অপেক্ষা" যার ৯৯% ছিল ব্যবহারকারীর কনফার্ম-অপেক্ষা)। এখন
// timings.confirmationHoldMs সেটিকে আলাদা করে; লিগ্যাসি queueWaitMs
// ক্ষেত্রটি অর্থ/সূত্র অপরিবর্তিত (পেছনের-সামঞ্জস্য)।
//
// Boundaries:
//  - Modules under test: run-metrics (computeFinalTimings, STEP_STAGE,
//    logProductionMetrics), production/error-detail (PART G), এবং
//    /api/productions/[id]/events-এর REAL GET হ্যান্ডলার।
//  - Mocked: '@/lib/db' (fake-db), '@/lib/security' (auth-ok)।
//  - No network. No provider. No db-file.
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { fakeDb, resetFakeDb, seedProduction, seedProductionStep, state } from '../helpers/fake-db';
import { collectSse, framesOf } from '../helpers/sse-harness';

mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/security', () => ({
  requireOwner: async () => ({ ok: true as const }),
}));

const { computeFinalTimings, logProductionMetrics, STEP_STAGE } = await import('@/lib/agent/run-metrics');
const { classifyProductionError, retryAppropriateForCategory, buildProductionErrorDetail } = await import(
  '@/lib/agent/production/error-detail'
);
const { GET } = await import('@/app/api/productions/[id]/events/route');
const prodBus = await import('@/lib/agent/production/bus');

// ---- কনসোল-স্পাই ([production-metrics] লাইন ধরার জন্য — t11/smoke-প্যাটার্ন) ----
const originalLog = console.log;
let metricLines: string[] = [];
function spyMetricsLog(): void {
  metricLines = [];
  console.log = (...args: unknown[]) => {
    const line = String(args[0] ?? '');
    if (line.startsWith('[production-metrics]')) metricLines.push(line);
  };
}
function restoreLog(): void {
  console.log = originalLog;
}

// ---- সময়-ভিত্তিক সহায়ক ----
const T0 = new Date('2026-10-17T10:00:00Z');
const at = (offsetMs: number) => new Date(T0.getTime() + offsetMs);

describe('REG-23a: D-8 মেট্রিক-বিভাজন — computeFinalTimings (বিশুদ্ধ ফাংশন)', () => {
  test('REG-23a-১: নিশ্চিতকরণ-অপেক্ষা ও লিগ্যাসি সারি-অপেক্ষা আলাদা — লিগ্যাসি অর্থ অপরিবর্তিত', () => {
    // T0 তৈরি → +৫০০০ms কনফার্ম → +৫৫০০ms শুরু → +৬৫৫০০ms শেষ
    const timings = computeFinalTimings(
      { createdAt: T0, confirmedAt: at(5_000), startedAt: at(5_500), finishedAt: at(65_500) },
      [
        // অডিও-ধাপ ৩০০০ms + সংযোজন-ধাপ ১৫০০০ms; script_breakdown কোনো বালতিতেই নয়
        { key: 'script_breakdown', startedAt: at(5_600), finishedAt: at(6_600) },
        { key: 'speech', startedAt: at(6_500), finishedAt: at(9_500) },
        { key: 'final_mix', startedAt: at(10_500), finishedAt: at(25_500) },
      ],
      {
        planMs: 2_500,
        submitMsTotal: 120_000,
        pollMsTotal: 858_000,
        downloadMsTotal: 10_000,
        validateMsTotal: 5_000,
      } as never
    );
    expect(timings.confirmationHoldMs).toBe(5_000); // ব্যবহারকারীর কনফার্ম-অপেক্ষা
    expect(timings.queueWaitMs).toBe(5_500); // লিগ্যাসি: কনফার্ম-অপেক্ষাসহ (দ্রষ্টব্য-কমেন্ট)
    expect(timings.planGenerationMs).toBe(2_500);
    expect(timings.providerSubmissionMs).toBe(120_000);
    expect(timings.providerGenerationMs).toBe(858_000);
    expect(timings.downloadMs).toBe(10_000);
    expect(timings.validationMs).toBe(5_000);
    expect(timings.audioProcessingMs).toBe(3_000); // কেবল speech-ধাপ
    expect(timings.videoCompositionMs).toBe(15_000); // কেবল final_mix-ধাপ
    expect(timings.totalExecutionMs).toBe(60_000); // startedAt→finishedAt
    expect(timings.totalUserElapsedMs).toBe(65_500); // createdAt→finishedAt
  });

  test('REG-23a-২: সৎ-null চুক্তি — অ-মাপা কখনো বানানো হয় না', () => {
    // confirmedAt নেই (ঐতিহাসিক সারি) → confirmationHoldMs=null (০ নয়)
    const noConfirm = computeFinalTimings(
      { createdAt: T0, confirmedAt: null, startedAt: at(5_500), finishedAt: at(65_500) },
      [],
      null
    );
    expect(noConfirm.confirmationHoldMs).toBeNull();
    expect(noConfirm.audioProcessingMs).toBeNull(); // ০টি পরিমাপযোগ্য ধাপ
    expect(noConfirm.videoCompositionMs).toBeNull();
    expect(noConfirm.planGenerationMs).toBeNull(); // সঞ্চয়কারীই নেই
    expect(noConfirm.providerSubmissionMs).toBeNull();
    // সারিই নেই → সব null
    const noRow = computeFinalTimings(null, [], null);
    expect(Object.values(noRow).every(v => v === null)).toBe(true);
    // planMs = -1 (পরিকল্পক চালেনি) → planGenerationMs=null
    const noPlan = computeFinalTimings(
      { createdAt: T0, confirmedAt: at(1_000), startedAt: at(2_000), finishedAt: at(3_000) },
      [],
      { planMs: -1, submitMsTotal: 0, pollMsTotal: 0, downloadMsTotal: 0, validateMsTotal: 0 } as never
    );
    expect(noPlan.planGenerationMs).toBeNull();
  });
});

describe('REG-23b: [production-metrics] লাইনে timings{} নির্গমন + পেছনের-সামঞ্জস্য', () => {
  test('REG-23b-১: timings-সহ কল → শীর্ষ-স্তরের timings{} + লিগ্যাসি queueWaitMs উভয়ই', () => {
    spyMetricsLog();
    try {
    logProductionMetrics({
      productionId: 'p23-1',
      type: 'short_film',
      outcome: 'completed',
      durationMs: 60_000,
      queueWaitMs: 5_500,
      stepsDone: 6,
      stepsFailed: 1,
      artifacts: 3,
      errorCategoryHint: null,
      timings: { confirmationHoldMs: 5_000, queueWaitMs: 5_500, totalUserElapsedMs: 65_500 },
    });
    expect(metricLines.length).toBe(1);
    const parsed = JSON.parse(metricLines[0].replace('[production-metrics]', '').trim());
    expect(parsed.timings).toBeDefined();
    expect(parsed.timings.confirmationHoldMs).toBe(5_000);
    expect(parsed.timings.queueWaitMs).toBe(5_500);
    expect(parsed.queueWaitMs).toBe(5_500); // লিগ্যাসি ক্ষেত্র অক্ষত (smoke-চুক্তি)
    } finally { restoreLog(); }
  });

  test('REG-23b-২: timings ছাড়া কল → timings কীই লাগে না (t11/t15/smoke-সামঞ্জস্য)', () => {
    spyMetricsLog();
    try {
      logProductionMetrics({
        productionId: 'p23-2',
        type: 'motion_video',
        outcome: 'completed',
        durationMs: 1_000,
        queueWaitMs: 500,
        stepsDone: null,
        stepsFailed: null,
        artifacts: null,
        errorCategoryHint: null,
      });
      const parsed = JSON.parse(metricLines[0].replace('[production-metrics]', '').trim());
      expect(parsed.timings).toBeUndefined();
      expect(parsed.queueWaitMs).toBe(500);
    } finally { restoreLog(); }
  });
});

describe('REG-23c: F3 স্টেজ-মানচিত্র + PART G কাঠামোগত ত্রুটি-বিবরণ', () => {
  test('REG-23c-১: STEP_STAGE — ধাপ-কী → স্টেজ; অজানা কীতে এন্ট্রি নেই (কাল্পনিক নয়)', () => {
    expect(STEP_STAGE['script_breakdown']).toBe('PLANNING');
    expect(STEP_STAGE['visual_plan']).toBe('PLANNING');
    expect(STEP_STAGE['speech']).toBe('GENERATING_AUDIO');
    expect(STEP_STAGE['sound_design']).toBe('GENERATING_AUDIO');
    expect(STEP_STAGE['generate_shots']).toBe('GENERATING_SHOTS');
    expect(STEP_STAGE['final_mix']).toBe('COMPOSITING');
    expect(STEP_STAGE['timeline']).toBe('COMPOSITING');
    expect(STEP_STAGE['validate']).toBe('VALIDATING');
    expect(STEP_STAGE['final_qc']).toBe('VALIDATING');
    expect(STEP_STAGE['nonexistent_step']).toBeUndefined();
  });

  test('REG-23c-২: classifyProductionError — রেট-লিমিট/টাইমআউট/৪xx স্বতন্ত্র শ্রেণি + পুনর্চেষ্টা-যোগ্যতা', () => {
    const rl = classifyProductionError(new Error('TEMPORARILY_UNAVAILABLE: 429 too many requests'));
    expect(retryAppropriateForCategory(rl)).toBe(true);
    const timeout = classifyProductionError(new Error('প্রদানকারীর সময়সীমা পার — timeout'));
    expect(retryAppropriateForCategory(timeout)).toBe(true);
    const bad = classifyProductionError(new Error('HTTP 400: invalid request'));
    expect(retryAppropriateForCategory(bad)).toBe(false);
  });

  test('REG-23c-৩: buildProductionErrorDetail — ক্ষেত্র-সৎ, কখনো বানানো হয় না', () => {
    const d = buildProductionErrorDetail({
      error: 'Edge TTS ব্যর্থ: 429 rate limit',
      operation: 'speech',
      fallbackAttempted: true,
      fallbackResult: 'স্টোরিবোর্ড-ফলব্যাক চালু ছিল',
      retainedArtifactIds: ['art-1', 'art-2'],
    });
    expect(d.operation).toBe('speech');
    expect(d.fallbackAttempted).toBe(true);
    expect(d.fallbackResult).toContain('স্টোরিবোর্ড');
    expect(d.retainedArtifactIds).toEqual(['art-1', 'art-2']);
    expect(Array.isArray(d.nextSteps)).toBe(true);
    expect(d.nextSteps.length).toBeGreaterThan(0);
    expect(typeof d.retryAppropriate).toBe('boolean');
    // অজানা ইনপুটে null/অনুপস্থিত — কল্পনা নয়
    const bare = buildProductionErrorDetail({
      error: 'x',
      operation: null,
      fallbackAttempted: false,
      fallbackResult: null,
      retainedArtifactIds: [],
    });
    expect(bare.operation).toBeNull();
    expect(bare.fallbackResult).toBeNull();
  });
});

describe('REG-23d: প্রোডাকশন-SSE রাউট (/api/productions/[id]/events) — B8-শূন্যস্থান বন্ধ', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  test('REG-23d-১: অজানা আইডি → 404', async () => {
    const res = await GET(new Request('http://x/api/productions/nope/events'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  test(
    'REG-23d-২: সম্পন্ন প্রোডাকশনের পুনঃসংযোগ → DB-রিপ্লে ক্রমে + ঠিক একটি টার্মিনাল ইভেন্ট + স্ট্রিম বন্ধ',
    async () => {
      const p = seedProduction('conv-23', { type: 'short_film' }, { id: 'prod-23-replay', status: 'completed', finishedAt: new Date() });
      const s1 = seedProductionStep(p.id, 'script_breakdown', { seq: 1 });
      seedProductionStep(p.id, 'speech', { seq: 2 });
      seedProductionStep(p.id, 'final_mix', { seq: 3, status: 'failed', error: 'ffmpeg timeout' });

      const { frames, done } = await collectSse(
        (req: Request) => GET(req, { params: Promise.resolve({ id: p.id }) }),
        p.id,
        { until: () => false, timeoutMs: 3_000 }
      );

      const seq = frames.map(f => f.type);
      // রিপ্লে-ক্রম: production_started → ধাপগুলো ক্রমে → progress → টার্মিনাল
      expect(seq[0]).toBe('production_started');
      expect(seq.indexOf('step_start')).toBeLessThan(seq.indexOf('step_end'));
      expect(framesOf(frames, 'step_start').length).toBe(3); // প্রতিটি অ-পেন্ডিং ধাপ একবার
      expect(framesOf(frames, 'step_end').length).toBe(3);
      const failed = framesOf(frames, 'step_end').filter(f => f.status === 'failed');
      expect(failed.length).toBe(1);
      expect(String(failed[0].error)).toContain('ffmpeg');
      // ঠিক একটি টার্মিনাল + স্ট্রিম বন্ধ
      expect(framesOf(frames, 'production_finished').length).toBe(1);
      expect(framesOf(frames, 'production_finished')[0].status).toBe('completed');
      expect(done).toBe(true);
      // ধাপ-ক্রম নির্ধারক: প্রথম step_start = seq-১ ধাপ
      expect(framesOf(frames, 'step_start')[0].stepId).toBe(s1.id);
    },
    8_000
  );

  test(
    'REG-23d-৩: চলমান প্রোডাকশনে লাইভ bus-ইভেন্ট সরবরাহিত হয়, বাস-রিপ্লে-ড্রেন DB-এ আসা ধাপ পুনরায় পাঠায় না',
    async () => {
      const p = seedProduction('conv-23', { type: 'short_film' }, { id: 'prod-23-live', status: 'running' });
      const s1 = seedProductionStep(p.id, 'script_breakdown', { seq: 1 });
      seedProductionStep(p.id, 'speech', { seq: 2, status: 'running' });

      const collect = collectSse(
        (req: Request) => GET(req, { params: Promise.resolve({ id: p.id }) }),
        p.id,
        { until: fs => framesOf(fs, 'production_finished').length >= 1, timeoutMs: 4_000 }
      );
      // রাউটের bus-শ্রোতা নিবন্ধের সময়
      await new Promise(r => setTimeout(r, 150));
      prodBus.emitProduction(p.id, { type: 'step_end', productionId: p.id, stepId: s1.id, key: 'script_breakdown', status: 'done' } as never);
      prodBus.emitProduction(p.id, { type: 'production_progress', productionId: p.id, progress: 55, currentStepKey: 'speech' } as never);
      prodBus.emitProduction(p.id, { type: 'production_finished', productionId: p.id, status: 'partial' } as never);

      const { frames } = await collect;
      // লাইভ ইভেন্টগুলো এসেছে
      expect(framesOf(frames, 'production_progress').length).toBeGreaterThanOrEqual(2);
      expect(framesOf(frames, 'production_finished').length).toBe(1);
      expect(framesOf(frames, 'production_finished')[0].status).toBe('partial');
      // DB-রিপ্লে থেকে আসা ধাপগুলো step_start পায়; লাইভ step_end সংযোজিত
      const ends = framesOf(frames, 'step_end').filter(f => f.stepId === s1.id);
      expect(ends.length).toBeGreaterThanOrEqual(1);
    },
    8_000
  );
});
