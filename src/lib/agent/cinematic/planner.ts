// ============================================================
// Deterministic cinematic planner — Phase 5 (Cinematic Director)।
//
// নির্ধারক, বিশুদ্ধ, পরীক্ষাযোগ্য: একই ইনপুট → একই পরিকল্পনা
// (কোনো RNG/বীজ নেই)। LLM নয়, DB নয়, SDK নয়।
//
//  - মিউজিক ভিডিও: বিট-কাট (Phase-4-এর অ্যালগরিদম হুবহু — একক
//    সত্যের উৎস) + এস্টাব্লিশিং → পারফরম্যান্স/শ্বাস-প্রশ্বাস →
//    ডিটেইল → সমাপনি-আর্ক; শক্তি-সচেতন সাইজ/মুভমেন্ট।
//  - শর্টফিল্ম: দৃশ্য-তালিকা থেকে কভারেজ (এস্টাব্লিশিং জিওগ্রাফি →
//    অ্যাকশন → সংলাপ OTS/রিঅ্যাকশন → ডিটেইল → সমাপনি)।
//  - বৈচিত্র্য-নিয়ম (§3): টানা একই নন-স্ট্যাটিক মুভমেন্ট নয় (static
//    পুনরাবৃত্তি বৈধ); সন্নিহিত শটে একই সাইজ এড়ানো যতটা সম্ভব —
//    শক্তি-জোড়ার বিকল্পে গিয়ে; জোড়া-ক্ষয়ে শক্তি-সঠিক সাইজ + সৎ-
//    সমন্বয়-নোট। স্থির-আর্ক স্লট (প্রথম/শেষ) নিয়মের বাইরে।
// ============================================================

import type {
  CameraAngle,
  CinematicPlan,
  CinematicPlanSummary,
  CinematicOverrides,
  CinematicScene,
  CinematicShot,
  PlanAdjustment,
  PlanBeatSource,
  PlanMovement,
  ShotSize,
  ShotSubject,
} from './types';
import { SHOT_PLAN_VERSION, shotIdFor } from './types';
import { classifyMovement } from './capability_map';
import { containsBengaliScript } from './lang-guard';

const round2 = (v: number) => Math.round(v * 100) / 100;

// ------------------------------------------------------------
// বিট-কাট — Phase-4 music_video visual_plan-এর অ্যালগরিদম হুবহু
// (একক সত্যের উৎস: প্রিভিউ আর পাইপলাইন একই ফাংশন ডাকে)
// ------------------------------------------------------------

export interface CutSegment {
  startSec: number;
  endSec: number;
  energy: string;
}

/**
 * বিট-মার্কার থেকে কাট-পয়েন্ট — সমান দূরত্বে বিট বাছাই (প্রতিটি বিট নয়),
 * ন্যূনতম ফাঁক ১.২ সে.; বিট না থাকলে সময়-গ্রিড ফলব্যাক।
 * music_video.ts-এর মূল যুক্তির বিশুদ্ধ রূপ (Phase-4 আচরণ অপরিবর্তিত)।
 */
export function selectCutSegments(
  beatsSec: number[],
  targetDurationSec: number,
  shotCount: number,
  energyAt: (t: number) => string
): CutSegment[] {
  const targetDuration = Math.max(1, targetDurationSec);
  const usable = (beatsSec ?? []).filter(b => b > 1 && b < targetDuration - 1);
  const interior: number[] = [];
  if (usable.length >= shotCount - 1) {
    for (let k = 1; k <= shotCount - 1; k++) {
      const idx = Math.min(usable.length - 1, Math.max(0, Math.round((k * usable.length) / shotCount) - 1));
      interior.push(usable[idx]);
    }
  } else {
    for (let k = 1; k <= shotCount - 1; k++) interior.push(round2((k * targetDuration) / shotCount));
  }
  const bounds: number[] = [0];
  for (const b of interior.sort((a, b) => a - b)) {
    if (b - bounds[bounds.length - 1] >= 1.2 && targetDuration - b >= 1.2) bounds.push(round2(b));
  }
  bounds.push(targetDuration);
  return bounds.slice(0, -1).map((b, i) => ({
    startSec: b,
    endSec: bounds[i + 1],
    energy: energyAt((b + bounds[i + 1]) / 2),
  }));
}

/** শট-সংখ্যা — Phase-4-এর সূত্রই (maxShots + segCap-ক্ল্যাম্প) */
export function musicVideoShotCount(
  limit: number,
  targetDurationSec: number,
  engine: 'ai_diffusion' | 'cinematic_motion'
): number {
  const segCap = engine === 'ai_diffusion' ? 10 : 6;
  return Math.max(engine === 'ai_diffusion' ? 1 : 3, Math.min(limit, Math.ceil(targetDurationSec / segCap)));
}

// ------------------------------------------------------------
// মিউজিক-ভিডিও আর্ক
// ------------------------------------------------------------

export interface MusicVideoPlanInput {
  /** যাচাইকৃত spec-এর মূল ক্ষেত্র (বিশুদ্ধ মান — পুরো spec নয়)।
   *  quality-ধাপ বাদ: শট-বাজেট `limit`-এই (maxShots) সাংকেতিক —
   *  পরিকল্পক quality দিয়ে কিছু করে না। */
  engine: 'ai_diffusion' | 'cinematic_motion';
  /** maxShots('music_video', quality, engine) */
  limit: number;
  /** গানের ব্যবহৃত অংশ (সে.) */
  targetDurationSec: number;
  beatsSec: number[];
  /** এনার্জি-সেকশন (মাপা বা প্রসিডিউরাল-মেটা) */
  sections: { startSec: number; endSec: number; energy: string }[];
  beatSource: PlanBeatSource;
  /** শিল্পী-চরিত্র থাকবে কি (পারফরম্যান্স/রিঅ্যাকশন স্লটের ভিত্তি) */
  hasArtist: boolean;
  visualStyle?: string;
  /** সব শটের জন্য স্থির আলো-মুড (দেওয়া থাকলে শক্তি-ম্যাপকে অগ্রাহ্য করে) */
  lightingMoodEn?: string;
}

/** শক্তি → মুভমেন্ট-পুল (নির্ধারক ক্রম) */
const MOVEMENT_POOLS: Record<string, PlanMovement[]> = {
  loud: ['dolly_tracking', 'zoom_in'],
  medium: ['pan_left', 'zoom_in', 'pan_right'],
  quiet: ['static', 'zoom_out'],
};

/** শক্তি → সাইজ-জোড়া (§3 বৈচিত্র্য-নিয়ম: সন্নিহিত একই সাইজ এড়াতে
 *  জোড়ার বিকল্পে যাওয়া — pickMovement-এর একই প্যাটার্ন) */
const SIZE_PAIRS: Record<string, [ShotSize, ShotSize]> = {
  loud: ['medium', 'close_up'],
  medium: ['wide', 'medium'],
  quiet: ['wide', 'establishing_wide'],
};

/** শক্তি → নির্ধারক আলো-মুড (lightingMoodEn না দিলে) */
const ENERGY_LIGHTING: Record<string, string> = {
  loud: 'bold high-contrast lighting',
  medium: 'balanced natural lighting',
  quiet: 'soft diffused lighting',
};

