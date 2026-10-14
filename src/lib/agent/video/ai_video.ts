// ============================================================
// Real AI Video Generation — নতুন মাস্টার প্ল্যান §৪
//
// প্রকৃত ডিফিউশন ভিডিও-জেনারেশন (CogVideoX-3, z-ai-web-dev-sdk-র
// ক্লাউড পরিষেবা)। ২০২৬-১০-১১-এর প্রোব-যাচাই:
//  - t2v: {prompt, duration} → ~১৩৮ সেকেন্ডে ৫ সে.-এর প্রকৃত MP4 ✓
//  - i2v: image_url ডেটা-URL গ্রহণ করে ✓
//  - with_audio:true → প্রকৃত AAC অডিও-স্ট্রিম (16kHz mono) ✓
//  - request_id গৃহীত ও echo-হয় (§১০ idempotency) ✓
//
// ২০২৬-১০-১৩-এর গভীর-প্রোব (এই ফাইলের পুনর্লিখনের ভিত্তি):
//  - **একটাই টাস্ক একসাথে চলতে পারে** — ইন-ফ্লাইট টাস্ক থাকলে সব
//    নতুন সাবমিট ৪২৯ পায়। আগের কোড এটা জানত না → প্রতি শটে ৬×৬০–৯০
//    সেকেন্ডের অন্ধ ব্যাকঅফ + coordinator-এর ভিডিও-চ্যানেল
//    পূর্ণ-ব্লক → সব শট স্লাইডশো-ফলব্যাকে পড়ত (ব্যবহারকারীর নাল
//    অভিজ্ঞতার মূল কারণ)।
//  - টাস্ক শেষ হওয়ার পরেও ~২.২–২.৫ মিনিট কুলডাউন থাকে।
//  - সাবমিট-প্রতি-সময়: ২০:৩৪:০৩ সাবমিট → সমাপ্তি ~২০:৩৭:৪৫ →
//    পরের সফল সাবমিট ২০:৪০:০২ (সমাপ্তির ~২ মি ১৭ সে পরে)।
//  - ৪২৯-হ্যামারিং (প্রতি ২০ সে. চেষ্টা) জানালা বাড়ায় না।
//
// নতুন স্থাপত্য — "ইন-ফ্লাইট-সচেতন গেট":
//  ১. গ্লোবাল গেট: একটাই ইন-ফ্লাইট টাস্ক ট্র্যাক করে; নতুন সাবমিট
//     প্রথমে সেটার সমাপ্তির অপেক্ষা করে, তারপর সমাপ্তি-পরবর্তী
//     কুলডাউন (ভিত্তি ১৫০ সে., অভিযোজিত) মেনে তারপর যায়।
//  ২. ৪২৯ মানেই ব্যর্থ নয় — "জানালা বন্ধ" সংকেত; ধৈর্যশীল ল্যাডার
//     (১৫→৩০→৬০→৯০… সে.) দিয়ে সর্বোচ্চ ~৮ মিনিট বাজেট।
//  ৩. coordinator-কে আর বিষ নয় — প্রত্যাশিত ৪২৯-এ noteRateLimit('video')
//     হয় না, তাই ভিডিও-চ্যানেল কখনো "স্কিপ-অ্যাডভাইজড" হয়ে পুরো
//     প্রোডাকশন স্লাইডশো হয়ে যায় না।
//  ৪. প্রি-ওয়ার্ম: পাইপলাইনের প্রথম শট আগেই সাবমিট করে রাখা যায় —
//     জেনারেশন চলাকালীন পাইপলাইন বাকি কাজ (পোর্ট্রেট/TTS/সাউন্ড) করে।
//
// সততার নিয়ম (§৪.৩): FFmpeg-কে কখনো AI ভিডিও-জেনারেশন বলে দেখানো
// হয় না — এখানে কেবল প্রকৃত ক্লাউড-মডেলের ফলাফলই "AI ভিডিও"।
// ============================================================

import { createHash } from 'crypto';
import { getZAI } from '../llm';
import {
  TemporarilyUnavailableError,
  isRateLimitErrorText,
  parseRetryAfterMs,
} from '../sdk-helpers';
import { mediaInfo, type MediaInfo } from '@/lib/media/ffmpeg';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

export const AI_VIDEO_MODEL = 'cogvideox-3';
export const AI_VIDEO_PROVIDER = 'z-ai-web-dev-sdk (ক্লাউড)';

