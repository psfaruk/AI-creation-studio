// ============================================================
// SDK Helpers — z-ai-web-dev-sdk-কেন্দ্রিক শেয়ার্ড অ্যাডাপ্টার।
// টুল (registry) ও প্রোডাকশন পাইপলাইন দুই জায়গাতেই ব্যবহৃত।
// সার্ভার-সাইডেই ব্যবহৃত হয় (client-এ কখনো নয়)।
// ============================================================

import { getZAI } from './llm';
import type { LLMMessage } from './llm';

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

export interface SpeechResult {
  buffer: Buffer;
  mimeType: string; // audio/wav (সার্ভার mp3 না নিলে স্বয়ংক্রিয় wav fallback)
  ext: string;
}

/** TTS — mp3 চেষ্টা করে, সার্ভার সমর্থন না করলে wav-এ fallback */
export async function synthesizeSpeech(
  text: string,
  voice: 'tongtong' | 'jam' | 'kazi' = 'tongtong',
  speed = 1
): Promise<SpeechResult> {
  const zai = await getZAI();
  const attempt = async (format: 'mp3' | 'wav'): Promise<Buffer> => {
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
  };
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

/** ASR — অডিও বাফার → লেখা */
export async function transcribeBuffer(buffer: Buffer): Promise<string> {
  const zai = await getZAI();
  const r = await zai.audio.asr.create({ file_base64: buffer.toString('base64') });
  return String(r?.text ?? '').trim();
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
