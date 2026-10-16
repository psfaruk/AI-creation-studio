// ============================================================
// Audio Language Controller — নতুন মাস্টার প্ল্যান §২
// (ভাষা শনাক্তকরণ → সমর্থন-যাচাই → সঠিক মডেল/কণ্ঠ নির্বাচন →
//  TTS → প্রযুক্তি-যাচাই → ASR ব্যাক-চেক → রায়)
//
// সততার ভিত্তি (২০২৬-১০-১১ প্রোব + ২০২৬-১০-১৬ প্রকৃত-রান-প্রমাণ):
//  - z-ai SDK-র কোনো কণ্ঠই বাংলা-প্রশিক্ষিত নয়। ২০২৬-১০-১৬-এর রানে
//    Edge-403-এর পরে jam-কে বাংলা পড়াতে গিয়ে চীনা-অক্ষরের আবর্জনা
//    এসেছিল (DB: speech-bn-jam, ট্রান্সক্রিপ্ট "可真的，可真的，踢踢踢…",
//    সাদৃশ্য ০)। তাই bn-প্রোফাইলে z-ai কণ্ঠ আর নেই (RC-1/B-F01) —
//    Edge অচল হলে সৎ VOICE_UNAVAILABLE ব্যর্থতা, নীরব ভাষা-ভাঙা নয়।
//  - বাংলার একমাত্র যাচাইকৃত কণ্ঠ: Microsoft Edge-নিউরাল bn-BD/bn-IN।
//    bn+Edge হলে ASR-কল বাদ (ASR বাংলা বোঝে না) — দৈর্ঘ্য-যাচাইই রায়।
//  - ইংরেজি: ASR রাউন্ড-ট্রিপ যাচাই কার্যকর — তবে সাদৃশ্য একা যথেষ্ট নয়,
//    শব্দ-আবৃত্তিও লাগে (B-F05; ০.৫৭-সাদৃশ্যে রোমানীকৃত-আবর্জনা পাস
//    হয়ে গিয়েছিল)।
//  - ASR-এর ৩০ সেকেন্ডের সীমা → transcribeBuffer চাঙ্কিং করে।
// ============================================================

import type { TtsVoice } from '../sdk-helpers';
import { transcribeBuffer } from '../sdk-helpers';
// §১১: ব্যবহারকারীর পুনরাবৃত্ত TTS-অনুরোধ ডিস্ক-ক্যাশে+ডিডুপ-পথে — রেট-লিমিট-চাপ কমে
import { cachedSynthesizeSpeech } from '../tts-cache';
import { audioQuality } from '@/lib/media/ffmpeg';
import type { SpeechLocale } from '@/lib/types';
import { normalizeBengaliSpeechText } from './bn-text-normalizer';
import { isEdgeVoice, EDGE_TTS_LABEL, recordVoiceVerification, type EdgeVoiceId } from './edge_tts';

// শেয়ার্ড চুক্তির উৎস (types.ts ~:৫৫১ এলাকা) থেকে লোকেল-ধরন পুনঃরপ্তানি (B-F10)
export type { SpeechLocale };

// ------------------------------------------------------------
// §২.১ AudioJobSpec
// ------------------------------------------------------------

export type SpeechLanguage = 'bn' | 'en';
export type AudioTask = 'speech' | 'singing' | 'instrumental';

/** যেকোনো বৈধ কণ্ঠ — Edge-নিউরাল বা z-ai */
export type SpeechVoice = TtsVoice | EdgeVoiceId;

export interface AudioJobSpec {
  task: AudioTask;
  language: SpeechLanguage;
  /** লোকেল-অনুরোধ (B-F10) — মিল-লোকেল কণ্ঠ প্রধান হয়; বদল হলে নোট রেকর্ড হয় */
  locale?: SpeechLocale;
  script: string;
  /** অনুরোধকৃত কণ্ঠ (না দিলে/ভাষার অনুপযুক্ত হলে প্রোফাইল-প্রধান কণ্ঠে রেজল্ভ) */
  voiceId?: SpeechVoice;
  outputFormat: 'wav' | 'mp3';
  sampleRate: 24000 | 44100 | 48000;
  speed?: number;
}

// ------------------------------------------------------------
// টাইপড ব্যর্থতা (B-F02/B-F03) — UI/পাইপলাইন ধরতে পারে এমন স্বতন্ত্র শ্রেণি
// ------------------------------------------------------------

export type SpeechErrorCode =
  /** স্ক্রিপ্ট/কণ্ঠ/লোকেল — ভাষার অসামঞ্জস্য (§২/§4.2) */
  | 'LANGUAGE_MISMATCH'
  /** কোনো যাচাইকৃত ভাষা-সক্ষম কণ্ঠই পৌঁছানো যায়নি (§4.2-এর হুবহু বার্তা) */
  | 'VOICE_UNAVAILABLE'
  /** চেইনের সব প্রার্থীই ভাষা-যাচাইে ব্যর্থ — অডিও গ্রহণযোগ্য নয় (RC-2) */
  | 'VERIFICATION_FAILED'
  /** অনুরোধকৃত লোকেল সমর্থিত নয় / ভাষার সাথে মেলে না (B-F10 — নীরব প্রতিস্থাপন নিষিদ্ধ) */
  | 'UNSUPPORTED_LOCALE';

/** ভাষা-নিয়ন্ত্রকের টাইপড ব্যর্থতা — পাইপলাইন/UI `err.code` দিয়ে ধরে */
export class SpeechSynthesisError extends Error {
  readonly code: SpeechErrorCode;
  /** VERIFICATION_FAILED হলে শেষ (ব্যর্থ) যাচাই-ফলাফল — নোট/ট্রান্সক্রিপ্টসহ */
  readonly lastVerification?: SpeechVerification;
  readonly attempts: number;

  constructor(code: SpeechErrorCode, message: string, info?: { lastVerification?: SpeechVerification; attempts?: number }) {
    super(message);
    this.name = `SpeechSynthesisError[${code}]`;
    this.code = code;
    this.lastVerification = info?.lastVerification;
    this.attempts = info?.attempts ?? 0;
  }
}

/** যেকোনো ত্রুটি টাইপড ভাষা-ব্যর্থতা কি না */
export function isSpeechSynthesisError(err: unknown): err is SpeechSynthesisError {
  return err instanceof SpeechSynthesisError;
}

/** ত্রুটির কোড — টাইপড না হলে null */
export function speechErrorCode(err: unknown): SpeechErrorCode | null {
  return err instanceof SpeechSynthesisError ? err.code : null;
}

// ------------------------------------------------------------
// ভাষা-প্রোফাইল — প্রোব-যাচাইকৃত, সৎ ক্ষমতা-ঘোষণা
// ------------------------------------------------------------

