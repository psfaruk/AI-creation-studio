// ============================================================
// Film helpers — Video Studio + Film Director-এর শেয়ার্ড ইঞ্জিন।
// সৎ পাইপলাইন: AI স্টোরিবোর্ড ফ্রেম (image gen) + সিনেম্যাটিক
// ক্যামেরা-মোশন (ffmpeg zoompan / Ken Burns) + ট্রানজিশন +
// অডিও মিক্স + libass সাবটাইটেল। ডিফিউশন ভিডিও-মডেল নয়।
// ============================================================

import { copyFile, writeFile, stat } from 'fs/promises';
import path from 'path';
import type { AspectRatio, CameraMove } from '@/lib/types';
import { runFfmpeg, mediaInfo, buildSrt } from '@/lib/media/ffmpeg';
import { detectLanguage } from './audio/language_controller';
import { chatJson } from './sdk-helpers';
import type { LLMMessage } from './llm';

// ------------------------------------------------------------
// ধ্রুবক ও ছোট হেল্পার
// ------------------------------------------------------------

export const CINEMATIC_SUFFIX =
  ', cinematic film still, professional lighting, 35mm, high detail, no text, no watermark';

const VALID_MOVES: CameraMove[] = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'];
const ASPECT_RATIOS: Record<AspectRatio, number> = {
  '1:1': 1,
  '4:5': 0.8,
  '3:2': 1.5,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

/** ফাইলনেমের জন্য নিরাপদ ASCII স্লাগ (বাংলা-সহ অ-ASCII বাদ) */
export function sanitize(text: string): string {
  const slug = (text ?? '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (slug || 'studio').slice(0, 48);
}

/** শট-বর্ণনাকে ইমেজ-জেন প্রম্পটে সমৃদ্ধ করা */
export function imagePromptForShot(shot: { description: string }, style?: string): string {
  const desc = (shot.description ?? '').toString().trim().slice(0, 900);
  const stylePart = style ? `, ${style.toString().trim().slice(0, 200)}` : '';
  return `${desc}${CINEMATIC_SUFFIX}${stylePart}`;
}

/** প্রত্যাশিত মোট দৈর্ঘ্যে শট-দৈর্ঘ্যগুলো আনুপাতিকভাবে মানানসই করা */
export function normalizeShotDurations(shots: { durationSec: number }[], totalSec: number): void {
  if (shots.length === 0) return;
  const minDur = 1.5;
  const raw = shots.map(s => Math.max(minDur, Number(s.durationSec) || minDur));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) {
    const even = totalSec / shots.length;
    shots.forEach(s => (s.durationSec = Math.round(even * 10) / 10));
    return;
  }
  const scale = totalSec / sum;
  const scaled = raw.map(d => Math.max(minDur, Math.round(d * scale * 10) / 10));
  // রাউন্ডিং-ত্রুটি শেষ শটে ঢালা
  const scaledSum = scaled.reduce((a, b) => a + b, 0);
  scaled[scaled.length - 1] = Math.round((scaled[scaled.length - 1] + (totalSec - scaledSum)) * 10) / 10;
  if (scaled[scaled.length - 1] < minDur) scaled[scaled.length - 1] = minDur;
  shots.forEach((s, i) => (s.durationSec = scaled[i]));
}

/** ছবির মাপ থেকে নিকটতম সমর্থিত aspect */
export function nearestAspect(width: number, height: number): AspectRatio {
  const r = width / Math.max(1, height);
  let best: AspectRatio = '16:9';
  let bestDiff = Infinity;
  for (const [aspect, ratio] of Object.entries(ASPECT_RATIOS) as [AspectRatio, number][]) {
    const diff = Math.abs(r - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = aspect;
    }
  }
  return best;
}

// ------------------------------------------------------------
// Ken Burns — স্থির ছবি → সিনেম্যাটিক মোশন ক্লিপ (zoompan)
// কৌশল: ইনপুট আগে ২x ওভারস্যাম্পল → জুম-প্যান সাব-পিক্সেলে
// মসৃণ হয়। d = durationSec × fps ফ্রেম।
// ------------------------------------------------------------

export interface KenBurnsOptions {
  durationSec: number;
  fps: 24 | 25 | 30;
  width: number;
  height: number;
  move: 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right' | 'static';
}

export async function kenBurnsClip(
  inputImage: string,
  outputPath: string,
  opts: KenBurnsOptions
): Promise<{ durationSec: number; width: number; height: number; fps: number }> {
  const fps = opts.fps;
  const durationSec = Math.max(1, Math.min(60, Math.round(opts.durationSec * 10) / 10));
  const frames = Math.max(2, Math.round(durationSec * fps));
  const w = Math.max(2, Math.round(opts.width / 2) * 2);
  const h = Math.max(2, Math.round(opts.height / 2) * 2);
  const d = frames;
  const move = VALID_MOVES.includes(opts.move) ? opts.move : 'zoom_in';

  // প্রতি ফ্রেমে জুম-বৃদ্ধির হার — ক্লিপজুড়ে ধারাবাহিক অনুভূতির জন্য
  // মোট ভ্রমণ ১.০ → ১.৩৫ রাখা হয় (৪ সেকেন্ডে ≈0.0037/ফ্রেম)।
  const rateIn = Math.min(0.005, Math.max(0.0006, 0.35 / d));
  const rateOut = Math.min(0.005, Math.max(0.0006, 0.4 / d));

  let z: string;
  let x: string;
  let y: string;
  switch (move) {
    case 'zoom_in':
      z = `min(zoom+${rateIn.toFixed(5)},1.4)`;
      x = 'iw/2-(iw/zoom/2)';
      y = 'ih/2-(ih/zoom/2)';
      break;
    case 'zoom_out':
      z = `if(eq(on,0),1.4,max(zoom-${rateOut.toFixed(5)},1.0))`;
      x = 'iw/2-(iw/zoom/2)';
      y = 'ih/2-(ih/zoom/2)';
      break;
    case 'pan_left':
      z = '1.25';
      x = '(iw-iw/zoom)*on/(duration-1)';
      y = 'ih/2-(ih/zoom/2)';
      break;
    case 'pan_right':
      z = '1.25';
      x = '(iw-iw/zoom)*(1-on/(duration-1))';
      y = 'ih/2-(ih/zoom/2)';
      break;
    case 'static':
    default:
      z = `min(1.15+on*${(0.07 / d).toFixed(5)},1.22)`;
      x = 'iw/2-(iw/zoom/2)';
      y = 'ih/2-(ih/zoom/2)';
      break;
  }

  const filter =
    `scale=${w * 2}:${h * 2}:flags=lanczos,` +
    `zoompan=z='${z}':x='${x}':y='${y}':d=${d}:s=${w}x${h}:fps=${fps},` +
    `format=yuv420p`;

  await runFfmpeg(
    [
      '-loop', '1', '-i', inputImage,
      '-t', String(durationSec + 0.5),
      '-frames:v', String(frames),
      '-filter_complex', filter,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
      '-an', outputPath,
    ],
    { timeoutMs: 240_000, label: `Ken Burns (${move}) ক্লিপ` }
  );

  const info = await mediaInfo(outputPath);
  if (!info.hasVideo || info.durationSec <= 0) {
    throw new Error('Ken Burns ক্লিপ তৈরি হলেও বৈধ ভিডিও পাওয়া যায়নি');
  }
  return { durationSec: info.durationSec, width: info.width ?? w, height: info.height ?? h, fps: info.fps ?? fps };
}

// ------------------------------------------------------------
// ক্লিপ-কনক্যাট: ১টি → কপি, ≤৬টি → xfade চেইন,
// >৬টি → প্রতি ক্লিপে fade in/out + concat demuxer (বিশ্বস্তপথ)
// ------------------------------------------------------------

export async function concatClips(
  paths: string[],
  outputPath: string,
  opts: { transitionSec: number }
): Promise<void> {
  if (paths.length === 0) throw new Error('কনক্যাট করার মতো কোনো ক্লিপ নেই');
  if (paths.length === 1) {
    await copyFile(paths[0], outputPath);
    return;
  }

  const T = Math.max(0.1, Math.min(1.5, opts.transitionSec));
  const durations: number[] = [];
  for (const p of paths) {
    const info = await mediaInfo(p);
    if (!info.hasVideo || info.durationSec <= 0) throw new Error(`ক্লিপ পড়া যায়নি: ${path.basename(p)}`);
    durations.push(info.durationSec);
  }

  if (paths.length <= 6) {
    // xfade চেইন — অফসেট = প্রিফিক্স-যোগফল − প্রতি জংশনে ট্রানজিশন
    const inputs: string[] = [];
    for (const p of paths) inputs.push('-i', p);
    const parts: string[] = [];
    let prev = '[0:v]';
    let prefix = durations[0];
    for (let i = 1; i < paths.length; i++) {
      const offset = Math.max(0, prefix - T);
      const out = i === paths.length - 1 ? '[vout]' : `[v${i}]`;
      parts.push(`${prev}[${i}:v]xfade=transition=fade:duration=${T.toFixed(2)}:offset=${offset.toFixed(3)}${out}`);
      prev = out;
      prefix = prefix + durations[i] - T;
    }
    await runFfmpeg(
      [
        ...inputs,
        '-filter_complex', parts.join(';'),
        '-map', '[vout]',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '21',
        '-pix_fmt', 'yuv420p', '-an', outputPath,
      ],
      { timeoutMs: 300_000, label: 'ক্লিপ-কনক্যাট (xfade)' }
    );
    return;
  }

  // >৬ ক্লিপ — প্রতিটিতে fade in/out দিয়ে পুনঃএনকোড, তারপর concat demuxer
  const dir = path.dirname(outputPath);
  const prepped: string[] = [];
  for (let i = 0; i < paths.length; i++) {
    const target = path.join(dir, `cat-prep-${i}.mp4`);
    const dur = durations[i];
    const fadeOut = Math.max(0, dur - Math.min(0.4, T));
    await runFfmpeg(
      [
        '-i', paths[i],
        '-vf', `fade=t=in:st=0:d=${Math.min(0.4, T).toFixed(2)},fade=t=out:st=${fadeOut.toFixed(2)}:d=${Math.min(0.4, T).toFixed(2)}`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '21',
        '-pix_fmt', 'yuv420p', '-an', target,
      ],
      { timeoutMs: 240_000, label: `ফেড-প্রস্তুতি (${i + 1}/${paths.length})` }
    );
    prepped.push(target);
  }
  const listFile = path.join(dir, 'concat-list.txt');
  await writeFile(listFile, prepped.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
  await runFfmpeg(
    ['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-an', outputPath],
    { timeoutMs: 300_000, label: 'ক্লিপ-কনক্যাট (concat demuxer)' }
  );
}

// ------------------------------------------------------------
// পরিবেশ-শব্দ (ambient bed) — সৎ সংশ্লেষিত pink noise,
// lowpass দিয়ে নরম করা; কোনো ভুয়া "বাতাসের রেকর্ডিং" দাবি নয়
// ------------------------------------------------------------

export async function generateAmbientBed(outputPath: string, durationSec: number): Promise<void> {
  const dur = Math.max(1, Math.round(durationSec * 10) / 10);
  const fadeIn = Math.min(1.5, dur / 4);
  const fadeOutStart = Math.max(0, dur - fadeIn);
  await runFfmpeg(
    [
      '-f', 'lavfi', '-i', `anoisesrc=color=pink:amplitude=0.03:duration=${dur.toFixed(2)}`,
      '-af', `lowpass=f=800,afade=t=in:st=0:d=${fadeIn.toFixed(2)},afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeIn.toFixed(2)}`,
      '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', outputPath,
    ],
    { timeoutMs: 60_000, label: 'পরিবেশ-শব্দ বিছানো' }
  );
}

// ------------------------------------------------------------
// অডিও মিক্স — ভয়েস (adelay) + গান/পরিবেশ-শব্দ (ভলিউম 0.25,
// −12dB) + ঐচ্ছিক sidechain ducking + amix(normalize=0) +
// শেষ ১ সে. ফেড-আউট + durationSec পর্যন্ত সাইলেন্স-প্যাড
// ------------------------------------------------------------

export interface MixAudioOptions {
  voiceFiles: { file: string; startSec: number }[];
  musicFile?: string;
  ambient: boolean;
  durationSec: number;
  outputPath: string;
  duck: boolean;
}

/** @returns outputPath (সফল হলে) বা null (কোনো অডিও উৎসই না থাকলে) */
export async function mixAudioTracks(opts: MixAudioOptions): Promise<string | null> {
  const dur = Math.max(0.5, Math.round(opts.durationSec * 10) / 10);
  const dir = path.dirname(opts.outputPath);

  const sources: { file: string; kind: 'voice' | 'bed' }[] = [];
  for (const v of opts.voiceFiles) {
    if (v.file && (await stat(v.file).catch(() => null))) {
      sources.push({ file: v.file, kind: 'voice' });
    }
  }
  let bedFile = opts.musicFile ?? null;
  if (opts.ambient && !bedFile) {
    bedFile = path.join(dir, 'ambient-bed.wav');
    await generateAmbientBed(bedFile, dur);
  }
  const hasBed = !!bedFile && !!(await stat(bedFile).catch(() => null));
  if (!hasBed && sources.length === 0) return null;

  const useDuck = opts.duck && sources.length > 0 && hasBed;

  const inputs: string[] = [];
  const chains: string[] = [];
  let inputIdx = 0;
  const voiceOutLabels: string[] = [];

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    inputs.push('-i', src.file);
    const delayMs = Math.max(0, Math.round((opts.voiceFiles.find(v => v.file === src.file)?.startSec ?? 0) * 1000));
    const parts = [
      'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo',
      'volume=1.0',
      delayMs > 0 ? `adelay=${delayMs}:all=1` : 'anull',
    ];
    if (i === 0 && useDuck) {
      // প্রথম ভয়েস asplit দিয়ে সাইডচেইন (ডাকিং) ও amix — দুই জায়গায়
      chains.push(`[${inputIdx}:a]${parts.join(',')},asplit=2[v0][v0sc]`);
      voiceOutLabels.push('[v0]');
    } else {
      chains.push(`[${inputIdx}:a]${parts.join(',')}[v${inputIdx}]`);
      voiceOutLabels.push(`[v${inputIdx}]`);
    }
    inputIdx++;
  }

  let bedLabel: string | null = null;
  if (hasBed && bedFile) {
    inputs.push('-i', bedFile);
    bedLabel = 'mbed';
    const bedPre = `aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=0.25`;
    if (useDuck) {
      // গান/শব্দ-বিছানা প্রথম ভয়েসের সাইডচেইনে নেওয়া হবে (কথা বললে নেমে আসে)
      chains.push(`[${inputIdx}:a]${bedPre}[mraw]`);
      chains.push('[mraw][v0sc]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=400[mbed]');
    } else {
      chains.push(`[${inputIdx}:a]${bedPre}[mbed]`);
    }
    inputIdx++;
  }

  const mixInputs = [...voiceOutLabels];
  if (bedLabel) mixInputs.push(`[${bedLabel}]`);
  const fadeStart = Math.max(0, dur - 1);
  chains.push(
    `${mixInputs.join('')}amix=inputs=${mixInputs.length}:normalize=0,` +
      `alimiter=limit=0.95,afade=t=out:st=${fadeStart.toFixed(2)}:d=1,` +
      `apad=whole_dur=${dur.toFixed(2)},atrim=0:${dur.toFixed(2)}[aout]`
  );

  await runFfmpeg(
    [...inputs, '-filter_complex', chains.join(';'), '-map', '[aout]', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', opts.outputPath],
    { timeoutMs: 180_000, label: 'অডিও মিক্স' }
  );

  const info = await stat(opts.outputPath).catch(() => null);
  if (!info || info.size === 0) throw new Error('অডিও মিক্স ফাইল তৈরি হয়নি');
  return opts.outputPath;
}

// ------------------------------------------------------------
// চূড়ান্ত মাক্স — ভিডিও + মিক্স করা অডিও
// ------------------------------------------------------------

export async function muxAudio(
  videoIn: string,
  audioIn: string,
  outputPath: string,
  opts: { durationSec?: number; fadeOutSec?: number }
): Promise<void> {
  const args: string[] = ['-i', videoIn, '-i', audioIn];
  const af: string[] = ['aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo'];
  if (opts.fadeOutSec && opts.durationSec) {
    af.push(`afade=t=out:st=${Math.max(0, opts.durationSec - opts.fadeOutSec).toFixed(2)}:d=${opts.fadeOutSec}`);
  }
  af.push(`apad=whole_dur=${(opts.durationSec ?? 3600).toFixed(2)}`);
  args.push('-filter_complex', `[1:a]${af.join(',')}[a]`, '-map', '0:v:0', '-map', '[a]');
  args.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k');
  if (opts.durationSec) args.push('-t', opts.durationSec.toFixed(2));
  args.push(outputPath);
  await runFfmpeg(args, { timeoutMs: 240_000, label: 'অডিও-ভিডিও মাক্স' });
}

// ------------------------------------------------------------
// libass সাবটাইটেল বার্ন — Noto Sans Bengali সিস্টেম-ইনস্টলড
// ------------------------------------------------------------

export async function burnSubtitles(videoIn: string, srtPath: string, videoOut: string): Promise<void> {
  // subtitles ফিল্টারে পাথ-এস্কেপ (কোলন/কোট/ব্যাকস্ল্যাশ)
  const escaped = srtPath
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
  const style =
    'FontName=Noto Sans Bengali,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=1,Outline=2,MarginV=36';
  const info = await mediaInfo(videoIn);
  const args = [
    '-i', videoIn,
    '-vf', `subtitles='${escaped}':force_style='${style}'`,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
  ];
  if (info.hasAudio) args.push('-c:a', 'copy');
  else args.push('-an');
  args.push(videoOut);
  await runFfmpeg(args, { timeoutMs: 300_000, label: 'সাবটাইটেল বার্ন' });
}

// ------------------------------------------------------------
// SRT নির্মাণ সহায়ক
// ------------------------------------------------------------

export function makeSrt(entries: { start: number; end: number; text: string }[]): string {
  return buildSrt(entries);
}

/** লেখা → ১–৪ সেকেন্ডের কিউতে ভাগ (chatJson দিয়ে) */
export async function segmentDialogueToCues(
  text: string,
  opts: { totalDurationSec?: number; language?: string }
): Promise<{ start: number; end: number; text: string }[]> {
  const budget = Math.round((opts.totalDurationSec ?? Math.max(4, text.length / 13)) * 10) / 10;
  const messages: LLMMessage[] = [
    {
      role: 'assistant',
      content:
        'তুমি একজন প্রফেশনাল সাবটাইটেল এডিটর। নিচের লেখাকে ১–৪ সেকেন্ডে পড়ার মতো ছোট ছোট কিউতে ভাগো। ' +
        'প্রতিটি কিউ স্বাভাবিক বাক্য-সীমায় কাটবে (মাঝ-বাক্যে নয়, যতটা সম্ভব)। ' +
        `মোট প্রদর্শন-সময় ≈ ${budget.toFixed(1)} সেকেন্ড। ভাষা: ${opts.language === 'en' ? 'ইংরেজি' : 'বাংলা'} — কিউ-লেখা যেন ভাঙা না হয়। ` +
        'শুধুমাত্র এই JSON দিয়ে উত্তর দাও, অন্য কিছু নয়: {"cues":[{"text":"..."}...]}',
    },
    { role: 'user', content: text.slice(0, 6000) },
  ];
  const { data } = await chatJson<{ cues: { text?: string }[] }>(messages);
  const rawCues = Array.isArray(data?.cues) ? data.cues : [];
  const texts = rawCues
    .map(c => String(c?.text ?? '').trim())
    .filter(t => t.length > 0)
    .slice(0, 120);
  if (texts.length === 0) {
    // ফলব্যাক: বাক্য-ভিত্তিক সরল বিভাজন
    const sentences = text.split(/(?<=[।!?\.])\s+/).map(s => s.trim()).filter(Boolean);
    return distributeCues(sentences.length > 0 ? sentences : [text], budget);
  }
  return distributeCues(texts, budget);
}

function distributeCues(texts: string[], totalSec: number): { start: number; end: number; text: string }[] {
  const totalChars = texts.reduce((a, t) => a + t.length, 0) || 1;
  const cues: { start: number; end: number; text: string }[] = [];
  let cursor = 0;
  for (const t of texts) {
    const d = Math.max(1, Math.min(4, (t.length / totalChars) * totalSec));
    cues.push({ start: Math.round(cursor * 100) / 100, end: Math.round((cursor + d) * 100) / 100, text: t });
    cursor += d;
  }
  // শেষ কিউ মোট সময়ে টেনে আনা
  if (cues.length > 0 && cues[cues.length - 1].end < totalSec - 0.5) {
    cues[cues.length - 1].end = Math.round(totalSec * 100) / 100;
  }
  return cues;
}

// ------------------------------------------------------------
// LLM শট-প্ল্যান — আইডিয়া → ক্যামেরা-নির্দেশিত শট-তালিকা
// ------------------------------------------------------------

export interface PlannedShot {
  /** ইংরেজি বর্ণনা (ইমেজ-জেনারেশনের জন্য) */
  description: string;
  /** বাংলা লেবেল (ইউজার-পাঠযোগ্য তালিকার জন্য) */
  label: string;
  cameraMove: CameraMove;
  durationSec: number;
  mood?: string;
}

export interface ShotPlanOptions {
  count: number;
  durationHintSec: { min: number; max: number };
  maxCount: number;
  aspect?: AspectRatio;
  totalDurationSec?: number;
  context?: string;
}

export async function shotPlanFromLLM(idea: string, opts: ShotPlanOptions): Promise<PlannedShot[]> {
  const count = Math.max(1, Math.min(opts.maxCount, opts.count));
  const total = opts.totalDurationSec ?? count * ((opts.durationHintSec.min + opts.durationHintSec.max) / 2);
  const messages: LLMMessage[] = [
    {
      role: 'assistant',
      content:
        'তুমি একজন অভিজ্ঞ চলচ্চিত্র-পরিচালক ও শট-প্ল্যানার। আইডিয়াকে ধারাবাহিক সিনেম্যাটিক শটে ভাগো। ' +
        `ঠিক ${count}টি শট দাও। শটগুলোর দৈর্ঘ্যের যোগফল ≈ ${total.toFixed(1)} সেকেন্ড হবে ` +
        `(প্রতিটি ${opts.durationHintSec.min}–${opts.durationHintSec.max} সেকেন্ডের মধ্যে)। ` +
        'cameraMove এর একটি হবে: "zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"static"। ' +
        'description অবশ্যই ইংরেজিতে (AI ইমেজ-জেনারেশনের জন্য — দৃশ্য, রং, আলো, মুড সহ) আর label বাংলায় (মানুষের পড়ার জন্য ছোট লেবেল)। ' +
        'শুধুমাত্র এই JSON দিয়ে উত্তর দাও, অন্য কিছু নয়: ' +
        '{"shots":[{"description":"english scene description...","label":"বাংলা লেবেল","cameraMove":"zoom_in","durationSec":4,"mood":"..."}...]}',
    },
    {
      role: 'user',
      content:
        `আইডিয়া: ${idea.slice(0, 2000)}\n` +
        (opts.aspect ? `টার্গেট অনুপাত: ${opts.aspect} (${opts.aspect === '9:16' ? 'ভার্টিকাল/শর্টস' : opts.aspect === '16:9' ? 'ওয়াইড/সিনেম্যাটিক' : 'অন্যান্য'})\n` : '') +
        (opts.context ? `অতিরিক্ত প্রসঙ্গ: ${opts.context.slice(0, 1000)}\n` : '') +
        `মোট দৈর্ঘ্য: ${total.toFixed(1)} সেকেন্ড, শট-সংখ্যা: ${count}`,
    },
  ];
  const { data } = await chatJson<{ shots: Partial<PlannedShot>[] }>(messages);
  const raw = Array.isArray(data?.shots) ? data.shots : [];
  const shots: PlannedShot[] = [];
  for (const s of raw) {
    const description = String(s?.description ?? '').trim();
    if (!description) continue;
    const move = VALID_MOVES.includes(s?.cameraMove as CameraMove) ? (s!.cameraMove as CameraMove) : 'zoom_in';
    let dur = Number(s?.durationSec);
    if (!Number.isFinite(dur)) dur = (opts.durationHintSec.min + opts.durationHintSec.max) / 2;
    dur = Math.max(opts.durationHintSec.min, Math.min(opts.durationHintSec.max, dur));
    shots.push({
      description: description.slice(0, 900),
      label: String(s?.label ?? '').trim().slice(0, 120) || description.slice(0, 80),
      cameraMove: move,
      durationSec: Math.round(dur * 10) / 10,
      mood: s?.mood ? String(s.mood).slice(0, 60) : undefined,
    });
  }
  if (shots.length === 0) {
    // সৎ ফলব্যাক — একক শট
    shots.push({
      description: idea.slice(0, 500) || 'A cinematic establishing shot matching the given idea',
      label: 'মূল দৃশ্য',
      cameraMove: 'zoom_in',
      durationSec: Math.min(opts.durationHintSec.max, Math.max(opts.durationHintSec.min, total)),
    });
  }
  return shots.slice(0, opts.maxCount);
}

/** প্রম্পট থেকে চরিত্রের আবির্ভাব-বর্ণনা → পোর্ট্রেট প্রম্পট */
export function portraitPrompt(name: string, appearance: string): string {
  return (
    `Character reference portrait of ${name}: ${appearance}. ` +
    'Waist-up, facing camera, neutral studio-like background, soft even lighting, ' +
    'consistent character reference sheet style, cinematic, high detail, 35mm'
  ).slice(0, 1100);
}

// ------------------------------------------------------------
// বিষয়বস্তু-ভাষা যাচাই ও সংশোধন (২০২৬-১০-১৩, ব্যবহারকারীর নিয়ম)
// ------------------------------------------------------------

/**
 * LLM-লিখা বিষয়বস্তুর ভাষা প্রত্যাশার সাথে মিলছে কি না। না মিললে
 * একবার স্পষ্ট নির্দেশনায় পুনর্লিখন (লিরিক্স/সংলাপ চ্যাটের ভাষাতেই
 * হবে — ব্যবহারকারীর সুস্পষ্ট নিয়ম)। যাচাই-ফল সৎ-নোটসহ।
 */
export async function ensureContentLanguage(
  content: string,
  language: 'bn' | 'en',
  kind: string
): Promise<{ text: string; note: string | null }> {
  const det = detectLanguage(content);
  if (det.language === 'unknown' || det.language === 'mixed' || det.language === language) {
    return { text: content, note: null };
  }
  // ভাষা মিলেনি — একবার পুনর্লিখন
  const wanted = language === 'bn' ? 'বাংলা (বাংলা লিপি)' : 'English';
  try {
    const { chatJson } = await import('./sdk-helpers');
    const { data } = await chatJson<{ text?: string }>([
      {
        role: 'assistant',
        content:
          `The following ${kind} is written in the wrong language. Rewrite it entirely in ${wanted}. ` +
          `Keep the meaning, structure, emotion and length. Do not add any commentary. ` +
          `Respond only with JSON: {"text": "..."}`,
      },
      { role: 'user', content: content.slice(0, 6000) },
    ]);
    const fixed = String(data?.text ?? '').trim();
    if (fixed && detectLanguage(fixed).language === language) {
      return {
        text: fixed,
        note: `${kind}-এর ভাষা প্রত্যাশার বাইরে ছিল — ${language === 'bn' ? 'বাংলায়' : 'ইংরেজিতে'} পুনর্লিখিত হয়েছে।`,
      };
    }
    return {
      text: content,
      note: `${kind}-এর ভাষা যাচাই-সংশোধন সফল হয়নি — প্রিভিউতে ভাষা মিলিয়ে দেখুন।`,
    };
  } catch {
    return {
      text: content,
      note: `${kind}-এর ভাষা মিলেনি (পুনর্লিখন-কল ব্যর্থ) — প্রিভিউতে ভাষা মিলিয়ে দেখুন।`,
    };
  }
}