/** শক্তি-জোড়ার বিকল্প — সাইজটা জোড়ায় না থাকলে undefined */
function pairAlternate(energy: string, size: ShotSize): ShotSize | undefined {
  const pair = SIZE_PAIRS[energy] ?? SIZE_PAIRS.medium;
  if (pair[0] === size) return pair[1];
  if (pair[1] === size) return pair[0];
  return undefined;
}

/** জোড়া-ক্ষয়ের সৎ-সমন্বয়-কারণ (দুই বিকল্পই পার্শ্ববর্তী শটের সাথে মেলে) */
const SIZE_EXHAUSTION_REASON =
  'বৈচিত্র্য-নিয়মের সীমা: শক্তি-জোড়ার বিকল্প কোনোটিই পার্শ্ববর্তী শটের সাইজের সাথে মিল ছাড়া বসতে পারে না — সন্নিহিত সাইজ-পুনরাবৃত্তি অনিবার্য; শক্তি-সঠিক সাইজ বহাল রাখা হলো';

/** LLM-স্লট ব্যর্থ হলে সৎ নির্ধারক বর্ণনা (সাইজ+সাবজেক্ট-ভিত্তিক) */
export function fallbackActionEn(size: ShotSize, subject: ShotSubject, isLast: boolean): string {
  if (isLast) return 'Emotional closing shot as the music resolves';
  if (subject === 'environment' && size === 'establishing_wide') {
    return 'Cinematic establishing shot introducing the world of the song';
  }
  switch (size) {
    case 'establishing_wide':
      return 'Cinematic establishing shot introducing the world of the song';
    case 'wide':
      return subject === 'environment'
        ? 'Breathing space — environment and atmosphere between musical moments'
        : 'Atmospheric wide view of the scene matching the music energy';
    case 'medium':
      return subject === 'artist_performance'
        ? 'The performing artist moving expressively with the music'
        : 'The scene plays out with the artist in frame, matching the music';
    case 'close_up':
      return 'Intimate close-up of the artist emoting with the music';
    case 'extreme_close_up':
      return 'A small expressive detail carrying the feeling of the track';
    case 'over_the_shoulder':
      return 'View past the subject toward the moment unfolding in the scene';
    case 'insert':
      return 'A telling visual detail that deepens the song mood';
    case 'reaction':
      return 'A quiet reaction moment carrying the emotion of the track';
  }
}

function fallbackLabelBn(order: number, size: ShotSize): string {
  const n = order + 1;
  switch (size) {
    case 'establishing_wide':
      return `শট ${n} — এস্টাব্লিশিং`;
    case 'wide':
      return `শট ${n} — ওয়াইড`;
    case 'medium':
      return `শট ${n} — মিডিয়াম`;
    case 'close_up':
      return `শট ${n} — ক্লোজ-আপ`;
    case 'extreme_close_up':
      return `শট ${n} — এক্সট্রিম ক্লোজ-আপ`;
    case 'over_the_shoulder':
      return `শট ${n} — OTS`;
    case 'insert':
      return `শট ${n} — ডিটেইল`;
    case 'reaction':
      return `শট ${n} — রিঅ্যাকশন`;
  }
}

/** পুল থেকে মুভমেন্ট বাছাই — টানা একই নন-স্ট্যাটিক মুভ দুবার নয় */
function pickMovement(pool: PlanMovement[], slot: number, previous: PlanMovement | undefined): PlanMovement {
  const candidate = pool[slot % pool.length];
  if (candidate === previous && candidate !== 'static' && pool.length > 1) {
    return pool[(slot + 1) % pool.length];
  }
  return candidate;
}

