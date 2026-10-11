// ============================================================
// Capability Registry (মাস্টার প্ল্যান §১৫ validation logic)
// CreativeJobSpec-কে বাস্তব পাইপলাইন-সক্ষমতার বিপরীতে যাচাই:
// - অসমর্থিত অপশন → ব্যাখ্যা + বিকল্প
// - সমর্থিত মানে normalize (aspect→মাপ, resolution→পিক্সেল)
// - duration/fps/quality সীমা → সমন্বয় notes-সহ
// ============================================================

import type {
  AspectRatio,
  CreativeJobSpec,
  OutputResolution,
  ProductionType,
  SpecAdjustment,
  ValidatedSpec,
} from '@/lib/types';
import type { ImageSize } from './sdk-helpers';

// ------------------------------------------------------------
// মাপ-মানচিত্র: aspect → জেনারেশন সাইজ ও আউটপুট পিক্সেল
// ------------------------------------------------------------

/** aspect ratio → SDK ছবি-জেনারেশন সাইজ */
export const ASPECT_TO_GEN_SIZE: Record<AspectRatio, ImageSize> = {
  '1:1': '1024x1024',
  '4:5': '864x1152',
  '3:2': '1344x768',
  '16:9': '1344x768',
  '9:16': '768x1344',
};

/** (aspect, resolution) → চূড়ান্ত আউটপুট পিক্সেল */
export function outputDims(aspect: AspectRatio, resolution: OutputResolution): { w: number; h: number } {
  const short = resolution === '1080p' ? 1080 : 720;
  switch (aspect) {
    case '1:1':
      return { w: short, h: short };
    case '4:5':
      return { w: short, h: Math.round((short * 5) / 4 / 2) * 2 };
    case '3:2':
      return { w: Math.round((short * 3) / 2 / 2) * 2, h: short };
    case '16:9':
      return { w: Math.round((short * 16) / 9 / 2) * 2, h: short };
    case '9:16':
      return { w: short, h: Math.round((short * 16) / 9 / 2) * 2 };
  }
}

/** quality → অভ্যন্তরীণ রেন্ডার-রেজোলিউশন ফ্যাক্টর (draft দ্রুত, high পূর্ণ) */
export function qualityScale(quality: CreativeJobSpec['quality']): number {
  switch (quality) {
    case 'draft':
      return 0.667; // ≈ 720p-এ 540p — দ্রুত প্রিভিউ
    case 'standard':
      return 1;
    case 'high':
      return 1;
  }
}

// ------------------------------------------------------------
// সীমা (§১৪ সেটিংস ক্যাটালগ + বাস্তব পাইপলাইন সীমা)
// ------------------------------------------------------------

export interface DurationLimit {
  min: number;
  max: number;
  def: number;
}

export const DURATION_LIMITS: Record<ProductionType, DurationLimit> = {
  image: { min: 0, max: 0, def: 0 },
  audio: { min: 5, max: 300, def: 60 },
  motion_video: { min: 5, max: 20, def: 10 },
  music_video: { min: 15, max: 180, def: 60 },
  short_film: { min: 30, max: 120, def: 60 },
};

export const SUPPORTED_FPS = [24, 25, 30] as const;
export const SUPPORTED_RESOLUTIONS: OutputResolution[] = ['720p', '1080p'];
export const SUPPORTED_ASPECTS: AspectRatio[] = ['1:1', '4:5', '3:2', '16:9', '9:16'];

/** প্রতি প্রোডাকশনে সর্বোচ্চ শট-সংখ্যা (খরচ নিয়ন্ত্রণ) */
export function maxShots(type: ProductionType, quality: CreativeJobSpec['quality']): number {
  const base: Record<ProductionType, number> = {
    image: 1,
    audio: 0,
    motion_video: 4,
    music_video: quality === 'draft' ? 8 : 14,
    short_film: quality === 'draft' ? 8 : 16,
  };
  return base[type];
}

/** শট-প্রতি সময়ের নির্দেশনা (গল্পের আবেগও বিবেচনা করে LLM এর মধ্যে রাখবে) */
export const SHOT_DURATION_HINT: Record<ProductionType, { min: number; max: number }> = {
  image: { min: 0, max: 0 },
  audio: { min: 0, max: 0 },
  motion_video: { min: 3, max: 6 },
  music_video: { min: 2.5, max: 6 },
  short_film: { min: 3, max: 7 },
};

// ------------------------------------------------------------
// পাইপলাইন ধাপ-প্রিভিউ (§৬ ওয়ার্কফ্লো ম্যাপিং)
// ------------------------------------------------------------

