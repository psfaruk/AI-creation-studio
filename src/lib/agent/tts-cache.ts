// ============================================================
// TTS ডিস্ক-ক্যাশ + in-flight ডিডুপ — নতুন পরিকল্পনা §১১
// (৪২৯-নির্ভরযোগ্যতা: নিরাপদ জায়গায় ক্যাশে-করা আউটপুট + ডুপ্লিকেট-কাজ প্রতিরোধ)
//
// নীতি:
//  - একই (voice, speed, text) জোড়ার TTS ফল ডিস্কে থাকলে আর API কল হয় না
//    — ৪২৯-ঝুঁকি ও খরচ কমে; TTS নির্দিষ্ট-ইনপুট-নির্ধারক, তাই ক্যাশ নিরাপদ।
//  - একই মুহূর্তে একই জোড়ার দুটি অনুরোধ এলে একটিই API কল চলে (in-flight ম্যাপ);
//    দ্বিতীয়টি সেই Promise-এ যোগ দেয় — ডুপ্লিকেট কাজ নয়।
//  - ক্যাশ-লেখা সর্বোচ্চ-প্রচেষ্টা: ডিস্ক-ব্যর্থতায় কল কখনো ব্যর্থ হবে না।
//  - sdk-helpers.ts-এর synthesizeSpeech অপরিবর্তিত (খাঁটি API-পথ);
//    স্বাস্থ্য-পরীক্ষা (system-info) ও ভাষা-নিয়ন্ত্রক চুক্তির জন্য সেটিই ব্যবহৃত হয়।
//    (ইমপোর্ট-চক্র এড়াতে sdk-helpers কখনো এই ফাইল ইমপোর্ট করে না।)
// ============================================================

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { synthesizeSpeech } from './sdk-helpers';
import type { SpeechResult, TtsVoice } from './sdk-helpers';

const PROJECT_ROOT = process.cwd();
/** ক্যাশ-গুচ্ছ: storage/tts-cache/<প্রথম২>/<পরের২>/<পূর্ণহ্যাশ>.<ext> + .meta.json */
const TTS_CACHE_DIR = path.join(PROJECT_ROOT, 'storage', 'tts-cache');

export interface TtsCacheStats {
  /** ডিস্ক-ক্যাশ থেকে ফেরত আসা কল */
  hits: number;
  /** প্রকৃত API-কলে যাওয়া কল */
  misses: number;
  /** এই মুহূর্তে চলমান অনন্য TTS-কাজ (ডিডুপ-যোগদানকারী বাদে) */
  inFlight: number;
}

interface TtsCacheMeta {
  voice: string;
  speed: number;
  mimeType: string;
  ext: string;
  createdAt: string;
  chars: number;
}

// HMR-নিরাপদ গ্লোবাল অবস্থা (system-info-এর healthCache-প্যাটার্ন)
const g = globalThis as any;

function stats(): TtsCacheStats {
  if (!g.__ttsCacheStats) g.__ttsCacheStats = { hits: 0, misses: 0, inFlight: 0 };
  return g.__ttsCacheStats;
}

/** ক্যাশ-পরিসংখ্যান (UI/API-তে দেখানোর জন্য কপি) */
export function ttsCacheStats(): TtsCacheStats {
  const s = stats();
  return { hits: s.hits, misses: s.misses, inFlight: s.inFlight };
}

/** চলমান কাজের ম্যাপ: ক্যাশ-কী → Promise (ডুপ্লিকেট-কাজ প্রতিরোধ, §১১) */
function inFlightMap(): Map<string, Promise<SpeechResult>> {
  if (!g.__ttsCacheInFlight) g.__ttsCacheInFlight = new Map<string, Promise<SpeechResult>>();
  return g.__ttsCacheInFlight as Map<string, Promise<SpeechResult>>;
}

/** ক্যাশ-কী: sha1(`${voice}|${speed.toFixed(2)}|${text}`) */
function cacheKey(text: string, voice: TtsVoice, speed: number): string {
  return createHash('sha1').update(`${voice}|${speed.toFixed(2)}|${text}`).digest('hex');
}

