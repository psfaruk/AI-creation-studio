// ============================================================
// REGRESSION TEST 21 — SF pipeline dialogue honesty contracts
// (Recovery R-FIX-2 — Critical Defects A/B pipeline halves)
//
// Locks the NEW pipeline contracts that the 2026-10-16 real run
// proved missing:
//  - REG-21a (B-F02/D-F05/D-F09 — the P0): a dialogue line whose
//    whole voice-chain FAILS verification is NOT mixed into the
//    film — subtitle-only + honest note + counted separately +
//    the headline verdict loses "চমৎকার" (real-run proof: 10.6s
//    of garbage for "বৃষ্টি ভালোই লাগে।" was mixed under a
//    "চমৎকার" headline).
//  - REG-21b (C-F03/C-F04/C-F07/B-F06): film-end audio overflow
//    is detected + honestly noted (no silent truncation), and the
//    per-line timing contract is persisted (startSec/endSec/
//    measuredSec/sampleRate + artifact-ID join on the final video
//    + FULL text + true voice provenance).
//
// Boundaries (t19-প্যাটার্ন): provider-level mocks (llm.getZAI →
// video generation + fetch override), tts-cache engine-boundary
// mock (real language_controller verification chain + REAL ffmpeg
// audioQuality on the mock WAVs), chatJson → fixture payloads.
// REAL: cinematic planner, prompt builders, SF pipeline logic,
// shot cache, ffmpeg assembly. No network. No provider.
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import path from 'path';
import { mkdir } from 'fs/promises';
import { encodeWav } from '@/lib/agent/audio/pcm';
import { toneWavOfSeconds } from '../helpers/speech-wav';

let submitCount = 0;
const submittedBodies: Record<string, unknown>[] = [];
let chatJsonCalls = 0;
let fixtureMp4: Buffer = Buffer.alloc(0);
let fixturePng: Buffer = Buffer.alloc(0);
/** 1.2s — duration-healthy for a 2–4-word Bengali line */
let okWav: Buffer = Buffer.alloc(0);
/** 0.05s — far too short ⇒ every chain candidate FAILS verification */
let tinyWav: Buffer = Buffer.alloc(0);
/** 11s — duration-healthy for a ~20-word line, long enough to overflow a 30s film */
let longWav: Buffer = Buffer.alloc(0);

/** Test-mode switch (read at call time) */
let mode: 'failgate' | 'overflow' = 'failgate';

const {
  withRetry: realWithRetry,
  parseRetryAfterMs: realParseRetryAfterMs,
  fullJitterDelayMs: realFullJitterDelayMs,
  isRateLimitErrorText: realIsRateLimitErrorText,
  TemporarilyUnavailableError: RealTemporarilyUnavailableError,
} = await import('@/lib/agent/retry');

function wavOfSeconds(sec: number): Buffer {
  const sr = 24000;
  const n = Math.round(sec * sr);
  return encodeWav(new Float32Array(n), new Float32Array(n), sr);
}

/**
 * D-2: সুস্থ-পথের ফিক্সচার এখন অ-নীরব টোন (RMS ≈ −১৩.৫dB) —
 * যাচাইকারী নীরবতা প্রত্যাখ্যান করে বলে বিশুদ্ধ-নীরব WAV আর
 * "duration-healthy" হতে পারে না। tinyWav (০.০৫সে.) নীরবই থাকতে পারে —
 * সেটি দৈর্ঘ্য-গেটেই ব্যর্থ হয়।
 */

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
          video_result: [{ url: `mock://t21-clip-${taskId}` }],
        }),
      },
    },
    chatComplete: async () => {
      throw new Error('chatComplete should not be called in this test');
    },
    parseToolCall: () => null,
  }),
}));

const LINE1_SHORT = 'এবার শেষ করতেই হবে।';
const LINE2_SHORT = 'যাওয়াই ভালো।';
const LINE1_LONG =
  'আজ সকালের এই আলোয় আমার জীবনের শেষ চিঠিটি আমি নিজ হাতে শেষ করে দেব বলেই অতএব বসে আছি এতক্ষণ।';
const LINE2_LONG =
  'তোমার প্রতিটি স্মৃতি বুকে নিয়ে এই শহর ছেড়ে চলে যাওয়াই আমার পক্ষে এখন সর্বোচ্চ ভালো সিদ্ধান্ত হবে বলেই মনে হচ্ছে।';

