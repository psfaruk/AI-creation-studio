// ============================================================
// REG-16 — Cinematic shot-plan (Phase-5 §9 A/B/C/D/E/F/I/L +
// পরিকল্পনা-মেট্রিকস + প্রিভিউ/রান-সামঞ্জস্য)।
//
// Modules under test (REAL, কোনো মক নেই — সবই বিশুদ্ধ/নির্ধারক):
//  - src/lib/agent/cinematic/{types,planner,capability_map,prompt,
//    validate,preview}
//  - src/lib/agent/capabilities.ts (validateSpec — ওভাররাইড-স্যানিটাইজ)
//  - src/lib/agent/run-metrics.ts (notePlanMetrics/accumulator)
//  - src/lib/agent/video/shot_cache.ts (ফিঙ্গারপ্রিন্ট-সীমানা — কেবল
//    node:crypto, কোনো SDK লোড হয় না)
//  - src/lib/agent/audio/music_engine.ts (proceduralSongGrid —
//    প্রিভিউ/রান একক উৎস; synthesizeInstrumental প্রকৃত ইন-মেমরি সংশ্লেষণ)
//
// ffmpeg: কেবল গান-বিশ্লেষণ-ক্যাশ পরীক্ষায় একটি ছোট প্রকৃত WAV —
// শূন্য-ব্যয় (কোনো প্রোভাইডার/LLM কল নেই)।
// ============================================================

import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import { writeFile } from 'fs/promises';
import path from 'path';

import {
  planMusicVideo,
  planShortFilmShots,
  planShortFilmSkeleton,
  selectCutSegments,
  musicVideoShotCount,
  shortFilmShotCount,
  skeletonSceneCount,
  applyOverrides,
  sanitizeOverridesInput,
  summarizePlan,
  fallbackActionEn,
  type MusicVideoPlanInput,
  type ShortFilmPlanInput,
  type PlannerFilmScene,
} from '@/lib/agent/cinematic/planner';
import { parseAndValidateShotPlan } from '@/lib/agent/cinematic/validate';
import { classifyMovement, fallbackMoveFor, sizeFramingPhrase, anglePhrase, movementPhrase } from '@/lib/agent/cinematic/capability_map';
import { buildCinematicVideoPrompt, buildCinematicImagePrompt } from '@/lib/agent/cinematic/prompt';
import {
  SHOT_SIZES,
  PLAN_MOVEMENTS,
  CAMERA_ANGLES,
  SHOT_PLAN_VERSION,
  type CinematicPlan,
  type CinematicShot,
} from '@/lib/agent/cinematic/types';
import { validateSpec } from '@/lib/agent/capabilities';
import { notePlanMetrics, getProductionMetrics, logProductionMetrics } from '@/lib/agent/run-metrics';
import { shotCacheFingerprint, SHOT_CACHE_SCHEMA_VERSION } from '@/lib/agent/video/shot_cache';
import { proceduralSongGrid, synthesizeInstrumental, resolveInstrumentalMood } from '@/lib/agent/audio/music_engine';
import { containsBengaliScript } from '@/lib/agent/cinematic/lang-guard';
import {
  buildMusicVideoPlanPreview,
  buildShortFilmPlanPreview,
  analyzeSongArtifactCached,
  resetSongAnalysisCacheForTests,
} from '@/lib/agent/cinematic/preview';
import { runFfmpeg } from '@/lib/media/ffmpeg';
import { freshDir, cleanupRoots, buildSpeechWav } from '../helpers/cinematic-harness';

const g = globalThis as unknown as Record<string, unknown>;

// মাপা-বিটের মতো বাস্তব-সদৃশ ইনপুট (৮-বিট গ্রিড, ২০ সে., draft ai — limit ২)
function mvInput(over: Partial<MusicVideoPlanInput> = {}): MusicVideoPlanInput {
  return {
    engine: 'ai_diffusion',
    limit: 2,
    targetDurationSec: 20,
    beatsSec: [0.5, 2.5, 4.9, 7.3, 9.8, 12.2, 14.7, 17.1, 19.4],
    sections: [{ startSec: 0, endSec: 20, energy: 'medium' }],
    beatSource: 'bpm_grid_estimate',
    hasArtist: true,
    ...over,
  };
}

function sfScenes(): PlannerFilmScene[] {
  return [
    { index: 1, location: 'river ghat', timeOfDay: 'dawn', characters: [], action: 'a boat arrives through the mist', estimatedSec: 10, dialogueCount: 0 },
    { index: 2, location: 'courtyard', timeOfDay: 'noon', characters: [], action: 'two friends argue about the letter', estimatedSec: 12, dialogueCount: 2 },
    { index: 3, location: 'market', timeOfDay: 'dusk', characters: [], action: 'a hurried walk through the closing market', estimatedSec: 10, dialogueCount: 0 },
    { index: 4, location: 'rooftop', timeOfDay: 'night', characters: [], action: 'a quiet farewell under the city lights', estimatedSec: 8, dialogueCount: 1 },
  ];
}

function sfInput(over: Partial<ShortFilmPlanInput> = {}): ShortFilmPlanInput {
  return {
    engine: 'ai_diffusion',
    limit: 3,
    durationSec: 40,
    scenes: sfScenes(),
    ...over,
  };
}

/**
 * দুই-চরিত্র রোমান্টিক ফিক্সচার — findings-d §3.3-এর T-R1/T-R2 স্কেলেটন
 * (বাজেট-মুক্ত, নির্ধারক)। দৃশ্য-১ মূল সংলাপ-দৃশ্য (২ লাইন, দীর্ঘ) —
 * ৪৫/৬০ সে.-এ ওটিই এস্টাব্লিশিং→OTS→রিয়্যাকশন কভারেজ পায়।
 */
function romanticScenes(): PlannerFilmScene[] {
  return [
    { index: 1, location: 'river ghat', timeOfDay: 'dusk', characters: ['আকাশ', 'প্রিয়া'], action: 'Akash and Priya meet at the ghat', visualEn: 'A riverside ghat at dusk, a young man and a woman meeting under warm light', estimatedSec: 28, dialogueCount: 2 },
    { index: 2, location: 'tea stall', timeOfDay: 'night', characters: ['আকাশ', 'প্রিয়া'], action: 'they talk about the letter', visualEn: 'A small tea stall at night, two people talking across a steaming cup', estimatedSec: 6, dialogueCount: 1 },
    { index: 3, location: 'rooftop', timeOfDay: 'night', characters: ['আকাশ', 'প্রিয়া'], action: 'a quiet farewell under the city lights', visualEn: 'A rooftop farewell under city lights at night', estimatedSec: 6, dialogueCount: 0 },
  ];
}

/**
 * D-F04 কভারেজ-নিয়মের সাধারণ যাচাই: প্রতিটি সংলাপ-দৃশ্যে যেখানে ≥২টি
 * চরিত্র-কন্ডিশনড শট আছে, সেখানে উভয় নামই অন্তত একবার করে বসেছে —
 * দ্বিতীয় চরিত্র কখনো উপস্থাপিত-না-হওয়া থাকতে পারে না।
 */
