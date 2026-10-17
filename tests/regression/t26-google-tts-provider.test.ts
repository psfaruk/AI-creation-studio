// ============================================================
// REGRESSION TEST 26 — Google-Translate TTS provider (LF-0, Phase 1)
//
// Boundaries:
//  - Module under test: src/lib/agent/audio/google_tts.ts (সম্পূর্ণ নতুন
//    প্রোভাইডার-মডিউল — ২০২৬-১০-১৭-এ লাইভ-প্রোব-যাচাইকৃত বাংলা কথার
//    প্রকৃত প্রোভাইডার; মাস্টার-প্রম্পট §1.3/§1.5-এর ফলব্যাক-চেইন ও
//    ত্রুটি-শ্রেণির চুক্তি)।
//  - Mocked: HTTP-fetcher (setGoogleTtsFetcherForTests) — কোনো টেস্টই
//    নেটওয়ার্ক ছোঁয় না। tts-cache-রাউটিং পরীক্ষায় google_tts-মডিউলটি
//    নিজে mock হয় (mock.module) আর প্রকৃত tts-cache কোড চলে — ক্যাশ
//    TTS_CACHE_DIR প্রিলোডে টেম্পে রাউট থাকায় প্রকৃত ক্যাশ অস্পৃশ্য।
//  - REAL (no mock): কোনো নেটওয়ার্ক নয়; voice-verification রেকর্ড
//    প্রিলোড-আইসোলেশনে টেম্পে যায় (D-1)।
//
// CONTRACT (মাস্টার-প্রম্পট §1.3 + §1.5 — latest-fix Phase 1):
//  - প্রতিটি HTTP-ব্যর্থতা টাইপড বার্তায় পরিণত হয় (429→রেট-লিমিট,
//    403→নীতি-ব্লক, timeout→সময়সীমা, network→নেটওয়ার্ক-ত্রুটি) — যাতে
//    language_controller-এর classifyEngineFailure নির্ভরযোগ্যভাবে
//    শ্রেণি দিতে পারে (AUTH_FAILED/RATE_LIMITED/PROVIDER_TIMEOUT/
//    NETWORK_ERROR)।
//  - ফাইল-তৈরি-মাত্র সাফল্য নয়: প্রতিক্রিয়া অবশ্যই audio/* content-type +
//    MP3 ফ্রেম-সিঙ্ক + ন্যূনতম আকার পাস করবে — HTML-ব্লক/ক্যাপচা-পাতা/
//    করাপ্ট-বাইট প্রত্যাখ্যাত।
//  - >১৮০ অক্ষরের লেখা বাক্য-সীমায় ভাগ হয়; খণ্ডগুলো কনক্যাট হয়।
//  - speed>1 অনুরোধে speedUnsupported-পতাকা (সৎ সীমা-ঘোষণা)।
//  - tts-cache রাউটিং + ক্যাশ-ডিডুপ (§1.5-৮) আলাদা ফাইলে:
//    t0-google-tts-cache-routing.test.ts (bun-এর একই-প্রসেস মক-লিকেজ
//    এড়াতে বর্ণমালায় আগে-চলা মক-মুক্ত ফাইল — ওই ফাইলের হেডার দেখুন)।
// ============================================================

import { describe, expect, test, beforeEach, afterAll } from 'bun:test';
import {
  synthesizeGoogleSpeech,
  splitForGoogle,
  setGoogleTtsFetcherForTests,
  setGoogleTtsTimeoutForTests,
  setGoogleTtsRetryWaitForTests,
  googleTtsHealth,
  isGoogVoice,
  GOOGLE_TTS_VOICE,
  GOOGLE_TTS_PROVIDER,
  type GoogleTtsFetchResult,
} from '@/lib/agent/audio/google_tts';
import { readVoiceVerificationRecords } from '@/lib/agent/audio/edge_tts';

// ------------------------------------------------------------
// সহায়ক — বৈধ MP3-সদৃশ বাফার (ফ্রেম-সিঙ্ক 0xFF 0xFB + পর্যাপ্ত দৈর্ঘ্য)
// ------------------------------------------------------------

function fakeMp3(bytes = 40_000): Buffer {
  const b = Buffer.alloc(bytes, 0x10);
  b[0] = 0xff;
  b[1] = 0xfb; // MPEG-1 Layer III, 128kbps — বৈধ সিঙ্ক
  return b;
}

/** fetcher-কলের নথি */
const calls: { url: string; ua: string }[] = [];

let mode:
  | 'ok'
  | 'okOnceThen429' // প্রথম কল 429, পরেরটা সফল — পুনঃচেষ্টা-পথ
  | 'http429'
  | 'http403'
  | 'htmlBlock'
  | 'badMagic'
  | 'tooSmall'
  | 'networkError'
  | 'timeout'
  = 'ok';

