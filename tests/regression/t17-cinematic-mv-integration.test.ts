// ============================================================
// REG-17 — মিউজিক-ভিডিও পাইপলাইনে সিনেম্যাটিক পরিকল্পনার প্রকৃত
// সংযোগ (Phase-5 §9 F/G/H/J/K)।
//
// Modules under test (REAL): musicVideoPipeline ফাংশন সম্পূর্ণ —
// song_input (প্রকৃত প্রসিডিউরাল সংশ্লেষণ) → visual_plan (নির্ধারক
// পরিকল্পক + LLM স্লট-বর্ণনা) → characters → generate_shots (প্রকৃত
// generateAiShot → submitVideoTask → ডাউনলোড → যাচাই → স্বাভাবিকীকরণ)
// → timeline (প্রকৃত ffmpeg ট্রিম/xfade/mux) → final_qc (ffprobe)।
//
// Mocked boundaries (স্পষ্ট বিবরণী):
//  - '@/lib/agent/llm' → নকল z-ai SDK (video.generations.create +
//    async.result.query — পরিস্থিতি-চালিত SUCCESS/FAIL)
//  - '@/lib/agent/sdk-helpers' → chatJson (স্লট-বর্ণনা পেলোড),
//    generateImageBuffer (PNG ফিক্সচার/থ্রো), editImageBuffer,
//    isRateLimitErrorText — কোনো প্রকৃত LLM/ইমেজ-কল নেই
//  - '@/lib/agent/local-frames' → নকল লোকাল-ফ্রেম (পরিস্থিতি-চালিত)
//  - '@/lib/db' → ন্যূনতম স্টাব (characters খালি হলে কখনো ডাকা হয় না)
//  - globalThis.fetch → নকল ডাউনলোড (প্রকৃত MP4 ফিক্সচার বাইট)
//  - fake PipelineContext (cinematic-harness) — DB/SSE ছাড়াই পাইপলাইন
//
// প্রকৃত অংশ: পরিকল্পক, ক্যাপাবিলিটি-ম্যাপ, প্রম্পট-নির্মাতা, যাচাইকারী,
// ai_video-র গেট/ক্যাশ/আইডেম্পোটেন্সি/সাবমিট-বডি, শট-ক্যাশ (টেম্প-রুট),
// মিউজিক-ইঞ্জিন, ffmpeg-এর সব ধাপ। শূন্য-ব্যয় (কোনো প্রকৃত প্রোভাইডার নেই)।
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { mkdir } from 'fs/promises';
import path from 'path';

// ---- পরিস্থিতি-চালিত মক-অবস্থা (টেস্ট প্রতি রিসেট) -------------
let submitCount = 0;
const submittedBodies: Record<string, unknown>[] = [];
/** স্টোরিবোর্ড-ইমেজ-জেনের প্রম্পট-রেকর্ড (cinematic_motion পথের
 *  প্রজন্ম-বাউন্ডারি — REG-17e) */
const imageGenPrompts: string[] = [];
/** কোন টাস্কগুলো FAIL ঘোষণা করবে (mocktask-N আইডি) */
let failTasks = new Set<string>();
/** ইমেজ-জেন ফলব্যাক: 'png' = ফিক্সচার, 'throw' = ব্যর্থ */
let imageGenMode: 'png' | 'throw' = 'png';
/** লোকাল-প্রসিডিউরাল ফ্রেম: 'ok' = প্রকৃত PNG, 'throw' = ব্যর্থ */
let localFrameMode: 'ok' | 'throw' = 'ok';
let fixtureMp4: Buffer = Buffer.alloc(0);
let fixturePng: Buffer = Buffer.alloc(0);

const {
  withRetry: realWithRetry,
  parseRetryAfterMs: realParseRetryAfterMs,
  fullJitterDelayMs: realFullJitterDelayMs,
  isRateLimitErrorText: realIsRateLimitErrorText,
  TemporarilyUnavailableError: RealTemporarilyUnavailableError,
} = await import('@/lib/agent/retry');


