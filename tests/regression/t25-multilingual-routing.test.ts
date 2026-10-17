// ============================================================
// REGRESSION TEST 25 — Multilingual speech routing (PART C)
// bn/en-এর পাশাপাশি hi/ur/zh-এর রাউটিং-স্তরের সমর্থন + সৎ-UNVERIFIED
// ক্ষমতা-ঘোষণার চুক্তি (মাস্টার-প্রম্পট PART C/D4)।
//
// Boundaries (t1/t20-প্যাটার্ন):
//  - Module under test: language_controller (detectLanguage recognize-
//    প্রসঙ্গ, LANGUAGE_PROFILES, resolveVoice, assignCharacterVoices,
//    synthesizeVerifiedSpeech চেইন) + capabilities.validateSpec।
//  - Mocked: '@/lib/agent/tts-cache' (Edge → 403/tone; z-ai → ট্র্যাক),
//    '@/lib/agent/sdk-helpers' (কোনো লাইভ ASR নয়)।
//  - REAL: ffmpeg audioQuality (টোন-ফিক্সচারে), edge_tts রাউটিং-হেল্পার।
//  - No network. No provider. No db. লাইভ hi/ur/zh উচ্চারণ-যাচাই =
//    BLOCKED (Edge এই পরিবেশে অচল) — এই ফাইল কেবল রাউটিং-চুক্তি লক করে।
//
// সততা-চুক্তি (C1/D4): hi/ur/zh কণ্ঠগুলো ক্যাটালগ-নথিভুক্ত Edge-নিউরাল —
// এই পরিবেশে কখনো লাইভ-যাচাই হয়নি; প্রোফাইলে environmentVerification:
// 'unattempted' সৎ অবস্থা। Edge অচল হলে সৎ ফলাফল = VOICE_UNAVAILABLE —
// z-ai কণ্ঠে নীরব ভাষা-ভাঙা ফলব্যাক কখনোই নয়।
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { isEdgeVoice } from '@/lib/agent/audio/edge_tts';
import { toneWavOfSeconds } from '../helpers/speech-wav';

let edgeMode: 'throw403' | 'okTone' = 'throw403';
const edgeCalls: string[] = [];
const zaiCalls: string[] = [];
let okTone: Buffer;

mock.module('@/lib/agent/tts-cache', () => ({
  cachedSynthesizeSpeech: async (_text: string, voice: string, _speed: number) => {
    if (isEdgeVoice(voice)) {
      edgeCalls.push(voice);
      if (edgeMode === 'throw403') {
        throw new Error('Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403');
      }
      return { buffer: okTone, mimeType: 'audio/wav', ext: 'wav' };
    }
    zaiCalls.push(voice);
    return { buffer: okTone, mimeType: 'audio/wav', ext: 'wav' };
  },
  ttsCacheStats: () => ({ hits: 0, misses: 0, inFlight: 0 }),
}));

mock.module('@/lib/agent/sdk-helpers', () => ({
  transcribeBuffer: async () => '',
  synthesizeSpeech: async () => {
    throw new Error('direct z-ai TTS not expected here');
  },
}));

const {
  detectLanguage,
  LANGUAGE_PROFILES,
  resolveVoice,
  assignCharacterVoices,
  estimateSpeechSec,
  synthesizeVerifiedSpeech,
  speechErrorCode,
} = await import('@/lib/agent/audio/language_controller');

const { validateSpec } = await import('@/lib/agent/capabilities');

const HI_TEXT = 'यह एक हिंदी पंक्ति है';
const UR_TEXT = 'یہ ایک اردو جملہ ہے';
const ZH_TEXT = '今天天气很好，我们一起去公园散步。';

function specOf(language: 'bn' | 'hi' | 'ur' | 'zh', script: string, extra: Record<string, unknown> = {}) {
  return {
    task: 'speech' as const,
    language,
    script,
    outputFormat: 'wav' as const,
    sampleRate: 24000 as const,
    speed: 1,
    ...extra,
  };
}

beforeEach(() => {
  okTone = toneWavOfSeconds(2.0);
  edgeMode = 'throw403';
  edgeCalls.length = 0;
  zaiCalls.length = 0;
});