export function plannedStepsFor(type: ProductionType): { key: string; title: string }[] {
  switch (type) {
    case 'image':
      return [
        { key: 'prepare', title: 'উৎস প্রস্তুত ও নির্দেশনা বিশ্লেষণ' },
        { key: 'generate', title: 'ছবি তৈরি/সম্পাদনা' },
        { key: 'overlay', title: 'টাইপোগ্রাফি ও ফিনিশিং' },
        { key: 'validate', title: 'গুণমান যাচাই ও রপ্তানি' },
      ];
    case 'audio':
      return [
        { key: 'prepare', title: 'স্ক্রিপ্ট প্রস্তুত' },
        { key: 'synthesize', title: 'কণ্ঠ সংশ্লেষণ' },
        { key: 'master', title: 'মাস্টারিং ও নরমালাইজেশন' },
        { key: 'validate', title: 'গুণমান যাচাই ও রপ্তানি' },
      ];
    case 'motion_video':
      return [
        { key: 'plan', title: 'দৃশ্য-পরিকল্পনা' },
        { key: 'storyboard', title: 'স্টোরিবোর্ড ফ্রেম তৈরি' },
        { key: 'motion', title: 'ক্যামেরা-মোশন ক্লিপ তৈরি' },
        { key: 'assemble', title: 'টাইমলাইন অ্যাসেম্বলি ও সাউন্ড' },
        { key: 'validate', title: 'চূড়ান্ত রেন্ডার ও যাচাই' },
      ];
    case 'music_video':
      return [
        { key: 'analyze_song', title: 'গান বিশ্লেষণ (দৈর্ঘ্য/মুড)' },
        { key: 'brief', title: 'সৃজনশীল ব্রিফ ও শট-তালিকা' },
        { key: 'characters', title: 'চরিত্র রেফারেন্স' },
        { key: 'storyboard', title: 'স্টোরিবোর্ড ফ্রেম তৈরি' },
        { key: 'motion', title: 'মোশন ক্লিপ তৈরি' },
        { key: 'assemble', title: 'গানের সাথে টাইমলাইন সাজানো' },
        { key: 'validate', title: 'চূড়ান্ত রেন্ডার ও যাচাই' },
      ];
    case 'short_film':
      return [
        { key: 'script_writer', title: 'চিত্রনাট্য রচনা' },
        { key: 'scene_breakdown', title: 'দৃশ্য ও শট বিভাজন' },
        { key: 'character_bible', title: 'চরিত্র বাইবেল ও পোর্ট্রেট' },
        { key: 'storyboard', title: 'স্টোরিবোর্ড তৈরি' },
        { key: 'speech', title: 'সংলাপ/ভয়েসওভার তৈরি' },
        { key: 'motion', title: 'শট-প্রতি মোশন ক্লিপ' },
        { key: 'continuity', title: 'ধারাবাহিকতা পরীক্ষা' },
        { key: 'assemble', title: 'টাইমলাইন অ্যাসেম্বলি ও সাউন্ড ডিজাইন' },
        { key: 'validate', title: 'চূড়ান্ত রেন্ডার ও যাচাই' },
      ];
  }
}

// ------------------------------------------------------------
// যাচাই — §১৫: collect → validate → adjust → explain
// ------------------------------------------------------------

export interface SpecValidationResult {
  ok: boolean;
  validated?: ValidatedSpec;
  errors: string[]; // ব্যবহারকারী/LLM-কে দেখানোর মতো ব্যাখ্যা
  alternatives?: string[]; // অসমর্থিত অপশনের বিকল্প
}

const TYPE_LABELS: Record<ProductionType, string> = {
  image: 'ছবি',
  audio: 'অডিও',
  motion_video: 'মোশন ভিডিও',
  music_video: 'মিউজিক ভিডিও',
  short_film: 'শর্টফিল্ম',
};