mock.module('@/lib/agent/llm', () => ({
  getZAI: async () => ({
    video: {
      generations: {
        create: async (body: Record<string, unknown>) => {
          submitCount++;
          submittedBodies.push(body);
          return { id: `mocktask-${submitCount}`, model: 'cogvideox-3' };
        },
      },
    },
    async: {
      result: {
        query: async (taskId: string) => {
          if (failTasks.has(taskId)) {
            return { task_status: 'FAIL' };
          }
          return { task_status: 'SUCCESS', video_result: [{ url: `mock://clip-${taskId}` }] };
        },
      },
    },
    chatComplete: async () => {
      throw new Error('chatComplete should not be called in this test');
    },
    parseToolCall: () => null,
  }),
}));

mock.module('@/lib/agent/sdk-helpers', () => ({
  // music_video visual_plan-এর একমাত্র LLM-কল: স্লট-বর্ণনা + স্টাইল
  chatJson: async () => ({
    data: {
      visualStyle: 'rain-soaked neon Dhaka aesthetic',
      characters: [],
      shots: [
        { description: 'A rickshaw puller waits under a neon sign as heavy rain falls', label: 'শট ১ — নিয়ন বৃষ্টি', character: null },
        { description: 'The city skyline glows through wet glass as the music resolves', label: 'শট ২ — বিদায় দৃশ্য', character: null },
      ],
    },
  }),
  generateImageBuffer: async (prompt: string) => {
    imageGenPrompts.push(String(prompt));
    if (imageGenMode === 'throw') throw new Error('image-gen unavailable (mock)');
    return { buffer: fixturePng };
  },
  editImageBuffer: async () => {
    throw new Error('editImageBuffer not expected in this test');
  },
  visionCompare: async () => 'similar',
  // গ্রাফ-লোডের জন্য রপ্তানি (language_controller/tts-cache লোড হয়, কল হয় না)
  synthesizeSpeech: async () => {
    throw new Error('synthesizeSpeech should not be called in this test');
  },
  transcribeBuffer: async () => '',
  extractJson: () => null,
  imageSearchSdkFirst: async () => ({ results: [], source: 'none' as const }),
  visionAnalyze: async () => '',
  IMAGE_SIZES: ['1024x1024'],
  TTS_VOICES: ['jam', 'douji'],
  // retry.ts থেকে পুনঃ-রপ্তানি — **প্রকৃত** বাস্তায়নসহ (bun-এর mock.module
  // sdk-helpers-কে মক করলে পুনঃ-রপ্তানির লক্ষ্য retry.ts-ও ওই মানগুলো
  // পেয়ে যায় — নকল বসালে REG-6 ভাঙে; প্রকৃতই বসানো হলো)
  TemporarilyUnavailableError: RealTemporarilyUnavailableError,
  parseRetryAfterMs: realParseRetryAfterMs,
  fullJitterDelayMs: realFullJitterDelayMs,
  withRetry: realWithRetry,
  isRateLimitErrorText: realIsRateLimitErrorText,
}));

mock.module('@/lib/agent/local-frames', () => ({
  LOCAL_FRAME_LABEL: 'লোকাল প্রসিডিউরাল ফ্রেম (নিউরাল নয়)',
  generateLocalFrame: async (req: { outputPath: string }) => {
    if (localFrameMode === 'throw') throw new Error('local-frame unavailable (mock)');
    const { writeFile } = await import('fs/promises');
    await writeFile(req.outputPath, fixturePng);
    return { path: req.outputPath };
  },
}));

mock.module('@/lib/db', () => ({
  db: {
    character: {
      findMany: async () => [],
      upsert: async () => ({}),
    },
  },
}));

