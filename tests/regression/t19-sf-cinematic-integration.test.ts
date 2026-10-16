// ============================================================
// REG-19 — শর্টফিল্ম পাইপলাইনে নির্ধারক কভারেজ-পরিকল্পনার প্রকৃত
// সংযোগ (Phase-5 §9 B/F/G/H + §10 LLM-রাউন্ড-ট্রিপ সাশ্রয়)।
//
// মূল দাবি: Phase-4-এর দ্বিতীয় LLM-কল (শট-বিভাজন) সত্যিই বাদ —
// সফল রানে chatJson ঠিক ২ বারই ডাকা হয় (চিত্রনাট্য + অভিনয়),
// শট-কাঠামো নির্ধারক পরিকল্পক থেকে, প্রম্পট সিনেম্যাটিক-নির্মাতার
// ভাষায় (ইংরেজি visualEn + ফ্রেমিং + মুভমেন্ট)।
//
// Modules under test (REAL): shortFilmPipeline সম্পূর্ণ —
// script_breakdown (LLM#1 → নির্ধারক পরিকল্পক → shot-plan.json) →
// character_bible (চরিত্রহীন → সৎ-স্কিপ) → acting_plan (LLM#3) →
// speech → generate_shots (প্রকৃত generateAiShot) → sound_design
// (প্রকৃত ৫-স্তর মিক্স) → continuity (প্রতিকৃতি নেই → স্কিপ) →
// final_mix (প্রকৃত ffmpeg টাইমলাইন+মিক্স+সাবটাইটেল)।
//
// Mocked boundaries:
//  - '@/lib/agent/llm' → নকল z-ai SDK (ভিডিও সাবমিট/পোল)
//  - '@/lib/agent/sdk-helpers' → chatJson (কল#১ চিত্রনাট্য, কল#২ অভিনয়),
//    generateImageBuffer/visionCompare — কোনো প্রকৃত LLM/ইমেজ কল নেই
//  - '@/lib/agent/audio/language_controller' → synthesizeVerifiedSpeech
//    (প্রকৃত WAV বাইট ফেরায় — mediaInfo-দৈর্ঘ্য বাস্তব), resolveVoice,
//    detectLanguage, assignCharacterVoices — কোনো TTS/ASR নেই
//  - '@/lib/db' → ন্যূনতম স্টাব
//  - globalThis.fetch → নকল ডাউনলোড (প্রকৃত MP4 ফিক্সচার)
//  - fake PipelineContext (cinematic-harness)
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { mkdir } from 'fs/promises';
import path from 'path';

// ---- পরিস্থিতি-চালিত মক-অবস্থা -------------
let submitCount = 0;
const submittedBodies: Record<string, unknown>[] = [];
let chatJsonCalls = 0;
let fixtureMp4: Buffer = Buffer.alloc(0);
let fixturePng: Buffer = Buffer.alloc(0);
let fixtureWav: Buffer = Buffer.alloc(0);

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
        query: async (taskId: string) => ({
          task_status: 'SUCCESS',
          video_result: [{ url: `mock://sf-clip-${taskId}` }],
        }),
      },
    },
    chatComplete: async () => {
      throw new Error('chatComplete should not be called in this test');
    },
    parseToolCall: () => null,
  }),
}));

