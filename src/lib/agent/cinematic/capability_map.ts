// ============================================================
// Camera-language capability map — Phase 5।
//
// একক সত্যের উৎস: প্রোভাইডার-চুক্তি (ai_video.ts-এর প্রোব-যাচাইকৃত
// অনুরোধ-বডি) + KenBurns-এর লোকাল মুভ-সেট। CogVideoX-3-এর কোনো
// নেটিভ ক্যামেরা-প্যারামিটার নেই — তাই:
//  - ai_diffusion: সব ক্যামেরা-ভাষা প্রম্পট-নির্দেশিত (সৎ লেবেল)।
//  - cinematic_motion: ৫টি মুভ প্রকৃত লোকাল-মোশন; বাকিগুলো
//    অসমর্থিত → নির্ধারক সৎ-ডাউনগ্রেড + সমন্বয়-নোট।
// ============================================================

import type { CameraMove, VideoEngine } from '@/lib/types';
import type { CameraAngle, MovementDelivery, PlanMovement, ShotSize } from './types';
import { LOCAL_MOVEMENTS } from './types';

/** প্রম্পট-কেবল মুভমেন্টের নির্ধারক লোকাল-বিকল্প (KenBurns-বাস্তবায়নযোগ্য) */
const DOWNGRADE_MOVE: Record<Exclude<PlanMovement, (typeof LOCAL_MOVEMENTS)[number]>, CameraMove> = {
  dolly_tracking: 'zoom_in',
  handheld: 'static',
  orbit: 'pan_right',
};

/** মুভমেন্ট → লোকাল KenBurns-মুভ (লোকাল ৫টির জন্য অভিন্ন মান) */
export function fallbackMoveFor(movement: PlanMovement): CameraMove {
  if ((LOCAL_MOVEMENTS as readonly string[]).includes(movement)) return movement as CameraMove;
  return DOWNGRADE_MOVE[movement as Exclude<PlanMovement, (typeof LOCAL_MOVEMENTS)[number]>];
}

export interface MovementClassification {
  delivery: MovementDelivery;
  fallbackMove: CameraMove;
  /** ডাউনগ্রেড হলে সৎ কারণ (সমন্বয়-নোটে যায়) */
  downgradeReason?: string;
}

/**
 * একটি পরিকল্পিত মুভমেন্টের ইঞ্জিন-সচেতন সৎ রায়।
 *  - cinematic_motion + লোকাল-মুভ → 'local_motion' (KenBurns প্রকৃতভাবে চালায়)।
 *  - ai_diffusion (যেকোনো মুভ) → 'prompt_guided' — প্রোভাইডারে ক্যামেরা-
 *    প্যারামিটার নেই; প্রম্পটে স্পষ্ট নির্দেশনা যায়, ফলাফলের নিশ্চয়তা নয়।
 *  - cinematic_motion + প্রম্পট-কেবল মুভ → 'downgraded_to_local' + কারণ।
 */
export function classifyMovement(movement: PlanMovement, engine: VideoEngine | 'ai_diffusion'): MovementClassification {
  const fallbackMove = fallbackMoveFor(movement);
  if (engine === 'cinematic_motion') {
    if ((LOCAL_MOVEMENTS as readonly string[]).includes(movement)) {
      return { delivery: 'local_motion', fallbackMove };
    }
    return {
      delivery: 'downgraded_to_local',
      fallbackMove,
      downgradeReason: `cinematic_motion ইঞ্জিনে "${movement}" প্রকৃতভাবে বাস্তায়নযোগ্য নয় — নিকটতম লোকাল ক্যামেরা-মোশন "${fallbackMove}" ব্যবহৃত`,
    };
  }
  // ai_diffusion — CogVideoX-3: কোনো নেটিভ ক্যামেরা-প্যারামিটার নেই
  return { delivery: 'prompt_guided', fallbackMove };
}

// ------------------------------------------------------------
// প্রম্পট-বাক্য — সব প্রজন্ম-প্রভাবক ক্ষেত্র এখান থেকে প্রম্পটে যায়
// ------------------------------------------------------------

/**
 * শট-সাইজ → ফ্রেমিং-বাক্য (ভিডিও ও ইমেজ-প্রম্পট দুটোতেই যায়)।
 *
 * D-F04: OTS/রিঅ্যাকশন সাইজে `character` দিলে (শটের নিজের ক্ষেত্র —
 * নির্ধারক) বাক্যটি সেই চরিত্রকেই নাম করে ("looking past X…" / "reaction
 * shot of X…") — দুই-চরিত্র সংলাপ-কভারেজে কে সামনে/কে সাড়া দিচ্ছে তা
 * প্রম্পটে স্পষ্ট হয়। চরিত্র না থাকলে (undefined/null/খালি) আগের
 * সাধারণ বাক্যই — এক-আর্গুমেন্ট কলের (t17/t19-লক) আউটপুট অপরিবর্তিত।
 * বাকি সাইজগুলোতে character উপস্থিত থাকলেও বাক্য সাধারণই থাকে (আই-
 * কন্ডিশনিং image_url-ই চরিত্র-ভিত্তিক)।
 */
export function sizeFramingPhrase(size: ShotSize, character?: string | null): string {
  const who = typeof character === 'string' ? character.trim().slice(0, 60) : '';
  if (who) {
    if (size === 'over_the_shoulder') {
      return `over-the-shoulder shot, looking past ${who} toward the scene`;
    }
    if (size === 'reaction') {
      return `reaction shot of ${who}, emotional response in focus`;
    }
  }
  switch (size) {
    case 'establishing_wide':
      return 'sweeping establishing wide shot, full environment visible';
    case 'wide':
      return 'wide shot, environment and scale with the subject clearly visible';
    case 'medium':
      return 'medium shot, subject framed from the waist up';
    case 'close_up':
      return 'intimate close-up shot, expressive face detail';
    case 'extreme_close_up':
      return 'extreme close-up, one meaningful detail filling the frame';
    case 'over_the_shoulder':
      return 'over-the-shoulder shot, looking past a subject toward the scene';
    case 'insert':
      return 'insert shot, a significant detail isolated in the frame';
    case 'reaction':
      return 'reaction shot, the subject emotional response in focus';
  }
}

/** অ্যাঙ্গেল → বাক্য (eye_level নীরব — স্বাভাবিক ডিফল্ট) */
export function anglePhrase(angle: CameraAngle): string {
  switch (angle) {
    case 'eye_level':
      return '';
    case 'high_angle':
      return 'high-angle camera looking down';
    case 'low_angle':
      return 'low-angle camera looking up';
    case 'overhead':
      return 'overhead top-down camera angle';
  }
}

/** মুভমেন্ট → প্রম্পট-নির্দেশনা-বাক্য (নেটিভ প্যারামিটার নয় — নির্দেশনা) */
export function movementPhrase(movement: PlanMovement): string {
  switch (movement) {
    case 'static':
      // সত্যিকারের স্থির ক্যামেরা — আগের "subtle handheld feel" বাক্যটি
      // নিজেই স্ব-বিরোধী ছিল (স্থির + হ্যান্ডহেল্ড একসাথে নয়)
      return 'steady static camera, locked framing';
    case 'zoom_in':
      return 'slow camera push in';
    case 'zoom_out':
      return 'slow camera pull back';
    case 'pan_left':
      return 'smooth pan to the left';
    case 'pan_right':
      return 'smooth pan to the right';
    case 'dolly_tracking':
      return 'smooth dolly tracking shot following the subject';
    case 'handheld':
      return 'subtle handheld camera movement';
    case 'orbit':
      return 'gentle orbiting camera movement around the subject';
  }
}
