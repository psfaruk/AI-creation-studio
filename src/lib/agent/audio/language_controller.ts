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
import { synthesizeSpeech, transcribeBuffer } from '../sdk-helpers';
import { audioQuality } from '@/lib/media/ffmpeg';

// ------------------------------------------------------------
// §২.১ AudioJobSpec
// ------------------------------------------------------------

export type SpeechLanguage = 'bn' | 'en';
export type AudioTask = 'speech' | 'singing' | 'instrumental';

export interface AudioJobSpec {
  task: AudioTask;
  language: SpeechLanguage;
  script: string;
  voiceId: TtsVoice;
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
  /** কণ্ঠ-পছন্দক্রম (প্রথমটা ডিফল্ট) */
  voices: TtsVoice[];
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
    voices: ['jam', 'douji'],
    nativeSupport: 'partial',
    asrSupport: 'weak',
    notes: [
      'কোনো কণ্ঠই বাংলা-প্রশিক্ষিত নয় — jam কণ্ঠে সম্ভাব্য-দৈর্ঘ্যের পাঠ পাওয়া গেছে, তবে উচ্চারণ যন্ত্রে নিশ্চিত করা যায় না।',
      'বাংলা সংলাপ তৈরি হলে অবশ্যই প্রিভিউ শুনে নিশ্চিত করুন; ASR বাংলা বোঝে না বলে স্বয়ংক্রিয় রায় "সতর্কতা" থাকে।',
      'tongtong/chuichui/xiaochen/luodo কণ্ঠে বাংলা লেখা সঠিকভাবে পড়া হয় না — সেগুলো বাংলার জন্য ব্যবহৃত হয় না।',
    ],
  },
  en: {
    code: 'en',
    name: 'ইংরেজি',
    voices: ['jam', 'tongtong', 'kazi', 'xiaochen'],
    nativeSupport: 'verified',
    asrSupport: 'good',
    notes: [
      'jam (ব্রিটিশ) ইংরেজির জন্য প্রধান কণ্ঠ।',
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

/** ভাষা অনুযায়ী কণ্ঠ নির্বাচন (ব্যবহারকারীর পছন্দ প্রোফাইলে বৈধ হলে সেটাই) */
export function resolveVoice(language: SpeechLanguage, preferred?: string): TtsVoice {
  const profile = LANGUAGE_PROFILES[language];
  if (preferred && (profile.voices as string[]).includes(preferred)) {
    return preferred as TtsVoice;
  }
  return profile.voices[0];
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
  voice: TtsVoice;
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
  voice: TtsVoice;
  verification: SpeechVerification;
  attempts: number;
}

/** একটি TTS ফলাফলের সম্পূর্ণ যাচাই (দৈর্ঘ্য/স্তর/নীরবতা + ASR ব্যাক-চেক) */
async function verifySpeechBuffer(
  buffer: Buffer,
  ext: string,
  spec: AudioJobSpec
): Promise<SpeechVerification> {
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

  // ASR ব্যাক-চেক (প্রথম ৩০ সে.-ই যথেষ্ট — খরচ নিয়ন্ত্রণ)
  let transcript = '';
  let asrError = '';
  try {
    transcript = await transcribeBuffer(buffer, ext);
  } catch (err: any) {
    asrError = String(err?.message ?? err).slice(0, 140);
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
  } else if (asrError) {
    verdict = 'warn';
    notes.push(`ASR ব্যাক-চেক চলানো যায়নি (${asrError}) — প্রিভিউ শুনে যাচাই করুন।`);
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
    // বাংলা: ASR বাংলা বোঝে না — সৎ রায় 'warn', মানব-শ্রবণ বাধ্যতামূলক
    verdict = 'warn';
    if (detectedLanguage === 'bn') {
      notes.push('ASR ট্রান্সক্রিপ্টে বাংলা অক্ষর পাওয়া গেছে — ভালো লক্ষণ, তবু প্রিভিউ শুনে নিশ্চিত করুন।');
    } else if (detectedLanguage === 'silence') {
      verdict = 'fail';
      notes.push('ASR কোনো কথা শনাক্ত করতে পারেনি — অডিওতে স্পষ্ট কথা নেই।');
    } else {
      notes.push(
        'ASR এই অডিওর ভাষা বাংলা হিসেবে চিনতে পারেনি (ASR-এর বাংলা-সমর্থন দুর্বল) — দৈর্ঘ্য স্বাভাবিক, কিন্তু উচ্চারণ যাচাইয়ে প্রিভিউ শুনা দরকার।'
      );
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
    voice: spec.voiceId,
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

  // ২. কণ্ঠ নির্বাচন
  const primaryVoice = resolveVoice(spec.language, spec.voiceId);
  const profile = LANGUAGE_PROFILES[spec.language];

  let attempts = 0;
  let lastResult: SynthesizedSpeech | null = null;

  for (const voice of [primaryVoice, ...profile.voices.filter(v => v !== primaryVoice)]) {
    attempts++;
    const speech = await synthesizeSpeech(spec.script, voice, spec.speed ?? 1);
    if (!verify) {
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
          notes: ['যাচাই বন্ধ ছিল — প্রিভিউ শুনে নিশ্চিত করুন।'],
        },
        attempts,
      };
    }
    const verification = await verifySpeechBuffer(speech.buffer, speech.ext, { ...spec, voiceId: voice });
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
