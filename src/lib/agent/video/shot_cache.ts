// ============================================================
// Shot cache — Phase-3 Workstream C (P0-BUG-04)
//
// সফল AI-ভিডিও শটের ক্রস-রান পুনঃব্যবহার। নীতিমালা (implementation-
// design.md §3):
//  - ক্যাশ-কী = প্রোভাইডার-অনুরোধের **সম্পূর্ণ ফিঙ্গারপ্রিন্ট** (স্কিমা
//    সংস্করণ + মডেল + প্রম্পট + স্থায়িত্ব + গুণমান + রেফারেন্স-ছবির
//    হ্যাশ + with_audio + size) — প্রম্পট-টেক্সট একা কখনো কী নয়।
//  - width/height/fps ইচ্ছাকৃতভাবে কী-তে নেই: ওগুলো প্রোভাইডার-ইনপুট
//    নয়, লোকাল ffmpeg-স্বাভাবিকীকরণ — হিটের পরেও নির্ধারকভাবে পুনঃপ্রয়োগ
//    হয়, তাই চূড়ান্ত ক্লিপ অভিন্ন থাকে।
//  - শুধু completed+validated ক্লিপ জমা হয় (generateVideoClip-এর যাচাইয়ের
//    পরে); পড়ার সময়েও পুনঃযাচাই (validator ইনজেক্ট করা হয় — আমদানি-
//    চক্র নেই)।
//  - পথ-নিরাপত্তা: ডিস্কের নাম কেবল ৬৪-অক্ষরের হেক্স ফিঙ্গারপ্রিন্ট —
//    ব্যবহারকারী-নিয়ন্ত্রিত পথ অসম্ভব।
//  - সমবর্তীতা: in-flight ডিডুপ (একই ফিঙ্গারপ্রিন্টের দ্বিতীয় কল চলমান
//    প্রমিজে যোগ দেয়) + .tmp→rename পরমাণু-লেখা।
//  - ক্যাশ ≠ টেম্প: রুট storage/shot-cache/ — storage/productions/{id}-এর
//    rm -rf কখনো এখানে পৌঁছায় না। আকার-বাজেট 512 MiB, পুরোনো-আগে
//    উচ্ছেদ, evictions-কাউন্টারসহ।
//  - সততা: সাশ্রয়ের দাবি কেবল বাস্তব কাউন্টারে (shotCacheStats)।
// ============================================================

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** ক্যাশ-স্কিমা সংস্করণ — অনুরোধ-গঠন/যাচাই/কোডেক বদলালে বাড়াও = পুরোনো এন্ট্রি স্বয়ংক্রিয় বাতিল */
export const SHOT_CACHE_SCHEMA_VERSION = 1;

/** ডিফল্ট ডিস্ক-বাজেট (বাইট) — পরীক্ষায় globalThis.__shotCacheMaxBytes দিয়ে ওভাররাইড */
export const SHOT_CACHE_MAX_BYTES = 512 * 1024 * 1024;

const MEDIA_EXT = 'mp4';

// HMR-নিরাপহ গ্লোবাল অবস্থা (tts-cache/ইভেন্ট-বাসের একই প্যাটার্ন)
const g = globalThis as unknown as {
  __shotCacheStats?: ShotCacheStats;
  __shotCacheInFlight?: Map<string, Promise<unknown>>;
  __shotCacheRootOverride?: string;
  __shotCacheMaxBytes?: number;
};

