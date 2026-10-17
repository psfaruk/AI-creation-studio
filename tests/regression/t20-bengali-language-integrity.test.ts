// ============================================================
// REGRESSION TEST 20 — Bengali language-integrity verification
// (Recovery R-FIX-1 — Critical Defect A; master §4.4/§4.5)
//
// Locks the verification machinery that the 2026-10-16 real run
// proved missing: CJK/other-script detection, trivial-repetition
// detection, bn-similarity-in-verdict, en token-coverage, empty/
// partial transcripts, locale dimension, honest provenance, and
// the §4.5 fixture cases (defect-a-transcripts.json).
//
// Boundaries (t1-প্যাটার্ন):
//  - Module under test: language_controller (verifySpeechBuffer —
//    DIRECTLY, the defense-in-depth layer that stays armed even
//    though the bn chain no longer reaches z-ai voices; plus
//    synthesizeVerifiedSpeech for chain-level typed errors).
//  - Mocked: '@/lib/agent/sdk-helpers' (transcribeBuffer →
//    switchable transcript incl. the two REAL DB transcripts) and
//    '@/lib/agent/tts-cache' (engine routing). REAL: ffmpeg
//    audioQuality on temp WAVs, bn-normalizer, edge_tts helpers.
//  - No network. No provider. No db.
//
// §4.5 coverage map (this file): case 1 unit = REG-1h (t1);
// case 2/7 = REG-1a/1f (t1); case 3 = REG-20e (mixed-script +
// REG-1d upgrade); case 4 = REG-20a; case 5 = REG-20a/b;
// case 6 = REG-20c; case 8 = controller-level (REG-1a/1g) —
// adapter-level ws-mock remains a documented follow-up (B-F11
// partial); case 9 = t19 (pipeline-level); case 10 = REG-1i +
// REG-20b; case 11 = REG-20f; case 12 = B-F13 tool-gate (unit
// follow-up, controller reject locked here); case 13 = UI label
// units (t12) + pipeline tests; case 14 = REG-20g/h.
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { encodeWav } from '@/lib/agent/audio/pcm';
import { isEdgeVoice } from '@/lib/agent/audio/edge_tts';
import { isGoogVoice } from '@/lib/agent/audio/google_tts';
import { toneWavOfSeconds } from '../helpers/speech-wav';

// ---- ফিক্সচার: প্রকৃত ডিবি-ট্রান্সক্রিপ্ট --------------------
const FIXTURES = JSON.parse(
  readFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'language', 'defect-a-transcripts.json'), 'utf8')
) as {
  cases: Array<{
    id: string;
    transcript: string;
    dbSimilarity: number;
    script: string | null;
  }>;
};
const BN_GARBAGE = FIXTURES.cases.find(c => c.id === 'bn-jam-chinese-garbage')!;
const EN_GARBAGE = FIXTURES.cases.find(c => c.id === 'en-tongtong-romanized-garbage')!;

// ---- ইঞ্জিন-সীমানা মক (t1-প্যাটার্ন + LF-0 goog-বাকেট) ----------
let edgeMode: 'ok' | 'throw403' = 'ok';
let zaiMode: 'ok' | 'throw' = 'ok';
let googMode: 'ok' | 'throw' = 'throw'; // LF-0: এই ফাইলের সাফল্য-পথ Edge-ই; ক্ষয়-পরীক্ষায় Google-ও অচল
let asrText = '';
const edgeCalls: string[] = [];
const zaiCalls: string[] = [];
const googCalls: string[] = [];

let okWav: Buffer;

/** D-1: প্রকৃত রেকর্ড-ফাইলের পথ (preload-ওভাররাইডের অধীন নয়) — গার্ড-টেস্টে স্পর্শ-না-হওয়া প্রমাণ */
const REAL_VERIFICATION_FILE = path.join(process.cwd(), 'storage', 'voice-verification.json');

