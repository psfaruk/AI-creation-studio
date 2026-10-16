// ============================================================
// Config-panel schema builder — Phase-4 Workstream C+D।
//
// চ্যাট-নেটিভ কনফিগারেশন প্যানেলের সার্ভার-মালিকানাধীন চুক্তি:
// কোন ধরনে কোন ক্ষেত্র, কোন অপশন, কোন সীমা, কোনটি নিষ্ক্রিয় ও কেন।
//
// নীতি:
//  - একক সত্যের উৎস: সব অপশন/সীমা capabilities.ts-এর ধ্রুবক থেকেই
//    আসে — আলাদা হার্ডকোডেড ক্ষমতা-তালিকা নয় (drift অসম্ভব)।
//  - সৎ-নিষ্ক্রিয়করণ: অসমর্থিত অপশন (60fps, 4K) তালিকায় থাকে কিন্তু
//    disabled + কারণসহ — নীরব প্রতিশ্রুতি নয়।
//  - বিশুদ্ধ মডিউল: DB/SDK নেই — কথোপকথনের গান-তালিকা (sourceOptions)
//    রাউট-হ্যান্ডলার আলাদাভাবে যোগ করে (ক্লায়েন্ট টাইপ-ইমপোর্ট নিরাপদ)।
//  - প্যানেল চুক্তি ≠ যাচাই: চূড়ান্ত রায় সবসময় validateSpec + confirm-এর
//    সার্ভার-পুনঃযাচাই — ক্লায়েন্ট কখনো ক্ষমতা-দাবি করতে পারে না।
// ============================================================

import {
  DURATION_LIMITS,
  SUPPORTED_ASPECTS,
  SUPPORTED_FPS,
  SUPPORTED_LANGUAGES,
  SUPPORTED_MOODS,
  maxShots,
  plannedStepsFor,
} from './capabilities';
import type {
  AspectRatio,
  CreativeJobSpec,
  MusicMood,
  ProductionType,
  SpeechLanguage,
  VideoEngine,
} from '@/lib/types';

// ------------------------------------------------------------
// প্যানেল-চুক্তির টাইপ (ক্লায়েন্ট import type দিয়ে নিরাপদে নেয়)
// ------------------------------------------------------------

export type ConfigFieldKind =
  | 'select'
  | 'number'
  | 'text'
  | 'textarea'
  | 'toggle'
  | 'song-select';

export interface ConfigFieldOption {
  value: string;
  labelBn: string;
  /** নিষ্ক্রিয় অপশন — কারণসহ দেখানো হয় (সৎ-সীমা প্রদর্শন) */
  disabled?: boolean;
  disabledReasonBn?: string;
}

export interface ConfigField {
  /** CreativeJobSpec-এর ক্ষেত্র-নাম (server-side চুক্তির ভিত্তি) */
  key: string;
  labelBn: string;
  kind: ConfigFieldKind;
  /** ফর্মের ক্রম — category-specific: প্রতিটি ধরনে সব-কিছু নয়, যা লাগে তাই */
  required: boolean;
  /** বর্তমান/ডিফল্ট মান (spec থেকে পূর্ব-মার্জ করা) */
  value?: unknown;
  defaultValue?: unknown;
  options?: ConfigFieldOption[];
  /** number-ক্ষেত্রের সীমা (DURATION_LIMITS থেকে) */
  min?: number;
  max?: number;
  /** ক্ষমতা-সীমার সৎ ব্যাখ্যা (ক্ষেত্রের নিচে দেখানো) */
  hintBn?: string;
  /** উন্নত-সেকশনে ভাঁজ করা (কম-ব্যবহৃত) */
  advanced?: boolean;
}

export interface ConfigPanelSongOption {
  id: string;
  fileName: string;
}

export interface ConfigPanelSchema {
  type: ProductionType;
  titleBn: string;
  /** প্রকারভেদে সৎ-সীমা নোট (প্যানেলের শীর্ষে/নিচে দেখানো) */
  limitations: string[];
  fields: ConfigField[];
  /** পরিকল্পনা-প্রিভিউ: পাইপলাইনের বাস্তব ধাপ-তালিকা (plannedStepsFor) */
  plannedSteps: { key: string; title: string }[];
  /** আনুমানিক শট-সংখ্যা (engine+quality-সচেতন — সময়-প্রত্যাশার সৎ ভিত্তি) */
  estimatedShots: { min: number; max: number; engine: VideoEngine | null };
  /** মিউজিক ভিডিও: কথোপকথনের আপলোড-করা অডিও (রাউট থেকে যোগ) */
  sourceOptions?: { songs: ConfigPanelSongOption[] };
}