export interface ShotCacheStats {
  /** ডিস্ক-ক্যাশ থেকে ফেরত আসা কল (প্রোভাইডার কল এড়ানো হয়েছে) */
  hits: number;
  /** চলমান একই-ফিঙ্গারপ্রিন্ট কাজে যোগ দেওয়া কল (প্রোভাইডার কল এড়ানো হয়েছে) */
  joined: number;
  /** প্রকৃত প্রোভাইডার-সাবমিটে যাওয়া কল */
  misses: number;
  /** ক্যাশ বাইপাস (opt-out) কল */
  bypass: number;
  /** পাওয়া-মাত্রেই ভুল/ত্রুটিপূর্ণ বলে বাতিল হওয়া এন্ট্রি */
  invalid: number;
  /** সফল জমা */
  stores: number;
  /** বাজেট-সীমায় উচ্ছেদকৃত এন্ট্রি */
  evictions: number;
  /** বর্তমানে জমা বাইট (কাউন্টার-ট্র্যাকড) */
  bytesStored: number;
  /** বর্তমান এন্ট্রি-সংখ্যা (কাউন্টার-ট্র্যাকড) */
  entries: number;
}

function stats(): ShotCacheStats {
  if (!g.__shotCacheStats) {
    g.__shotCacheStats = {
      hits: 0, joined: 0, misses: 0, bypass: 0, invalid: 0, stores: 0,
      evictions: 0, bytesStored: 0, entries: 0,
    };
  }
  return g.__shotCacheStats;
}

/** পর্যবেক্ষণ-কপি (UI/API/রিপোর্টের জন্য) — সাশ্রয়ের দাবি কেবল এর ভিত্তিতে */
export function shotCacheStats(): ShotCacheStats {
  return { ...stats() };
}

/** শুধু টেস্ট-ভিত্তিক রিসেট (tests/README.md বিচ্ছিন্নতা-চুক্তির জন্য) */
export function resetShotCacheStatsForTests(): void {
  g.__shotCacheStats = undefined;
}

/** কলার-সাইড গণনার সহায়ক: বাইপাস-কল (ai_video থেকে) */
export function noteShotCacheBypass(): void {
  stats().bypass++;
}

/** কলার-সাইড গণনার সহায়ক: মিস হয়ে প্রোভাইডারে যাওয়া কল (ai_video থেকে) */
export function noteShotCacheMiss(): void {
  stats().misses++;
}

function cacheRoot(): string {
  return g.__shotCacheRootOverride ?? path.join(process.cwd(), 'storage', 'shot-cache');
}

function maxBytes(): number {
  return g.__shotCacheMaxBytes ?? SHOT_CACHE_MAX_BYTES;
}

function inflightMap(): Map<string, Promise<unknown>> {
  if (!g.__shotCacheInFlight) g.__shotCacheInFlight = new Map();
  return g.__shotCacheInFlight;
}

// ------------------------------------------------------------
// ফিঙ্গারপ্রিন্ট — প্রোভাইডার-অনুরোধের ক্যাননিকাল সিরিয়ালাইজেশন
// ------------------------------------------------------------

/** কী-তে যা যা ঢোকে — প্রতিটি ঘোষণা-সহ (implementation-design.md §3.3) */
export interface ShotFingerprintInput {
  /** ক্যাশ-স্কিমা সংস্করণ (SHOT_CACHE_SCHEMA_VERSION) */
  v: number;
  /** প্রোভাইডার মডেল-নাম (AI_VIDEO_MODEL) */
  model: string;
  /** প্রম্পট — যা আসলে পাঠানো হয় (স্লাইস+ট্রিমের পরে) */
  prompt: string;
  /** স্থায়িত্ব — ক্ল্যাম্প-গ্রিডের মান যা পাঠানো হয় (5|10) */
  durationSec: number;
  /** গুণমান — যা পাঠানো হয় ('speed'|'quality') */
  quality: string;
  /** i2v রেফারেন্স (data-URL বা URL) — না থাকলে null */
  imageUrl: string | null;
  /** মডেলের নিজস্ব অডিও চাওয়া হয়েছিল কি না */
  withAudio: boolean;
  /** সাইজ-প্যারামিটার — না থাকলে null */
  size: string | null;
}

export interface ShotFingerprint {
  /** ক্যাননিকাল JSON (নির্দিষ্ট কী-ক্রম) */
  json: string;
  /** sha256-হেক্স (৬৪ অক্ষর) — এটিই ডিস্ক-নাম */
  sha256: string;
}