/** প্রোব-যাচাইকৃত সীমা (২০২৬-১০-১৩) */
export const AI_VIDEO_LIMITS = {
  durationChoices: [5, 10] as const,
  defaultDurationSec: 5,
  /** প্রতি টাস্কের সর্বোচ্চ অপেক্ষা (প্রোবে ৭+ মিনিটও দেখা গেছে; জিজ্ঞাসা-থ্রটল-সময়ও ধরে) */
  pollTimeoutMs: 15 * 60 * 1000,
  /** ভিত্তি পোল-বিরতি (৪২৯-হলে অভিযোজিতভাবে বাড়ে) */
  pollIntervalMs: 10_000,
  /** সমাপ্তির পরের কুলডাউন — প্রোব: সমাপ্তি→পরের-সফল-সাবমিট ≈ ২ মি ১৭ সে. */
  postCompletionCooldownMs: 150_000,
  /** ৪২৯-ল্যাডার (সেকেন্ডে) — অন্ধ ৬০–৯০ সে. নয়, ক্রমবর্ধমান ছোট ধাপ */
  rateLimitLadderSec: [15, 30, 60, 90, 120],
  /** প্রতি শটের সাবমিট-বাজেট (৪২৯-অপেক্ষা মিলিয়ে) */
  submitBudgetMs: 8 * 60 * 1000,
};

export type AiVideoQuality = 'speed' | 'quality';

export interface AiVideoRequest {
  prompt: string;
  /** ৫ বা ১০ সেকেন্ড (সীমার বাইরে হলে ক্ল্যাম্প) */
  durationSec?: number;
  quality?: AiVideoQuality;
  /** i2v: ছবি (data URL বা পাবলিক URL) */
  imageUrl?: string;
  /** মডেলের নিজস্ব অডিও চাই কি না */
  withAudio?: boolean;
  size?: string;
  /**
   * §১০ আইডেম্পোটেন্সি-চাবি — লজিক্যাল শটের পরিচয় (যেমন
   * `productionId-shot-3`)। থাকলে এখান থেকে নির্ধারক request_id
   * তৈরি হয়; ৪২৯-পুনঃসাবমিটেও একই id যায় — প্রোভাইডার একই
   * লজিক্যাল কাজ দুইবার নেয় না।
   */
  requestKey?: string;
}

export interface AiVideoTask {
  taskId: string;
  model: string;
  request: AiVideoRequest;
}

/** প্রোভাইডার-স্ট্যাটাস — UI-র "ক্লাউড ভিডিও" সারির জন্য (audit §2-B/§2-D) */
export interface VideoProviderStatus {
  /** একটি টাস্ক এখন চলছে (গেটে ইন-ফ্লাইট) */
  busy: boolean;
  inFlightTaskId?: string;
  /** চলমান টাস্ক কত সেকেন্ড ধরে চলছে */
  inFlightSec?: number;
  /** সাবমিট-জানালা খুলতে আর কত মি.সে. (কুলডাউন) */
  cooldownRemainingMs: number;
  /** সর্বশেষ ব্যর্থতার সংক্ষিপ্ত বার্তা (না থাকলে বাদ) */
  lastError?: string;
  /** সর্বশেষ ~৫ টাস্কের গড় জেনারেশন-সময় (মি.সে.) */
  avgGenerationMs?: number;
}

/**
 * বাতিলকরণ-সংকেত — নামটি সচেতনভাবে 'CancelledError' রাখা হয়েছে যাতে
 * runner (production/runner.ts) instanceof ছাড়াই নাম-মিলিয়ে চিনে নেয়
 * এবং প্রোডাকশনকে failed নয়, cancelled করে। (আমদ্রি-আমদ্রি আমদানি-চক্র এড়াতে।)
 */
export class VideoAbortedError extends Error {
  constructor(reason = 'বাতিলকরণ-অনুরোধ — প্রোভাইডার-অপেক্ষা বন্ধ') {
    super(reason);
    this.name = 'CancelledError';
  }
}

export interface AiVideoOutcome {
  status: 'SUCCESS' | 'FAIL' | 'TIMEOUT';
  url?: string;
  coverUrl?: string;
  raw?: unknown;
}