function scenesPayload(longLines: boolean) {
  const [l1, l2] = longLines ? [LINE1_LONG, LINE2_LONG] : [LINE1_SHORT, LINE2_SHORT];
  return {
    title: 'শেষ চিঠি',
    logline: 'বিদায়ের আগে একটি অসমাপ্ত চিঠির গল্প',
    // শীর্ষ-স্তরের চরিত্র-তালিকা — এখান থেকেই প্রতি-চরিত্র কণ্ঠ বণ্টন হয়
    // (লেখক→নবনীতা, মাঝি→প্রদীপ) — ফলে মাঝি-র লাইন নিজের কণ্ঠে প্রথম-লাইন
    // হিসেবে verify:true পথে যায় এবং যাচাই-চেইন সত্যিই চলে
    characters: [
      { name: 'লেখক', appearancePrompt: 'a lonely middle-aged writer with tired eyes' },
      { name: 'মাঝি', appearancePrompt: 'an old river boatman with a grey beard' },
    ],
    scenes: [
      {
        location: 'পুরনো বাড়ির দালান',
        timeOfDay: 'ভোর',
        characters: [],
        action: 'ভোরের কুয়াশায় পুরনো দালানে একজন লেখক দাঁড়িয়ে',
        visualEn:
          'An old riverside veranda at dawn, a lone writer standing in soft mist, warm lantern glow, wide misty river behind',
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
        visualEn:
          'A cozy study room in morning light, a writer finishing a letter by the window, trembling hands, dust motes in sunbeams',
        actingNotes: 'হাত সামান্য কাঁপছে',
        cameraWork: '',
        ambientSound: 'ঘড়ির টিকটিক',
        musicCue: 'বিষণ্ণ',
        estimatedSec: 12,
        dialogues: [{ character: 'লেখক', text: l1, emotion: 'দৃঢ়' }],
      },
      {
        location: 'নদীর ঘাট',
        timeOfDay: 'সন্ধ্যা',
        characters: [],
        action: 'সন্ধ্যার আলোয় ঘাটে চিঠি পাঠিয়ে দেয়',
        visualEn:
          'A river ghat at dusk, lamps lighting up one by one, the writer mailing a letter, boat lights reflecting on calm water',
        actingNotes: 'দীর্ঘ এক নিঃশ্বাস',
        cameraWork: '',
        ambientSound: 'নদীর জল',
        musicCue: 'মুখর',
        estimatedSec: 10,
        dialogues: [{ character: 'মাঝি', text: l2, emotion: 'বিদায়' }],
      },
    ],
  };
}

const ACTING_PAYLOAD = {
  shots: [
    { index: 1, who: 'the writer', action: 'standing still, looking at the river', gaze: 'toward the water', bodyHands: 'hands folded behind', facialExpression: 'contemplative', speaks: false, cameraMotion: 'slow push in' },
    { index: 2, who: 'the writer', action: 'writing the final line', gaze: 'at the paper', bodyHands: 'pen in right hand', facialExpression: 'determined', speaks: true, cameraMotion: 'static' },
    { index: 3, who: 'the writer', action: 'mailing the letter', gaze: 'at the boat', bodyHands: 'holding the letter out', facialExpression: 'relieved', speaks: true, cameraMotion: 'slow pull back' },
  ],
};

mock.module('@/lib/agent/sdk-helpers', () => ({
  chatJson: async (messages: { role: string; content: string }[]) => {
    chatJsonCalls++;
    const assistant = messages.find(m => m.role === 'assistant')?.content ?? '';
    if (assistant.includes('চিত্রনাট্যকার')) {
      return { data: scenesPayload(mode === 'overflow') };
    }
    if (assistant.includes('অভিনয়-শিক্ষক')) {
      return { data: ACTING_PAYLOAD };
    }
    throw new Error(`Unexpected chatJson call #${chatJsonCalls}: ${assistant.slice(0, 60)}`);
  },
  generateImageBuffer: async () => ({ buffer: fixturePng }),
  editImageBuffer: async () => {
    throw new Error('editImageBuffer not expected (no portraits)');
  },
  visionCompare: async () => 'মিলেছে — একই ব্যক্তির মুখ ও পোশাক ধরে রেখে রাখা হয়েছে',
  synthesizeSpeech: async () => {
    throw new Error('synthesizeSpeech should not be called (tts-cache boundary)');
  },
  transcribeBuffer: async () => '',
  extractJson: () => null,
  imageSearchSdkFirst: async () => ({ results: [], source: 'none' as const }),
  visionAnalyze: async () => '',
  IMAGE_SIZES: ['1024x1024'],
  TTS_VOICES: ['jam', 'douji'],
  TemporarilyUnavailableError: RealTemporarilyUnavailableError,
  parseRetryAfterMs: realParseRetryAfterMs,
  fullJitterDelayMs: realFullJitterDelayMs,
  withRetry: realWithRetry,
  isRateLimitErrorText: realIsRateLimitErrorText,
}));

