// ============================================================
// Audio Language Controller — নতুন মাস্টার প্ল্যান §২
// (ভাষা শনাক্তকরণ → সমর্থন-যাচাই → সঠিক মডেল/কণ্ঠ নির্বাচন →
//  TTS → প্রযুক্তি-যাচাই → ASR ব্যাক-চেক → রায়)
//
// সততার ভিত্তি (২০২৬-১০-১১-এর প্রকৃত প্রোব-ফলাফল):
//  - কোনো কণ্ঠই বাংলা-প্রশিক্ষিত নয়। jam কণ্ঠে বাংলা লেখা পড়ার
//    সম্ভাব্য দৈর্ঘ্য (১০.১ সে.) পাওয়া গেছে, কিন্তু ASR বাংলা বুঝতে
//    পারে না বলে উচ্চারণ যন্ত্রে নিশ্চিত করা যায় না → রায় 'warn'
//    + মানব-প্রিভিউর নোট। tongtong/chuichui/xiaochen/luodo বাংলা
//    লেখা মাত্র ২.৪–২.৭ সেকেন্ডে "পড়ে ফেলে" (আসলে পড়তে পারে না)
//    → সেগুলো বাংলার জন্য নিষিদ্ধ।
//  - ইংরেজি: jam (ব্রিটিশ) প্রত্যাশিত; ASR ইংরেজি ভালো বোঝে →
//    রাউন্ড-ট্রিপ সাদৃশ্য-যাচাই কার্যকর।
//  - ASR-এর ৩০ সেকেন্ডের সীমা → transcribeBuffer চাঙ্কিং করে।
// ============================================================

import type { TtsVoice } from '../sdk-helpers';
import { transcribeBuffer } from '../sdk-helpers';
// §১১: ব্যবহারকারীর পুনরাবৃত্ত TTS-অনুরোধ ডিস্ক-ক্যাশে+ডিডুপ-পথে — রেট-লিমিট-চাপ কমে
import { cachedSynthesizeSpeech } from '../tts-cache';
import { audioQuality } from '@/lib/media/ffmpeg';
import { normalizeBengaliSpeechText } from './bn-text-normalizer';
import { isEdgeVoice, EDGE_TTS_LABEL, type EdgeVoiceId } from './edge_tts';

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
  script: string;
  voiceId: SpeechVoice;
  outputFormat: 'wav' | 'mp3';
  sampleRate: 24000 | 44100 | 48000;
  speed?: number;
}

// ------------------------------------------------------------
// ভাষা-প্রোফাইল — প্রোব-যাচাইকৃত, সৎ ক্ষমতা-ঘোষণা
// ------------------------------------------------------------

export interface LanguageProfile {
  code: SpeechLanguage;
  name: string; // বাংলা নাম
  /** কণ্ঠ-পছন্দক্রম (প্রথমটা ডিফল্ট) — ২০২৬-১০-১৩ থেকে Edge-নিউরাল প্রধান */
  voices: SpeechVoice[];
  /** এই ভাষার কণ্ঠগুলো প্রশিক্ষিত কি না — সৎ ঘোষণা */
  nativeSupport: 'verified' | 'partial' | 'none';
  /** ASR এই ভাষায় কতটা নির্ভরযোগ্য */
  asrSupport: 'good' | 'weak' | 'none';
  notes: string[];
}

