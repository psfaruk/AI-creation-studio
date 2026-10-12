// ============================================================
// SDK Helpers — z-ai-web-dev-sdk-কেন্দ্রিক শেয়ার্ড অ্যাডাপ্টার।
// টুল (registry) ও প্রোডাকশন পাইপলাইন দুই জায়গাতেই ব্যবহৃত।
// সার্ভার-সাইডেই ব্যবহৃত হয় (client-এ কখনো নয়)।
// ============================================================

import { getZAI } from './llm';
import type { LLMMessage } from './llm';
import { withRetry, isRateLimitErrorText, TemporarilyUnavailableError } from './retry';
import { cloudSkipAdvised, type RateLimitChannel } from './rate-limit-coordinator';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFileCb);

// ------------------------------------------------------------
// S9 দ্রুত-গেট: চ্যানেল দীর্ঘ কুলডাউনে থাকলে ক্লাউড-চেষ্টাই বাদ —
// প্রতি শটে/ধাপে মিনিটের রিট্রাই-অপেক্ষা নয়; কলারের সৎ-ফলব্যাক
// (লোকাল ফ্রেম/নির্ধারক পরিকল্পনা) তৎক্ষণাৎ চালু হয়।
// ------------------------------------------------------------
function fastFailIfGated(channel: RateLimitChannel, label: string): void {
  if (cloudSkipAdvised(channel)) {
    throw new TemporarilyUnavailableError(
      `${label} — চ্যানেল দীর্ঘ রেট-লিমিট-কুলডাউনে; ক্লাউড-চেষ্টা স্কিপ (লোকাল-ফলব্যাকে যান)`
    );
  }
}

// §১০-র পুনঃচেষ্টা-নীতি এখন retry.ts-এ (বিশুদ্ধ মূল — llm.ts-ও ব্যবহার করে)।
// পুরনো সব ইমপোর্টারের জন্য এখান থেকে পুনঃ-রপ্তানি:
export {
  TemporarilyUnavailableError,
  isRateLimitErrorText,
  parseRetryAfterMs,
  fullJitterDelayMs,
  withRetry,
} from './retry';

// নোট: টুল-হেল্পারের ৪২৯/৫xx-নীতির বিস্তারিত ব্যাখ্যা retry.ts-এর শিরোনাম-টীকায়।

/** ছবি জেনারেশনের সমর্থিত মাপ */
export const IMAGE_SIZES = [
  '1024x1024',
  '768x1344',
  '864x1152',
  '1344x768',
  '1152x864',
  '1440x720',
  '720x1440',
] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface GeneratedImage {
  buffer: Buffer;
  size: ImageSize;
}

/**
 * টেক্সট থেকে ছবি তৈরি → Buffer (ফাইল সেভ করে না)।
 * S9: চ্যানেল 'image' — কুলডাউন-সৎ-অপেক্ষা + সিরিয়ালাইজড +
 * ৪২৯-ব্যাকঅফ (৩ চেষ্টা); নিঃশেষে TemporarilyUnavailableError।
 */
export async function generateImageBuffer(prompt: string, size: ImageSize = '1024x1024'): Promise<GeneratedImage> {
  fastFailIfGated('image', 'ছবি-জেনারেশন');
  const zai = await getZAI();
  return withRetry(
    async () => {
      const res = await zai.images.generations.create({ prompt, size });
      const base64 = res?.data?.[0]?.base64;
      if (!base64) throw new Error('ছবি তৈরি হলেও ডেটা পাওয়া যায়নি');
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length === 0) throw new Error('ছবির ডেটা খালি');
      return { buffer, size };
    },
    `ছবি-জেনারেশন (${size})`,
    2,
    4000,
    { channel: 'image', maxDelayMs: 30_000, cooldownBudgetMs: 30_000 }
  );
}

/**
 * বিদ্যমান ছবি সম্পাদনা (প্রম্পট-নির্দেশিত) → Buffer।
 * S9: চ্যানেল 'image' — generateImageBuffer-এর মতোই ৪২৯-সহনশীল।
 */
export async function editImageBuffer(
  imageDataUrl: string,
  prompt: string,
  size: ImageSize = '1024x1024'
): Promise<GeneratedImage> {
  fastFailIfGated('image', 'ছবি-সম্পাদনা');
  const zai = await getZAI();
  return withRetry(
    async () => {
      const res = await zai.images.generations.edit({
        prompt,
        images: [{ url: imageDataUrl }],
        size,
      } as any);
      const base64 = res?.data?.[0]?.base64;
      if (!base64) throw new Error('ছবি সম্পাদনার ফলাফল পাওয়া যায়নি');
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length === 0) throw new Error('সম্পাদিত ছবির ডেটা খালি');
      return { buffer, size };
    },
    `ছবি-সম্পাদনা (${size})`,
    2,
    4000,
    { channel: 'image', maxDelayMs: 30_000, cooldownBudgetMs: 30_000 }
  );
}

