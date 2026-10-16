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
//
// ২০২৬-১০-১৩ (বাংলা-ভাষা সমাধান): কণ্ঠ-নাম Edge-নিউরাল হলে
// (bn-BD-NabanitaNeural ইত্যাদি) Microsoft Edge TTS-এ যায়, নয়তো
// z-ai SDK-তে — একই ক্যাশ + একই চুক্তিতে। ইঞ্জিন-নাম ক্যাশ-কীতে
// জড়িত নয় (কণ্ঠ-নামই ইঞ্জিন নির্ধারণ করে), তাই পুরনো ক্যাশ বৈধ থাকে।
// ============================================================

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { synthesizeSpeech } from './sdk-helpers';
import type { SpeechResult, TtsVoice } from './sdk-helpers';
import { isEdgeVoice, synthesizeEdgeSpeech, type EdgeVoiceId } from './audio/edge_tts';

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
  engine: 'edge' | 'zai';
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
function cacheKey(text: string, voice: string, speed: number): string {
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
  voice: string,
  engine: 'edge' | 'zai',
  speed: number,
  result: SpeechResult
): Promise<void> {
  try {
    const { dir, base } = cachePaths(hash);
    await mkdir(dir, { recursive: true });
    const meta: TtsCacheMeta = {
      voice,
      engine,
      speed,
      mimeType: result.mimeType,
      ext: result.ext,
      createdAt: new Date().toISOString(),
      chars: text.length,
    };
    await writeFile(path.join(dir, `${base}.${result.ext}`), result.buffer);
    await writeFile(path.join(dir, `${base}.meta.json`), JSON.stringify(meta), 'utf8');
    // A1-F04 (R-FIX-1): প্রতি ২০তম লেখায় আকার-পরিস্রাবণ (best-effort, নীরব)
    const wc = writeCounter();
    wc.n += 1;
    if (wc.n % 20 === 0) await sweepCacheIfLarge();
  } catch {
    // ইচ্ছাকৃত নীরবতা — ক্যাশ-লেখা ব্যর্থতা মূল ফলাফলকে স্পর্শ করবে না
  }
}

// ------------------------------------------------------------
// A1-F04 (R-FIX-1): সীমাবদ্ধ আকার — ২৫৬ MiB ছাড়লে পুরোনো এন্ট্রি মুছে
// ২২৪ MiB-এ নামে (createdAt-ভিত্তিক LRU; শট-ক্যাশের আকার-সীমা-নীতির আলোকে)।
// ডিস্ক-ব্যর্থতা সর্বদা নীরব — মূল কলকে স্পর্শ করবে না।
// ------------------------------------------------------------
const TTS_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const TTS_CACHE_TARGET_BYTES = 224 * 1024 * 1024;

function writeCounter(): { n: number } {
  const g2 = globalThis as any;
  if (!g2.__ttsCacheWriteCount) g2.__ttsCacheWriteCount = { n: 0 };
  return g2.__ttsCacheWriteCount;
}

async function sweepCacheIfLarge(): Promise<void> {
  try {
    const entries: { dir: string; base: string; size: number; createdAt: string }[] = [];
    const walk = async (dir: string): Promise<void> => {
      let names: string[] = [];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const p = path.join(dir, name);
        let st;
        try {
          st = await stat(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) {
          await walk(p);
        } else if (name.endsWith('.meta.json')) {
          try {
            const meta = JSON.parse(await readFile(p, 'utf8')) as TtsCacheMeta;
            const base = name.replace(/\.meta\.json$/, '');
            let audioSize = 0;
            try {
              audioSize = (await stat(path.join(dir, `${base}.${meta.ext}`))).size;
            } catch {}
            entries.push({ dir, base, size: st.size + audioSize, createdAt: meta.createdAt ?? '' });
          } catch {}
        }
      }
    };
    await walk(TTS_CACHE_DIR);
    const total = entries.reduce((s, e) => s + e.size, 0);
    if (total <= TTS_CACHE_MAX_BYTES) return;
    entries.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)); // পুরোনো আগে
    let toFree = total - TTS_CACHE_TARGET_BYTES;
    for (const e of entries) {
      if (toFree <= 0) break;
      try {
        for (const name of await readdir(e.dir)) {
          if (name.startsWith(e.base)) await rm(path.join(e.dir, name), { force: true });
        }
        toFree -= e.size;
      } catch {}
    }
  } catch {
    // ইচ্ছাকৃত নীরবতা — পরিস্রাবণ-ব্যর্থতা মূল কলকে স্পর্শ করবে না
  }
}

/**
 * কণ্ঠ-অনুযায়ী ইঞ্জিন-নির্বাচন ছাড়াই মূল সংশ্লেষণ:
 * Edge-নিউরাল নাম → Microsoft Edge TTS; অন্য সব → z-ai SDK।
 */
async function synthRaw(text: string, voice: string, speed: number): Promise<SpeechResult & { engine: 'edge' | 'zai' }> {
  if (isEdgeVoice(voice)) {
    const res = await synthesizeEdgeSpeech(text, voice as EdgeVoiceId, { speed });
    return { buffer: res.buffer, mimeType: res.mimeType, ext: res.ext, engine: 'edge' };
  }
  const res = await synthesizeSpeech(text, voice as TtsVoice, speed);
  return { ...res, engine: 'zai' };
}

/**
 * ক্যাশে-সহ কণ্ঠ-সংশ্লেষণ — যেকোনো বৈধ কণ্ঠ (Edge-নিউরাল বা z-ai)।
 * (SpeechResult: buffer/mimeType/ext), শুধু আগে-ক্যাশ-পরে-API।
 * ব্যবহারকারীমুখী পথে (প্রোডাকশন পাইপলাইন) পুনরাবৃত্ত বিষয়বস্তুতে
 * এটিই ব্যবহার করুন; স্বাস্থ্য-পরীক্ষার জন্য খাঁটি synthesizeSpeech থাকবে।
 */
export async function cachedSynthesizeSpeech(
  text: string,
  voice: string = 'tongtong',
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
    // ৩) প্রকৃত API-কল (ইঞ্জিন-সচেতন) + সফল হলে ক্যাশে লেখা (best-effort)
    const result = await synthRaw(text, voice, speed);
    await writeToCache(key, text, voice, result.engine, speed, result);
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