// ------------------------------------------------------------
// শেয়ার্ড লেবেল-ম্যাপ (production-card-এর সাথে সামঞ্জস্যপূর্ণ পাঠ)
// ------------------------------------------------------------

const LANGUAGE_LABELS: Record<SpeechLanguage, string> = { bn: 'বাংলা', en: 'ইংরেজি' };
const ASPECT_LABELS: Record<AspectRatio, string> = {
  '9:16': '৯:১৬ — ভার্টিকাল (Shorts/Reels)',
  '16:9': '১৬:৯ — ল্যান্ডস্কেপ (YouTube)',
  '1:1': '১:১ — স্কয়ার',
  '4:5': '৪:৫ — পোর্ট্রেট',
  '3:2': '৩:২ — ক্লাসিক',
};
const MOOD_LABELS: Record<MusicMood, string> = {
  sad: 'বিষণ্ণ',
  romantic: 'রোমান্টিক',
  joyful: 'আনন্দময়',
  suspense: 'রহস্যময়',
  action: 'অ্যাকশন',
  peaceful: 'শান্ত',
};
const ENGINE_LABELS: Record<VideoEngine, string> = {
  ai_diffusion: 'প্রকৃত AI ভিডিও (CogVideoX-3) — ধীর, রিয়েলিস্টিক',
  cinematic_motion: 'স্টোরিবোর্ড+ক্যামেরা-মোশন — দ্রুত (ডিফিউশন নয়)',
};
const FILM_MODE_LABELS: Record<string, string> = {
  short_film: 'শর্টফিল্ম',
  dialogue_scene: 'সংলাপ-দৃশ্য',
  trailer: 'ট্রেইলার',
  story: 'গল্প',
};

/** ভিডিও-ধরনের FPS অপশন — সমর্থিত তিনটি + সৎ-নিষ্ক্রিয় ৬০ */
function fpsOptions(): ConfigFieldOption[] {
  return [
    ...SUPPORTED_FPS.map(f => ({
      value: String(f),
      labelBn: `${f === 24 ? '২৪ — সিনেম্যাটিক' : f === 25 ? '২৫ — পাল' : '৩০ — সোশ্যাল'}`,
    })),
    {
      value: '60',
      labelBn: '৬০ — অসমর্থিত',
      disabled: true,
      disabledReasonBn: '৬০FPS পাইপলাইনে নেই — রেন্ডার ২৪/২৫/৩০-তেই হয়',
    },
  ];
}

/** রেজোলিউশন অপশন — ৭২০p/১০৮০p সমর্থিত + সৎ-নিষ্ক্রিয় 4K */
function resolutionOptions(): ConfigFieldOption[] {
  return [
    { value: '720p', labelBn: '৭২০p — দ্রুত' },
    { value: '1080p', labelBn: '১০৮০p — উচ্চ মান' },
    {
      value: '4k',
      labelBn: '৪K — অসমর্থিত',
      disabled: true,
      disabledReasonBn: '৪K এই পাইপলাইনে নেই — সর্বোচ্চ ১০৮০p',
    },
  ];
}

/** দৈর্ঘ্য-অপশন: DURATION_LIMITS-এর ভেতরে বোধগম্য মানগুলো */
function durationOptions(type: ProductionType): ConfigFieldOption[] {
  const presets: Record<string, number[]> = {
    motion_video: [5, 8, 10, 12, 15, 20],
    music_video: [15, 30, 60, 90, 120, 180],
    short_film: [30, 45, 60, 90, 120],
    audio: [15, 30, 60, 120, 180, 300],
  };
  const lim = DURATION_LIMITS[type];
  const list = presets[type] ?? [];
  const inRange = list.filter(s => s >= lim.min && s <= lim.max);
  return inRange.map(s => ({ value: String(s), labelBn: `${s} সেকেন্ড` }));
}

