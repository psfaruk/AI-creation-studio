// ============================================================
// Audio Studio tools — মাস্টার প্ল্যান §৪-এর বাস্তবায়ন।
//   plan_music (LLM নীলনকশা), generate_instrumental / generate_singing /
//   separate_stems (লাইসেন্স-নীতিতে অবরুদ্ধ — সৎ structured error),
//   process_audio (FFmpeg), mix_audio (filtergraph + ডাকিং),
//   validate_audio (astats/ebur128/silencedetect), inspect_media (ffprobe)।
// শেয়ার্ড হেল্পার (toBn/chunkScriptForTts/planMusicContent) অডিও
// পাইপলাইনও (production/pipelines/audio.ts) ব্যবহার করে।
// ============================================================

import path from 'path';
import { readFile } from 'fs/promises';
import { z } from 'zod';
import { db } from '@/lib/db';
import type { ToolSpec } from '../registry-helpers';
import { createToolArtifact, artifactFilePath } from '../registry-helpers';
import { saveArtifactFile } from '../storage';
import { chatJson } from '../sdk-helpers';
import type { LLMMessage } from '../llm';
import {
  runFfmpeg,
  mediaInfo,
  audioQuality,
  makeTempDir,
  cleanupWorkingDir,
} from '@/lib/media/ffmpeg';
import {
  synthesizeInstrumental,
  validateInstrumental,
  analyzeAudioEnergy,
  moodLabel,
  type MusicMood,
} from '../audio/music_engine';
import {
  synthesizeVerifiedSpeech,
  detectLanguage,
  LANGUAGE_PROFILES,
  verdictLabel,
  type SpeechLanguage,
} from '../audio/language_controller';
import type { TtsVoice, TTS_VOICES } from '../sdk-helpers';

// ------------------------------------------------------------
// শেয়ার্ড টেক্সট-হেল্পার (পাইপলাইনেও ব্যবহৃত)
// ------------------------------------------------------------

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** সংখ্যার ইংরেজি অঙ্ক → বাংলা অঙ্ক (দশমিকসহ) */
export function toBn(value: number | string): string {
  return String(value).replace(/[0-9]/g, d => BN_DIGITS[Number(d)]);
}

/** dB মান মানব-পাঠযোগ্য করা (-Infinity → "-∞") */
export function fmtDb(dbValue: number | undefined | null): string {
  if (dbValue == null || !Number.isFinite(dbValue)) return '-∞';
  return `${toBn(dbValue.toFixed(1))} dB`;
}

/**
 * নির্ভুল ইন্টিগ্রেটেড-লাউডনেস (ebur128) — চূড়ান্ত সারসংক্ষেপের মান
 * (শেষ মিল) নেয়। শেয়ার্ড audioQuality-র পার্সার প্রথম মিল ধরে, যা
 * লাইভ-লাইনের আংশিক মান (যেমন -70) হতে পারে — তাই নির্ভুলতার জন্য
 * আলাদা পাস।
 */