/** মিউজিক-ভিডিওর সম্পূর্ণ নির্ধারক আর্ক-পরিকল্পনা */
export function planMusicVideo(input: MusicVideoPlanInput): CinematicPlan {
  const shotCount = musicVideoShotCount(input.limit, input.targetDurationSec, input.engine);
  const energyAt = (t: number): string => {
    const s = (input.sections ?? []).find(x => t >= x.startSec && t < x.endSec);
    return s?.energy ?? 'medium';
  };
  const segs = selectCutSegments(input.beatsSec, input.targetDurationSec, shotCount, energyAt);
  const N = segs.length;
  const adjustments: PlanAdjustment[] = [];

  // দৃশ্য: শক্তি-রান অনুযায়ী গুষ্টি (প্রথমটি পরিচিতি, সর্বোচ্চ ৬টি)
  const sceneRunOf: number[] = [];
  const scenes: CinematicScene[] = [];
  for (let i = 0; i < N; i++) {
    const energy = segs[i].energy;
    const purpose = i === 0 ? 'পরিচিতি ও পরিবেশ' : energyPurpose(energy);
    const prev = scenes[scenes.length - 1];
    if (i === 0 || !prev || (prev.purpose !== purpose && scenes.length < 6)) {
      scenes.push(sceneForEnergy(energy, scenes.length + 1, i === 0));
    }
    sceneRunOf.push(scenes.length - 1);
  }

  // স্লট-বরাদ্দ: আর্ক-নিয়ম (এস্টাব্লিশিং → শক্তি-চালিত মাঝ → ডিটেইল/রিঅ্যাকশন → সমাপনি)
  const detailSlot = N >= 5 ? Math.floor((N - 1) / 2) : -1;
  let reactionSlot = -1;
  if (N >= 6 && input.hasArtist) {
    // মাঝ-পথের প্রথম loud/medium স্লটটিতে রিঅ্যাকশন (এস্টাব্লিশিং/শেষ বাদে)
    for (let i = Math.ceil(N / 2); i < N - 1; i++) {
      if (segs[i].energy !== 'quiet') {
        reactionSlot = i;
        break;
      }
    }
    if (reactionSlot === -1) reactionSlot = Math.ceil(N / 2);
  }

  let loudPerfIdx = 0;
  let mediumIdx = 0;
  let quietIdx = 0;
  let prevMovement: PlanMovement | undefined;
  const shots: CinematicShot[] = [];

  for (let i = 0; i < N; i++) {
    const seg = segs[i];
    const isLast = i === N - 1;
    let subject: ShotSubject;
    let size: ShotSize;
    let angle: CameraAngle = 'eye_level';

    if (i === 0) {
      subject = 'environment';
      size = 'establishing_wide';
    } else if (isLast) {
      subject = 'scene';
      size = 'wide';
    } else if (i === detailSlot) {
      subject = 'detail';
      size = 'insert';
    } else if (i === reactionSlot) {
      subject = 'reaction';
      size = 'reaction';
    } else if (seg.energy === 'loud') {
      subject = 'artist_performance';
      size = input.hasArtist ? (loudPerfIdx % 2 === 0 ? 'medium' : 'close_up') : 'wide';
      loudPerfIdx++;
    } else if (seg.energy === 'quiet') {
      subject = 'environment';
      size = quietIdx % 2 === 0 ? 'wide' : 'establishing_wide';
      quietIdx++;
    } else {
      subject = 'scene';
      size = mediumIdx % 2 === 0 ? 'wide' : 'medium';
      mediumIdx++;
    }

    // §3 সন্নিহিত-সাইজ নিয়ম — কেবল মাঝ-স্লটে (i=0/শেষ স্থির-আর্ক,
    // নিয়মের বাইরে): বেছে-নেওয়া সাইজ আগের শটের সাথে মিললে শক্তি-
    // জোড়ার বিকল্প; পূর্বান্ত-স্লটে (i=N-2) 'wide'-ও মেলে ধরা হয় (শেষ
    // শট সবসময় wide)। জোড়া-ক্ষয়ে (বিকল্প নেই/বিকল্পও মেলে) শক্তি-সঠিক
    // সাইজ + একটি সৎ-সমন্বয়। নকশা-স্বীকৃত ব্যতিক্রম: লাউড সেকশনের
    // ভিতরে ≤২-শটের medium-রান (নকশাপত্র §3)।
    if (i > 0 && i < N - 1) {
      const prevSize = shots[shots.length - 1]?.size;
      const sanctionedMediumRun =
        size === 'medium' &&
        prevSize === 'medium' &&
        seg.energy === 'loud' &&
        segs[i - 1].energy === 'loud';
      const clashesPrev = size === prevSize;
      const penultimateBeforeFixedWide = i === N - 2 && size === 'wide';
      if (!sanctionedMediumRun && (clashesPrev || penultimateBeforeFixedWide)) {
        const alt = pairAlternate(seg.energy, size);
        if (alt && alt !== prevSize) {
          size = alt;
        } else {
          adjustments.push({
            field: `shot.${shotIdFor(i)}.size`,
            from: alt ?? '—',
            to: size,
            reason: SIZE_EXHAUSTION_REASON,
          });
        }
      }
    }

    // মুভমেন্ট — শক্তি-পুল + পুনরাবৃত্তি-নিয়ম
    let movement: PlanMovement;
    if (i === 0) movement = N === 1 ? 'static' : 'zoom_in';
    else if (isLast) movement = 'zoom_out';
    else {
      const pool = MOVEMENT_POOLS[seg.energy] ?? MOVEMENT_POOLS.medium;
      movement = pickMovement(pool, i, prevMovement);
      // পূর্বান্ত-স্লট: শেষ শট §2.2-অনুযায়ী সবসময় zoom_out — টানা
      // zoom_out,zoom_out এড়াতে পূর্বান্ত স্লটে zoom_out বসে না (শান্ত-
      // পুলের বিকল্প static; static-পুনরাবৃত্তি নকশা-স্বীকৃত)।
      if (i === N - 2 && movement === 'zoom_out') {
        movement = pool.find(m => m !== 'zoom_out' && m !== prevMovement) ?? 'static';
      }
    }
    prevMovement = movement;

    const cls = classifyMovement(movement, input.engine);
    if (cls.downgradeReason) {
      adjustments.push({
        field: `shot.${shotIdFor(i)}.movement`,
        from: movement,
        to: cls.fallbackMove,
        reason: cls.downgradeReason,
      });
    }

    // আলো-মুড: সেকশন-শক্তির নির্ধারক ম্যাপ (lightingMoodEn দিলে সব
    // শটে সেটিই) — প্রম্পটে যায় (buildCinematicVideoPrompt)।
    const lightingMood = input.lightingMoodEn ?? ENERGY_LIGHTING[seg.energy] ?? ENERGY_LIGHTING.medium;

    shots.push({
      shotId: shotIdFor(i),
      sceneId: `SC${sceneRunOf[i] + 1}`,
      order: i,
      subject,
      size,
      angle,
      movement,
      fallbackMove: cls.fallbackMove,
      delivery: cls.delivery,
      actionEn: fallbackActionEn(size, subject, isLast),
      lightingMood,
      labelBn: fallbackLabelBn(i, size),
      startSec: seg.startSec,
      endSec: seg.endSec,
      targetDurationSec: round2(seg.endSec - seg.startSec),
      ...(input.hasArtist && (subject === 'artist_performance' || subject === 'reaction')
        ? { character: null as null }
        : {}),
    });
  }

  const totalPlannedSec = round2(shots.reduce((a, s) => a + s.targetDurationSec, 0));
  return {
    version: SHOT_PLAN_VERSION,
    type: 'music_video',
    beatSource: input.beatSource,
    totalPlannedSec,
    ...(input.visualStyle ? { visualStyle: input.visualStyle } : {}),
    scenes,
    shots,
    adjustments,
  };
}

function energyPurpose(energy: string): string {
  if (energy === 'loud') return 'পারফরম্যান্স-চূড়া';
  if (energy === 'quiet') return 'শান্ত-ব্যঞ্জনা';
  return 'মূল-প্রবাহ';
}

function sceneForEnergy(energy: string, n: number, isOpening: boolean): CinematicScene {
  return {
    sceneId: `SC${n}`,
    purpose: isOpening ? 'পরিচিতি ও পরিবেশ' : energyPurpose(energy),
    narrativeBeat: isOpening
      ? 'গানের জগৎ পরিচিতি — এস্টাব্লিশিং মুহূর্ত'
      : energy === 'loud'
        ? 'গানের জোরালো অংশ — পারফরম্যান্স কেন্দ্রবিন্দু'
        : energy === 'quiet'
          ? 'শান্ত অংশ — ভিজ্যুয়াল শ্বাস-প্রশ্বাস'
          : 'গানের মূল প্রবাহ — দৃশ্য ও আবেগ',
    environment: 'the world of the song',
    lightingMood: 'mood-matched cinematic lighting',
  };
}

// ------------------------------------------------------------
// শর্টফিল্ম কভারেজ — দৃশ্য-তালিকা থেকে নির্ধারক শট-বিভাজন
// ------------------------------------------------------------

export interface PlannerFilmScene {
  index: number;
  location: string;
  timeOfDay: string;
  characters: string[];
  action: string;
  /** ইংরেজি দৃশ্যমান-বর্ণনা (জেনারেশন-মুখী) — Phase-4-এর LLM#2 যে
   * ইংরেজি description লিখত, সেই চুক্তি বজায় রাখে। bn-ফিল্মে action
   * বাংলায় হয় (ভাষা-নিয়ম) — প্রম্পট কিন্তু ইংরেজিতে যায়; খালি হলে
   * সৎ-ফলব্যাক: action/location-এর মিশ্র-পাঠ (Phase-4-ফলব্যাকের মতোই)। */
  visualEn?: string;
  estimatedSec: number;
  dialogueCount: number;
}

export interface ShortFilmPlanInput {
  /** quality-ধাপ বাদ: শট-বাজেট `limit`-এই (maxShots) সাংকেতিক */
  engine: 'ai_diffusion' | 'cinematic_motion';
  limit: number;
  durationSec: number;
  scenes: PlannerFilmScene[];
}

/** শর্টফিল্ম শট-সংখ্যা — Phase-4-এর সূত্র (≥৩, প্রতি দৃশ্যে ≥১) */
export function shortFilmShotCount(input: ShortFilmPlanInput): number {
  const segCap = input.engine === 'ai_diffusion' ? 10 : 7;
  const byDuration = Math.max(3, Math.min(input.limit, Math.ceil(input.durationSec / segCap)));
  return Math.max(byDuration, Math.min(input.scenes.length, input.limit));
}