/** ক্যাননিকাল সিরিয়ালাইজেশন → sha256। কী-ক্রম স্থির; মান হুবহু অনুরোধের। */
export function shotCacheFingerprint(input: ShotFingerprintInput): ShotFingerprint {
  const json = JSON.stringify({
    v: input.v,
    model: input.model,
    prompt: input.prompt,
    durationSec: input.durationSec,
    quality: input.quality,
    imageUrlSha256: input.imageUrl == null ? null : createHash('sha256').update(input.imageUrl).digest('hex'),
    withAudio: input.withAudio,
    size: input.size,
  });
  return { json, sha256: createHash('sha256').update(json).digest('hex') };
}

// ------------------------------------------------------------
// ডিস্ক-বিন্যাস: <root>/<প্রথম২>/<পরের২>/<hash>.mp4 + <hash>.meta.json
// (tts-cache-এর শার্ডিং-প্যাটার্ন) — পথে কখনোই ইনপুট-স্ট্রিং বসে না
// ------------------------------------------------------------

function assertHexSha(sha: string): void {
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`shot-cache: অবৈধ ফিঙ্গারপ্রিন্ট (হেক্স-৬৪ প্রত্যাশিত): ${sha.slice(0, 80)}`);
  }
}

function entryPaths(sha: string): { dir: string; media: string; meta: string; tmpMedia: string; tmpMeta: string } {
  assertHexSha(sha);
  const dir = path.join(cacheRoot(), sha.slice(0, 2), sha.slice(2, 4));
  return {
    dir,
    media: path.join(dir, `${sha}.${MEDIA_EXT}`),
    meta: path.join(dir, `${sha}.meta.json`),
    tmpMedia: path.join(dir, `.${sha}.${MEDIA_EXT}.tmp`),
    tmpMeta: path.join(dir, `.${sha}.meta.json.tmp`),
  };
}

interface ShotCacheMeta {
  v: number;
  model: string;
  taskId: string;
  mimeType: string;
  hasAudio: boolean;
  storedAt: string;
  bytes: number;
  sha256: string;
}

/** পুনঃব্যবহারের সময়ের যাচাইকারী — ai_video নিজের validateVideoBuffer ইনজেক্ট করে (আমদানি-চক্র নেই) */
export type ShotCacheValidator = (
  buffer: Buffer
) => Promise<{ ok: boolean; issues: string[]; info?: unknown; hasAudio: boolean }>;

export interface ShotCacheHit {
  buffer: Buffer;
  model: string;
  taskId: string;
  mimeType: string;
  storedAt: string;
  /** পুনঃযাচাইকৃত মিডিয়া-তথ্য (ffprobe) */
  info: unknown;
  hasAudio: boolean;
}

/**
 * ক্যাশ থেকে খোঁজো। এন্ট্রি একেবারে না থাকলে **পরিষ্কার মিস** (invalid-নয়);
 * এন্ট্রি থেকেও ত্রুটিপূর্ণ হলে (সাইডকার ভাঙা/মিডিয়া নেই/আকৃতি মেলেনি/
 * পুনঃযাচাই ব্যর্থ) সেটি উচ্ছেদ + invalid++ + null। null = মিস (কারণ যাই হোক)।
 */