/** শট-সংখ্যার সৎ আনুমানিক রেঞ্জ (quality-প্রেডিকেট দুই মানে) */
function estimatedShotRange(type: ProductionType, engine?: VideoEngine): { min: number; max: number; engine: VideoEngine | null } {
  const eng: VideoEngine = engine ?? 'ai_diffusion';
  const draft = maxShots(type, 'draft', eng);
  const high = maxShots(type, 'high', eng);
  return { min: Math.min(draft, high), max: Math.max(draft, high), engine: eng };
}

/** প্রকারভেদে সৎ-সীমা নোট (validateSpec-এর নোট-নীতির আদলে) */
function limitationsFor(type: ProductionType, spec?: CreativeJobSpec): string[] {
  const notes: string[] = [];
  if (type === 'motion_video' || type === 'music_video' || type === 'short_film') {
    if ((spec?.videoEngine ?? 'ai_diffusion') === 'cinematic_motion') {
      notes.push('cinematic_motion ইঞ্জিন: AI স্টোরিবোর্ড + ক্যামেরা-মোশন পাইপলাইন — প্রকৃত ডিফিউশন ভিডিও নয়।');
    } else {
      notes.push('প্রকৃত AI ভিডিও: CogVideoX-3 ডিফিউশন। প্রতিটি শটে ~২–৪ মিনিট জেনারেশন-সময়; শট-সংখ্যা সীমিত।');
    }
    notes.push('লিপ-সিঙ্ক মডেল নেই — চরিত্রের মুখের নড়াচড়া বা গায়কের গাওয়ার দাবি করা হয় না।');
  }
  if (type === 'music_video') {
    notes.push('আপলোড করা গান না থাকলে প্রসিডিউরাল ইনস্ট্রুমেন্টাল স্কোর বসে (নিউরাল মিউজিক-মডেল নয়)।');
  }
  if (type === 'audio' && (!spec || spec.audioOperation !== 'voiceover')) {
    notes.push('ইনস্ট্রুমেন্টাল সংগীত প্রসিডিউরাল সংশ্লেষণে তৈরি — পরীক্ষামূলক; গাওয়া গান (singing) নয়।');
  }
  if ((spec?.language ?? 'bn') === 'bn') {
    notes.push('বাংলা কণ্ঠ: bn-BD নিউরাল কণ্ঠ (নবনীতা/প্রদীপ) প্রধান — দেশীয় উচ্চারণ; z-ai কণ্ঠ শুধু ফলব্যাক।');
  }
  return notes;
}

// ------------------------------------------------------------
// মূল নির্মাতা
// ------------------------------------------------------------