export interface LanguageProfile {
  code: SpeechLanguage;
  name: string; // বাংলা নাম
  /** কণ্ঠ-পছন্দক্রম (প্রথমটা ডিফল্ট) — ২০২৬-১০-১৩ থেকে Edge-নিউরাল প্রধান */
  voices: SpeechVoice[];
  /**
   * প্রতি-কণ্ঠ ভাষা-ক্ষমতা-ট্যাগ (RC-1/B-F01): ফলব্যাক-চেইনে ঢোকে কেবল
   * সেই কণ্ঠ, যার ট্যাগ অনুযায়ী অনুরোধকৃত ভাষায় সক্ষমতা আছে।
   * ট্যাগহীন কণ্ঠ = অযোগ্য (fail-closed) — নীরব ক্রস-ভাষা ফলব্যাক অসম্ভব।
   */
  voiceCapabilities: Record<string, VoiceCapability>;
  /** এই ভাষার কণ্ঠগুলো প্রশিক্ষিত কি না — সৎ ঘোষণা */
  nativeSupport: 'verified' | 'partial' | 'none';
  /** ASR এই ভাষায় কতটা নির্ভরযোগ্য */
  asrSupport: 'good' | 'weak' | 'none';
  notes: string[];
}

/** একটি কণ্ঠের যাচাইকৃত ক্ষমতা-ঘোষণা (B-F01) */
export interface VoiceCapability {
  /** যে ইঞ্জিনে কণ্ঠটি বাস করে */
  engine: 'edge' | 'zai';
  /** যে ভাষাগুলোতে কণ্ঠটি প্রশিক্ষিত/সক্ষম (প্রমাণসহ দাবি) */
  languages: SpeechLanguage[];
  /** Edge-নিউরাল কণ্ঠের ঘোষিত লোকেল */
  locale?: string;
}

/** যেকোনো প্রোফাইল থেকে কণ্ঠের ক্ষমতা-ট্যাগ খোঁজা */
export function voiceCapabilityOf(voice: string): VoiceCapability | undefined {
  for (const p of Object.values(LANGUAGE_PROFILES)) {
    const c = p.voiceCapabilities[voice];
    if (c) return c;
  }
  return undefined;
}

/** কণ্ঠ কোন ইঞ্জিনের — Edge-নিউরাল নাম হলে 'edge', নয়তো z-ai */
export function engineOfVoice(voice: string): 'edge' | 'zai' {
  return isEdgeVoice(voice) ? 'edge' : 'zai';
}

export const LANGUAGE_PROFILES: Record<SpeechLanguage, LanguageProfile> = {
  bn: {
    code: 'bn',
    name: 'বাংলা',
    // RC-1 মূল সমাধান (B-F01, ২০২৬-১০-১৬-এর Defect A): bn-চেইনে এখন শুধু
    // বাংলা-প্রশিক্ষিত Edge-নিউরাল কণ্ঠ — jam/douji সম্পূর্ণ সরানো। প্রকৃত
    // রানে Edge-403-এর পরে jam বাংলা পড়তে গিয়ে চীনা-অক্ষরের আবর্জনা
    // বানিয়েছিল (DB: speech-bn-jam — "可真的，可真的，踢踢踢…", সাদৃশ্য ০)।
    // Edge অচল হলে আর নীরব ভাষা-ভাঙা ফলব্যাক নয় — সৎ VOICE_UNAVAILABLE।
    voices: ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural', 'bn-IN-TanishaaNeural', 'bn-IN-BashkarNeural'],
    voiceCapabilities: {
      'bn-BD-NabanitaNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-BD' },
      'bn-BD-PradeepNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-BD' },
      'bn-IN-TanishaaNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-IN' },
      'bn-IN-BashkarNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-IN' },
    },
    nativeSupport: 'verified',
    asrSupport: 'weak',
    notes: [
      `সব কণ্ঠ Microsoft-এর বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ (bn-BD: নবনীতা/প্রদীপ; bn-IN: তানিশা/ভাস্কর) — দেশীয় উচ্চারণ (${EDGE_TTS_LABEL})।`,
      'z-ai কণ্ঠ (jam/douji) বাংলা-প্রশিক্ষিত নয় — ২০২৬-১০-১৬-এর রানে চীনা-আবর্জনা প্রমাণিত; তাই bn-চেইনে আর নেই। Edge অচল হলে সৎ ফলাফল = VOICE_UNAVAILABLE (§৪.২)।',
    ],
  },
  en: {
    code: 'en',
    name: 'ইংরেজি',
    voices: ['en-US-AriaNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural', 'jam', 'tongtong', 'kazi', 'xiaochen'],
    voiceCapabilities: {
      'en-US-AriaNeural': { engine: 'edge', languages: ['en'], locale: 'en-US' },
      'en-US-GuyNeural': { engine: 'edge', languages: ['en'], locale: 'en-US' },
      'en-GB-SoniaNeural': { engine: 'edge', languages: ['en'], locale: 'en-GB' },
      'en-GB-RyanNeural': { engine: 'edge', languages: ['en'], locale: 'en-GB' },
      jam: { engine: 'zai', languages: ['en'] },
      tongtong: { engine: 'zai', languages: ['en'] },
      kazi: { engine: 'zai', languages: ['en'] },
      xiaochen: { engine: 'zai', languages: ['en'] },
    },
    nativeSupport: 'verified',
    asrSupport: 'good',
    notes: [
      `প্রধান কণ্ঠগুলো Microsoft-নিউরাল (আরিয়া/গাই/সোনিয়া); z-ai jam/tongtong/kazi/xiaochen ইংরেজি-ফলব্যাক (${EDGE_TTS_LABEL}-অচল হলে)।`,
      'ASR ইংরেজি ভালো বোঝে — রাউন্ড-ট্রিপ সাদৃশ্য + শব্দ-আবৃত্তি-যাচাই কার্যকর (B-F05: সাদৃশ্য একা প্রমাণ নয়)।',
    ],
  },
};

// ------------------------------------------------------------
// স্ক্রিপ্ট-ভিত্তিক ভাষা শনাক্তকরণ
// ------------------------------------------------------------

export interface LanguageDetection {
  language: SpeechLanguage | 'mixed' | 'unknown' | 'other-script';
  confidence: number; // 0–1
  bnRatio: number;
  latinRatio: number;
  /** বাংলা/লাতিন বাদে অন্য সব লিপির অক্ষর-অনুপাত (CJK/দেবনাগরী/আরবি…) */
  otherScriptRatio: number;
}

/**
 * লেখার অক্ষর-অনুপাত থেকে ভাষা শনাক্তকরণ।
 * বাংলা ইউনিকোড: 0980–09FF। B-F04-হার্ডেনিং: CJK-শ্রেণির লিপি এখন
 * *দৃশ্যমান* — প্রকৃত রানের চীনা-আবর্জনা ট্রান্সক্রিপ্ট ("可真的，可真的，
 * 踢踢踢…") পুরোনো যাচাইকারীর চোখে "en" হয়ে যেত (মোট গণনাতেই ছিল না)।
 * এখন অন্য-লিপির অক্ষর ২৫% ছাড়ালে ভাষা = 'other-script'।
 */