const { musicVideoPipeline } = await import('@/lib/agent/production/pipelines/music_video');
const { parseAndValidateShotPlan } = await import('@/lib/agent/cinematic/validate');
const { getProductionMetrics } = await import('@/lib/agent/run-metrics');
const { AI_VIDEO_LIMITS } = await import('@/lib/agent/video/ai_video');
const { runFfmpeg } = await import('@/lib/media/ffmpeg');
const { makeFakeCtx, freshDir, cleanupRoots, buildFixtureMp4, buildPng } = await import('../helpers/cinematic-harness');
const { sizeFramingPhrase, movementPhrase } = await import('@/lib/agent/cinematic/capability_map');
const REAL_FETCH = globalThis.fetch;
const REAL_POLL_MS = AI_VIDEO_LIMITS.pollIntervalMs;
const REAL_COOLDOWN_MS = AI_VIDEO_LIMITS.postCompletionCooldownMs;
const g = globalThis as unknown as Record<string, unknown>;

/** প্রোভাইডার-চুক্তির অনুমোদিত কী — প্রোব-যাচাইকৃত (ai_video.ts হেডার) */
const ALLOWED_BODY_KEYS = new Set([
  'prompt', 'duration', 'quality', 'watermark_enabled', 'image_url', 'with_audio', 'size', 'request_id',
]);

function mvSpec() {
  return {
    type: 'music_video' as const,
    title: 'নিয়ন বৃষ্টি',
    idea: 'রাতের ঢাকায় বৃষ্টি ও নিয়ন-আলো',
    durationSec: 20,
    quality: 'draft' as const,
    mood: 'বৃষ্টিভেজা রাত',
  };
}