/** দৃশ্যের সময় (দিন/রাত/সন্ধ্যা…) → নির্ধারক আলো-মুড (BN/EN উভয় মানই
 *  চেনে; চেনা-বহির্ভূত মানে নিরপেক্ষ ফলব্যাক)। ক্রম গুরুত্বপূর্ণ —
 *  রাত → ভোর → সন্ধ্যা → সকাল → দিন; প্রথম মিলই জেতে (নির্ধারক)। */
const TIME_OF_DAY_LIGHTING: { keywords: string[]; lighting: string }[] = [
  { keywords: ['night', 'midnight', 'রাত', 'মধ্যরাত', 'গভীর রাত'], lighting: 'cool low-light night atmosphere' },
  { keywords: ['dawn', 'sunrise', 'ভোর', 'ঊষা', 'প্রভাত'], lighting: 'soft first light of dawn' },
  { keywords: ['dusk', 'sunset', 'twilight', 'evening', 'সন্ধ্যা', 'গোধূলি', 'সাঁঝ'], lighting: 'warm golden dusk light' },
  { keywords: ['morning', 'সকাল'], lighting: 'fresh morning light' },
  { keywords: ['day', 'noon', 'midday', 'afternoon', 'দিন', 'দুপুর', 'বিকাল', 'মধ্যাহ্ন', 'অপরাহ্ন'], lighting: 'bright natural daylight' },
];
const NEUTRAL_LIGHTING = 'neutral cinematic lighting';

function timeOfDayLighting(timeOfDay: string): string {
  const v = (timeOfDay ?? '').toLowerCase();
  for (const entry of TIME_OF_DAY_LIGHTING) {
    if (entry.keywords.some(k => v.includes(k))) return entry.lighting;
  }
  return NEUTRAL_LIGHTING;
}

/**
 * D-F03 (planner-half): বাংলা উৎস-টেক্সটের বদলে নির্ধারক ইংরেজি
 * actionEn-ফলব্যাক (শর্টফিল্ম)। বিদ্যমান ইংরেজি ফলব্যাক-শব্দভাণ্ডারের
 * (fallbackActionEn) সাইজ/সাবজেক্ট-ভিত্তিক গঠন অনুসরণ করে — কিন্তু
 * "গান/শিল্পী"-বাচক শব্দ ছাড়া (শর্টফিল্ম-প্রসঙ্গে মিথ্যা নয়)।
 * নির্দিষ্ট অ্যাকশন-টেক্সট LLM ছাড়া অনুবাদযোগ্য নয় — সেই অর্থ-ক্ষয়
 * প্রতি দৃশ্যে একটি সৎ সমন্বয়-নোটে স্বীকৃত (নীচে)।
 */
function sfEnglishActionFallback(size: ShotSize, subject: ShotSubject, isFinalShot: boolean): string {
  if (isFinalShot) return 'Emotional closing shot as the story resolves';
  if (subject === 'environment' || size === 'establishing_wide') {
    return 'Cinematic establishing view of the scene location';
  }
  switch (size) {
    case 'wide':
      return 'The scene plays out in full view of the location';
    case 'over_the_shoulder':
      return 'The conversation plays out, seen past one character toward the other';
    case 'reaction':
      return 'A quiet reaction moment as the scene unfolds';
    case 'insert':
      return 'A telling visual detail of the moment';
    case 'close_up':
      return 'An intimate close view of the character in the scene';
    case 'extreme_close_up':
      return 'One meaningful detail filling the frame';
    case 'medium':
    default:
      return 'The scene plays out with the character in frame';
  }
}

/**
 * A2-F06 কঙ্কাল-বৈচিত্র্য-গার্ডের নির্ধারক মুভ-বিকল্প ম্যাপ (সম্পূর্ণ
 * PlanMovement-ইউনিয়ন প্যারামিটারে কাজ করে — ইনিশিয়াইজার-টার্নারির
 * ফ্লো-ন্যারোয়িং-এ পড়ে TS-ত্রুটি হয়, তাই আলাদা ফাংশন)।
 */
function skeletonMoveAlternative(m: PlanMovement): PlanMovement {
  if (m === 'pan_right') return 'pan_left';
  if (m === 'pan_left') return 'pan_right';
  if (m === 'zoom_out') return 'zoom_in';
  if (m === 'zoom_in') return 'static';
  return 'static';
}

/**
 * দৃশ্য-তালিকা → কভারেজ-শট (নির্ধারক)। Phase-4-এর দ্বিতীয় LLM কলের
 * (শট-বিভাজন) বদলে এই বিশুদ্ধ ফাংশন — এক LLM রাউন্ড-ট্রিপ সাশ্রয়।
 */