export function detectLanguage(text: string): LanguageDetection {
  const t = text ?? '';
  const bn = (t.match(/[\u0980-\u09FF]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  const allLetters = (t.match(/\p{L}/gu) ?? []).length;
  const other = Math.max(0, allLetters - bn - latin);
  const otherScriptRatio = allLetters > 0 ? other / allLetters : 0;
  const total = bn + latin;
  if (total === 0 && other === 0) {
    return { language: 'unknown', confidence: 0, bnRatio: 0, latinRatio: 0, otherScriptRatio: 0 };
  }
  const bnRatio = total > 0 ? bn / total : 0;
  const latinRatio = total > 0 ? latin / total : 0;
  if (otherScriptRatio >= 0.25) {
    return { language: 'other-script', confidence: otherScriptRatio, bnRatio, latinRatio, otherScriptRatio };
  }
  if (bnRatio >= 0.7) return { language: 'bn', confidence: bnRatio, bnRatio, latinRatio, otherScriptRatio };
  if (latinRatio >= 0.7) return { language: 'en', confidence: latinRatio, bnRatio, latinRatio, otherScriptRatio };
  if (total === 0) {
    // ২৫%-এর কম অন্য-লিপি কিন্তু বাংলা/লাতিন একেবারেই নেই — এটিও অন্য-লিপি
    return { language: 'other-script', confidence: otherScriptRatio, bnRatio: 0, latinRatio: 0, otherScriptRatio };
  }
  return { language: 'mixed', confidence: Math.max(bnRatio, latinRatio), bnRatio, latinRatio, otherScriptRatio };
}

/** আনুমানিক কথার দৈর্ঘ্য (সেকেন্ডে) — দৈর্ঘ্য-স্বাস্থ্য যাচাইয়ের ভিত্তি */
export function estimateSpeechSec(text: string, language: SpeechLanguage): number {
  const words = (text ?? '').trim().split(/\s+/).filter(Boolean).length;
  const wps = language === 'bn' ? 2.0 : 2.5; // বাংলা কিছুটা ধীরে পড়া হয়
  return Math.max(0.8, words / wps);
}

/**
 * ভাষা অনুযায়ী কণ্ঠ নির্বাচন।
 *
 * ২০২৬-১০-১৩-এর নিয়ম: বাংলায় z-ai কণ্ঠ বেছে নিলে তা **সদিচ্ছায় আপগ্রেড**
 * হয়ে প্রধান বাংলা নিউরাল কণ্ঠ হয় (REG-1d-চুক্তি অপরিবর্তিত — পাইপলাইনগুলো
 * পুরোনো ডিফল্ট jam/tongtong এখনো পাঠায়)। লোকেল-অনুরোধ থাকলে (B-F10)
 * মিল-লোকেলের কণ্ঠ প্রধান হয় — নীরব ক্রস-ডায়ালেক্ট নয়।
 */
export function resolveVoice(language: SpeechLanguage, preferred?: string, locale?: SpeechLocale): SpeechVoice {
  const profile = LANGUAGE_PROFILES[language];
  if (preferred && (profile.voices as string[]).includes(preferred)) {
    const pref = preferred as SpeechVoice;
    if (language === 'bn' && !isEdgeVoice(pref)) {
      return profile.voices[0]; // নবনীতা (bn-BD নিউরাল) — সদিচ্ছা-আপগ্রেড
    }
    return pref;
  }
  if (locale) {
    const match = profile.voices.find(
      v => voiceCapabilityOf(v)?.locale === locale && voiceCapabilityOf(v)?.languages.includes(language)
    );
    if (match) return match;
  }
  return profile.voices[0];
}

/**
 * একাধিক চরিত্রে আলাদা আলাদা কণ্ঠ বণ্টন (শর্টফিল্মের সংলাপের জন্য)।
 * ভাষার নিউরাল-কণ্ঠগুলো ঘুরিয়ে-ফিরিয়ে বরাদ্দ — দুই চরিত্র একই কণ্ঠে নয়।
 * লোকেল-অনুরোধ থাকলে (B-F10) মিল-লোকেল কণ্ঠগুলো আগে বণ্টিত হয়।
 */
export function assignCharacterVoices(
  names: string[],
  language: SpeechLanguage,
  locale?: SpeechLocale
): Record<string, SpeechVoice> {
  const neural = (
    language === 'bn'
      ? ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural', 'bn-IN-TanishaaNeural', 'bn-IN-BashkarNeural']
      : ['en-US-AriaNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural', 'en-GB-RyanNeural']
  ) as SpeechVoice[];
  if (locale) {
    const score = (v: string) => (voiceCapabilityOf(v)?.locale === locale ? 1 : 0);
    neural.sort((a, b) => score(b) - score(a));
  }
  const out: Record<string, SpeechVoice> = {};
  let i = 0;
  for (const n of names) {
    out[n] = neural[i % neural.length];
    i++;
  }
  return out;
}

// ------------------------------------------------------------
// সাদৃশ্য-গণনা (ASR ট্রান্সক্রিপ্ট ↔ মূল স্ক্রিপ্ট)
// ------------------------------------------------------------

function normalizeEn(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** শব্দ-থলি Jaccard + অক্ষর-ত্রিগুণ সাদৃশ্যের সর্বোচ্চ — ASR ভুল সহনশীল */
export function transcriptSimilarity(script: string, transcript: string, language: SpeechLanguage): number {
  if (!script?.trim() || !transcript?.trim()) return 0;
  if (language === 'en') {
    const a = normalizeEn(script).split(' ').filter(Boolean);
    const b = normalizeEn(transcript).split(' ').filter(Boolean);
    if (a.length && b.length) {
      const setA = new Set(a);
      const setB = new Set(b);
      let inter = 0;
      for (const w of setA) if (setB.has(w)) inter++;
      const jaccard = inter / (setA.size + setB.size - inter);
      // অক্ষর-ত্রিগুণ
      const tri = (s: string) => {
        const t = normalizeEn(s).replace(/ /g, '');
        const out = new Set<string>();
        for (let i = 0; i < Math.max(0, t.length - 2); i++) out.add(t.slice(i, i + 3));
        return out;
      };
      const ta = tri(script);
      const tb = tri(transcript);
      let ti = 0;
      for (const g of ta) if (tb.has(g)) ti++;
      const triSim = ta.size && tb.size ? ti / Math.max(ta.size, tb.size) : 0;
      return Math.max(jaccard, triSim * 0.95);
    }
  }
  // বাংলা: ASR সাধারণত বাংলা দেয় না — বাংলা-অক্ষর অনুপাতই আপেক্ষিক সংকেত
  const bnChars = (transcript.match(/[\u0980-\u09FF]/g) ?? []).length;
  const allChars = (transcript.match(/[\p{L}]/gu) ?? []).length;
  return allChars > 0 ? bnChars / allChars : 0;
}

/** ট্রান্সক্রিপ্ট থেকে শনাক্ত ভাষা (B-F04: 'other-script' শ্রেণিসহ) */
export function detectTranscriptLanguage(
  transcript: string
): SpeechLanguage | 'mixed' | 'unknown' | 'silence' | 'other-script' {
  if (!transcript?.trim()) return 'silence';
  return detectLanguage(transcript).language;
}

/**
 * তুচ্ছ পুনরাবৃত্তি-শনাক্তকরণ (§4.4-৪, B-F04): ASR-আবর্জনা প্রায়ই একই
 * টোকেন ঘুরিয়ে ফেরায় — প্রকৃত প্রমাণ ২০২৬-১০-১৬: "可真的，可真的，踢踢踢，
 * 忙的，踢踢踢，踢B T" (শীর্ষ অক্ষর "踢" টোকেনের ৫০%)। CJK-ভারী লেখায়
 * অক্ষর-টোকেন, নয়তো শব্দ-টোকেন গুনে শীর্ষ টোকেনের ঘনত্ব ≥ ০.৪ হলে repeated।
 */
export function detectTrivialRepetition(transcript: string): {
  repeated: boolean;
  topToken: string;
  topRatio: number;
} {
  const t = (transcript ?? '').trim();
  if (!t) return { repeated: false, topToken: '', topRatio: 0 };
  const cjk = t.match(/[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) ?? [];
  const tokens: string[] =
    cjk.length >= 8
      ? [...cjk, ...(t.match(/[A-Za-z]{2,}/g) ?? [])]
      : (t.toLowerCase().match(/[^\s\p{P}]+/gu) ?? []);
  if (tokens.length < 6) return { repeated: false, topToken: '', topRatio: 0 };
  const counts = new Map<string, number>();
  for (const tok of tokens) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  let topToken = '';
  let topCount = 0;
  for (const [tok, c] of counts) {
    if (c > topCount) {
      topToken = tok;
      topCount = c;
    }
  }
  const topRatio = topCount / tokens.length;
  return { repeated: topRatio >= 0.4, topToken, topRatio };
}

/**
 * en-শব্দ-আবৃত্তি (B-F05): স্ক্রিপ্টের (≥২-অক্ষর) ইংরেজি টোকেনের কত ভাগ
 * ট্রান্সক্রিপ্টে হুবহু উপস্থিত। স্ক্রিপ্টে ইংরেজি টোকেনই না থাকলে (ভিন্ন লিপি)
 * total=০ — রাউন্ড-ট্রিপ যাচাই অসম্ভব, "pass" দেওয়া যায় না।
 */
export function enTokenCoverage(script: string, transcript: string): { covered: number; total: number } {
  const a = [...new Set(normalizeEn(script).split(' ').filter(w => w.length >= 2))];
  if (a.length === 0) return { covered: 0, total: 0 };
  const b = new Set(normalizeEn(transcript).split(' ').filter(Boolean));
  let covered = 0;
  for (const w of a) if (b.has(w)) covered++;
  return { covered, total: a.length };
}

// ------------------------------------------------------------
// §২.২ যাচাই-ফলাফল
// ------------------------------------------------------------

export interface SpeechVerification {
  /** প্রকৃতে ব্যবহৃত কণ্ঠ (= actualVoice; পুরোনো ফিল্ড-নাম সংরক্ষিত) */
  voice: SpeechVoice;
  /** অনুরোধকৃত কণ্ঠ — আপগ্রেড/ফলব্যাকের আগের (B-F06 সত্য-প্রোভেনেন্স) */
  requestedVoice: SpeechVoice;
  /** প্রকৃতে ব্যবহৃত কণ্ঠ — স্পষ্ট নামেও (B-F06) */
  actualVoice: SpeechVoice;
  /** প্রকৃত কণ্ঠের ইঞ্জিন (B-F06) */
  engine: 'edge' | 'zai';
  /** প্রকৃত কণ্ঠের লোকেল (Edge-কণ্ঠে; B-F10) */
  locale?: string;
  /** অনুরোধকৃত লোকেল, যদি দেওয়া হয়েছিল (B-F10) */
  requestedLocale?: string;
  /** প্রত্যাশিত ভাষা */
  language: SpeechLanguage;
  /** ASR ট্রান্সক্রিপ্ট (চাঙ্ক-যুক্ত) */
  transcript: string;
  /** ট্রান্সক্রিপ্টে শনাক্ত ভাষা */
  detectedLanguage: string;
  /** 0–1 সাদৃশ্য (en: রাউন্ড-ট্রিপ; bn: বাংলা-অক্ষর অনুপাত) */
  similarity: number;
  /** অডিওর প্রকৃত দৈর্ঘ্য (সে.) */
  durationSec: number;
  /** আনুমানিক প্রত্যাশিত দৈর্ঘ্য (সে.) */
  expectedSec: number;
  durationOk: boolean;
  peakDb?: number;
  silenceRanges: { start: number; end: number }[];
  /** pass = যন্ত্র-যাচাইকৃত ঠিক; warn = সম্ভাব্য কিন্তু মানব-শ্রবণ দরকার; fail = ব্যর্থ */
  verdict: 'pass' | 'warn' | 'fail';
  notes: string[];
}

export interface SynthesizedSpeech {
  buffer: Buffer;
  mimeType: string;
  ext: string;
  /** প্রকৃতে সংশ্লেষণকারী কণ্ঠ (ফলব্যাক হলে অনুরোধকৃতটি নয়) */
  voice: SpeechVoice;
  /** অনুরোধকৃত কণ্ঠ — রেজল্ভ/আপগ্রেডের আগের (B-F06) */
  requestedVoice: SpeechVoice;
  /** প্রকৃত ইঞ্জিন (B-F06) */
  engine: 'edge' | 'zai';
  /** প্রকৃত কণ্ঠের লোকেল (Edge-কণ্ঠে; B-F10) */
  locale?: string;
  /** অনুরোধকৃত লোকেল, যদি দেওয়া হয়েছিল (B-F10) */
  requestedLocale?: string;
  verification: SpeechVerification;
  attempts: number;
}

/**
 * একটি TTS ফলাফলের সম্পূর্ণ যাচাই (দৈর্ঘ্য/স্তর/নীরবতা + ASR ব্যাক-চেক)।
 * §4.4-হার্ডেনিং (B-F04/B-F05): স্ক্রিপ্ট-শ্রেণি শনাক্তকরণ (CJK/অন্য লিপি),
 * তুচ্ছ পুনরাবৃত্তি-শনাক্তকরণ, bn-রায়ে সাদৃশ্য-ব্যবহার, আর en-রায়ে
 * শব্দ-আবৃত্তি-শর্ত — প্রতিটির যাচাই-ভিত্তি নিচের কমেন্টে।
 * এক্সপোর্ট করা হলো যাতে নিয়ন্ত্রক-চেইন ছাড়াও সরাসরি একক-অডিও যাচাই
 * সম্ভব হয় (প্রতিরোধ-স্তর + রিগ্রেশন-টেস্ট)।
 */
export async function verifySpeechBuffer(
  buffer: Buffer,
  ext: string,
  spec: AudioJobSpec,
  voice: SpeechVoice,
  requestedVoice: SpeechVoice = voice
): Promise<SpeechVerification> {
  const edgeVoice = isEdgeVoice(voice);
  const engine = engineOfVoice(voice);
  const notes: string[] = [];
  const { writeFile, mkdtemp, rm } = await import('fs/promises');
  const path = await import('path');
  const os = await import('os');
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lang-verify-'));
  let quality: Awaited<ReturnType<typeof audioQuality>> | null = null;
  try {
    const f = path.join(tmp, `v.${ext}`);
    await writeFile(f, buffer);
    quality = await audioQuality(f);
  } catch {
    quality = null;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  const durationSec = quality?.durationSec ?? 0;
  const expectedSec = estimateSpeechSec(spec.script, spec.language) / Math.max(0.5, Math.min(2, spec.speed ?? 1));
  const durationOk = durationSec >= expectedSec * 0.4 && durationSec <= expectedSec * 2.6;
  const silenceRanges = quality?.silenceRanges ?? [];

  // ASR ব্যাক-চেক — কেবল যেখানে অর্থবহ: ইংরেজিতে ASR নির্ভরযোগ্য।
  // বাংলায় ASR বোঝেই না — Edge-নিউরাল বাংলা কণ্ঠ এমনিতেই বাংলা-প্রশিক্ষিত,
  // তাই বাংলা+Edge হলে ASR-কল বাদ (দ্রুততা + খরচ), দৈর্ঘ্য-যাচাইই রায়।
  let transcript = '';
  let asrError = '';
  const asrUseful = spec.language === 'en' || (!edgeVoice && spec.language === 'bn');
  if (asrUseful) {
    try {
      transcript = await transcribeBuffer(buffer, ext);
    } catch (err: any) {
      asrError = String(err?.message ?? err).slice(0, 140);
    }
  }
  const detectedLanguage = detectTranscriptLanguage(transcript);
  const similarity = transcriptSimilarity(spec.script, transcript, spec.language);

  // ---- রায় নির্ধারণ ----
  // ক্রম-নীতি (B-F04): ভুল-ভাষার প্রমাণ (অন্য লিপি/নীরবতা/শূন্য-মিল/পুনরাবৃত্তি)
  // সবসময় প্রাধান্য পায় — দৈর্ঘ্য-সতর্কতা যেন সেটিকে ঢেকে "warn" বানাতে না
  // পারে (২০২৬-১০-১৬-এর প্রকৃত রানে চীনা-আবর্জনা ট্রান্সক্রিপ্ট দৈর্ঘ্য-ঠিক
  // থাকায় "warn" হয়ে মিশে গিয়েছিল)।
  let verdict: SpeechVerification['verdict'];
  if (buffer.length === 0 || durationSec < Math.max(0.6, expectedSec * 0.35)) {
    verdict = 'fail';
    notes.push('অডিওর দৈর্ঘ্য প্রত্যাশার চেয়ে অনেক কম — স্ক্রিপ্ট সম্পূর্ণ পড়া হয়নি।');
  } else if (asrUseful && !asrError) {
    // ট্রান্সক্রিপ্ট-ভিত্তিক কঠোর-ব্যর্থতা — bn ও en উভয় ক্ষেত্রেই প্রযোজ্য
    verdict = 'warn'; // নিচের কোনো শর্ত ধরলে fail হয়ে যাবে
    if (detectedLanguage === 'other-script') {
      // §4.2/B-F04(ক): চীনা/অন্য লিপির আউটপুট = ভাষা-যাচাই ব্যর্থ (প্রকৃত রানের
      // "可真的，可真的，踢踢踢…" ট্রান্সক্রিপ্ট পুরোনো যাচাইকারীর চোখে "en" ছিল)
      verdict = 'fail';
      notes.push('ট্রান্সক্রিপ্টে বাংলা/ইংরেজি নয় এমন লিপি (যেমন চীনা অক্ষর) — কণ্ঠটি ভুল ভাষায় পড়েছে (§4.2)।');
    }
    const repetition = detectTrivialRepetition(transcript);
    if (repetition.repeated) {
      // B-F04(খ): তুচ্ছ পুনরাবৃত্তি — ASR-আবর্জনা প্রায়ই একই টোকেন ঘোরায়
      verdict = 'fail';
      notes.push(
        `ট্রান্সক্রিপ্টে তুচ্ছ পুনরাবৃত্তি (শীর্ষ টোকেন "${repetition.topToken}" — টোকেনের ${Math.round(repetition.topRatio * 100)}%) — অর্থহীন সিলেবল ঘুরছে।`
      );
    }
    if (detectedLanguage === 'silence' || !transcript.trim()) {
      // §4.4-৪: খালি ট্রান্সক্রিপ্ট = স্পষ্ট কথাই নেই
      verdict = 'fail';
      notes.push('ASR কোনো কথা শনাক্ত করতে পারেনি — অডিওতে স্পষ্ট কথা নেই।');
    } else if (spec.language === 'bn' && similarity === 0) {
      // B-F04(গ): bn-রায়ে সাদৃশ্য-মান এখন ব্যবহৃত — শূন্য মিল = ব্যর্থ
      verdict = 'fail';
      notes.push('ট্রান্সক্রিপ্টের সাথে মূল স্ক্রিপ্টের কোনো মিল নেই (সাদৃশ্য ০) — সম্ভবত সঠিক বাংলা পাঠ হয়নি।');
    }
    if (verdict !== 'fail' && spec.language === 'bn') {
      // bn + ASR-পথে ঢুকলে কণ্ঠটি অবশ্যই z-ai (bn+Edge নকশা-অনুযায়ী ASR-কল বাদ) —
      // সৎ দাবিহীনতার নোট থাকবেই
      notes.push('z-ai কণ্ঠ বাংলা-প্রশিক্ষিত নয় — উচ্চারণ নিশ্চিত করা যায় না; প্রিভিউ শুনে নিশ্চিত করুন।');
    }
    if (verdict !== 'fail' && spec.language === 'en') {
      // B-F05 থ্রেশহোল্ড-যুক্তিসংগতি (§4.4: "কোনো score threshold বানালে তার
      // rationale ও validation evidence লিখবে"):
      //  - সাদৃশ্য (Jaccard×trigram) একা যথেষ্ট নয় — ২০২৬-১০-১৬-এর প্রকৃত
      //    রানে রোমানীকৃত-বাংলা ট্রান্সক্রিপ্ট ("Shubhoh bioya no tan bochar
      //    shukho…") সাদৃশ্য ০.৫৭-তে "pass" হয়ে গিয়েছিল (DB: speech-en-tongtong)।
      //  - তাই এখন দুটি স্বাধীন শর্ত: সাংখ্যিক সাদৃশ্য ≥ ০.৫ **এবং** স্ক্রিপ্টের
      //    (≥২-অক্ষর) ইংরেজি টোকেনের ≥৫০% ট্রান্সক্রিপ্টে উপস্থিত।
      //  - যাচাই-ভিত্তি: tests/fixtures/language/defect-a-transcripts.json-এর
      //    দুটি প্রকৃত ডিবি-ট্রান্সক্রিপ্ট — en/tongtong-টি সাদৃশ্য ~০.৫৭ হলেও
      //    শব্দ-আবৃত্তি ~০.৩৬ (<০.৫), তাই পাস করতে পারে না।
      const coverage = enTokenCoverage(spec.script, transcript);
      const coverageRatio = coverage.total > 0 ? coverage.covered / coverage.total : null;
      if (similarity >= 0.5 && detectedLanguage === 'en' && coverageRatio !== null && coverageRatio >= 0.5) {
        verdict = 'pass';
        notes.push('ASR রাউন্ড-ট্রিপ সাদৃশ্য ও শব্দ-আবৃত্তি দুটোই যথেষ্ট — ইংরেজি কথা নিশ্চিত।');
      } else if (similarity >= 0.5 && detectedLanguage === 'en') {
        verdict = 'warn';
        notes.push(
          coverageRatio === null
            ? 'সাদৃশ্য যথেষ্ট কিন্তু স্ক্রিপ্টে যাচাইযোগ্য ইংরেজি শব্দ-সেট নেই (রোমানীকৃত/ভিন্ন-লিপি স্ক্রিপ্ট?) — প্রিভিউ শুনে নিশ্চিত করুন।'
            : `সাদৃশ্য যথেষ্ট কিন্তু স্ক্রিপ্টের ইংরেজি শব্দের অর্ধেকও ট্রান্সক্রিপ্টে নেই (${coverage.covered}/${coverage.total}) — প্রিভিউ শুনে নিশ্চিত করুন।`
        );
      } else if (similarity >= 0.25) {
        verdict = 'warn';
        notes.push(`ASR সাদৃশ্য মাঝারি (${Math.round(similarity * 100)}%) — প্রিভিউ শুনে নিশ্চিত করুন।`);
      } else {
        verdict = 'fail';
        notes.push('ASR ট্রান্সক্রিপ্ট মূল স্ক্রিপ্টের সাথে মিলছে না — সম্ভবত সঠিক ইংরেজি পাঠ হয়নি।');
      }
    }
  } else if (durationSec > expectedSec * 3) {
    verdict = 'fail';
    notes.push('অডিওর দৈর্ঘ্য অস্বাভাবিক দীর্ঘ — কণ্ঠটি স্ক্রিপ্ট সঠিকভাবে পড়তে পারেনি।');
  } else if (!durationOk) {
    verdict = 'warn';
    notes.push('দৈর্ঘ্য প্রত্যাশার সীমার বাইরে — প্রিভিউ শুনে নিশ্চিত করুন।');
  } else if (spec.language === 'bn' && edgeVoice) {
    // বাংলা + Edge-নিউরাল: কণ্ঠই বাংলা-প্রশিক্ষিত — দৈর্ঘ্য-সুস্থ হলে রায় যাচাইকৃত
    verdict = 'pass';
    notes.push(
      `বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ (${voice}) — দেশীয় উচ্চারণ; দৈর্ঘ্য-যাচাই স্বাভাবিক (${durationSec.toFixed(1)} সে.)।`
    );
  } else if (asrError) {
    verdict = 'warn';
    notes.push(`ASR ব্যাক-চেক চালানো যায়নি (${asrError}) — প্রিভিউ শুনে যাচাই করুন।`);
  } else {
    // বাংলা + z-ai কণ্ঠ — bn-চেইনে এখন নেই (RC-1), কিন্তু যাচাই-যন্ত্র
    // প্রতিরোধ-স্তর হিসেবে সশস্ত্র (B-F04): ভুল-ভাষা/আবর্জনা ট্রান্সক্রিপ্ট
    // আর "warn" হিসেবে পাশ কাটাতে পারে না।
    verdict = 'warn';
    notes.push('z-ai কণ্ঠ বাংলা-প্রশিক্ষিত নয় — উচ্চারণ নিশ্চিত করা যায় না; প্রিভিউ শুনে নিশ্চিত করুন।');
  }

  if (verdict !== 'fail' && asrUseful && !asrError && transcript.trim()) {
    if (spec.language === 'bn' && detectedLanguage === 'bn') {
      notes.push('ASR ট্রান্সক্রিপ্টে বাংলা অক্ষর পাওয়া গেছে — ভালো লক্ষণ।');
    }
    // আংশিক ট্রান্সক্রিপ্ট (§4.4-৪: খণ্ডিত পাঠের সংকেত) — জোরেশ নোট
    const scriptWords = (spec.script.trim().match(/\S+/g) ?? []).length;
    const transcriptWords = (transcript.trim().match(/\S+/g) ?? []).length;
    if (transcriptWords > 0 && scriptWords >= 4 && transcriptWords / scriptWords < 0.4) {
      notes.push(`ট্রান্সক্রিপ্ট স্ক্রিপ্টের কেবল অংশমাত্র (${transcriptWords}/${scriptWords} শব্দ) — খণ্ডিত পাঠ হতে পারে।`);
    }
  }

  if (quality?.peakDb != null && quality.peakDb > -0.1) {
    notes.push('সতর্কতা: অডিও পিক প্রায় ০ dB — সম্ভাব্য ক্লিপিং।');
  }
  const longSilence = silenceRanges.find(r => r.end - r.start > 1.5);
  if (longSilence) {
    notes.push(`দীর্ঘ নীরব অংশ: ${longSilence.start.toFixed(1)}–${longSilence.end.toFixed(1)} সে.`);
  }

  const result: SpeechVerification = {
    voice,
    requestedVoice,
    actualVoice: voice,
    engine,
    locale: voiceCapabilityOf(voice)?.locale,
    requestedLocale: spec.locale,
    language: spec.language,
    transcript,
    detectedLanguage,
    similarity: Math.round(similarity * 100) / 100,
    durationSec: Math.round(durationSec * 10) / 10,
    expectedSec: Math.round(expectedSec * 10) / 10,
    durationOk,
    peakDb: quality?.peakDb,
    silenceRanges,
    verdict,
    notes,
  };

  // B-F07: প্রতি-কণ্ঠ যাচাই-রেকর্ড — storage/voice-verification.json-এ
  // (best-effort; রেকর্ড-লেখা কখনো যাচাই-ফলাফলকে ব্যর্থ করবে না)
  await recordVoiceVerification({
    voice,
    engine,
    language: spec.language,
    verdict,
    transcript: transcript.slice(0, 200),
    similarity: result.similarity,
    detectedLanguage: String(detectedLanguage),
    durationSec: result.durationSec,
    expectedSec: result.expectedSec,
    note: notes[0]?.slice(0, 160),
  });

  return result;
}

/**
 * §২.২-এর সম্পূর্ণ পাইপলাইন:
 * ভাষা শনাক্তকরণ → মিল-যাচাই → কণ্ঠ-নির্বাচন → TTS →
 * প্রযুক্তি-যাচাই → ASR ব্যাক-চেক → রায়; ব্যর্থ হলে পরের প্রার্থী-কণ্ঠ।
 *
 * চুক্তি (R-FIX-1, findings-b §১০):
 *  - চেইনে ঢোকে কেবল অনুরোধকৃত ভাষায়-সক্ষম কণ্ঠ (ক্ষমতা-ট্যাগ, RC-1) —
 *    ভাষা-ভাঙা নীরব ফলব্যাক সংজ্ঞাগতভাবে অসম্ভব।
 *  - কোনো সক্ষম কণ্ঠই পৌঁছানো না গেলে টাইপড VOICE_UNAVAILABLE ব্যর্থতা
 *    (§4.2-এর হুবহু বার্তা) — ভান-সাফল্য নয়।
 *  - সব প্রার্থী যাচাইে ব্যর্থ হলে টাইপড VERIFICATION_FAILED ব্যর্থতা
 *    (RC-2/B-F02) — ব্যর্থ অডিও ফেরত দেওয়া হয় না; শুধু সত্যিকারের
 *    "যাচাইকৃত-কিন্তু-নোটসহ" (pass/warn) ফলাফলই ফেরত আসে।
 */
export async function synthesizeVerifiedSpeech(
  spec: AudioJobSpec,
  opts?: { verify?: boolean }
): Promise<SynthesizedSpeech> {
  const verify = opts?.verify !== false;

  // ০. লোকেল-যাচাই (B-F10) — নীরব প্রতিস্থাপন নিষিদ্ধ: অসমর্থিত/ভাষা-বিরোধী
  // লোকেল সৎভাবে প্রত্যাখ্যান করা হয়
  if (spec.locale !== undefined) {
    const valid = spec.language === 'bn' && (spec.locale === 'bn-BD' || spec.locale === 'bn-IN');
    if (!valid) {
      throw new SpeechSynthesisError(
        'UNSUPPORTED_LOCALE',
        `অনুরোধকৃত লোকেল "${spec.locale}" সমর্থিত নয় — বাংলায় শুধু bn-BD / bn-IN লোকেল চালু (${spec.language === 'en' ? 'ইংরেজি অনুরোধে লোকেল-মাত্রা প্রযোজ্য নয়' : '§4.2: নীরব লোকেল-প্রতিস্থাপন নিষিদ্ধ'})।`
      );
    }
  }

  // ১. স্ক্রিপ্টের ভাষা নির্বাচিত ভাষার সাথে মিল আছে কি না
  const det = detectLanguage(spec.script);
  if (det.language === 'unknown') {
    throw new SpeechSynthesisError(
      'LANGUAGE_MISMATCH',
      'স্ক্রিপ্টে বাংলা বা ইংরেজি কোনো অক্ষর পাওয়া যায়নি — ভাষা নির্ধারণ করা যাচ্ছে না।'
    );
  }
  if (det.language !== 'mixed' && det.language !== 'other-script' && det.language !== spec.language) {
    throw new SpeechSynthesisError(
      'LANGUAGE_MISMATCH',
      `ভাষার অসামঞ্জস্য: স্ক্রিপ্টটি ${det.language === 'bn' ? 'বাংলা' : 'ইংরেজি'} লেখায়, কিন্তু নির্বাচিত ভাষা ${spec.language === 'bn' ? 'বাংলা' : 'ইংরেজি'}। সঠিক ভাষা বেছে নিন — ভুল ভাষায় পাঠ করলে অডিও বোঝা যাবে না (§২ নিয়ম)।`
    );
  }

  // ২. কণ্ঠ নির্বাচন (Edge-নিউরাল প্রধান; লোকেল-অনুরোধ থাকলে মিল-লোকেল প্রধান — B-F10)
  const primaryVoice = resolveVoice(spec.language, spec.voiceId, spec.locale);
  const profile = LANGUAGE_PROFILES[spec.language];
  const requestedVoice: SpeechVoice = spec.voiceId ?? primaryVoice;
  const upgradeNote =
    spec.voiceId && spec.voiceId !== primaryVoice
      ? `অনুরোধকৃত কণ্ঠ "${spec.voiceId}" এই ভাষার প্রোফাইলে উপযুক্ত নয় — প্রধান কণ্ঠ "${primaryVoice}" ব্যবহৃত (সদিচ্ছা-আপগ্রেড)।`
      : null;

  let attempts = 0;
  let lastResult: SynthesizedSpeech | null = null;

  // P0-BUG-01 সমাধান (Phase 2): প্রতি-কণ্ঠ কল try/catch-এ; ইঞ্জিন-সচেতন স্কিপ —
  // এক ইঞ্জিন হার্ড-ফেল করলে (যেমন Edge 403) সেই ইঞ্জিনের বাকি কণ্ঠগুলো
  // নষ্ট কল ছাড়াই বাদ পড়ে। R-FIX-1 (RC-1/B-F01) সংযোজন: স্কিপের সাথে
  // **ভাষা-সামঞ্জস্য-যাচাই** — ক্ষমতা-ট্যাগহীন বা ভাষা-অযোগ্য কণ্ঠে
  // চেইন কখনো ঢোকে না (fail-closed)।
  const deadEngines = new Set<'edge' | 'zai'>();
  const engineFailures: string[] = [];
  const engineOf = (voice: string): 'edge' | 'zai' => (isEdgeVoice(voice) ? 'edge' : 'zai');
  /** বর্তমান ফলাফলের আগে যে-ইঞ্জিন-ব্যর্থতাগুলো ঘটেছে — সৎ নোট আকারে */
  const fallbackNotes = (): string[] =>
    engineFailures.map(f => `ইঞ্জিন-ফলব্যাক ব্যবহার হয়েছে — আগের ইঞ্জিন ব্যর্থ (${f})`);

  for (const voice of [primaryVoice, ...profile.voices.filter(v => v !== primaryVoice)]) {
    // RC-1/B-F01: ভাষা-ক্ষমতা-ট্যাগ যাচাই — অনুরোধকৃত ভাষায় সক্ষম না হলে
    // কণ্ঠটি চেইনের প্রার্থীই নয় (ট্যাগহীন = অযোগ্য)। bn-প্রোফাইল এখন কেবল
    // Edge-নিউরাল হলেও এটি প্রতিরোধ-স্তর — ভবিষ্যতে কেউ z-ai কণ্ঠ যোগ
    // করলে নীরব ভাষা-ভাঙা আবার ঢুকতে পারবে না।
    const capability = voiceCapabilityOf(voice);
    if (!capability || !capability.languages.includes(spec.language)) continue;

    if (deadEngines.has(engineOf(voice))) continue; // অচল ইঞ্জিন — কণ্ঠ বাদ

    attempts++;
    // §৪: বাংলা হলে টেক্সট-নর্মালাইজেশন — সংখ্যা/তারিখ/সময় শব্দে।
    // Edge-নিউরাল কণ্ঠে ইংরেজি-ধ্বন্যাত্মক রূপ বাদ (ওরা মিশ্র লেখা সঠিকভাবেই পড়ে);
    // z-ai কণ্ঠে সেটিও চালু। ভাষা-শনাক্তকরণ সবসময় *মূল* স্ক্রিপ্টেই হয়।
    const bnNorm =
      spec.language === 'bn'
        ? normalizeBengaliSpeechText(spec.script, { phoneticEnglish: !isEdgeVoice(voice) })
        : null;
    const speakScript = bnNorm ? bnNorm.text : spec.script;
    const normNote = bnNorm?.changed
      ? `টেক্সট-নর্মালাইজেশন প্রযোজ্য (${bnNorm.adjustments.length}টি সমন্বয়: ${bnNorm.adjustments.slice(0, 3).join('; ')}${bnNorm.adjustments.length > 3 ? '…' : ''})`
      : null;
    // §১১: cachedSynthesizeSpeech — একই (কণ্ঠ+গতি+টেক্সট)-এ পুনরাবৃত্ত কল ডিস্ক-ক্যাশে/ডিডুপ
    let speech: Awaited<ReturnType<typeof cachedSynthesizeSpeech>>;
    try {
      speech = await cachedSynthesizeSpeech(speakScript, voice, spec.speed ?? 1);
    } catch (err) {
      // P0-BUG-01 fix #1: ইঞ্জিন-স্তরের ব্যর্থতা চেইন ভাঙে না — ইঞ্জিন অচল
      // ঘোষিত, ব্যর্থতার সৎ বিবরণ জমা, পরের কণ্ঠ/ইঞ্জিনে এগোনো হয়
      deadEngines.add(engineOf(voice));
      engineFailures.push(
        `${engineOf(voice) === 'edge' ? EDGE_TTS_LABEL : 'z-ai TTS'}: ${
          err instanceof Error ? err.message : String(err)
        }`.slice(0, 160)
      );
      continue;
    }
    const actualEngine = engineOf(voice);
    const actualLocale = capability.locale;
    if (!verify) {
      const quickNotes = ['যাচাই বন্ধ ছিল — প্রিভিউ শুনে নিশ্চিত করুন।', ...fallbackNotes()];
      if (normNote) quickNotes.push(normNote);
      if (upgradeNote) quickNotes.push(upgradeNote);
      // B-F10: লোকেল-বদল কখনো নীরব নয়
      if (spec.locale && actualLocale && actualLocale !== spec.locale) {
        quickNotes.push(
          `অনুরোধকৃত লোকেল ${spec.locale}-এর বদলে ${actualLocale} কণ্ঠ ব্যবহৃত (নির্দিষ্ট কণ্ঠ-অনুরোধ প্রাধান্য পেয়েছে)।`
        );
      }
      return {
        buffer: speech.buffer,
        mimeType: speech.mimeType,
        ext: speech.ext,
        voice,
        requestedVoice,
        engine: actualEngine,
        locale: actualLocale,
        requestedLocale: spec.locale,
        verification: {
          voice,
          requestedVoice,
          actualVoice: voice,
          engine: actualEngine,
          locale: actualLocale,
          requestedLocale: spec.locale,
          language: spec.language,
          transcript: '',
          detectedLanguage: 'unknown',
          similarity: 0,
          durationSec: 0,
          expectedSec: 0,
          durationOk: true,
          silenceRanges: [],
          verdict: 'warn',
          notes: quickNotes,
        },
        attempts,
      };
    }
    // estimateSpeechSec-ভিত্তিক যাচাইও নর্মালাইজড টেক্সটে (দৈর্ঘ্য-প্রত্যাশা যথার্থ থাকে)
    const verification = await verifySpeechBuffer(
      speech.buffer,
      speech.ext,
      { ...spec, voiceId: voice, script: speakScript },
      voice,
      requestedVoice
    );
    if (normNote) verification.notes.push(normNote);
    for (const note of fallbackNotes()) verification.notes.push(note);
    if (upgradeNote) verification.notes.push(upgradeNote);
    // B-F10: লোকেল-বদলের সৎ নোট (নীরব ক্রস-ডায়ালেক্ট নিষিদ্ধ)
    if (spec.locale && verification.locale && verification.locale !== spec.locale) {
      verification.notes.push(
        `অনুরোধকৃত লোকেল ${spec.locale}-এর বদলে ${verification.locale} কণ্ঠ ব্যবহৃত — মিল-লোকেল কণ্ঠ পাওয়া যায়নি / নির্দিষ্ট কণ্ঠ-অনুরোধ প্রাধান্য পেয়েছে।`
      );
    }
    lastResult = {
      buffer: speech.buffer,
      mimeType: speech.mimeType,
      ext: speech.ext,
      voice,
      requestedVoice,
      engine: actualEngine,
      locale: actualLocale,
      requestedLocale: spec.locale,
      verification,
      attempts,
    };
    if (verification.verdict !== 'fail') {
      // B-F05: ইঞ্জিন-ফলব্যাকের পরে পাওয়া ফল সর্বোচ্চ "warn" — "pass" দাবি
      // অসৎ (প্রকৃত রানে speech-en-tongtong ফলব্যাক-নোটসহ "pass" হয়েছিল)
      if (verification.verdict === 'pass' && engineFailures.length > 0) {
        verification.verdict = 'warn';
        verification.notes.push(
          'ইঞ্জিন-ফলব্যাকের পরে পাওয়া ফল — রায় সর্বোচ্চ "সতর্কতা" (B-F05): প্রিভিউ শুনে নিশ্চিত করুন।'
        );
      }
      return lastResult;
    }
    // প্রার্থী যাচাইে ব্যর্থ — চেইনের পরের কণ্ঠ (তালিকা ছোট ও বাউন্ডেড)
  }

  if (!lastResult) {
    // কোনো প্রার্থীই অডিও দিতে পারেনি। সৎ শ্রেণি-বিভাজন (B-F03):
    // অনুরোধকৃত ভাষায়-সক্ষম কণ্ঠ কোনোটিই কি পৌঁছানো যাচ্ছে না?
    const capableVoices = profile.voices.filter(v => voiceCapabilityOf(v)?.languages.includes(spec.language));
    const reachable = capableVoices.filter(v => !deadEngines.has(engineOf(v)));
    if (reachable.length === 0) {
      const detail = engineFailures.join(' | ').slice(0, 200);
      throw new SpeechSynthesisError(
        'VOICE_UNAVAILABLE',
        spec.language === 'bn'
          ? // §4.2-এর হুবহু বার্তা — ব্যবহারকারীকে সৎভাবে জানানো হয়
            `VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale. (বাংলা-প্রশিক্ষিত কণ্ঠগুলো — Microsoft Edge-নিউরাল bn-BD/bn-IN — এই মুহূর্তে পৌঁছানো যাচ্ছে না${detail ? `: ${detail}` : ''}; z-ai কণ্ঠ বাংলা পড়তে পারে না বলে ভুল-ভাষার নীরব ফলব্যাক নিষিদ্ধ — §৪.২)`
          : `VOICE_UNAVAILABLE: এই মুহূর্তে কোনো যাচাইকৃত ইংরেজি কণ্ঠই পৌঁছানো যাচ্ছে না — সব TTS ইঞ্জিন অচল${detail ? ` (${detail})` : ''}`,
        { attempts }
      );
    }
    // সক্ষম কণ্ঠ ছিল কিন্তু কোনো কলই হয়নি — কাঠামোগত অসম্ভব অবস্থার সৎ ব্যর্থতা
    throw new Error(
      engineFailures.length > 0
        ? `কণ্ঠ সংশ্লেষণ ব্যর্থ — সব TTS ইঞ্জিন অচল (${engineFailures.join(' | ').slice(0, 240)})`
        : 'কণ্ঠ সংশ্লেষণ ব্যর্থ হয়েছে'
    );
  }

  // RC-2/B-F02: চেইনের সব প্রার্থীই যাচাইে ব্যর্থ — ব্যর্থ অডিও ফেরত দেওয়া হয় না;
  // টাইপড ব্যর্থতা পাইপলাইনকে বিদ্যমান TTS-throw-পথে (সাবটাইটেল-কেবল + সৎ নোট)
  // রাউট করার সুযোগ দেয়
  const failing = lastResult.verification;
  throw new SpeechSynthesisError(
    'VERIFICATION_FAILED',
    `VERIFICATION_FAILED: চেইনের সব ${attempts}টি প্রার্থী কণ্ঠই ভাষা/প্রযুক্তি-যাচাইে ব্যর্থ — অডিও গ্রহণযোগ্য নয় (শেষ কণ্ঠ ${lastResult.voice}: ${failing.notes[0] ?? 'রায় ব্যর্থ'})`,
    { lastVerification: failing, attempts }
  );
}

/** রায়ের বাংলা লেবেল (UI-তে ব্যবহার) */
export function verdictLabel(verdict: SpeechVerification['verdict']): string {
  switch (verdict) {
    case 'pass':
      return 'যাচাইকৃত';
    case 'warn':
      return 'সতর্কতা — শুনে নিশ্চিত করুন';
    case 'fail':
      return 'ব্যর্থ';
  }
}
