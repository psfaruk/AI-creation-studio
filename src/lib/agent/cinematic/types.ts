// ============================================================
// Cinematic shot-plan contract — Phase 5 (Cinematic Director)।
//
// টাইপড, সংস্করণ-যুক্ত, যাচাইকৃত শট-পরিকল্পনার একক চুক্তি।
// নীতি:
//  - প্রতিটি ক্ষেত্র হয় (ক) জেনারেশন-প্রভাবক — প্রম্পট/প্রোভাইডার-
//    অনুরোধে পৌঁছায় (prompt.ts-এর মাধ্যমে), নয় (খ) স্পষ্টভাবে
//    পরিকল্পনা-কেবল — labelBn/continuityNote/transitionIn-এর মতো।
//  - ক্যামেরা-ভাষা সৎ: প্রোভাইডারের (CogVideoX-3) কোনো নেটিভ
//    ক্যামেরা-প্যারামিটার নেই — সব মুভমেন্ট/অ্যাঙ্গেল প্রম্পট-নির্দেশিত;
//    কেবল KenBurns-এর ৫টি মুভ লোকাল-মোশন হিসেবে বাস্তব।
//  - বিশুদ্ধ মডিউল: DB/SDK/LLM নেই — নির্ধারক, পরীক্ষাযোগ্য।
// ============================================================

import type { CameraMove } from '@/lib/types';

/** শট-প্ল্যান চুক্তির সংস্করণ — গঠন বদলালে বাড়াও */
export const SHOT_PLAN_VERSION = 1;

// ------------------------------------------------------------
// এনাম — ক্যামেরা-শব্দভাণ্ডার (সব প্রম্পট-নির্দেশিত, যতটা প্রযোজ্য)
// ------------------------------------------------------------

/** শট-সাইজ / ফ্রেমিং — সব প্রজন্ম-পথে প্রম্পট-নির্দেশিত */
export type ShotSize =
  | 'establishing_wide'
  | 'wide'
  | 'medium'
  | 'close_up'
  | 'extreme_close_up'
  | 'over_the_shoulder'
  | 'insert'
  | 'reaction';

/** ক্যামেরা-অ্যাঙ্গেল — সব পথে প্রম্পট-নির্দেশিত (eye_level বাদ দিলে ওঠেই না) */
export type CameraAngle = 'eye_level' | 'high_angle' | 'low_angle' | 'overhead';

/**
 * পরিকল্পিত ক্যামেরা-মুভমেন্ট।
 *  - প্রথম ৫টি: KenBurns-বাস্তবায়নযোগ্য (লোকাল-মোশন) + প্রম্পট-নির্দেশনা।
 *  - শেষ ৩টি: শুধু প্রম্পট-নির্দেশিত — cinematic_motion-এ সৎ-ডাউনগ্রেড।
 */
export type PlanMovement =
  | 'static'
  | 'zoom_in'
  | 'zoom_out'
  | 'pan_left'
  | 'pan_right'
  | 'dolly_tracking'
  | 'handheld'
  | 'orbit';

/** শটের দৃশ্য-বিষয় — আর্ক/কভারেজ নিয়মের ভিত্তি */
export type ShotSubject = 'environment' | 'artist_performance' | 'scene' | 'detail' | 'reaction';

/** মুভমেন্ট-ডেলিভারির সৎ রায় (capability_map থেকে আসে) */
export type MovementDelivery = 'local_motion' | 'prompt_guided' | 'downgraded_to_local';

/** কাট-টাইমিং-এর সৎ উৎস-লেবেল */
export type PlanBeatSource =
  | 'measured' // আপলোড গানের প্রকৃত বিট-বিশ্লেষণ (ffmpeg)
  | 'bpm_grid_estimate' // প্রসিডিউরাল গানের BPM-গ্রিড অনুমান (প্রিভিউ-কেবল)
  | 'duration_fallback' // বিট-ডেটা নেই — সমান-বিভাজন
  | 'silent' // musicSource: none — নীরব টাইমলাইন
  | 'narrative'; // শর্টফিল্ম — দৃশ্য/সংলাপ-চালিত (বিট প্রযোজ্য নয়)

export const SHOT_SIZES: readonly ShotSize[] = [
  'establishing_wide',
  'wide',
  'medium',
  'close_up',
  'extreme_close_up',
  'over_the_shoulder',
  'insert',
  'reaction',
] as const;

export const CAMERA_ANGLES: readonly CameraAngle[] = ['eye_level', 'high_angle', 'low_angle', 'overhead'] as const;

/** শটের দৃশ্য-বিষয়-এনাম (যাচাইকারীর গার্ড-সেট) */
export const SHOT_SUBJECTS: readonly ShotSubject[] = [
  'environment',
  'artist_performance',
  'scene',
  'detail',
  'reaction',
] as const;

