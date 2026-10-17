// ============================================================
// Google Translate TTS — বাংলা কথার বাস্তব প্রোভাইডার (2026-10-17
// লাইভ-প্রোব-যাচাইকৃত)।
//
// প্রেক্ষাপট (docs/audit/latest-fix/baseline-report.md §৩.৩):
//  - z-ai SDK-র ৭টি কণ্ঠের কেউই বাংলা পড়তে পারে না (লাইভ-ম্যাট্রিক্স:
//    ৩.৮৪–২৬ সে. আবর্জনা-দৈর্ঘ্য, ASR-রাউন্ড-ট্রিপ আবর্জনা)।
//  - Microsoft Edge-নিউরাল bn-BD/bn-IN কণ্ঠ এই sandbox থেকে 403।
//  - Google Translate-এর অপ্রাতিষ্ঠানিক translate_tts endpoint
//    tl=bn-এ **প্রকৃত বাংলা উচ্চারণ** দেয় — প্রমাণ: HTTP 200, বৈধ MP3,
//    সঠিক দৈর্ঘ্য (৫.০৪ সে. ≈ বাক্যের প্রত্যাশা), সুস্থ RMS (−১৯dB),
//    ASR সেম্যান্টিক-রাউন্ড-ট্রিপ পাস (অডিওর অর্থ মিলেছে)।
//
// সততার সীমা (এই ফাইলের প্রতিটি দাবির সীমানা):
//  - অপ্রাতিষ্ঠানিক endpoint — কোনো SLA নেই, রেট-লিমিট অজানা,
//    ভবিষ্যতে বন্ধ হতে পারে। স্বাস্থ্য-প্রোব ব্যর্থ হলে সৎ
//    VOICE_UNAVAILABLE-এ চেইন শেষ হয়।
//  - একক কণ্ঠ (লিঙ্গ/বৈচিত্র্য নেই) — bn-BD/bn-IN উচ্চারণ-পার্থক্যও
//    দেয় না; নোট-সহ জানানো হয়।
//  - গতি-নিয়ন্ত্রণ নেই (speed≠১ হলে সৎ নোট)।
//  - ASR এই অডিওর script-preserving বাংলা ট্রান্সক্রিপ্ট দেয় না
//    (চীনা অনুবাদ দেয়) — তাই ভাষা-স্ট্যাটাস AUDIO_VALIDATION_ONLY।
//  - এটি কখনোই "গান গাওয়া" নয় — শুধু কথা পড়া।
//
// কোনো API key/সিক্রেট জড়িত নয় — পাবলিক বিনামূল্য endpoint।
// ============================================================

import { recordVoiceVerification } from './edge_tts';

export const GOOGLE_TTS_PROVIDER = 'google-translate';
export const GOOGLE_TTS_LABEL = 'Google Translate TTS (বাংলা)';
export const GOOGLE_TTS_VOICE = 'bn-GOOG-Default';

/** এই প্রোভাইডারের একমাত্র কণ্ঠ — লাইভ-যাচাইকৃত বাংলা (কথা) */
export interface GoogleVoiceInfo {
  id: string;
  labelBn: string;
  language: 'bn';
  speechOnly: true;
  liveVerified: true;
  verifiedAt: string;
  noteBn: string;
}

export const GOOGLE_VOICES: GoogleVoiceInfo[] = [
  {
    id: GOOGLE_TTS_VOICE,
    labelBn: 'গুগল-অনুবাদ বাংলা কণ্ঠ (কথা)',
    language: 'bn',
    speechOnly: true,
    liveVerified: true,
    verifiedAt: '2026-10-17T17:48:00.000Z',
    noteBn:
      'লাইভ-প্রোব-যাচাইকৃত বাংলা কথার কণ্ঠ (২০২৬-১০-১৭: সঠিক দৈর্ঘ্য+RMS+ASR-সেম্যান্টিক-রাউন্ড-ট্রিপ)। অপ্রাতিষ্ঠানিক পরিষেবা — SLA নেই; একক কণ্ঠ, লিঙ্গ/দেশীয়-উচ্চারণ পার্থক্য নেই; গতি-নিয়ন্ত্রণ নেই।',
  },
];

