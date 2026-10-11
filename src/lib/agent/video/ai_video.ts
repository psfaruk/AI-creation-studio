// ============================================================
// Real AI Video Generation — নতুন মাস্টার প্ল্যান §৪
//
// প্রকৃত ডিফিউশন ভিডিও-জেনারেশন (CogVideoX-3, z-ai-web-dev-sdk-র
// ক্লাউড পরিষেবা)। ২০২৬-১০-১১-এর প্রোব-যাচাই:
//  - t2v: {prompt, duration} → ~১৩৮ সেকেন্ডে ৫ সে.-এর প্রকৃত MP4 ✓
//  - i2v: image_url ডেটা-URL গ্রহণ করে ✓
//  - সাবমিটগুলোর মাঝে ≥৯০ সে. ফাঁক না দিলে 429 — ধৈর্যশীল ব্যাকঅফ
//  - প্রতিটি টাস্ক ২–৪ মিনিট পর্যন্ত চলতে পারে
//
// সততার নিয়ম (§৪.৩): FFmpeg-কে কখনো AI ভিডিও-জেনারেশন বলে দেখানো
// হয় না — এখানে কেবল প্রকৃত ক্লাউড-মডেলের ফলাফলই "AI ভিডিও"।
// ============================================================

import { getZAI } from '../llm';
import { mediaInfo, type MediaInfo } from '@/lib/media/ffmpeg';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';

export const AI_VIDEO_MODEL = 'cogvideox-3';
export const AI_VIDEO_PROVIDER = 'z-ai-web-dev-sdk (ক্লাউড)';

/** প্রোব-যাচাইকৃত সীমা */
export const AI_VIDEO_LIMITS = {
  durationChoices: [5, 10] as const,
  defaultDurationSec: 5,
  /** প্রতি টাস্কের সর্বোচ্চ অপেক্ষা */
  pollTimeoutMs: 10 * 60 * 1000,
  pollIntervalMs: 7000,
  /** সাবমিট-ব্যাকঅফ (৪২৯-এ) — প্রোব-৩: ৪৫ সে.-এও ৬ বার 429 */
  submitBackoffMs: 60_000,
  submitAttempts: 6,
  /** পরপর সাবমিটের ন্যূনতম ব্যবধান */
  minSubmitGapMs: 30_000,
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
}

export interface AiVideoTask {
  taskId: string;
  model: string;
  request: AiVideoRequest;
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
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** শেষ সাবমিটের সময় মনে রাখা (গ্লোবাল স্পেসিং — HMR-নিরাপদ) */
const g = globalThis as any;
function lastSubmitAt(): number {
  return g.__aiVideoLastSubmit ?? 0;
}
function markSubmit(): void {
  g.__aiVideoLastSubmit = Date.now();
}

// ------------------------------------------------------------
// সাবমিট + পোল + ডাউনলোড
// ------------------------------------------------------------

/** ভিডিও-টাস্ক সাবমিট — ৪২৯-এ ধৈর্যশীল ব্যাকঅফ, ব্যবধান-স্পেসিং */
export async function submitVideoTask(req: AiVideoRequest): Promise<AiVideoTask> {
  const zai = await getZAI();
  const duration = clampDuration(req.durationSec);

  // ন্যূনতম ব্যবধান মেনে চলি
  const gap = Date.now() - lastSubmitAt();
  if (gap > 0 && gap < AI_VIDEO_LIMITS.minSubmitGapMs) {
    await sleep(AI_VIDEO_LIMITS.minSubmitGapMs - gap);
  }

  let lastErr: unknown;
  for (let attempt = 1; attempt <= AI_VIDEO_LIMITS.submitAttempts; attempt++) {
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
      const res = await zai.video.generations.create(body as any);
      markSubmit();
      const id = (res as any)?.id;
      if (!id) throw new Error(`সাবমিট-প্রতিক্রিয়ায় taskId নেই: ${JSON.stringify(res).slice(0, 200)}`);
      return { taskId: String(id), model: String((res as any).model ?? AI_VIDEO_MODEL), request: { ...req, durationSec: duration } };
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      if (!/429|Too many|timeout|\b5\d{2}\b/i.test(msg)) throw err;
      if (attempt === AI_VIDEO_LIMITS.submitAttempts) break;
      await sleep(AI_VIDEO_LIMITS.submitBackoffMs);
    }
  }
  throw new Error(
    `ভিডিও-টাস্ক সাবমিট ব্যর্থ (রেট-সীমা/সার্ভার): ${String((lastErr as any)?.message ?? lastErr).slice(0, 200)}`
  );
}