export function validateSpec(raw: unknown): SpecValidationResult {
  const errors: string[] = [];
  const alternatives: string[] = [];
  const adjustments: SpecAdjustment[] = [];
  const notes: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['spec অবজেক্ট প্রয়োজন'] };
  }
  const input = raw as Record<string, unknown>;
  const type = String(input.type ?? '') as ProductionType;
  if (!TYPE_LABELS[type]) {
    return {
      ok: false,
      errors: [`অজানা কাজের ধরন: "${type}"`],
      alternatives: ['image', 'audio', 'motion_video', 'music_video', 'short_film'],
    };
  }

  const spec: CreativeJobSpec = {
    type,
    title: String(input.title ?? '').slice(0, 120) || `${TYPE_LABELS[type]} প্রোডাকশন`,
    quality: (['draft', 'standard', 'high'] as const).includes(input.quality as any)
      ? (input.quality as CreativeJobSpec['quality'])
      : 'standard',
  };
  if (input.quality && !['draft', 'standard', 'high'].includes(String(input.quality))) {
    adjustments.push({ field: 'quality', from: String(input.quality), to: 'standard', reason: 'অজানা মান — ডিফল্ট' });
  }

  // --- সাধারণ স্ট্রিং ফিল্ড ---
  const strFields = [
    'instructions',
    'sourceArtifactId',
    'overlayText',
    'text',
    'idea',
    'story',
    'songArtifactId',
    'sourceImageArtifactId',
    'style',
  ] as const;
  for (const f of strFields) {
    if (typeof input[f] === 'string' && (input[f] as string).trim()) {
      (spec as any)[f] = (input[f] as string).trim();
    }
  }
  if (Array.isArray(input.sourceAudioArtifactIds)) {
    spec.sourceAudioArtifactIds = (input.sourceAudioArtifactIds as unknown[])
      .filter((x): x is string => typeof x === 'string')
      .slice(0, 4);
  }

  // --- aspect ---
  if (input.aspect != null) {
    const aspect = String(input.aspect);
    if (SUPPORTED_ASPECTS.includes(aspect as AspectRatio)) {
      spec.aspect = aspect as AspectRatio;
    } else {
      const nearest: AspectRatio = aspect === '2:1' || aspect === '21:9' ? '16:9' : aspect === '5:4' ? '4:5' : '16:9';
      spec.aspect = nearest;
      adjustments.push({
        field: 'aspect',
        from: aspect,
        to: nearest,
        reason: 'এই অনুপাত পাইপলাইনে সমর্থিত নয় — নিকটতম বিকল্প',
      });
      alternatives.push(`সমর্থিত অনুপাত: ${SUPPORTED_ASPECTS.join(', ')}`);
    }
  }

  // --- format ---
  if (input.format != null) {
    const format = String(input.format);
    if (['png', 'jpeg', 'webp'].includes(format)) {
      spec.format = format as CreativeJobSpec['format'];
    } else {
      spec.format = 'png';
      adjustments.push({ field: 'format', from: format, to: 'png', reason: 'অজানা ফরম্যাট' });
      alternatives.push('ফরম্যাট: png, jpeg, webp');
    }
  }

  // --- fps ---
  if (input.fps != null) {
    const fps = Number(input.fps);
    if (SUPPORTED_FPS.includes(fps as any)) {
      spec.fps = fps as 24 | 25 | 30;
    } else {
      const alt = fps > 30 ? 30 : fps >= 26 ? 30 : 24;
      spec.fps = alt as 24 | 25 | 30;
      adjustments.push({
        field: 'fps',
        from: String(input.fps),
        to: String(alt),
        reason: 'এই ফ্রেম-রেট এখন সমর্থিত নয় (৬০FPS পাইপলাইনে নেই)',
      });
      alternatives.push('FPS: 24 (সিনেম্যাটিক), 25, 30 (সোশ্যাল)');
    }
  }

  // --- sound ---
  if (input.sound != null) {
    const sound = String(input.sound);
    if (['none', 'ambient', 'narration', 'uploaded_song'].includes(sound)) {
      spec.sound = sound as CreativeJobSpec['sound'];
    } else {
      spec.sound = 'none';
      adjustments.push({ field: 'sound', from: sound, to: 'none', reason: 'অজানা সাউন্ড মোড' });
    }
  }

  // --- flags/enums ---
  if (typeof input.subtitles === 'boolean') spec.subtitles = input.subtitles;
  if (typeof input.voice === 'string' && ['tongtong', 'jam', 'kazi'].includes(input.voice)) {
    spec.voice = input.voice as CreativeJobSpec['voice'];
  }
  if (typeof input.audioOperation === 'string' && ['voiceover', 'music_plan', 'process'].includes(input.audioOperation)) {
    spec.audioOperation = input.audioOperation as CreativeJobSpec['audioOperation'];
  }
  if (typeof input.cameraMove === 'string' && ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'].includes(input.cameraMove)) {
    spec.cameraMove = input.cameraMove as CreativeJobSpec['cameraMove'];
  }

  // --- resolution ---
  let resolution: OutputResolution = '720p';
  if (input.resolution != null) {
    const res = String(input.resolution);
    if (res === '720p' || res === '1080p') {
      resolution = res;
    } else if (/4k|2160/i.test(res)) {
      resolution = '1080p';
      adjustments.push({
        field: 'resolution',
        from: res,
        to: '1080p',
        reason: '৪K এই পাইপলাইনে সমর্থিত নয় — সর্বোচ্চ 1080p',
      });
      alternatives.push('রেজোলিউশন: 720p (দ্রুত) বা 1080p (উচ্চ মান)');
    } else if (res === '540p' || res === 'draft') {
      resolution = '720p';
    } else {
      adjustments.push({ field: 'resolution', from: res, to: '720p', reason: 'অজানা মান — ডিফল্ট' });
    }
  }

  // --- duration ---
  const limits = DURATION_LIMITS[type];
  if (limits.max > 0) {
    let duration = Number(input.durationSec ?? limits.def) || limits.def;
    if (duration !== Math.round(duration)) duration = Math.round(duration);
    if (duration < limits.min || duration > limits.max) {
      const clamped = Math.min(Math.max(duration, limits.min), limits.max);
      adjustments.push({
        field: 'durationSec',
        from: `${duration}s`,
        to: `${clamped}s`,
        reason: `${TYPE_LABELS[type]} পাইপলাইনে সমর্থিত সীমা ${limits.min}–${limits.max} সেকেন্ড`,
      });
      alternatives.push(`দৈর্ঘ্য: ${limits.min}–${limits.max} সেকেন্ড`);
      duration = clamped;
    }
    spec.durationSec = duration;
  }

  // --- প্রকারভেদে বাধ্যতামূলক ফিল্ড ---
  if (type === 'motion_video' || type === 'music_video' || type === 'short_film') {
    if (!spec.aspect) spec.aspect = type === 'short_film' ? '16:9' : '9:16';
    if (!spec.fps) spec.fps = type === 'short_film' ? 24 : 30;
    if (!spec.sound) spec.sound = type === 'music_video' ? 'uploaded_song' : type === 'short_film' ? 'narration' : 'none';
  }
  if (type === 'image' && !spec.aspect) spec.aspect = '1:1';
  if (type === 'audio' && !spec.audioOperation) spec.audioOperation = 'voiceover';

  // মিউজিক ভিডিও নীতি: গান আবশ্যক (সংগীত-সংশ্লেষণ মডেল লাইসেন্স-গেটেড)
  if (type === 'music_video' && !spec.songArtifactId) {
    if (spec.sound === 'uploaded_song') {
      spec.sound = 'none';
      notes.push('আপলোড করা গান পাওয়া যায়নি — ভিডিওটি নীরব থাকবে; চাইলে গানের অডিও আপলোড করে আবার চালাও।');
    }
  }

  // সততার নোট (§৬ — অতিরঞ্জিত প্রতিশ্রুতি নয়)
  if (type === 'motion_video' || type === 'music_video' || type === 'short_film') {
    notes.push('ভিডিও তৈরি হয় AI স্টোরিবোর্ড + সিনেম্যাটিক ক্যামেরা-মোশন পাইপলাইনে (ডিফিউশন ভিডিও-মডেল নয়)।');
  }
  if (spec.quality === 'high' && (type === 'music_video' || type === 'short_film')) {
    notes.push("'high' মানে বেশি সময় লাগবে — দ্রুত দেখতে চাইলে 'draft' ব্যবহার করো।");
  }

  if (errors.length > 0) return { ok: false, errors, alternatives };

  return {
    ok: true,
    validated: {
      spec,
      adjustments,
      notes,
      plannedSteps: plannedStepsFor(type),
    },
    errors: [],
    alternatives: alternatives.length > 0 ? alternatives : undefined,
  };
}

/** প্রকারভেদে মানব-পাঠযোগ্য সারাংশ (নিশ্চিতকরণ কার্ডে দেখানোর জন্য) */
export function summarizeSpec(spec: CreativeJobSpec): string {
  const bits: string[] = [TYPE_LABELS[spec.type]];
  bits.push(`মান: ${spec.quality}`);
  if (spec.aspect) bits.push(`অনুপাত: ${spec.aspect}`);
  if (spec.durationSec) bits.push(`দৈর্ঘ্য: ${spec.durationSec}s`);
  if (spec.fps) bits.push(`FPS: ${spec.fps}`);
  if (spec.sound && spec.sound !== 'none') bits.push(`শব্দ: ${spec.sound}`);
  if (spec.voice) bits.push(`কণ্ঠ: ${spec.voice}`);
  if (spec.subtitles) bits.push('সাবটাইটেল: হ্যাঁ');
  return bits.join(' · ');
}