export const LANGUAGE_PROFILES: Record<SpeechLanguage, LanguageProfile> = {
  bn: {
    code: 'bn',
    name: 'বাংলা',
    // ২০২৬-১০-১৩: প্রকৃত বাংলা-প্রশিক্ষিত Microsoft-নিউরাল কণ্ঠ প্রধান —
    // z-ai কণ্ঠে বাংলা পড়ালে "অচেনা দেশি ভাষার" মতো শোনাত (ব্যবহারকারীর প্রত্যক্ষ অভিজ্ঞতা)
    voices: ['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural', 'bn-IN-TanishaaNeural', 'jam', 'douji'],
    nativeSupport: 'verified',
    asrSupport: 'weak',
    notes: [
      `প্রধান কণ্ঠগুলো Microsoft-এর বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ (bn-BD: নবনীতা/প্রদীপ) — দেশীয় উচ্চারণ (${EDGE_TTS_LABEL})।`,
      'z-ai কণ্ঠ (jam/douji) বাংলা-প্রশিক্ষিত নয় — শুধু Edge-নিউরাল অচল থাকলে জরুরি-ফলব্যাক; প্রিভিউ শুনে নিশ্চিত করতে হবে।',
    ],
  },
  en: {
    code: 'en',
    name: 'ইংরেজি',
    voices: ['en-US-AriaNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural', 'jam', 'tongtong', 'kazi', 'xiaochen'],
    nativeSupport: 'verified',
    asrSupport: 'good',
    notes: [
      `প্রধান কণ্ঠগুলো Microsoft-নিউরাল (আরিয়া/গাই/সোনিয়া); z-ai jam ফলব্যাক (${EDGE_TTS_LABEL})।`,
      'ASR ইংরেজি ভালো বোঝে — তৈরি হওয়া অডিওর রাউন্ড-ট্রিপ সাদৃশ্য-যাচাই কার্যকর।',
    ],
  },
};

// ------------------------------------------------------------
// স্ক্রিপ্ট-ভিত্তিক ভাষা শনাক্তকরণ
// ------------------------------------------------------------

export interface LanguageDetection {
  language: SpeechLanguage | 'mixed' | 'unknown';
  confidence: number; // 0–1
  bnRatio: number;
  latinRatio: number;
}

