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
import type { SpeechLocale, SpeechLanguage } from '@/lib/types';
import { normalizeBengaliSpeechText } from './bn-text-normalizer';
import { isRateLimitErrorText } from '../retry';
import { isEdgeVoice, EDGE_TTS_LABEL, recordVoiceVerification, type EdgeVoiceId } from './edge_tts';
import { isGoogVoice, GOOGLE_TTS_LABEL, GOOGLE_TTS_VOICE } from './google_tts';

// শেয়ার্ড চুক্তির উৎস (types.ts) থেকে লোকেল/ভাষা-ধরন পুনঃরপ্তানি (B-F10 + PART C)
export type { SpeechLocale, SpeechLanguage };

// ------------------------------------------------------------
// §২.১ AudioJobSpec
// ------------------------------------------------------------

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
  /** অনুরোধকৃত ভাষা এই সিস্টেমে সমর্থিত নয় (C2/D-3 — নীরব ভাষা-বদল নিষিদ্ধ) */
  | 'LANGUAGE_UNSUPPORTED'
  /** কোনো যাচাইকৃত ভাষা-সক্ষম কণ্ঠই পৌঁছানো যায়নি (§4.2-এর হুবহু বার্তা) */
  | 'VOICE_UNAVAILABLE'
  /** চেইনের সব প্রার্থীই ভাষা-যাচাইে ব্যর্থ — অডিও গ্রহণযোগ্য নয় (RC-2) */
  | 'VERIFICATION_FAILED'
  /** অনুরোধকৃত লোকেল সমর্থিত নয় / ভাষার সাথে মেলে না (B-F10 — নীরব প্রতিস্থাপন নিষিদ্ধ) */
  | 'UNSUPPORTED_LOCALE'
  // ---- C2 ত্রুটি-শ্রেণিবিন্যাস (PART C master-prompt) — ইঞ্জিন-স্তর ----
  /** প্রোভাইডার প্রমাণীকরণ ব্যর্থ (HTTP 401/403) */
  | 'AUTH_FAILED'
  /** রেট-লিমিট/429 — সীমিত পুনর্চেষ্টার পরেও */
  | 'RATE_LIMITED'
  /** প্রোভাইডার টাইমআউট */
  | 'PROVIDER_TIMEOUT'
  /** নেটওয়ার্ক-স্তরের ব্যর্থতা (DNS/সংযোগ/সকেট) */
  | 'NETWORK_ERROR'
  // ---- C2/B2 — মিডিয়া-যাচাই শ্রেণি ----
  /** ফাইল পার্স/ডিকোড করা যায়নি — ভাঙা/করাপ্ট অডিও */
  | 'INVALID_AUDIO'
  /** অডিও কার্যত সম্পূর্ণ নীরব — স্পষ্ট কথা নেই (D-2) */
  | 'SILENCE_DETECTED'
  /** ASR ব্যাক-চেক ভাষা/বিষয়বস্তু মেলেনি (C2-এর সূক্ষ্ম শ্রেণি; চেইন-স্তরের VERIFICATION_FAILED-এর পরিপূরক) */
  | 'ASR_VERIFICATION_FAILED';

/**
 * প্রতি-যাচাই কাঠামোবদ্ধ ব্যর্থতার কারণ (B2: "structured failure reasons,
 * not just 'false'") — রায় 'fail' হলে প্রথম/প্রধান কারণটি এখানে টাইপড
 * থাকে; UI/রেকর্ড/রিপোর্ট এটি ব্যবহার করে।
 */
export type SpeechFailureCode = SpeechErrorCode;

/**
 * ইঞ্জিন-ব্যর্থতার বার্তা → C2-শ্রেণি (synthesizeVerifiedSpeech-এর
 * ফলব্যাক-নোট ও exhaustion-বার্তায় টাইপড কারণ জুড়ে দেওয়ার জন্য)।
 * শ্রেণি-অনিশ্চিত হলে null — কখনো বানানো শ্রেণি নয়।
 */
function classifyEngineFailure(err: unknown): SpeechErrorCode | null {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/\b(401|403)\b/.test(msg)) return 'AUTH_FAILED';
  if (isRateLimitErrorText(msg)) return 'RATE_LIMITED';
  if (/timeout|timed?[- ]?out|etimedout|deadline/i.test(msg)) return 'PROVIDER_TIMEOUT';
  if (/network|enotfound|econnrefused|econnreset|epipe|fetch failed|socket|wss|dns/i.test(msg))
    return 'NETWORK_ERROR';
  return null;
}

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
  /**
   * (C1) এই পরিবেশে ক্ষমতার সৎ অবস্থা:
   *  - 'live'       = লাইভ-রাউন্ড-ট্রিপ প্রমাণ আছে (en: ২০২৬-১০-১৭ ASR-রাউন্ড-ট্রিপ পাস)
   *  - 'attempted'  = লাইভ-কল চেষ্টা হয়েছে, প্রোভাইডার-পার্শ্ব ব্যর্থতা (bn: Edge-403)
   *  - 'unattempted'= রাউটিং-সমর্থিত কিন্তু এই পরিবেশে কখনো ডাকাই হয়নি (hi/ur/zh)
   * "কী-কনফিগার্ড" কখনোই "ফিচার-উপলব্ধ"-এর সমান নয়।
   */
  environmentVerification: 'live' | 'attempted' | 'unattempted';
  notes: string[];
}