function assertDialogueCharacterCoverage(plan: CinematicPlan, fixture: PlannerFilmScene[]): void {
  fixture.forEach((sc, i) => {
    if (sc.dialogueCount <= 0 || sc.characters.length < 2) return;
    const sceneShots = plan.shots.filter(s => s.sceneId === `SC${i + 1}`);
    const conditioned = sceneShots.filter(s => typeof s.character === 'string');
    if (conditioned.length < 2) return; // ১টির কম কন্ডিশনড স্লট — কভারেজ অসম্ভব (সৎ সীমা)
    const names = new Set(conditioned.map(s => s.character as string));
    expect(names.has(sc.characters[0])).toBe(true);
    expect(names.has(sc.characters[1])).toBe(true);
  });
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

beforeEach(() => {
  resetSongAnalysisCacheForTests();
});

afterAll(async () => {
  await cleanupRoots();
});

describe('REG-16: cinematic shot-plan (Phase-5 A/B/C/D/E/F/I/L)', () => {
  // ---------------- §9-A: মিউজিক-ভিডিও আর্ক ----------------
  test('REG-16a (§9-A): MV পরিকল্পনা — বৈধ, ক্রমিত, অ-খালি, নির্ধারক আর্ক', () => {
    const plan = planMusicVideo(mvInput());
    // যাচাইকৃত: কাঠামো-চুক্তি পাস
    const v = parseAndValidateShotPlan(clone(plan));
    expect(v.ok).toBe(true);
    expect(v.errors).toEqual([]);
    // ক্রম 0..n-1 ক্রমিত; শট-আইডি স্থিতিশীল
    plan.shots.forEach((s, i) => {
      expect(s.order).toBe(i);
      expect(s.shotId).toBe(`S${String(i + 1).padStart(2, '0')}`);
    });
    // আর্ক: প্রথম এস্টাব্লিশিং/পরিবেশ, শেষ ওয়াইড/জুম-আউট (সমাপনি)
    expect(plan.shots[0].size).toBe('establishing_wide');
    expect(plan.shots[0].subject).toBe('environment');
    const last = plan.shots[plan.shots.length - 1];
    expect(last.size).toBe('wide');
    expect(last.movement).toBe('zoom_out');
    // দৈর্ঘ্য: প্রতিটি শটের জানালা = targetDurationSec; যোগফল = মোট
    plan.shots.forEach(s => {
      expect(s.targetDurationSec).toBeCloseTo((s.endSec ?? 0) - (s.startSec ?? 0), 2);
    });
    expect(plan.totalPlannedSec).toBeCloseTo(20, 0);
    // নির্ধারক: একই ইনপুট → হুবহু একই পরিকল্পনা
    expect(JSON.stringify(planMusicVideo(mvInput()))).toBe(JSON.stringify(plan));
  });

  test('REG-16a2: আর্ক-স্লট — শক্তি-সচেতন সাইজ/সাবজেক্ট + ডিটেইল/রিঅ্যাকশন', () => {
    // সব-লাউড ৬০ সে., cinematic (limit ১৪) → N=১০ ≥ ৬ → ডিটেইল+রিঅ্যাকশন স্লট
    const loud = planMusicVideo(
      mvInput({ engine: 'cinematic_motion', limit: 14, targetDurationSec: 60, beatsSec: [], sections: [{ startSec: 0, endSec: 60, energy: 'loud' }], beatSource: 'duration_fallback' }),
    );
    expect(loud.shots.length).toBeGreaterThanOrEqual(6);
    expect(loud.shots.some(s => s.subject === 'detail' && s.size === 'insert')).toBe(true);
    expect(loud.shots.some(s => s.subject === 'reaction' && s.size === 'reaction')).toBe(true);
    // লাউড স্লটে পারফরম্যান্স মাঝ-সাইজ পালা (medium ↔ close_up)
    const perf = loud.shots.filter(s => s.subject === 'artist_performance');
    expect(perf.length).toBeGreaterThanOrEqual(2);
    expect(new Set(perf.map(s => s.size))).toContain('medium');
    expect(new Set(perf.map(s => s.size))).toContain('close_up');
    // শান্ত অংশ: পারফরম্যান্স-স্লট নেই; শ্বাস-প্রশ্বাস (wide/establishing) +
    // বিশেষ স্লট (insert/reaction) যথাযথ
    const quiet = planMusicVideo(
      mvInput({ engine: 'cinematic_motion', limit: 14, targetDurationSec: 48, beatsSec: [], sections: [{ startSec: 0, endSec: 48, energy: 'quiet' }], beatSource: 'duration_fallback' }),
    );
    const mids = quiet.shots.slice(1, -1);
    expect(mids.every(s => s.subject !== 'artist_performance')).toBe(true);
    expect(mids.every(s => s.size === 'wide' || s.size === 'establishing_wide' || s.size === 'insert' || s.size === 'reaction')).toBe(true);
  });

  test('REG-16a3: মুভমেন্ট-পুনরাবৃত্তি নিয়ম + সৎ বিট-উৎস লেবেল', () => {
    // টানা একই নন-স্ট্যাটিক মুভ দুবার নয় (static ব্যতিক্রম)
    const plan = planMusicVideo(
      mvInput({ engine: 'cinematic_motion', limit: 14, targetDurationSec: 60, beatsSec: [], sections: [{ startSec: 0, endSec: 60, energy: 'medium' }], beatSource: 'duration_fallback' }),
    );
    for (let i = 1; i < plan.shots.length; i++) {
      const prev = plan.shots[i - 1].movement;
      const cur = plan.shots[i].movement;
      if (cur !== 'static') expect(cur).not.toBe(prev);
    }
    // বিট না থাকলে সমান-বিভাজন + সৎ duration_fallback
    expect(plan.beatSource).toBe('duration_fallback');
    const segs = selectCutSegments([], 60, plan.shots.length, () => 'medium');
    segs.forEach(s => expect(s.endSec - s.startSec).toBeCloseTo(60 / plan.shots.length, 1));
    // silent লেবেল যথাযথভাবে বহাল থাকে
    const silent = planMusicVideo(mvInput({ beatSource: 'silent', beatsSec: [], sections: [] }));
    expect(silent.beatSource).toBe('silent');
  });

  test('REG-16a3b (P5-5a): পূর্বান্ত-স্লট — সব-শান্ত পরিকল্পনাতেও শেষ জোড়ায় টানা zoom_out নয়', () => {
    // ৩-স্লটের সব-শান্ত পরিকল্পনা: পূর্বান্ত স্লট (i=1) শান্ত-পুলের
    // ['static','zoom_out'] জোড় ভাঙার জায়গা — আগে শেষ-শটের স্থির
    // zoom_out (§2.2 সমাপনি-আর্ক)-এর সাথে টানা zoom_out,zoom_out হতো।
    const plan = planMusicVideo(
      mvInput({ engine: 'ai_diffusion', limit: 3, targetDurationSec: 30, beatsSec: [], sections: [{ startSec: 0, endSec: 30, energy: 'quiet' }], beatSource: 'duration_fallback' }),
    );
    expect(plan.shots.length).toBe(3);
    expect(plan.shots[plan.shots.length - 1].movement).toBe('zoom_out'); // স্থির সমাপনি-আর্ক
    expect(plan.shots[1].movement).not.toBe('zoom_out'); // পূর্বান্ত-গার্ড
    for (let i = 1; i < plan.shots.length; i++) {
      if (plan.shots[i].movement !== 'static') {
        expect(plan.shots[i].movement).not.toBe(plan.shots[i - 1].movement);
      }
    }
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
  });

  test('REG-16a3c (P5-5a): শর্টফিল্ম — সমাপনি-প্রাক স্লটেও টানা zoom_out নয়', () => {
    // শেষ দৃশ্যের কভারেজ [wide→medium→insert→medium-সমাপনি]: insert-স্লটের
    // zoom_in আগের medium-এর zoom_in-এর সাথে মিলে পুনরাবৃত্তি-সংশোধনে আগে
    // zoom_out-এ যেত → সমাপনি-শটের zoom_out-এর সাথে টানা জোড়া। এখন
    // সংশোধন-বিকল্প static (zoom_out কখনো বিকল্প নয়)।
    const plan = planShortFilmShots(
      sfInput({
        engine: 'cinematic_motion',
        limit: 8,
        durationSec: 35,
        scenes: [
          { index: 1, location: 'ghat', timeOfDay: 'dawn', characters: [], action: 'a boat waits in the mist', estimatedSec: 5, dialogueCount: 0 },
          { index: 2, location: 'roof', timeOfDay: 'night', characters: [], action: 'a long farewell plays out above the city', estimatedSec: 28, dialogueCount: 0 },
        ],
      }),
    );
    expect(plan.shots.length).toBe(5);
    expect(plan.shots[plan.shots.length - 1].movement).toBe('zoom_out');
    for (let i = 1; i < plan.shots.length; i++) {
      if (plan.shots[i].movement !== 'static') {
        expect(plan.shots[i].movement).not.toBe(plan.shots[i - 1].movement);
      }
    }
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
  });

  test('REG-16a4 (§3, P5-5a): সন্নিহিত-সাইজ বৈচিত্র্য — জোড়া-বিকল্প, পূর্বান্ত-গার্ড, জোড়া-ক্ষয়-নোট', () => {
    // (ক) সব-মিডিয়াম ৪-স্লট — কোনো সন্নিহিত জোড়াই একই সাইজ নয়, কোনো নোটও নয়
    const med = planMusicVideo(
      mvInput({ engine: 'cinematic_motion', limit: 8, targetDurationSec: 24, beatsSec: [], sections: [{ startSec: 0, endSec: 24, energy: 'medium' }], beatSource: 'duration_fallback' }),
    );
    expect(med.shots.length).toBe(4);
    expect(med.shots.map(s => s.size)).toEqual(['establishing_wide', 'wide', 'medium', 'wide']);
    med.shots.forEach((s, i) => {
      if (i > 0) expect(s.size).not.toBe(med.shots[i - 1].size);
    });
    expect(med.adjustments).toEqual([]);

    // (খ) সব-শান্ত ৩-স্লট — মাঝ-স্লটের শক্তি-জোড়ার দুই বিকল্পই প্রতিবেশীর
    // সাথে মেলে (establishing_wide আগের শট, wide স্থির-শেষ শট): শক্তি-সঠিক
    // wide বহাল + ঠিক ১টি সৎ-সমন্বয়-নোট
    const quiet = planMusicVideo(
      mvInput({ engine: 'ai_diffusion', limit: 3, targetDurationSec: 30, beatsSec: [], sections: [{ startSec: 0, endSec: 30, energy: 'quiet' }], beatSource: 'duration_fallback' }),
    );
    expect(quiet.shots.map(s => s.size)).toEqual(['establishing_wide', 'wide', 'wide']);
    const sizeAdj = quiet.adjustments.filter(a => a.field === 'shot.S02.size');
    expect(sizeAdj.length).toBe(1);
    expect(sizeAdj[0].from).toBe('establishing_wide'); // চেষ্টা-করা জোড়া-বিকল্প
    expect(sizeAdj[0].to).toBe('wide'); // রাখা হয়েছে শক্তি-সঠিক সাইজ
    expect(sizeAdj[0].reason).toContain('শক্তি-জোড়ার');
    expect(quiet.adjustments.length).toBe(1); // এই পরিকল্পনায় আর কিছু নয়

    // (গ) মিশ্র শক্তি (loud→medium→quiet, N=৬): পূর্বান্ত-গার্ড সহ বৈচিত্র্য
    // টেকে — পূর্বান্ত শান্ত-স্লট wide না রেখে জোড়া-বিকল্প establishing_wide-তে যায়
    const mixed = planMusicVideo(
      mvInput({
        engine: 'cinematic_motion',
        limit: 14,
        targetDurationSec: 36,
        beatsSec: [],
        sections: [
          { startSec: 0, endSec: 12, energy: 'loud' },
          { startSec: 12, endSec: 24, energy: 'medium' },
          { startSec: 24, endSec: 36, energy: 'quiet' },
        ],
        beatSource: 'duration_fallback',
      }),
    );
    expect(mixed.shots.length).toBe(6);
    mixed.shots.forEach((s, i) => {
      if (i > 0) expect(s.size).not.toBe(mixed.shots[i - 1].size);
    });
    expect(mixed.adjustments.filter(a => a.field.endsWith('.size')).length).toBe(0);
    expect(parseAndValidateShotPlan(clone(mixed)).ok).toBe(true);
  });

  // ---------------- §9-B: শর্টফিল্ম কভারেজ ----------------
  test('REG-16b (§9-B): শর্টফিল্ম — কাহিনি-ভিত্তিক কভারেজ ক্রম', () => {
    // cinematic standard (limit ১৬), ৯০ সে. — সংলাপ-কভারেজের পুরো জোড়ার
    // বাজেটসহ
    const input = sfInput({ engine: 'cinematic_motion', limit: 16, durationSec: 90 });
    const plan = planShortFilmShots(input);
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
    expect(plan.beatSource).toBe('narrative');
    expect(plan.shots.length).toBe(shortFilmShotCount(input));
    expect(plan.shots.length).toBe(13); // ceil(90/7)=13 — সূত্র-স্থিরতা
    // প্রথম দৃশ্য: এস্টাব্লিশিং জিওগ্রাফি
    expect(plan.shots[0].size).toBe('establishing_wide');
    expect(plan.shots[0].subject).toBe('environment');
    // সংলাপ-দৃশ্যের কভারেজ: medium + OTS জোড়া + রিঅ্যাকশন (২+ লাইন)
    const dlg = plan.shots.filter(s => s.sceneId === 'SC2');
    expect(dlg.length).toBeGreaterThanOrEqual(3);
    expect(dlg[0].size).toBe('medium');
    expect(dlg[1].size).toBe('over_the_shoulder');
    expect(dlg.some(s => s.size === 'reaction')).toBe(true);
    // সংলাপহীন অ্যাকশন-দৃশ্যে wide → medium → insert কভারেজ
    const act = plan.shots.filter(s => s.sceneId === 'SC3');
    expect(act[0].size).toBe('wide');
    expect(act.some(s => s.size === 'medium')).toBe(true);
    // শেষ দৃশ্যের শেষ শট = সমাপনি-বিট (zoom_out + transitionIn)
    const lastShot = plan.shots[plan.shots.length - 1];
    expect(lastShot.sceneId).toBe('SC4');
    expect(lastShot.movement).toBe('zoom_out');
    expect(lastShot.transitionIn).toBeDefined();
    // প্রতিটি দৃশ্যে ≥ ১ শট (বাজেটে সবাই জায়গা পেয়েছে)
    for (const sid of ['SC1', 'SC2', 'SC3', 'SC4']) {
      expect(plan.shots.filter(s => s.sceneId === sid).length).toBeGreaterThanOrEqual(1);
    }
  });

  test('REG-16b2: বাজেট-কাট — ইঞ্জিন-সীমা কখনো ছাড়ায় না, আর্কের দুই প্রান্ত বাঁচে', () => {
    // ৬ দৃশ্য, draft ai (limit ২) → মোট ৩ শটেই থামে (Phase-4 slice-সীমা সম্মান)
    const six = planShortFilmShots(
      sfInput({ limit: 2, durationSec: 30, scenes: [1, 2, 3, 4, 5, 6].map(i => sfScenes()[0] && ({ index: i, location: 'loc', timeOfDay: 'day', characters: [], action: `act ${i}`, estimatedSec: 5, dialogueCount: 0 })) }),
    );
    expect(six.shots.length).toBe(3);
    // প্রথম ও শেষ দৃশ্য কভার পায়; কাট মাঝের দৃশ্যগুলিতে
    const covered = [...new Set(six.shots.map(s => s.sceneId))];
    expect(covered).toContain('SC1');
    expect(covered).toContain('SC6');
    // সমাপনি-বিট শেষ কভার-দৃশ্যে (SC6)
    const lastShot = six.shots[six.shots.length - 1];
    expect(lastShot.sceneId).toBe('SC6');
    expect(lastShot.movement).toBe('zoom_out');
    // ৪ দৃশ্য/limit ৩ → SC1, SC2, SC4 কভার (বিদায়-দৃশ্য বাঁচে)
    const four = planShortFilmShots(sfInput({ limit: 3 }));
    expect([...new Set(four.shots.map(s => s.sceneId))]).toEqual(['SC1', 'SC2', 'SC4']);
    expect(parseAndValidateShotPlan(clone(six)).ok).toBe(true);
  });

  test('REG-16b3: প্রিভিউ-কঙ্কাল — কাঠামো + সৎ রানটাইম-লেবেল', () => {
    const plan = planShortFilmSkeleton({ engine: 'ai_diffusion', limit: 3, durationSec: 40 });
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
    expect(plan.shots[0].size).toBe('establishing_wide');
    expect(plan.shots[plan.shots.length - 1].movement).toBe('zoom_out');
    // সৎ-লেবেল: চূড়ান্ত দৃশ্য জেনারেশন-সময়ে তৈরি হবে
    expect(plan.scenes.some(s => s.narrativeBeat.includes('জেনারেশন-সময়ে'))).toBe(true);
    expect(skeletonSceneCount(40)).toBe(4);
  });

  // ------ রিকভারি R-FIX-3 (findings-d §3.3 T-R1/T-R2 — D-F04) ------

  test('REG-16r1 (T-R1, D-F04): দুই-চরিত্র রোমান্টিক ফিক্সচার — ৩০ সে.-কাঠামো + বাজেট-সীমা', () => {
    // ৩০ সে. ai_diffusion (draft limit ৩) → ৩ শট/৩ দৃশ্য — সংলাপ-দৃশ্যে
    // এক শটই জায়গা পায়: OTS/রিয়্যাকশন কভারেজ অসম্ভব (findings-d §3.2#4
    // — বাজেট-প্রমাণ; ৪৫/৬০ সে.-এর ভিন্নতা REG-16r2)।
    const plan = planShortFilmShots({ engine: 'ai_diffusion', limit: 3, durationSec: 30, scenes: romanticScenes() });
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
    expect(plan.shots.length).toBe(3);
    // দৃশ্য-উদ্দেশ্য: পরিচিতি → সংলাপ-কভারেজ → সমাপনি
    expect(plan.scenes.map(s => s.purpose)).toEqual(['পরিচিতি ও ভৌগোলিক স্থাপন', 'সংলাপ-কভারেজ', 'সমাপনি']);
    // S01: এস্টাব্লিশিং জিওগ্রাফি (পরিবেশ-সাবজেক্ট — চরিত্র-কন্ডিশনড নয়)
    expect(plan.shots[0].size).toBe('establishing_wide');
    expect(plan.shots[0].subject).toBe('environment');
    expect(plan.shots[0].character).toBeUndefined();
    // শেষ শট: সমাপনি-বিট
    const last = plan.shots[plan.shots.length - 1];
    expect(last.movement).toBe('zoom_out');
    expect(last.transitionIn).toBe('সমাপনি-বিট');
    // ৩০ সে.-বাজেটে OTS/রিয়্যাকশন কোথাও নেই
    expect(plan.shots.some(s => s.size === 'over_the_shoulder' || s.size === 'reaction')).toBe(false);
    // কভারেজ-নিয়ম (সাধারণ রূপ — এখানে ১-শট দৃশ্যে প্রযোজ্য নয়, তবু চালানো)
    assertDialogueCharacterCoverage(plan, romanticScenes());
    // নির্ধারক: একই ইনপুট → হুবহু একই পরিকল্পনা
    expect(
      JSON.stringify(planShortFilmShots({ engine: 'ai_diffusion', limit: 3, durationSec: 30, scenes: romanticScenes() })),
    ).toBe(JSON.stringify(plan));
  });

  test('REG-16r2 (T-R2, D-F04): ৪৫/৬০ সে. — সংলাপ-দৃশ্যে OTS+রিয়্যাকশন ও চরিত্র-বণ্টন-নিয়ম', () => {
    // বাজেট-মুক্ত জ্যামিতি-প্রমাণ: limit সরাসরি ১৬ (পিওর-ফাংশন ইনপুট) —
    // ai_diffusion-এ ceil(দৈর্ঘ্য/১০)-ই আসল সীমা, তাই ৪৫/৬০ সে.-এ ৫/৬ শট।
    for (const durationSec of [45, 60]) {
      const plan = planShortFilmShots({ engine: 'ai_diffusion', limit: 16, durationSec, scenes: romanticScenes() });
      expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
      // SC1 (dialogueCount ২) পূর্ণ কভারেজ পায়: এস্টাব্লিশিং + OTS(k=1) + রিয়্যাকশন(k=2)
      const sc1 = plan.shots.filter(s => s.sceneId === 'SC1');
      expect(sc1.length).toBe(3);
      expect(sc1[0].size).toBe('establishing_wide');
      expect(sc1[1].size).toBe('over_the_shoulder');
      expect(sc1[2].size).toBe('reaction');
      // চরিত্র-নিয়ম: OTS → characters[0]; রিয়্যাকশন → characters[1]
      expect(sc1[1].character).toBe('আকাশ');
      expect(sc1[2].character).toBe('প্রিয়া');
      // SC1-এর শটগুলোতে উভয় চরিত্রই পোর্ট্রেট-কন্ডিশনড
      const names = new Set(sc1.map(s => s.character).filter(Boolean) as string[]);
      expect(names.has('আকাশ')).toBe(true);
      expect(names.has('প্রিয়া')).toBe(true);
      // প্রম্পট-পথ: চরিত্র-নামযুক্ত OTS/রিয়্যাকশন বাক্য প্রম্পটে যায় (D-F04 প্রম্পট-অর্ধেক)
      expect(buildCinematicVideoPrompt(sc1[1])).toContain(sizeFramingPhrase('over_the_shoulder', 'আকাশ'));
      expect(buildCinematicVideoPrompt(sc1[2])).toContain(sizeFramingPhrase('reaction', 'প্রিয়া'));
      // সাধারণ কভারেজ-নিয়ম + মুভমেন্ট-পুনরাবৃত্তি-নিয়ম অটুট
      assertDialogueCharacterCoverage(plan, romanticScenes());
      for (let i = 1; i < plan.shots.length; i++) {
        if (plan.shots[i].movement !== 'static') {
          expect(plan.shots[i].movement).not.toBe(plan.shots[i - 1].movement);
        }
      }
    }
    // ৬০ সে.-এ SC2-ও ২ শট পায় — অ্যালটার্নেশন-গ্যারান্টি: মিডিয়াম আকাশ,
    // OTS প্রিয়া (chars[0] বসে যাওয়ার পরের কন্ডিশনড স্লট chars[1]-কে)
    const p60 = planShortFilmShots({ engine: 'ai_diffusion', limit: 16, durationSec: 60, scenes: romanticScenes() });
    const sc2 = p60.shots.filter(s => s.sceneId === 'SC2');
    expect(sc2.length).toBe(2);
    expect(sc2[0].size).toBe('medium');
    expect(sc2[0].character).toBe('আকাশ');
    expect(sc2[1].size).toBe('over_the_shoulder');
    expect(sc2[1].character).toBe('প্রিয়া');
    // ৩০ সে.-এ OTS/রিয়্যাকশন আসতেই পারে না — বাজেট-প্রমাণ (T-R2-এর অন্য পাশ)
    const p30 = planShortFilmShots({ engine: 'ai_diffusion', limit: 3, durationSec: 30, scenes: romanticScenes() });
    expect(p30.shots.some(s => s.size === 'over_the_shoulder' || s.size === 'reaction')).toBe(false);
  });

  // ---------------- §9-C: দৈর্ঘ্য/সংখ্যা = যাচাইকৃত সক্ষমতা ----------------
  test('REG-16c (§9-C): দৈর্ঘ্য ইঞ্জিন-সীমায়, সংখ্যা-সূত্র Phase-4-অভিন্ন', () => {
    // সংখ্যা-সূত্র — Phase-4-এর মানগুলিই (সীমা-সচেতন: কম কোয়ালিটি = কম শট)
    expect(musicVideoShotCount(2, 20, 'ai_diffusion')).toBe(2);
    expect(musicVideoShotCount(3, 40, 'ai_diffusion')).toBe(3); // সীমা ৩-এ আটকে
    expect(musicVideoShotCount(3, 40, 'cinematic_motion')).toBe(3); // সীমা-বাউন্ড
    expect(musicVideoShotCount(8, 40, 'cinematic_motion')).toBe(7); // সেগ-ক্যাপ ৬ → ceil(40/6)
    expect(shortFilmShotCount(sfInput({ limit: 2, durationSec: 30 }))).toBe(3);
    // AI-ইঞ্জিনে প্রতি-শট লক্ষ্য ≤ ১০ সে. (৫/১০-গ্রিডের ট্রিম-সীমা)
    const longScene = planShortFilmShots(
      sfInput({ limit: 2, durationSec: 30, scenes: [{ index: 1, location: 'l', timeOfDay: 'd', characters: [], action: 'a long single scene', estimatedSec: 30, dialogueCount: 0 }] }),
    );
    longScene.shots.forEach(s => expect(s.targetDurationSec).toBeLessThanOrEqual(10));
    // cinematic_motion-এ ≤ ২০ সে. (যাচাইকারী-উচ্চসীমা)
    const longCine = planShortFilmShots(
      sfInput({ engine: 'cinematic_motion', limit: 8, durationSec: 60, scenes: [{ index: 1, location: 'l', timeOfDay: 'd', characters: [], action: 'a long scene', estimatedSec: 30, dialogueCount: 0 }] }),
    );
    longCine.shots.forEach(s => expect(s.targetDurationSec).toBeLessThanOrEqual(20));
    // MV-জানালার যোগফল = টার্গেট (কাট-গণিত Phase-4-অভিন্ন)
    const mv = planMusicVideo(mvInput({ limit: 3, targetDurationSec: 40, beatsSec: [], beatSource: 'duration_fallback' }));
    expect(mv.shots.reduce((a, s) => a + s.targetDurationSec, 0)).toBeCloseTo(40, 0);
  });

  // ---------------- §9-D: যাচাইকারীর ধনাত্মক/ঋণাত্মক ----------------
  test('REG-16d (§9-D): কাঠামো-যাচাই — বৈধ পরিকল্পনা পাস, ভাঙা প্রত্যাখ্যান', () => {
    // ধনাত্মক: সব পরিকল্পকের আউটপুট পাস করে
    const plans: CinematicPlan[] = [
      planMusicVideo(mvInput()),
      planMusicVideo(mvInput({ engine: 'cinematic_motion', limit: 14, targetDurationSec: 60, beatsSec: [], sections: [{ startSec: 0, endSec: 60, energy: 'loud' }] })),
      planShortFilmShots(sfInput()),
      planShortFilmSkeleton({ engine: 'ai_diffusion', limit: 2, durationSec: 30 }),
    ];
    for (const p of plans) {
      const v = parseAndValidateShotPlan(clone(p));
      expect(v.ok).toBe(true);
    }
    const base = clone(plans[0]);

    // ঋণাত্মক: ভার্সন
    const badVersion = clone(base); (badVersion as unknown as { version: number }).version = 2;
    expect(parseAndValidateShotPlan(badVersion).ok).toBe(false);
    // ঋণাত্মক: খালি দৃশ্য/শট
    const noScenes = clone(base); noScenes.scenes = [];
    expect(parseAndValidateShotPlan(noScenes).ok).toBe(false);
    const noShots = clone(base); (noShots as unknown as { shots: unknown[] }).shots = [];
    expect(parseAndValidateShotPlan(noShots).ok).toBe(false);
    // ঋণাত্মক: সদৃশ আইডি, অনুক্রমহীন order, ঝুলন্ত sceneId
    const dup = clone(base); dup.shots[1].shotId = dup.shots[0].shotId;
    expect(parseAndValidateShotPlan(dup).ok).toBe(false);
    const disorder = clone(base); disorder.shots = [...disorder.shots].reverse();
    expect(parseAndValidateShotPlan(disorder).ok).toBe(false);
    const dangling = clone(base); dangling.shots[0].sceneId = 'SC99';
    expect(parseAndValidateShotPlan(dangling).ok).toBe(false);
    // ঋণাত্মক: অবৈধ এনাম (size/angle/movement/delivery/fallbackMove)
    const badSize = clone(base); (badSize.shots[0] as unknown as { size: string }).size = 'megawide';
    expect(parseAndValidateShotPlan(badSize).ok).toBe(false);
    const badMove = clone(base); (badMove.shots[0] as unknown as { movement: string }).movement = 'crane';
    expect(parseAndValidateShotPlan(badMove).ok).toBe(false);
    const badDelivery = clone(base); (badDelivery.shots[0] as unknown as { delivery: string }).delivery = 'guaranteed';
    expect(parseAndValidateShotPlan(badDelivery).ok).toBe(false);
    const badFallback = clone(base); (badFallback.shots[0] as unknown as { fallbackMove: string }).fallbackMove = 'orbit';
    expect(parseAndValidateShotPlan(badFallback).ok).toBe(false);
    // ঋণাত্মক: দৈর্ঘ্য-সীমা (০.১ / ৯৯৯৯) ও মোট-অমিল
    const tiny = clone(base); tiny.shots[0].targetDurationSec = 0.1;
    expect(parseAndValidateShotPlan(tiny).ok).toBe(false);
    const huge = clone(base); huge.shots[0].targetDurationSec = 9999;
    expect(parseAndValidateShotPlan(huge).ok).toBe(false);
    const mismatch = clone(base); mismatch.totalPlannedSec = 999;
    expect(parseAndValidateShotPlan(mismatch).ok).toBe(false);
    // ঋণাত্মক: actionEn অনুপস্থিত
    const noAction = clone(base); (noAction.shots[0] as unknown as { actionEn: string }).actionEn = ' ';
    expect(parseAndValidateShotPlan(noAction).ok).toBe(false);
    // ঋণাত্মক (P5-5a নতুন গার্ড): beatSource/subject এনাম,
    // totalPlannedSec-উপস্থিতি, সমন্বয়-নোটের গঠন
    const badBeat = clone(base); (badBeat as unknown as { beatSource: string }).beatSource = 'guesswork';
    const vBadBeat = parseAndValidateShotPlan(badBeat);
    expect(vBadBeat.ok).toBe(false);
    expect(vBadBeat.errors.some(e => e.includes('beatSource'))).toBe(true);
    const badSubject = clone(base); (badSubject.shots[0] as unknown as { subject: string }).subject = 'vibes';
    const vBadSubject = parseAndValidateShotPlan(badSubject);
    expect(vBadSubject.ok).toBe(false);
    expect(vBadSubject.errors.some(e => e.includes('subject'))).toBe(true);
    const noTotal = clone(base); delete (noTotal as unknown as { totalPlannedSec?: number }).totalPlannedSec;
    const vNoTotal = parseAndValidateShotPlan(noTotal);
    expect(vNoTotal.ok).toBe(false);
    expect(vNoTotal.errors.some(e => e.includes('totalPlannedSec'))).toBe(true);
    const badAdj = clone(base); (badAdj as unknown as { adjustments: unknown }).adjustments = { nope: true };
    const vBadAdj = parseAndValidateShotPlan(badAdj);
    expect(vBadAdj.ok).toBe(false);
    expect(vBadAdj.errors.some(e => e.includes('adjustments'))).toBe(true);
    const badAdjEntry = clone(base); (badAdjEntry as unknown as { adjustments: unknown }).adjustments = [
      { field: 'shot.S01.size', from: 'x', to: 'y' }, // reason ইচ্ছামতো বাদ — গার্ড-পরীক্ষা
    ];
    const vBadAdjEntry = parseAndValidateShotPlan(badAdjEntry);
    expect(vBadAdjEntry.ok).toBe(false);
    expect(vBadAdjEntry.errors.some(e => e.includes('reason'))).toBe(true);
    // ধনাত্মক: বৈধ সমন্বয়-নোট (field+reason আবশ্যক; from/to ঐচ্ছিক) পাস করে
    const okAdj = clone(base); (okAdj as unknown as { adjustments: unknown }).adjustments = [
      { field: 'shot.S01.size', reason: 'পরীক্ষা-নোট' },
    ];
    const vOkAdj = parseAndValidateShotPlan(okAdj);
    expect(vOkAdj.ok).toBe(true);
    expect(vOkAdj.errors).toEqual([]);
  });

  // ---------------- §9-E: ক্ষমতা-সততা ----------------
  test('REG-16e (§9-E): অসমর্থিত মুভমেন্ট → সৎ ডাউনগ্রেড + সারসংক্ষেপ-সততা', () => {
    // পূর্ণ টেবিল: ai_diffusion-এ সবই প্রম্পট-নির্দেশিত (নেটিভ প্যারামিটার নেই)
    for (const mv of PLAN_MOVEMENTS) {
      const cls = classifyMovement(mv, 'ai_diffusion');
      expect(cls.delivery).toBe('prompt_guided');
      expect(cls.downgradeReason).toBeUndefined();
    }
    // cinematic_motion: লোকাল ৫টি প্রকৃত; বাকি ৩টি সৎ-ডাউনগ্রেড
    for (const mv of ['static', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right'] as const) {
      expect(classifyMovement(mv, 'cinematic_motion').delivery).toBe('local_motion');
    }
    expect(fallbackMoveFor('dolly_tracking')).toBe('zoom_in');
    expect(fallbackMoveFor('handheld')).toBe('static');
    expect(fallbackMoveFor('orbit')).toBe('pan_right');
    for (const mv of ['dolly_tracking', 'handheld', 'orbit'] as const) {
      const cls = classifyMovement(mv, 'cinematic_motion');
      expect(cls.delivery).toBe('downgraded_to_local');
      expect(cls.downgradeReason).toBeTruthy();
    }
    // পরিকল্পনা-স্তরে: লাউড সেকশনে dolly_tracking স্লট → সমন্বয়-নোট + সৎ রায়
    const plan = planMusicVideo(
      mvInput({ engine: 'cinematic_motion', limit: 14, targetDurationSec: 60, beatsSec: [], sections: [{ startSec: 0, endSec: 60, energy: 'loud' }], beatSource: 'duration_fallback' }),
    );
    const dollyShots = plan.shots.filter(s => s.movement === 'dolly_tracking');
    expect(dollyShots.length).toBeGreaterThan(0);
    dollyShots.forEach(s => {
      expect(s.delivery).toBe('downgraded_to_local');
      expect(s.fallbackMove).toBe('zoom_in');
    });
    expect(plan.adjustments.some(a => a.from === 'dolly_tracking' && a.to === 'zoom_in')).toBe(true);
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
    // সারসংক্ষেপ-সততা: নেটিভ-প্যারামিটার নেই-এর স্পষ্ট ঘোষণা; লিপ-সিঙ্ক নেই
    const sAi = summarizePlan(planMusicVideo(mvInput()), 'ai_diffusion');
    expect(sAi.limitations.some(l => l.includes('নেটিভ ক্যামেরা-প্যারামিটার নেই'))).toBe(true);
    expect(sAi.limitations.some(l => l.includes('লিপ-সিঙ্ক নেই'))).toBe(true);
    const sCine = summarizePlan(planMusicVideo(mvInput()), 'cinematic_motion');
    expect(sCine.limitations.some(l => l.includes('প্রকৃত লোকাল ক্যামেরা-মোশন'))).toBe(true);
    // সংখ্যা-গণনা সৎ: ডেলিভারি-বাকি যোগফল = শট-সংখ্যা
    const dc = sCine.deliveryCounts;
    expect(dc.local_motion + dc.prompt_guided + dc.downgraded_to_local).toBe(sCine.shotCount);
  });

  // ---------------- §9-F: প্রম্পট-ম্যাপিং ----------------
  test('REG-16f (§9-F): প্রতিটি জেনারেশন-প্রভাবক ক্ষেত্র প্রম্পটে পৌঁছায়', () => {
    const mkShot = (over: Partial<CinematicShot>): CinematicShot => ({
      shotId: 'S01', sceneId: 'SC1', order: 0, subject: 'scene', size: 'wide',
      angle: 'eye_level', movement: 'static', fallbackMove: 'static', delivery: 'prompt_guided',
      actionEn: 'a rickshaw crosses the rain-soaked street', labelBn: 'শট ১', targetDurationSec: 5,
      ...over,
    });
    // প্রতিটি সাইজের ফ্রেমিং-বাক্য প্রম্পটে
    for (const size of SHOT_SIZES) {
      const p = buildCinematicVideoPrompt(mkShot({ size }));
      expect(p).toContain(sizeFramingPhrase(size));
    }
    // প্রতিটি মুভমেন্টের নির্দেশনা-বাক্য
    for (const movement of PLAN_MOVEMENTS) {
      const p = buildCinematicVideoPrompt(mkShot({ movement }));
      expect(p).toContain(movementPhrase(movement));
    }
    // অ্যাঙ্গেল: eye_level নীরব; বাকির বাক্য ওঠে
    expect(buildCinematicVideoPrompt(mkShot({ angle: 'eye_level' }))).not.toContain('angle');
    for (const angle of CAMERA_ANGLES.filter(a => a !== 'eye_level')) {
      const p = buildCinematicVideoPrompt(mkShot({ angle }));
      expect(p).toContain(anglePhrase(angle));
    }
    // action/composition/lighting/style/extra — সবই ঢোকে
    const rich = buildCinematicVideoPrompt(
      mkShot({ compositionEn: 'subject on the left third', lightingMood: 'warm evening glow' }),
      'Bengali rainy aesthetic',
      'Acting: the driver glances back',
    );
    expect(rich).toContain('a rickshaw crosses the rain-soaked street');
    expect(rich).toContain('subject on the left third');
    expect(rich).toContain('warm evening glow');
    expect(rich).toContain('Bengali rainy aesthetic');
    expect(rich).toContain('the driver glances back');
    // সীমা-নিরাপত্তা: সর্বোচ্চ ক্ষেত্রসহও ≤ ২০০০ (প্রোভাইডার-সীমা)
    const longest = buildCinematicVideoPrompt(
      mkShot({ actionEn: 'x'.repeat(5000), compositionEn: 'y'.repeat(500), lightingMood: 'z'.repeat(500) }),
      's'.repeat(500),
      'e'.repeat(1000),
    );
    expect(longest.length).toBeLessThanOrEqual(2000);
    // ইমেজ-প্রম্পট: action + ফ্রেমিং + CINEMATIC_SUFFIX-এর বাস্তব লেখা
    const img = buildCinematicImagePrompt(mkShot({ size: 'close_up' }), 'moody');
    expect(img).toContain('a rickshaw crosses the rain-soaked street');
    expect(img).toContain(sizeFramingPhrase('close_up'));
    expect(img).toContain('cinematic film still');
    expect(img).toContain('35mm');
    // LLM-ব্যর্থতার সৎ ফলব্যাক-বর্ণনা অ-খালি
    for (const size of SHOT_SIZES) {
      expect(fallbackActionEn(size, 'scene', false).length).toBeGreaterThan(0);
    }
  });

  test('REG-16f2 (P5-5a): আলো-মুড নির্ধারকভাবে বসে ও ভিডিও-প্রম্পটে পৌঁছায়', () => {
    // MV — সেকশন-শক্তির নির্ধারক ম্যাপ: প্রতিটি শটে lightingMood,
    // আর নির্মিত প্রম্পটে সেই ফ্রেজই (buildCinematicVideoPrompt-পথ)
    const loud = planMusicVideo(mvInput({ sections: [{ startSec: 0, endSec: 20, energy: 'loud' }] }));
    expect(loud.shots.length).toBeGreaterThan(0);
    expect(loud.shots.every(s => s.lightingMood === 'bold high-contrast lighting')).toBe(true);
    expect(buildCinematicVideoPrompt(loud.shots[0])).toContain('bold high-contrast lighting');
    const quiet = planMusicVideo(mvInput({ sections: [{ startSec: 0, endSec: 20, energy: 'quiet' }] }));
    expect(quiet.shots.every(s => s.lightingMood === 'soft diffused lighting')).toBe(true);
    expect(buildCinematicVideoPrompt(quiet.shots[0])).toContain('soft diffused lighting');
    // lightingMoodEn দিলে সব শটে সেটিই (শক্তি-ম্যাপকে অগ্রাহ্য করে)
    const fixed = planMusicVideo(mvInput({ lightingMoodEn: 'moonlit blue haze' }));
    expect(fixed.shots.every(s => s.lightingMood === 'moonlit blue haze')).toBe(true);
    expect(buildCinematicVideoPrompt(fixed.shots[0])).toContain('moonlit blue haze');

    // SF — দৃশ্যের সময় (timeOfDay) থেকে নির্ধারক ম্যাপ (EN), প্রম্পটেও
    const sf = planShortFilmShots(sfInput({ engine: 'cinematic_motion', limit: 16, durationSec: 90 }));
    const byScene = new Map(sf.shots.map(s => [s.sceneId, s.lightingMood]));
    expect(byScene.get('SC1')).toBe('soft first light of dawn'); // 'dawn'
    expect(byScene.get('SC2')).toBe('bright natural daylight'); // 'noon'
    expect(byScene.get('SC3')).toBe('warm golden dusk light'); // 'dusk'
    expect(byScene.get('SC4')).toBe('cool low-light night atmosphere'); // 'night'
    expect(buildCinematicVideoPrompt(sf.shots[sf.shots.length - 1])).toContain('cool low-light night atmosphere');
    // বাংলা সময়-মানও চেনে; চেনা-বহির্ভূত মানে নিরপেক্ষ ফলব্যাক
    const bn = planShortFilmShots(
      sfInput({ engine: 'cinematic_motion', limit: 8, durationSec: 30, scenes: [{ index: 1, location: 'ঘাট', timeOfDay: 'সন্ধ্যা', characters: [], action: 'বিদায়-দৃশ্য', estimatedSec: 30, dialogueCount: 0 }] }),
    );
    expect(bn.shots.length).toBeGreaterThan(0);
    expect(bn.shots.every(s => s.lightingMood === 'warm golden dusk light')).toBe(true);
    const unknown = planShortFilmShots(
      sfInput({ engine: 'cinematic_motion', limit: 8, durationSec: 30, scenes: [{ index: 1, location: 'l', timeOfDay: 'unnamed hour', characters: [], action: 'a', estimatedSec: 30, dialogueCount: 0 }] }),
    );
    expect(unknown.shots.every(s => s.lightingMood === 'neutral cinematic lighting')).toBe(true);
    expect(parseAndValidateShotPlan(clone(sf)).ok).toBe(true);
  });

  test('REG-16f3 (A2-F05, R-FIX-3): দৃশ্য-স্তরের lightingMood সৎ-মার্কার্ড প্ল্যানিং-প্লেসহোল্ডার', () => {
    // পূর্ণ পরিকল্পক + কঙ্কাল — উভয়ের দৃশ্য-বস্তুতেই provenance-মার্কার:
    // দৃশ্য-স্তরের 'scene-appropriate cinematic lighting' সাধারণ
    // প্লেসহোল্ডার — আর প্রকৃত পছন্দ নয়। প্রজন্ম-প্রভাবক পথ শট-স্তরের
    // নির্ধারক lightingMood (REG-16f2-লক — এখানে শুধু দৃশ্য/শট আলাদা প্রমাণ)।
    const plan = planShortFilmShots(sfInput());
    expect(plan.scenes.every(s => s.lightingMood === 'scene-appropriate cinematic lighting')).toBe(true);
    expect(plan.scenes.every(s => s.lightingProvenance === 'planning_only_generic')).toBe(true);
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
    const skel = planShortFilmSkeleton({ engine: 'ai_diffusion', limit: 2, durationSec: 30 });
    expect(skel.scenes.every(s => s.lightingProvenance === 'planning_only_generic')).toBe(true);
    // শট-স্তরের মান কখনো প্লেসহোল্ডার নয় — প্রতিটি শটে আলাদা নির্ধারক আলো
    for (const s of plan.shots) {
      expect(s.lightingMood).not.toBe('scene-appropriate cinematic lighting');
    }
  });

  test('REG-16f4 (D-F04, R-FIX-3): চরিত্র-নামযুক্ত OTS/রিয়্যাকশন বাক্য + character-যাচাই গার্ড', () => {
    // OTS/রিয়্যাকশন সাইজে চরিত্র থাকলে বাক্য সেই চরিত্রকেই নাম করে (নির্ধারক)
    expect(sizeFramingPhrase('over_the_shoulder', 'আকাশ')).toContain('আকাশ');
    expect(sizeFramingPhrase('reaction', 'প্রিয়া')).toContain('প্রিয়া');
    // চরিত্র না থাকলে (undefined/null/খালি) — আগের সাধারণ বাক্যই অবিকৃত
    // (t17/t19-এর এক-আর্গুমেন্ট কল-চুক্তি অপরিবর্তিত)
    expect(sizeFramingPhrase('over_the_shoulder')).toBe('over-the-shoulder shot, looking past a subject toward the scene');
    expect(sizeFramingPhrase('reaction', null)).toBe('reaction shot, the subject emotional response in focus');
    expect(sizeFramingPhrase('reaction', '  ')).toBe('reaction shot, the subject emotional response in focus');
    // বাকি সাইজে চরিত্র থাকলেও বাক্য সাধারণই (আই-কন্ডিশনিং image_url-ই চরিত্র-ভিত্তিক)
    expect(sizeFramingPhrase('medium', 'আকাশ')).toBe(sizeFramingPhrase('medium'));
    expect(sizeFramingPhrase('wide', 'প্রিয়া')).toBe(sizeFramingPhrase('wide'));
    // প্রম্পট-নির্মাতার মধ্য দিয়ে: shot.character → নামযুক্ত বাক্য (ভিডিও+ইমেজ)
    const mk = (over: Partial<CinematicShot>): CinematicShot => ({
      shotId: 'S01', sceneId: 'SC1', order: 0, subject: 'scene', size: 'wide',
      angle: 'eye_level', movement: 'static', fallbackMove: 'static', delivery: 'prompt_guided',
      actionEn: 'a conversation at a tea stall', labelBn: 'শট ১', targetDurationSec: 5,
      ...over,
    });
    const otsPrompt = buildCinematicVideoPrompt(mk({ size: 'over_the_shoulder', character: 'আকাশ' }));
    expect(otsPrompt).toContain(sizeFramingPhrase('over_the_shoulder', 'আকাশ'));
    const reactImg = buildCinematicImagePrompt(mk({ size: 'reaction', character: 'প্রিয়া' }));
    expect(reactImg).toContain(sizeFramingPhrase('reaction', 'প্রিয়া'));

    // যাচাইকারীর নতুন গার্ড: character উপস্থিত হলে অ-খালি স্ট্রিং হতেই হবে
    // (null বৈধ — MV-পথের স্পষ্ট "চরিত্র নেই"; undefined = অনুপস্থিত)
    const plan = planMusicVideo(mvInput());
    const emptyChar = clone(plan); (emptyChar.shots[0] as { character?: unknown }).character = '';
    const vEmpty = parseAndValidateShotPlan(emptyChar);
    expect(vEmpty.ok).toBe(false);
    expect(vEmpty.errors.some(e => e.includes('character'))).toBe(true);
    const badType = clone(plan); (badType.shots[0] as { character?: unknown }).character = 42;
    expect(parseAndValidateShotPlan(badType).ok).toBe(false);
    const nullChar = clone(plan); (nullChar.shots[0] as { character?: unknown }).character = null;
    expect(parseAndValidateShotPlan(nullChar).ok).toBe(true);
    const namedChar = clone(plan); (namedChar.shots[0] as { character?: unknown }).character = 'আকাশ';
    expect(parseAndValidateShotPlan(namedChar).ok).toBe(true);
  });

  test('REG-16r3 (T-R3, D-F03 planner-half): বাংলা উৎস-টেক্সট → ইংরেজি actionEn-ফলব্যাক + সৎ সমন্বয়', () => {
    // রিয়েল-রান-প্রমাণ (findings-d D-F03): স্ক্রিপ্ট-LLM বাংলা visualEn
    // ফেরালে বা visualEn না থাকলে location/timeOfDay/action-মিশ্রণ বাংলা
    // হলে আগে সেটি হুবহু CogVideoX-3 প্রম্পটে চলে যেত। এখন পরিকল্পকের
    // নিজের ফলব্যাক-পথ ইংরেজি-কেবল + প্রতি দৃশ্যে একটি সৎ সমন্বয়-নোট।
    const scenes: PlannerFilmScene[] = [
      { index: 1, location: 'নদীর ঘাট', timeOfDay: 'সন্ধ্যা', characters: [], action: 'আকাশ ঘাটে দাঁড়িয়ে তাকিয়ে আছে', visualEn: 'সন্ধ্যার আলোয় নদীর ঘাটে আকাশ দাঁড়িয়ে', estimatedSec: 10, dialogueCount: 0 },
      { index: 2, location: 'চায়ের দোকান', timeOfDay: 'রাত', characters: [], action: 'ঝড় শুরু হয়', estimatedSec: 10, dialogueCount: 0 }, // visualEn নেই → মিশ্র-ফলব্যাকও বাংলা
      { index: 3, location: 'roof', timeOfDay: 'night', characters: [], action: 'a quiet farewell', visualEn: 'A rooftop farewell under city lights at night', estimatedSec: 10, dialogueCount: 0 }, // ইংরেজি নিয়ন্ত্রণ
    ];
    const input = { engine: 'ai_diffusion' as const, limit: 3, durationSec: 30, scenes };
    const plan = planShortFilmShots(input);
    expect(parseAndValidateShotPlan(clone(plan)).ok).toBe(true);
    // প্রজন্ম-ক্ষেত্র ইংরেজি-লিপি: কোনো শটের actionEn-এ বাংলা লিপি নেই;
    // নির্মিত প্রম্পটেও নয় (চরিত্রহীন ফিক্সচার — নাম-বাহী বাক্যও নেই)
    for (const s of plan.shots) {
      expect(containsBengaliScript(s.actionEn)).toBe(false);
      expect(s.actionEn.trim().length).toBeGreaterThan(0);
      expect(containsBengaliScript(buildCinematicVideoPrompt(s))).toBe(false);
    }
    // ইংরেজি উৎস অপরিবর্তিত যায় (SC3) — ভাষা-চুক্তি কেবল বাংলা ধরলেই কাজ করে
    const sc3 = plan.shots.filter(s => s.sceneId === 'SC3');
    expect(sc3.length).toBe(1);
    expect(sc3[0].actionEn).toBe('A rooftop farewell under city lights at night');
    // সৎ সমন্বয়: প্রতিটি বাংলা-উৎস দৃশ্যে ঠিক একটি নোট — উৎস-ক্ষেত্রের নামসহ
    expect(plan.adjustments.map(a => a.field)).toEqual(['scene.SC1.visualEn', 'scene.SC2.action']);
    for (const a of plan.adjustments) {
      expect(a.from).toBe('বাংলা লিপি');
      expect(a.to).toBe('ইংরেজি ফলব্যাক');
      expect(a.reason).toContain('ইংরেজি ফলব্যাক');
      expect(a.reason).toContain('D-F03');
    }
    // নির্ধারক: একই ইনপুট → হুবহু একই পরিকল্পনা (LLM/RNG নেই)
    expect(JSON.stringify(planShortFilmShots(input))).toBe(JSON.stringify(plan));
    // ইংরেজি-মিশ্র বাহিরের ক্ষেত্র: ইংরেজি লোকেশন + বাংলা অ্যাকশন → বাংলা
    // ধরা পড়েই (কোনো আংশিক-ছাঁকাই নয়) — নির্ধারক সম্পূর্ণ-ফলব্যাক
    const mixed = planShortFilmShots({
      engine: 'ai_diffusion', limit: 3, durationSec: 30,
      scenes: [
        { index: 1, location: 'river ghat', timeOfDay: 'dawn', characters: [], action: 'নৌকা ভোরের কুয়াশায় আসে', estimatedSec: 10, dialogueCount: 0 },
        ...scenes.slice(1),
      ],
    });
    expect(mixed.shots.every(s => !containsBengaliScript(s.actionEn))).toBe(true);
    expect(mixed.adjustments.some(a => a.field === 'scene.SC1.action')).toBe(true);
  });

  // ---------------- §9-I: ওভাররাইড-স্যানিটাইজেশন ----------------
  test('REG-16i (§9-I): সার্ভার-পুনঃযাচাই — অবৈধ পরিকল্পনা-সম্পাদনা বাদ/সমন্বয়', () => {
    // sanitize: বৈধ এন্ট্রি থাকে, অবৈধ এনাম/সূচি/আকৃতি বাদ, সূচি-মার্জ
    const s1 = sanitizeOverridesInput({ shots: [{ index: 0, size: 'close_up', movement: 'orbit' }] }, 2);
    expect(s1.droppedCount).toBe(0);
    expect(s1.overrides?.shots[0]).toEqual({ index: 0, size: 'close_up', movement: 'orbit' });
    const s2 = sanitizeOverridesInput(
      { shots: [{ index: 0, size: 'megawide' }, { index: 9, movement: 'orbit' }, 'garbage', { index: 1 }, null] },
      2,
    );
    expect(s2.droppedCount).toBe(5);
    expect(s2.overrides).toBeUndefined(); // কোনো বৈধ এন্ট্রিই নেই
    const s3 = sanitizeOverridesInput({ shots: [{ index: 1, size: 'wide' }, { index: 1, movement: 'orbit' }] }, 2);
    expect(s3.overrides?.shots.length).toBe(1);
    expect(s3.overrides?.shots[0]).toEqual({ index: 1, size: 'wide', movement: 'orbit' });
    // >৬৪ এন্ট্রি — স্লাইস (সীমাবদ্ধ ইনপুট)
    const many = { shots: Array.from({ length: 80 }, (_, i) => ({ index: i % 2, size: 'wide' })) };
    expect(sanitizeOverridesInput(many, 2).overrides?.shots.length).toBeLessThanOrEqual(64);
    // A2-F03 (R-FIX-3): ক্যাপের বাইরের *বৈধ* এন্ট্রিও droppedCount-এ গণনা
    // হয় — আগে ৭০টি বৈধ এন্ট্রি দিলে ৬টি নীরবে উধাও হতো (droppedCount ০,
    // সৎ-নোটই জ্বলত না)। এখন ৭০ − ৬৪ = ৬টি সৎ-হিসাবে বাদ।
    const seventy = { shots: Array.from({ length: 70 }, (_, i) => ({ index: i % 2, size: 'wide' })) };
    const s70 = sanitizeOverridesInput(seventy, 2);
    expect(s70.droppedCount).toBe(6);
    expect(s70.overrides?.shots.length).toBe(2); // ক্যাপের ভিতরের বৈধ এন্ট্রি মার্জ-হয়ে বাঁচে
    expect(sanitizeOverridesInput(many, 2).droppedCount).toBe(80 - 64);

    // applyOverrides: size বদল → সমন্বয়-নোটসহ প্রয়োগ
    const plan = planMusicVideo(mvInput());
    const withSize = applyOverrides(clone(plan), { shots: [{ index: 0, size: 'extreme_close_up' }] }, 'ai_diffusion');
    expect(withSize.shots[0].size).toBe('extreme_close_up');
    expect(withSize.adjustments.some(a => a.field.endsWith('S01.size') && a.to === 'extreme_close_up')).toBe(true);
    // movement=orbit + cinematic_motion → ডাউনগ্রেড-রায় নতুন করে মূল্যায়ন
    const withOrbit = applyOverrides(clone(plan), { shots: [{ index: 1, movement: 'orbit' }] }, 'cinematic_motion');
    expect(withOrbit.shots[1].movement).toBe('orbit');
    expect(withOrbit.shots[1].delivery).toBe('downgraded_to_local');
    expect(withOrbit.shots[1].fallbackMove).toBe('pan_right');
    expect(withOrbit.adjustments.some(a => a.from === 'orbit' && a.to === 'pan_right')).toBe(true);
    // সীমার-বাইরের সূচি → নীরবে নয়, সৎ 'বাদ' নোট
    const oob = applyOverrides(clone(plan), { shots: [{ index: 9, size: 'wide' }] }, 'ai_diffusion');
    expect(oob.shots.length).toBe(plan.shots.length); // পরিকল্পনা অপরিবর্তিত
    expect(oob.adjustments.some(a => a.field.includes('shot-override[9]') && a.to === 'বাদ')).toBe(true);
    expect(parseAndValidateShotPlan(clone(withOrbit)).ok).toBe(true);

    // validateSpec (§15): বৈধ ওভাররাইড যাচাইকৃত spec-এ বাঁচে; অবৈধ বাদ + সমন্বয়
    const v1 = validateSpec({ type: 'music_video', title: 'এমভি', durationSec: 20, quality: 'draft', cinematicOverrides: { shots: [{ index: 0, size: 'close_up', movement: 'zoom_in' }] } });
    expect(v1.ok).toBe(true);
    expect(v1.validated?.spec.cinematicOverrides?.shots[0]?.size).toBe('close_up');
    const v2 = validateSpec({ type: 'music_video', title: 'এমভি', durationSec: 20, quality: 'draft', cinematicOverrides: { shots: [{ index: 0, size: 'megawide' }, { index: 3, movement: 'orbit' }] } });
    expect(v2.ok).toBe(true);
    expect(v2.validated?.spec.cinematicOverrides).toBeUndefined();
    expect(v2.validated?.adjustments.some(a => a.field === 'cinematicOverrides')).toBe(true);
    // শর্টফিল্মে ওভাররাইড নেই — পুরোটাই বাদ
    const v3 = validateSpec({ type: 'short_film', title: 'ফিল্ম', durationSec: 40, quality: 'draft', cinematicOverrides: { shots: [{ index: 0, size: 'wide' }] } });
    expect(v3.ok).toBe(true);
    expect(v3.validated?.spec.cinematicOverrides).toBeUndefined();
  });

  // ---------------- §9-L: ক্যাশ-ফিঙ্গারপ্রিন্ট সীমানা ----------------
  test('REG-16l (§9-L): পরিকল্পনা-বদল → নতুন ফিঙ্গারপ্রিন্ট (ভুল পুনঃব্যবহার অসম্ভব)', () => {
    const mkFp = (prompt: string) =>
      shotCacheFingerprint({ v: SHOT_CACHE_SCHEMA_VERSION, model: 'cogvideox-3', prompt, durationSec: 5, quality: 'speed', imageUrl: null, withAudio: false, size: null }).sha256;
    const plan = planMusicVideo(mvInput());
    const shot = plan.shots[0];
    const p1 = mkFp(buildCinematicVideoPrompt(shot));
    // একই শট → একই কী
    expect(mkFp(buildCinematicVideoPrompt(shot))).toBe(p1);
    // ফ্রেমিং-বদল (ওভাররাইড) → ভিন্ন প্রম্পট → ভিন্ন কী
    const resized = clone(shot); resized.size = 'extreme_close_up';
    expect(mkFp(buildCinematicVideoPrompt(resized))).not.toBe(p1);
    // মুভমেন্ট-বদল → ভিন্ন কী
    const moved = clone(shot); moved.movement = 'orbit';
    expect(mkFp(buildCinematicVideoPrompt(moved))).not.toBe(p1);
    // অ্যাকশন-বদল → ভিন্ন কী
    const acted = clone(shot); acted.actionEn = 'a completely different visible action';
    expect(mkFp(buildCinematicVideoPrompt(acted))).not.toBe(p1);
  });

  // ---------------- পরিকল্পনা-মেট্রিকস ----------------
  test('REG-16m: মেট্রিকস — সংখ্যা-কেবল ক্ষেত্র, -1 = চলেনি, লাইনে প্ল্যান-ব্লক শর্তসাপেক্ষে', () => {
    const id = 'reg16m-prod';
    const acc = getProductionMetrics(id)!;
    expect(acc.planMs).toBe(-1); // ডিফল্ট: পরিকল্পক চলেনি
    expect(acc.plannedShots).toBe(-1);
    expect(acc.planAdjustments).toBe(-1);
    // REG-11b-চুক্তি: সঞ্চয়কারীর প্রতিটি মান সংখ্যা
    for (const v of Object.values(acc)) expect(typeof v).toBe('number');
    notePlanMetrics(id, { planMs: 4, plannedShots: 6, planAdjustments: 2 });
    expect(acc.planMs).toBe(4);
    expect(acc.plannedShots).toBe(6);
    expect(acc.planAdjustments).toBe(2);

    // মেট্রিকস-লাইন: পরিকল্পক চললে plan-ব্লক, না চললে ব্লকই নেই
    const lines: string[] = [];
    const origLog = console.log;
    console.log = ((...args: unknown[]) => { lines.push(String(args[0])); }) as typeof console.log;
    try {
      logProductionMetrics({
        productionId: id, type: 'music_video', outcome: 'completed',
        queueWaitMs: 1, durationMs: 100, stepsDone: 6, stepsFailed: 0, artifacts: 3,
        errorCategoryHint: null,
        plan: { planMs: acc.planMs, plannedShots: acc.plannedShots, planAdjustments: acc.planAdjustments },
        video: { shotsRequested: 6, shotsFromCache: 0, shotsJoined: 0, providerSubmits: 6, shotsBypassed: 0, cacheStores: 6, cacheInvalid: 0, submitMs: 1, pollMs: 1, downloadMs: 1, validateMs: 1 },
      });
      logProductionMetrics({
        productionId: 'reg16m-noplan', type: 'motion_video', outcome: 'completed',
        queueWaitMs: 1, durationMs: 100, stepsDone: 6, stepsFailed: 0, artifacts: 3, errorCategoryHint: null,
      });
    } finally {
      console.log = origLog;
    }
    const planLine = lines.find(l => l.startsWith('[production-metrics]') && l.includes('"music_video"'));
    expect(planLine).toBeTruthy();
    const parsed = JSON.parse(planLine!.slice('[production-metrics] '.length));
    expect(parsed.plan).toEqual({ planMs: 4, plannedShots: 6, planAdjustments: 2 });
    const plainLine = lines.find(l => l.startsWith('[production-metrics]') && l.includes('"motion_video"'));
    expect(plainLine).toBeTruthy();
    expect(JSON.parse(plainLine!.slice('[production-metrics] '.length)).plan).toBeUndefined();
  });

  // ---------------- প্রিভিউ/রান একক উৎস (§9-C/F-সম্প্রসারণ) ----------------
  test('REG-16p: proceduralSongGrid = synthesizeInstrumental-এর গ্রিড (প্রিভিউ/রান অভিন্ন)', async () => {
    const mood = resolveInstrumentalMood({ mood: 'melancholic', idea: '', title: '', genre: '' });
    const grid = proceduralSongGrid({ mood, durationSec: 20, tempoBpm: 96 });
    const inst = await synthesizeInstrumental({ mood, durationSec: 20, tempoBpm: 96 });
    expect(inst.meta.beatsSec).toEqual(grid.beatsSec);
    expect(inst.meta.tempoBpm).toBe(grid.tempoBpm);
    expect(inst.meta.sections.map(s => s.name)).toEqual(grid.sections.map(s => s.name));
    // নির্ধারক: একই ইনপুট → একই গ্রিড
    expect(JSON.stringify(proceduralSongGrid({ mood, durationSec: 20, tempoBpm: 96 }))).toBe(JSON.stringify(grid));
  });

  test('REG-16p2: প্রিভিউ-পরিকল্পনা = পাইপলাইন-সূত্র (শট-সংখ্যা/কাট-জানালা অভিন্ন)', async () => {
    // প্রসিডিউরাল পথ — গান-ফাইল ছাড়াই
    const spec = { type: 'music_video', title: 'বৃষ্টির শহর', durationSec: 20, quality: 'draft', mood: 'melancholic' } as const;
    const v = validateSpec({ ...spec });
    const preview = await buildMusicVideoPlanPreview({ spec: v.validated!.spec, song: null });
    expect(preview.plan.beatSource).toBe('bpm_grid_estimate');
    expect(preview.summary.beatSource).toBe('bpm_grid_estimate');
    expect(preview.plan.shots.length).toBe(musicVideoShotCount(2, 20, 'ai_diffusion'));
    expect(parseAndValidateShotPlan(clone(preview.plan)).ok).toBe(true);
    // প্রিভিউ-জানালা = পাইপলাইন-পরিকল্পকের জানালা (একই ইনপুটে)
    const mood = resolveInstrumentalMood({ mood: 'melancholic', idea: undefined, title: 'বৃষ্টির শহর', genre: undefined });
    const grid = proceduralSongGrid({ mood, durationSec: 20, tempoBpm: undefined });
    const runPlan = planMusicVideo(
      mvInput({
        targetDurationSec: grid.durationSec,
        beatsSec: grid.beatsSec,
        sections: grid.sections.map(s => ({ startSec: s.startSec, endSec: s.endSec, energy: s.name === 'chorus' ? 'loud' : s.name === 'verse' ? 'medium' : 'quiet' })),
        beatSource: 'bpm_grid_estimate',
      }),
    );
    expect(runPlan.shots.map(s => [s.startSec, s.endSec])).toEqual(preview.plan.shots.map(s => [s.startSec, s.endSec]));
    expect(preview.beatSourceLabel).toContain('BPM-গ্রিড');
  });

  test('REG-16p3: শর্টফিল্ম প্রিভিউ — কঙ্কাল + সৎ সীমা-ঘোষণা', () => {
    const v = validateSpec({ type: 'short_film', title: 'ফেয়ারওয়েল', durationSec: 40, quality: 'draft' });
    const preview = buildShortFilmPlanPreview({ spec: v.validated!.spec });
    expect(parseAndValidateShotPlan(clone(preview.plan)).ok).toBe(true);
    expect(preview.plan.type).toBe('short_film');
    expect(preview.summary.limitations.some(l => l.includes('জেনারেশন-সময়ে'))).toBe(true);
    expect(preview.summary.shotCount).toBe(preview.plan.shots.length);
  });

  test('REG-16p4: আপলোড-গান বিশ্লেষণ-ক্যাশ — একই কী হিট, নতুন storedAt মিস, LRU সীমা', async () => {
    const dir = await freshDir('reg16p4');
    const wav = await buildSpeechWav(dir, 'song.wav');
    const file = path.join(dir, 'song-copy.wav');
    await writeFile(file, wav);
    const art = { id: 'song-art-1', storedAt: new Date('2026-01-01T00:00:00Z') };

    // প্রথম বিশ্লেষণ (মিস) → দ্বিতীয় কল একই অবজেক্ট-রেফারেন্স (ক্যাশ-হিট)
    const a = await analyzeSongArtifactCached(art, file);
    const b = await analyzeSongArtifactCached(art, file);
    expect(b).toBe(a);
    expect(a.durationSec).toBeGreaterThan(0);

    // storedAt বদলালে কী বদলে → পুনঃবিশ্লেষণ (নতুন অবজেক্ট, মান সমান)
    const c = await analyzeSongArtifactCached({ id: 'song-art-1', storedAt: new Date('2026-02-01T00:00:00Z') }, file);
    expect(c).not.toBe(a);
    expect(c.durationSec).toBeCloseTo(a.durationSec, 1);

    // LRU সীমা (≤৮): ৯টি ভিন্ন কী ঢোকালে প্রথমটি উচ্ছেদিত → পুনঃবিশ্লেষণ
    for (let i = 0; i < 8; i++) {
      await analyzeSongArtifactCached({ id: `song-lru-${i}`, storedAt: new Date() }, file);
    }
    const again = await analyzeSongArtifactCached(art, file);
    expect(again).not.toBe(a); // 'song-art-1' এন্ট্রি আর ক্যাশে নেই
  });

  test('REG-16p5: আপলোড-গান প্রিভিউ — বিট না মিললে সৎ duration_fallback', async () => {
    // নিয়তিষ্ক সাইন-টোনে বিট নেই — প্রিভিউ কখনো বানানো বিট দেখায় না
    const dir = await freshDir('reg16p5');
    const file = path.join(dir, 'sine.wav');
    await writeFile(file, await buildSpeechWav(dir, 's2.wav'));
    const v = validateSpec({ type: 'music_video', title: 'টোন', durationSec: 1.2, quality: 'draft', songArtifactId: 'song-x' });
    const preview = await buildMusicVideoPlanPreview({ spec: v.validated!.spec, song: { id: 'song-x', storedAt: new Date(), file } });
    // দৈর্ঘ্য-ক্ল্যাম্প: গান ১.২ সে. → টার্গেট ≥ ৫
    expect(preview.plan.beatSource).toBe('duration_fallback');
    expect(preview.plan.totalPlannedSec).toBeGreaterThanOrEqual(5);
    expect(parseAndValidateShotPlan(clone(preview.plan)).ok).toBe(true);
  });
});