export async function shotCacheLookup(
  sha: string,
  opts: { validate: ShotCacheValidator }
): Promise<ShotCacheHit | null> {
  let p: ReturnType<typeof entryPaths>;
  try {
    p = entryPaths(sha);
  } catch {
    return null;
  }
  // ১) সাইডকার আছে কি না — না থাকলে এন্ট্রিই নেই: পরিষ্কার মিস, invalid-হিসাব নয়
  let metaRaw: string;
  try {
    metaRaw = await readFile(p.meta, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    return discardInvalidEntry(p); // অস্বাভাবিক পড়া-ত্রুটি — সৎ invalid
  }
  let meta: ShotCacheMeta;
  let buffer: Buffer;
  try {
    meta = JSON.parse(metaRaw) as ShotCacheMeta;
    // কঠোর আকৃতি-যাচাই — অনুপস্থিত/মিল-না-খাওয়া যেকোনো ক্ষেত্র অবৈধ
    if (
      meta.v !== SHOT_CACHE_SCHEMA_VERSION ||
      typeof meta.model !== 'string' || !meta.model ||
      typeof meta.taskId !== 'string' || !meta.taskId ||
      typeof meta.mimeType !== 'string' || !meta.mimeType ||
      typeof meta.storedAt !== 'string' || !meta.storedAt ||
      typeof meta.bytes !== 'number' ||
      meta.sha256 !== sha
    ) {
      throw new Error('সাইডকার আকৃতি মেলেনি');
    }
    buffer = await readFile(p.media); // মেটা আছে কিন্তু মিডিয়া নেই = ভাঙা এন্ট্রি
    if (buffer.length === 0 || buffer.length !== meta.bytes) {
      throw new Error('মিডিয়া-আকৃতি সাইডকারের সাথে মেলেনি');
    }
  } catch {
    return discardInvalidEntry(p);
  }
  // ২) পুনঃব্যবহার-কালীন প্রযুক্তি-যাচাই (ffprobe) — নষ্ট মিডিয়া ক্যাশে থাকতে পারে না
  let validation: Awaited<ReturnType<ShotCacheValidator>>;
  try {
    validation = await opts.validate(buffer);
  } catch {
    validation = { ok: false, issues: ['যাচাইকারী নিজেই ব্যর্থ'], hasAudio: false };
  }
  if (!validation.ok) {
    return discardInvalidEntry(p);
  }
  stats().hits++;
  return {
    buffer,
    model: meta.model,
    taskId: meta.taskId,
    mimeType: meta.mimeType,
    storedAt: meta.storedAt,
    info: validation.info,
    hasAudio: validation.hasAudio,
  };
}

/** ভাঙা/ত্রুটিপূর্ণ এন্ট্রি উচ্ছেদ — সৎ invalid-কাউন্টারসহ null ফেরত */
function discardInvalidEntry(p: { media: string; meta: string }): null {
  stats().invalid++;
  stats().entries = Math.max(0, stats().entries - 1);
  void rm(p.media, { force: true }).catch(() => {});
  void rm(p.meta, { force: true }).catch(() => {});
  return null;
}

/**
 * সফল+যাচাইকৃত ক্লিপ জমা করো (generateVideoClip-এর যাচাই-পাশের কল)।
 * best-effort: ডিস্ক-ব্যর্থতায় কখনো প্রজন্ম-ফলাফল ব্যর্থ করে না।
 * জমা শেষে বাজেট-সীমা ছাড়ালে পুরোনো-এন্ট্রি-আগে উচ্ছেদ।
 */
export async function shotCacheStore(
  sha: string,
  clip: { buffer: Buffer; model: string; taskId: string; mimeType?: string; hasAudio: boolean }
): Promise<boolean> {
  let p: ReturnType<typeof entryPaths>;
  try {
    p = entryPaths(sha);
  } catch {
    return false;
  }
  if (clip.buffer.length === 0) return false;
  try {
    await mkdir(p.dir, { recursive: true });
    const meta: ShotCacheMeta = {
      v: SHOT_CACHE_SCHEMA_VERSION,
      model: clip.model,
      taskId: clip.taskId,
      mimeType: clip.mimeType ?? `video/${MEDIA_EXT}`,
      hasAudio: clip.hasAudio === true,
      storedAt: new Date().toISOString(),
      bytes: clip.buffer.length,
      sha256: sha,
    };
    // পরমাণু-লেখা: .tmp → rename (পাঠক কখনো অর্ধ-লেখা ফাইল দেখবে না)
    await writeFile(p.tmpMedia, clip.buffer);
    await rename(p.tmpMedia, p.media);
    await writeFile(p.tmpMeta, JSON.stringify(meta), 'utf8');
    await rename(p.tmpMeta, p.meta);
    stats().stores++;
    stats().bytesStored += clip.buffer.length;
    stats().entries += 1;
    await evictOverBudget();
    return true;
  } catch {
    // ক্যাশ-লেখা কখনো মূল ফলাফলকে স্পর্শ করবে না
    await rm(p.tmpMedia, { force: true }).catch(() => {});
    await rm(p.tmpMeta, { force: true }).catch(() => {});
    return false;
  }
}

/** বাজেট-ছাড়ানো হলে storedAt-ক্রমে পুরোনো-আগে উচ্ছেদ (সৎ কাউন্টারসহ) */
async function evictOverBudget(): Promise<void> {
  const budget = maxBytes();
  let guard = 10_000; // নিরাপত্তা-জাল: এন্ট্রি-সংখ্যা সবসময় সীমিত
  while (stats().bytesStored > budget && guard-- > 0) {
    const oldest = await findOldestEntry();
    if (!oldest) break;
    const ok = await rm(oldest.meta, { force: true })
      .then(() => true)
      .catch(() => false);
    await rm(oldest.media, { force: true }).catch(() => {});
    if (ok) {
      stats().evictions++;
      stats().entries = Math.max(0, stats().entries - 1);
      stats().bytesStored = Math.max(0, stats().bytesStored - oldest.bytes);
    } else {
      break;
    }
  }
}

async function findOldestEntry(): Promise<{ sha: string; media: string; meta: string; storedAt: string; bytes: number } | null> {
  const root = cacheRoot();
  let level1: string[] = [];
  try {
    level1 = await readdir(root);
  } catch {
    return null;
  }
  let best: { sha: string; media: string; meta: string; storedAt: string; bytes: number } | null = null;
  for (const a of level1) {
    let level2: string[] = [];
    try {
      level2 = await readdir(path.join(root, a));
    } catch {
      continue;
    }
    for (const b of level2) {
      const dir = path.join(root, a, b);
      let files: string[] = [];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.endsWith('.meta.json') || f.startsWith('.')) continue;
        try {
          const meta = JSON.parse(await readFile(path.join(dir, f), 'utf8')) as ShotCacheMeta;
          const sha = f.replace(/\.meta\.json$/, '');
          if (!/^[0-9a-f]{64}$/.test(sha)) continue;
          if (!best || meta.storedAt < best.storedAt) {
            best = {
              sha,
              media: path.join(dir, `${sha}.${MEDIA_EXT}`),
              meta: path.join(dir, f),
              storedAt: meta.storedAt,
              bytes: typeof meta.bytes === 'number' ? meta.bytes : 0,
            };
          }
        } catch {
          // ত্রুটিপূর্ণ সাইডকার — এখানে কিছু করছি না (lookup-এর দায়)
        }
      }
    }
  }
  return best;
}

/**
 * ইন-ফ্লাইট ডিডুপ: এই ফিঙ্গারপ্রিন্টের কাজ চলছে কি না দেখো।
 * না চললে নতুন কাজ বসাও। (কলার: generateVideoClip)
 */
export function joinOrStartInFlightShot<T>(
  sha: string,
  startJob: () => Promise<T>
): { promise: Promise<T>; joined: boolean } {
  const map = inflightMap() as Map<string, Promise<T>>;
  const existing = map.get(sha);
  if (existing) {
    stats().joined++;
    return { promise: existing, joined: true };
  }
  const job = startJob();
  map.set(sha, job);
  // ফল যা-ই হোক, সমাপ্তিতে কী মুক্ত (ব্যর্থ-প্রমিজ আটকে থাকবে না)
  const cleanup = () => map.delete(sha);
  job.then(cleanup, cleanup);
  return { promise: job, joined: false };
}