describe('REG-25: Multilingual speech routing — bn/en + hi/ur/zh (PART C)', () => {
  test('REG-25a [C1 ভিত্তি]: detectLanguage — প্রসঙ্গহীন চুক্তি অপরিবর্তিত; recognize-প্রসঙ্গে নিজ-লিপি-পরিবার শনাক্ত', () => {
    // প্রসঙ্গহীন (ট্রান্সক্রিপ্ট-পথ): পুরনো চুক্তি — চীনা/দেবনাগরী/আরবি সবই 'other-script'
    expect(detectLanguage('这是一行中文文本').language).toBe('other-script');
    expect(detectLanguage(HI_TEXT).language).toBe('other-script');
    expect(detectLanguage(UR_TEXT).language).toBe('other-script');
    // bn/en অপরিবর্তিত
    expect(detectLanguage('আমি বাংলায় কথা বলি').language).toBe('bn');
    expect(detectLanguage('This is English text').language).toBe('en');
    // recognize-প্রসঙ্গ (ইনপুট-গেট): নিজ-লিপি-পরিবার চেনা যায়
    expect(detectLanguage(HI_TEXT, { recognize: ['hi'] }).language).toBe('hi');
    expect(detectLanguage(UR_TEXT, { recognize: ['ur'] }).language).toBe('ar-script');
    expect(detectLanguage(ZH_TEXT, { recognize: ['zh'] }).language).toBe('zh');
    // অন্য-ভাষার recognize-প্রসঙ্গে নিজ-লিপি নয় — তখনও other-script
    expect(detectLanguage(HI_TEXT, { recognize: ['zh'] }).language).toBe('other-script');
  });

  test('REG-25b [C1]: hi/ur/zh প্রোফাইল — Edge-কণ্ঠ, ক্ষমতা-ট্যাগ, সৎ environmentVerification: unattempted', () => {
    for (const code of ['hi', 'ur', 'zh'] as const) {
      const p = LANGUAGE_PROFILES[code];
      expect(p).toBeDefined();
      expect(p.voices.length).toBeGreaterThanOrEqual(2);
      expect(p.environmentVerification).toBe('unattempted'); // সৎ-UNVERIFIED
      expect(p.asrSupport).toBe('none'); // ASR-দাবি নেই — অযাচাই
      for (const v of p.voices) {
        expect(isEdgeVoice(v)).toBe(true); // সবই Edge-নিউরাল
        expect(p.voiceCapabilities[v]?.languages).toContain(code); // fail-closed ট্যাগ
      }
    }
    // bn/en-এর সৎ-অবস্থা (LF-0, ২০২৬-১০-১৭): bn এখন 'live' — Edge-403 থাকলেও
    // Google-Translate বাংলা কণ্ঠ এই পরিবেশে লাইভ-যাচাইকৃত (baseline-report §৩.৩);
    // en আগের মতোই 'live' (ASR রাউন্ড-ট্রিপ-প্রমাণ)।
    expect(LANGUAGE_PROFILES.bn.environmentVerification).toBe('live');
    expect(LANGUAGE_PROFILES.en.environmentVerification).toBe('live');
  });

  test('REG-25c [C2 রাউটিং]: resolveVoice — ভাষা/লোকেল-চালিত প্রাথমিক কণ্ঠ', () => {
    expect(resolveVoice('hi')).toBe('hi-IN-SwaraNeural');
    expect(resolveVoice('hi', undefined, 'hi-IN')).toBe('hi-IN-SwaraNeural');
    expect(resolveVoice('ur')).toBe('ur-PK-UzmaNeural');
    expect(resolveVoice('ur', undefined, 'ur-PK')).toBe('ur-PK-UzmaNeural');
    expect(resolveVoice('zh')).toBe('zh-CN-XiaoxiaoNeural');
    expect(resolveVoice('zh', undefined, 'zh-TW')).toBe('zh-TW-HsiaoChenNeural');
    expect(resolveVoice('zh', undefined, 'zh-HK')).toBe('zh-HK-HiuMaanNeural');
    // z-ai কণ্ঠ-pছন্দ hi/zh-এ উপযুক্ত নয় → প্রোফাইল-প্রাথমিকে রেজল্ভ (bn-আপগ্রেডের সাধারণ নিয়ম)
    expect(resolveVoice('hi', 'jam')).toBe('hi-IN-SwaraNeural');
    expect(resolveVoice('zh', 'tongtong')).toBe('zh-CN-XiaoxiaoNeural');
  });

  test('REG-25d [B-F10 ডেটা-চালিত লোকেল-গেট]: প্রোফাইল-লোকেল বৈধ; ভাষা-বিরোধী লোকেল UNSUPPORTED_LOCALE', async () => {
    // বৈধ: hi+hi-IN (verify:false দ্রুত-পথ, ইঞ্জিন সুস্থ)
    edgeMode = 'okTone';
    const ok = await synthesizeVerifiedSpeech(specOf('hi', HI_TEXT, { locale: 'hi-IN' }), { verify: false });
    expect(ok.verification.locale).toBe('hi-IN');
    // অবৈধ: hi + bn-BD
    let caught: any;
    try {
      await synthesizeVerifiedSpeech(specOf('hi', HI_TEXT, { locale: 'bn-BD' as never }));
    } catch (e) {
      caught = e;
    }
    expect(speechErrorCode(caught)).toBe('UNSUPPORTED_LOCALE');
    expect(String(caught?.message)).toContain('hi-IN');
    // বৈধ: zh + zh-HK
    const okHk = await synthesizeVerifiedSpeech(specOf('zh', ZH_TEXT, { locale: 'zh-HK' }), { verify: false });
    expect(okHk.verification.locale).toBe('zh-HK');
  }, 20_000);

  test('REG-25e [C2 সততা]: Edge-403 হলে hi/zh = সৎ VOICE_UNAVAILABLE — কোনো z-ai ফলব্যাক নয়, চেইন bounded', async () => {
    for (const [code, script] of [['hi', HI_TEXT], ['zh', ZH_TEXT]] as const) {
      edgeMode = 'throw403';
      edgeCalls.length = 0;
      zaiCalls.length = 0;
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(specOf(code, script), { verify: true });
      } catch (e) {
        caught = e;
      }
      expect(speechErrorCode(caught)).toBe('VOICE_UNAVAILABLE');
      expect(String(caught?.message)).toContain('VOICE_UNAVAILABLE');
      // ইঞ্জিন-সচেতন স্কিপ: প্রথম 403-ই ইঞ্জিন মারে — একটিই কল
      expect(edgeCalls.length).toBe(1);
      expect(zaiCalls.length).toBe(0); // ভাষা-ভাঙা ফলব্যাক সংজ্ঞাগতভাবে অসম্ভব
      expect(caught?.attempts).toBe(1);
      // C2 টাইপড ইঞ্জিন-ব্যর্থতা শ্রেণি বার্তায় দৃশ্যমান
      expect(String(caught?.message)).toMatch(/AUTH_FAILED|403/);
    }
  }, 20_000);

  test('REG-25f [C2/C3]: Edge-সুস্থ হলে zh+Edge টোন-অডিও দৈর্ঘ্য+নীরবতা-যাচাইসহ pass — চীনা-প্রশিক্ষিত নোট', async () => {
    edgeMode = 'okTone';
    const result = await synthesizeVerifiedSpeech(specOf('zh', ZH_TEXT), { verify: true });
    expect(result.voice).toBe('zh-CN-XiaoxiaoNeural');
    expect(result.verification.verdict).toBe('pass');
    expect(result.verification.notes.some(n => n.includes('চীনা-প্রশিক্ষিত নিউরাল কণ্ঠ'))).toBe(true);
    expect(zaiCalls.length).toBe(0);
    // D-2 গেট এই পথেও সশস্ত্র: silenceCoverage মাপা হয়েছে (টোন → কম)
    expect(result.verification.silenceCoverage).toBeDefined();
    expect(result.verification.silenceCoverage!).toBeLessThan(0.9);
  }, 20_000);

  test('REG-25g [B3]: লিপি-ভাষা অসামঞ্জস্য — hi-লিপি bn-অনুরোধে প্রত্যাখ্যাত; bn-লিপি hi-অনুরোধে প্রত্যাখ্যাত; উর্দু-লিপি উর্দু-অনুরোধে বৈধ', async () => {
    // hi-লিপি + bn-অনুরোধ → other-script → D-3 প্রত্যাখ্যান
    let caught: any;
    try {
      await synthesizeVerifiedSpeech(specOf('bn', HI_TEXT));
    } catch (e) {
      caught = e;
    }
    expect(speechErrorCode(caught)).toBe('LANGUAGE_MISMATCH');
    expect(String(caught?.message)).toContain('অন্য লিপি');

    // bn-লিপি + hi-অনুরোধ → শনাক্ত-বাংলা ≠ hi → mismatch
    try {
      await synthesizeVerifiedSpeech(specOf('hi', 'আমি বাংলায় কথা বলি'));
    } catch (e) {
      caught = e;
    }
    expect(speechErrorCode(caught)).toBe('LANGUAGE_MISMATCH');
    expect(String(caught?.message)).toContain('হিন্দি');

    // উর্দু-লিপি (ar-script) + ur-অনুরোধ → বৈধ (লিপি-পরিবার সামঞ্জস্য)
    edgeMode = 'okTone';
    const ur = await synthesizeVerifiedSpeech(specOf('ur', UR_TEXT), { verify: false });
    expect(ur.voice).toBe('ur-PK-UzmaNeural');

    // কোনো অসামঞ্জস্য-কলেই ইঞ্জিন ডাকা হয়নি (গেট আগে)
    expect(edgeCalls.filter(v => v.startsWith('bn-')).length).toBe(0);
  }, 20_000);

  test('REG-25h [F1-ভিত্তি]: estimateSpeechSec — চীনা অক্ষর-ভিত্তিক, hi/ur/bn শব্দ-ভিত্তিক', () => {
    const zhSec = estimateSpeechSec(ZH_TEXT, 'zh');
    const cjkChars = (ZH_TEXT.match(/[\u4E00-\u9FFF]/g) ?? []).length;
    expect(zhSec).toBeGreaterThanOrEqual(cjkChars / 4.3 - 0.01);
    expect(zhSec).toBeLessThanOrEqual(cjkChars / 4.3 + 0.8); // Math.max(0.8,…) মাটি-নীচে
    const hiSec = estimateSpeechSec(HI_TEXT, 'hi');
    const hiWords = HI_TEXT.trim().split(/\s+/).length;
    expect(hiSec).toBeCloseTo(Math.max(0.8, hiWords / 2.1), 1);
  });

  test('REG-25i [D-3/B3]: validateSpec — hi/ur/zh গৃহীত; পরিচিত-অসমর্থিত ভাষা স্পষ্ট প্রত্যাখ্যান; zh-রূপভেদ সমন্বয়', () => {
    for (const lang of ['hi', 'ur', 'zh'] as const) {
      const v = validateSpec({ type: 'motion_video', language: lang });
      expect(v.ok).toBe(true);
      expect(v.validated?.spec.language).toBe(lang);
    }
    // পরিচিত-কিন্তু-অসমর্থিত (fr) — নীরব বাংলা-বদল নয়
    const fr = validateSpec({ type: 'motion_video', language: 'fr' });
    expect(fr.ok).toBe(false);
    expect(fr.errors.some(e => e.includes('LANGUAGE_UNSUPPORTED'))).toBe(true);
    expect(fr.alternatives?.some(a => a.includes('bn, en, hi, ur, zh'))).toBe(true);
    // রূপভেদ → কোড-সমন্বয় (দৃশ্যমান, নীরব নয়)
    const hans = validateSpec({ type: 'motion_video', language: 'zh-Hans' });
    expect(hans.ok).toBe(true);
    expect(hans.validated?.spec.language).toBe('zh');
    expect(hans.validated?.adjustments.some(a => a.field === 'language' && a.to === 'zh')).toBe(true);
  });

  test('REG-25j [E2]: assignCharacterVoices — প্রতিটি ভাষার নিজ Edge-কণ্ঠ বণ্টনে; bn/en তালিকা অপরিবর্তিত', () => {
    const hi = assignCharacterVoices(['ক', 'খ'], 'hi');
    expect(hi['ক']).toBe('hi-IN-SwaraNeural');
    expect(hi['খ']).toBe('hi-IN-MadhurNeural');
    const zh = assignCharacterVoices(['甲', '乙', '丙'], 'zh');
    expect(new Set(Object.values(zh)).size).toBe(3); // তিনটি আলাদা কণ্ঠ
    expect(Object.values(zh).every(v => isEdgeVoice(v) && v.startsWith('zh-'))).toBe(true);
    // bn/en-চুক্তি হুবহু আগের মতো
    const bn = assignCharacterVoices(['লেখক', 'মাঝি'], 'bn');
    expect(bn['লেখক']).toBe('bn-BD-NabanitaNeural');
    expect(bn['মাঝি']).toBe('bn-BD-PradeepNeural');
  });
});