/** সম্পূর্ণ কণ্ঠ-তালিকা (TTS স্কিল-ডকুমেন্ট থেকে যাচাইকৃত) */
export const TTS_VOICES = ['tongtong', 'chuichui', 'xiaochen', 'jam', 'kazi', 'douji', 'luodo'] as const;
export type TtsVoice = (typeof TTS_VOICES)[number];

export interface SpeechResult {
  buffer: Buffer;
  mimeType: string; // audio/wav (সার্ভার mp3 না নিলে স্বয়ংক্রিয় wav fallback)
  ext: string;
}

/** TTS — mp3 চেষ্টা করে, সার্ভার সমর্থন না করলে wav-এ fallback (৪২৯-পুনঃচেষ্টাসহ) */
export async function synthesizeSpeech(
  text: string,
  voice: TtsVoice = 'tongtong',
  speed = 1
): Promise<SpeechResult> {
  fastFailIfGated('tts', 'TTS');
  const zai = await getZAI();
  const attempt = async (format: 'mp3' | 'wav'): Promise<Buffer> =>
    withRetry(
      async () => {
        const res = await zai.audio.tts.create({
          input: text,
          voice,
          speed,
          response_format: format,
          stream: false,
        });
        if (!res || typeof res.arrayBuffer !== 'function') {
          throw new Error('TTS প্রতিক্রিয়া পড়া যায়নি');
        }
        return Buffer.from(new Uint8Array(await res.arrayBuffer()));
      },
      `TTS (${voice}, ${format})`,
      5,
      20_000,
      // S9: চ্যানেল 'tts' — কুলডাউন-সৎ-অপেক্ষা + সিরিয়ালাইজড
      { channel: 'tts', maxDelayMs: 90_000 }
    );
  let buffer: Buffer;
  let ext = 'mp3';
  let mimeType = 'audio/mpeg';
  try {
    buffer = await attempt('mp3');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/response_format|1214/i.test(msg)) throw err;
    buffer = await attempt('wav');
    ext = 'wav';
    mimeType = 'audio/wav';
  }
  if (buffer.length === 0) throw new Error('অডিও ডেটা খালি এসেছে');
  // RIFF হেডার পেলে সঠিক wav
  if (ext === 'mp3' && buffer.length > 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF') {
    ext = 'wav';
    mimeType = 'audio/wav';
  }
  return { buffer, mimeType, ext };
}

/** ASR — একক কল (৪২৯-পুনঃচেষ্টাসহ) */
async function asrOnce(buffer: Buffer): Promise<string> {
  const zai = await getZAI();
  return withRetry(async () => {
    const r = await zai.audio.asr.create({ file_base64: buffer.toString('base64') });
    return String(r?.text ?? '').trim();
  }, 'ASR');
}

/**
 * ASR — অডিও বাফার → লেখা।
 * ASR সার্ভারের ৩০ সেকেন্ডের সীমা আছে — বড় ফাইল ২৮ সেকেন্ডের
 * খণ্ডে কেটে প্রতিটি আলাদাভাবে লিপিবদ্ধ করে জোড়া লাগানো হয়।
 */
export async function transcribeBuffer(buffer: Buffer, ext = 'wav'): Promise<string> {
  // দৈর্ঘ্য মাপা যায় এমন হলে ফাইলে লিখে ffprobe দিয়ে মাপি
  let durationSec = 0;
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'asr-'));
  try {
    const f = path.join(tmp, `in.${ext}`);
    await writeFile(f, buffer);
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', f],
        { timeout: 15_000 }
      );
      durationSec = Number(stdout.trim()) || 0;
    } catch {
      durationSec = 0;
    }
    if (durationSec > 0 && durationSec <= 29) {
      return await asrOnce(buffer);
    }
    if (durationSec === 0) {
      // দৈর্ঘ্য অজানা — সরাসরি চেষ্টা (৩০s-সীমার ভুল হলে নিচের পথে)
      try {
        return await asrOnce(buffer);
      } catch (err: any) {
        if (!/30|1214/i.test(String(err?.message ?? err))) throw err;
      }
    }
    // ২৮ সেকেন্ডের খণ্ডে কাটি (wav-এ নির্ভরযোগ্য)
    const segPattern = path.join(tmp, 'seg-%03d.wav');
    await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-y', '-i', f, '-ar', '16000', '-ac', '1', '-f', 'segment', '-segment_time', '28', segPattern],
      { timeout: 120_000 }
    );
    const segs = (await readdir(tmp)).filter(n => n.startsWith('seg-')).sort();
    if (segs.length === 0) return await asrOnce(buffer);
    const parts: string[] = [];
    for (const s of segs) {
      const segBuf = await readFileB(path.join(tmp, s));
      if (segBuf.length === 0) continue;
      try {
        parts.push(await asrOnce(segBuf));
      } catch {
        // খণ্ড ব্যর্থ হলে এগিয়ে যাই — আংশিক ট্রান্সক্রিপ্টই ভালো
      }
    }
    return parts.filter(Boolean).join(' ').trim();
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