export function planShortFilmShots(input: ShortFilmPlanInput): CinematicPlan {
  const adjustments: PlanAdjustment[] = [];
  const sceneCount = Math.max(1, input.scenes.length);
  const total = shortFilmShotCount(input);

  // দৃশ্য-ওজন: আনুমানিক সময় + সংলাপ-ভার — বেশি ওজন = বেশি শট
  const weights = input.scenes.map(s => Math.max(2, s.estimatedSec) + s.dialogueCount * 1.5);
  const alloc = input.scenes.map(() => 1);
  let remaining = total - sceneCount;
  // বৃহত্তম-ভগ্নাংশ পদ্ধতি (নির্ধারক): ওজন-অনুপাতে বণ্টন
  const rawShare = weights.map(w => (w / weights.reduce((a, b) => a + b, 0)) * (total - sceneCount));
  const base = rawShare.map(s => Math.floor(s));
  for (let i = 0; i < sceneCount && remaining > 0; i++) {
    if (base[i] > 0) {
      const give = Math.min(base[i], remaining);
      alloc[i] += give;
      remaining -= give;
    }
  }
  // ভগ্নাংশ-ক্রমে বাকি বণ্টন (স্থির টাই-ব্রেক: সূচি)
  const fracOrder = rawShare
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of fracOrder) {
    if (remaining <= 0) break;
    alloc[i]++;
    remaining--;
  }
  // বাজেট-সীমা (§9-C): দৃশ্য-সংখ্যা মোট শট-বাজেটের বেশি হলে কভার কাটা
  // হয়। কাট-ক্রম (নির্ধারক): মাঝের দৃশ্যগুলি শেষ-দিক থেকে আগে —
  // এস্টাব্লিশিং (প্রথম দৃশ্য) ও সমাপনি-বিট (শেষ দৃশ্য) ধরে রাখা হয়
  // (আর্কের দুই প্রান্ত সবচেয়ে গুরুত্বপূর্ণ); চরম ক্ষেত্রে তবেই শেষ-দৃশ্য,
  // তারপর প্রথম-দৃশ্য কাটে। বাদ-পড়া দৃশ্য চিত্রনাট্য-artifact-এ থেকে
  // যায়, পাইপলাইন-নোটে সৎ-উল্লেখ পায়।
  let over = alloc.reduce((a, b) => a + b, 0) - total;
  if (over > 0) {
    const cutOrder: number[] = [];
    for (let i = sceneCount - 2; i >= 1; i--) cutOrder.push(i);
    if (sceneCount >= 2) cutOrder.push(sceneCount - 1);
    cutOrder.push(0);
    for (const i of cutOrder) {
      if (over <= 0) break;
      const take = Math.min(alloc[i], over);
      alloc[i] -= take;
      over -= take;
    }
  }

  const shots: CinematicShot[] = [];
  // শেষ কভার-প্রাপ্ত দৃশ্য — বাজেট-কাটে শেষ ইনপুট-দৃশ্য বাদ পড়লেও
  // সমাপনি-বিট পরিকল্পনার শেষ কভার-প্রাপ্ত দৃশ্যেই বসে (সৎ আর্ক)
  let lastCovered = -1;
  for (let i = sceneCount - 1; i >= 0; i--) {
    if (alloc[i] > 0) {
      lastCovered = i;
      break;
    }
  }
  const scenes: CinematicScene[] = input.scenes.map((s, si) => ({
    sceneId: `SC${si + 1}`,
    purpose:
      si === 0
        ? 'পরিচিতি ও ভৌগোলিক স্থাপন'
        : si === lastCovered
          ? 'সমাপনি'
          : s.dialogueCount > 0
            ? 'সংলাপ-কভারেজ'
            : 'অ্যাকশন-কভারেজ',
    narrativeBeat: s.action.slice(0, 120),
    environment: `${s.location}, ${s.timeOfDay}`.slice(0, 160),
    // A2-F05 সৎ-মার্কার: এই দৃশ্য-স্তরের মান সাধারণ প্ল্যানিং-প্লেসহোল্ডার —
    // প্রজন্ম-প্রভাবক পথ শট-স্তরের নির্ধারক lightingMood (নীচে প্রতি শটে)।
    lightingMood: 'scene-appropriate cinematic lighting',
    lightingProvenance: 'planning_only_generic',
    ...(si === lastCovered ? { transitionIntent: 'সমাপনি-বিট' } : {}),
  }));

  let prevMovement: PlanMovement | undefined;
  let globalPanIdx = 0;

  input.scenes.forEach((scene, si) => {
    const n = Math.max(0, alloc[si]);
    // বাজেট-কাটে পড়া দৃশ্য (alloc 0) — কোনো শট পায় না (সৎ: চিত্রনাট্য-
    // artifact-এ দৃশ্যটি থাকে, পাইপলাইন-নোট বাদ-পড়া জানায়)
    if (n <= 0) return;
    const isLastScene = si === lastCovered;
    const hasDialogue = scene.dialogueCount > 0;

    // D-F03 (planner-half) ভাষা-চুক্তি: প্রজন্ম-প্রম্পটে যাওয়া actionEn
    // অবশ্যই ইংরেজি-লিপি। উৎস-টেক্সট (visualEn, বা visualEn না থাকলে
    // location/timeOfDay/action-মিশ্রণ) বাংলা লিপি ধরলে (শেয়ার্ড
    // lang-guard — containsBengaliScript) সেটি প্রম্পটে যায় না: পরিবর্তে
    // সাইজ/সাবজেক্ট-ভিত্তিক নির্ধারক ইংরেজি ফলব্যাক-বাক্য
    // (sfEnglishActionFallback — বিদ্যমান ফলব্যাক-শব্দভাণ্ডার) + প্রতি
    // দৃশ্যে ঠিক একটি সৎ সমন্বয়-নোট। LLM কল নেই; অর্থ-ক্ষয় নোটে
    // স্বীকৃত। (রান-পথে পাইপলাইনের নিজস্ব বেল্ট-অ্যান্ড-ব্রেসেস যাচাই
    // সমান্তরালভাবে যোগ হচ্ছে — এটি পরিকল্পকের নিজের ফলব্যাক-পথ।)
    const visualEn = scene.visualEn && scene.visualEn.trim() ? scene.visualEn.trim() : '';
    const sourceEn = visualEn || `${scene.location}, ${scene.timeOfDay}. ${scene.action}`;
    const bengaliSource = containsBengaliScript(sourceEn);
    if (bengaliSource) {
      adjustments.push({
        field: `scene.SC${si + 1}.${visualEn ? 'visualEn' : 'action'}`,
        from: 'বাংলা লিপি',
        to: 'ইংরেজি ফলব্যাক',
        reason: 'উৎস-টেক্সট বাংলা — ইংরেজি ফলব্যাক বাক্য বসানো হলো (D-F03)',
      });
    }

    // D-F04: দৃশ্যের চরিত্র-নাম — খালি/অ-স্ট্রিং এন্ট্রি বাদ (পরিকল্পকের
    // নিজের আউটপুট যাচাইকারীর character-গার্ড সবসময় পাস করে)।
    const sceneChars = scene.characters.filter(
      (c): c is string => typeof c === 'string' && c.trim().length > 0
    );
    // দুই-চরিত্র কভারেজ-গ্যারান্টির অবস্থা-ট্র্যাকিং (এই দৃশ্যে কে ইতিমধ্যে
    // পোর্ট্রেট-কন্ডিশনড শট পেয়েছে)
    let seenCharA = false;
    let seenCharB = false;

    // স্লট-প্যাটার্ন (নির্ধারক)
    const sizes: ShotSize[] = [];
    const subjects: ShotSubject[] = [];
    for (let k = 0; k < n; k++) {
      const isSceneFirst = k === 0;
      const isSceneLast = k === n - 1;
      if (si === 0 && isSceneFirst && n >= 1 && input.scenes.length > 1) {
        sizes.push('establishing_wide');
        subjects.push('environment');
        continue;
      }
      if (hasDialogue) {
        if (k === 0) {
          sizes.push('medium');
          subjects.push('scene');
        } else if (k === 1) {
          sizes.push('over_the_shoulder');
          subjects.push('scene');
        } else if (k === 2 && scene.dialogueCount >= 2) {
          sizes.push('reaction');
          subjects.push('reaction');
        } else {
          sizes.push(k % 2 === 0 ? 'medium' : 'over_the_shoulder');
          subjects.push('scene');
        }
      } else {
        if (k === 0) {
          sizes.push('wide');
          subjects.push('scene');
        } else if (k === 1) {
          sizes.push('medium');
          subjects.push('scene');
        } else if (k === 2) {
          sizes.push('insert');
          subjects.push('detail');
        } else {
          sizes.push('medium');
          subjects.push('scene');
        }
      }
      // শেষ-দৃশ্যের শেষ স্লট = সমাপনি-বিট
      if (isLastScene && isSceneLast && k === n - 1 && sizes[sizes.length - 1] === 'insert') {
        sizes[sizes.length - 1] = 'medium';
        subjects[subjects.length - 1] = 'scene';
      }
    }

    // §9-C: প্রজন্ম-সক্ষমতার সীমা মেনে প্রতি-শট লক্ষ্য-দৈর্ঘ্য — AI-ইঞ্জিনে
    // ক্লিপ ৫/১০-সে.-গ্রিডে যায় (১০-সে.-এর বেশি জানালা ট্রিম করা যায় না);
    // cinematic_motion-এ লোকাল KenBurns দীর্ঘ চলে, যাচাইকারী-সীমা ২০ সে.
    const capPerShot = input.engine === 'ai_diffusion' ? 10 : 20;
    const perShot = round2(Math.min(capPerShot, Math.max(1.5, scene.estimatedSec / n)));
    for (let k = 0; k < n; k++) {
      const order = shots.length;
      const size = sizes[k];
      const subject = subjects[k];
      const isFinalShot = isLastScene && k === n - 1;

      let movement: PlanMovement;
      if (isFinalShot) movement = 'zoom_out';
      else if (size === 'establishing_wide') movement = 'zoom_in';
      else if (size === 'over_the_shoulder' || (hasDialogue && size === 'medium')) movement = 'static';
      else if (size === 'reaction' || size === 'insert' || size === 'close_up' || size === 'extreme_close_up')
        movement = 'zoom_in';
      else if (size === 'wide') movement = globalPanIdx++ % 2 === 0 ? 'pan_right' : 'pan_left';
      else movement = 'zoom_in';
      // §3 পুনরাবৃত্তি-নিয়ম: টানা একই নন-স্ট্যাটিক মুভ নয় (static
      // পুনরাবৃত্তি বৈধ)। বিকল্প-মানচিত্র নির্ধারক এবং সম্পূর্ণ —
      // বিশেষত zoom_out কখনো বিকল্প হিসেবে বসে না: সমাপনি-শটের স্থির
      // zoom_out-এর সাথে সন্নিহিত সংঘর্ষ এড়াতে (P5-4f-এর ২১৯-কম্বো
      // বাগ: আগের মানচিত্র zoom_out→zoom_out নো-অপ ছিল)।
      if (movement !== 'static' && movement === prevMovement) {
        movement =
          movement === 'pan_left'
            ? 'pan_right'
            : movement === 'pan_right'
              ? 'pan_left'
              : movement === 'zoom_out'
                ? 'zoom_in'
                : movement === 'zoom_in'
                  ? 'static'
                  : 'static';
      }
      prevMovement = movement;

      const cls = classifyMovement(movement, input.engine);
      if (cls.downgradeReason) {
        adjustments.push({
          field: `shot.${shotIdFor(order)}.movement`,
          from: movement,
          to: cls.fallbackMove,
          reason: cls.downgradeReason,
        });
      }

      // D-F04: চরিত্র-বণ্টন — এক শটে এক `character?` স্লট, কিন্তু
      // দুই-চরিত্র সংলাপ-দৃশ্যে দ্বিতীয় চরিত্র আর কখনো উপস্থাপিত হয় না
      // — এমন হতে দেওয়া যায় না। নিয়ম (নির্ধারক):
      //  - রিয়্যাকশন স্লট → characters[1] (দৃশ্যে ≥২ চরিত্র থাকলে; নইলে
      //    characters[0]) — "অন্য চরিত্রটি সাড়া দিচ্ছে" কভারেজ।
      //  - মিডিয়াম/OTS স্লট → বেস characters[0]; কিন্তু দুই-চরিত্রের
      //    সংলাপ-দৃশ্যে characters[0] ইতিমধ্যে বসে গেলে পরের স্লট
      //    characters[1]-কে দেওয়া হয় — ≥২ কন্ডিশনড স্লটের দৃশ্যে উভয়
      //    চরিত্রই নিশ্চিত কমপক্ষে একটি করে পোর্ট্রেট-কন্ডিশনড শট পায়।
      //  - অ্যাকশন-দৃশ্য অপরিবর্তিত: characters[0] (আগের আচরণ)।
      // সীমা (সৎ): দৃশ্য-১-এর এস্টাব্লিশিং স্লট environment-সাবজেক্ট —
      // কন্ডিশনড স্লট মাত্র একটি থাকলে (যেমন [এস্টাব্লিশিং, OTS]) এক
      // character-স্লটে দুই চরিত্র অসম্ভব; সেখানে characters[0] থাকে।
      let character: string | undefined;
      if (sceneChars.length > 0 && (subject === 'scene' || subject === 'reaction')) {
        if (subject === 'reaction') {
          character = sceneChars.length >= 2 ? sceneChars[1] : sceneChars[0];
        } else if (hasDialogue && sceneChars.length >= 2 && seenCharA && !seenCharB) {
          character = sceneChars[1];
        } else {
          character = sceneChars[0];
        }
        if (sceneChars.length >= 2 && character === sceneChars[1]) seenCharB = true;
        else seenCharA = true;
      }

      shots.push({
        shotId: shotIdFor(order),
        sceneId: `SC${si + 1}`,
        order,
        subject,
        size,
        angle: 'eye_level',
        movement,
        fallbackMove: cls.fallbackMove,
        delivery: cls.delivery,
        // D-F03: বাংলা উৎস-টেক্সট ধরা পড়লে ইংরেজি ফলব্যাক-বাক্য (উপরে
        // সৎ সমন্বয়-নোট); ইংরেজি উৎস আগের মতোই অপরিবর্তিত যায়।
        actionEn: (bengaliSource ? sfEnglishActionFallback(size, subject, isFinalShot) : sourceEn).slice(0, 900),
        // দৃশ্যের সময় থেকে নির্ধারক আলো-মুড — প্রম্পটে যায়
        lightingMood: timeOfDayLighting(scene.timeOfDay),
        labelBn: `দৃশ্য ${scene.index} — শট ${k + 1}`,
        targetDurationSec: perShot,
        ...(character ? { character } : {}),
        ...(isFinalShot ? { transitionIn: 'সমাপনি-বিট' } : {}),
      });
    }
  });

  return {
    version: SHOT_PLAN_VERSION,
    type: 'short_film',
    beatSource: 'narrative',
    totalPlannedSec: round2(shots.reduce((a, s) => a + s.targetDurationSec, 0)),
    scenes,
    shots,
    adjustments,
  };
}

