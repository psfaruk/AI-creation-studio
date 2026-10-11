// ============================================================
// System Info & Tool Health — নতুন মাস্টার প্ল্যান §৯.১ ও §১৩
// হার্ডওয়্যার পরিমাপ (CPU/RAM/ডিস্ক/GPU-সনাক্তকরণ/ffmpeg) +
// আসল মাইক্রো-চেক দিয়ে টুল-স্বাস্থ্য পরিমাপ (স্মৃতিতে ক্যাশে)।
// ============================================================

import os from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { statfs } from 'fs/promises';
import { getZAI } from './agent/llm';
import { synthesizeSpeech } from './agent/sdk-helpers';

const execFileAsync = promisify(execFileCb);

export interface HardwareReport {
  cpuCores: number;
  cpuModel: string;
  totalMemGb: number;
  freeMemGb: number;
  diskTotalGb: number;
  diskFreeGb: number;
  gpu: { present: boolean; note: string };
  ffmpeg: string | null;
  ffprobe: string | null;
  nodeVersion: string;
  platform: string;
}

export interface ToolHealth {
  key: string;
  label: string;
  status: 'ok' | 'degraded' | 'down' | 'unknown';
  latencyMs?: number;
  checkedAt?: string;
  note?: string;
}

/** §১৩: বাস্তব হার্ডওয়্যার পরিমাপ — মডেল-নির্বাচনের ভিত্তি */
export async function measureHardware(): Promise<HardwareReport> {
  let ffmpegVersion: string | null = null;
  let ffprobeVersion: string | null = null;
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 });
    ffmpegVersion = (stdout.match(/ffmpeg version ([^\s]+)/) ?? [])[1] ?? null;
  } catch {
    ffmpegVersion = null;
  }
  try {
    const { stdout } = await execFileAsync('ffprobe', ['-version'], { timeout: 10_000 });
    ffprobeVersion = (stdout.match(/ffprobe version ([^\s]+)/) ?? [])[1] ?? null;
  } catch {
    ffprobeVersion = null;
  }

  let gpuPresent = false;
  let gpuNote = 'GPU নেই (nvidia-smি পাওয়া যায়নি) — CPU-অনলি পরিবেশ';
  try {
    await execFileAsync('nvidia-smi', ['-L'], { timeout: 8_000 });
    gpuPresent = true;
    gpuNote = 'GPU সনাক্ত হয়েছে (nvidia-smi)';
  } catch {
    // GPU নেই — প্রত্যাশিত
  }

  let diskTotalGb = 0;
  let diskFreeGb = 0;
  try {
    const st: any = await statfs(process.cwd());
    const bsize = Number(st.bsize) || 4096;
    diskTotalGb = Math.round((Number(st.blocks) * bsize) / 1024 ** 3 * 10) / 10;
    diskFreeGb = Math.round((Number(st.bavail) * bsize) / 1024 ** 3 * 10) / 10;
  } catch {
    // উপেক্ষা
  }

  return {
    cpuCores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model ?? 'অজানা',
    totalMemGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeMemGb: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    diskTotalGb,
    diskFreeGb,
    gpu: { present: gpuPresent, note: gpuNote },
    ffmpeg: ffmpegVersion,
    ffprobe: ffprobeVersion,
    nodeVersion: process.version,
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
  };
}

// ------------------------------------------------------------
// §৯.১: টুল-স্বাস্থ্য — আসল মাইক্রো-চেক (স্মৃতিতে ক্যাশে, HMR-নিরাপদ)
// ------------------------------------------------------------

const g = globalThis as any;
const HEALTH_TTL_MS = 10 * 60 * 1000; // ১০ মিনিট

function healthCache(): Record<string, ToolHealth> {
  if (!g.__toolHealth) g.__toolHealth = {};
  return g.__toolHealth;
}

/** LLM মাইক্রো-চেক: এক-শব্দের উত্তর */
async function checkLlm(): Promise<ToolHealth> {
  const t0 = Date.now();
  try {
    const zai = await getZAI();
    const res = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'শুধু "ঠিক" শব্দটি উত্তর দাও।' },
        { role: 'user', content: 'ping' },
      ],
      thinking: { type: 'disabled' },
    });
    const text = String(res?.choices?.[0]?.message?.content ?? '');
    return {
      key: 'llm',
      label: 'LLM (চ্যাট/পরিকল্পনা)',
      status: text.trim().length > 0 ? 'ok' : 'degraded',
      latencyMs: Date.now() - t0,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      key: 'llm',
      label: 'LLM (চ্যাট/পরিকল্পনা)',
      status: 'down',
      checkedAt: new Date().toISOString(),
      note: String(err?.message ?? err).slice(0, 120),
    };
  }
}