function clampDuration(d?: number): number {
  const v = Number(d) || AI_VIDEO_LIMITS.defaultDurationSec;
  const [lo, hi] = [Math.min(...AI_VIDEO_LIMITS.durationChoices), Math.max(...AI_VIDEO_LIMITS.durationChoices)];
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

/** একটি টাস্কের ফলাফলের অপেক্ষা (৪২৯ নীরবে সহ্য করে) */
export async function pollVideoTask(
  task: AiVideoTask,
  opts?: { onStatus?: (note: string) => void; timeoutMs?: number }
): Promise<AiVideoOutcome> {
  const zai = await getZAI();
  const timeout = opts?.timeoutMs ?? AI_VIDEO_LIMITS.pollTimeoutMs;
  const t0 = Date.now();
  let lastNote = 0;
  while (Date.now() - t0 < timeout) {
    await sleep(AI_VIDEO_LIMITS.pollIntervalMs);
    try {
      const q: any = await zai.async.result.query(task.taskId);
      const status = String(q?.task_status ?? '');
      if (status === 'SUCCESS') {
        const url = q.video_result?.[0]?.url ?? q.video_url ?? q.url ?? q.video;
        const coverUrl = q.video_result?.[0]?.cover_image_url;
        return { status: 'SUCCESS', url: typeof url === 'string' ? url : undefined, coverUrl, raw: q };
      }
      if (status === 'FAIL') {
        return { status: 'FAIL', raw: q };
      }
      if (opts?.onStatus && Date.now() - lastNote > 30_000) {
        lastNote = Date.now();
        opts.onStatus(`অপেক্ষা চলছে… ${Math.round((Date.now() - t0) / 1000)} সে.`);
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (!/429|Too many|timeout/i.test(msg)) {
        // কিছু ক্ষণিক ত্রুটি সহ্য করি — টাস্ক হারাতে চাই না
        if (!/\b5\d{2}\b/.test(msg)) throw err;
      }
    }
  }
  return { status: 'TIMEOUT' };
}

/** URL থেকে ভিডিও ডাউনলোড */
export async function downloadVideo(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ভিডিও ডাউনলোড ব্যর্থ: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 50_000) throw new Error(`ভিডিও-ফাইল অস্বাভাবিক ছোট (${buf.length} বাইট)`);
  return buf;
}

/** বাফারের প্রযুক্তি-যাচাই (§১১ স্তর A) */
export async function validateVideoBuffer(
  buffer: Buffer
): Promise<{ ok: boolean; issues: string[]; info?: MediaInfo }> {
  const issues: string[] = [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'aiv-'));
  try {
    const f = path.join(tmp, 'clip.mp4');
    await writeFile(f, buffer);
    let info: MediaInfo;
    try {
      info = await mediaInfo(f);
    } catch (err: any) {
      return { ok: false, issues: [`ফাইল খোলা যায়নি (ffprobe): ${String(err?.message ?? err).slice(0, 120)}`] };
    }
    if (!info.hasVideo) issues.push('ভিডিও-স্ট্রিম নেই');
    if (info.durationSec < 3) issues.push(`দৈর্ঘ্য খুব কম (${info.durationSec}s)`);
    if (info.width && info.width < 360) issues.push(`রেজোলিউশন খুব কম (${info.width}x${info.height})`);
    return { ok: issues.length === 0, issues, info };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** একটি ক্লিপের সম্পূর্ণ চক্র: সাবমিট → পোল → ডাউনলোড → যাচাই */
export async function generateVideoClip(
  req: AiVideoRequest,
  opts?: { onStatus?: (note: string) => void; timeoutMs?: number }
): Promise<AiVideoClip> {
  const t0 = Date.now();
  const task = await submitVideoTask(req);
  opts?.onStatus?.(`টাস্ক জমা হয়েছে (${task.model}) — জেনারেশন চলছে…`);
  const outcome = await pollVideoTask(task, opts);
  if (outcome.status !== 'SUCCESS' || !outcome.url) {
    const reason = outcome.status === 'TIMEOUT' ? 'সময়সীমা অতিক্রম' : 'মডেল ব্যর্থ ঘোষণা করেছে';
    throw new Error(`AI ভিডিও-জেনারেশন ব্যর্থ: ${reason}`);
  }
  const buffer = await downloadVideo(outcome.url);
  const validation = await validateVideoBuffer(buffer);
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
  };
}

/**
 * একাধিক ক্লিপ — পরপর সাবমিট (ব্যবধান-স্পেসিং), তারপর পালা করে ফলাফল।
 * সৎ আচরণ: কোনো ক্লিপ ব্যর্থ হলে exceptions নয়, ফলাফল-তালিকায় ব্যর্থতা
 * চিহ্নিত করে ফেরত দেয় (পাইপলাইন retry/fallback-নীতি §৭.৪)।
 */
export interface MultiClipResult {
  clips: { index: number; ok: true; clip: AiVideoClip }[];
  failures: { index: number; error: string }[];
}

export async function generateVideoClips(
  reqs: AiVideoRequest[],
  opts?: { onStatus?: (note: string) => void; timeoutMs?: number }
): Promise<MultiClipResult> {
  const clips: MultiClipResult['clips'] = [];
  const failures: MultiClipResult['failures'] = [];

  const tasks: (AiVideoTask | null)[] = [];
  for (let i = 0; i < reqs.length; i++) {
    try {
      const task = await submitVideoTask(reqs[i]);
      tasks.push(task);
      opts?.onStatus?.(`শট ${i + 1}/${reqs.length} সাবমিট সম্পূর্ণ`);
    } catch (err: any) {
      tasks.push(null);
      failures.push({ index: i, error: String(err?.message ?? err).slice(0, 200) });
    }
  }

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task) continue;
    try {
      opts?.onStatus?.(`শট ${i + 1}/${reqs.length} জেনারেট হচ্ছে…`);
      const outcome = await pollVideoTask(task, opts);
      if (outcome.status !== 'SUCCESS' || !outcome.url) {
        failures.push({
          index: i,
          error: outcome.status === 'TIMEOUT' ? 'সময়সীমা অতিক্রম' : 'মডেল ব্যর্থ ঘোষণা করেছে',
        });
        continue;
      }
      const buffer = await downloadVideo(outcome.url);
      const validation = await validateVideoBuffer(buffer);
      if (!validation.ok) {
        failures.push({ index: i, error: `যাচাই ব্যর্থ: ${validation.issues.join('; ')}` });
        continue;
      }
      clips.push({
        index: i,
        ok: true,
        clip: {
          buffer,
          mimeType: 'video/mp4',
          taskId: task.taskId,
          model: task.model,
          generationMs: 0,
          info: validation.info!,
          coverUrl: outcome.coverUrl,
          request: task.request,
        },
      });
    } catch (err: any) {
      failures.push({ index: i, error: String(err?.message ?? err).slice(0, 200) });
    }
  }
  return { clips, failures };
}