// ------------------------------------------------------------
// শর্টফিল্ম প্রিভিউ-কঙ্কাল (নিশ্চিতকরণের আগে — চূড়ান্ত দৃশ্য নেই এখনো)
// ------------------------------------------------------------

export interface SkeletonScene {
  purposeBn: string;
  pattern: { size: ShotSize; subject: ShotSubject }[];
}

/** দৈর্ঘ্য থেকে দৃশ্য-সংখ্যা অনুমান (LLM প্রম্পটের ৩–৬ দৃশ্য-নিয়মের আদলে) */
export function skeletonSceneCount(durationSec: number): number {
  return Math.max(3, Math.min(6, Math.round(durationSec / 10)));
}

export function planShortFilmSkeleton(opts: {
  /** quality-ধাপ বাদ: শট-বাজেট `limit`-এই (maxShots) সাংকেতিক */
  engine: 'ai_diffusion' | 'cinematic_motion';
  limit: number;
  durationSec: number;
}): CinematicPlan {
  const sceneCount = skeletonSceneCount(opts.durationSec);
  const shotCount = Math.max(3, Math.min(opts.limit, Math.ceil(opts.durationSec / (opts.engine === 'ai_diffusion' ? 10 : 7))));
  // নির্ধারক কঙ্কাল-প্যাটার্ন: প্রতি দৃশ্যে ~২ শট পর্যন্ত, শেষে সমাপনি
  const shots: CinematicShot[] = [];
  const scenes: CinematicScene[] = [];
  const adjustments: PlanAdjustment[] = [];
  const perScene = Math.max(1, Math.floor(shotCount / sceneCount));
  // A2-F06: গার্ড অসম্ভব হলে ঠিক একটি সৎ-নোট (adjustments = কঙ্কালের
  // honest-notes চ্যানেল; প্রিভিউ-সারসংক্ষেপের limitations-এর পাশাপাশি)
  let diversityNoted = false;
  let order = 0;
  for (let si = 0; si < sceneCount; si++) {
    const isLast = si === sceneCount - 1;
    const isFirst = si === 0;
    scenes.push({
      sceneId: `SC${si + 1}`,
      purpose: isFirst ? 'পরিচিতি ও ভৌগোলিক স্থাপন' : isLast ? 'সমাপনি' : si % 2 === 1 ? 'সংলাপ/অ্যাকশন কভারেজ' : 'বিকাশ',
      narrativeBeat: '(চূড়ান্ত আখ্যান জেনারেশন-সময়ে চিত্রনাট্য থেকে তৈরি হবে)',
      environment: 'story location (runtime)',
      // A2-F05 সৎ-মার্কার (পূর্ণ পরিকল্পকের মতোই): দৃশ্য-স্তরের মান
      // সাধারণ প্ল্যানিং-প্লেসহোল্ডার — প্রজন্ম-পথ শট-স্তরের।
      lightingMood: 'scene-appropriate cinematic lighting',
      lightingProvenance: 'planning_only_generic',
    });
    // শেষ-দৃশ্যের জন্য অন্তত ১টি শট সংরক্ষিত — আগের দৃশ্যগুলি বাজেট
    // শেষ করে দিলেও সমাপনি-বিট-ওয়ালা শেষ শটটি কখনো হারায় না।
    const n = isLast
      ? Math.max(1, shotCount - order)
      : Math.min(perScene, Math.max(0, shotCount - order - 1));
    for (let k = 0; k < n && order < shotCount; k++) {
      let size: ShotSize = isFirst && k === 0 ? 'establishing_wide' : isLast && k === n - 1 ? 'medium' : k === 0 ? 'wide' : 'medium';
      const subject: ShotSubject = isFirst && k === 0 ? 'environment' : 'scene';
      let movement: PlanMovement = isFirst && k === 0 ? 'zoom_in' : isLast && k === n - 1 ? 'zoom_out' : k === 0 ? 'pan_right' : 'static';
      // A2-F06 বৈচিত্র্য-গার্ড (রান-পরিকল্পকের §3-নিয়মের আলো সংস্করণ —
      // কঙ্কাল রিভিউ-কেবল, প্রজন্ম-পথ নয়, কিন্তু প্রিভিউ রান-পরিকল্পকের
      // কখনো-উৎপাদন-করে-না এমন প্যাটার্ন দেখাত পারত না): সন্নিহিত
      // শট-জোড়ায় (ক) একই (সাইজ এবং মুভমেন্ট) নয়, (খ) টানা একই নন-
      // স্ট্যাটিক মুভ নয় (static পুনরাবৃত্তি বৈধ — তবে একই সাইজ+static
      // জোড়াও (ক)-এর অধীনে)। স্থির-আর্ক স্লট (প্রথম এস্টাব্লিশিং, শেষ
      // জুম-আউট) নিয়মের বাইরে — পূর্ণ পরিকল্পকের নকশার মতোই।
      // নির্ধারক বিকল্প-ক্রম: মুভ-ফ্লিপ → সাইজ-ফ্লিপ → উভয়। স্থির
      // বাজেটে কোনোটিই না চললে নির্ধারক মান বহাল + একটি সৎ-নোট।
      const prev = shots[shots.length - 1];
      const isFixedArcSlot = (isFirst && k === 0) || (isLast && k === n - 1);
      if (prev && !isFixedArcSlot) {
        const clash = (s: ShotSize, m: PlanMovement): boolean =>
          (m !== 'static' && m === prev.movement) || (s === prev.size && m === prev.movement);
        if (clash(size, movement)) {
          // TS ফ্লো-ন্যারোয়িং (ইনিশিয়াইজার-টার্নারি 'pan_left' বাদ দেয়) এড়াতে
          // পূর্ণ-ইউনিয়ন ম্যাপার-ফাংশন ব্যবহৃত।
          const mvAlt: PlanMovement = skeletonMoveAlternative(movement);
          const szAlt: ShotSize = size === 'wide' ? 'medium' : 'wide';
          if (!clash(size, mvAlt)) {
            movement = mvAlt;
          } else if (!clash(szAlt, movement)) {
            size = szAlt;
          } else if (!clash(szAlt, mvAlt)) {
            size = szAlt;
            movement = mvAlt;
          } else if (!diversityNoted) {
            adjustments.push({
              field: 'skeleton.diversity',
              from: `${prev.size}+${prev.movement}`,
              to: `${size}+${movement}`,
              reason:
                'কঙ্কালের স্থির স্লট-বাজেটে বৈচিত্র্য-নিয়ম (সন্নিহিত একই সাইজ+মুভমেন্ট নয়; টানা নন-স্ট্যাটিক মুভ নয়) রক্ষা করা গেল না — নির্ধারক আউটপুট বহাল (A2-F06)',
            });
            diversityNoted = true;
          }
        }
      }
      const cls = classifyMovement(movement, opts.engine);
      shots.push({
        shotId: shotIdFor(order),
        sceneId: `SC${si + 1}`,
        order,
        subject,
        size,
        angle: 'eye_level',
        movement,
        fallbackMove: cls.fallbackMove,
        delivery: cls.delivery,
        actionEn: fallbackActionEn(size, subject, false),
        labelBn: `${scenes[si].purpose} — শট ${k + 1}`,
        targetDurationSec: round2(opts.durationSec / shotCount),
      });
      order++;
    }
    if (isLast) break;
  }
  return {
    version: SHOT_PLAN_VERSION,
    type: 'short_film',
    beatSource: 'narrative',
    totalPlannedSec: round2(shots.reduce((a, s) => a + s.targetDurationSec, 0)),
    scenes,
    shots,
    adjustments,
  };
}