export interface AiVideoClip {
  buffer: Buffer;
  mimeType: string;
  taskId: string;
  model: string;
  generationMs: number;
  info: MediaInfo;
  coverUrl?: string;
  request: AiVideoRequest;
  /** §৭.১: ffprobe-যাচাই — ক্লিপে নেটিভ অডিও-স্ট্রিম আছে কি না */
  nativeAudio: boolean;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** বাতিলযোগ্য ঘুম — ২ সেকেন্ড টিকে বাতিল-কলব্যাক দেখে; বাতিল হলে VideoAbortedError */
async function sleepCancellable(ms: number, isCancelled?: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + Math.max(0, ms);
  for (;;) {
    if (isCancelled && (await isCancelled())) throw new VideoAbortedError();
    const remain = end - Date.now();
    if (remain <= 0) return;
    await sleep(Math.min(remain, 2000));
  }
}

/**
 * §১০ আইডেম্পোটেন্সি: requestKey → নির্ধারক request_id
 * (sanitized চাবি + প্রম্পটের সংক্ষিপ্ত হ্যাশ)। একই লজিক্যাল শট
 * একই প্রম্পটে পুনঃসাবমিট হলে সবসময় একই id — প্রোভাইডার ডিডুপ্লিকেট করে।
 */
export function deriveRequestId(requestKey: string, prompt: string): string {
  const sanitized =
    requestKey
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'shot';
  const promptHash = createHash('sha1').update(prompt).digest('hex').slice(0, 10);
  return `${sanitized}-${promptHash}`;
}

// ------------------------------------------------------------
// গ্লোবাল ইন-ফ্লাইট গেট (HMR-নিরাপদ) — ২০২৬-১০-১৩ স্থাপত্য
// ------------------------------------------------------------

interface InflightTask {
  taskId: string;
  startedAt: number;
  /** পোল-প্রমিশ — সমাপ্তিতে গেট মুক্ত হয় */
  poll: Promise<AiVideoOutcome>;
}

interface VideoGate {
  /** সাবমিট-সিরিয়ালাইজেশন চেইন */
  tail: Promise<unknown>;
  inflight: InflightTask | null;
  /** সাম্প্রতিক সমাপ্তির সময় */
  lastCompletionAt: number;
  /** পরের সাবমিটের সবচেয়ে আগের গ্রাহ্য সময় */
  nextAllowedAt: number;
  /** সর্বশেষ সফল সাবমিটের সময় (min-gap হিসাবে) */
  lastSubmitAt: number;
  /** সর্বশেষ ব্যর্থতার সংক্ষিপ্ত বার্তা — UI-র সৎ স্ট্যাটাসের জন্য */
  lastError?: string;
  /** পরিসংখ্যান — সৎ ETA-নোট ও UI-র জন্য */
  submits: number;
  completions: number;
  failures: number;
  generationMsSamples: number[];
}

const g = globalThis as any;

function gate(): VideoGate {
  if (!g.__aiVideoGate) {
    g.__aiVideoGate = {
      tail: Promise.resolve(),
      inflight: null,
      lastCompletionAt: 0,
      nextAllowedAt: 0,
      lastSubmitAt: 0,
      submits: 0,
      completions: 0,
      failures: 0,
      generationMsSamples: [],
    } satisfies VideoGate;
  }
  return g.__aiVideoGate as VideoGate;
}

/** গেট-পরিসংখ্যান — videoProviderStatus-এর পুরনো নাম (পিছন-সামঞ্জস্য) */
export function videoSchedulerStats(): VideoProviderStatus {
  return videoProviderStatus();
}

/** প্রোভাইডার-স্ট্যাটাস — সিরিয়ালাইজেশন/SSE-তে "ক্লাউড ভিডিও" সারির জন্য (audit §2-B/§2-D) */
export function videoProviderStatus(): VideoProviderStatus {
  const s = gate();
  const samples = s.generationMsSamples.slice(-5);
  const status: VideoProviderStatus = {
    busy: Boolean(s.inflight),
    ...(s.inflight ? { inFlightTaskId: s.inflight.taskId, inFlightSec: Math.round((Date.now() - s.inflight.startedAt) / 1000) } : {}),
    cooldownRemainingMs: Math.max(0, s.nextAllowedAt - Date.now()),
    ...(s.lastError ? { lastError: s.lastError } : {}),
    ...(samples.length ? { avgGenerationMs: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) } : {}),
  };
  return status;
}