/** একটি কণ্ঠের যাচাইকৃত ক্ষমতা-ঘোষণা (B-F01) */
export interface VoiceCapability {
  /** যে ইঞ্জিনে কণ্ঠটি বাস করে (LF-0: 'goog' = Google-Translate TTS) */
  engine: 'edge' | 'zai' | 'goog';
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

/** কণ্ঠ কোন ইঞ্জিনের — Edge-নিউরাল নাম হলে 'edge', Google-নাম 'goog', নয়তো z-ai */
export function engineOfVoice(voice: string): 'edge' | 'zai' | 'goog' {
  if (isEdgeVoice(voice)) return 'edge';
  if (isGoogVoice(voice)) return 'goog';
  return 'zai';
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
    voices: ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural', 'bn-IN-TanishaaNeural', 'bn-IN-BashkarNeural', GOOGLE_TTS_VOICE],
    voiceCapabilities: {
      'bn-BD-NabanitaNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-BD' },
      'bn-BD-PradeepNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-BD' },
      'bn-IN-TanishaaNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-IN' },
      'bn-IN-BashkarNeural': { engine: 'edge', languages: ['bn'], locale: 'bn-IN' },
      // LF-0 (২০২৬-১০-১৭ লাইভ-প্রোব-যাচাইকৃত): Google-Translate TTS এই পরিবেশে
      // প্রকৃত বাংলা উচ্চারণ দেয় (সঠিক দৈর্ঘ্য + RMS + ASR-সেম্যান্টিক-রাউন্ড-ট্রিপ)।
      // চেইনের শেষ প্রার্থী — Edge-নিউরাল (bn-BD/bn-IN) সব অচল হলে সৎ ফলব্যাক।
      // সীমা: অপ্রাতিষ্ঠানিক endpoint (SLA নেই), একক কণ্ঠ (লিঙ্গ/দেশীয়-উচ্চারণ
      // পার্থক্য নেই), গতি>১ অসমর্থিত, কেবল কথা (গান নয়)।
      [GOOGLE_TTS_VOICE]: { engine: 'goog', languages: ['bn'] },
    },
    nativeSupport: 'verified',
    asrSupport: 'weak',
    environmentVerification: 'live',
    notes: [
      `প্রধান কণ্ঠগুলো Microsoft-এর বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ (bn-BD: নবনীতা/প্রদীপ; bn-IN: তানিশা/ভাস্কর) — দেশীয় উচ্চারণ (${EDGE_TTS_LABEL})।`,
      `এই পরিবেশে Edge-403 হলে সৎ ফলব্যাক: ${GOOGLE_TTS_LABEL} — ২০২৬-১০-১৭-এ লাইভ-যাচাইকৃত বাংলা কথার কণ্ঠ (docs/audit/latest-fix/baseline-report.md §৩.৩)। একক কণ্ঠ, লিঙ্গ/bn-BD-bn-IN উচ্চারণ-পার্থক্য ও গতি-নিয়ন্ত্রণ নেই — ফলব্যাক-নোটসহ জানানো হয়।`,
      'z-ai কণ্ঠ (jam/douji) বাংলা-প্রশিক্ষিত নয় — ২০২৬-১০-১৬-এর রানে চীনা-আবর্জনা প্রমাণিত; তাই bn-চেইনে আর নেই। Edge+Google উভয় অচল হলে সৎ ফলাফল = VOICE_UNAVAILABLE (§৪.২)।',
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
    environmentVerification: 'live',
    notes: [
      `প্রধান কণ্ঠগুলো Microsoft-নিউরাল (আরিয়া/গাই/সোনিয়া); z-ai jam/tongtong/kazi/xiaochen ইংরেজি-ফলব্যাক (${EDGE_TTS_LABEL}-অচল হলে)।`,
      'ASR ইংরেজি ভালো বোঝে — রাউন্ড-ট্রিপ সাদৃশ্য + শব্দ-আবৃত্তি-যাচাই কার্যকর (B-F05: সাদৃশ্য একা প্রমাণ নয়)।',
    ],
  },
  // ---- PART C: hi/ur/zh — রাউটিং-সমর্থিত, সৎ-UNVERIFIED ক্ষমতা ----
  hi: {
    code: 'hi',
    name: 'হিন্দি',
    voices: ['hi-IN-SwaraNeural', 'hi-IN-MadhurNeural'],
    voiceCapabilities: {
      'hi-IN-SwaraNeural': { engine: 'edge', languages: ['hi'], locale: 'hi-IN' },
      'hi-IN-MadhurNeural': { engine: 'edge', languages: ['hi'], locale: 'hi-IN' },
    },
    nativeSupport: 'none',
    asrSupport: 'none',
    environmentVerification: 'unattempted',
    notes: [
      `হিন্দি-প্রশিক্ষিত Edge-নিউরাল কণ্ঠ (স্বরা/মধুর, hi-IN) — মাইক্রোসফট-ক্যাটালগ-নথিভুক্ত; এই পরিবেশে এখনো লাইভ-যাচাই হয়নি (UNVERIFIED — C1)।`,
      'z-ai কণ্ঠ হিন্দি-সক্ষম প্রমাণিত নয় — নীরব ভাষা-ভাঙা ফলব্যাক নিষিদ্ধ; Edge অচল হলে সৎ ফলাফল = VOICE_UNAVAILABLE।',
    ],
  },
  ur: {
    code: 'ur',
    name: 'উর্দু',
    voices: ['ur-PK-UzmaNeural', 'ur-PK-AsadNeural'],
    voiceCapabilities: {
      'ur-PK-UzmaNeural': { engine: 'edge', languages: ['ur'], locale: 'ur-PK' },
      'ur-PK-AsadNeural': { engine: 'edge', languages: ['ur'], locale: 'ur-PK' },
    },
    nativeSupport: 'none',
    asrSupport: 'none',
    environmentVerification: 'unattempted',
    notes: [
      'উর্দু-প্রশিক্ষিত Edge-নিউরাল কণ্ঠ (উজমা/আসাদ, ur-PK) — মাইক্রোসফট-ক্যাটালগ-নথিভুক্ত; এই পরিবেশে এখনো লাইভ-যাচাই হয়নি (UNVERIFIED — C1)।',
      'লিপি-সতর্কতা: পার্সো-আরবি লিপি থেকে উর্দু বনাম অন্য আরবি-লিপির ভাষা নিশ্চিতভাবে আলাদা করা যায় না — অনুরোধকৃত-ভাষার মেটাডেটার সাথে মিলিয়েই যাচাই (মাস্টার-প্রম্পট B3)।',
    ],
  },
  zh: {
    code: 'zh',
    name: 'চীনা',
    voices: ['zh-CN-XiaoxiaoNeural', 'zh-CN-YunxiNeural', 'zh-HK-HiuMaanNeural', 'zh-TW-HsiaoChenNeural'],
    voiceCapabilities: {
      'zh-CN-XiaoxiaoNeural': { engine: 'edge', languages: ['zh'], locale: 'zh-CN' },
      'zh-CN-YunxiNeural': { engine: 'edge', languages: ['zh'], locale: 'zh-CN' },
      'zh-HK-HiuMaanNeural': { engine: 'edge', languages: ['zh'], locale: 'zh-HK' },
      'zh-TW-HsiaoChenNeural': { engine: 'edge', languages: ['zh'], locale: 'zh-TW' },
    },
    nativeSupport: 'none',
    asrSupport: 'none',
    environmentVerification: 'unattempted',
    notes: [
      'চীনা Edge-নিউরাল কণ্ঠ — সরলীকৃত ম্যান্ডারিন zh-CN (শিয়াওশিয়াও/ইউনশি), ক্যান্টনিজ zh-HK (হিউমান), প্রথাগত ম্যান্ডারিন zh-TW (শিয়াওচেন); এই পরিবেশে এখনো লাইভ-যাচাই হয়নি (UNVERIFIED — C1)।',
      'Hans/Hant-পার্থক্য লিপি-শনাক্তকরণে নির্ভরযোগ্য নয় — লোকেল-মাত্রা (zh-CN/zh-TW/zh-HK) সেই নির্বাচন বহন করে; প্রতিটি কণ্ঠের লেবেলে রূপভেদ স্পষ্ট।',
      'z-ai SDK-র কণ্ঠগুলো চীনা-প্রশিক্ষিত হলেও চীনা-সক্ষম ট্যাগ পায় না — লাইভ-যাচাইকৃত প্রমাণ ছাড়া দাবি অসৎ (C1); Edge অচল হলে সৎ VOICE_UNAVAILABLE।',
    ],
  },
};