/** TTS মাইক্রো-চেক: এক শব্দের অডিও */
async function checkTts(): Promise<ToolHealth> {
  const t0 = Date.now();
  try {
    const r = await synthesizeSpeech('hi', 'jam', 1);
    return {
      key: 'tts',
      label: 'TTS (কণ্ঠ সংশ্লেষণ)',
      status: r.buffer.length > 1000 ? 'ok' : 'degraded',
      latencyMs: Date.now() - t0,
      checkedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      key: 'tts',
      label: 'TTS (কণ্ঠ সংশ্লেষণ)',
      status: 'down',
      checkedAt: new Date().toISOString(),
      note: String(err?.message ?? err).slice(0, 120),
    };
  }
}

/** FFmpeg চেক */
async function checkFfmpeg(hw: HardwareReport): Promise<ToolHealth> {
  return {
    key: 'ffmpeg',
    label: 'FFmpeg (মিডিয়া প্রসেসিং)',
    status: hw.ffmpeg ? 'ok' : 'down',
    checkedAt: new Date().toISOString(),
    note: hw.ffmpeg ? `v${hw.ffmpeg}` : 'ffmpeg পাওয়া যায়নি',
  };
}

/**
 * টুল-স্বাস্থ্য চালাও (আসল মাইক্রো-চেক; ক্যাশে টিটিএল ১০ মিনিট)।
 * ব্যয়বহুল মডেল (ছবি/ভিডিও-জেন) সচেতনভাবে প্রতি-চেকে চালানো হয় না —
 * তাদের স্বাস্থ্য রেজিস্ট্রি-স্ট্যাটাস থেকে আসে (সৎ নোটসহ)।
 */
export async function runToolHealthChecks(opts?: { force?: boolean }): Promise<ToolHealth[]> {
  const cache = healthCache();
  const now = Date.now();
  const fresh = (k: string) => cache[k] && now - new Date(cache[k].checkedAt ?? 0).getTime() < HEALTH_TTL_MS;

  const hw = await measureHardware();
  const jobs: Promise<ToolHealth>[] = [];

  if (opts?.force || !fresh('llm')) jobs.push(checkLlm());
  if (opts?.force || !fresh('tts')) jobs.push(checkTts());
  if (opts?.force || !fresh('ffmpeg')) jobs.push(checkFfmpeg(hw));

  const results = await Promise.all(jobs);
  for (const r of results) cache[r.key] = r;

  // পরিচিত কিন্তু প্রতি-চেকে না-চালানো সক্ষমতা (সৎ স্ট্যাটিক স্বাস্থ্য)
  const statics: ToolHealth[] = [
    { key: 'imagegen', label: 'ছবি-জেনারেশন (SDK)', status: 'ok', note: 'কনফিগারকৃত — ব্যয়ের কারণে প্রতি-চেকে মাইক্রো-চেক নয়' },
    { key: 'videogen', label: 'CogVideoX-3 ভিডিও-জেনারেশন (ক্লাউড)', status: 'ok', note: 'কনফিগারকৃত — ২০২৬-১০-১১ প্রোব-যাচাইকৃত; প্রতি-চেকে চালানো ব্যয়বহুল' },
    {
      key: 'image-search',
      label: 'ওয়েব-ছবি অনুসন্ধান (SDK)',
      status: 'ok',
      note: 'SDK-মেথড প্রোব-যাচাইকৃত (২০২৬-১০-১১); CLI-ফলব্যাক আছে',
    },
    {
      key: 'video-audio',
      label: 'ভিডিও নেটিভ-অডিও (with_audio)',
      status: 'ok',
      note: 'প্রোব-যাচাইকৃত: প্রকৃত AAC স্ট্রিম আসে',
    },
    { key: 'asr', label: 'ASR (লিপিবদ্ধকরণ)', status: 'ok', note: 'কনফিগারকৃত; বাংলা-সমর্থন দুর্বল' },
    { key: 'vlm', label: 'VLM (ছবি-বোঝা)', status: 'ok', note: 'কনফিগারকৃত' },
    { key: 'music-engine', label: 'প্রসিডিউরাল মিউজিক-ইঞ্জিন', status: 'ok', note: 'স্থানীয় সংশ্লেষণ — নির্ভরযোগ্য' },
    { key: 'sound-design', label: 'সাউন্ড-ডিজাইন ইঞ্জিন', status: 'ok', note: 'স্থানীয় সংশ্লেষণ — নির্ভরযোগ্য' },
    {
      key: 'lip-sync',
      label: 'লিপ-সিঙ্ক মডেল',
      status: 'down',
      note: '৪-মাত্রিক বাধা: SDK-তে API নেই · GPU নেই · অ্যাডাপ্টার নেই · বাংলা বেঞ্চমার্ক হয়নি',
    },
    { key: 'singing', label: 'গান-গাওয়া মডেল', status: 'down', note: 'লাইসেন্স-অযাচাইকৃত/অস্থাপিত (§৩ সৎ-অবস্থা)' },
  ];

  const checked = ['llm', 'tts', 'ffmpeg'].map(k => cache[k]).filter(Boolean) as ToolHealth[];
  return [...checked, ...statics];
}