const GOOGLE_VOICE_IDS = new Set<string>(GOOGLE_VOICES.map(v => v.id));

/** কণ্ঠ-আইডি Google-Translate কণ্ঠ কি না */
export function isGoogVoice(voice: string): boolean {
  return GOOGLE_VOICE_IDS.has(voice);
}

// ------------------------------------------------------------
// HTTP-অনুরোধ — টেস্ট-ইনজেকশনযোগ্য (কোনো টেস্ট নেটওয়ার্ক ছোঁয় না)
// ------------------------------------------------------------

export interface GoogleTtsFetchResult {
  status: number;
  contentType: string;
  body: Buffer;
}

type GoogleTtsFetcher = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<GoogleTtsFetchResult>;

let fetcher: GoogleTtsFetcher = async (url, init) => {
  const res = await fetch(url, init);
  const ab = await res.arrayBuffer();
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? '',
    body: Buffer.from(new Uint8Array(ab)),
  };
};

/** [শুধু টেস্ট] HTTP-ফেচার প্রতিস্থাপন — hermetic ইউনিট-টেস্টের জন্য */
export function setGoogleTtsFetcherForTests(fn: GoogleTtsFetcher | null): void {
  fetcher =
    fn ??
    (async (url, init) => {
      const res = await fetch(url, init);
      const ab = await res.arrayBuffer();
      return {
        status: res.status,
        contentType: res.headers.get('content-type') ?? '',
        body: Buffer.from(new Uint8Array(ab)),
      };
    });
}

// ------------------------------------------------------------
// টেক্সট-চাঙ্কিং — প্রতি-অনুরোধ দৈর্ঘ্য-সীমা (≈২০০ অক্ষর; নিরাপদ ১৮০)
// ------------------------------------------------------------

const SEGMENT_CHAR_LIMIT = 180;

/** দীর্ঘ লেখা বাক্য-সীমায় ভাগ (দাঁড়ি/?/!/।/newline; জোড়া অক্ষর না ভেঙে) */
export function splitForGoogle(text: string, limit = SEGMENT_CHAR_LIMIT): string[] {
  const t = (text ?? '').trim();
  if (t.length <= limit) return t ? [t] : [];
  const parts: string[] = [];
  let buf = '';
  for (const piece of t.split(/(?<=[।!?\.।\n])\s*/)) {
    if ((buf + ' ' + piece).trim().length > limit && buf) {
      parts.push(buf.trim());
      buf = piece;
    } else {
      buf = `${buf} ${piece}`.trim();
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  // কোনো বাক্যই সীমার চেয়ে দীর্ঘ হলে (যতিচিহ্নহীন দীর্ঘ সারি) শক্ত-ভাঙন
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= limit) {
      out.push(p);
      continue;
    }
    for (let i = 0; i < p.length; i += limit) out.push(p.slice(i, i + limit));
  }
  return out;
}

// ------------------------------------------------------------
// প্রতি-অংশ সংশ্লেষণ
// ------------------------------------------------------------

/** প্রতি-অংশ HTTP সময়সীমা — টেস্টে ছোট করা যায় */
let segTimeoutMs = 15_000;

/** [শুধু টেস্ট] টাইমআউট ছোট করা */
export function setGoogleTtsTimeoutForTests(ms: number): void {
  segTimeoutMs = Math.max(20, Math.floor(ms));
}

/** পুনঃচেষ্টার অপেক্ষা (ms) — টেস্টে ছোট করা যায় (ঘুম-অপচয় এড়াতে) */
let retryWaitMs = 0;

