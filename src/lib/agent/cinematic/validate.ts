// ============================================================
// Shot-plan runtime validation — Phase 5।
//
// পরিকল্পনা আর্টিফ্যাক্ট/এনালাইসিস থেকে ফিরে-পড়ার সময়ের কঠোর
// আকৃতি-যাচাই (artifact re-read, টেস্ট, ভবিষ্যৎ ভোক্তা)। ক্লায়েন্ট-
// সরবরাহি পরিকল্পনা কখনো আস্থাভাজন নয় — এটি কেবল সার্ভারের নিজের
// পরিকল্পনা পুনঃপাঠের জাদির।
// ============================================================

import type { CinematicPlan } from './types';
import { SHOT_PLAN_VERSION } from './types';
import { CAMERA_ANGLES, PLAN_BEAT_SOURCES, PLAN_MOVEMENTS, SHOT_SIZES, SHOT_SUBJECTS } from './types';

export interface PlanValidationResult {
  ok: boolean;
  plan?: CinematicPlan;
  errors: string[];
}

/**
 * অজানা ইনপুট → যাচাইকৃত পরিকল্পনা। ব্যর্থ হলে কারণ-তালিকা
 * (ব্যবহারকারী/ডিবাগ-পাঠযোগ্য)। যাচাই: সংস্করণ, ধরন, বিট-উৎস-এনাম,
 * এনাম, ক্রমের ধারাবাহিকতা, আইডির স্বতন্ত্রতা, দৃশ্য-রেফারেন্স,
 * দৈর্ঘ্যের সীমা, মোট-দৈর্ঘ্যের উপস্থিতি/সামঞ্জস্য, সমন্বয়-নোটের গঠন।
 */