/** <dir> = storage/tts-cache/<hash-এর প্রথম ২>/<পরের ২>; ফাইল-নামের ভিত্তি = পূর্ণ হ্যাশ */
function cachePaths(hash: string): { dir: string; base: string } {
  return {
    dir: path.join(TTS_CACHE_DIR, hash.slice(0, 2), hash.slice(2, 4)),
    base: hash,
  };
}

/** ডিস্ক থেকে ক্যাশে-পাওয়া ফল — মেটা-সাইডকার + অডিও উভয় লাগবে; না থাকলে null */
async function readFromCache(hash: string): Promise<SpeechResult | null> {
  try {
    const { dir, base } = cachePaths(hash);
    const metaRaw = await readFile(path.join(dir, `${base}.meta.json`), 'utf8');
    const meta = JSON.parse(metaRaw) as TtsCacheMeta;
    if (!meta?.ext || !meta?.mimeType) return null;
    const buffer = await readFile(path.join(dir, `${base}.${meta.ext}`));
    if (buffer.length === 0) return null;
    return { buffer, mimeType: meta.mimeType, ext: meta.ext };
  } catch {
    return null; // মিস বা ত্রুটিপূর্ণ এন্ট্রি — কলার-কে জানাব না, নতুন করে বানাব
  }
}

/** ক্যাশে লেখা — সর্বোচ্চ-প্রচেষ্টা: ব্যর্থ হলেও নীরব (কল কখনো ব্যর্থ হবে না) */
async function writeToCache(
  hash: string,
  text: string,
  voice: TtsVoice,
  speed: number,
  result: SpeechResult
): Promise<void> {
  try {
    const { dir, base } = cachePaths(hash);
    await mkdir(dir, { recursive: true });
    const meta: TtsCacheMeta = {
      voice,
      speed,
      mimeType: result.mimeType,
      ext: result.ext,
      createdAt: new Date().toISOString(),
      chars: text.length,
    };
    await writeFile(path.join(dir, `${base}.${result.ext}`), result.buffer);
    await writeFile(path.join(dir, `${base}.meta.json`), JSON.stringify(meta), 'utf8');
  } catch {
    // ইচ্ছাকৃত নীরবতা — ক্যাশ-লেখা ব্যর্থতা মূল ফলাফলকে স্পর্শ করবে না
  }
}

/**
 * ক্যাশে-সহ কণ্ঠ-সংশ্লেষণ — synthesizeSpeech-এর সমান চুক্তি
 * (SpeechResult: buffer/mimeType/ext), শুধু আগে-ক্যাশ-পরে-API।
 * ব্যবহারকারীমুখী পথে (প্রোডাকশন পাইপলাইন) পুনরাবৃত্ত বিষয়বস্তুতে
 * এটিই ব্যবহার করুন; স্বাস্থ্য-পরীক্ষা/ভাষা-নিয়ন্ত্রক-যাচাই চুক্তির জন্য
 * খাঁটি synthesizeSpeech থাকবে।
 */
export async function cachedSynthesizeSpeech(
  text: string,
  voice: TtsVoice = 'tongtong',
  speed = 1
): Promise<SpeechResult> {
  const key = cacheKey(text, voice, speed);
  const map = inFlightMap();

  // ১) একই কাজ ইতিমধ্যে চলছে — সেই Promise-এ যোগ দিই (§১১ ডুপ্লিকেট-প্রতিরোধ)
  const running = map.get(key);
  if (running) return running;

  stats().inFlight++;
  const job = (async (): Promise<SpeechResult> => {
    // ২) ডিস্ক-ক্যাশে আছে কি না
    const cached = await readFromCache(key);
    if (cached) {
      stats().hits++;
      return cached;
    }
    stats().misses++;
    // ৩) প্রকৃত API-কল (৪২৯-পুনঃচেষ্টাসহ) + সফল হলে ক্যাশে লেখা (best-effort)
    const result = await synthesizeSpeech(text, voice, speed);
    await writeToCache(key, text, voice, speed, result);
    return result;
  })();

  map.set(key, job);
  try {
    return await job;
  } finally {
    map.delete(key);
    stats().inFlight--;
  }
}