// ------------------------------------------------------------
// ওভাররাইড — সার্ভার-স্যানিটাইজড ব্যবহারকারী-নির্বাচন প্রয়োগ
// ------------------------------------------------------------

export interface SanitizedOverrides {
  overrides?: CinematicOverrides;
  /** বাদ পড়া এন্ট্রির সংখ্যা (সৎ-নোটের জন্য) */
  droppedCount: number;
}

/**
 * অবিশ্বস্ত ইনপুট থেকে বৈধ ওভাররাইড বাছাই (validateSpec ও প্ল্যানারের
 * ভেতরে উভয় জায়গায় ব্যবহৃত — ক্লায়েন্ট-দাবি কখনো আস্থাভাজন নয়)।
 */
export function sanitizeOverridesInput(raw: unknown, maxShotCount: number): SanitizedOverrides {
  if (!raw || typeof raw !== 'object') return { droppedCount: 0 };
  const shotsRaw = (raw as { shots?: unknown }).shots;
  if (!Array.isArray(shotsRaw)) return { droppedCount: 0 };
  const seen = new Map<number, { index: number; size?: ShotSize; movement?: PlanMovement }>();
  let dropped = 0;
  for (const entry of shotsRaw.slice(0, 64)) {
    if (!entry || typeof entry !== 'object') {
      dropped++;
      continue;
    }
    const e = entry as { index?: unknown; size?: unknown; movement?: unknown };
    const index = Number(e.index);
    if (!Number.isInteger(index) || index < 0 || index >= maxShotCount) {
      dropped++;
      continue;
    }
    const size = typeof e.size === 'string' && isShotSize(e.size) ? e.size : undefined;
    const movement =
      typeof e.movement === 'string' && isPlanMovement(e.movement) ? (e.movement as PlanMovement) : undefined;
    if (!size && !movement) {
      dropped++;
      continue;
    }
    const prev = seen.get(index);
    seen.set(index, {
      index,
      ...(size ? { size } : prev?.size ? { size: prev.size } : {}),
      ...(movement ? { movement } : prev?.movement ? { movement: prev.movement } : {}),
    });
  }
  // A2-F03: ৬৪-এন্ট্রি ক্যাপের বাইরের এন্ট্রিও বাদই পড়ে — সেগুলোর
  // হিসাব droppedCount-এ থাকতেই হবে (আগে নীরবে উধাও হতো, সৎ-নোটের
  // ভিত্তিই ছিল না — বৈধ-এন্ট্রির নীরব-ড্রপ REG-14l-শ্রেণির)। বাস্তব
  // UI-প্রবাহ কখনো ৬৪ ছুঁয়ে না (প্রতি শটে ≤১, maxShots ≤ ১৬)।
  if (shotsRaw.length > 64) {
    dropped += shotsRaw.length - 64;
  }
  if (seen.size === 0) return { droppedCount: dropped };
  return { overrides: { shots: [...seen.values()] }, droppedCount: dropped };
}