// ------------------------------------------------------------
// স্ক্রিপ্ট-ভিত্তিক ভাষা শনাক্তকরণ
// ------------------------------------------------------------

export type DetectedScriptLanguage = SpeechLanguage | 'ar-script' | 'mixed' | 'unknown' | 'other-script';

export interface LanguageDetection {
  language: DetectedScriptLanguage;
  confidence: number; // 0–1
  bnRatio: number;
  latinRatio: number;
  /** বাংলা/লাতিন বাদে অন্য সব লিপির অক্ষর-অনুপাত (CJK/দেবনাগরী/আরবি…) */
  otherScriptRatio: number;
  /** দেবনাগরী-অক্ষর অনুপাত (হিন্দি-লিপি; PART C) */
  devaRatio: number;
  /** পার্সো-আরবি অক্ষর অনুপাত (উর্দু/আরবি লিপি — লিপি দেখে ভাষা নির্ধারণ
   *  �যায় না, তাই শ্রেণি-নাম 'ar-script'; উর্দু-অনুরোধেই কেবল সামঞ্জস্যপূর্ণ) */
  arabicRatio: number;
  /** CJK-অক্ষর অনুপাত (চীনা; Hans/Hant আলাদা করা নির্ভরযোগ্য নয় —
   *  লোকেল-মাত্রা zh-CN/zh-TW/zh-HK-ই সেই পার্থক্য বহন করে) */
  cjkRatio: number;
}

/**
 * লেখার অক্ষর-অনুপাত থেকে ভাষা শনাক্তকরণ।
 * বাংলা ইউনিকোড: 0980–09FF। B-F04-হার্ডেনিং: CJK-শ্রেণির লিপি এখন
 * *দৃশ্যমান* — প্রকৃত রানের চীনা-আবর্জনা ট্রান্সক্রিপ্ট ("可真的，可真的，
 * 踢踢踢…") পুরোনো যাচাইকারীর চোখে "en" হয়ে যেত (মোট গণনাতেই ছিল না)।
 * এখন অন্য-লিপির অক্ষর ২৫% ছাড়ালে ভাষা = 'other-script'।
 */