export function buildConfigPanel(type: ProductionType, spec?: CreativeJobSpec): ConfigPanelSchema {
  const isVideo = type === 'motion_video' || type === 'music_video' || type === 'short_film';
  const val = <T,>(k: string, d?: T): T | undefined => {
    const v = (spec as Record<string, unknown> | undefined)?.[k];
    return (v === undefined || v === null ? d : (v as T)) ?? undefined;
  };

  const fields: ConfigField[] = [];
  const push = (f: ConfigField) => fields.push(f);

  const titleBn: Record<ProductionType, string> = {
    image: 'ছবি তৈরি',
    audio: 'অডিও তৈরি',
    motion_video: 'মোশন ভিডিও',
    music_video: 'মিউজিক ভিডিও',
    short_film: 'শর্টফিল্ম',
  };

  // --- সাধারণ: মান (সব ধরনে) ---
  push({
    key: 'quality',
    labelBn: 'মান',
    kind: 'select',
    required: true,
    value: val<string>('quality', 'standard'),
    defaultValue: 'standard',
    options: [
      { value: 'draft', labelBn: 'ড্রাফট — দ্রুত প্রিভিউ' },
      { value: 'standard', labelBn: 'স্ট্যান্ডার্ড' },
      { value: 'high', labelBn: 'উচ্চ — ধীর' },
    ],
  });

  if (type === 'image') {
    push({
      key: 'aspect',
      labelBn: 'অনুপাত',
      kind: 'select',
      required: true,
      value: val<string>('aspect', '1:1'),
      defaultValue: '1:1',
      options: SUPPORTED_ASPECTS.map(a => ({ value: a, labelBn: ASPECT_LABELS[a] })),
    });
    push({
      key: 'format',
      labelBn: 'ফরম্যাট',
      kind: 'select',
      required: false,
      advanced: true,
      value: val<string>('format', 'png'),
      defaultValue: 'png',
      options: [
        { value: 'png', labelBn: 'PNG' },
        { value: 'jpeg', labelBn: 'JPEG' },
        { value: 'webp', labelBn: 'WebP' },
      ],
    });
    push({
      key: 'overlayText',
      labelBn: 'ছবিতে বসানো লেখা (ঐচ্ছিক)',
      kind: 'text',
      required: false,
      advanced: true,
      value: val<string>('overlayText'),
      hintBn: 'পোস্টার/টাইপোগ্রাফি — বাংলা লেখাসহ যেকোনো ভাষায় বসে',
    });
  }

  if (type === 'audio') {
    push({
      key: 'audioOperation',
      labelBn: 'অডিওর ধরন',
      kind: 'select',
      required: true,
      value: val<string>('audioOperation', 'voiceover'),
      defaultValue: 'voiceover',
      options: [
        { value: 'voiceover', labelBn: 'কথা/ভয়েসওভার (TTS + ASR-যাচাই)' },
        { value: 'instrumental', labelBn: 'ইনস্ট্রুমেন্টাল সুর — প্রসিডিউরাল (পরীক্ষামূলক)' },
      ],
    });
    push({
      key: 'language',
      labelBn: 'ভাষা',
      kind: 'select',
      required: true,
      value: val<string>('language', 'bn'),
      defaultValue: 'bn',
      options: SUPPORTED_LANGUAGES.map(l => ({ value: l, labelBn: LANGUAGE_LABELS[l] })),
    });
    const lim = DURATION_LIMITS.audio;
    push({
      key: 'durationSec',
      labelBn: 'দৈর্ঘ্য',
      kind: 'select',
      required: true,
      value: String(val<number>('durationSec', lim.def)),
      defaultValue: String(lim.def),
      options: durationOptions('audio'),
      hintBn: `সমর্থিত সীমা ${lim.min}–${lim.max} সেকেন্ড`,
      min: lim.min,
      max: lim.max,
    });
    push({
      key: 'mood',
      labelBn: 'মুড',
      kind: 'select',
      required: false,
      advanced: true,
      value: val<string>('mood'),
      options: [
        { value: '', labelBn: 'স্বয়ংক্রিয়' },
        ...SUPPORTED_MOODS.map(m => ({ value: m, labelBn: MOOD_LABELS[m] })),
      ],
      hintBn: 'ইনস্ট্রুমেন্টাল সুরের আবেগ নির্ধারণ করে',
    });
    push({
      key: 'tempoBpm',
      labelBn: 'টেম্পো (BPM)',
      kind: 'select',
      required: false,
      advanced: true,
      value: val<number>('tempoBpm') !== undefined ? String(val<number>('tempoBpm')) : undefined,
      options: [70, 80, 90, 100, 110, 120, 130, 140, 150].map(b => ({ value: String(b), labelBn: `${b} BPM` })),
      hintBn: 'সমর্থিত সীমা ৬০–১৭০ BPM',
      min: 60,
      max: 170,
    });
    push({
      key: 'text',
      labelBn: 'স্ক্রিপ্ট/নির্দেশনা',
      kind: 'textarea',
      required: false,
      value: val<string>('text'),
      hintBn: 'ভয়েসওভারের লেখা বা সুরের বর্ণনা (খালি রাখলে চ্যাট-বার্তা থেকে নেওয়া হয়)',
    });
  }

  if (isVideo) {
    if (type === 'music_video') {
      push({
        key: 'songArtifactId',
        labelBn: 'গানের উৎস',
        kind: 'song-select',
        required: false,
        value: val<string>('songArtifactId') ?? '',
        defaultValue: '',
        hintBn: 'আপলোড করা গান বেছে নিন; না থাকলে প্রসিডিউরাল ইনস্ট্রুমেন্টাল স্কোর (সৎ-লেবেলসহ)',
      });
      push({
        key: 'mood',
        labelBn: 'মুড',
        kind: 'select',
        required: false,
        value: val<string>('mood'),
        options: [
          { value: '', labelBn: 'স্বয়ংক্রিয়' },
          ...SUPPORTED_MOODS.map(m => ({ value: m, labelBn: MOOD_LABELS[m] })),
        ],
        hintBn: 'গান ছাড়া চালালে স্কোরের আবেগ',
      });
    }
    push({
      key: 'videoEngine',
      labelBn: 'ভিডিও-ইঞ্জিন',
      kind: 'select',
      required: true,
      value: val<string>('videoEngine', 'ai_diffusion'),
      defaultValue: 'ai_diffusion',
      options: (['ai_diffusion', 'cinematic_motion'] as VideoEngine[]).map(e => ({
        value: e,
        labelBn: ENGINE_LABELS[e],
      })),
    });
    if (type === 'short_film') {
      push({
        key: 'filmMode',
        labelBn: 'ফিল্ম-মোড',
        kind: 'select',
        required: false,
        value: val<string>('filmMode', 'short_film'),
        defaultValue: 'short_film',
        options: Object.entries(FILM_MODE_LABELS).map(([v, l]) => ({ value: v, labelBn: l })),
      });
      push({
        key: 'subtitles',
        labelBn: 'সাবটাইটেল',
        kind: 'toggle',
        required: false,
        value: val<boolean>('subtitles', true),
        defaultValue: true,
        hintBn: 'সংলাপের সাথে বার্ন-ইন সাবটাইটেল',
      });
    }
    push({
      key: 'aspect',
      labelBn: 'অনুপাত',
      kind: 'select',
      required: true,
      value: val<string>('aspect', type === 'short_film' ? '16:9' : '9:16'),
      defaultValue: type === 'short_film' ? '16:9' : '9:16',
      options: SUPPORTED_ASPECTS.map(a => ({ value: a, labelBn: ASPECT_LABELS[a] })),
    });
    const lim = DURATION_LIMITS[type];
    push({
      key: 'durationSec',
      labelBn: 'দৈর্ঘ্য',
      kind: 'select',
      required: true,
      value: String(val<number>('durationSec', lim.def)),
      defaultValue: String(lim.def),
      options: durationOptions(type),
      hintBn: `${titleBn[type]} পাইপলাইনে সমর্থিত সীমা ${lim.min}–${lim.max} সেকেন্ড`,
      min: lim.min,
      max: lim.max,
    });
    push({
      key: 'language',
      labelBn: 'ভাষা (সংলাপ/ভয়েসওভার)',
      kind: 'select',
      required: true,
      value: val<string>('language', 'bn'),
      defaultValue: 'bn',
      options: SUPPORTED_LANGUAGES.map(l => ({ value: l, labelBn: LANGUAGE_LABELS[l] })),
    });
    if (type !== 'music_video') {
      push({
        key: 'sound',
        labelBn: 'শব্দ-নকশা',
        kind: 'select',
        required: false,
        value: val<string>('sound', type === 'short_film' ? 'narration' : 'none'),
        defaultValue: type === 'short_film' ? 'narration' : 'none',
        options: [
          { value: 'none', labelBn: 'নীরব' },
          { value: 'ambient', labelBn: 'পরিবেশ-শব্দ' },
          ...(type === 'short_film' ? [{ value: 'narration', labelBn: 'ভয়েসওভার' }] : []),
        ],
      });
    }
    push({
      key: 'fps',
      labelBn: 'ফ্রেম-রেট',
      kind: 'select',
      required: false,
      advanced: true,
      value: String(val<number>('fps', type === 'short_film' ? 24 : 30)),
      defaultValue: String(type === 'short_film' ? 24 : 30),
      options: fpsOptions(),
      hintBn: 'সমর্থিত: ২৪ (সিনেম্যাটিক) / ২৫ / ৩০ (সোশ্যাল)',
    });
    push({
      key: 'resolution',
      labelBn: 'রেজোলিউশন',
      kind: 'select',
      required: false,
      advanced: true,
      value: val<string>('resolution'),
      options: resolutionOptions(),
      hintBn: 'না বাছলে মান-অনুযায়ী (draft→৭২০p, standard/high→১০৮০p)',
    });
    push({
      key: 'style',
      labelBn: 'ভিজ্যুয়াল স্টাইল',
      kind: 'select',
      required: false,
      advanced: true,
      value: val<string>('style'),
      options: [
        { value: '', labelBn: 'স্বয়ংক্রিয়' },
        { value: 'cinematic', labelBn: 'সিনেম্যাটিক' },
        { value: 'natural', labelBn: 'ন্যাচারাল' },
        { value: 'anime', labelBn: 'অ্যানিমে' },
        { value: 'fantasy', labelBn: 'ফ্যান্টাসি' },
        { value: 'retro', labelBn: 'রেট্রো' },
        { value: 'documentary', labelBn: 'ডকুমেন্টারি' },
        { value: 'neon-cyberpunk', labelBn: 'নিয়ন-সাইবারপাংক' },
      ],
    });
  }

  return {
    type,
    titleBn: titleBn[type],
    limitations: limitationsFor(type, spec),
    fields,
    plannedSteps: plannedStepsFor(type),
    estimatedShots: estimatedShotRange(type, spec?.videoEngine),
  };
}