function installFetcher(): void {
  setGoogleTtsFetcherForTests(async (url, init): Promise<GoogleTtsFetchResult> => {
    calls.push({ url, ua: init.headers['User-Agent'] ?? '' });
    if (mode === 'http429') return { status: 429, contentType: 'text/plain', body: Buffer.from('rate') };
    if (mode === 'http403') return { status: 403, contentType: 'text/plain', body: Buffer.from('blocked') };
    if (mode === 'htmlBlock')
      return { status: 200, contentType: 'text/html; charset=UTF-8', body: Buffer.from('<html>captcha</html>') };
    if (mode === 'badMagic') return { status: 200, contentType: 'audio/mpeg', body: Buffer.alloc(5000, 0x00) };
    if (mode === 'tooSmall') return { status: 200, contentType: 'audio/mpeg', body: fakeMp3(120) };
    if (mode === 'networkError') throw new Error('fetch failed: getaddrinfo ENOTFOUND translate.google.com');
    if (mode === 'timeout') {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (mode === 'okOnceThen429') {
      const n = calls.filter(c => c.url.includes('translate_tts')).length;
      if (n === 1) return { status: 429, contentType: 'text/plain', body: Buffer.from('rate') };
      return { status: 200, contentType: 'audio/mpeg', body: fakeMp3() };
    }
    return { status: 200, contentType: 'audio/mpeg', body: fakeMp3() };
  });
}

beforeEach(() => {
  calls.length = 0;
  mode = 'ok';
  installFetcher();
  setGoogleTtsRetryWaitForTests(5); // ঘুম-অপচয় নয় — পুনঃচেষ্টার চুক্তিই থাকে
});

// স্যুট-শেষে আসল ফেচার/অপেক্ষা পুনরুদ্ধার — পরবর্তী টেস্ট-ফাইলে প্রোডাকশন-পথ
// প্রভাবিত না হয় (bun একই প্রসেসে সব ফাইল চালায়)
afterAll(() => {
  setGoogleTtsFetcherForTests(null);
  setGoogleTtsRetryWaitForTests(0);
});

const BN_TEXT = 'আজ বাংলাদেশের আকাশ পরিষ্কার এবং বাতাস বেশ সুন্দর।';

describe('REG-26: Google-Translate TTS provider unit contract (LF-0)', () => {
  test('REG-26a [§1.3-সাফল্য]: valid MP3 → buffer + provider label + single segment', async () => {
    const res = await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    expect(res.buffer.length).toBeGreaterThan(10_000);
    expect(res.mimeType).toBe('audio/mpeg');
    expect(res.ext).toBe('mp3');
    expect(res.provider).toBe(GOOGLE_TTS_PROVIDER);
    expect(res.segments).toBe(1);
    expect(res.voice).toBe(GOOGLE_TTS_VOICE);
    expect(res.speedUnsupported).toBe(false);
    // URL-চুক্তি: tl=bn + tw-ob client
    expect(calls[0].url).toContain('translate.google.com/translate_tts');
    expect(calls[0].url).toContain('tl=bn');
    expect(calls[0].url).toContain('client=tw-ob');
    expect(calls[0].ua).toContain('Mozilla');
  });

  test('REG-26b [চাঙ্কিং]: >১৮০ অক্ষর → বাক্য-সীমায় খণ্ড, প্রতিটি ≤১৮০, কনক্যাট-ফল', async () => {
    const longText = Array.from({ length: 12 }, (_, i) => `এটি দীর্ঘ পরীক্ষামূলক বাক্য নম্বর ${i + 1}।`).join(' ');
    expect(longText.length).toBeGreaterThan(180);
    const parts = splitForGoogle(longText);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(180);
    // কোনো অক্ষর হারায় না (সব সংখ্যা-টোকেন উপস্থিত)
    for (let i = 1; i <= 12; i++) expect(parts.join(' ')).toContain(`${i}`);
    const res = await synthesizeGoogleSpeech(longText, GOOGLE_TTS_VOICE);
    expect(res.segments).toBe(parts.length);
    expect(calls.length).toBe(parts.length);
    expect(res.buffer.length).toBe(fakeMp3().length * parts.length);
  });

  test('REG-26c [§1.5-৩/৬, HTTP 429]: রেট-লিমিট → টাইপড বার্তা, ৩-চেষ্টার পর সৎ ব্যর্থতা', async () => {
    mode = 'http429';
    let caught: any;
    try {
      await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(String(caught?.message)).toContain('429');
    expect(String(caught?.message)).toContain('রেট-লিমিট');
    // ১টি অংশ × ৩টি চেষ্টা
    expect(calls.length).toBe(3);
  });

  test('REG-26d [§1.5-৩, HTTP 403]: নীতি-ব্লক → টাইপড বার্তা (AUTH_FAILED-শ্রেণিযোগ্য)', async () => {
    mode = 'http403';
    let caught: any;
    try {
      await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    } catch (e) {
      caught = e;
    }
    expect(String(caught?.message)).toContain('403');
    expect(String(caught?.message)).toContain('প্রমাণীকরণ/নীতি-ব্লক');
  });

  test('REG-26e [§1.4, HTML-ব্লক]: অডিও-নয় content-type → প্রত্যাখ্যাত (ফাইল-তৈরি≠সাফল্য)', async () => {
    mode = 'htmlBlock';
    let caught: any;
    try {
      await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    } catch (e) {
      caught = e;
    }
    expect(String(caught?.message)).toContain('অডিও-নয়');
  });

  test('REG-26f [§1.5-৫, করাপ্ট]: MP3 ফ্রেম-সিঙ্ক মিলেনি → প্রত্যাখ্যাত', async () => {
    mode = 'badMagic';
    let caught: any;
    try {
      await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    } catch (e) {
      caught = e;
    }
    expect(String(caught?.message)).toContain('ফ্রেম-সিঙ্ক');
  });

  test('REG-26g [অস্বাভাবিক-ছোট]: <৪০০ বাইট অডিও → প্রত্যাখ্যাত', async () => {
    mode = 'tooSmall';
    let caught: any;
    try {
      await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    } catch (e) {
      caught = e;
    }
    expect(String(caught?.message)).toContain('অস্বাভাবিক ছোট');
  });

  test('REG-26h [§1.5-৬, নেটওয়ার্ক]: সংযোগ-ত্রুটি → নেটওয়ার্ক-শ্রেণির বার্তা', async () => {
    mode = 'networkError';
    let caught: any;
    try {
      await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    } catch (e) {
      caught = e;
    }
    expect(String(caught?.message)).toContain('নেটওয়ার্ক-ত্রুটি');
  });

  test('REG-26i [§1.5-৬, টাইমআউট]: AbortError → সময়সীমা-বার্তা (PROVIDER_TIMEOUT-শ্রেণিযোগ্য)', async () => {
    mode = 'timeout';
    setGoogleTtsTimeoutForTests(50);
    let caught: any;
    try {
      await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    } catch (e) {
      caught = e;
    }
    expect(String(caught?.message)).toContain('সময়সীমা');
  });

  test('REG-26j [পুনঃচেষ্টা-সাফল্য]: ৪29-এর পরে সফল পুনঃচেষ্টা → অডিও ফেরত', async () => {
    mode = 'okOnceThen429';
    const res = await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE);
    expect(res.buffer.length).toBeGreaterThan(10_000);
    expect(calls.length).toBe(2);
  });

  test('REG-26k [সৎ-ইনপুট]: খালি লেখা → সৎ ব্যর্থতা; অজানা কণ্ঠ → সৎ ব্যর্থতা', async () => {
    await expect(synthesizeGoogleSpeech('', GOOGLE_TTS_VOICE)).rejects.toThrow('খালি');
    await expect(synthesizeGoogleSpeech(BN_TEXT, 'bn-GOOG-Nonexistent')).rejects.toThrow('অজানা কণ্ঠ');
  });

  test('REG-26l [গতি-সীমা]: speed>1 → speedUnsupported পতাকা (সৎ সীমা)', async () => {
    const res = await synthesizeGoogleSpeech(BN_TEXT, GOOGLE_TTS_VOICE, { speed: 1.5 });
    expect(res.speedUnsupported).toBe(true);
    // ttsspeed=1 দিয়ে পাঠানো হয়েছে (অসমর্থিত গতি জোর করে নয়)
    expect(calls[0].url).toContain('ttsspeed=1');
  });

  test('REG-26m [কঠোর-ভাঙন]: যতিচিহ্নহীন দীর্ঘ সারি → শক্ত-ভাঙন অংশ ≤১৮০', () => {
    const noPunct = 'বাংলা'.repeat(80); // ৪০০ অক্ষর, কোনো যতিচিহ্ন নেই
    const parts = splitForGoogle(noPunct);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(180);
    expect(parts.join('')).toBe(noPunct);
  });

  test('REG-26n [কণ্ঠ-রেজিস্ট্রি]: একক Google-কণ্ঠ — bn-only, speech-only, live-verified ঘোষণা', () => {
    expect(isGoogVoice(GOOGLE_TTS_VOICE)).toBe(true);
    expect(isGoogVoice('bn-BD-NabanitaNeural')).toBe(false);
    expect(isGoogVoice('jam')).toBe(false);
  });

  test('REG-26o [স্বাস্থ্য-পরীক্ষা]: সুস্থ প্রোভাইডার → ok:true + রেকর্ড; অচল → ok:false + রেকর্ড', async () => {
    // সুস্থ
    let h = await googleTtsHealth(true);
    expect(h.ok).toBe(true);
    expect(h.note).toContain('সক্রিয়');
    const rec1 = await readVoiceVerificationRecords();
    const r1 = rec1.records[GOOGLE_TTS_VOICE];
    expect(r1).toBeDefined();
    expect(r1.engine).toBe('goog');
    expect(r1.verdict).toBe('pass');
    // অচল (429)
    mode = 'http429';
    h = await googleTtsHealth(true);
    expect(h.ok).toBe(false);
    expect(h.note).toContain('অনুপলব্ধ');
    const rec2 = await readVoiceVerificationRecords();
    const r2 = rec2.records[GOOGLE_TTS_VOICE];
    expect(r2.verdict).toBe('fail');
  });
});