async function readFileB(p: string): Promise<Buffer> {
  const { readFile: rf } = await import('fs/promises');
  return rf(p);
}

/** VLM — ছবি (data URL বা পাবলিক URL) → বর্ণনা/উত্তর */
export async function visionAnalyze(imageUrl: string, prompt: string): Promise<string> {
  const zai = await getZAI();
  const res = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  } as any);
  return String(res?.choices?.[0]?.message?.content ?? '').trim();
}

/** VLM — দুটি ছবি একসাথে তুলনা (ধারাবাহিকতা-যাচাইয়ের জন্য) */
export async function visionCompare(imageUrlA: string, imageUrlB: string, prompt: string): Promise<string> {
  const zai = await getZAI();
  const res = await zai.chat.completions.createVision({
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrlA } },
          { type: 'image_url', image_url: { url: imageUrlB } },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  } as any);
  return String(res?.choices?.[0]?.message?.content ?? '').trim();
}

export interface StructuredResult<T> {
  data: T | null;
  raw: string;
}

/**
 * LLM থেকে কাঠামোগত JSON আনা (tolerant পার্সার + একবার পুনঃচেষ্টা)।
 * পাইপলাইনের স্ক্রিপ্ট/ব্রেকডাউন/শট-প্ল্যান ধাপে ব্যবহৃত।
 *
 * S9: চ্যানেল 'chat' + ৪ চেষ্টা + max ৩০ সে. — পাইপলাইন-ধাপ দ্রুতই
 * সৎ-লোকাল-ফলব্যাকে যেতে পারে (দীর্ঘ অপেক্ষা পাইপলাইন আটকাবে না)।
 */
export async function chatJson<T>(messages: LLMMessage[], retry = 1): Promise<StructuredResult<T>> {
  fastFailIfGated('chat', 'LLM (কাঠামোগত JSON)');
  for (let attempt = 0; ; attempt++) {
    const zai = await getZAI();
    // §১০: নেটওয়ার্ক-স্তরের ৪২৯/৫xx/টাইমআউট withRetry-তে (Retry-After + full-jitter);
    // নিচের লুপ কেবল JSON-পার্স-পুনঃচেষ্টার জন্য
    const raw = await withRetry(async () => {
      const res = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      });
      return String(res?.choices?.[0]?.message?.content ?? '');
    }, 'LLM (কাঠামোগত JSON)', 4, 4000, { channel: 'chat', maxDelayMs: 30_000, cooldownBudgetMs: 45_000 });
    const parsed = extractJson<T>(raw);
    if (parsed !== null) return { data: parsed, raw };
    if (attempt >= retry) return { data: null, raw };
    // পুনঃচেষ্টার নির্দেশনা
    messages = [
      ...messages,
      { role: 'assistant', content: raw.slice(0, 2000) },
      {
        role: 'user',
        content: 'শুধুমাত্র একটি বৈধ JSON অবজেক্ট দিয়ে উত্তর দাও — অন্য কোনো লেখা নয়।',
      },
    ];
  }
}

/** টেক্সট থেকে প্রথম বৈধ JSON অবজেক্ট বের করে */
export function extractJson<T>(text: string): T | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const candidates: string[] = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]?.trim()) candidates.push(fence[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T;
    } catch {
      // পরের ক্যান্ডিডেট
    }
  }
  return null;
}

// ------------------------------------------------------------
// ওয়েব-ছবি অনুসন্ধান — SDK-প্রথম, CLI-ফলব্যাক (Sprint-2, §১০)
// প্রোব-যাচাইকৃত (২০২৬-১০-১১): zai.images.search.create কাজ করে
// (৩ ফলাফল ৯.৫ সে.-এ) — এখন প্রাথমিক পথ; CLI কেবল ফলব্যাক।
// ------------------------------------------------------------

export interface ImageSearchHit {
  url: string;
  caption: string;
  source: string;
  width?: number;
  height?: number;
}