export async function measureLoudnessPrecise(file: string): Promise<number | null> {
  try {
    const { stderr } = await runFfmpeg(['-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], {
      label: 'ebur128 লাউডনেস',
      timeoutMs: 90_000,
    });
    const matches = [...stderr.matchAll(/I:\s*(-?[\d.]+|-inf)\s*LUFS/gi)];
    const last = matches[matches.length - 1];
    if (!last || last[1] === '-inf') return null;
    const value = Number(last[1]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * লম্বা স্ক্রিপ্টকে TTS-উপযোগী (≤max অক্ষর) অংশে ভাগ — বাক্য-সীমানায়
 * (। ? ! . এবং নতুন লাইন) ভেঙে, ক্রম অক্ষুণ্ণ রেখে। অতিদীর্ঘ বাক্য
 * স্পেসে ভেঙে নেওয়া হয়।
 */
export function chunkScriptForTts(text: string, max = 950): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  // বাক্য-সীমানাচিহ্নসহ টুকরো
  const pieces: string[] = [];
  let buf = '';
  for (const ch of normalized) {
    buf += ch;
    if (ch === '।' || ch === '?' || ch === '!' || ch === '.' || ch === '\n') {
      pieces.push(buf);
      buf = '';
    }
  }
  if (buf.trim()) pieces.push(buf);

  // বাক্য জমিয়ে ≤max অংশ
  const chunks: string[] = [];
  let cur = '';
  const flush = () => {
    const t = cur.trim();
    if (t) chunks.push(t);
    cur = '';
  };
  for (const piece of pieces) {
    if (!piece.trim()) continue;
    if (piece.length > max) {
      // একটি বাক্যই সীমার চেয়ে বড় → শেষ স্পেসে ভাঙা
      flush();
      let rest = piece;
      while (rest.trim().length > max) {
        let cut = rest.lastIndexOf(' ', max);
        if (cut < max * 0.5) cut = max;
        const part = rest.slice(0, cut).trim();
        if (part) chunks.push(part);
        rest = rest.slice(cut);
      }
      cur = rest;
      continue;
    }
    if ((cur + piece).length > max) {
      flush();
      cur = piece;
    } else {
      cur += piece;
    }
  }
  flush();
  return chunks;
}

// ------------------------------------------------------------
// plan_music — গানের নীলনকশা (টুল ও পাইপলাইন উভয়ে ব্যবহৃত)
// ------------------------------------------------------------

export interface MusicPlanSection {
  name: string;
  startSec: number;
  durationSec: number;
  notes: string;
}

export interface MusicPlan {
  title: string;
  tempoBpm: number;
  key: string;
  songSections: MusicPlanSection[];
  lyrics: string;
  vocalStyle: string;
  instruments: string[];
  musicModelPrompt: string;
}

export interface MusicPlanOptions {
  genre?: string;
  mood?: string;
  language?: 'bn' | 'en';
  durationSec?: number;
}

function coerceStr(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function coerceNum(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** LLM-এর JSON-কে নিরাপদ MusicPlan-এ রূপান্তর (অসম্পূর্ণ হলে বাংলা ত্রুটি) */
function sanitizeMusicPlan(data: unknown, opts: MusicPlanOptions, idea: string): MusicPlan {
  if (!data || typeof data !== 'object') {
    throw new Error('গানের পরিকল্পনা তৈরি করা যায়নি — মডেল বৈধ JSON দেয়নি। একটু পরে আবার চেষ্টা করো।');
  }
  const o = data as Record<string, unknown>;
  const rawSections = Array.isArray(o.songSections) ? o.songSections : [];
  const songSections: MusicPlanSection[] = [];
  for (const s of rawSections) {
    if (!s || typeof s !== 'object') continue;
    const so = s as Record<string, unknown>;
    const name = coerceStr(so.name);
    if (!name) continue;
    const startSec = Math.max(0, Number(so.startSec) || 0);
    const durNum = Number(so.durationSec);
    const durationSec = Number.isFinite(durNum) && durNum > 0 ? durNum : 15;
    songSections.push({ name, startSec, durationSec, notes: coerceStr(so.notes) });
  }
  if (songSections.length === 0) {
    throw new Error('গানের পরিকল্পনা অসম্পূর্ণ — কোনো সেকশন পাওয়া যায়নি। আবার চেষ্টা করো।');
  }
  const lyrics = coerceStr(o.lyrics);
  if (!lyrics) {
    throw new Error('গানের কথা (lyrics) তৈরি হয়নি — আবার চেষ্টা করো।');
  }
  const tempoBpm = Math.round(coerceNum(o.tempoBpm, 100, 40, 220));
  const key = coerceStr(o.key, 'C major');
  const vocalStyle = coerceStr(o.vocalStyle, 'স্বাভাবিক কণ্ঠ');
  const instruments = Array.isArray(o.instruments)
    ? Array.from(
        new Set(
          o.instruments
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .map(x => x.trim())
        )
      ).slice(0, 12)
    : [];
  const musicModelPrompt = coerceStr(
    o.musicModelPrompt,
    `Instrumental song in ${key} at ${tempoBpm} BPM${opts.genre ? `, ${opts.genre}` : ''}${
      opts.mood ? `, ${opts.mood} mood` : ''
    }; instruments: ${instruments.slice(0, 6).join(', ') || 'acoustic guitar, tabla, strings'}.`
  );
  return {
    title: coerceStr(o.title, idea.slice(0, 60) || 'নামহীন গান'),
    tempoBpm,
    key,
    songSections,
    lyrics,
    vocalStyle,
    instruments,
    musicModelPrompt,
  };
}

/** MusicPlan → সুন্দর ফরম্যাট করা বাংলা টেক্সট-দলিল */
export function formatMusicPlanDocument(plan: MusicPlan, opts: MusicPlanOptions): string {
  const totalSec = plan.songSections.reduce((sum, s) => sum + s.durationSec, 0);
  const lines: string[] = [];
  lines.push(`গানের পরিকল্পনা — ${plan.title}`);
  lines.push('='.repeat(Math.max(24, plan.title.length + 22)));
  lines.push('');
  lines.push('[মূল তথ্য]');
  lines.push(`টেম্পো: ${toBn(plan.tempoBpm)} BPM`);
  lines.push(`স্কেল/কী: ${plan.key}`);
  lines.push(`কণ্ঠের ধরন: ${plan.vocalStyle}`);
  if (opts.genre) lines.push(`ধরন (genre): ${opts.genre}`);
  if (opts.mood) lines.push(`মুড: ${opts.mood}`);
  lines.push(`ভাষা: ${opts.language === 'en' ? 'ইংরেজি' : 'বাংলা'}`);
  if (opts.durationSec) lines.push(`লক্ষ্য-দৈর্ঘ্য: ${toBn(opts.durationSec)} সেকেন্ড`);
  lines.push(`সেকশন-সমষ্টি: প্রায় ${toBn(totalSec)} সেকেন্ড`);
  lines.push('');
  lines.push('[সেকশন-টেবিল]');
  lines.push('নাম | শুরু (সে.) | দৈর্ঘ্য (সে.) | নোট');
  lines.push('--- | --- | --- | ---');
  for (const s of plan.songSections) {
    lines.push(`${s.name} | ${toBn(s.startSec)} | ${toBn(s.durationSec)} | ${s.notes || '—'}`);
  }
  lines.push('');
  lines.push('[লিরিক্স]');
  lines.push(plan.lyrics);
  lines.push('');
  lines.push('[ইনস্ট্রুমেন্ট তালিকা]');
  if (plan.instruments.length > 0) {
    for (const inst of plan.instruments) lines.push(`- ${inst}`);
  } else {
    lines.push('- (নির্দিষ্ট হয়নি)');
  }
  lines.push('');
  lines.push('[Music Model Prompt — ইংরেজি]');
  lines.push(plan.musicModelPrompt);
  lines.push('');
  lines.push('— plan_music (অডিও স্টুডিও) দিয়ে প্রস্তুত');
  return lines.join('\n');
}

/** আইডিয়া → { plan, document } — টুল ও অডিও-পাইপলাইন উভয়ে ব্যবহৃত */
export async function planMusicContent(idea: string, opts: MusicPlanOptions = {}): Promise<{ plan: MusicPlan; document: string }> {
  const language = opts.language ?? 'bn';
  const sys = `তুমি একজন অভিজ্ঞ বাঙালি গীতিকার, সুরকার ও মিউজিক-প্রযোজক। দেওয়া আইডিয়া থেকে একটি সম্পূর্ণ গানের নীলনকশা তৈরি করবে।
শুধুমাত্র একটি বৈধ JSON অবজেক্ট দিয়ে উত্তর দাও — কোনো ভূমিকা, ব্যাখ্যা, markdown বা কোড-ফেন্স নয়। JSON-এর গঠন ঠিক এরকম:
{"title": string, "tempoBpm": number, "key": string, "songSections": [{"name": string, "startSec": number, "durationSec": number, "notes": string}], "lyrics": string, "vocalStyle": string, "instruments": string[], "musicModelPrompt": string}
নিয়ম:
- "title": গানের ${language === 'en' ? 'ইংরেজি' : 'বাংলা'} শিরোনাম (সংক্ষিপ্ত ও অর্থবহ)।
- "tempoBpm": ৪০–২২০-এর মধ্যে বাস্তবসম্মত সংখ্যা।
- "key": সুরের স্কেল, যেমন "A minor", "C major"।
- "songSections": কমপক্ষে ৪টি সেকশন (ইন্ট্রো, কবিতা/ভার্স, কোরাস/সাবি, আউটরো ইত্যাদি)। "name" ${language === 'en' ? 'ইংরেজিতে' : 'বাংলায়'}, "startSec" ও "durationSec" সেকেন্ডের সংখ্যা (ধারাবাহিক, আগের সেকশনের শেষে পরেরটি শুরু), "notes" ${language === 'en' ? 'ইংরেজিতে' : 'বাংলায়'} ওই অংশের বাদ্যযন্ত্র ও আবেগ-নির্দেশনা।
- "lyrics": সম্পূর্ণ গানের কথা ${language === 'en' ? 'ইংরেজিতে' : 'বাংলায়'} — প্রতিটি সেকশনের শুরুতে বন্ধনীতে মার্কার (যেমন ${language === 'en' ? '[Intro], [Verse 1], [Chorus]' : '[ইন্ট্রো], [কবিতা ১], [সুর], [কোরাস]'})। লিরিক্সে বাদ্যযন্ত্রের নির্দেশনা নয়, গানের কথাই থাকবে।
- "vocalStyle": কণ্ঠের ধরন (${language === 'en' ? 'ইংরেজিতে' : 'বাংলায়'} ছোট বাক্য)।
- "instruments": ৪–৮টি বাদ্যযন্ত্রের তালিকা (${language === 'en' ? 'ইংরেজি' : 'বাংলা'} নাম)।
- "musicModelPrompt": ইংরেজিতে এক প্যারাগ্রাফের প্রম্পট, যেকোনো সংগীত-সংশ্লেষণ মডেলকে সরাসরি দেওয়ার মতো — genre, tempo, key, instruments, mood ও কাঠামো উল্লেখসহ।`;
  const user = [
    `গানের আইডিয়া: ${idea}`,
    opts.genre ? `ধরন (genre): ${opts.genre}` : '',
    opts.mood ? `মুড: ${opts.mood}` : '',
    `ভাষা: ${language === 'en' ? 'ইংরেজি' : 'বাংলা'}`,
    opts.durationSec ? `লক্ষ্য-দৈর্ঘ্য: প্রায় ${opts.durationSec} সেকেন্ড (সেকশন-সময় সেই অনুযায়ী সাজাও)` : '',
    'এখন শুধু JSON দাও।',
  ]
    .filter(Boolean)
    .join('\n');
  const messages: LLMMessage[] = [
    { role: 'assistant', content: sys },
    { role: 'user', content: user },
  ];
  const { data } = await chatJson<MusicPlan>(messages, 1);
  const plan = sanitizeMusicPlan(data, opts, idea);
  return { plan, document: formatMusicPlanDocument(plan, { ...opts, language }) };
}

// ------------------------------------------------------------
// অভিন্ন ছোট হেল্পার
// ------------------------------------------------------------

/** ফাইল-নাম → নিরাপদ ASCII স্লাগ */
export function slugifyFileName(name: string, fallback = 'audio'): string {
  const base = (name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || fallback;
}

/** শিরোনাম → ফাইল-নামের স্লাগ (বাংলা অক্ষর রাখা যায়, বিভাজন চিহ্ন বাদ) */
export function slugifyTitle(title: string): string {
  const base = (title || '')
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\u0980-\u09FFa-zA-Z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return base || 'voiceover';
}

async function artifactLabel(id: string): Promise<string> {
  try {
    const a = await db.artifact.findUnique({ where: { id } });
    return a?.fileName ?? id.slice(0, 12);
  } catch {
    return id.slice(0, 12);
  }
}

// ------------------------------------------------------------
// ১. plan_music
// ------------------------------------------------------------

const planMusicSpec: ToolSpec<{
  idea: string;
  genre?: string;
  mood?: string;
  language?: 'bn' | 'en';
  durationSec?: number;
}> = {
  name: 'plan_music',
  parameters: z.object({
    idea: z.string().min(1).max(800),
    genre: z.string().max(120).optional(),
    mood: z.string().max(120).optional(),
    language: z.enum(['bn', 'en']).optional().default('bn'),
    durationSec: z.number().int().min(15).max(300).optional(),
  }),
  timeoutMs: 120_000,
  usage:
    'plan_music — গানের পূর্ণ কাঠামো-পরিকল্পনা তৈরি করে (শিরোনাম, টেম্পো, স্কেল, সেকশন-সারণি, বাংলা/ইংরেজি লিরিক্স, ইনস্ট্রুমেন্ট তালিকা ও ইংরেজি music-model প্রম্পট)। সংগীত-সংশ্লেষণ মডেল অবরুদ্ধ থাকায় গান বানানোর আগে বা বদলে এটি ব্যবহার করো। arguments: {"idea": string (১–৮০০ অক্ষর), "genre"?: string, "mood"?: string, "language"?: "bn"|"en" (ডিফল্ট bn), "durationSec"?: number (১৫–৩০০)}',
  inputSummary: i => `গানের পরিকল্পনা: ${i.idea.length > 80 ? i.idea.slice(0, 79) + '…' : i.idea}`,
  execute: async (input, ctx) => {
    const { plan, document } = await planMusicContent(input.idea, {
      genre: input.genre,
      mood: input.mood,
      language: input.language,
      durationSec: input.durationSec,
    });
    const buffer = Buffer.from(document, 'utf-8');
    const { storagePath } = await saveArtifactFile(buffer, 'txt');
    const meta = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'text',
      mimeType: 'text/plain',
      fileName: 'song-plan.txt',
      size: buffer.length,
      storagePath,
      metaJson: { planTitle: plan.title, sections: plan.songSections.length, tempoBpm: plan.tempoBpm },
    });
    return {
      summary: `গানের পরিকল্পনা তৈরি: ${plan.title} (${toBn(plan.songSections.length)}টি সেকশন, ${toBn(plan.tempoBpm)} BPM)`,
      resultJson: JSON.stringify(plan),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// speech_synthesis — ভাষা-নিশ্চিত কণ্ঠ (নতুন মাস্টার প্ল্যান §২)
// সম্পূর্ণ পাইপলাইন: ভাষা-শনাক্তকরণ → কণ্ঠ-নির্বাচন → TTS →
// দৈর্ঘ্য/স্তর-যাচাই → ASR ব্যাক-চেক → রায় (pass/warn/fail)
// ------------------------------------------------------------

const speechSynthesisSpec: ToolSpec<{
  script: string;
  language?: 'bn' | 'en';
  voice?: string;
  speed?: number;
  verify?: boolean;
}> = {
  name: 'speech_synthesis',
  parameters: z.object({
    script: z.string().min(1).max(2000),
    language: z.enum(['bn', 'en']).optional(),
    voice: z.string().max(20).optional(),
    speed: z.number().min(0.5).max(2).optional(),
    verify: z.boolean().optional().default(true),
  }),
  timeoutMs: 300_000,
  usage:
    'speech_synthesis — ভাষা-নিশ্চিত কণ্ঠ তৈরি (§২ ভাষা-নিয়ন্ত্রক): স্ক্রিপ্টের ভাষা শনাক্ত করে সেই ভাষার উপযোগী কণ্ঠ বাছে, TTS চালায়, তারপর ASR ব্যাক-চেক ও দৈর্ঘ্য-যাচাই করে রায় দেয় (যাচাইকৃত/সতর্কতা/ব্যর্থ)। বাংলা লেখা বা ইংরেজি লেখা — দুটোই চলে; ভাষা মিললে স্পষ্ট ত্রুটি দেয়। ট্রান্সক্রিপ্ট ও রায়-নোটসহ প্রিভিউ-মেটাডেটা ফেরত আসে। arguments: {"script": string (১–২০০০ অক্ষর), "language"?: "bn"|"en" (না দিলে স্বয়ংক্রিয় শনাক্ত), "voice"?: string (bn: jam/douji, en: jam/tongtong/kazi/xiaochen), "speed"?: number (০.৫–২), "verify"?: boolean (ডিফল্ট true)}',
  inputSummary: i => {
    const det = detectLanguage(i.script);
    const lang = i.language ?? det.language;
    return `ভাষা-নিশ্চিত কণ্ঠ: ${lang === 'bn' ? 'বাংলা' : lang === 'en' ? 'ইংরেজি' : 'অজানা ভাষা'} — ${i.script.length > 60 ? i.script.slice(0, 59) + '…' : i.script}`;
  },
  execute: async (input, ctx) => {
    // ভাষা নির্ধারণ: নির্বাচিত না থাকলে স্ক্রিপ্ট থেকে শনাক্ত
    let language: SpeechLanguage;
    if (input.language === 'bn' || input.language === 'en') {
      language = input.language;
    } else {
      const det = detectLanguage(input.script);
      if (det.language === 'bn' || det.language === 'en') {
        language = det.language;
      } else if (det.language === 'mixed') {
        language = det.bnRatio >= det.latinRatio ? 'bn' : 'en';
      } else {
        throw new Error('স্ক্রিপ্টের ভাষা শনাক্ত করা যায়নি — "language" যুক্তি দিয়ে bn বা en নির্দিষ্ট করো।');
      }
    }
    const result = await synthesizeVerifiedSpeech(
      {
        task: 'speech',
        language,
        script: input.script,
        voiceId: (input.voice as TtsVoice) ?? LANGUAGE_PROFILES[language].voices[0],
        outputFormat: 'wav',
        sampleRate: 24000,
        speed: input.speed,
      },
      { verify: input.verify !== false }
    );
    const { storagePath } = await saveArtifactFile(result.buffer, result.ext);
    const meta = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'audio',
      mimeType: result.mimeType,
      fileName: `speech-${language}-${result.verification.voice}.${result.ext}`,
      size: result.buffer.length,
      storagePath,
      metaJson: {
        verification: result.verification,
        languageLabel: language === 'bn' ? 'বাংলা' : 'ইংরেজি',
        voice: result.verification.voice,
        audioType: 'Speech',
      },
    });
    const v = result.verification;
    const notesBn = v.notes.length > 0 ? ` নোট: ${v.notes.join(' ')}` : '';
    return {
      summary: `${language === 'bn' ? 'বাংলা' : 'ইংরেজি'} কণ্ঠ তৈরি (কণ্ঠ=${result.verification.voice}, দৈর্ঘ্য=${toBn(v.durationSec)} সে., রায়=${verdictLabel(v.verdict)}${v.detectedLanguage && v.detectedLanguage !== 'silence' ? `, ASR-ভাষা=${v.detectedLanguage}` : ''}).${notesBn}`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        language,
        voice: v.voice,
        audioType: 'Speech',
        verdict: v.verdict,
        transcript: v.transcript.slice(0, 600),
        detectedLanguage: v.detectedLanguage,
        similarity: v.similarity,
        durationSec: v.durationSec,
        expectedSec: v.expectedSec,
        notes: v.notes,
      }).slice(0, 3000),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// analyze_audio — বিট-বিশ্লেষণ ও এনার্জি-বিভাগ (নতুন মাস্টার প্ল্যান §৬.১)
// ------------------------------------------------------------

const analyzeAudioSpec: ToolSpec<{ audio: string }> = {
  name: 'analyze_audio',
  parameters: z.object({ audio: z.string().min(1) }),
  timeoutMs: 120_000,
  usage:
    'analyze_audio — আপলোড/তৈরি করা অডিওর বিট-মার্কার, এনার্জি-বিভাগ (quiet/medium/loud) ও আনুমানিক টেম্পো (BPM) বের করে (মিউজিক ভিডিওর শট-টাইমিং পরিকল্পনায় দরকার)। সৎ নোট: এনার্জি-ভিত্তিক সরলীকৃত বিশ্লেষণ — নিখুঁত বিট-ট্র্যাকিং নয়। arguments: {"audio": string (artifact আইডি)}',
  inputSummary: i => `অডিও বিশ্লেষণ: ${i.audio.slice(0, 14)}`,
  execute: async input => {
    const { path } = await artifactFilePath(input.audio);
    const analysis = await analyzeAudioEnergy(path);
    return {
      summary: `অডিও বিশ্লেষণ: ${toBn(analysis.durationSec)} সে., ${toBn(analysis.beatsSec.length)}টি বিট-মার্কার, আনুমানিক ${toBn(analysis.estimatedBpm)} BPM, ${toBn(analysis.sections.length)}টি এনার্জি-বিভাগ — ${analysis.honestLabel}`,
      resultJson: JSON.stringify(analysis).slice(0, 5000),
    };
  },
};

// ------------------------------------------------------------
// ২. generate_instrumental — প্রসিডিউরাল সংগীত-সংশ্লেষণ (§৩)
//    সৎ লেবেল: প্রকৃত অডিও, কিন্তু নিউরাল মিউজিক-মডেল নয়
// ------------------------------------------------------------

const INSTRUMENTAL_MOODS = ['sad', 'romantic', 'joyful', 'suspense', 'action', 'peaceful'] as const;

const generateInstrumentalSpec: ToolSpec<{
  mood: MusicMood;
  durationSec?: number;
  tempoBpm?: number;
  genre?: string;
}> = {
  name: 'generate_instrumental',
  parameters: z.object({
    mood: z.enum(INSTRUMENTAL_MOODS),
    durationSec: z.number().int().min(8).max(120).optional().default(30),
    tempoBpm: z.number().int().min(60).max(170).optional(),
    genre: z.string().max(60).optional(),
  }),
  timeoutMs: 240_000,
  usage:
    'generate_instrumental — মুড-সচেতন প্রসিডিউরাল ইনস্ট্রুমেন্টাল সংগীত তৈরি করে (সৎ লেবেল: পরীক্ষামূলক প্রসিডিউরাল সংশ্লেষণ — MusicGen/YuE-ধর্মী নিউরাল মডেল নয়)। আউটপুটে বিট-মার্কার ও সেকশন-তালিকাও থাকে (মিউজিক ভিডিওর টাইমলাইনে কাজে লাগে)। গান গাওয়া কণ্ঠ এটি তৈরি করে না। arguments: {"mood": "sad"|"romantic"|"joyful"|"suspense"|"action"|"peaceful", "durationSec"?: number (৮–১২০, ডিফল্ট ৩০), "tempoBpm"?: number (৬০–১৭০), "genre"?: string}',
  inputSummary: i =>
    `ইনস্ট্রুমেন্টাল: মুড=${moodLabel(i.mood)}, ${toBn(i.durationSec ?? 30)} সে.${i.tempoBpm ? `, ${toBn(i.tempoBpm)} BPM` : ''}`,
  execute: async (input, ctx) => {
    const result = await synthesizeInstrumental({
      mood: input.mood,
      durationSec: input.durationSec ?? 30,
      tempoBpm: input.tempoBpm,
      genre: input.genre,
    });
    const validation = await validateInstrumental(result.buffer, result.meta);
    const { storagePath } = await saveArtifactFile(result.buffer, 'wav');
    const meta = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'audio',
      mimeType: 'audio/wav',
      fileName: `instrumental-${input.mood}-${result.meta.tempoBpm}bpm.wav`,
      size: result.buffer.length,
      storagePath,
      metaJson: {
        ...result.meta,
        validation: { ok: validation.ok, issues: validation.issues },
        honestLabel: result.meta.honestLabel,
      },
    });
    return {
      summary: `${moodLabel(input.mood)} মুডের ইনস্ট্রুমেন্টাল তৈরি (${toBn(result.meta.durationSec)} সে., ${toBn(result.meta.tempoBpm)} BPM, ${result.meta.keyLabel}) — ${result.meta.honestLabel}${validation.ok ? '' : `; যাচাই-সতর্কতা: ${validation.issues.join(', ')}`}`,
      resultJson: JSON.stringify({
        artifactId: meta.id,
        ...result.meta,
        validation,
      }).slice(0, 4000),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৩–৪. লাইসেন্স-নীতিতে অবরুদ্ধ মডেল-টুল (সৎ structured error) —
// গাওয়া-গান ও স্টেম-পৃথকীকরণ এই পরিবেশে মডেল-নেই
// ------------------------------------------------------------

const GATE_SINGING =
  'গান গাওয়ার (singing) মডেল এখন লাইসেন্স-নীতি যাচাই না হওয়ায় চালু নেই (license unverified)। বিকল্প: plan_music দিয়ে গানের কাঠামো ও লিরিক্স-পরিকল্পনা, অথবা speech_synthesis/text_to_speech দিয়ে আবৃত্তিধর্মী কণ্ঠ (সেটি গাওয়া গান নয় — সৎ লেবেল)।';
const GATE_STEMS =
  'স্টেম-পৃথকীকরণ মডেল (Demucs) এই সার্ভারে স্থাপন করা নেই — এখন অবরুদ্ধ। বিকল্প: mix_audio বা process_audio দিয়ে উপলব্ধ ট্র্যাক মিক্স/প্রসেস করা যায়।';

const generateSingingSpec: ToolSpec<{ lyrics: string; style?: string }> = {
  name: 'generate_singing',
  parameters: z.object({
    lyrics: z.string().min(1).max(3000),
    style: z.string().max(300).optional(),
  }),
  timeoutMs: 5_000,
  usage:
    'generate_singing — গান গাওয়ার কণ্ঠ-মডেল (পরীক্ষামূলক, এখন অবরুদ্ধ — লাইসেন্স যাচাই হয়নি)। কল করলে ব্যাখ্যাসহ ব্যর্থ হবে; বিকল্প plan_music বা text_to_speech। arguments: {"lyrics": string, "style"?: string}',
  inputSummary: i => `কণ্ঠসংগীত (অবরুদ্ধ): ${i.lyrics.length > 60 ? i.lyrics.slice(0, 59) + '…' : i.lyrics}`,
  execute: async () => {
    throw new Error(GATE_SINGING);
  },
};

const separateStemsSpec: ToolSpec<{ audio: string }> = {
  name: 'separate_stems',
  parameters: z.object({ audio: z.string().min(1) }),
  timeoutMs: 5_000,
  usage:
    'separate_stems — কণ্ঠ/বাদ্য স্টেম পৃথকীকরণ (পরীক্ষামূলক, এখন অবরুদ্ধ — Demucs সার্ভারে স্থাপন করা নেই)। কল করলে ব্যাখ্যাসহ ব্যর্থ হবে। arguments: {"audio": string (artifact আইডি)}',
  inputSummary: i => `স্টেম পৃথকীকরণ (অবরুদ্ধ): ${i.audio.slice(0, 12)}`,
  execute: async () => {
    throw new Error(GATE_STEMS);
  },
};

// ------------------------------------------------------------
// ৫. process_audio — FFmpeg-ভিত্তিক সম্পাদনা
// ------------------------------------------------------------

const PROCESS_OPS = ['trim', 'concat', 'fade', 'volume', 'normalize', 'eq', 'compress', 'reverb', 'convert'] as const;
type ProcessAudioOp = (typeof PROCESS_OPS)[number];

const PROCESS_OP_LABELS: Record<ProcessAudioOp, string> = {
  trim: 'ট্রিম',
  concat: 'জোড়া',
  fade: 'ফেড',
  volume: 'ভলিউম',
  normalize: 'নরমালাইজ',
  eq: 'ইকুয়ালাইজ',
  compress: 'কমপ্রেস',
  reverb: 'প্রায়-রিভার্ব',
  convert: 'ফরম্যাট-রূপান্তর',
};

const processAudioSchema = z
  .object({
    audio: z.string().min(1),
    op: z.enum(PROCESS_OPS),
    startSec: z.number().min(0).optional(),
    endSec: z.number().min(0).optional(),
    fadeInSec: z.number().min(0).max(10).optional(),
    fadeOutSec: z.number().min(0).max(10).optional(),
    gainDb: z.number().min(-30).max(12).optional(),
    bassDb: z.number().min(-15).max(15).optional(),
    trebleDb: z.number().min(-15).max(15).optional(),
    format: z.enum(['wav', 'mp3']).optional(),
    sampleRate: z.union([z.literal(44100), z.literal(48000)]).optional(),
    mono: z.boolean().optional(),
    extraAudioId: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.op === 'trim') {
      if (v.startSec == null && v.endSec == null) {
        ctx.addIssue({ code: 'custom', message: 'trim করতে startSec বা endSec অন্তত একটি দাও' });
      }
      if (v.startSec != null && v.endSec != null && v.endSec <= v.startSec) {
        ctx.addIssue({ code: 'custom', message: 'endSec অবশ্যই startSec-এর চেয়ে বড় হবে' });
      }
    }
    if (v.op === 'concat' && !v.extraAudioId) {
      ctx.addIssue({ code: 'custom', message: 'concat করতে দ্বিতীয় অডিওর artifact আইডি (extraAudioId) দাও' });
    }
    if (v.op === 'fade' && v.fadeInSec == null && v.fadeOutSec == null) {
      ctx.addIssue({ code: 'custom', message: 'fade করতে fadeInSec বা fadeOutSec অন্তত একটি দাও' });
    }
    if (v.op === 'volume' && v.gainDb == null) {
      ctx.addIssue({ code: 'custom', message: 'volume করতে gainDb (ডেসিবেল) দাও' });
    }
    if (v.op === 'eq' && v.bassDb == null && v.trebleDb == null) {
      ctx.addIssue({ code: 'custom', message: 'eq করতে bassDb বা trebleDb অন্তত একটি দাও' });
    }
    if (v.op === 'convert' && v.format == null && v.sampleRate == null && !v.mono) {
      ctx.addIssue({ code: 'custom', message: 'convert করতে format, sampleRate বা mono — অন্তত একটি নির্দেশ করো' });
    }
  });

const processAudioSpec: ToolSpec<z.infer<typeof processAudioSchema>> = {
  name: 'process_audio',
  parameters: processAudioSchema,
  timeoutMs: 180_000,
  usage:
    'process_audio — অডিও ফাইল সম্পাদনা করে: ট্রিম, জোড়া (concat), ফেড-ইন/আউট, ভলিউম, লাউডনেস-নরমালাইজ, বেস/ট্রেবল ইকুয়ালাইজ, কমপ্রেস, প্রায়-রিভার্ব, ফরম্যাট-রূপান্তর (wav/mp3)। arguments: {"audio": string (artifact আইডি), "op": "trim"|"concat"|"fade"|"volume"|"normalize"|"eq"|"compress"|"reverb"|"convert", "startSec"?: number, "endSec"?: number, "fadeInSec"?: number (০–১০), "fadeOutSec"?: number (০–১০), "gainDb"?: number (-৩০..১২), "bassDb"?: number (-১৫..১৫), "trebleDb"?: number (-১৫..১৫), "format"?: "wav"|"mp3", "sampleRate"?: 44100|48000, "mono"?: boolean, "extraAudioId"?: string (concat-এর দ্বিতীয় ফাইল)}',
  inputSummary: async i => `${PROCESS_OP_LABELS[i.op]} → ${await artifactLabel(i.audio)}`,
  execute: async (input, ctx) => {
    const src = await artifactFilePath(input.audio);
    const srcInfo = await mediaInfo(src.path);
    if (!srcInfo.hasAudio) {
      throw new Error('নির্দেশিত ফাইলে কোনো অডিও স্ট্রিম নেই — অডিও artifact দাও।');
    }
    let extraPath: string | null = null;
    if (input.op === 'concat' && input.extraAudioId) {
      const extra = await artifactFilePath(input.extraAudioId);
      const extraInfo = await mediaInfo(extra.path);
      if (!extraInfo.hasAudio) {
        throw new Error('দ্বিতীয় ফাইলে (extraAudioId) কোনো অডিও স্ট্রিম নেই।');
      }
      extraPath = extra.path;
    }

    // আউটপুট ফরম্যাট: নির্দেশ না থাকলে উৎসের ধরন অনুসরণ করে
    const fmt = input.format ?? (/mpeg/i.test(src.mimeType) ? 'mp3' : 'wav');
    const tmp = await makeTempDir('studio-audio-');
    try {
      const outPath = path.join(tmp, `processed.${fmt}`);
      const args: string[] = [];
      if (input.op === 'trim') {
        if (input.startSec != null) args.push('-ss', String(input.startSec));
        if (input.endSec != null) {
          args.push('-t', String(Math.max(0.01, input.endSec - (input.startSec ?? 0))));
        }
      }
      args.push('-i', src.path);
      if (extraPath) args.push('-i', extraPath);

      const filters: string[] = [];
      switch (input.op) {
        case 'fade':
          if (input.fadeInSec && input.fadeInSec > 0) {
            filters.push(`afade=t=in:st=0:d=${input.fadeInSec}`);
          }
          if (input.fadeOutSec && input.fadeOutSec > 0) {
            const st = Math.max(0, srcInfo.durationSec - input.fadeOutSec);
            filters.push(`afade=t=out:st=${st.toFixed(2)}:d=${input.fadeOutSec}`);
          }
          break;
        case 'volume':
          filters.push(`volume=${input.gainDb}dB`);
          break;
        case 'normalize':
          // loudnorm একবারে (single pass); ভেতরে 192kHz করে ফেলে বলে aresample
          filters.push('loudnorm=I=-16:TP=-1.5:LRA=11', `aresample=${input.sampleRate ?? 44100}`);
          break;
        case 'eq': {
          if (input.bassDb != null) filters.push(`bass=g=${input.bassDb}`);
          if (input.trebleDb != null) filters.push(`treble=g=${input.trebleDb}`);
          break;
        }
        case 'compress':
          filters.push('acompressor=threshold=-18dB:ratio=3:attack=15:release=200');
          break;
        case 'reverb':
          // সৎ লেবেল: সত্যিকারের কনভোলিউশন-রিভার্ব নয়, aecho-ভিত্তিক প্রায়-রিভার্ব
          filters.push('aecho=0.8:0.85:60|110:0.3|0.2');
          break;
      }

      if (extraPath) {
        // concat: দুই ইনপুটকে একই ফরম্যাটে এনে concat ফিল্টার
        const af = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
        args.push(
          '-filter_complex',
          `[0:a]${af}[a0];[1:a]${af}[a1];[a0][a1]concat=n=2:v=0:a=1[aout]`,
          '-map',
          '[aout]'
        );
      } else {
        args.push('-map', '0:a:0');
        if (filters.length > 0) args.push('-af', filters.join(','));
      }
      if (input.sampleRate) args.push('-ar', String(input.sampleRate));
      if (input.mono) args.push('-ac', '1');
      if (fmt === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '192k');
      else args.push('-c:a', 'pcm_s16le');
      args.push(outPath);

      await runFfmpeg(args, { label: `অডিও ${PROCESS_OP_LABELS[input.op]}`, timeoutMs: 150_000 });
      const outInfo = await mediaInfo(outPath);
      const buffer = await readFile(outPath);
      const { storagePath } = await saveArtifactFile(buffer, fmt);
      const meta = await createToolArtifact({
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        kind: 'audio',
        mimeType: fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        fileName: `${slugifyFileName(src.fileName)}-${input.op}.${fmt}`,
        size: buffer.length,
        storagePath,
        metaJson: {
          op: input.op,
          sourceArtifactId: input.audio,
          durationSec: outInfo.durationSec,
          sampleRate: outInfo.sampleRate ?? null,
        },
      });
      return {
        summary: `${PROCESS_OP_LABELS[input.op]} সম্পন্ন — দৈর্ঘ্য ${toBn(outInfo.durationSec.toFixed(1))} সেকেন্ড (${fmt.toUpperCase()})`,
        resultJson: JSON.stringify({
          artifactId: meta.id,
          durationSec: outInfo.durationSec,
          format: fmt,
          fileName: meta.fileName,
          size: meta.size,
        }),
        artifacts: [meta],
      };
    } finally {
      await cleanupWorkingDir(tmp);
    }
  },
};

// ------------------------------------------------------------
// ৬. mix_audio — বহু-ট্র্যাক মিক্স + সাইডচেইন-ডাকিং
// ------------------------------------------------------------

const mixAudioSchema = z.object({
  tracks: z
    .array(
      z.object({
        audio: z.string().min(1),
        gainDb: z.number().min(-30).max(6).optional(),
        startSec: z.number().min(0).optional(),
      })
    )
    .min(2)
    .max(4),
  duckMusicUnderVoice: z.boolean().optional(),
  crossfadeSec: z.number().min(0).max(3).optional(),
});

const mixAudioSpec: ToolSpec<z.infer<typeof mixAudioSchema>> = {
  name: 'mix_audio',
  parameters: mixAudioSchema,
  timeoutMs: 180_000,
  usage:
    'mix_audio — ২–৪টি অডিও ট্র্যাক একসাথে মিক্স করে (প্রতি ট্র্যাকে আলাদা ভলিউম ও শুরু-সময়, কণ্ঠের নিচে সংগীত-ডাকিং, ক্রসফেড-সদৃশ মসৃণ ফেড)। প্রথম ট্র্যাককে সংগীত/ব্যাকগ্রাউন্ড ও শেষ ট্র্যাককে কণ্ঠ ধরে ডাকিং হয়। arguments: {"tracks": [{"audio": string (artifact আইডি), "gainDb"?: number (-৩০..৬), "startSec"?: number}], "duckMusicUnderVoice"?: boolean, "crossfadeSec"?: number (০–৩)}',
  inputSummary: i =>
    `${toBn(i.tracks.length)} টি ট্র্যাক মিক্স${i.duckMusicUnderVoice ? ' (কণ্ঠ-ডাকিংসহ)' : ''}`,
  execute: async (input, ctx) => {
    const N = input.tracks.length;
    const duck = !!input.duckMusicUnderVoice && N >= 2;
    const cf = Math.min(Math.max(input.crossfadeSec ?? 0, 0), 3);
    const files = await Promise.all(input.tracks.map(t => artifactFilePath(t.audio)));
    const infos = await Promise.all(files.map(f => mediaInfo(f.path)));
    for (const [i, info] of infos.entries()) {
      if (!info.hasAudio) {
        throw new Error(`${toBn(i + 1)} নম্বর ট্র্যাকে কোনো অডিও স্ট্রিম নেই।`);
      }
    }

    const tmp = await makeTempDir('studio-mix-');
    try {
      const outPath = path.join(tmp, 'mix.wav');
      const args: string[] = [];
      for (const f of files) args.push('-i', f.path);

      const AF = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
      /** i-নং ইনপুট → aformat (+ক্রসফেড-ফেড) (+ভলিউম) (+বিলম্ব) → label */
      const chainOf = (i: number, label: string): string => {
        const parts = [`[${i}:a]${AF}`];
        if (cf > 0) {
          parts.push(`afade=t=in:st=0:d=${cf}`);
          const st = Math.max(0, infos[i].durationSec - cf);
          parts.push(`afade=t=out:st=${st.toFixed(2)}:d=${cf}`);
        }
        const gain = input.tracks[i].gainDb;
        if (gain != null && gain !== 0) parts.push(`volume=${gain}dB`);
        const startMs = Math.round((input.tracks[i].startSec ?? 0) * 1000);
        if (startMs > 0) parts.push(`adelay=${startMs}:all=1`);
        return `${parts.join(',')}[${label}]`;
      };

      const parts: string[] = [];
      const labels: string[] = [];
      if (duck) {
        // সংগীত = ট্র্যাক ০, কণ্ঠ = শেষ ট্র্যাক — asplit দিয়ে কণ্ঠ একদিকে মিক্সে,
        // অন্যদিকে (একই বিলম্বে) সাইডচেইনে যায়, ফলে ডাকিং সময়ে মিলে যায়
        const vIdx = N - 1;
        const vGain = input.tracks[vIdx].gainDb;
        const vStartMs = Math.round((input.tracks[vIdx].startSec ?? 0) * 1000);
        const vTail: string[] = [];
        if (vGain != null && vGain !== 0) vTail.push(`volume=${vGain}dB`);
        if (vStartMs > 0) vTail.push(`adelay=${vStartMs}:all=1`);
        const vHead: string[] = [];
        if (cf > 0) {
          vHead.push(`afade=t=in:st=0:d=${cf}`);
          const st = Math.max(0, infos[vIdx].durationSec - cf);
          vHead.push(`afade=t=out:st=${st.toFixed(2)}:d=${cf}`);
        }
        const vChain = [...vHead, ...vTail].join(',');
        parts.push(`[${vIdx}:a]${AF}[v0]`);
        parts.push('[v0]asplit=2[vmix][vside]');
        if (vChain) parts.push(`[vmix]${vChain}[av]`);
        if (vStartMs > 0) parts.push(`[vside]adelay=${vStartMs}:all=1[vs]`);
        parts.push(chainOf(0, 'm0'));
        const sideIn = vStartMs > 0 ? 'vs' : 'vside';
        parts.push(`[m0][${sideIn}]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400[a0]`);
        labels.push('[a0]');
        labels.push(vChain ? '[av]' : '[vmix]');
        for (let i = 1; i < N - 1; i++) {
          parts.push(chainOf(i, `a${i}`));
          labels.push(`[a${i}]`);
        }
      } else {
        for (let i = 0; i < N; i++) {
          parts.push(chainOf(i, `a${i}`));
          labels.push(`[a${i}]`);
        }
      }
      // amix (স্বাভাবিক ভলিউম ধরে রাখতে normalize=0) + ক্লিপিং-রোধী লিমিটার
      parts.push(`${labels.join('')}amix=inputs=${N}:normalize=0,alimiter=limit=0.971:level=false[out]`);
      args.push('-filter_complex', parts.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', outPath);

      await runFfmpeg(args, { label: 'অডিও মিক্সিং', timeoutMs: 150_000 });
      const outInfo = await mediaInfo(outPath);
      const buffer = await readFile(outPath);
      const { storagePath } = await saveArtifactFile(buffer, 'wav');
      const meta = await createToolArtifact({
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        kind: 'audio',
        mimeType: 'audio/wav',
        fileName: `mix-${N}-track.wav`,
        size: buffer.length,
        storagePath,
        metaJson: {
          trackCount: N,
          duckMusicUnderVoice: duck,
          crossfadeSec: cf,
          durationSec: outInfo.durationSec,
          sourceArtifactIds: input.tracks.map(t => t.audio),
        },
      });
      return {
        summary: `${toBn(N)} টি ট্র্যাক মিক্স সম্পন্ন — ${toBn(outInfo.durationSec.toFixed(1))} সেকেন্ড${duck ? ' (কণ্ঠের নিচে সংগীত-ডাকিংসহ)' : ''}`,
        resultJson: JSON.stringify({
          artifactId: meta.id,
          trackCount: N,
          durationSec: outInfo.durationSec,
          fileName: meta.fileName,
          size: meta.size,
          duckMusicUnderVoice: duck,
          crossfadeSec: cf,
        }),
        artifacts: [meta],
      };
    } finally {
      await cleanupWorkingDir(tmp);
    }
  },
};

// ------------------------------------------------------------
// ৭. validate_audio — astats + silencedetect + ebur128 রিপোর্ট
// ------------------------------------------------------------

const validateAudioSpec: ToolSpec<{ audio: string }> = {
  name: 'validate_audio',
  parameters: z.object({ audio: z.string().min(1) }),
  timeoutMs: 180_000,
  usage:
    'validate_audio — অডিওর গুণমান পরীক্ষা করে বাংলা রিপোর্ট দেয়: দৈর্ঘ্য, স্যাম্পল-রেট, চ্যানেল, পিক/RMS, লাউডনেস (LUFS), ক্লিপিং-ঝুঁকি ও নীরব-অংশ (১.২ সেকেন্ডের বেশি)। মিক্স/নরমালাইজের পর যাচাইয়ে ব্যবহার করো। arguments: {"audio": string (artifact আইডি)}',
  inputSummary: async i => `গুণমান পরীক্ষা: ${await artifactLabel(i.audio)}`,
  execute: async input => {
    const src = await artifactFilePath(input.audio);
    const q = await audioQuality(src.path);
    const loudnessLufs = (await measureLoudnessPrecise(src.path)) ?? q.loudnessLufs ?? null;
    const clipping = Number.isFinite(q.peakDb) && (q.peakDb as number) > -0.1;

    const lines: string[] = [];
    lines.push(`দৈর্ঘ্য: ${toBn(q.durationSec.toFixed(1))} সেকেন্ড`);
    lines.push(`স্যাম্পল-রেট: ${q.sampleRate ? `${toBn(q.sampleRate)} Hz` : 'অজানা'}`);
    lines.push(`চ্যানেল: ${q.channels === 1 ? 'মোনো' : q.channels === 2 ? 'স্টেরিও' : toBn(q.channels ?? 0)}`);
    lines.push(`পিক স্তর: ${fmtDb(q.peakDb)}`);
    lines.push(`RMS স্তর: ${fmtDb(q.rmsDb)}`);
    if (loudnessLufs != null) lines.push(`লাউডনেস: ${toBn(loudnessLufs.toFixed(1))} LUFS`);
    if (clipping) lines.push(`সতর্কতা: ক্লিপিং-ঝুঁকি — পিক ${fmtDb(q.peakDb)} (−০.১ ডিবির ওপরে)`);
    if (q.silenceRanges.length > 0) {
      const ranges = q.silenceRanges.map(r => `${toBn(r.start.toFixed(1))}–${toBn(r.end.toFixed(1))} সে.`).join(', ');
      lines.push(`নীরব-অংশ (১.২ সেকেন্ডের বেশি): ${ranges}`);
    }

    let verdict: string;
    if (!(q.durationSec > 0)) verdict = 'ফাইলটি খালি বা ত্রুটিপূর্ণ — দৈর্ঘ্য শূন্য';
    else if (clipping) verdict = `ক্লিপিং-ঝুঁকি (পিক ${fmtDb(q.peakDb)})`;
    else if (q.silenceRanges.length > 0)
      verdict = `শোনার যোগ্য, তবে ${toBn(q.silenceRanges.length)}টি নীরব-অংশ আছে`;
    else verdict = 'শোনার যোগ্য — কোনো সমস্যা পাওয়া যায়নি';

    const report = {
      durationSec: q.durationSec,
      sampleRate: q.sampleRate ?? null,
      channels: q.channels ?? null,
      peakDb: Number.isFinite(q.peakDb) ? q.peakDb : null,
      rmsDb: Number.isFinite(q.rmsDb) ? q.rmsDb : null,
      loudnessLufs,
      clippingRisk: clipping,
      silenceCount: q.silenceRanges.length,
      silenceRanges: q.silenceRanges.map(r => ({ start: r.start, end: r.end })),
      verdict,
      report: lines.join('\n'),
    };
    return {
      summary: `${verdict} (দৈর্ঘ্য ${toBn(q.durationSec.toFixed(1))} সে.)`,
      resultJson: JSON.stringify(report),
    };
  },
};

// ------------------------------------------------------------
// ৮. inspect_media — অডিও/ভিডিও মেটাডেটা
// ------------------------------------------------------------

const inspectMediaSpec: ToolSpec<{ file: string }> = {
  name: 'inspect_media',
  parameters: z.object({ file: z.string().min(1) }),
  timeoutMs: 60_000,
  usage:
    'inspect_media — অডিও বা ভিডিও ফাইলের মেটাডেটা দেখায়: দৈর্ঘ্য, কোডেক, রেজোলিউশন, FPS, স্যাম্পল-রেট, চ্যানেল, ফাইল-আকার। আপলোড করা ভিডিও/অডিও বুঝতে বা প্রসেসিংয়ের আগে এটি দিয়ে পরীক্ষা করো। arguments: {"file": string (artifact আইডি)}',
  inputSummary: async i => `পরিদর্শন: ${await artifactLabel(i.file)}`,
  execute: async input => {
    const src = await artifactFilePath(input.file);
    const info = await mediaInfo(src.path);
    if (!info.hasAudio && !info.hasVideo) {
      throw new Error('ফাইলে কোনো অডিও বা ভিডিও স্ট্রিম পাওয়া যায়নি।');
    }
    let summary: string;
    if (info.hasVideo) {
      const dims = info.width && info.height ? `${toBn(info.width)}×${toBn(info.height)}` : 'অজানা মাপ';
      summary = `ভিডিও: ${dims}${info.fps ? ` @ ${toBn(info.fps)} fps` : ''}, দৈর্ঘ্য ${toBn(info.durationSec.toFixed(1))} সে., ${
        info.videoCodec ?? '?'
      }${info.audioCodec ? ` + ${info.audioCodec}` : ' (নীরব)'}`;
    } else {
      summary = `অডিও: দৈর্ঘ্য ${toBn(info.durationSec.toFixed(1))} সে., ${info.audioCodec ?? '?'}${
        info.sampleRate ? `, ${toBn(info.sampleRate)} Hz` : ''
      }${info.channels === 1 ? ', মোনো' : info.channels === 2 ? ', স্টেরিও' : ''}`;
    }
    return {
      summary,
      resultJson: JSON.stringify({
        durationSec: info.durationSec,
        hasVideo: info.hasVideo,
        hasAudio: info.hasAudio,
        width: info.width ?? null,
        height: info.height ?? null,
        fps: info.fps ?? null,
        videoCodec: info.videoCodec ?? null,
        audioCodec: info.audioCodec ?? null,
        sampleRate: info.sampleRate ?? null,
        channels: info.channels ?? null,
        sizeBytes: info.sizeBytes,
      }),
    };
  },
};

// ------------------------------------------------------------
// কেন্দ্রীয় তালিকা — registry.ts এখান থেকে সংগ্রহ করে
// ------------------------------------------------------------

export const AUDIO_TOOLS: ToolSpec[] = [
  planMusicSpec,
  generateInstrumentalSpec,
  generateSingingSpec,
  separateStemsSpec,
  speechSynthesisSpec,
  analyzeAudioSpec,
  processAudioSpec,
  mixAudioSpec,
  validateAudioSpec,
  inspectMediaSpec,
];
