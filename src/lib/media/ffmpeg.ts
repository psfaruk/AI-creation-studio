// ============================================================
// FFmpeg/FFprobe wrapper — ভিডিও/অডিও প্রসেসিং ইঞ্জিনের ভিত্তি
// (মাস্টার প্ল্যান §১২: FFmpeg-কে মূল ভিত্তি করা)।
// সব কলে timeout + বিস্তারিত error বার্তা সহ।
// ============================================================

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, readdir, stat, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFileCb);

const FFMPEG = 'ffmpeg';
const FFPROBE = 'ffprobe';

export interface FfmpegRunResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** ffmpeg চালাও (timeout-সহ, ব্যর্থ হলে বোধগম্য বাংলা ত্রুটি) */
export async function runFfmpeg(args: string[], opts?: { timeoutMs?: number; label?: string }): Promise<FfmpegRunResult> {
  const timeoutMs = opts?.timeoutMs ?? 180_000;
  const label = opts?.label ?? 'ffmpeg';
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(FFMPEG, ['-hide_banner', '-y', ...args], {
      timeout: timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
    });
    return { stdout, stderr, durationMs: Date.now() - t0 };
  } catch (err: any) {
    const detail = String(err?.stderr || err?.message || '').split('\n').filter(Boolean).slice(-3).join(' | ');
    throw new Error(`${label} ব্যর্থ: ${detail.slice(0, 400)}`);
  }
}

/** ffprobe চালাও — JSON আউটপুট */
export async function ffprobeJson(file: string, timeoutMs = 30_000): Promise<any> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  } catch (err: any) {
    throw new Error(`মিডিয়া ফাইল পড়া যায়নি (ffprobe): ${String(err?.message ?? err).slice(0, 200)}`);
  }
}

export interface MediaInfo {
  durationSec: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  sampleRate?: number;
  channels?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  formatName?: string;
  sizeBytes: number;
}

/** ফাইলের মূল মিডিয়া-তথ্য */
export async function mediaInfo(file: string): Promise<MediaInfo> {
  const j = await ffprobeJson(file);
  const streams: any[] = Array.isArray(j?.streams) ? j.streams : [];
  const v = streams.find(s => s.codec_type === 'video');
  const a = streams.find(s => s.codec_type === 'audio');
  let fps: number | undefined;
  if (v?.avg_frame_rate && typeof v.avg_frame_rate === 'string' && v.avg_frame_rate.includes('/')) {
    const [num, den] = v.avg_frame_rate.split('/').map(Number);
    if (num > 0 && den > 0) fps = Math.round((num / den) * 100) / 100;
  }
  const st = await stat(file);
  return {
    durationSec: Math.round((Number(j?.format?.duration ?? v?.duration ?? a?.duration ?? 0) || 0) * 100) / 100,
    width: v?.width,
    height: v?.height,
    fps,
    videoCodec: v?.codec_name,
    audioCodec: a?.codec_name,
    sampleRate: a?.sample_rate ? Number(a.sample_rate) : undefined,
    channels: a?.channels,
    hasVideo: !!v,
    hasAudio: !!a,
    formatName: j?.format?.format_name,
    sizeBytes: st.size,
  };
}

// ------------------------------------------------------------
// অডিও গুণমান পরিমাপ (astats + silencedetect + ebur128)
// ------------------------------------------------------------

export interface AudioQualityReport {
  durationSec: number;
  sampleRate?: number;
  channels?: number;
  peakDb?: number;
  rmsDb?: number;
  clippingSamples: number;
  silenceRanges: { start: number; end: number }[];
  loudnessLufs?: number;
}

/** অডিওর গুণমান রিপোর্ট — validate_audio ও পাইপলাইন-যাচাইয়ে ব্যবহৃত */
export async function audioQuality(file: string): Promise<AudioQualityReport> {
  const info = await mediaInfo(file);
  const report: AudioQualityReport = {
    durationSec: info.durationSec,
    sampleRate: info.sampleRate,
    channels: info.channels,
    clippingSamples: 0,
    silenceRanges: [],
  };

  // astats: peak/rms + clipping
  try {
    const { stderr } = await execFileAsync(
      FFMPEG,
      ['-hide_banner', '-i', file, '-af', 'astats=metadata=0', '-f', 'null', '-'],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const peak = /Peak level dBF*S*:\s*(-?[\d.]+|-inf)/i.exec(stderr);
    const rms = /RMS level dB*F*S*:\s*(-?[\d.]+|-inf)/i.exec(stderr);
    if (peak) report.peakDb = peak[1] === '-inf' ? -Infinity : Number(peak[1]);
    if (rms) report.rmsDb = rms[1] === '-inf' ? -Infinity : Number(rms[1]);
    const numPeak = typeof report.peakDb === 'number' ? report.peakDb : -99;
    if (numPeak > -0.05) {
      // প্রায় 0dBFS পিক → সম্ভাব্য ক্লিপিং
      report.clippingSamples = -1; // নির্দেশক
    }
  } catch {
    // astats ব্যর্থ হলে নীরবে এগিয়ে যাও
  }

  // silencedetect
  try {
    const { stderr } = await execFileAsync(
      FFMPEG,
      ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-45dB:d=1.2', '-f', 'null', '-'],
      { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
    );
    let start: number | null = null;
    for (const line of stderr.split('\n')) {
      const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
      const e = /silence_end:\s*([\d.]+)/.exec(line);
      if (s) start = Number(s[1]);
      if (e && start != null) {
        report.silenceRanges.push({ start: Math.max(0, start), end: Number(e[1]) });
        start = null;
      }
    }
    if (start != null) report.silenceRanges.push({ start: Math.max(0, start), end: report.durationSec });
  } catch {
    // উপেক্ষা
  }

  // ebur128 loudness
  try {
    const { stderr } = await execFileAsync(
      FFMPEG,
      ['-hide_banner', '-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'],
      { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const i = /I:\s*(-?[\d.]+)\s*LUFS/i.exec(stderr);
    if (i) report.loudnessLufs = Number(i[1]);
  } catch {
    // উপেক্ষা
  }

  return report;
}

// ------------------------------------------------------------
// কাজের ডিরেক্টরি (প্রোডাকশন ইন্টারমিডিয়েট ফাইল)
// ------------------------------------------------------------

/** প্রতি প্রোডাকশনের জন্য অস্থায়ী ডিরেক্টরি */
export async function makeWorkingDir(productionId: string): Promise<string> {
  const dir = path.join(process.cwd(), 'storage', 'productions', productionId);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** অস্থায়ী ডিরেক্টরি মুছে ফেলা (§৯ cleanup) */
export async function cleanupWorkingDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    // নীরব
  }
}

/** টেম্প ডিরেক্টরি (os) */
export async function makeTempDir(prefix = 'studio-'): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

/** ডিরেক্টরির ফাইল তালিকা */
export async function listDir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

/** সময় → SRT টাইমস্ট্যাম্প (00:00:00,000) */
export function srtTimestamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** বাংলা লেখা সহ SRT ফাইল বানাও (libass বার্ন-ইনেও ব্যবহারযোগ্য) */
export function buildSrt(entries: { start: number; end: number; text: string }[]): string {
  return entries
    .map((e, i) => `${i + 1}\n${srtTimestamp(e.start)} --> ${srtTimestamp(e.end)}\n${e.text}\n`)
    .join('\n');
}