export interface ImageSearchOutcome {
  results: ImageSearchHit[];
  /** কোন পথ থেকে এল — SDK-মেথড নাকি CLI */
  via: 'sdk' | 'cli';
}

/** SDK/CLI-উভয় পথের সাড়া একই স্বাভাবিক-আকৃতিতে */
function normalizeImageSearchResults(raw: any): ImageSearchHit[] {
  const list: any[] = Array.isArray(raw?.results) ? raw.results : [];
  const hits: ImageSearchHit[] = [];
  for (const r of list) {
    if (!r?.original_url) continue;
    const w = Number(r.original_width);
    const h = Number(r.original_height);
    hits.push({
      url: String(r.original_url),
      caption: String(r.caption ?? ''),
      source: String(r.source ?? ''),
      ...(Number.isFinite(w) && w > 0 ? { width: Math.round(w) } : {}),
      ...(Number.isFinite(h) && h > 0 ? { height: Math.round(h) } : {}),
    });
  }
  return hits;
}

/**
 * ওয়েব-ছবি অনুসন্ধান — প্রাথমিক পথ SDK-মেথড
 * (`zai.images.search.create({query, count, gl:'us', rank:false})`),
 * ব্যর্থ হলে CLI-ফলব্যাক (`z-ai image-search -q … -c … --gl us --no-rank`,
 * ≥১৫০ সে. টাইমআউট, stdout থেকে JSON বের করা)।
 * ৪২৯/রেট-লিমিটে সৎ-রায়: TemporarilyUnavailableError (লাইসেন্স-সমস্যা নয়)।
 */
export async function imageSearchSdkFirst(query: string, count = 4): Promise<ImageSearchOutcome> {
  const q = query.trim().slice(0, 400);
  if (!q) throw new Error('ছবি-সার্চের প্রশ্ন খালি');

  // ১) SDK-পথ (প্রাথমিক) — হালকা পুনঃচেষ্টাসহ
  let sdkNote = '';
  try {
    const zai = await getZAI();
    const hits = await withRetry(
      async () => {
        const r = await zai.images.search.create({ query: q, count, gl: 'us', rank: false } as any);
        const normalized = normalizeImageSearchResults(r);
        if (normalized.length === 0) {
          throw new Error(`SDK-ফলাফলে কোনো ছবি নেই${r?.error ? ` (${String(r.error).slice(0, 160)})` : ''}`);
        }
        return normalized;
      },
      `ছবি-সার্চ SDK (${q.slice(0, 40)})`,
      3,
      5000,
      { channel: 'search', maxDelayMs: 60_000 }
    );
    return { results: hits, via: 'sdk' };
  } catch (sdkErr) {
    sdkNote = (sdkErr instanceof Error ? sdkErr.message : String(sdkErr)).slice(0, 160);
  }

  // ২) CLI-ফলব্যাক — একই পরিষেবা, ভিন্ন ট্রান্সপোর্ট
  const cliPath = path.join(process.cwd(), 'node_modules', '.bin', 'z-ai');
  try {
    const res = await execFileAsync(
      cliPath,
      ['image-search', '-q', q, '-c', String(count), '--gl', 'us', '--no-rank'],
      { timeout: 150_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const first = res.stdout.indexOf('{');
    const last = res.stdout.lastIndexOf('}');
    if (first === -1 || last <= first) throw new Error('CLI-আউটপুটে JSON পাওয়া যায়নি');
    const parsed = JSON.parse(res.stdout.slice(first, last + 1));
    const hits = normalizeImageSearchResults(parsed);
    if (hits.length === 0) {
      throw new Error(`CLI-ফলাফলে কোনো ছবি নেই${parsed?.error ? ` (${String(parsed.error).slice(0, 160)})` : ''}`);
    }
    return { results: hits, via: 'cli' };
  } catch (cliErr: any) {
    const cliMsg = String(cliErr?.stderr || cliErr?.stdout || cliErr?.message || cliErr).slice(0, 200);
    // ৪২৯/রেট-লিমিট সাময়িক-অনুপলব্ধতা — কখনোই লাইসেন্স-সমস্যা নয় (§১০)
    if (isRateLimitErrorText(cliMsg) || /TEMPORARILY_UNAVAILABLE/.test(sdkNote)) {
      throw new TemporarilyUnavailableError(
        `ছবি-সার্চ সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট) — SDK: ${sdkNote} | CLI: ${cliMsg}`
      );
    }
    throw new Error(`ছবি সার্চ ব্যর্থ (SDK: ${sdkNote} | CLI: ${cliMsg})`);
  }
}

/** সাধারণ টেক্সট সম্পূর্ণতা (chatComplete-এর সরাসরি ব্যবহার) */
export { chatComplete } from './llm';