/** গেটের ইন-ফ্লাইট টাস্ক অবহেলা (বাতিলকরণে): ক্লাউডে টাস্ক বাকি থাকতে পারে —
 *  গেট মুক্ত করে সমাপ্তি-কুলডাউন বসিয়ে দেওয়া হয় যাতে পরের সাবমিট জানানা না হামার করে। */
function abandonInflight(): void {
  const s = gate();
  s.inflight = null;
  s.nextAllowedAt = Math.max(s.nextAllowedAt, Date.now() + AI_VIDEO_LIMITS.postCompletionCooldownMs);
}

/** চলমান টাস্কের পোল-প্রমিশ (না থাকলে null) — সাবমিট-অপেক্ষার জন্য */
function inflightPoll(): Promise<AiVideoOutcome> | null {
  return gate().inflight?.poll ?? null;
}

/** গড় জেনারেশন-সময়ের সৎ আনুমানিক বাংলা নোট */
export function videoGenerationEtaNote(): string {
  const st = videoProviderStatus();
  const avgSec = st.avgGenerationMs ? Math.round(st.avgGenerationMs / 1000) : 0;
  return avgSec > 0
    ? `প্রতি শটে আনুমানিক ${avgSec} সেকেন্ড`
    : 'প্রতি শটে আনুমানিক ২–৪ মিনিট';
}

// ------------------------------------------------------------
// সাবমিট + পোল + ডাউনলোড
// ------------------------------------------------------------

/**
 * ভিডিও-টাস্ক সাবমিট — ইন-ফ্লাইট-সচেতন:
 *  ১) চলমান টাস্ক থাকলে তার সমাপ্তির অপেক্ষা;
 *  ২) সমাপ্তি-পরবর্তী কুলডাউন মেনে চলা;
 *  ৩) ৪২৯ = "জানালা বন্ধ" — ক্রমবর্ধমান ল্যাডারে ধৈর্য (সর্বোচ্চ ~৮ মিনিট);
 *  ৪) প্রত্যাশিত ৪২৯-এ coordinator-কে আর বিষ নয়।
 */
export async function submitVideoTask(
  req: AiVideoRequest,
  opts?: { onStatus?: (note: string) => void; isCancelled?: () => boolean | Promise<boolean> }
): Promise<AiVideoTask> {
  const zai = await getZAI();
  const duration = clampDuration(req.durationSec);
  // §১০: requestKey থাকলে নির্ধারক request_id — চক্রের বাইরে একবারই তৈরি
  const requestId = req.requestKey ? deriveRequestId(req.requestKey, req.prompt) : undefined;

  const deadline = Date.now() + AI_VIDEO_LIMITS.submitBudgetMs;
  let ladderIdx = 0;
  let lastErr: unknown = null;

  while (Date.now() < deadline) {
    if (opts?.isCancelled && (await opts.isCancelled())) throw new VideoAbortedError();

    // --- ধাপ ১: ইন-ফ্লাইট টাস্ক থাকলে তার সমাপ্তির অপেক্ষা ---
    const running = inflightPoll();
    if (running) {
      const other = gate().inflight;
      opts?.onStatus?.(
        `প্রোভাইডার ব্যস্ত — চলমান টাস্কের (${other?.taskId.slice(0, 10) ?? '…'}…) সমাপ্তির অপেক্ষা`
      );
      try {
        await running;
      } catch {
        /* পোল-প্রমিশ নিজে ফল গিলে রাখে — এখানে কেবল মুক্তির অপেক্ষা */
      }
    }

    // --- ধাপ ২: কুলডাউন বাকি থাকলে সৎ অপেক্ষা ---
    const wait = gate().nextAllowedAt - Date.now();
    if (wait > 0) {
      opts?.onStatus?.(`কুলডাউন চলছে (~${Math.ceil(wait / 1000)} সে.) — জানালা খোলার অপেক্ষা`);
      await sleepCancellable(Math.min(wait, 60_000), opts?.isCancelled);
    }

    // --- ধাপ ৩: সাবমিট চেষ্টা ---
    try {
      const body: Record<string, unknown> = {
        prompt: req.prompt.slice(0, 2000),
        duration,
        quality: req.quality ?? 'speed',
        watermark_enabled: false,
      };
      if (req.imageUrl) body.image_url = req.imageUrl;
      if (req.withAudio) body.with_audio = true;
      if (req.size) body.size = req.size;
      if (requestId) body.request_id = requestId;
      const res = await zai.video.generations.create(body as any);
      const id = (res as any)?.id;
      if (!id) throw new Error(`সাবমিট-প্রতিক্রিয়ায় taskId নেই: ${JSON.stringify(res).slice(0, 200)}`);
      const s = gate();
      s.lastSubmitAt = Date.now();
      s.submits++;
      return {
        taskId: String(id),
        model: String((res as any).model ?? AI_VIDEO_MODEL),
        request: { ...req, durationSec: duration },
      };
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      if (!isRateLimitErrorText(msg) && !/429|too many/i.test(msg)) throw err;
      // ৪২৯ — জানালা বন্ধ। Retry-After থাকলে সেটিই (যুক্তিসঙ্গত সীমায়),
      // নয়তো ল্যাডারের ধাপ।
      const ra = parseRetryAfterMs(err);
      const ladderSec = AI_VIDEO_LIMITS.rateLimitLadderSec[Math.min(ladderIdx, AI_VIDEO_LIMITS.rateLimitLadderSec.length - 1)];
      const delayMs = ra != null && ra > 0 ? Math.min(ra, 120_000) : ladderSec * 1000;
      ladderIdx++;
      gate().lastError = `৪২৯ রেট-সীমা — ${Math.round(delayMs / 1000)} সে. পরে পুনঃচেষ্টা (${msg.slice(0, 80)})`;
      opts?.onStatus?.(`৪২৯ (জানালা বন্ধ) — ${Math.round(delayMs / 1000)} সেকেন্ড অপেক্ষা`);
      await sleepCancellable(delayMs, opts?.isCancelled);
    }
  }
  const detail = String((lastErr as any)?.message ?? lastErr ?? 'অজানা').slice(0, 200);
  gate().lastError = `সাবমিট-জানালা ${Math.round(AI_VIDEO_LIMITS.submitBudgetMs / 60000)} মিনিটেও খোলেনি: ${detail}`;
  throw new TemporarilyUnavailableError(
    `ভিডিও-সাবমিট জানালা ${Math.round(AI_VIDEO_LIMITS.submitBudgetMs / 60000)} মিনিটেও খুলেনি (৪২৯): ${detail}`
  );
}

