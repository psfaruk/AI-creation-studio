// ============================================================
// SDK Helpers — z-ai-web-dev-sdk-কেন্দ্রিক শেয়ার্ড অ্যাডাপ্টার।
// টুল (registry) ও প্রোডাকশন পাইপলাইন দুই জায়গাতেই ব্যবহৃত।
// সার্ভার-সাইডেই ব্যবহৃত হয় (client-এ কখনো নয়)।
// ============================================================

import { getZAI } from './llm';
import type { LLMMessage } from './llm';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFileCb);

// ------------------------------------------------------------
// টুল-হেল্পার: ৪২৯/৫xx-সহনশীল পুনঃচেষ্টা (সব SDK কলের জন্য)
// ------------------------------------------------------------

/** ৪২৯/৫xx হলে ব্যাকঅফ-সহ পুনঃচেষ্টা — TTS/ASR-এর ক্ষেত্রে খুব দরকার */
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 4, baseMs = 4000): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      lastErr = err;
      if (i === attempts - 1) break;
      if (!/429|Too many|\b5\d{2}\b|timeout/i.test(msg)) throw err;
      await new Promise(r => setTimeout(r, baseMs * (i + 1)));
    }
  }
  throw new Error(`${label} — সব পুনঃচেষ্টা ব্যর্থ: ${String((lastErr as any)?.message ?? lastErr).slice(0, 200)}`);
}

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

/** টেক্সট থেকে ছবি তৈরি → Buffer (ফাইল সেভ করে না) */
export async function generateImageBuffer(prompt: string, size: ImageSize = '1024x1024'): Promise<GeneratedImage> {
  const zai = await getZAI();
  const res = await zai.images.generations.create({ prompt, size });
  const base64 = res?.data?.[0]?.base64;
  if (!base64) throw new Error('ছবি তৈরি হলেও ডেটা পাওয়া যায়নি');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw new Error('ছবির ডেটা খালি');
  return { buffer, size };
}

/** বিদ্যমান ছবি সম্পাদনা (প্রম্পট-নির্দেশিত) → Buffer */
export async function editImageBuffer(
  imageDataUrl: string,
  prompt: string,
  size: ImageSize = '1024x1024'
): Promise<GeneratedImage> {
  const zai = await getZAI();
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
      20_000
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
 */
export async function chatJson<T>(messages: LLMMessage[], retry = 1): Promise<StructuredResult<T>> {
  for (let attempt = 0; ; attempt++) {
    const zai = await getZAI();
    let raw = '';
    try {
      const res = await zai.chat.completions.create({
        messages,
        thinking: { type: 'disabled' },
      });
      raw = String(res?.choices?.[0]?.message?.content ?? '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 1 && /429|rate limit|\b5\d{2}\b|timeout/i.test(msg)) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      throw err;
    }
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

/** সাধারণ টেক্সট সম্পূর্ণতা (chatComplete-এর সরাসরি ব্যবহার) */
export { chatComplete } from './llm';