async function newScenario(prefix: string): Promise<{ wd: string; cacheRoot: string }> {
  const base = await freshDir(prefix);
  const wd = path.join(base, 'work');
  const cacheRoot = path.join(base, 'cache');
  await mkdir(wd, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  g.__shotCacheRootOverride = cacheRoot;
  (g as unknown as { __aiVideoGate?: unknown }).__aiVideoGate = undefined;
  return { wd, cacheRoot };
}

beforeEach(() => {
  submitCount = 0;
  submittedBodies.length = 0;
  imageGenPrompts.length = 0;
  failTasks = new Set();
  imageGenMode = 'png';
  localFrameMode = 'ok';
  globalThis.fetch = (async () => new Response(new Uint8Array(fixtureMp4), { status: 200 })) as typeof fetch;
});

afterAll(async () => {
  AI_VIDEO_LIMITS.pollIntervalMs = REAL_POLL_MS;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = REAL_COOLDOWN_MS;
  globalThis.fetch = REAL_FETCH;
  delete g.__shotCacheRootOverride;
  await cleanupRoots();
  // মক-পরিস্রবণ-স্বাস্থ্য: bun-এর mock.module প্রক্রিয়া-ব্যাপী — পরের
  // টেস্ট-ফাইলগুলো (t2–t9) প্রকৃত মডিউল ফেরো পায় (REG-6/8-সংরক্ষণ)
  mock.restore();
});

// স্যুট-সেটআপ: প্রকৃত ফিক্সচার + মিলিসেকেন্ড-স্কেল পোল/কুলডাউন
{
  const dir = await freshDir('reg17-fixture');
  fixtureMp4 = await buildFixtureMp4(dir);
  fixturePng = await buildPng(dir);
  AI_VIDEO_LIMITS.pollIntervalMs = 250;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = 0;
}

describe('REG-17: MV পাইপলাইন × সিনেম্যাটিক পরিকল্পনা (Phase-5 F/G/H/J/K)', () => {
  test('REG-17a (§9 F/G/H): সুখী পথ — পরিকল্পনা→প্রম্পট→প্রোভাইডার→আর্টিফ্যাক্ট-ম্যাপ', async () => {
    const { wd } = await newScenario('reg17a');
    const handle = makeFakeCtx({ productionId: 'reg17a-prod', spec: mvSpec(), workingDir: wd });
    const pr = await musicVideoPipeline(handle.ctx);

    // §9-H: পরিকল্পনা প্রকৃত পাইপলাইনে পৌঁছেছে — shot-plan.json artifact
    const planArt = handle.rec.artifacts.find(a => a.fileName === 'shot-plan.json');
    expect(planArt).toBeTruthy();
    expect(planArt!.kind).toBe('text');
    expect(planArt!.mimeType).toBe('application/json');
    expect(planArt!.metaJson).toMatchObject({ pipeline: 'music_video', kind: 'cinematic_plan', version: 1, shots: 2, beatSource: 'bpm_grid_estimate' });
    const plan = JSON.parse(planArt!.buffer.toString('utf-8'));
    const v = parseAndValidateShotPlan(plan);
    expect(v.ok).toBe(true);
    expect(plan.shots.map((s: { shotId: string }) => s.shotId)).toEqual(['S01', 'S02']);
    expect(plan.shots[0].size).toBe('establishing_wide');
    expect(plan.shots[1].movement).toBe('zoom_out');

    // §9-F (প্রকৃত সীমানায়): প্রম্পটে পরিকল্পনার action+ফ্রেমিং+মুভমেন্ট
    expect(submitCount).toBe(2); // প্রি-ওয়ার্ম(শট১) + শট২ — ক্যাশ-জয় সহ
    expect(submittedBodies.length).toBe(2);
    const b1 = submittedBodies[0];
    expect(String(b1.prompt)).toContain('A rickshaw puller waits under a neon sign as heavy rain falls');
    expect(String(b1.prompt)).toContain(sizeFramingPhrase('establishing_wide'));
    expect(String(b1.prompt)).toContain(movementPhrase('zoom_in'));
    const b2 = submittedBodies[1];
    expect(String(b2.prompt)).toContain('The city skyline glows through wet glass as the music resolves');
    expect(String(b2.prompt)).toContain(sizeFramingPhrase('wide'));
    expect(String(b2.prompt)).toContain(movementPhrase('zoom_out'));
    // স্টাইল-টেক্সটও প্রম্পটে
    expect(String(b1.prompt)).toContain('rain-soaked neon Dhaka aesthetic');

    // §9-G: প্রোভাইডার-বডির কী ⊆ প্রোব-যাচাইকৃত চুক্তি — কোনো নেটিভ
    // ক্যামেরা/মুভমেন্ট/অ্যাঙ্গেল-প্যারামিটার কখনো পাঠানো হয় না
    for (const body of submittedBodies) {
      for (const key of Object.keys(body)) {
        expect(ALLOWED_BODY_KEYS.has(key)).toBe(true);
      }
      expect([5, 10]).toContain(body.duration);
    }

    // §9-H: চূড়ান্ত আর্টিফ্যাক্ট-ম্যাপিং — resultJson + metaJson সারসংক্ষেপ
    const finalArt = handle.rec.artifacts.filter(a => a.kind === 'video');
    expect(finalArt.length).toBeGreaterThanOrEqual(1);
    const cp = pr.result.cinematicPlan as { shotCount: number; beatSource: string; deliveryCounts: Record<string, number> };
    expect(cp.shotCount).toBe(2);
    expect(cp.beatSource).toBe('bpm_grid_estimate');
    expect(cp.deliveryCounts.prompt_guided).toBe(2);
    const finalMeta = finalArt[finalArt.length - 1].metaJson as Record<string, unknown>;
    expect(finalMeta.cinematicPlan).toMatchObject({ shotCount: 2, beatSource: 'bpm_grid_estimate' });
    expect(Array.isArray(finalMeta.cutPoints)).toBe(true);
    expect(finalArt[finalArt.length - 1].buffer.length).toBeGreaterThan(50_000);

    // §9-N: ধাপ-কী-ক্রম Phase-4-এর মতোই (SSE-সামঞ্জস্য)
    expect(handle.rec.stepKeys).toEqual(['song_input', 'visual_plan', 'characters', 'generate_shots', 'timeline', 'final_qc']);
    // মেট্রিকস: পরিকল্পক প্রকৃতভাবে চেয়েছে
    const acc = getProductionMetrics('reg17a-prod')!;
    expect(acc.plannedShots).toBe(2);
    expect(acc.planMs).toBeGreaterThanOrEqual(0);
    // সৎ-লেবেল: লিপ-সিঙ্ক নেই (result.notes-এ চূড়ান্ত প্রতিবেদন)
    expect(String(pr.result.honestLabel)).toContain('প্রকৃত AI');
    expect((pr.result.notes as string[]).some(n => n.includes('লিপ-সিঙ্ক নেই'))).toBe(true);
  }, 240_000);

  test('REG-17b (§9 K): ব্যর্থ শট বাদ — সফল শট বাঁচে, পরিকল্পনা-নোট সৎ', async () => {
    const { wd } = await newScenario('reg17b');
    // শট-২ প্রোভাইডারে FAIL + ইমেজ-ফলব্যাকও অচল + লোকাল-ফ্রেমও অচল → বাদ
    imageGenMode = 'throw';
    localFrameMode = 'throw';
    failTasks = new Set(['mocktask-2']);
    const handle = makeFakeCtx({ productionId: 'reg17b-prod', spec: mvSpec(), workingDir: wd });
    const pr = await musicVideoPipeline(handle.ctx);

    // শট-১ সফল (প্রি-ওয়ার্ম), শট-২ দুই-বার সাবমিট-চেষ্টা নয় — একবারই
    expect(submitCount).toBe(2);
    // সৎ বাদ-নোট (পাইপলাইন ASCII-সংখ্যা ব্যবহার করে: "শট 2 ...")
    expect(handle.ctx.partialNotes.some(n => n.includes('শট 2') && n.includes('শট বাদ'))).toBe(true);
    // চূড়ান্ত ভিডিও আছে (১টি সফল শট দিয়েই টাইমলাইন চলেছে)
    const finalArt = handle.rec.artifacts.filter(a => a.kind === 'video');
    expect(finalArt.length).toBeGreaterThanOrEqual(1);
    expect(finalArt[finalArt.length - 1].buffer.length).toBeGreaterThan(50_000);
    const finalMeta = finalArt[finalArt.length - 1].metaJson as Record<string, unknown>;
    // কাট-পয়েন্ট কেবল বাঁচা শটগুলির
    expect((finalMeta.cutPoints as unknown[]).length).toBe(1);
    expect(finalMeta.cinematicPlan).toMatchObject({ shotCount: 2 }); // পরিকল্পনার সৎ পূর্ণ-রেকর্ড
    // পরিকল্পনা-artifact অপরিবর্তিত থাকে (২ শটই নথিভুক্ত — বাদ-পরেও)
    const planArt = handle.rec.artifacts.find(a => a.fileName === 'shot-plan.json');
    expect(planArt!.metaJson).toMatchObject({ shots: 2 });
    // শট-ইঞ্জিন রেকর্ড: কেবল সফলটি
    expect((pr.result.shotEngines as { engine: string }[]).length).toBe(1);
    expect((pr.result.shotEngines as { engine: string }[])[0].engine).toBe('ai_video');
  }, 240_000);

  test('REG-17c (§9 J): বাতিল — প্রথম শটের পরে পরবর্তী সাবমিট আটকায়', async () => {
    const { wd } = await newScenario('reg17c');
    const handle = makeFakeCtx({ productionId: 'reg17c-prod', spec: mvSpec(), workingDir: wd, cancelAfterChecks: 1 });
    let caught: unknown;
    try {
      await musicVideoPipeline(handle.ctx);
    } catch (err) {
      caught = err;
    }
    // CancelledError প্রচারিত (রানারের বাতিল-পথের একই নাম-চুক্তি)
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe('CancelledError');
    // কেবল ১টি প্রোভাইডার-সাবমিট (শট-১) — শট-২ কখনো জমা হয়নি
    expect(submitCount).toBe(1);
    // পরিকল্পনা-artifact বাতিলের আগেই নথিভুক্ত হয়েছিল
    expect(handle.rec.artifacts.some(a => a.fileName === 'shot-plan.json')).toBe(true);
    // চূড়ান্ত ধাপগুলো চলেনি — কোনো ভুয়া সমাপ্তি নয়
    expect(handle.rec.stepKeys).not.toContain('timeline');
    expect(handle.rec.stepKeys).not.toContain('final_qc');
    expect(handle.rec.artifacts.some(a => a.kind === 'video')).toBe(false);
  }, 240_000);

  test('REG-17d (§9 K/H): প্রোভাইডার-ব্যর্থি স্টোরিবোর্ড-ফলব্যাক — শট-ম্যাপড আর্টিফ্যাক্ট + সৎ লেবেল', async () => {
    const { wd } = await newScenario('reg17d');
    // শট-২ প্রোভাইডারে FAIL কিন্তু ইমেজ-ফলব্যাক সফল → স্টোরিবোর্ড+ক্যামেরা-মোশন
    failTasks = new Set(['mocktask-2']);
    const handle = makeFakeCtx({ productionId: 'reg17d-prod', spec: mvSpec(), workingDir: wd });
    const pr = await musicVideoPipeline(handle.ctx);

    // দুই শটের সম্পূর্ণ ভিডিও — ফলব্যাকে শট হারায়নি
    const finalArt = handle.rec.artifacts.filter(a => a.kind === 'video');
    expect(finalArt.length).toBeGreaterThanOrEqual(1);
    expect((finalMeta0(finalArt).cutPoints as unknown[]).length).toBe(2);

    // স্টোরিবোর্ড-আর্টিফ্যাক্ট সঠিক শটে ম্যাপড (shotId/size/movement/delivery)
    const sb = handle.rec.artifacts.find(a => a.fileName === 'storyboard-shot-2.png');
    expect(sb).toBeTruthy();
    expect(sb!.metaJson as Record<string, unknown>).toMatchObject({ shotId: 'S02', size: 'wide', movement: 'zoom_out', delivery: 'prompt_guided', cameraMove: 'zoom_out' });
    expect(String(sb!.metaJson!.note)).toContain('ফলব্যাক');
    // ইঞ্জিন-রেকর্ড সৎ: শট-২ স্টোরিবোর্ড-ফলব্যাক (ক্লাউড-ইমেজ + KenBurns)
    const engines = pr.result.shotEngines as { index: number; engine: string }[];
    expect(engines.find(e => e.index === 2)?.engine).toBe('storyboard_fallback');
    expect(String(pr.result.honestLabel)).toContain('1/2');
    expect(String(pr.result.honestLabel)).toContain('ফলব্যাক');
  }, 240_000);

  test('REG-17e (§15, P5-5a): cinematicOverrides → প্রকৃত পাইপলাইনে সৎ ডাউনগ্রেড (orbit→pan_right)', async () => {
    const { wd } = await newScenario('reg17e');
    // cinematic_motion ইঞ্জিন + শট-২-এর মুভমেন্ট-ওভাররাইড 'orbit' — §2.5:
    // ওভাররাইড ক্যাপাবিলিটি-ম্যাপিং-এর পরে প্রযোজ্য → সৎ ডাউনগ্রেড-রায়
    const spec = {
      ...mvSpec(),
      videoEngine: 'cinematic_motion' as const,
      cinematicOverrides: { shots: [{ index: 1, movement: 'orbit' as const }] },
    };
    const handle = makeFakeCtx({ productionId: 'reg17e-prod', spec, workingDir: wd });
    const pr = await musicVideoPipeline(handle.ctx);

    // (ক) পরিকল্পনা-artifact: ওভাররাইড বসেছে + ডাউনগ্রেড সৎভাবে নথিভুক্ত
    const planArt = handle.rec.artifacts.find(a => a.fileName === 'shot-plan.json');
    expect(planArt).toBeTruthy();
    const plan = JSON.parse(planArt!.buffer.toString('utf-8'));
    expect(parseAndValidateShotPlan(plan).ok).toBe(true);
    expect(plan.shots.length).toBe(4); // draft cinematic: min(৮, ceil(২০/৬))
    const s2 = plan.shots[1];
    expect(s2.shotId).toBe('S02');
    expect(s2.movement).toBe('orbit');
    expect(s2.delivery).toBe('downgraded_to_local');
    expect(s2.fallbackMove).toBe('pan_right');
    const mvAdjs = plan.adjustments.filter((a: { field: string }) => a.field === 'shot.S02.movement');
    expect(mvAdjs.length).toBe(2); // ব্যবহারকারীর নির্বাচন + ইঞ্জিন-ডাউনগ্রেড
    expect(mvAdjs[0]).toMatchObject({ field: 'shot.S02.movement', from: 'pan_right', to: 'orbit' });
    expect(String(mvAdjs[0].reason)).toContain('ব্যবহারকারীর নির্বাচন');
    expect(mvAdjs[1]).toMatchObject({ field: 'shot.S02.movement', from: 'orbit', to: 'pan_right' });
    expect(String(mvAdjs[1].reason)).toContain('cinematic_motion');
    expect(plan.adjustments.length).toBe(2); // এই রানে আর কোনো সমন্বয় নেই
    expect(planArt!.metaJson).toMatchObject({ shots: 4, adjustments: 2 });

    // স্টোরিবোর্ড-আর্টিফ্যাক্ট: প্রজন্ম-পথ ডাউনগ্রেড বহন করে — মুভমেন্ট
    // 'orbit' (পরিকল্পনার সৎ রেকর্ড), ক্যামেরা-মোশন pan_right (লোকাল KenBurns)
    const sb = handle.rec.artifacts.find(a => a.fileName === 'storyboard-shot-2.png');
    expect(sb).toBeTruthy();
    expect(sb!.metaJson).toMatchObject({
      shotId: 'S02',
      size: 'wide',
      movement: 'orbit',
      delivery: 'downgraded_to_local',
      cameraMove: 'pan_right',
    });
    // KenBurns-ক্লিপ আসলে fallbackMove দিয়েই চলেছে (ধাপ-বিবরণীতে সৎ)
    expect(handle.rec.stepDetails['generate_shots'].some(d => d.includes('মোশন ক্লিপ (pan_right)'))).toBe(true);

    // (খ) সৎ লেবেল: ফলাফল-সারসংক্ষেপে ডাউনগ্রেড-গণনা + সীমা-ঘোষণা
    const cp = pr.result.cinematicPlan as {
      shotCount: number;
      deliveryCounts: Record<string, number>;
      limitations: string[];
    };
    expect(cp.shotCount).toBe(4);
    expect(cp.deliveryCounts.downgraded_to_local).toBe(1);
    expect(cp.deliveryCounts.local_motion).toBe(3);
    expect(cp.deliveryCounts.prompt_guided).toBe(0);
    expect(cp.limitations.some((l: string) => l.includes('অরবিট'))).toBe(true);
    expect(handle.ctx.partialNotes.some(n => n.includes('সৎ-সমন্বয়'))).toBe(true);
    const finalArt = handle.rec.artifacts.filter(a => a.kind === 'video');
    expect(finalArt.length).toBeGreaterThanOrEqual(1);
    const finalMeta = finalArt[finalArt.length - 1].metaJson as Record<string, unknown>;
    expect((finalMeta.cinematicPlan as { deliveryCounts: Record<string, number> }).deliveryCounts.downgraded_to_local).toBe(1);
    expect(String(finalMeta.honestLabel)).toContain('cinematic_motion');
    // স্টোরিবোর্ড-ইমেজ প্রম্পটও পরিকল্পনার শট থেকেই (ফ্রেমিং-বাক্যসহ)
    expect(imageGenPrompts.length).toBe(4);
    expect(imageGenPrompts[1]).toContain(sizeFramingPhrase('wide'));

    // (গ) প্রোভাইডার-সাবমিট: cinematic_motion পথে ভিডিও-সাবমিট হয় না
    // (স্টোরিবোর্ড-ইমেজ + লোকাল ক্যামেরা-মোশন) — সেটিই সৎ; ভবিষ্যতে কোনো
    // ভিডিও-সাবমিট যোগ হলে প্রম্পটে পরিকল্পনার মুভমেন্ট-বাক্য থাকতেই হবে।
    expect(submitCount).toBe(0);
    for (const body of submittedBodies) {
      expect(String((body as { prompt: unknown }).prompt)).toContain(movementPhrase('orbit'));
    }
  }, 240_000);
});

function finalMeta0(arts: { metaJson?: Record<string, unknown> }[]): Record<string, unknown> {
  return arts[arts.length - 1].metaJson ?? {};
}