// §১১-সীমানায় মক: ইঞ্জিন-সীমানায় (tts-cache) — ভাষা-নিয়ন্ত্রকের প্রকৃত
// যাচাই-চেইন প্রকৃত ffmpeg দিয়েই চলে। mode-ভেদে ভিন্ন WAV:
//  - failgate: লাইন-২-এর টেক্সটে ০.০৫ সে. WAV → পুরো চেইন যাচাই-ব্যর্থ
//  - overflow: উভয় লাইনে ১১ সে. WAV → চলচ্চিত্র-শেষ ছাড়িয়ে যায়
mock.module('@/lib/agent/tts-cache', () => ({
  cachedSynthesizeSpeech: async (text: string, _voice: string, _speed: number) => {
    if (mode === 'failgate') {
      return {
        buffer: text.includes('যাওয়াই ভালো') ? tinyWav : okWav,
        mimeType: 'audio/wav',
        ext: 'wav',
      };
    }
    return { buffer: longWav, mimeType: 'audio/wav', ext: 'wav' };
  },
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
const { makeFakeCtx, freshDir, cleanupRoots, buildFixtureMp4, buildPng } = await import(
  '../helpers/cinematic-harness'
);
const REAL_FETCH = globalThis.fetch;
const { AI_VIDEO_LIMITS } = await import('@/lib/agent/video/ai_video');
const REAL_POLL_MS = AI_VIDEO_LIMITS.pollIntervalMs;
const REAL_COOLDOWN_MS = AI_VIDEO_LIMITS.postCompletionCooldownMs;
const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  submitCount = 0;
  submittedBodies.length = 0;
  chatJsonCalls = 0;
  mode = 'failgate';
  globalThis.fetch = (async () => new Response(new Uint8Array(fixtureMp4), { status: 200 })) as typeof fetch;
});

afterAll(async () => {
  AI_VIDEO_LIMITS.pollIntervalMs = REAL_POLL_MS;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = REAL_COOLDOWN_MS;
  globalThis.fetch = REAL_FETCH;
  delete g.__shotCacheRootOverride;
  await cleanupRoots();
  mock.restore();
});

{
  const dir = await freshDir('reg21-fixture');
  fixtureMp4 = await buildFixtureMp4(dir, 'clip.mp4');
  fixturePng = await buildPng(dir, 'frame.png');
  okWav = toneWavOfSeconds(1.2);
  tinyWav = wavOfSeconds(0.05);
  longWav = toneWavOfSeconds(11);
  AI_VIDEO_LIMITS.pollIntervalMs = 250;
  AI_VIDEO_LIMITS.postCompletionCooldownMs = 0;
}

async function runPipeline(tag: string) {
  const base = await freshDir(tag);
  const wd = path.join(base, 'work');
  const cacheRoot = path.join(base, 'cache');
  await mkdir(wd, { recursive: true });
  await mkdir(cacheRoot, { recursive: true });
  g.__shotCacheRootOverride = cacheRoot;
  (g as unknown as { __aiVideoGate?: unknown }).__aiVideoGate = undefined;
  const handle = makeFakeCtx({
    productionId: `${tag}-prod`,
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
  return { handle, pr };
}

describe('REG-21: SF pipeline dialogue honesty contracts (R-FIX-2)', () => {
  test(
    'REG-21a [P0 — B-F02/D-F05/D-F09]: verification-failing line is subtitle-only, honestly counted, and the verdict loses "চমৎকার"',
    async () => {
      mode = 'failgate';
      const { handle, pr } = await runPipeline('reg21a');

      expect(chatJsonCalls).toBe(2);
      expect(submitCount).toBe(3);

      // শুধু সুস্থ লাইনটির A1-artifact নিবন্ধিত — ব্যর্থ লাইনের নয় (B-F13-পথ)
      const dialogArts = handle.rec.artifacts.filter(
        a => (a.metaJson as Record<string, unknown> | undefined)?.layer === 'A1',
      );
      expect(dialogArts.length).toBe(1);
      const m1 = dialogArts[0].metaJson as Record<string, unknown>;
      expect(m1.character).toBe('লেখক');
      expect(String(m1.text)).toContain('এবার শেষ');
      expect(String(m1.actualVoice ?? m1.voice)).toBe('bn-BD-NabanitaNeural');

      // সৎ নোট: টাইপড VERIFICATION_FAILED-থ্রো সৎভাবে প্রকাশিত (B-F02-ক্যাচ-পথ)
      expect(
        handle.ctx.partialNotes.some(n => n.includes('TTS ব্যর্থ') && n.includes('VERIFICATION_FAILED')),
      ).toBe(true);

      // চূড়ান্ত ভিডিওর dialogue-জয়েন: ২টি লাইনই আছে (ব্যর্থটি artifactId:null সহ)
      const finalArts = handle.rec.artifacts.filter(a => a.kind === 'video');
      const finalMeta = finalArts[finalArts.length - 1].metaJson as Record<string, unknown>;
      const dialogueJoin = finalMeta.dialogue as Array<Record<string, unknown>>;
      expect(dialogueJoin.length).toBe(2);
      expect(dialogueJoin.filter(d => d.artifactId == null).length).toBe(1);
      expect(dialogueJoin.filter(d => typeof d.artifactId === 'string').length).toBe(1);

      // D-F05: শিরোনাম-রায় আর "চমৎকার" নয় — সৎ ক্যাভিয়েটসহ
      const resultJson = JSON.stringify(pr.result);
      expect(resultJson).toContain('TTS-ব্যর্থ');
      expect(resultJson).not.toContain('চমৎকার');
    },
    420_000
  );

  test(
    'REG-21b [C-F03/C-F04/C-F07/B-F06]: film-end overflow honestly noted + per-line timing contract persisted + full text + true provenance',
    async () => {
      mode = 'overflow';
      const { handle, pr } = await runPipeline('reg21b');

      // ২টি লাইনই নিবন্ধিত — মাপা ১১ সে. + টাইমিং-চুক্তির সব ফিল্ড (C-F04)
      const dialogArts = handle.rec.artifacts.filter(
        a => (a.metaJson as Record<string, unknown> | undefined)?.layer === 'A1',
      );
      expect(dialogArts.length).toBe(2);
      for (const a of dialogArts) {
        const m = a.metaJson as Record<string, unknown>;
        expect(typeof m.startSec).toBe('number');
        expect(typeof m.endSec).toBe('number');
        expect(m.measuredSec).toBeGreaterThanOrEqual(10.5);
        expect(m.sampleRate).toBe(24000);
        // C-F07: পূর্ণ টেক্সট — ২০০-অক্ষরের কাটা নয়
        expect(String(m.text).length).toBeGreaterThan(60);
        // B-F06: প্রকৃত-কণ্ঠের প্রোভেনেন্স — অনুরোধকৃত নয়
        expect(String(m.actualVoice ?? m.voice)).toMatch(/^bn-/);
        expect(m.requestedVoice).toBeTruthy();
      }

      // C-F03: লাইন-২ চলচ্চিত্রের শেষ ছাড়িয়ে যায় — নীরব কাটা নয়, সৎ নোট
      expect(
        handle.ctx.partialNotes.some(n => n.includes('ছাড়িয়ে যায়') && n.includes('truncated')),
      ).toBe(true);

      // চূড়ান্ত ভিডিওর machine-readable dialogue-জয়েন (C-F04)
      const finalArts = handle.rec.artifacts.filter(a => a.kind === 'video');
      const finalMeta = finalArts[finalArts.length - 1].metaJson as Record<string, unknown>;
      const dialogueJoin = finalMeta.dialogue as Array<Record<string, unknown>>;
      expect(dialogueJoin.length).toBe(2);
      for (const d of dialogueJoin) {
        expect(typeof d.artifactId).toBe('string');
        expect(typeof d.startSec).toBe('number');
        expect(typeof d.endSec).toBe('number');
      }
      // লাইন-২-এর শেষ ৩০ সে. ছাড়িয়ে — জয়েনেই দৃশ্যমান (যাচাই-যোগ্য প্রমাণ)
      const line2 = dialogueJoin.reduce((a, b) => ((b.endSec as number) > (a.endSec as number) ? b : a));
      expect(line2.endSec as number).toBeGreaterThan(30);

      // ওভারফ্লো রেকর্ডেড (metaJson.audioOverflows) — action:'truncated'
      const overflows = finalMeta.audioOverflows as Array<Record<string, unknown>>;
      expect(Array.isArray(overflows)).toBe(true);
      expect(overflows.length).toBeGreaterThanOrEqual(1);
      expect(overflows[0].action).toBe('truncated');

      // warn-স্তরের সৎ রায় — নীরব সাফল্যের দাবি নয়
      const resultJson = JSON.stringify(pr.result);
      expect(resultJson).not.toContain('চমৎকার');
    },
    420_000
  );
});