function clampDuration(d?: number): number {
  const v = Number(d) || AI_VIDEO_LIMITS.defaultDurationSec;
  const [lo, hi] = [Math.min(...AI_VIDEO_LIMITS.durationChoices), Math.max(...AI_VIDEO_LIMITS.durationChoices)];
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/**
 * একটি টাস্কের ফলাফলের অপেক্ষা (৪২৯ নীরবে সহ্য করে)।
 * সফল/ব্যর্থ উভয় ক্ষেত্রেই গেট আপডেট করে (কুলডাউন শুরু)।
 */
export async function pollVideoTask(
  task: AiVideoTask,
  opts?: { onStatus?: (note: string) => void; timeoutMs?: number; isCancelled?: () => boolean | Promise<boolean> }
): Promise<AiVideoOutcome> {
  const zai = await getZAI();
  const timeout = opts?.timeoutMs ?? AI_VIDEO_LIMITS.pollTimeoutMs;
  const t0 = Date.now();
  let lastNote = 0;
  // অভিযোজিত পোল-ব্যাকঅফ: query-৪২৯ মানেই জিজ্ঞাসা-চ্যানেল চাপে — বিরতি
  // ১৫→৩০→৪৫ সে. পর্যন্ত বাড়ে; সফল জিজ্ঞাসা ভিত্তি-বিরতিতে ফেরে।
  // (২০২৬-১০-১৩-এর প্রোব: ঘন ঘন জিজ্ঞাসা নিজেই ৪২৯-ঝড় ডাকে — ফলাফল
  // অন্ধকারে চলে যায়, যদিও টাস্ক সমাপ্ত।)
  let queryDelayMs = AI_VIDEO_LIMITS.pollIntervalMs;
  while (Date.now() - t0 < timeout) {
    // §3-D বাতিলকরণ: বাতিল-প্রোডাকশন প্রোভাইডার-পোলে আটকে থাকবে না —
    // গেট মুক্ত (কুলডাউনসহ) করে VideoAbortedError ছুড়ে চলে যায়।
    if (opts?.isCancelled && (await opts.isCancelled())) {
      if (gate().inflight?.taskId === task.taskId) abandonInflight();
      throw new VideoAbortedError();
    }
    await sleepCancellable(queryDelayMs, opts?.isCancelled);
    try {
      const q: any = await zai.async.result.query(task.taskId);
      queryDelayMs = AI_VIDEO_LIMITS.pollIntervalMs;
      const status = String(q?.task_status ?? '');
      if (status === 'SUCCESS') {
        const url = q.video_result?.[0]?.url ?? q.video_url ?? q.url ?? q.video;
        const coverUrl = q.video_result?.[0]?.cover_image_url;
        noteCompletion(t0);
        return { status: 'SUCCESS', url: typeof url === 'string' ? url : undefined, coverUrl, raw: q };
      }
      if (status === 'FAIL') {
        gate().lastError = `প্রোভাইডার টাস্ক ব্যর্থ ঘোষণা করেছে (${task.taskId.slice(0, 10)}…)`;
        noteCompletion(t0);
        return { status: 'FAIL', raw: q };
      }
      if (opts?.onStatus && Date.now() - lastNote > 30_000) {
        lastNote = Date.now();
        opts.onStatus(
          `টাস্ক ${task.taskId.slice(0, 10)}… চলছে — ${Math.round((Date.now() - t0) / 1000)} সে. অতিবাহিত`
        );
      }
    } catch (err: any) {
      if (err instanceof VideoAbortedError || err?.name === 'CancelledError') throw err;
      const msg = String(err?.message ?? err);
      if (/429|Too many/i.test(msg)) {
        // জিজ্ঞাসা-চ্যানেল থ্রটেলড — বিরতি বাড়াও (সর্বোচ্চ ৪৫ সে.)
        queryDelayMs = Math.min(45_000, Math.max(queryDelayMs + 8_000, 15_000));
      } else if (!/timeout/i.test(msg)) {
        // কিছু ক্ষণিক ত্রুটি সহ্য করি — টাস্ক হারাতে চাই না
        if (!/\b5\d{2}\b/.test(msg)) throw err;
      }
    }
  }
  gate().lastError = `পোল-সময়সীমা অতিক্রম (${Math.round(timeout / 60000)} মিনিট)`;
  noteCompletion(t0);
  return { status: 'TIMEOUT' };
}

/** সমাপ্তি-ঘটনা গেটে নথিভুক্ত (কুলডাউন-শুরু + নমুনা) */
function noteCompletion(startedAtMs: number): void {
  const s = gate();
  const now = Date.now();
  s.inflight = null;
  s.lastCompletionAt = now;
  s.completions++;
  s.generationMsSamples.push(now - startedAtMs);
  if (s.generationMsSamples.length > 20) s.generationMsSamples.shift();
  // পরের সাবমিট কুলডাউন পরে — ভিত্তি ১৫০ সে.
  s.nextAllowedAt = Math.max(s.nextAllowedAt, now + AI_VIDEO_LIMITS.postCompletionCooldownMs);
}

/** URL থেকে ভিডিও ডাউনলোড */
export async function downloadVideo(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ভিডিও ডাউনলোড ব্যর্থ: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 50_000) throw new Error(`ভিডিও-ফাইল অস্বাভাবিক ছোট (${buf.length} বাইট)`);
  return buf;
}