export function detectLanguage(text: string, opts?: { recognize?: readonly string[] }): LanguageDetection {
  const t = text ?? '';
  const bn = (t.match(/[\u0980-\u09FF]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  // PART C লিপি-পরিবার: দেবনাগরী (হিন্দি), পার্সো-আরবি (উর্দু/আরবি), CJK (চীনা)
  const deva = (t.match(/[\u0900-\u097F]/g) ?? []).length;
  const arabic = (t.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) ?? []).length;
  const cjk = (t.match(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g) ?? []).length;
  const allLetters = (t.match(/\p{L}/gu) ?? []).length;
  // সতর্কতা (REG-20a-শোধন): স্বীকৃত-কিন্তু-এই-প্রসঙ্গে-অচ্ছেদিত লিপি-পরিবারও
  // প্রসঙ্গহীন পথে 'অন্য-লিপি' হিসেবেই গণ্য — নইলে চীনা ট্রান্সক্রিপ্টের
  // ২টি ল্যাতিন অক্ষর পুরোটাকে "en" বানিয়ে দিত (২০২৬-১০-১৭-এর প্রকৃত বাগ)।
  const recFamilies = opts?.recognize ?? [];
  const unseenDeva = recFamilies.includes('hi') ? 0 : deva;
  const unseenArabic = recFamilies.includes('ur') ? 0 : arabic;
  const unseenCjk = recFamilies.includes('zh') ? 0 : cjk;
  // 'অন্য-লিপি' = সত্যিই অজানা লিপি + এই-প্রসঙ্গে-অচ্ছেদিত পরিচিত পরিবার
  const trulyUnknown = Math.max(0, allLetters - bn - latin - deva - arabic - cjk);
  const other = trulyUnknown + unseenDeva + unseenArabic + unseenCjk;
  const otherScriptRatio = allLetters > 0 ? other / allLetters : 0;
  const devaRatio = allLetters > 0 ? deva / allLetters : 0;
  const arabicRatio = allLetters > 0 ? arabic / allLetters : 0;
  const cjkRatio = allLetters > 0 ? cjk / allLetters : 0;
  const total = bn + latin;
  if (total === 0 && other === 0 && deva === 0 && arabic === 0 && cjk === 0) {
    return { language: 'unknown', confidence: 0, bnRatio: 0, latinRatio: 0, otherScriptRatio: 0, devaRatio: 0, arabicRatio: 0, cjkRatio: 0 };
  }
  const bnRatio = total > 0 ? bn / total : 0;
  const latinRatio = total > 0 ? latin / total : 0;
  // C-ব্যাচ (PART C): স্বীকৃত-অনুরোধের প্রসঙ্গে নিজ-লিপি-পরিবার চেনা হয় —
  // কোনো-প্রসঙ্গ-কলে (ট্রান্সক্রিপ্ট-যাচাই) পুরনো চুক্তি অপরিবর্তিত থাকে
  // (bn/en-অনুরোধে চীনা/দেবনাগরী/আরবি = 'other-script' রায় আগের মতোই)।
  const rec = opts?.recognize ?? [];
  if (rec.includes('hi') && devaRatio >= 0.5) {
    return { language: 'hi', confidence: devaRatio, bnRatio, latinRatio, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
  }
  if (rec.includes('ur') && arabicRatio >= 0.5) {
    return { language: 'ar-script', confidence: arabicRatio, bnRatio, latinRatio, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
  }
  if (rec.includes('zh') && cjkRatio >= 0.5) {
    return { language: 'zh', confidence: cjkRatio, bnRatio, latinRatio, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
  }
  if (otherScriptRatio >= 0.25) {
    return { language: 'other-script', confidence: otherScriptRatio, bnRatio, latinRatio, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
  }
  if (bnRatio >= 0.7) return { language: 'bn', confidence: bnRatio, bnRatio, latinRatio, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
  if (latinRatio >= 0.7) return { language: 'en', confidence: latinRatio, bnRatio, latinRatio, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
  if (total === 0) {
    // ২৫%-এর কম অন্য-লিপি কিন্তু বাংলা/লাতিন একেবারেই নেই — এটিও অন্য-লিপি
    return { language: 'other-script', confidence: otherScriptRatio, bnRatio: 0, latinRatio: 0, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
  }
  return { language: 'mixed', confidence: Math.max(bnRatio, latinRatio), bnRatio, latinRatio, otherScriptRatio, devaRatio, arabicRatio, cjkRatio };
}

/** আনুমানিক কথার দৈর্ঘ্য (সেকেন্ডে) — দৈর্ঘ্য-স্বাস্থ্য যাচাইয়ের ভিত্তি */
export function estimateSpeechSec(text: string, language: SpeechLanguage): number {
  const t = (text ?? '').trim();
  if (language === 'zh') {
    // চীনা: শব্দ-বিভাজন নেই — অক্ষর-ভিত্তিক গতি (≈৪.৩ অক্ষর/সে. ম্যান্ডারিন পাঠ)
    const chars = (t.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) ?? []).length || t.length;
    return Math.max(0.8, chars / 4.3);
  }
  const words = t.split(/\s+/).filter(Boolean).length;
  // bn/hi/ur কিছুটা ধীরে পড়া হয়; en দ্রুত
  const wps = language === 'bn' ? 2.0 : language === 'hi' || language === 'ur' ? 2.1 : 2.5;
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
    // পুরোনো z-ai কণ্ঠের সদিচ্ছা-আপগ্রেড বহাল (REG-1d); তবে Google-বাংলা
    // কণ্ঠ (LF-0) স্বীকৃত পছন্দ — ব্যবহারকারী সচেতনভাবে বেছে নিতে পারেন।
    if (language === 'bn' && !isEdgeVoice(pref) && !isGoogVoice(pref)) {
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
  // PART C: প্রোফাইল-চালিত সাধারণায়ন — প্রতিটি ভাষার নিজ Edge-নিউরাল
  // কণ্ঠগুলোই বণ্টনে যায় (bn/en-এর তালিকা হুবহু আগের মতোই থাকে)
  const neural = (language === 'bn' || language === 'en'
    ? language === 'bn'
      ? ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural', 'bn-IN-TanishaaNeural', 'bn-IN-BashkarNeural']
      : ['en-US-AriaNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural', 'en-GB-RyanNeural']
    : LANGUAGE_PROFILES[language].voices.filter(v => isEdgeVoice(v))
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

/** ট্রান্সক্রিপ্ট থেকে শনাক্ত ভাষা (B-F04: 'other-script' শ্রেণিসহ)।
 * 'ar-script' টাইপে আছে কারণ detectLanguage-এর প্রসঙ্গ-কল recognize-চালিত —
 * ট্রান্সক্রিপ্ট-পথ (প্রসঙ্নহীন) কখনো সেটি দেয় না, তবে টাইপ সৎ। */
export function detectTranscriptLanguage(
  transcript: string
): SpeechLanguage | 'ar-script' | 'mixed' | 'unknown' | 'silence' | 'other-script' {
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
  /** প্রকৃত কণ্ঠের ইঞ্জিন (B-F06; LF-0: 'goog' = Google-Translate) */
  engine: 'edge' | 'zai' | 'goog';
  /** প্রকৃত কণ্ঠের লোকেল (Edge-কণ্ঠে; B-F10) */
  locale?: string;
  /** অনুরোধকৃত লোকেল, যদি দেওয়া হয়েছিল (B-F10) */
  requestedLocale?: string;
  /** প্রত্যাশিত ভাষা */
  language: SpeechLanguage;
  /**
   * LF-1 (মাস্টার-প্রম্পট §1.4): ভাষা-যাচাইয়ের সৎ স্ট্যাটাস — verdict-থেকে
   * স্বাধীন মাত্রা। "ভাষা যাচাইকৃত" দাবি কেবল তখনই, যখন প্রকৃত প্রমাণ আছে।
   *  - ASR_VERIFIED: script-preserving ASR রাউন্ড-ট্রিপ মিলেছে (এই পরিবেশে en)
   *  - AUDIO_VALIDATION_ONLY: অডিও-গুণ যাচাইকৃত (ডিকোড/দৈর্ঘ্য/RMS/নীরবতা);
   *    ভাষা-পরিচয় প্রোভাইডার-প্রমাণ/ক্যাটালগ-দাবির ওপর দাঁড়ানো — bn এখন এটাই
   *    (script-preserving বাংলা ASR এই পরিবেশে নেই — ২০২৬-১০-১৭ প্রোব)
   *  - LANGUAGE_UNVERIFIED: যাচাইই চলেনি (verify:false / ASR-ত্রুটি/warn-পথ)
   */
  languageStatus?: 'ASR_VERIFIED' | 'AUDIO_VALIDATION_ONLY' | 'LANGUAGE_UNVERIFIED';
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
  /** RMS (dBFS) — D-2 নীরবতা/শান্ত-অডিও যাচাইয়ের ভিত্তি */
  rmsDb?: number;
  /** মোট স্থানজুড়ে নীরবতার অংশ (0–1) — D-2 */
  silenceCoverage?: number;
  silenceRanges: { start: number; end: number }[];
  /** pass = যন্ত্র-যাচাইকৃত ঠিক; warn = সম্ভাব্য কিন্তু মানব-শ্রবণ দরকার; fail = ব্যর্থ */
  verdict: 'pass' | 'warn' | 'fail';
  /** রায় fail হলে টাইপড কাঠামোবদ্ধ কারণ (B2) — undefined = ব্যর্থ নয় */
  failureCode?: SpeechFailureCode;
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
  /** প্রকৃত ইঞ্জিন (B-F06; LF-0: 'goog' সহ) */
  engine: 'edge' | 'zai' | 'goog';
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
  const googVoice = isGoogVoice(voice);
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

  // ---- D-2 (B2): স্তর-বিভাজিত অডিও-যাচাইয়ের নতুন গেটগুলো ----
  // ক্যালিব্রেশন-প্রমাণ (ffmpeg 7.1.5, 2026-10-17): বিশুদ্ধ ডিজিটাল-নীরবতা →
  // RMS/peak −inf + silencedetect(-45dB) পুরো ফাইল জুড়ে; ffmpeg-sine →
  // peak −১৮dB / RMS −২১dB। শান্ত-কিন্তু-বৈধ কথা (RMS −৪০dB-ওয়ালা ফিসফিস)
  // প্রত্যাখ্যান করা হয় না — কেবল সতর্কতা-নোট (নিচে)।
  const silenceCoveredSec = silenceRanges.reduce((s, r) => s + (r.end - r.start), 0);
  const silenceCoverage = durationSec > 0 ? Math.min(1, silenceCoveredSec / durationSec) : 1;
  const rmsDb = quality?.rmsDb;
  // নীরবতা-রায়: RMS −৫০dB-এর নিচে (বা −∞) = কথা নেই; অথবা স্থায়িত্বের ≥৯০% নীরব
  const audioEffectivelySilent =
    rmsDb === -Infinity || (typeof rmsDb === 'number' && rmsDb < -50) || silenceCoverage >= 0.9;

  // ASR ব্যাক-চেক — কেবল যেখানে অর্থবহ: ইংরেজিতে ASR নির্ভরযোগ্য।
  // বাংলায় ASR script-preserving ট্রান্সক্রিপ্ট দেয় না (২০২৬-১০-১৭ প্রোব:
  // বাংলা কথাকে চীনা অনুবাদে ফেরত দেয়) — তাই bn+Edge/bn+goog ক্ষেত্রে
  // ASR-কল রায়ের ভিত্তি নয়; bn+z-ai প্রতিরোধ-স্তর (B-F04) হিসেবে রয়ে গেছে।
  let transcript = '';
  let asrError = '';
  const asrUseful = spec.language === 'en' || (engine === 'zai' && spec.language === 'bn');
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
  let failureCode: SpeechFailureCode | undefined;
  const failWith = (code: SpeechFailureCode, note: string): 'fail' => {
    if (!failureCode) failureCode = code;
    notes.push(note);
    return 'fail';
  };
  let verdict: SpeechVerification['verdict'];
  if (quality === null) {
    // D-2/B2-স্তর ১: ফাইল অস্তিত্ব/পার্সযোগ্যতা — ffprobe/astats নিজেই
    // ব্যর্থ = ভাঙা/করাপ্ট অডিও (আগে এটি ব্যাখ্যাহীন "দৈর্ঘ্য-কম" ফেল হতো)
    verdict = failWith(
      'INVALID_AUDIO',
      'অডিও-ফাইল পার্স/ডিকোড করা যায়নি — সম্ভবত ভাঙা বা করাপ্ট ফাইল (INVALID_AUDIO)।'
    );
  } else if (buffer.length === 0 || durationSec < Math.max(0.6, expectedSec * 0.35)) {
    verdict = failWith(
      'INVALID_AUDIO',
      'অডিওর দৈর্ঘ্য প্রত্যাশার চেয়ে অনেক কম — স্ক্রিপ্ট সম্পূর্ণ পড়া হয়নি।'
    );
  } else if (audioEffectivelySilent) {
    // D-2/B2-স্তর ৫: নীরবতা-শনাক্তকরণ — যুক্তিসংগত দৈর্ঘ্যের নীরব অডিও
    // আর "pass" হতে পারে না (পুরনো REG-1h এই গর্তটিই লক করেছিল —
    // 2.0s বিশুদ্ধ-নীরবতা "pass" হতো)।
    verdict = failWith(
      'SILENCE_DETECTED',
      `অডিও কার্যত সম্পূর্ণ নীরব (নীরবতা-আবরণ ${Math.round(silenceCoverage * 100)}%, RMS ${
        rmsDb === -Infinity || rmsDb == null ? '−∞' : `${Math.round(rmsDb)}dB`
      }) — স্পষ্ট কথা নেই (SILENCE_DETECTED)।`
    );
  } else if (asrUseful && !asrError) {
    // ট্রান্সক্রিপ্ট-ভিত্তিক কঠোর-ব্যর্থতা — bn ও en উভয় ক্ষেত্রেই প্রযোজ্য
    verdict = 'warn'; // নিচের কোনো শর্ত ধরলে fail হয়ে যাবে
    if (detectedLanguage === 'other-script') {
      // §4.2/B-F04(ক): চীনা/অন্য লিপির আউটপুট = ভাষা-যাচাই ব্যর্থ (প্রকৃত রানের
      // "可真的，可真的，踢踢踢…" ট্রান্সক্রিপ্ট পুরোনো যাচাইকারীর চোখে "en" ছিল)
      verdict = failWith(
        'LANGUAGE_MISMATCH',
        'ট্রান্সক্রিপ্টে বাংলা/ইংরেজি নয় এমন লিপি (যেমন চীনা অক্ষর) — কণ্ঠটি ভুল ভাষায় পড়েছে (§4.2)।'
      );
    }
    const repetition = detectTrivialRepetition(transcript);
    if (repetition.repeated) {
      // B-F04(খ): তুচ্ছ পুনরাবৃত্তি — ASR-আবর্জনা প্রায়ই একই টোকেন ঘোরায়
      verdict = failWith(
        'ASR_VERIFICATION_FAILED',
        `ট্রান্সক্রিপ্টে তুচ্ছ পুনরাবৃত্তি (শীর্ষ টোকেন "${repetition.topToken}" — টোকেনের ${Math.round(repetition.topRatio * 100)}%) — অর্থহীন সিলেবল ঘুরছে।`
      );
    }
    if (detectedLanguage === 'silence' || !transcript.trim()) {
      // §4.4-৪: খালি ট্রান্সক্রিপ্ট = স্পষ্ট কথাই নেই
      verdict = failWith('ASR_VERIFICATION_FAILED', 'ASR কোনো কথা শনাক্ত করতে পারেনি — অডিওতে স্পষ্ট কথা নেই।');
    } else if (spec.language === 'bn' && similarity === 0) {
      // B-F04(গ): bn-রায়ে সাদৃশ্য-মান এখন ব্যবহৃত — শূন্য মিল = ব্যর্থ
      verdict = failWith(
        'ASR_VERIFICATION_FAILED',
        'ট্রান্সক্রিপ্টের সাথে মূল স্ক্রিপ্টের কোনো মিল নেই (সাদৃশ্য ০) — সম্ভবত সঠিক বাংলা পাঠ হয়নি।'
      );
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
        verdict = failWith(
          'ASR_VERIFICATION_FAILED',
          'ASR ট্রান্সক্রিপ্ট মূল স্ক্রিপ্টের সাথে মিলছে না — সম্ভবত সঠিক ইংরেজি পাঠ হয়নি।'
        );
      }
    }
  } else if (durationSec > expectedSec * 3) {
    verdict = failWith(
      'INVALID_AUDIO',
      'অডিওর দৈর্ঘ্য অস্বাভাবিক দীর্ঘ — কণ্ঠটি স্ক্রিপ্ট সঠিকভাবে পড়তে পারেনি।'
    );
  } else if (!durationOk) {
    verdict = 'warn';
    notes.push('দৈর্ঘ্য প্রত্যাশার সীমার বাইরে — প্রিভিউ শুনে নিশ্চিত করুন।');
  } else if ((edgeVoice || googVoice) && spec.language !== 'en') {
    // দেশীয়-ভাষা + Edge-নিউরাল (bn/hi/ur/zh) বা Google-বাংলা কণ্ঠ (LF-0):
    // অডিও-গণ সুস্থ হলে রায় যাচাইকৃত — তবে ভাষা-পরিচয়ের সৎ স্তর আলাদা
    // (languageStatus): Edge = মাইক্রোসফট-ক্যাটালগ-দাবি, goog = লাইভ-প্রোব-প্রমাণ
    // — দুটোই AUDIO_VALIDATION_ONLY (script-preserving বাংলা ASR এই পরিবেশে নেই)।
    verdict = 'pass';
    const langName = LANGUAGE_PROFILES[spec.language].name;
    if (edgeVoice) {
      notes.push(
        `${langName}-প্রশিক্ষিত নিউরাল কণ্ঠ (${voice}) — দেশীয় উচ্চারণ; দৈর্ঘ্য-যাচাই স্বাভাবিক (${durationSec.toFixed(1)} সে.)।`
      );
    } else {
      notes.push(
        `${langName} কথার কণ্ঠ (${GOOGLE_TTS_LABEL}) — প্রোভাইডারটি এই পরিবেশে লাইভ-যাচাইকৃত (২০২৬-১০-১৭ প্রোব: সঠিক দৈর্ঘ্য/RMS + ASR-সেম্যান্টিক-রাউন্ড-ট্রিপ); এই ফাইলে দৈর্ঘ্য/স্তর/নীরবতা-যাচাই স্বাভাবিক (${durationSec.toFixed(1)} সে.)।`
      );
      notes.push(
        'সীমা: অপ্রাতিষ্ঠানিক পরিষেবা (SLA নেই), একক কণ্ঠ (লিঙ্গ/দেশীয়-উচ্চারণ পার্থক্য নেই); ভাষা-পরিচয় script-preserving ASR দিয়ে যাচাই হয়নি (AUDIO_VALIDATION_ONLY, §1.4)।'
      );
    }
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
    // D-2/B2-স্তর ৬: ক্লিপিং — "pass" দাবি ক্লিপ-সন্দেহে সর্বোচ্চ "warn"
    if (verdict === 'pass') {
      verdict = 'warn';
      notes.push('সম্ভাব্য ক্লিপিং-এর কারণে রায় "সতর্কতা"-য় নামানো হলো — প্রিভিউ শুনে নিশ্চিত করুন।');
    }
  }
  // D-2/B2-স্তর ৫-খ: শান্ত-কিন্তু-বৈধ কথা — প্রত্যাখ্যান নয় (ক্যালিব্রেশন:
  // নীরবতা < −৫০dB; শান্ত-ওয়ার্ন < −৩৮dB) — সৎ নোটসহ সতর্কতা-রায়
  if (verdict === 'pass' && typeof rmsDb === 'number' && rmsDb > -Infinity && rmsDb < -38) {
    verdict = 'warn';
    notes.push(`অডিও খুব শান্ত (RMS ${Math.round(rmsDb)}dB) — স্পষ্ট কথা আছে তবে ভলিউম কম; প্রিভিউ শুনে নিশ্চিত করুন।`);
  }
  const longSilence = silenceRanges.find(r => r.end - r.start > 1.5);
  if (longSilence) {
    notes.push(`দীর্ঘ নীরব অংশ: ${longSilence.start.toFixed(1)}–${longSilence.end.toFixed(1)} সে.`);
  }

  // ---- LF-1 (§1.4): ভাষা-যাচাইয়ের সৎ স্ট্যাটাস — verdict-থেকে স্বাধীন ----
  let languageStatus: SpeechVerification['languageStatus'] = 'LANGUAGE_UNVERIFIED';
  if (verdict !== 'fail') {
    if (
      spec.language === 'en' &&
      asrUseful &&
      !asrError &&
      detectedLanguage === 'en' &&
      similarity >= 0.5
    ) {
      languageStatus = 'ASR_VERIFIED';
    } else if ((edgeVoice || googVoice) && spec.language !== 'en') {
      languageStatus = 'AUDIO_VALIDATION_ONLY';
    }
  }

  const result: SpeechVerification = {
    voice,
    requestedVoice,
    actualVoice: voice,
    engine,
    languageStatus,
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
    rmsDb: rmsDb != null && rmsDb !== -Infinity && Number.isFinite(rmsDb) ? rmsDb : undefined,
    silenceCoverage: Math.round(silenceCoverage * 100) / 100,
    silenceRanges,
    verdict,
    failureCode: verdict === 'fail' ? failureCode : undefined,
    notes,
  };

  // B-F07: প্রতি-কণ্ঠ যাচাই-রেকর্ড — storage/voice-verification.json-এ
  // (best-effort; রেকর্ড-লেখা কখনো যাচাই-ফলাফলকে ব্যর্থ করবে না)
  // D-1-নোট: টেস্ট-স্যুট bunfig-preload-এর মাধ্যমে এই পথ টেম্প-ডিরেক্টরিতে
  // রাউট হয় — প্রকৃত ফাইল স্পর্শ হয় না।
  await recordVoiceVerification({
    voice,
    engine,
    language: spec.language,
    verdict,
    failureCode: result.failureCode,
    transcript: transcript.slice(0, 200),
    similarity: result.similarity,
    detectedLanguage: String(detectedLanguage),
    durationSec: result.durationSec,
    expectedSec: result.expectedSec,
    rmsDb: result.rmsDb,
    silenceCoverage: result.silenceCoverage,
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
  // লোকেল সৎভাবে প্রত্যাখ্যান করা হয়। PART C: এখন ডেটা-চালিত — প্রোফাইলের
  // কণ্ঠ-লোকেলগুলোই বৈধ-সেট (bn: bn-BD/bn-IN; hi: hi-IN; ur: ur-PK;
  // zh: zh-CN/zh-HK/zh-TW; en-কণ্ঠে লোকেল-মাত্রা প্রযোজ্য নয়)।
  if (spec.locale !== undefined) {
    const localeProfile = LANGUAGE_PROFILES[spec.language];
    const validLocales = new Set(
      Object.values(localeProfile.voiceCapabilities)
        .map(c => c.locale)
        .filter((l): l is string => !!l)
    );
    if (!validLocales.has(spec.locale)) {
      throw new SpeechSynthesisError(
        'UNSUPPORTED_LOCALE',
        `অনুরোধকৃত লোকেল "${spec.locale}" সমর্থিত নয় — ${localeProfile.name} ভাষায় চালু লোকেল: ${[...validLocales].join(' / ')} (${spec.language === 'en' ? 'ইংরেজি অনুরোধে লোকেল-মাত্রা প্রযোজ্য নয়' : '§4.2: নীরব লোকেল-প্রতিস্থাপন নিষিদ্ধ'})।`
      );
    }
  }

  // ১. স্ক্রিপ্টের ভাষা নির্বাচিত ভাষার সাথে মিল আছে কি না। PART C: অনুরোধকৃত
  // ভাষার প্রসঙ্গে নিজ-লিপি-পরিবার চেনা হয় (recognize) — hi/ur/zh-এর
  // লিপি প্রসঙ্গহীন কলে সংজ্ঞাগতভাবে 'other-script' থাকে।
  const det = detectLanguage(spec.script, { recognize: [spec.language] });
  if (det.language === 'unknown') {
    throw new SpeechSynthesisError(
      'LANGUAGE_MISMATCH',
      'স্ক্রিপ্টে কোনো পরিচিত অক্ষর পাওয়া যায়নি — ভাষা নির্ধারণ করা যাচ্ছে না।'
    );
  }
  // D-3 (B3): অন্য লিপির টেক্সট (চীনা/দেবনাগরী/আরবি/…) বাধ্যতামূলক bn/en
  // সেটিংসে আগে নীরবে ঢুকে যেত — এখন স্পষ্ট প্রত্যাখ্যান। mixed বৈধ
  // (বাংলা-ইংরেজি মিশ্র লেখা), কিন্তু সম্পূর্ণ অন্য লিপি কখনো নয়।
  if (det.language === 'other-script') {
    throw new SpeechSynthesisError(
      'LANGUAGE_MISMATCH',
      `ভাষার অসামঞ্জস্য: স্ক্রিপ্টটি বাংলা বা ইংরেজি কোনোটিরও লিপিতে নয় (শনাক্ত: অন্য লিপি — যেমন চীনা/দেবনাগরী/আরবি), কিন্তু নির্বাচিত ভাষা ${
        spec.language === 'bn' ? 'বাংলা' : 'ইংরেজি'
      }। এই লিপির টেক্সট নির্বাচিত ভাষার কণ্ঠে পড়া যায় না — সঠিক ভাষা/লিপি নিশ্চিত করুন (§২ নিয়ম: নীরব ভাষা-বদল নিষিদ্ধ)।`
    );
  }
  // (B3) লিপি-পরিবার ↔ ভাষার সামঞ্জস্য-মানচিত্র: উর্দুর লিপি-শ্রেণি
  // 'ar-script' (পার্সো-আরবি লিপি থেকে ভাষা নিশ্চিত হওয়া যায় না — কেবল
  // অনুরোধকৃত-ভাষার মেটাডেটার সাথে মিলিয়েই গ্রহণযোগ্য)। mixed কেবল bn/en-এ।
  const SCRIPT_LANGUAGE: Record<SpeechLanguage, DetectedScriptLanguage> = {
    bn: 'bn',
    en: 'en',
    hi: 'hi',
    ur: 'ar-script',
    zh: 'zh',
  };
  const DETECTED_LABEL: Record<string, string> = {
    bn: 'বাংলা',
    en: 'ইংরেজি',
    hi: 'হিন্দি (দেবনাগরী)',
    'ar-script': 'পার্সো-আরবি লিপি (উর্দু/আরবি)',
    zh: 'চীনা',
    mixed: 'মিশ্র বাংলা-ইংরেজি',
  };
  const mixedAllowed = spec.language === 'bn' || spec.language === 'en';
  if (det.language !== SCRIPT_LANGUAGE[spec.language] && !(det.language === 'mixed' && mixedAllowed)) {
    throw new SpeechSynthesisError(
      'LANGUAGE_MISMATCH',
      `ভাষার অসামঞ্জস্য: স্ক্রিপ্টটি ${DETECTED_LABEL[det.language] ?? det.language} লেখায়, কিন্তু নির্বাচিত ভাষা ${LANGUAGE_PROFILES[spec.language].name}। সঠিক ভাষা বেছে নিন — ভুল ভাষায় পাঠ করলে অডিও বোঝা যাবে না (§২ নিয়ম)।`
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
  const deadEngines = new Set<'edge' | 'zai' | 'goog'>();
  const engineFailures: string[] = [];
  const engineOf = (voice: string): 'edge' | 'zai' | 'goog' => engineOfVoice(voice);
  /** ইঞ্জিনের সুস্পষ্ট নাম — ব্যর্থতার সৎ বিবরণে (LF-0: goog-লেবেল) */
  const engineLabel = (e: 'edge' | 'zai' | 'goog'): string =>
    e === 'edge' ? EDGE_TTS_LABEL : e === 'goog' ? GOOGLE_TTS_LABEL : 'z-ai TTS';
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
    // Edge-নিউরাল ও Google-কণ্ঠ বাংলা লিপি সঠিকভাবেই পড়ে (phonetic-ইংরেজি
    // রূপ নয়); কেবল z-ai কণ্ঠের জন্যই ধ্বন্যাত্মক রূপ (ওরা বাংলা লিপি
    // পড়তে পারে না — প্রতিরোধ-স্তর)। ভাষা-শনাক্তকরণ সবসময় *মূল* স্ক্রিপ্টেই হয়।
    const bnNorm =
      spec.language === 'bn'
        ? normalizeBengaliSpeechText(spec.script, { phoneticEnglish: engineOf(voice) === 'zai' })
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
      // ঘোষিত, ব্যর্থতার সৎ বিবরণ জমা, পরের কণ্ঠ/ইঞ্জিনে এগোনো হয়।
      // C2: ব্যর্থতার টাইপড শ্রেণিও জমা থাকে (AUTH_FAILED/RATE_LIMITED/
      // PROVIDER_TIMEOUT/NETWORK_ERROR — শ্রেণি-অনিশ্চিত হলে নোটে শুধু বার্তা)
      const failureCode = classifyEngineFailure(err);
      deadEngines.add(engineOf(voice));
      engineFailures.push(
        `${engineLabel(engineOf(voice))}${
          failureCode ? ` [${failureCode}]` : ''
        }: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160)
      );
      continue;
    }
    const actualEngine = engineOf(voice);
    const actualLocale = capability.locale;
    // LF-0: গুগল-কণ্ঠে গতি>১ অসমর্থিত + লোকেল-নির্দিষ্টতা নেই — সৎ নোট
    const googNotes: string[] = [];
    if (actualEngine === 'goog') {
      if ((spec.speed ?? 1) > 1.001) {
        googNotes.push(`গতি ${spec.speed}× অনুরোধ কিন্তু গুগল-কণ্ঠে গতি-নিয়ন্ত্রণ নেই — স্বাভাবিক গতিতে তৈরি।`);
      }
      if (spec.locale) {
        googNotes.push(`অনুরোধকৃত লোকেল ${spec.locale}-এর নির্দিষ্ট কণ্ঠ অচল/পাওয়া যায়নি — সাধারণ বাংলা কণ্ঠ (Google-অনুবাদ) ব্যবহৃত; bn-BD/bn-IN উচ্চারণ-পার্থক্য এই কণ্ঠে নেই।`);
      }
    }
    if (!verify) {
      const quickNotes = ['যাচাই বন্ধ ছিল — প্রিভিউ শুনে নিশ্চিত করুন।', ...fallbackNotes(), ...googNotes];
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
          languageStatus: 'LANGUAGE_UNVERIFIED',
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
    for (const note of googNotes) verification.notes.push(note);
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
        // রেকর্ড-consistency (D-1-অডিটের পার্শ্ব-অনুসন্ধান): রেকর্ড চূড়ান্ত
        // (ক্যাপ-করা) রায় বহন করবে — রিটার্ন-মান আর সংরক্ষিত রেকর্ড আর
        // কখনো স্ববিরোধী হবে না
        await recordVoiceVerification({
          voice,
          engine: actualEngine,
          language: spec.language,
          verdict: 'warn',
          transcript: verification.transcript.slice(0, 200),
          similarity: verification.similarity,
          detectedLanguage: String(verification.detectedLanguage),
          durationSec: verification.durationSec,
          expectedSec: verification.expectedSec,
          note: 'ইঞ্জিন-ফলব্যাকের পরে রায় সর্বোচ্চ সতর্কতা (B-F05)',
        }).catch(() => {});
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
          ? // §4.2-এর হুবহু বার্তা — ব্যবহারকারীকে সৎভাবে জানানো হয় (LF-0:
            // এখন বাংলার দ্বিতীয় প্রকৃত প্রোভাইডার Google-ও চেইনে — উভয়ই অচল
            // হলেই এই বার্তা)
            `VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale. (বাংলা-প্রশিক্ষিত সব কণ্ঠ — Edge-নিউরাল bn-BD/bn-IN ও Google-Translate-এর বাংলা কণ্ঠ — এই মুহূর্তে পৌঁছানো যাচ্ছে না${detail ? `: ${detail}` : ''}; z-ai কণ্ঠ বাংলা পড়তে পারে না বলে ভুল-ভাষার নীরব ফলব্যাক নিষিদ্ধ — §৪.২)`
          : spec.language === 'en'
            ? `VOICE_UNAVAILABLE: এই মুহূর্তে কোনো যাচাইকৃত ইংরেজি কণ্ঠই পৌঁছানো যাচ্ছে না — সব TTS ইঞ্জিন অচল${detail ? ` (${detail})` : ''}`
            : // PART C: hi/ur/zh — সৎ বার্তা (কণ্ঠ ক্যাটালগে আছে, পৌঁছানো যাচ্ছে না)
              `VOICE_UNAVAILABLE: ${LANGUAGE_PROFILES[spec.language].name} ভাষার কণ্ঠ (Microsoft Edge-নিউরাল) এই মুহূর্তে পৌঁছানো যাচ্ছে না${detail ? `: ${detail}` : ''}; z-ai কণ্ঠ এই ভাষায় সক্ষম-প্রমাণিত নয় বলে ভুল-ভাষার নীরব ফলব্যাক নিষিদ্ধ (§৪.২)। বিকল্প: সাবটাইটেল-কেবল মোড বা ভিন্ন ভাষায় অনুরোধ।`,
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

/** LF-1: ভাষা-যাচাই-স্ট্যাটাসের বাংলা লেবেল (UI-তে ব্যবহার) */
export function languageStatusLabel(status: SpeechVerification['languageStatus'] | undefined): string {
  switch (status) {
    case 'ASR_VERIFIED':
      return 'ভাষা ASR-যাচাইকৃত';
    case 'AUDIO_VALIDATION_ONLY':
      return 'অডিও-যাচাইকৃত · ভাষা অ-যাচাকৃত (script-preserving ASR নেই)';
    case 'LANGUAGE_UNVERIFIED':
      return 'ভাষা অ-যাচাইকৃত';
  }
  return 'ভাষা অ-যাচাইকৃত';
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