/** [শুধু টেস্ট] পুনঃচেষ্টার অপেক্ষা নিয়ন্ত্রণ */
export function setGoogleTtsRetryWaitForTests(ms: number): void {
  retryWaitMs = Math.max(0, Math.floor(ms));
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';

/** MP3 ফ্রেম-সিঙ্ক যাচাই (প্রথম বাইট 0xFF + পরেরটির উপরের ৩ বিট সেট) */
function looksLikeMp3(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

/**
 * টাইপড ব্যর্থতা-শ্রেণি — language_controller-এর classifyEngineFailure
 * যেন নির্ভরযোগ্যভাবে ধরতে পারে সেই বার্তা-নিয়মে।
 */
function httpFailureMessage(status: number, ctx: string): string {
  if (status === 429) return `Google TTS রেট-লিমিট (HTTP 429) — ${ctx}`;
  if (status === 403 || status === 401) return `Google TTS প্রমাণীকরণ/নীতি-ব্লক (HTTP ${status}) — ${ctx}`;
  if (status === 404) return `Google TTS endpoint পাওয়া যায়নি (HTTP 404) — ${ctx}`;
  if (status >= 500) return `Google TTS সার্ভার-ত্রুটি (HTTP ${status}) — ${ctx}`;
  return `Google TTS ব্যর্থ (HTTP ${status}) — ${ctx}`;
}

async function synthesizeSegmentGoogle(segment: string, speed: number): Promise<Buffer> {
  const url =
    'https://translate.google.com/translate_tts' +
    `?ie=UTF-8&client=tw-ob&tl=bn&q=${encodeURIComponent(segment)}&ttsspeed=${speed}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), segTimeoutMs);
  try {
    const res = await fetcher(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://translate.google.com/',
      },
      signal: controller.signal,
    });
    if (res.status !== 200) {
      throw new Error(httpFailureMessage(res.status, `${res.contentType || 'no-content-type'}, ${res.body.length}B`));
    }
    if (!res.contentType.startsWith('audio/')) {
      throw new Error(
        `Google TTS অডিও-নয় প্রতিক্রিয়া (content-type "${res.contentType}") — সম্ভবত ব্লক/ক্যাপচা পাতা`
      );
    }
    if (res.body.length < 400) {
      throw new Error(`Google TTS অস্বাভাবিক ছোট অডিও (${res.body.length} বাইট)`);
    }
    if (!looksLikeMp3(res.body)) {
      throw new Error('Google TTS প্রতিক্রিয়া MP3 ফ্রেম-সিঙ্ক মেলেনি — করাপ্ট/ভুল বিন্যাস');
    }
    return res.body;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Google TTS সময়সীমা (${Math.round(segTimeoutMs / 1000)} সে.)`);
    }
    // fetch-নেটওয়ার্ক ত্রুটি — শ্রেণি-স্বীকৃত বার্তায় মোড়া
    if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET|EPIPE|socket|dns/i.test(msg)) {
      throw new Error(`Google TTS নেটওয়ার্ক-ত্রুটি: ${msg.slice(0, 120)}`);
    }
    throw err instanceof Error ? err : new Error(msg);
  } finally {
    clearTimeout(timer);
  }
}

export interface GoogleSpeechResult {
  /** MP3 (২৪kHz মনো) — খণ্ডগুলো ফ্রেম-কনক্যাট (প্লেয়ার/ffmpeg-নিরাপদ) */
  buffer: Buffer;
  mimeType: string;
  ext: 'mp3';
  voice: string;
  segments: number;
  generationMs: number;
  provider: typeof GOOGLE_TTS_PROVIDER;
  /** গতি≠১ ছিল কিন্তু প্রোভাইডার গতি মানে না — সৎ নোট-পতাকা */
  speedUnsupported: boolean;
}

/**
 * পাঠ্য → বাংলা কণ্ঠ (Google Translate TTS)। দীর্ঘ লেখা বাক্য-সীমায়
 * ভেঙে ধারাবাহিক সংশ্লেষণ; প্রতি অংশে ২ পুনঃচেষ্টা (429-এ দীর্ঘতর অপেক্ষা)।
 */