const SCENES_PAYLOAD = {
  title: 'শেষ চিঠি',
  logline: 'বিদায়ের আগে একটি অসমাপ্ত চিঠির গল্প',
  characters: [],
  scenes: [
    {
      location: 'পুরনো বাড়ির দালান',
      timeOfDay: 'ভোর',
      characters: [],
      action: 'ভোরের কুয়াশায় পুরনো দালানে একজন লেখক দাঁড়িয়ে',
      visualEn: 'An old riverside veranda at dawn, a lone writer standing in soft mist, warm lantern glow, wide misty river behind',
      actingNotes: 'ধীর চিন্তামগ্ন হাঁটা',
      cameraWork: '',
      ambientSound: 'পাখির ডাক',
      musicCue: 'মৃদু',
      estimatedSec: 10,
      dialogues: [],
    },
    {
      location: 'পড়ার ঘর',
      timeOfDay: 'সকাল',
      characters: [],
      action: 'জানালার পাশে বসে লেখক চিঠিটি শেষ করে',
      visualEn: 'A cozy study room in morning light, a writer finishing a letter by the window, trembling hands, dust motes in sunbeams',
      actingNotes: 'হাত সামান্য কাঁপছে',
      cameraWork: '',
      ambientSound: 'ঘড়ির টিকটিক',
      musicCue: 'বিষণ্ণ',
      estimatedSec: 12,
      dialogues: [
        { character: 'লেখক', text: 'এবার শেষ করতেই হবে।', emotion: 'দৃঢ়' },
      ],
    },
    {
      location: 'নদীর ঘাট',
      timeOfDay: 'সন্ধ্যা',
      characters: [],
      action: 'সন্ধ্যার আলোয় ঘাটে চিঠি পাঠিয়ে দেয়',
      visualEn: 'A river ghat at dusk, lamps lighting up one by one, the writer mailing a letter, boat lights reflecting on calm water',
      actingNotes: 'দীর্ঘ এক নিঃশ্বাস',
      cameraWork: '',
      ambientSound: 'নদীর জল',
      musicCue: 'মুখর',
      estimatedSec: 10,
      dialogues: [
        { character: 'লেখক', text: 'যাওয়াই ভালো।', emotion: 'বিদায়' },
      ],
    },
  ],
};

const ACTING_PAYLOAD = {
  shots: [
    { index: 1, who: 'the writer', action: 'standing still, looking at the river', gaze: 'toward the water', bodyHands: 'hands folded behind', facialExpression: 'contemplative', speaks: false, cameraMotion: 'slow push in' },
    { index: 2, who: 'the writer', action: 'writing the final line', gaze: 'at the paper', bodyHands: 'pen in right hand', facialExpression: 'determined', speaks: true, cameraMotion: 'static' },
    { index: 3, who: 'the writer', action: 'mailing the letter', gaze: 'at the boat', bodyHands: 'holding the letter out', facialExpression: 'relieved', speaks: true, cameraMotion: 'slow pull back' },
  ],
};

mock.module('@/lib/agent/sdk-helpers', () => ({
  // কল#১: চিত্রনাট্য (দৃশ্য+চরিত্র) · কল#২: অভিনয়-নির্দেশনা —
  // শট-বিভাজনের তৃতীয় কল আর নেই (Phase-5-এর মূল সাশ্রয়)
  chatJson: async (messages: { role: string; content: string }[]) => {
    chatJsonCalls++;
    const assistant = messages.find(m => m.role === 'assistant')?.content ?? '';
    if (assistant.includes('চিত্রনাট্যকার')) {
      return { data: SCENES_PAYLOAD };
    }
    if (assistant.includes('অভিনয়-শিক্ষক')) {
      return { data: ACTING_PAYLOAD };
    }
    throw new Error(` Unexpected chatJson call #${chatJsonCalls}: ${assistant.slice(0, 60)}`);
  },
  generateImageBuffer: async () => ({ buffer: fixturePng }),
  editImageBuffer: async () => {
    throw new Error('editImageBuffer not expected (no portraits)');
  },
  visionCompare: async () => 'মিলেছে — একই ব্যক্তির মুখ ও পোশাক ধরে রাখা হয়েছে',
  synthesizeSpeech: async () => {
    throw new Error('synthesizeSpeech should not be called (language_controller mocked)');
  },
  transcribeBuffer: async () => '',
  extractJson: () => null,
  imageSearchSdkFirst: async () => ({ results: [], source: 'none' as const }),
  visionAnalyze: async () => '',
  IMAGE_SIZES: ['1024x1024'],
  TTS_VOICES: ['jam', 'douji'],
  // retry.ts থেকে পুনঃ-রপ্তানি — **প্রকৃত** বাস্তায়নসহ (REG-6-সংরক্ষণ)
  TemporarilyUnavailableError: RealTemporarilyUnavailableError,
  parseRetryAfterMs: realParseRetryAfterMs,
  fullJitterDelayMs: realFullJitterDelayMs,
  withRetry: realWithRetry,
  isRateLimitErrorText: realIsRateLimitErrorText,
}));