export const PLAN_MOVEMENTS: readonly PlanMovement[] = [
  'static',
  'zoom_in',
  'zoom_out',
  'pan_left',
  'pan_right',
  'dolly_tracking',
  'handheld',
  'orbit',
] as const;

/** KenBurns-বাস্তায়নযোগ্য (লোকাল-মোশন) মুভমেন্ট */
export const LOCAL_MOVEMENTS: readonly PlanMovement[] = [
  'static',
  'zoom_in',
  'zoom_out',
  'pan_left',
  'pan_right',
] as const;

/** কাট-টাইমিং-উৎস-এনাম (যাচাইকারীর গার্ড-সেট) */
export const PLAN_BEAT_SOURCES: readonly PlanBeatSource[] = [
  'measured',
  'bpm_grid_estimate',
  'duration_fallback',
  'silent',
  'narrative',
] as const;

// ------------------------------------------------------------
// পরিকল্পনার গঠন
// ------------------------------------------------------------

export interface CinematicScene {
  /** স্থিতিশীল দৃশ্য-আইডি: SC1, SC2… */
  sceneId: string;
  /** দৃশ্যের উদ্দেশ্য (বাংলা, UI) */
  purpose: string;
  /** আখ্যান-বিট (বাংলা, পরিকল্পনা-কেবল) */
  narrativeBeat: string;
  /** পরিবেশ/লোকেশন (ইংরেজি — পরিকল্পনা-কেবল দৃশ্য-বিবরণী; আর্টিফ্যাকট/UI-প্রোভেনেন্স।
   *  শট-প্রম্পট কখনো এটি পড়ে না — প্রম্পটে যায় শটের নিজের ক্ষেত্রগুলো (actionEn/
   *  size/movement/lightingMood)। */
  environment: string;
  /** আলো/মুড (ইংরেজি — পরিকল্পনা-কেবল দৃশ্য-বিবরণী; আর্টিফ্যাকট/UI-প্রোভেনেন্স) */
  lightingMood: string;
  /**
   * A2-F05 সৎ-মার্কার: দৃশ্য-স্তরের lightingMood যখন সাধারণ প্ল্যানিং-
   * প্লেসহোল্ডার ('scene-appropriate cinematic lighting') — প্রকৃত
   * আলো-নির্বাচন নয়। প্রজন্ম-প্রভাবক পথ শট-স্তরের নির্ধারক lightingMood
   * (পরিকল্পকের TIME_OF_DAY_LIGHTING → prompt.ts)। ঐচ্ছিক — পুরনো
   * পরিকল্পনা/ভোক্তাদের জন্য অনুপস্থিত থাকলে অ-চিহ্নিত ধরা হয়।
   */
  lightingProvenance?: 'planning_only_generic';
  /** পরবর্তী রূপান্তর-ইচ্ছা (পরিকল্পনা-কেবল) */
  transitionIntent?: string;
}

export interface CinematicShot {
  /** স্থিতিশীল শট-আইডি: S01, S02… */
  shotId: string;
  sceneId: string;
  /** 0-ভিত্তিক ক্রম — অ্যারে-ক্রমেরই প্রতিফলন */
  order: number;
  subject: ShotSubject;
  size: ShotSize;
  angle: CameraAngle;
  movement: PlanMovement;
  /** নির্ধারক KenBurns-মুভ (লোকাল-পথ + AI-ফলব্যাক ফ্রেমের জন্য) */
  fallbackMove: CameraMove;
  /** মুভমেন্ট-ডেলিভারির সৎ রায় (ইঞ্জিন-সচেতন) */
  delivery: MovementDelivery;
  /** দৃশ্যমান অ্যাকশন (ইংরেজি — জেনারেশন-প্রভাবক) */
  actionEn: string;
  /** কম্পোজিশন/সাবজেক্ট-বসানো (ইংরেজি — জেনারেশন-প্রভাবক যখন থাকে)।
   *  নির্ধারক পরিকল্পকরা এটি বসায় না — ফ্রেমিং-বাক্য (sizeFramingPhrase)
   *  কম্পোজিশনই বহন করে; ক্ষেত্রটি ভবিষ্যৎ LLM/ওভাররাইড-চ্যানেল হিসেবে
   *  রয়ে গেছে (prompt.ts এটি থাকলেই প্রম্পটে যোগ করে)। */
  compositionEn?: string;
  /** আলো/মুড (ইংরেজি — জেনারেশন-প্রভাবক) */
  lightingMood?: string;
  /** মানব-পাঠযোগ্য বাংলা লেবেল (পরিকল্পনা-কেবল) */
  labelBn: string;
  /** মিউজিক ভিডিও: বিট-কাট সীমা (টাইমলাইন ট্রিম-লক্ষ্য) */
  startSec?: number;
  endSec?: number;
  /** লক্ষ্য-দৈর্ঘ্য (AI-পথে ক্লিপ ৫/১০-গ্রিডে যায়, তারপর ট্রিম) */
  targetDurationSec: number;
  /** চরিত্র-রেফারেন্স (শিল্পী/চরিত্রের নাম) থাকলে */
  character?: string | null;
  /** ধারাবাহিকতা-নোট (পরিকল্পনা-কেবল) */
  continuityNote?: string;
  /** রূপান্তর-ইচ্ছা (পরিকল্পনা-কেবল) */
  transitionIn?: string;
}