export function parseAndValidateShotPlan(input: unknown): PlanValidationResult {
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['শট-পরিকল্পনা অবজেক্ট প্রয়োজন'] };
  }
  const p = input as Record<string, unknown>;

  if (p.version !== SHOT_PLAN_VERSION) {
    errors.push(`অসমর্থিত পরিকল্পনা-সংস্করণ: ${String(p.version)} (প্রত্যাশিত ${SHOT_PLAN_VERSION})`);
  }
  if (p.type !== 'music_video' && p.type !== 'short_film') {
    errors.push(`অজানা পরিকল্পনার ধরন: ${String(p.type)}`);
  }
  if (!(PLAN_BEAT_SOURCES as readonly string[]).includes(String(p.beatSource))) {
    errors.push(`পরিকল্পনার beatSource অবৈধ: ${String(p.beatSource)}`);
  }

  const scenes = p.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    errors.push('দৃশ্য-তালিকা খালি বা অনুপস্থিত');
  }
  const sceneIds = new Set<string>();
  if (Array.isArray(scenes)) {
    scenes.forEach((s, i) => {
      const sid = String((s as { sceneId?: unknown })?.sceneId ?? '');
      if (!sid) errors.push(`দৃশ্য ${i + 1}-এর sceneId নেই`);
      else if (sceneIds.has(sid)) errors.push(`দৃশ্য-আইডি সদৃশ: ${sid}`);
      else sceneIds.add(sid);
    });
  }

  const shots = p.shots;
  if (!Array.isArray(shots) || shots.length === 0) {
    errors.push('শট-তালিকা খালি বা অনুপস্থিত');
    return { ok: false, errors };
  }
  if (shots.length > 24) errors.push(`শট-সংখ্যা সীমার বাইরে (${shots.length})`);

  const shotIds = new Set<string>();
  let total = 0;
  shots.forEach((s, i) => {
    const shot = s as Record<string, unknown>;
    const sid = String(shot?.shotId ?? '');
    if (!sid) errors.push(`শট ${i + 1}-এর shotId নেই`);
    else if (shotIds.has(sid)) errors.push(`শট-আইডি সদৃশ: ${sid}`);
    else shotIds.add(sid);
    if (shot?.order !== i) errors.push(`শট ${sid || i + 1}-এর order অনুক্রমহীন (${String(shot?.order)} ≠ ${i})`);
    if (!sceneIds.has(String(shot?.sceneId ?? ''))) {
      errors.push(`শট ${sid || i + 1} অজানা দৃশ্য নির্দেশ করে: ${String(shot?.sceneId)}`);
    }
    if (!(SHOT_SIZES as readonly string[]).includes(String(shot?.size))) {
      errors.push(`শট ${sid || i + 1}-এর size অবৈধ: ${String(shot?.size)}`);
    }
    if (!(CAMERA_ANGLES as readonly string[]).includes(String(shot?.angle))) {
      errors.push(`শট ${sid || i + 1}-এর angle অবৈধ: ${String(shot?.angle)}`);
    }
    if (!(PLAN_MOVEMENTS as readonly string[]).includes(String(shot?.movement))) {
      errors.push(`শট ${sid || i + 1}-এর movement অবৈধ: ${String(shot?.movement)}`);
    }
    if (!(SHOT_SUBJECTS as readonly string[]).includes(String(shot?.subject))) {
      errors.push(`শট ${sid || i + 1}-এর subject অবৈধ: ${String(shot?.subject)}`);
    }
    if (!['local_motion', 'prompt_guided', 'downgraded_to_local'].includes(String(shot?.delivery))) {
      errors.push(`শট ${sid || i + 1}-এর delivery অবৈধ: ${String(shot?.delivery)}`);
    }
    if (!['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'].includes(String(shot?.fallbackMove))) {
      errors.push(`শট ${sid || i + 1}-এর fallbackMove অবৈধ: ${String(shot?.fallbackMove)}`);
    }
    // D-F04 গার্ড: character উপস্থিত থাকলে অ-খালি স্ট্রিং হতেই হবে
    // (null বৈধ — MV-পথের "চরিত্র নেই" স্পষ্ট মান; খালি/অ-স্ট্রিং বাদ)।
    // পরিকল্পকের বসানো মান (scene.characters-এর নাম) কখনো খালি নয় —
    // নোংরা আর্টিফ্যাকট-পুনঃপাঠ/ওভাররাইড পথ ধরতে।
    if (shot?.character !== undefined && shot?.character !== null) {
      if (typeof shot.character !== 'string' || !shot.character.trim()) {
        errors.push(`শট ${sid || i + 1}-এর character অবৈধ: অ-খালি স্ট্রিং দরকার (নাল বৈধ)`);
      }
    }
    const dur = Number(shot?.targetDurationSec);
    // উচ্চ-সীমা ১৮০ সে.: targetDurationSec হলো টাইমলাইন-ট্রিম-লক্ষ্য (রান-
    // ডোমেইনের সর্বোচ্চ জানালা — নীরব মিউজিক-ভিডিওর ১৮০-সে. ক্ল্যাম্প),
    // প্রোভাইডার-ক্লিপের ৫/১০-সে. গ্রিড নয় (ওটি aiClipDurationSec সামলায়)।
    if (!Number.isFinite(dur) || dur < 0.5 || dur > 180) {
      errors.push(`শট ${sid || i + 1}-এর targetDurationSec সীমার বাইরে: ${String(shot?.targetDurationSec)}`);
    } else {
      total += dur;
    }
    if (typeof shot?.actionEn !== 'string' || !shot.actionEn.trim()) {
      errors.push(`শট ${sid || i + 1}-এর actionEn নেই`);
    }
  });

  // মোট-দৈর্ঘ্য: উপস্থিত ও সসীম হতেই হবে (অনুপস্থিত/NaN আগে নীরবে
  // পাস হয়ে যেত — P5-5a গার্ড), তারপর শট-দৈর্ঘ্যের যোগফলের সাথে মিল।
  const declaredTotal = Number(p.totalPlannedSec);
  if (!Number.isFinite(declaredTotal)) {
    errors.push(`totalPlannedSec অনুপস্থিত বা অ-সসীম: ${String(p.totalPlannedSec)}`);
  } else if (Number.isFinite(total) && Math.abs(declaredTotal - total) > 0.05 + total * 0.01) {
    errors.push(`totalPlannedSec (${declaredTotal}) শট-দৈর্ঘ্যের যোগফলের (${Math.round(total * 100) / 100}) সাথে মেলে না`);
  }

  // সমন্বয়-নোটের গঠন (থাকলে): অ্যারে; প্রতিটি এন্ট্রিতে অ-খালি স্ট্রিং
  // field ও reason; from/to ঐচ্ছিক স্ট্রিং।
  if (p.adjustments !== undefined) {
    if (!Array.isArray(p.adjustments)) {
      errors.push('adjustments অ্যারে হওয়া দরকার');
    } else {
      (p.adjustments as unknown[]).forEach((a, i) => {
        const adj = a as Record<string, unknown> | null;
        if (!adj || typeof adj !== 'object') {
          errors.push(`সমন্বয় ${i + 1}-টি অবজেক্ট নয়`);
          return;
        }
        if (typeof adj.field !== 'string' || !adj.field.trim()) {
          errors.push(`সমন্বয় ${i + 1}-এর field নেই/খালি (অ-খালি স্ট্রিং দরকার)`);
        }
        if (typeof adj.reason !== 'string' || !adj.reason.trim()) {
          errors.push(`সমন্বয় ${i + 1}-এর reason নেই/খালি (অ-খালি স্ট্রিং দরকার)`);
        }
        if (adj.from !== undefined && typeof adj.from !== 'string') {
          errors.push(`সমন্বয় ${i + 1}-এর from স্ট্রিং হওয়া দরকার`);
        }
        if (adj.to !== undefined && typeof adj.to !== 'string') {
          errors.push(`সমন্বয় ${i + 1}-এর to স্ট্রিং হওয়া দরকার`);
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan: p as unknown as CinematicPlan, errors: [] };
}