// §১১-সীমানায় মক: TTS-কলগুলো tts-cache-এ (t8-এর একই সীমানা) — প্রকৃত
// WAV বাইট ফেরায়; language_controller নিজে **প্রকৃত** থাকে (যাচাই-চেইন,
// ভাষা-শনাক্তকরণ, কণ্ঠ-নির্বাচন — সবই আসল যুক্তি চলে)
mock.module('@/lib/agent/tts-cache', () => ({
  cachedSynthesizeSpeech: async () => ({
    buffer: fixtureWav,
    mimeType: 'audio/wav',
    ext: 'wav',
  }),
  ttsCacheStats: () => ({ hits: 0, misses: 0, inFlight: 0 }),
}));

mock.module('@/lib/db', () => ({
  db: {
    character: {
      findMany: async () => [],
      upsert: async () => ({}),
    },
  },
}));

const { shortFilmPipeline } = await import('@/lib/agent/production/pipelines/short_film');
const { parseAndValidateShotPlan } = await import('@/lib/agent/cinematic/validate');
const { getProductionMetrics } = await import('@/lib/agent/run-metrics');
const { AI_VIDEO_LIMITS } = await import('@/lib/agent/video/ai_video');
const { sizeFramingPhrase, movementPhrase } = await import('@/lib/agent/cinematic/capability_map');
const { makeFakeCtx, freshDir, cleanupRoots, buildFixtureMp4, buildPng, buildSpeechWav } = await import('../helpers/cinematic-harness');
const REAL_FETCH = globalThis.fetch;
const REAL_POLL_MS = AI_VIDEO_LIMITS.pollIntervalMs;
const REAL_COOLDOWN_MS = AI_VIDEO_LIMITS.postCompletionCooldownMs;
const g = globalThis as unknown as Record<string, unknown>;

const ALLOWED_BODY_KEYS = new Set([
  'prompt', 'duration', 'quality', 'watermark_enabled', 'image_url', 'with_audio', 'size', 'request_id',
]);