function sha256Of(file: string): string | null {
  if (!existsSync(file)) return null;
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function wavOfSeconds(sec: number): Buffer {
  const sr = 24000;
  const n = Math.round(sec * sr);
  return encodeWav(new Float32Array(n), new Float32Array(n), sr);
}

mock.module('@/lib/agent/tts-cache', () => ({
  cachedSynthesizeSpeech: async (_text: string, voice: string, _speed: number) => {
    if (isEdgeVoice(voice)) {
      edgeCalls.push(voice);
      if (edgeMode === 'throw403') {
        throw new Error('Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403');
      }
      return { buffer: okWav, mimeType: 'audio/wav', ext: 'wav' };
    }
    if (isGoogVoice(voice)) {
      googCalls.push(voice);
      if (googMode === 'throw') throw new Error('Google TTS ব্যর্থ — রেট-লিমিট (HTTP 429)');
      return { buffer: okWav, mimeType: 'audio/wav', ext: 'wav' };
    }
    zaiCalls.push(voice);
    if (zaiMode === 'throw') throw new Error('z-ai TTS ব্যর্থ: রেট-লিমিট');
    return { buffer: okWav, mimeType: 'audio/wav', ext: 'wav' };
  },
  ttsCacheStats: () => ({ hits: 0, misses: 0, inFlight: 0 }),
}));

mock.module('@/lib/agent/sdk-helpers', () => ({
  transcribeBuffer: async () => asrText,
  synthesizeSpeech: async () => {
    throw new Error('direct z-ai TTS not expected here');
  },
}));

const {
  verifySpeechBuffer,
  synthesizeVerifiedSpeech,
  detectLanguage,
  detectTrivialRepetition,
  enTokenCoverage,
  speechErrorCode,
} = await import('@/lib/agent/audio/language_controller');

const BN_SPEC = {
  task: 'speech' as const,
  language: 'bn' as const,
  script: 'বৃষ্টি ভালোই লাগে।',
  voiceId: 'jam' as const, // প্রতিরোধ-স্তর পরীক্ষা: সরাসরি z-ai কণ্ঠে যাচাই
  outputFormat: 'wav' as const,
  sampleRate: 24000 as const,
  speed: 1,
};

beforeEach(() => {
  // D-2: টোন-ফিক্সচার (RMS ≈ −১৩.৫dB) — নীরবতা-গেটের যুগে "সুস্থ"
  // ফিক্সচারের অবশ্যই অ-নীরব হতে হবে; বিশুদ্ধ-নীরবতা এখন REG-20j-এ প্রত্যাখ্যাত
  okWav = toneWavOfSeconds(2.0);
  edgeMode = 'ok';
  zaiMode = 'ok';
  asrText = '';
  edgeCalls.length = 0;
  zaiCalls.length = 0;
});

describe('REG-20: Bengali language-integrity verification (R-FIX-1)', () => {
  test('REG-20a [§4.5-4, fixture: bn-jam]: the REAL Chinese-garbage transcript ⇒ other-script + repetition + similarity-0 ⇒ verdict fail', async () => {
    // প্রকৃত ডিবি-ট্রান্সক্রিপ্ট ("可真的，可真的，踢踢踢…") — ২০২৬-১০-১৬-এর
    // রানে এটি "warn" হিসেবে মিশে গিয়েছিল; এখন তিনটি স্বাধীন সনাক্তকরণই fail করে।
    expect(detectLanguage(BN_GARBAGE.transcript).language).toBe('other-script');
    expect(detectTrivialRepetition(BN_GARBAGE.transcript).repeated).toBe(true);

    asrText = BN_GARBAGE.transcript;
    const v = await verifySpeechBuffer(okWav, 'wav', BN_SPEC, 'jam', 'jam');
    expect(v.verdict).toBe('fail');
    expect(v.detectedLanguage).toBe('other-script');
    expect(v.notes.some(n => n.includes('ভুল ভাষায় পড়েছে'))).toBe(true);
    expect(v.notes.some(n => n.includes('তুচ্ছ পুনরাবৃত্তি'))).toBe(true);
  }, 20_000);

  test('REG-20b [§4.5-5/10, fixture: en-tongtong]: the REAL romanized-garbage transcript can NEVER reach pass (token-coverage gate)', async () => {
    // প্রতিনিধি ইংরেজি স্ক্রিপ্ট (মূলটি ডিবি-নোটে অনুপস্থিত — ফিক্সচারে নথিভুক্ত)
    // + প্রকৃত রোমানীকৃত-আবর্জনা ট্রান্সক্রিপ্ট: সাদৃশ্য যা-ই হোক, শব্দ-আবৃত্তি
    // <৫০% ⇒ "pass" অসম্ভব (২০২৬-১০-১৬-এ ০.৫৭-সাদৃশ্যে pass হয়ে গিয়েছিল)।
    const script = 'The rain today feels quite good and soothing';
    const coverage = enTokenCoverage(script, EN_GARBAGE.transcript);
    expect(coverage.total).toBeGreaterThan(0);
    expect(coverage.covered / coverage.total).toBeLessThan(0.5);

    asrText = EN_GARBAGE.transcript;
    const v = await verifySpeechBuffer(okWav, 'wav', {
      ...BN_SPEC,
      language: 'en',
      script,
      voiceId: 'tongtong',
    }, 'tongtong', 'tongtong');
    expect(v.verdict).not.toBe('pass');
    // সৎ ব্যাখ্যা দৃশ্যমান: শব্দ-আবৃত্তির ঘাটতি / মিল-ব্যর্থতার নোট
    expect(v.notes.some(n => n.includes('মিলছে না') || n.includes('শব্দের অর্ধেকও') || n.includes('প্রিভিউ শুনে'))).toBe(true);
  }, 20_000);

  test('REG-20c [§4.5-6]: empty ASR transcript ⇒ fail ("no clear speech")', async () => {
    asrText = '';
    const v = await verifySpeechBuffer(okWav, 'wav', BN_SPEC, 'jam', 'jam');
    expect(v.verdict).toBe('fail');
    expect(v.notes.some(n => n.includes('কোনো কথা শনাক্ত'))).toBe(true);
  }, 20_000);

  test('REG-20d [§4.4-6]: partial transcript (≪ script) ⇒ loud fragmentation note', async () => {
    asrText = 'বৃষ্টি'; // ৭-শব্দের স্ক্রিপ্টের ১ শব্দ (খণ্ডিত-পাঠ সনাক্তকরণে ≥৪ শব্দ লাগে)
    const v = await verifySpeechBuffer(okWav, 'wav', {
      ...BN_SPEC,
      script: 'আজকে বাইরে ভালো বৃষ্টি পড়ছে অনেকক্ষণ ধরে।',
    }, 'jam', 'jam');
    expect(v.notes.some(n => n.includes('খণ্ডিত পাঠ'))).toBe(true);
  }, 20_000);

  test('REG-20e [§4.5-3]: mixed-script / en-script-for-bn request ⇒ honest LANGUAGE_MISMATCH, never silently read', async () => {
    let caught: any;
    try {
      await synthesizeVerifiedSpeech({
        ...BN_SPEC,
        script: 'This line is plainly English text',
        voiceId: undefined,
      });
    } catch (e) {
      caught = e;
    }
    expect(speechErrorCode(caught)).toBe('LANGUAGE_MISMATCH');
    expect(String(caught?.message)).toContain('ভাষার অসামঞ্জস্য');
    expect(edgeCalls.length).toBe(0); // কোনো সংশ্লেষণ-কলই হয়নি — আগেই প্রত্যাখ্যান
  }, 20_000);

  test('REG-20f [§4.5-11, B-F10]: unsupported/inconsistent locale ⇒ UNSUPPORTED_LOCALE (no silent substitution)', async () => {
    // en + bn-BD লোকেল — অসংগত
    let caught: any;
    try {
      await synthesizeVerifiedSpeech({
        ...BN_SPEC,
        language: 'en',
        script: 'A short english line',
        locale: 'bn-BD',
      });
    } catch (e) {
      caught = e;
    }
    expect(speechErrorCode(caught)).toBe('UNSUPPORTED_LOCALE');

    // bn + বানানো লোকেল
    try {
      caught = undefined;
      await synthesizeVerifiedSpeech({ ...BN_SPEC, locale: 'bn-US' as any });
    } catch (e) {
      caught = e;
    }
    expect(speechErrorCode(caught)).toBe('UNSUPPORTED_LOCALE');
  }, 20_000);

  test('REG-20g [§4.5-14, B-F06/B-F10]: provenance + locale recorded — requestedVoice/actualVoice/engine/locale on the verification', async () => {
    // bn অনুরোধ, লোকেল-নির্দেশ ছাড়া, প্রাথমিক কণ্ঠ রেজল্ভ
    const result = await synthesizeVerifiedSpeech(
      { ...BN_SPEC, voiceId: undefined, locale: 'bn-IN' },
      { verify: false }
    );
    const v = result.verification;
    expect(v.requestedVoice).toBe('bn-IN-TanishaaNeural'); // resolveVoice লোকেল-ম্যাচ প্রাথমিক বেছেছে
    expect(v.actualVoice).toBe(v.voice);
    expect(v.engine).toBe('edge');
    expect(v.locale).toBe('bn-IN');
    expect(v.requestedLocale).toBe('bn-IN');
    expect(result.locale).toBe('bn-IN');
  }, 20_000);

  test('REG-20h [§4.5-14, B-F06]: upgrade provenance — requested jam ⇒ actual Nabanita, both recorded honestly', async () => {
    const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: false });
    // সদিচ্ছা-আপগ্রেড: z-ai কণ্ঠ bn-প্রোফাইলে নেই → প্রাথমিক নিউরাল কণ্ঠ
    expect(result.verification.actualVoice).toBe('bn-BD-NabanitaNeural');
    expect(result.verification.requestedVoice).toBe('jam');
    expect(result.verification.notes.some(n => n.includes('সদিচ্ছা-আপগ্রেড'))).toBe(true);
    expect(zaiCalls.length).toBe(0);
  }, 20_000);

  test('REG-20i [RC-2 + LF-0]: chain exhaustion carries lastVerification evidence — bn VOICE_UNAVAILABLE now requires BOTH providers dead', async () => {
    edgeMode = 'throw403';
    googMode = 'throw'; // LF-0: Google-ও অচল হলে তবেই bn-চেইন ক্ষয়
    let caught: any;
    try {
      await synthesizeVerifiedSpeech({ ...BN_SPEC, voiceId: undefined }, { verify: true });
    } catch (e) {
      caught = e;
    }
    expect(speechErrorCode(caught)).toBe('VOICE_UNAVAILABLE');
    expect(caught?.attempts).toBe(2); // ১টি Edge (ইঞ্জিন-মৃত্যু) + ১টি Google
    expect(edgeCalls.length).toBe(1);
    expect(googCalls.length).toBe(1);
    // চেইন-যাচাই-ক্ষয় (VERIFICATION_FAILED) পথে lastVerification থাকে — REG-1b (t1)
    // সেই চুক্তি লক করে; এখানে bn-VOICE_UNAVAILABLE চুক্তি নিশ্চিত।
  }, 20_000);

  test('REG-20j [NEW — D-2/B2-অগ্রাধিকার]: plausible-duration SILENT audio ⇒ SILENCE_DETECTED fail — even with a perfectly valid bn transcript mocked', async () => {
    // নীরবতা-প্রমাণ ভাষা-প্রমাণের আগেই রায় দেয় (B-F04 ক্রম-নীতির নীরবতা-ভাগ):
    // ASR-এ নিখুঁত বাংলা ট্রান্সক্রিপ্ট মক করা হলেও বিশুদ্ধ-নীরব অডিও pass/warn নয়।
    asrText = 'বৃষ্টি ভালোই লাগে।'; // স্ক্রিপ্টের সাথে হুবহু মিল — তবু নীরবতা = fail
    const silent = wavOfSeconds(2.0);
    const v = await verifySpeechBuffer(silent, 'wav', BN_SPEC, 'jam', 'jam');
    expect(v.verdict).toBe('fail');
    expect(v.failureCode).toBe('SILENCE_DETECTED');
    expect(v.silenceCoverage).toBeGreaterThanOrEqual(0.9);
    expect(v.notes.some(n => n.includes('SILENCE_DETECTED'))).toBe(true);
  }, 20_000);

  test('REG-20k [NEW — D-3/B3]: other-script INPUT (Devanagari/Chinese/Arabic-only text) forced through a bn request ⇒ typed LANGUAGE_MISMATCH — never silently read', async () => {
    // আগে :694-এর allow-list অন্য-লিপিকে চুপচাপ ঢুকতে দিত — bn+Edge পথে
    // দৈর্ঘ্য-ঠিক হলে "pass" পর্যন্ত হয়ে যেত। এখন স্পষ্ট প্রত্যাখ্যান।
    for (const foreign of [
      'यह एक हिंदी पंक्ति है', // দেবনাগরী
      '这是一行中文文本', // চীনা
      'یہ ایک اردو جملہ ہے', // আরবি লিপি (উর্দু)
    ]) {
      let caught: any;
      try {
        await synthesizeVerifiedSpeech({ ...BN_SPEC, script: foreign, voiceId: undefined });
      } catch (e) {
        caught = e;
      }
      expect(speechErrorCode(caught)).toBe('LANGUAGE_MISMATCH');
      expect(String(caught?.message)).toContain('অন্য লিপি');
      expect(edgeCalls.length).toBe(0); // কোনো সংশ্লেষণ-কলই হয়নি
      expect(zaiCalls.length).toBe(0);
    }
  }, 20_000);

  test('REG-20guard [NEW — D-1/B1]: the REAL storage/voice-verification.json is NEVER touched by verification — records go to the isolated preload path', async () => {
    // D-1-এর সরাসরি প্রমাণ: একটি প্রকৃত যাচাই-কল চালানো হয় (রেকর্ড-লেখাসহ),
    // কিন্তু প্রকৃত ফাইলের sha256 অপরিবর্তিত থাকে এবং রেকর্ড preload-এর
    // টেম্প-পথেই যায়।
    const before = sha256Of(REAL_VERIFICATION_FILE);
    const isolatedFile = process.env.VOICE_VERIFICATION_FILE!;
    expect(isolatedFile).toBeDefined();
    expect(isolatedFile).not.toBe(REAL_VERIFICATION_FILE);

    asrText = 'বৃষ্টি ভালোই লাগে।';
    await verifySpeechBuffer(okWav, 'wav', BN_SPEC, 'jam', 'jam');

    const after = sha256Of(REAL_VERIFICATION_FILE);
    expect(after).toBe(before); // প্রকৃত ফাইল স্পর্শ-অযোগ্য
    // আইসোলেটেড পথে রেকর্ড লেখা হয়েছে (best-effort লেখা সফল ছিল)
    const written = JSON.parse(readFileSync(isolatedFile, 'utf8')) as { records: Record<string, unknown> };
    expect(written.records['jam']).toBeDefined();
    expect((written.records['jam'] as { verdict: string }).verdict).toBeDefined();
  }, 20_000);
});