function isShotSize(v: string): v is ShotSize {
  return [
    'establishing_wide', 'wide', 'medium', 'close_up', 'extreme_close_up',
    'over_the_shoulder', 'insert', 'reaction',
  ].includes(v);
}

function isPlanMovement(v: string): v is PlanMovement {
  return ['static', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'dolly_tracking', 'handheld', 'orbit'].includes(v);
}

/**
 * স্যানিটাইজড ওভাররাইড পরিকল্পনায় প্রয়োগ — প্রতিটি প্রয়োগ সমন্বয়-
 * নোটসহ; মুভমেন্ট বদলালে ক্যাপাবিলিটি-রায় নতুন করে মূল্যায়ন হয়।
 */
export function applyOverrides(
  plan: CinematicPlan,
  overrides: CinematicOverrides | undefined,
  engine: 'ai_diffusion' | 'cinematic_motion'
): CinematicPlan {
  if (!overrides?.shots?.length) return plan;
  for (const o of overrides.shots) {
    const shot = plan.shots[o.index];
    if (!shot) {
      // সীমার-বাইরের সূচি নীরবে নয় — সৎ-নোটসহ বাদ (যেমন: পরিকল্পনায় ৫টি
      // শট কিন্তু ওভাররাইড-সূচি ৯ — ব্যবহারকারী জানবেন সম্পাদনা প্রযোজ্য হয়নি)
      plan.adjustments.push({
        field: `shot-override[${o.index}]`,
        from: `${o.size ?? ''}${o.movement ?? ''}`.trim() || '—',
        to: 'বাদ',
        reason: `ওভাররাইড-সূচি পরিকল্পনার শট-সীমার (${plan.shots.length}টি) বাইরে — প্রযোজ্য হয়নি`,
      });
      continue;
    }
    if (o.size && o.size !== shot.size) {
      plan.adjustments.push({
        field: `shot.${shot.shotId}.size`,
        from: shot.size,
        to: o.size,
        reason: 'ব্যবহারকারীর নির্বাচন (নিশ্চিতকরণ-পূর্ব সম্পাদনা)',
      });
      shot.size = o.size;
    }
    if (o.movement && o.movement !== shot.movement) {
      const cls = classifyMovement(o.movement, engine);
      plan.adjustments.push({
        field: `shot.${shot.shotId}.movement`,
        from: shot.movement,
        to: o.movement,
        reason: 'ব্যবহারকারীর নির্বাচন (নিশ্চিতকরণ-পূর্ব সম্পাদনা)',
      });
      shot.movement = o.movement;
      shot.fallbackMove = cls.fallbackMove;
      shot.delivery = cls.delivery;
      if (cls.downgradeReason) {
        plan.adjustments.push({
          field: `shot.${shot.shotId}.movement`,
          from: o.movement,
          to: cls.fallbackMove,
          reason: cls.downgradeReason,
        });
      }
    }
  }
  return plan;
}

// ------------------------------------------------------------
// সারসংক্ষেপ — গণনা/এনাম-কেবল (UI/রিপোর্ট/মেট্রিকস)
// ------------------------------------------------------------

export function summarizePlan(plan: CinematicPlan, engine: 'ai_diffusion' | 'cinematic_motion'): CinematicPlanSummary {
  const deliveryCounts: Record<string, number> = { local_motion: 0, prompt_guided: 0, downgraded_to_local: 0 };
  for (const s of plan.shots) deliveryCounts[s.delivery] = (deliveryCounts[s.delivery] ?? 0) + 1;
  const limitations: string[] = [];
  if (engine === 'ai_diffusion') {
    limitations.push('ক্যামেরা-মুভমেন্ট প্রম্পট-নির্দেশিত — CogVideoX-3-এ নেটিভ ক্যামেরা-প্যারামিটার নেই; নিশ্চয়তা নয়।');
  } else {
    limitations.push('cinematic_motion ইঞ্জিনে ৫টি মুভ প্রকৃত লোকাল ক্যামেরা-মোশন; ডলি/হ্যান্ডহেল্ড/অরবিট নিকটতম বিকল্পে নামে।');
  }
  limitations.push('শট-ফ্রেমিং ও অ্যাঙ্গেল প্রম্পট-নির্দেশিত — ফলাফলের নিশ্চিত রূপ নয়।');
  limitations.push('লিপ-সিঙ্ক নেই — গায়কের মুখ নড়াচড়া বা গাওয়ার দাবি করা হয় না।');
  return {
    version: plan.version,
    type: plan.type,
    shotCount: plan.shots.length,
    totalPlannedSec: plan.totalPlannedSec,
    beatSource: plan.beatSource,
    deliveryCounts: deliveryCounts as CinematicPlanSummary['deliveryCounts'],
    limitations,
  };
}