export interface PlanAdjustment {
  field: string;
  from: string;
  to: string;
  reason: string;
}

export interface CinematicPlan {
  version: typeof SHOT_PLAN_VERSION;
  type: 'music_video' | 'short_film';
  beatSource: PlanBeatSource;
  totalPlannedSec: number;
  visualStyle?: string;
  scenes: CinematicScene[];
  shots: CinematicShot[];
  adjustments: PlanAdjustment[];
}

/** পরিকল্পনার সারসংক্ষেপ — UI/রিপোর্ট/মেট্রিকসের জন্য (গণনা/এনাম-কেবল) */
export interface CinematicPlanSummary {
  version: number;
  type: 'music_video' | 'short_film';
  shotCount: number;
  totalPlannedSec: number;
  beatSource: PlanBeatSource;
  deliveryCounts: Record<MovementDelivery, number>;
  /** সৎ-সীমা নোট (বাংলা) — কার্ড/রিপোর্টে যায় */
  limitations: string[];
}

// ------------------------------------------------------------
// ব্যবহারকারীর শট-স্তরের ওভাররাইড (spec-এ চড়ে confirm §15 পার করে)
// ------------------------------------------------------------

export interface CinematicShotOverride {
  /** 0-ভিত্তিক শট-সূচি */
  index: number;
  size?: ShotSize;
  movement?: PlanMovement;
}

export interface CinematicOverrides {
  shots: CinematicShotOverride[];
}

// ------------------------------------------------------------
// বাংলা লেবেল-ম্যাপ (UI-প্রদর্শন)
// ------------------------------------------------------------

export const SHOT_SIZE_LABELS_BN: Record<ShotSize, string> = {
  establishing_wide: 'এস্টাব্লিশিং ওয়াইড',
  wide: 'ওয়াইড',
  medium: 'মিডিয়াম',
  close_up: 'ক্লোজ-আপ',
  extreme_close_up: 'এক্সট্রিম ক্লোজ-আপ',
  over_the_shoulder: 'ওভার-দ্য-শোল্ডার',
  insert: 'ইনসার্ট (ডিটেইল)',
  reaction: 'রিঅ্যাকশন',
};

export const PLAN_MOVEMENT_LABELS_BN: Record<PlanMovement, string> = {
  static: 'স্থির ক্যামেরা',
  zoom_in: 'ধীর জুম-ইন',
  zoom_out: 'ধীর জুম-আউট',
  pan_left: 'প্যান বাঁয়ে',
  pan_right: 'প্যান ডানে',
  dolly_tracking: 'ডলি-ট্র্যাকিং',
  handheld: 'হ্যান্ডহেল্ড',
  orbit: 'অরবিট',
};

export const MOVEMENT_DELIVERY_LABELS_BN: Record<MovementDelivery, string> = {
  local_motion: 'লোকাল ক্যামেরা-মোশন (নিশ্চিত)',
  prompt_guided: 'প্রম্পট-নির্দেশিত (নিশ্চয়তা নয়)',
  // P5-5a কপি-ঐক্য: কার্ডের সব রেন্ডার-সাইটের সাথে একই ক্যানোনিক্যাল বাক্য
  // (P5-5b ঐক্য-করা; "সৎ" শব্দটি বাক্যের ভেতরেই — আলাদা সাফিক্স নয়)
  downgraded_to_local: 'সৎ-বিকল্পে নামানো',
};

export const BEAT_SOURCE_LABELS_BN: Record<PlanBeatSource, string> = {
  measured: 'প্রকৃত বিট-বিশ্লেষণ (মাপা)',
  bpm_grid_estimate: 'BPM-গ্রিড অনুমান (মাপা নয়)',
  duration_fallback: 'বিট-ডেটা নেই — সমান-বিভাজন',
  silent: 'নীরব টাইমলাইন',
  narrative: 'দৃশ্য/সংলাপ-চালিত (বিট প্রযোজ্য নয়)',
};

/** শট-আইডি গঠনকারী (S01…; ৯৯টির বেশি হয় না — maxShots-সীমিত) */
export function shotIdFor(order: number): string {
  return `S${String(order + 1).padStart(2, '0')}`;
}