// ------------------------------------------------------------
// প্যানেল-পূর্ব ক্লায়েন্ট-সাইড দ্রুত যাচাই (সার্ভার-যাচাইয়ের পূরক, বিকল্প নয়)
// — ক্ষেত্র-স্তরের তাৎক্ষণিক ত্রুটি-দেখানোর জন্য; চূড়ান্ত রায় সার্ভারে।
// ------------------------------------------------------------

export interface FieldValidationError {
  key: string;
  messageBn: string;
}

/** স্কিমা-সচেতন ক্ষেত্র-যাচাই: required অনুপস্থিতি + select-অপশন-বহির্ভূত মান + সীমা-লঙ্ঘন */
export function validateFieldsAgainstSchema(
  schema: ConfigPanelSchema,
  values: Record<string, unknown>
): FieldValidationError[] {
  const errors: FieldValidationError[] = [];
  for (const f of schema.fields) {
    const v = values[f.key];
    const empty = v === undefined || v === null || v === '';
    if (f.required && empty) {
      errors.push({ key: f.key, messageBn: `${f.labelBn} আবশ্যক` });
      continue;
    }
    if (empty) continue; // ঐচ্ছিক খালি — ঠিক আছে
    if (f.kind === 'select' && f.options) {
      // মান সংখ্যা এবং ক্ষেত্রটির সীমা (min/max) থাকলে (যেমন দৈর্ঘ্য) —
      // প্রিসেট-তালিকার বাইরের সীমার-ভেতরের মান বৈধ (যেমন ৪৫ সে.);
      // সীমা-বহির্ভূত মান নিচের সংখ্যা-শাখাতেই ধরা পড়বে।
      const asNum = Number(v);
      const rangedSelect = f.min !== undefined && f.max !== undefined && v !== '' && Number.isFinite(asNum);
      if (!rangedSelect) {
        // নিষ্ক্রিয় অপশন বেছে থাকলে সৎ-কারণ দেখাও; বহির্ভূত মানও ধরা পড়ে
        const opt = f.options.find(o => o.value === String(v));
        if (!opt) {
          errors.push({ key: f.key, messageBn: `${f.labelBn}: অজানা মান "${String(v).slice(0, 40)}"` });
        } else if (opt.disabled) {
          errors.push({ key: f.key, messageBn: `${f.labelBn}: ${opt.disabledReasonBn ?? 'এই অপশন সমর্থিত নয়'}` });
        }
      }
    }
    // সংখ্যা-সীমা — select-ও (min/max-সহ) একই শাখায় পড়ে
    if (f.min !== undefined || f.max !== undefined) {
      const n = Number(v);
      if (v !== '' && !Number.isFinite(n)) {
        errors.push({ key: f.key, messageBn: `${f.labelBn}: সংখ্যা হতে হবে` });
      } else if (
        Number.isFinite(n) &&
        ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max))
      ) {
        errors.push({
          key: f.key,
          messageBn: `${f.labelBn}: সমর্থিত সীমা ${f.min}–${f.max}`,
        });
      }
    }
    if ((f.kind === 'song-select' || f.kind === 'text' || f.kind === 'textarea') && typeof v === 'string' && v.length > 4000) {
      errors.push({ key: f.key, messageBn: `${f.labelBn}: খুব দীর্ঘ (সর্বোচ্চ ৪০০০ অক্ষর)` });
    }
  }
  return errors;
}