export async function synthesizeGoogleSpeech(
  text: string,
  voice: string,
  opts?: { speed?: number }
): Promise<GoogleSpeechResult> {
  if (!isGoogVoice(voice)) throw new Error(`Google TTS: অজানা কণ্ঠ "${voice}"`);
  const segments = splitForGoogle(text);
  if (segments.length === 0) throw new Error('Google TTS: লেখা খালি');
  const speed = opts?.speed ?? 1;
  // প্রোভাইডার ttsspeed-মান কেবল ০.২৪–১ মানে; অ্যাপ-স্কেলের ০.৫–২-এর
  // মানচিত্রণ অসৎ হবে — তাই >১ হলে সরবরাহ-সময় গতি উপেক্ষা + পতাকা।
  const speedUnsupported = speed > 1.001;
  const t0 = Date.now();
  const buffers: Buffer[] = [];
  for (const [i, seg] of segments.entries()) {
    let lastErr: unknown = null;
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        buffers.push(await synthesizeSegmentGoogle(seg, speedUnsupported ? 1 : Math.max(0.24, speed)));
        ok = true;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const rateLimited = /429|রেট-লিমিট/.test(msg);
        if (attempt < 2) {
          const base = rateLimited ? 1500 : attempt === 0 ? 600 : 1500;
          await new Promise(r => setTimeout(r, retryWaitMs > 0 ? Math.min(retryWaitMs, base) : base));
        }
      }
    }
    if (!ok) {
      const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
      throw new Error(
        segments.length > 1
          ? `Google TTS: অংশ ${i + 1}/${segments.length} ব্যর্থ — ${msg}`
          : `Google TTS ব্যর্থ — ${msg}`
      );
    }
  }
  return {
    buffer: Buffer.concat(buffers),
    mimeType: 'audio/mpeg',
    ext: 'mp3',
    voice,
    segments: segments.length,
    generationMs: Date.now() - t0,
    provider: GOOGLE_TTS_PROVIDER,
    speedUnsupported,
  };
}

// ------------------------------------------------------------
// স্বাস্থ্য-পরীক্ষা (ক্যাশ ৫ মিনিট; প্রোব কখনো GET-পথ থেকে ছুড়ে না)
// ------------------------------------------------------------

let healthCache: { at: number; ok: boolean; note: string } | null = null;

export function googleTtsHealthSnapshot(): { status: 'unknown' | 'up' | 'down'; at: string | null; note: string } {
  if (!healthCache) return { status: 'unknown', at: null, note: '' };
  return {
    status: healthCache.ok ? 'up' : 'down',
    at: new Date(healthCache.at).toISOString(),
    note: healthCache.note,
  };
}

/** দ্রুত সংযোগ-পরীক্ষা — এক শব্দের অডিও (ফলাফল ৫ মিনিট ক্যাশ) */
export async function googleTtsHealth(force = false): Promise<{ ok: boolean; note: string }> {
  if (!force && healthCache && Date.now() - healthCache.at < 5 * 60_000) {
    return { ok: healthCache.ok, note: healthCache.note };
  }
  try {
    const res = await synthesizeGoogleSpeech('স্বাস্থ্য।', GOOGLE_TTS_VOICE);
    const ok = res.buffer.length > 1000;
    const note = ok
      ? `সক্রিয় — বাংলা কণ্ঠ প্রতিক্রিয়া দিচ্ছে (${res.buffer.length} বাইট)`
      : 'প্রতিক্রিয়া অস্বাভাবিক ছোট';
    healthCache = { at: Date.now(), ok, note };
    await recordVoiceVerification({
      voice: GOOGLE_TTS_VOICE,
      engine: 'goog',
      language: 'bn',
      verdict: ok ? 'pass' : 'fail',
      transcript: '',
      similarity: 0,
      detectedLanguage: 'unknown',
      durationSec: 0,
      expectedSec: 0,
      note: note.slice(0, 160),
    }).catch(() => {});
    return { ok, note };
  } catch (err) {
    const note = `অনুপলব্ধ — ${err instanceof Error ? err.message.slice(0, 100) : 'অজানা'}`;
    healthCache = { at: Date.now(), ok: false, note };
    await recordVoiceVerification({
      voice: GOOGLE_TTS_VOICE,
      engine: 'goog',
      language: 'bn',
      verdict: 'fail',
      transcript: '',
      similarity: 0,
      detectedLanguage: 'unknown',
      durationSec: 0,
      expectedSec: 0,
      note: note.slice(0, 160),
    }).catch(() => {});
    return { ok: false, note };
  }
}