beforeEach(() => {
  submitCount = 0;
  submittedBodies.length = 0;
  chatJsonCalls = 0;
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
  const dir = await freshDir('reg19-fixture');
  fixtureMp4 = await buildFixtureMp4(dir, 'clip.mp4');
  fixturePng = await buildPng(dir, 'frame.png');
  fixtureWav = await buildSpeechWav(dir, 'line.wav');
  AI_VIDEO_LIMITS.pollIntervalMs = 250;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = 0;
}

describe('REG-19: শর্টফিল্ম পাইপলাইন × নির্ধারক কভারেজ (Phase-5)', () => {
  test('REG-19a (§9 B/F/G/H + §10): দ্বিতীয় LLM-কল বাদ, পরিকল্পনা→প্রম্পট→আর্টিফ্যাক্ট', async () => {
    const base = await freshDir('reg19a');
    const wd = path.join(base, 'work');
    const cacheRoot = path.join(base, 'cache');
    await mkdir(wd, { recursive: true });
    await mkdir(cacheRoot, { recursive: true });
    g.__shotCacheRootOverride = cacheRoot;
    (g as unknown as { __aiVideoGate?: unknown }).__aiVideoGate = undefined;

    const handle = makeFakeCtx({
      productionId: 'reg19a-prod',
      workingDir: wd,
      spec: {
        type: 'short_film' as const,
        title: 'শেষ চিঠি',
        story: 'একজন লেখকের জীবনের শেষ চিঠি লেখা ও পাঠানোর গল্প',
        durationSec: 30,
        quality: 'draft' as const,
      },
    });
    const pr = await shortFilmPipeline(handle.ctx);

    // ---- §10: LLM-রাউন্ড-ট্রিপ — Phase-4-এ ৩টি ছিল, এখন ঠিক ২টি
    // (চিত্রনাট্য + অভিনয়; শট-বিভাজনের কল নির্ধারক পরিকল্পকে গেছে)
    expect(chatJsonCalls).toBe(2);
    expect(submitCount).toBe(3); // ৩ শট (প্রি-ওয়ার্ম-জয়সহ)

    // ---- §9-N: ধাপ-কী-ক্রম (৮-স্তর) অপরিবর্তিত
    expect(handle.rec.stepKeys).toEqual([
      'script_breakdown', 'character_bible', 'acting_plan', 'speech',
      'generate_shots', 'sound_design', 'continuity', 'final_mix',
    ]);

    // ---- §9-H: পরিকল্পনা artifact — নির্ধারক কভারেজ, যাচাইকৃত
    const planArt = handle.rec.artifacts.find(a => a.fileName === 'shot-plan.json');
    expect(planArt).toBeTruthy();
    expect(planArt!.metaJson as Record<string, unknown>).toMatchObject({
      pipeline: 'short_film',
      kind: 'cinematic_plan',
      version: 1,
      shots: 3,
      beatSource: 'narrative',
    });
    const plan = JSON.parse(planArt!.buffer.toString('utf-8'));
    expect(parseAndValidateShotPlan(plan).ok).toBe(true);
    // §9-B: কাহিনি-কভারেজ — এস্টাব্লিশিং প্রথম, সমাপনি শেষ
    expect(plan.shots[0].size).toBe('establishing_wide');
    expect(plan.shots[0].subject).toBe('environment');
    const last = plan.shots[plan.shots.length - 1];
    expect(last.movement).toBe('zoom_out');
    expect(last.transitionIn).toBe('সমাপনি-বিট');
    // সৎ-নোট: নির্ধারক কভারেজ-ব্যান্ডল
    expect(handle.ctx.partialNotes.some(n => n.includes('নির্ধারক কভারেজ-পরিকল্পক'))).toBe(true);

    // ---- §9-F: প্রম্পটে পরিকল্পনার ইংরেজি দৃশ্যমান-বর্ণনা + ফ্রেমিং + মুভমেন্ট
    const b1 = String(submittedBodies[0].prompt);
    expect(b1).toContain('An old riverside veranda at dawn');
    expect(b1).toContain(sizeFramingPhrase('establishing_wide'));
    expect(b1).toContain(movementPhrase('zoom_in'));
    // bn-ফিল্মে action বাংলায় — প্রম্পট কিন্তু ইংরেজি visualEn থেকে
    // (Phase-4-এর LLM#2-এর ইংরেজি description-চুক্তি অটুট)
    expect(b1).not.toContain('ভোরের কুয়াশায়');
    // অভিনয়-টেক্সট (LLM#3) extra হিসেবে প্রম্পটে
    expect(b1).toContain('the writer');
    // সব বডি-কী ⊆ প্রোভাইডার-চুক্তি — নেটিভ ক্যামেরা-প্যারামিটার নেই
    for (const body of submittedBodies) {
      for (const key of Object.keys(body)) expect(ALLOWED_BODY_KEYS.has(key)).toBe(true);
      expect([5, 10]).toContain(body.duration);
    }

    // ---- §9-H: সংলাপ-আর্টিফ্যাক্ট (A1) — মাপা TTS-দৈর্ঘ্যসহ
    const dialogArts = handle.rec.artifacts.filter(
      a => (a.metaJson as Record<string, unknown> | undefined)?.layer === 'A1',
    );
    expect(dialogArts.length).toBe(2);
    expect((dialogArts[0].metaJson as Record<string, unknown>).character).toBe('লেখক');

    // ---- §9-H: চূড়ান্ত ভিডিও + সৎ সারসংক্ষেপ
    const finalArt = handle.rec.artifacts.filter(a => a.kind === 'video');
    expect(finalArt.length).toBeGreaterThanOrEqual(1);
    expect(finalArt[finalArt.length - 1].buffer.length).toBeGreaterThan(50_000);
    const finalMeta = finalArt[finalArt.length - 1].metaJson as Record<string, unknown>;
    expect(finalMeta.cinematicPlan).toMatchObject({ shotCount: 3, beatSource: 'narrative' });
    expect(finalMeta.lipSync).toBe(false); // §৫ — লিপ-সিঙ্কের দাবি নয়
    const cp = pr.result.cinematicPlan as { shotCount: number; beatSource: string };
    expect(cp.shotCount).toBe(3);
    expect(cp.beatSource).toBe('narrative');
    expect((pr.result.shotEngines as { engine: string }[]).every(e => e.engine === 'ai_video')).toBe(true);

    // ---- মেট্রিকস: নির্ধারক পরিকল্পক প্রকৃতভাবে চেয়েছে
    const acc = getProductionMetrics('reg19a-prod')!;
    expect(acc.plannedShots).toBe(3);
    expect(acc.planMs).toBeGreaterThanOrEqual(0);
  }, 420_000);
});