/** বাফারের প্রযুক্তি-যাচাই (§১১ স্তর A) — অডিও-স্ট্রিমের প্রতিবেদনসহ */
export interface VideoValidation {
  ok: boolean;
  issues: string[];
  info?: MediaInfo;
  /** §৭.১: ffprobe-অনুযায়ী অডিও-স্ট্রিম আছে কি না */
  hasAudio: boolean;
  /** অডিও-স্ট্রিমের কোডেক (যেমন aac) — না থাকলে undefined */
  audioCodec?: string;
}

/**
 * বাফারের প্রযুক্তি-যাচাই (§১১ স্তর A)।
 * expectAudio:true দিলে (with_audio চাওয়া হয়েছিল) অডিও-স্ট্রিম না
 * পেলে সৎ-সমস্যা হিসেবে issue ওঠে; অন্যথা অডিও-অনুপস্থিতি
 * কখনো ব্যর্থতা নয় — শুধু প্রতিবেদনে hasAudio/audioCodec ফেরে।
 */
export async function validateVideoBuffer(buffer: Buffer, opts?: { expectAudio?: boolean }): Promise<VideoValidation> {
  const issues: string[] = [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'aiv-'));
  try {
    const f = path.join(tmp, 'clip.mp4');
    await writeFile(f, buffer);
    let info: MediaInfo;
    try {
      info = await mediaInfo(f);
    } catch (err: any) {
      return {
        ok: false,
        issues: [`ফাইল খোলা যায়নি (ffprobe): ${String(err?.message ?? err).slice(0, 120)}`],
        hasAudio: false,
      };
    }
    if (!info.hasVideo) issues.push('ভিডিও-স্ট্রিম নেই');
    if (info.durationSec < 3) issues.push(`দৈর্ঘ্য খুব কম (${info.durationSec}s)`);
    if (info.width && info.width < 360) issues.push(`রেজোলিউশন খুব কম (${info.width}x${info.height})`);
    // §৭.১: নেটিভ-অডিও চাওয়া হয়েছিল কিন্তু স্ট্রিম নেই — কেবল তখনই সমস্যা
    if (opts?.expectAudio && !info.hasAudio) issues.push('অডিও-স্ট্রিম নেই');
    return {
      ok: issues.length === 0,
      issues,
      info,
      hasAudio: info.hasAudio,
      ...(info.audioCodec ? { audioCodec: info.audioCodec } : {}),
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * একটি ক্লিপের সম্পূর্ণ চক্র: সাবমিট → (গেটে নথিভুক্ত) পোল → ডাউনলোড → যাচাই।
 * ইন-ফ্লাইট-ট্র্যাকিং: সাবমিটের পরেই পোল-প্রমিশ গেটে বসে যায় — পরের সাবমিট
 * সেটার সমাপ্তির অপেক্ষা করবে (৪২৯-ঝড়ের বদলে সৎ অপেক্ষা)।
 */
export async function generateVideoClip(
  req: AiVideoRequest,
  opts?: { onStatus?: (note: string) => void; timeoutMs?: number; isCancelled?: () => boolean | Promise<boolean> }
): Promise<AiVideoClip> {
  const t0 = Date.now();
  const task = await submitVideoTask(req, { onStatus: opts?.onStatus, isCancelled: opts?.isCancelled });
  opts?.onStatus?.(`টাস্ক জমা হয়েছে (${task.model}, আইডি ${task.taskId.slice(0, 10)}…) — জেনারেশন চলছে…`);

  // ইন-ফ্লাইট-নথিভুক্ত পোল — ফল যা-ই হোক, গেট কুলডাউন-সচেতন
  const pollPromise = pollVideoTask(task, opts);
  const s = gate();
  if (!s.inflight) {
    s.inflight = { taskId: task.taskId, startedAt: t0, poll: pollPromise };
    pollPromise.catch(() => gate().failures++);
  } else {
    // (তাত্ত্বিকভাবে হয় না — সাবমিট ইতিমধ্যে অপেক্ষা করেছে) নিরাপত্তা-জাল
    pollPromise.catch(() => undefined);
  }

  const outcome = await pollPromise;
  if (outcome.status !== 'SUCCESS' || !outcome.url) {
    const reason = outcome.status === 'TIMEOUT' ? 'সময়সীমা অতিক্রম' : 'মডেল ব্যর্থ ঘোষণা করেছে';
    gate().lastError = `${reason} (${task.taskId.slice(0, 10)}…)`;
    throw new Error(`AI ভিডিও-জেনারেশন ব্যর্থ: ${reason}`);
  }
  const buffer = await downloadVideo(outcome.url);
  // §৭.১: with_audio চাওয়া হলে অডিও-স্ট্রিমও ffprobe-যাচাই
  const validation = await validateVideoBuffer(buffer, { expectAudio: req.withAudio === true });
  if (!validation.ok) {
    throw new Error(`AI ভিডিও যাচাই ব্যর্থ: ${validation.issues.join('; ')}`);
  }
  return {
    buffer,
    mimeType: 'video/mp4',
    taskId: task.taskId,
    model: task.model,
    generationMs: Date.now() - t0,
    info: validation.info!,
    coverUrl: outcome.coverUrl,
    request: task.request,
    nativeAudio: validation.hasAudio,
  };
}

// ------------------------------------------------------------
// প্রি-ওয়ার্ম — পাইপলাইনের প্রথম AI-শট আগেই চালু
// ------------------------------------------------------------

/**
 * requestKey-ভিত্তিক প্রি-ওয়ার্ম-ক্যাশ: পাইপলাইন পরিকল্পনা-ধাপ শেষ হলেই
 * প্রথম শটের জেনারেশন ব্যাকগ্রাউন্ডে চালু করে — পোর্ট্রেট/TTS/সাউন্ডের
 * সমান্তরালে ~২–৪ মিনিটের জেনারেশন চলে। generateAiShot পরে
 * consumePrewarmedClip দিয়ে ফল তুলে নেয়।
 */
const g2 = globalThis as any;
function prewarmMap(): Map<string, Promise<AiVideoClip>> {
  if (!g2.__aiVideoPrewarm) g2.__aiVideoPrewarm = new Map<string, Promise<AiVideoClip>>();
  return g2.__aiVideoPrewarm as Map<string, Promise<AiVideoClip>>;
}

/** প্রি-ওয়ার্ম চালু (একই কীতে পুনঃকল নীরবে উপেক্ষিত) */
export function prewarmVideoClip(
  req: AiVideoRequest,
  opts?: { onStatus?: (note: string) => void; isCancelled?: () => boolean | Promise<boolean> }
): void {
  if (!req.requestKey) return;
  const map = prewarmMap();
  if (map.has(req.requestKey)) return;
  const job = generateVideoClip(req, opts).finally(() => {
    // ফল জমা হোক-না-হোক, পরে স্মৃতি-স্বাস্থ্যের জন্য কী মুছে যায় না —
    // consumePrewarmedClip-এ মুছুন। শুধু ব্যর্থতার ক্ষেত্রে এখানেই সরাই।
    jobCatchCleanup(map, req.requestKey!);
  });
  map.set(req.requestKey!, job);
}

function jobCatchCleanup(map: Map<string, Promise<AiVideoClip>>, key: string): void {
  // ব্যর্থ-প্রমিশ ক্যাশে-সদা-না-থাকানোর স্বাস্থ্য-যত্ন
  const p = map.get(key);
  if (p) p.catch(() => map.delete(key));
}

/** প্রি-ওয়ার্ম করা ক্লিপ তুলে নাও (থাকলে) — না থাকলে null */
export function consumePrewarmedClip(requestKey: string): Promise<AiVideoClip> | null {
  const map = prewarmMap();
  const p = map.get(requestKey) ?? null;
  if (p) map.delete(requestKey);
  return p;
}

// ------------------------------------------------------------
// একাধিক ক্লিপ (লেগেসি-চুক্তি) — এখন গেট-সচেতন ধারাবাহিক
// ------------------------------------------------------------

export interface MultiClipResult {
  clips: { index: number; ok: true; clip: AiVideoClip }[];
  failures: { index: number; error: string }[];
}

/**
 * একাধিক ক্লিপ — গেট-সচেতন ধারাবাহিক (একই সময়ে একটাই টাস্ক চলে;
 * সাবমিট স্বয়ংক্রিয়ভাবে আগেরটার সমাপ্তি+কুলডাউন মেনে নেয়)।
 * সৎ আচরণ: কোনো ক্লিপ ব্যর্থ হলে exceptions নয়, ফলাফল-তালিকায় ব্যর্থতা
 * চিহ্নিত করে ফেরত দেয় (পাইপলাইন retry/fallback-নীতি §৭.৪)।
 */
export async function generateVideoClips(
  reqs: AiVideoRequest[],
  opts?: { onStatus?: (note: string) => void; timeoutMs?: number; isCancelled?: () => boolean | Promise<boolean> }
): Promise<MultiClipResult> {
  const clips: MultiClipResult['clips'] = [];
  const failures: MultiClipResult['failures'] = [];
  for (let i = 0; i < reqs.length; i++) {
    try {
      opts?.onStatus?.(`শট ${i + 1}/${reqs.length} জেনারেট হচ্ছে…`);
      const clip = await generateVideoClip(reqs[i], opts);
      clips.push({ index: i, ok: true, clip });
    } catch (err: any) {
      if (err?.name === 'CancelledError') throw err;
      gate().failures++;
      gate().lastError = `শট ${i + 1} ব্যর্থ: ${String(err?.message ?? err).slice(0, 120)}`;
      failures.push({ index: i, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return { clips, failures };
}
