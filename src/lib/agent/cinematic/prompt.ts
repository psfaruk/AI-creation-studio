// ============================================================
// Cinematic prompt builders — Phase 5।
//
// পরিকল্পনার প্রতিটি জেনারেশন-প্রভাবক ক্ষেত্র (action, framing,
// composition, angle, movement, lighting) ঠিক এখান দিয়ে প্রকৃত
// প্রোভাইডার/ইমেজ প্রম্পটে ঢোকে — পরিকল্পনা কখনো UI-কেবল বস্তু নয়।
//
// সততা: মুভমেন্ট-বাক্য নির্দেশনা, নিশ্চয়তা নয় (CogVideoX-3-এ নেটিভ
// ক্যামেরা-প্যারামিটার নেই)। প্রম্পট সীমা: প্রোভাইডার ২০০০-এ কাটে।
// ============================================================

import type { CinematicShot } from './types';
import { anglePhrase, movementPhrase, sizeFramingPhrase } from './capability_map';
import { CINEMATIC_SUFFIX } from '../film-helpers';

/**
 * শট → CogVideoX-3 মোশন-প্রম্পট। গঠন (বাউন্ডেড, স্লাইস-নিরাপদ):
 * action · framing · composition · angle · movement · lighting ·
 * স্থির-সাফিক্স · style · extra
 */
export function buildCinematicVideoPrompt(shot: CinematicShot, style?: string, extra?: string): string {
  const parts: string[] = [
    (shot.actionEn ?? '').toString().trim().slice(0, 800),
    sizeFramingPhrase(shot.size),
  ];
  if (shot.compositionEn) parts.push(shot.compositionEn.toString().trim().slice(0, 200));
  const angle = anglePhrase(shot.angle);
  if (angle) parts.push(angle);
  parts.push(movementPhrase(shot.movement));
  if (shot.lightingMood) parts.push(shot.lightingMood.toString().trim().slice(0, 120));
  parts.push('realistic motion, cinematic, natural lighting, high quality, no text overlay');
  if (style) parts.push(style.toString().trim().slice(0, 150));
  if (extra) parts.push(extra.toString().trim().slice(0, 300));
  return parts.filter(Boolean).join(', ');
}

/**
 * শট → স্টোরিবোর্ড/ফলব্যাক-ফ্রেমের ইমেজ-প্রম্পট (framing/composition/
 * angle ইমেজ-জেনকেও নির্দেশনা দেয়)। imagePromptForShot-এর সিনেম্যাটিক
 * সম্প্রসারণ — অ-সিনেম্যাটিক পথ আগের মতোই imagePromptForShot ব্যবহার করে।
 */
export function buildCinematicImagePrompt(shot: CinematicShot, style?: string): string {
  const parts: string[] = [
    (shot.actionEn ?? '').toString().trim().slice(0, 900),
    sizeFramingPhrase(shot.size),
  ];
  if (shot.compositionEn) parts.push(shot.compositionEn.toString().trim().slice(0, 200));
  const angle = anglePhrase(shot.angle);
  if (angle) parts.push(angle);
  if (shot.lightingMood) parts.push(shot.lightingMood.toString().trim().slice(0, 120));
  if (style) parts.push(style.toString().trim().slice(0, 200));
  return `${parts.filter(Boolean).join(', ')}${CINEMATIC_SUFFIX}`;
}