/** লেখার অক্ষর-অনুপাত থেকে ভাষা শনাক্তকরণ (বাংলা ইউনিকোড: 0980–09FF) */
export function detectLanguage(text: string): LanguageDetection {
  const t = text ?? '';
  const bn = (t.match(/[\u0980-\u09FF]/g) ?? []).length;
  const latin = (t.match(/[A-Za-z]/g) ?? []).length;
  const total = bn + latin;
  if (total === 0) return { language: 'unknown', confidence: 0, bnRatio: 0, latinRatio: 0 };
  const bnRatio = bn / total;
  const latinRatio = latin / total;
  if (bnRatio >= 0.7) return { language: 'bn', confidence: bnRatio, bnRatio, latinRatio };
  if (latinRatio >= 0.7) return { language: 'en', confidence: latinRatio, bnRatio, latinRatio };
  return { language: 'mixed', confidence: Math.max(bnRatio, latinRatio), bnRatio, latinRatio };
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
 * ২০২৬-১০-১৩-এর নিয়ম (ব্যবহারকারীর নির্দেশ: "চ্যাটের ভাষায় কথা ও অডিও"):
 * বাংলায় z-ai কণ্ঠ (jam/douji — বাংলা-অপ্রশিক্ষিত, অস্পষ্ট-শ্রবণ) বেছে নেওয়া
 * হলে তা **সদিচ্ছায় আপগ্রেড** হয়ে প্রধান বাংলা নিউরাল কণ্ঠ (নবনীতা) হবে —
 * প্রোফাইলের ফলব্যাক-তালিকায় z-ai কণ্ঠ থাকে শুধু Edge অচল হলে জরুরি-ব্যবহারের
 * জন্য। ইংরেজিতে z-ai jam যথেষ্ট, তাই সেটি অপরিবর্তিত থাকে।
 */
export function resolveVoice(language: SpeechLanguage, preferred?: string): SpeechVoice {
  const profile = LANGUAGE_PROFILES[language];
  if (preferred && (profile.voices as string[]).includes(preferred)) {
    const pref = preferred as SpeechVoice;
    if (language === 'bn' && !isEdgeVoice(pref)) {
      return profile.voices[0]; // নবনীতা (bn-BD নিউরাল) — সদিচ্ছা-আপগ্রেড
    }
    return pref;
  }
  return profile.voices[0];
}

/**
 * একাধিক চরিত্রে আলাদা আলাদা কণ্ঠ বণ্টন (শর্টফিল্মের সংলাপের জন্য)।
 * ভাষার নিউরাল-কণ্ঠগুলো ঘুরিয়ে-ফিরিয়ে বরাদ্দ — দুই চরিত্র একই কণ্ঠে নয়।
 */
export function assignCharacterVoices(names: string[], language: SpeechLanguage): Record<string, SpeechVoice> {
  const neural = language === 'bn'
    ? (['bn-BD-NabanitaNeural', 'bn-BD-PradeepNeural', 'bn-IN-TanishaaNeural', 'bn-IN-BashkarNeural'] as SpeechVoice[])
    : (['en-US-AriaNeural', 'en-US-GuyNeural', 'en-GB-SoniaNeural', 'en-GB-RyanNeural'] as SpeechVoice[]);
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

/** ট্রান্সক্রিপ্ট থেকে শনাক্ত ভাষা */
export function detectTranscriptLanguage(transcript: string): SpeechLanguage | 'mixed' | 'unknown' | 'silence' {
  if (!transcript?.trim()) return 'silence';
  return detectLanguage(transcript).language;
}

// ------------------------------------------------------------
// §২.২ যাচাই-ফলাফল
// ------------------------------------------------------------

export interface SpeechVerification {
  /** ব্যবহৃত কণ্ঠ */
  voice: SpeechVoice;
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
  voice: SpeechVoice;
  verification: SpeechVerification;
  attempts: number;
}

/** একটি TTS ফলাফলের সম্পূর্ণ যাচাই (দৈর্ঘ্য/স্তর/নীরবতা + ASR ব্যাক-চেক) */
async function verifySpeechBuffer(
  buffer: Buffer,
  ext: string,
  spec: AudioJobSpec,
  voice: SpeechVoice
): Promise<SpeechVerification> {
  const edgeVoice = isEdgeVoice(voice);
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
  let verdict: SpeechVerification['verdict'];
  if (buffer.length === 0 || durationSec < Math.max(0.6, expectedSec * 0.35)) {
    verdict = 'fail';
    notes.push('অডিওর দৈর্ঘ্য প্রত্যাশার চেয়ে অনেক কম — স্ক্রিপ্ট সম্পূর্ণ পড়া হয়নি।');
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
  } else if (spec.language === 'en') {
    if (similarity >= 0.5 && detectedLanguage === 'en') {
      verdict = 'pass';
      notes.push('ASR রাউন্ড-ট্রিপ সাদৃশ্য যথেষ্ট — ইংরেজি কথা নিশ্চিত।');
    } else if (similarity >= 0.25) {
      verdict = 'warn';
      notes.push(`ASR সাদৃশ্য মাঝারি (${Math.round(similarity * 100)}%) — প্রিভিউ শুনে নিশ্চিত করুন।`);
    } else {
      verdict = 'fail';
      notes.push('ASR ট্রান্সক্রিপ্ট মূল স্ক্রিপ্টের সাথে মিলছে না — সম্ভবত সঠিক ইংরেজি পাঠ হয়নি।');
    }
  } else {
    // বাংলা + z-ai কণ্ঠ (জরুরি-ফলব্যাক): উচ্চারণ যন্ত্রে নিশ্চিত নয় — সৎ রায় 'warn'
    verdict = 'warn';
    notes.push('z-ai কণ্ঠ বাংলা-প্রশিক্ষিত নয় — উচ্চারণ নিশ্চিত করা যায় না; প্রিভিউ শুনে নিশ্চিত করুন।');
    if (detectedLanguage === 'bn') {
      notes.push('ASR ট্রান্সক্রিপ্টে বাংলা অক্ষর পাওয়া গেছে — ভালো লক্ষণ।');
    } else if (detectedLanguage === 'silence') {
      verdict = 'fail';
      notes.push('ASR কোনো কথা শনাক্ত করতে পারেনি — অডিওতে স্পষ্ট কথা নেই।');
    }
  }

  if (quality?.peakDb != null && quality.peakDb > -0.1) {
    notes.push('সতর্কতা: অডিও পিক প্রায় ০ dB — সম্ভাব্য ক্লিপিং।');
  }
  const longSilence = silenceRanges.find(r => r.end - r.start > 1.5);
  if (longSilence) {
    notes.push(`দীর্ঘ নীরব অংশ: ${longSilence.start.toFixed(1)}–${longSilence.end.toFixed(1)} সে.`);
  }

  return {
    voice,
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
}

/**
 * §২.২-এর সম্পূর্ণ পাইপলাইন:
 * ভাষা শনাক্তকরণ → মিল-যাচাই → কণ্ঠ-নির্বাচন → TTS →
 * প্রযুক্তি-যাচাই → ASR ব্যাক-চেক → রায়; fail হলে বিকল্প কণ্ঠে একবার পুনঃচেষ্টা।
 */
export async function synthesizeVerifiedSpeech(
  spec: AudioJobSpec,
  opts?: { verify?: boolean }
): Promise<SynthesizedSpeech> {
  const verify = opts?.verify !== false;

  // ১. স্ক্রিপ্টের ভাষা নির্বাচিত ভাষার সাথে মিল আছে কি না
  const det = detectLanguage(spec.script);
  if (det.language === 'unknown') {
    throw new Error('স্ক্রিপ্টে বাংলা বা ইংরেজি কোনো অক্ষর পাওয়া যায়নি — ভাষা নির্ধারণ করা যাচ্ছে না।');
  }
  if (det.language !== 'mixed' && det.language !== spec.language) {
    throw new Error(
      `ভাষার অসামঞ্জস্য: স্ক্রিপ্টটি ${det.language === 'bn' ? 'বাংলা' : 'ইংরেজি'} লেখায়, কিন্তু নির্বাচিত ভাষা ${spec.language === 'bn' ? 'বাংলা' : 'ইংরেজি'}। সঠিক ভাষা বেছে নিন — ভুল ভাষায় পাঠ করলে অডিও বোঝা যাবে না (§২ নিয়ম)।`
    );
  }

  // ২. কণ্ঠ নির্বাচন (Edge-নিউরাল প্রধান, z-ai ফলব্যাক)
  const primaryVoice = resolveVoice(spec.language, spec.voiceId);
  const profile = LANGUAGE_PROFILES[spec.language];

  let attempts = 0;
  let lastResult: SynthesizedSpeech | null = null;

  for (const voice of [primaryVoice, ...profile.voices.filter(v => v !== primaryVoice)]) {
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
      ? `টেক্সট-নর্মালাইজেশন প্রযোজ্ত (${bnNorm.adjustments.length}টি সমন্বয়: ${bnNorm.adjustments.slice(0, 3).join('; ')}${bnNorm.adjustments.length > 3 ? '…' : ''})`
      : null;
    // §১১: cachedSynthesizeSpeech — একই (কণ্ঠ+গতি+টেক্সট)-এ পুনরাবৃত্ত কল ডিস্ক-ক্যাশে/ডিডুপ
    const speech = await cachedSynthesizeSpeech(speakScript, voice, spec.speed ?? 1);
    if (!verify) {
      const quickNotes = ['যাচাই বন্ধ ছিল — প্রিভিউ শুনে নিশ্চিত করুন।'];
      if (normNote) quickNotes.push(normNote);
      return {
        buffer: speech.buffer,
        mimeType: speech.mimeType,
        ext: speech.ext,
        voice,
        verification: {
          voice,
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
    const verification = await verifySpeechBuffer(speech.buffer, speech.ext, { ...spec, voiceId: voice, script: speakScript }, voice);
    if (normNote) verification.notes.push(normNote);
    lastResult = { buffer: speech.buffer, mimeType: speech.mimeType, ext: speech.ext, voice, verification, attempts };
    if (verification.verdict !== 'fail') return lastResult;
    if (attempts >= Math.min(2, profile.voices.length)) break;
  }

  if (!lastResult) throw new Error('কণ্ঠ সংশ্লেষণ ব্যর্থ হয়েছে');
  return lastResult;
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
