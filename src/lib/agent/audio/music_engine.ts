// ============================================================
// Music Generation Engine v2 — মাস্টার-প্ল্যান §৩ + Deep-Report আপগ্রেড
//
// সততার ঘোষণা (অপরিবর্তিত):
//  - এই ইঞ্জিন *প্রসিডিউরাল সংশ্লেষণ* করে — সুর-তত্ত্বভিত্তিক
//    (স্কেল, কর্ড-প্রগ্রেশন, ছন্দ) গাণিতিক অডিও-সংশ্লেষণ। এটি
//    MusicGen/YuE-ধর্মী নিউরাল মিউজিক-মডেল নয় → সব আউটপুটে
//    "পরীক্ষামূলক" লেবেল।
//  - গান গাওয়া (singing) ও স্টেম-পৃথকীকরণ এই পরিবেশে নেই — গেটেড।
//  - TTS-এর কণ্ঠে গানের কথা পড়ে দেওয়াকে "সম্পূর্ণ গাওয়া গান"
//    হিসেবে দেখানো হয় না।
//
// v2 আপগ্রেড (Deep-Report-এর "সংগীত অবাস্তব" পর্যালোচনার জবাব —
// সবকিছু CPU-তেই, GPU ছাড়া):
//  1. কারপ্লাস-স্ট্রং স্ট্রিং-সংশ্লেষণ — আর্পেজিও আর সাইন-বিপ নয়,
//     নয়েজ-এক্সাইটেড ড্যাম্পড ডিলে-লাইন = প্রকৃত ছড়ানো তার।
//  2. মোটিফ-ভিত্তিক মেলোডি — এলোমেলো বিচরণের বদলে ২-বারের মোটিফ
//     তৈরি হয়, পুনরাবৃত্তি/ভ্যারিয়েশন/কর্ড-স্ন্যাপিং-এ "পরিচিত সুর"।
//  3. মানবিকরণ — মাইক্রো-টাইমিং (±৮ms), ভেলোসিটি-তারতম্য,
//     বিলম্বিত ভাইব্রেটো (৫.১–৫.৭Hz, ~৭ সেন্ট), সূক্ষ্ম পিচ-গ্লাইড।
//  4. ফ্রিভার্ব-ধাঁচের রিভার্ব — ৮ কম্ব + ৪ অলপাস, স্টেরিও-ডেকোরিলেটেড,
//     ২০ms প্রি-ডিলে — "ঘরের মতো স্থান-অনুভূতি"।
//  5. উন্নত ড্রাম-ভয়েস — পিচ-সুইপ+ক্লিক কিক, দ্বৈত-টোন বডি স্নেয়ার,
//     হাই-পাসড হাই-হ্যাট (ক্লোজড/ওপেন), কোরাসে ক্র্যাশ-সোয়েল।
//  6. গান-কাঠামো — intro → verse ↔ chorus → outro (রিং-আউট ফাইনাল
//     কর্ড), কোরাসে অষ্টক-ডাবলিং ও ঘন ব্যবস্থাপনা।
// ============================================================

import { audioQuality } from '@/lib/media/ffmpeg';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import path from 'path';
import os from 'os';
import { makeRng, softClip, encodeWav, midiHz as midiHzShared } from './pcm';

const execFileAsync = promisify(execFileCb);
const midiHz = midiHzShared;

export const MUSIC_ENGINE_LABEL =
  'প্রসিডিউরাল সংগীত-সংশ্লেষণ v2 [PROCEDURAL_INSTRUMENTAL] — কারপ্লাস-স্ট্রং তার, মোটিফ-মেলোডি, ভাইব্রেটো-মানবিকরণ, রিভার্ব (পরীক্ষামূলক — নিউরাল মিউজিক-মডেল নয়, গাওয়া কণ্ঠ নয়)';
// LF-2 (§2.1): ক্যানোনিক্যাল ইংরেজি টোকেন PROCEDURAL_INSTRUMENTAL — মেশিন-
// পাঠযোগ্য ক্ষমতা-লেবেল; মাস্টার-প্রম্পট §2.1-এর নির্দেশ (instrumental-কে
// কখনো গান বলে দাবি নয়)।

export type MusicMood = 'sad' | 'romantic' | 'joyful' | 'suspense' | 'action' | 'peaceful';

export interface MusicJobSpec {
  mood: MusicMood;
  tempoBpm?: number; // সীমা: 60–170
  durationSec: number; // সীমা: 8–120
  genre?: string; // নাম-মাত্র প্রভাব (লেবেল হিসেবে থাকে)
  seed?: number;
}

export interface MusicSection {
  name: string; // intro | verse | chorus | outro
  startSec: number;
  endSec: number;
}

export interface InstrumentalResult {
  buffer: Buffer; // WAV (44.1kHz stereo 16-bit)
  meta: {
    mood: MusicMood;
    tempoBpm: number;
    keyLabel: string;
    durationSec: number;
    beatsSec: number[]; // বিট-মার্কার (মিউজিক ভিডিওর টাইমলাইনের জন্য)
    sections: MusicSection[];
    peakDb: number;
    honestLabel: string;
  };
}

// ------------------------------------------------------------
// সুর-তত্ত্ব — মুড-কনফিগ (v2: বাজানোর-ধরন নিয়ন্ত্রণসহ)
// ------------------------------------------------------------

interface MoodConfig {
  rootMidi: number; // MIDI (60 = C4)
  scaleName: string;
  keyLabel: string;
  minor: boolean;
  bpmRange: [number, number, number]; // min, max, default
  percussion: boolean;
  padGain: number;
  bassGain: number;
  melodyGain: number;
  arpGain: number;
  percGain: number;
  /** কর্ড-প্রগ্রেশন — প্রতিটি কর্ড = রুট থেকে সেমিটোন অফসেট */
  progression: { root: number; tones: number[]; name: string }[];
  // ---- v2 বাজানোর-ধরন ----
  /** আর্পেজিও ধাপ (বিটে) — 0.5 = অষ্টম, 0.25 = ষোড়শ, 1 = চতুর্থাংশ */
  arpDivVerse: number;
  arpDivChorus: number;
  /** বেজ-আঘাতের অবস্থান (বিটে, 0–4) */
  bassVerse: number[];
  bassChorus: number[];
  /** কিক-আঘাতের অবস্থান */
  kickVerse: number[];
  kickChorus: number[];
  /** রিভার্ব wet-মাত্রা (0–1) */
  reverbWet: number;
  /** উজ্জ্বল লিড-টোন (joyful/action) বনাম নরম স্ট্রিং-লিড */
  leadBright: boolean;
}

const MOOD_CONFIGS: Record<MusicMood, MoodConfig> = {
  sad: {
    rootMidi: 57, // A3
    scaleName: 'A মাইনর',
    keyLabel: 'A মাইনর',
    minor: true,
    bpmRange: [62, 84, 72],
    percussion: false,
    padGain: 0.95,
    bassGain: 0.8,
    melodyGain: 0.72,
    arpGain: 0.4,
    percGain: 0,
    arpDivVerse: 0.5,
    arpDivChorus: 0.5,
    bassVerse: [0, 2],
    bassChorus: [0, 2],
    kickVerse: [],
    kickChorus: [],
    reverbWet: 0.42,
    leadBright: false,
    progression: [
      { root: 0, tones: [0, 3, 7], name: 'Am' },
      { root: 8, tones: [8, 12, 15], name: 'F' },
      { root: 3, tones: [3, 7, 10], name: 'C' },
      { root: 10, tones: [10, 14, 17], name: 'G' },
    ],
  },
  romantic: {
    rootMidi: 60, // C4
    scaleName: 'C মেজর',
    keyLabel: 'C মেজর',
    minor: false,
    bpmRange: [70, 96, 84],
    percussion: false,
    padGain: 1.0,
    bassGain: 0.75,
    melodyGain: 0.75,
    arpGain: 0.55,
    percGain: 0,
    arpDivVerse: 0.5,
    arpDivChorus: 0.25, // কোরাসে হার্প-সদৃশ দ্রুত ধারা
    bassVerse: [0, 2],
    bassChorus: [0, 1.5, 2, 3.5],
    kickVerse: [],
    kickChorus: [],
    reverbWet: 0.38,
    leadBright: false,
    progression: [
      { root: 0, tones: [0, 4, 7], name: 'C' },
      { root: 7, tones: [7, 11, 14], name: 'G' },
      { root: 9, tones: [9, 12, 16], name: 'Am' },
      { root: 5, tones: [5, 9, 12], name: 'F' },
    ],
  },
  joyful: {
    rootMidi: 55, // G3
    scaleName: 'G মেজর',
    keyLabel: 'G মেজর',
    minor: false,
    bpmRange: [104, 140, 120],
    percussion: true,
    padGain: 0.7,
    bassGain: 0.9,
    melodyGain: 0.9,
    arpGain: 0.6,
    percGain: 0.75,
    arpDivVerse: 0.5,
    arpDivChorus: 0.25,
    bassVerse: [0, 1.5, 2, 3.5],
    bassChorus: [0, 1, 1.5, 2, 3, 3.5],
    kickVerse: [0, 2],
    kickChorus: [0, 2, 2.5],
    reverbWet: 0.24,
    leadBright: true,
    progression: [
      { root: 0, tones: [0, 4, 7], name: 'G' },
      { root: 5, tones: [5, 9, 12], name: 'C' },
      { root: 7, tones: [7, 11, 14], name: 'D' },
      { root: 0, tones: [0, 4, 7], name: 'G' },
    ],
  },
  suspense: {
    rootMidi: 50, // D3
    scaleName: 'D মাইনর',
    keyLabel: 'D মাইনর (ট্রাইটোন-সংমিশ্রণ)',
    minor: true,
    bpmRange: [80, 108, 92],
    percussion: true,
    padGain: 1.0,
    bassGain: 1.0,
    melodyGain: 0.45,
    arpGain: 0.32,
    percGain: 0.5,
    arpDivVerse: 0.5,
    arpDivChorus: 0.25,
    bassVerse: [0],
    bassChorus: [0, 2],
    kickVerse: [0],
    kickChorus: [0, 2],
    reverbWet: 0.32,
    leadBright: false,
    progression: [
      { root: 0, tones: [0, 3, 7], name: 'Dm' },
      { root: 8, tones: [8, 12, 15], name: 'Bb' },
      { root: 5, tones: [5, 8, 12], name: 'Gm' },
      { root: 7, tones: [7, 11, 14], name: 'A' },
    ],
  },
  action: {
    rootMidi: 52, // E3
    scaleName: 'E মাইনর',
    keyLabel: 'E মাইনর',
    minor: true,
    bpmRange: [128, 170, 144],
    percussion: true,
    padGain: 0.5,
    bassGain: 1.0,
    melodyGain: 0.8,
    arpGain: 0.45,
    percGain: 0.9,
    arpDivVerse: 0.25,
    arpDivChorus: 0.25,
    bassVerse: [0, 2],
    bassChorus: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
    kickVerse: [0, 2],
    kickChorus: [0, 1, 2, 3],
    reverbWet: 0.2,
    leadBright: true,
    progression: [
      { root: 0, tones: [0, 3, 7], name: 'Em' },
      { root: 8, tones: [8, 12, 15], name: 'C' },
      { root: 10, tones: [10, 14, 17], name: 'D' },
      { root: 0, tones: [0, 3, 7], name: 'Em' },
    ],
  },
  peaceful: {
    rootMidi: 53, // F3
    scaleName: 'F মেজর',
    keyLabel: 'F মেজর',
    minor: false,
    bpmRange: [60, 80, 68],
    percussion: false,
    padGain: 1.0,
    bassGain: 0.65,
    melodyGain: 0.6,
    arpGain: 0.5,
    percGain: 0,
    arpDivVerse: 1, // বিরল চতুর্থাংশ-ছড়া
    arpDivChorus: 0.5,
    bassVerse: [0, 2],
    bassChorus: [0, 2],
    kickVerse: [],
    kickChorus: [],
    reverbWet: 0.5,
    leadBright: false,
    progression: [
      { root: 0, tones: [0, 4, 7], name: 'F' },
      { root: 5, tones: [5, 9, 12], name: 'C' },
      { root: 7, tones: [7, 10, 14], name: 'Dm' },
      { root: 10, tones: [10, 14, 17], name: 'Bb' },
    ],
  },
};

// পেন্টাটনিক মেলোডি-স্কেল (মাইনর/মেজর)
const PENTA_MINOR = [0, 3, 5, 7, 10];
const PENTA_MAJOR = [0, 2, 4, 7, 9];

// ------------------------------------------------------------
// ইনস্ট্রুমেন্ট-ভয়েস (হারমোনিক-রেসিপি)
// ------------------------------------------------------------

const PAD_HARMONICS = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.35 },
  { ratio: 3, gain: 0.12 },
  { ratio: 4, gain: 0.05 },
];
const BASS_HARMONICS = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.45 },
  { ratio: 3, gain: 0.16 },
];
const LEAD_STRINGS = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.3 },
  { ratio: 3, gain: 0.15 },
  { ratio: 4, gain: 0.07 },
  { ratio: 5, gain: 0.035 },
];
const LEAD_BRIGHT = [
  { ratio: 1, gain: 1 },
  { ratio: 2, gain: 0.42 },
  { ratio: 3, gain: 0.22 },
  { ratio: 4, gain: 0.11 },
  { ratio: 5, gain: 0.055 },
];

// ------------------------------------------------------------
// v2 অসিলেটর — ফেজ-অ্যাকিউমুলেটর + ভাইব্রেটো + গ্লাইড + কোরাস
// (ভাইব্রেটো প্রকৃত বাদ্যযন্ত্রের মতো সব হারমোনিকে সমানভাবে টানে)
// ------------------------------------------------------------

interface ToneOptsV2 {
  startSec: number;
  durSec: number;
  gain: number;
  attackSec?: number;
  releaseSec?: number;
  harmonics?: { ratio: number; gain: number }[];
  pan?: number;
  /** স্বাভাবিক ক্ষয় (প্রতি সেকেন্ডে e^-x) */
  decayPerSec?: number;
  /** বিলম্বিত ভাইব্রেটো — লম্বা নোটে মানবিক কণ্ঠ/বেহালা-ভাব */
  vibrato?: { rateHz: number; depthCents: number; delaySec: number };
  /** নোট-শুরুতে সূক্ষ্ম পিচ-গ্লাইড (আঙুল-চাপার মতো) */
  glideCents?: number;
  glideSec?: number;
  /** ধীর কোরাস — দ্বিতীয় ডিটিউনড অসিলেটর, LFO-দোলায়িত */
  chorus?: { rateHz: number; depthCents: number; baseCents: number };
}

function panGains(gain: number, pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  return [
    gain * Math.sqrt(1 - Math.max(0, p)),
    gain * Math.sqrt(1 - Math.max(0, -p)),
  ];
}

function renderToneV2(
  L: Float32Array,
  R: Float32Array,
  freqHz: number,
  o: ToneOptsV2,
  sr: number
): void {
  const start = Math.floor(o.startSec * sr);
  if (start >= L.length) return;
  const len = Math.max(16, Math.floor(o.durSec * sr));
  const atk = Math.max(1, Math.floor((o.attackSec ?? 0.01) * sr));
  const rel = Math.max(1, Math.floor((o.releaseSec ?? 0.08) * sr));
  const harmonics = o.harmonics ?? PAD_HARMONICS;
  const [gl, gr] = panGains(o.gain, o.pan ?? 0);
  const vib = o.vibrato;
  const glide =
    o.glideCents != null && o.glideSec != null ? { cents: o.glideCents, sec: o.glideSec } : null;
  const chorus = o.chorus;
  const decay = o.decayPerSec ?? 0;
  const nHarm = harmonics.length;
  const baseInc = (2 * Math.PI * freqHz) / sr;
  let phaseA = 0;
  let phaseB = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0) continue;
    if (idx >= L.length) break;
    const t = i / sr;
    // পিচ-মডিউলেশন: গ্লাইড → বিলম্বিত ভাইব্রেটো
    let pm = 1;
    if (glide && t < glide.sec) pm *= Math.pow(2, (glide.cents * (t / glide.sec)) / 1200);
    if (vib && t > vib.delaySec) {
      const vramp = Math.min(1, (t - vib.delaySec) / 0.22);
      pm *=
        1 +
        (vib.depthCents / 1200) *
          Math.sin(2 * Math.PI * vib.rateHz * (t - vib.delaySec)) *
          vramp;
    }
    phaseA += baseInc * pm;
    let s = 0;
    for (let h = 0; h < nHarm; h++) s += harmonics[h].gain * Math.sin(phaseA * harmonics[h].ratio);
    if (chorus) {
      const detuneCents =
        chorus.baseCents + chorus.depthCents * Math.sin(2 * Math.PI * chorus.rateHz * t);
      phaseB += baseInc * pm * Math.pow(2, detuneCents / 1200);
      for (let h = 0; h < nHarm; h++) {
        s += 0.5 * harmonics[h].gain * Math.sin(phaseB * harmonics[h].ratio);
      }
      s *= 0.72; // দুই অসিলেটরের মিলিত শক্তি সামঞ্জস্য
    }
    let env = 1;
    if (i < atk) env = i / atk;
    if (i > len - rel) env *= (len - i) / rel;
    if (decay > 0) env *= Math.exp(-t * decay);
    const v = env * s;
    L[idx] += gl * v;
    R[idx] += gr * v;
  }
}

// ------------------------------------------------------------
// কারপ্লাস-স্ট্রং স্ট্রিং — নয়েজ-এক্সাইটেড ড্যাম্পড ডিলে-লাইন।
// বাস্তব ছড়ানো তারের শারীরিক মডেল: প্রতিটি স্বরে ভিন্ন রিং-দৈর্ঘ্য,
// নিম্ন স্বর দীর্ঘ বাজে, উজ্জ্বলতা এক্সাইটেশন-ফিল্টারে নিয়ন্ত্রিত।
// ------------------------------------------------------------

interface PluckOpts {
  startSec: number;
  durSec: number;
  gain: number;
  attackSec?: number;
  releaseSec?: number;
  pan?: number;
  /** এক্সাইটেশন নয়েজের উজ্জ্বলতা 0.2–0.9 */
  bright?: number;
  /** প্রতি-নমুনা লাইন-ক্ষয় 0.99–0.999 (উঁচু মান = দীর্ঘ রিং) */
  damp?: number;
}

function renderPluck(
  L: Float32Array,
  R: Float32Array,
  freqHz: number,
  o: PluckOpts,
  sr: number,
  rng: () => number
): void {
  const start = Math.floor(o.startSec * sr);
  if (start >= L.length) return;
  const len = Math.max(64, Math.floor(o.durSec * sr));
  const N = Math.max(2, Math.round(sr / freqHz));
  const buf = new Float32Array(N);
  const bright = Math.max(0.2, Math.min(0.9, o.bright ?? 0.55));
  let le = 0;
  for (let i = 0; i < N; i++) {
    le = le * (1 - bright) + (rng() * 2 - 1) * bright;
    buf[i] = le * 1.6;
  }
  const damp = Math.max(0.99, Math.min(0.999, o.damp ?? 0.995));
  let idx = 0;
  const atk = Math.max(1, Math.floor((o.attackSec ?? 0.002) * sr));
  const rel = Math.max(1, Math.floor((o.releaseSec ?? 0.05) * sr));
  const [gl, gr] = panGains(o.gain, o.pan ?? 0);
  for (let i = 0; i < len; i++) {
    const idxAbs = start + i;
    if (idxAbs < 0) {
      idx = (idx + 1) % N;
      continue;
    }
    if (idxAbs >= L.length) break;
    const out = buf[idx];
    const nxt = buf[(idx + 1) % N];
    buf[idx] = damp * 0.5 * (out + nxt);
    idx = (idx + 1) % N;
    let env = 1;
    if (i < atk) env = i / atk;
    if (i > len - rel) env *= (len - i) / rel;
    const v = env * out;
    L[idxAbs] += gl * v;
    R[idxAbs] += gr * v;
  }
}

// ------------------------------------------------------------
// ড্রাম-ভয়েস v2
// ------------------------------------------------------------

function renderKickV2(
  L: Float32Array,
  R: Float32Array,
  startSec: number,
  gain: number,
  rng: () => number,
  sr: number
): void {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(0.3 * sr);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0) continue;
    if (idx >= L.length) break;
    const t = i / sr;
    const f = 148 * Math.exp(-t * 28) + 42; // পিচ-সুইপ: বাস্তব কিকের মতো নেমে আসে
    phase += (2 * Math.PI * f) / sr;
    const env = Math.exp(-t * 10);
    const click = (rng() * 2 - 1) * Math.exp(-t * 480) * 0.45; // হাতুড়ি-ক্লিক
    const s = (Math.sin(phase) + click) * env * gain;
    L[idx] += s * 0.98;
    R[idx] += s;
  }
}

function renderSnare(
  L: Float32Array,
  R: Float32Array,
  startSec: number,
  gain: number,
  rng: () => number,
  sr: number
): void {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(0.24 * sr);
  // নয়েজ অংশ: হাই-পাসড ঝটকা
  const hpAlpha = 1 - Math.exp((-2 * Math.PI * 1500) / sr);
  let lp = 0;
  // টোনাল অংশ: দুটি সামান্য-ভাঙা ড্রাম-স্বর (শেল-রেজোন্যান্স)
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0) continue;
    if (idx >= L.length) break;
    const t = i / sr;
    const env = Math.exp(-t * 20);
    const nz = rng() * 2 - 1;
    lp += hpAlpha * (nz - lp);
    const nzs = (nz - lp) * env;
    const sweep = Math.min(1, t / 0.09);
    const f1 = 186 - 26 * sweep;
    const f2 = 264 - 40 * sweep;
    p1 += (2 * Math.PI * f1) / sr;
    p2 += (2 * Math.PI * f2) / sr;
    const body = (0.55 * Math.sin(p1) + 0.3 * Math.sin(p2)) * Math.exp(-t * 26);
    const s = (nzs * 0.7 + body * 0.55) * gain;
    L[idx] += s;
    R[idx] += s;
  }
}

function renderHat(
  L: Float32Array,
  R: Float32Array,
  startSec: number,
  gain: number,
  rng: () => number,
  sr: number,
  open: boolean
): void {
  const start = Math.floor(startSec * sr);
  const len = Math.floor((open ? 0.3 : 0.055) * sr);
  const a = 1 - Math.exp((-2 * Math.PI * 8200) / sr);
  let lp = 0;
  const decayRate = open ? 10 : 65;
  const [gl, gr] = panGains(gain, open ? 0.18 : 0.12);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0) continue;
    if (idx >= L.length) break;
    const t = i / sr;
    const nz = rng() * 2 - 1;
    lp += a * (nz - lp);
    const s = (nz - lp) * Math.exp(-t * decayRate) * 0.8;
    L[idx] += gl * s;
    R[idx] += gr * s;
  }
}

function renderCrash(
  L: Float32Array,
  R: Float32Array,
  startSec: number,
  gain: number,
  rng: () => number,
  sr: number
): void {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(2.2 * sr);
  const a = 1 - Math.exp((-2 * Math.PI * 4200) / sr);
  let lp = 0;
  const atkSamples = Math.floor(0.28 * sr);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0) continue;
    if (idx >= L.length) break;
    const t = i / sr;
    const nz = rng() * 2 - 1;
    lp += a * (nz - lp);
    const atkEnv = i < atkSamples ? i / atkSamples : 1; // সোয়েল-প্রবেশ
    const s = (nz - lp) * atkEnv * Math.exp(-t * 1.7) * 0.7;
    L[idx] += gain * 0.85 * s;
    R[idx] += gain * s;
  }
}

// ------------------------------------------------------------
// ফ্রিভার্ব-ধাঁচের রিভার্ব — ৮ কম্ব + ৪ অলপাস (প্রতি চ্যানেল),
// স্টেরিও-স্প্রেড, ড্যাম্পিং, ২০ms প্রি-ডিলে। সেন্ড-ধাঁচে যোগ হয়।
// ------------------------------------------------------------

function applyFreeverb(
  L: Float32Array,
  R: Float32Array,
  sr: number,
  wet: number,
  roomSize: number,
  damping: number
): void {
  if (wet <= 0) return;
  const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const ALLS = [556, 441, 341, 225];
  const SPREAD = 23;
  const PRE_DELAY = Math.max(1, Math.floor(0.02 * sr));
  const fb = Math.min(0.92, roomSize);
  const damp = Math.min(0.9, damping);
  const SCALE = 0.06; // ৮-কম্ব যোগফলের মাত্রা-সামঞ্জস্য

  interface FbCell {
    buf: Float32Array;
    idx: number;
    store: number;
  }
  const mkCombs = (off: number): FbCell[] =>
    COMBS.map(len => ({ buf: new Float32Array(len + off), idx: 0, store: 0 }));
  const mkAlls = (off: number): FbCell[] =>
    ALLS.map(len => ({ buf: new Float32Array(len + off), idx: 0, store: 0 }));
  const combL = mkCombs(0);
  const combR = mkCombs(SPREAD);
  const allL = mkAlls(0);
  const allR = mkAlls(SPREAD);

  const preL = new Float32Array(PRE_DELAY);
  const preR = new Float32Array(PRE_DELAY);
  let preIdxL = 0;
  let preIdxR = 0;
  const n = Math.min(L.length, R.length);

  for (let i = 0; i < n; i++) {
    const inL = L[i];
    const inR = R[i];
    // প্রি-ডিলে — শুষ্ক সংকেত পরিষ্কার থাকে, ঘর সামান্য পরেই শুরু
    const dl = preL[preIdxL];
    preL[preIdxL] = inL;
    preIdxL = (preIdxL + 1) % PRE_DELAY;
    const dr = preR[preIdxR];
    preR[preIdxR] = inR;
    preIdxR = (preIdxR + 1) % PRE_DELAY;

    // বাম চ্যানেল: কম্ব-ব্যাংক → অলপাস-শৃঙ্খল
    let accL = 0;
    for (let c = 0; c < combL.length; c++) {
      const cb = combL[c];
      const outp = cb.buf[cb.idx];
      cb.store += damp * (outp - cb.store);
      cb.buf[cb.idx] = dl + fb * cb.store;
      cb.idx = (cb.idx + 1) % cb.buf.length;
      accL += outp;
    }
    let yl = accL;
    for (let a = 0; a < allL.length; a++) {
      const ab = allL[a];
      const outp = ab.buf[ab.idx];
      const y = outp - yl;
      ab.buf[ab.idx] = yl + outp * 0.5;
      ab.idx = (ab.idx + 1) % ab.buf.length;
      yl = y;
    }
    L[i] = inL + wet * SCALE * yl;

    // ডান চ্যানেল
    let accR = 0;
    for (let c = 0; c < combR.length; c++) {
      const cb = combR[c];
      const outp = cb.buf[cb.idx];
      cb.store += damp * (outp - cb.store);
      cb.buf[cb.idx] = dr + fb * cb.store;
      cb.idx = (cb.idx + 1) % cb.buf.length;
      accR += outp;
    }
    let yr = accR;
    for (let a = 0; a < allR.length; a++) {
      const ab = allR[a];
      const outp = ab.buf[ab.idx];
      const y = outp - yr;
      ab.buf[ab.idx] = yr + outp * 0.5;
      ab.idx = (ab.idx + 1) % ab.buf.length;
      yr = y;
    }
    R[i] = inR + wet * SCALE * yr;
  }
}

// ------------------------------------------------------------
// মোটিফ-মেলোডি — ২-বারের (৮-বিট) স্বর-আকৃতি তৈরি ও ভ্যারিয়েশন
// ------------------------------------------------------------

interface MotifNote {
  /** বাক্য-অভ্যন্তরে অবস্থান (বিটে, 0–8) */
  pos: number;
  /** স্থায়িত্ব (বিটে) */
  dur: number;
  /** পেন্টাটনিক-সিঁডির ধাপ (deg -1 = বিশ্রাম) */
  deg: number;
}

const MOTIF_RHYTHMS: number[][] = [
  [1, 1, 2, 1, 1, 2],
  [1.5, 0.5, 2, 1, 1, 2],
  [1, 0.5, 0.5, 1, 1, 1, 2],
  [2, 1, 1, 2, 2],
  [1, 1, 1, 1, 2, 2],
  [0.5, 0.5, 1, 0.5, 0.5, 1, 2, 2],
];

function generateMotif(rng: () => number): MotifNote[] {
  const rhythm = MOTIF_RHYTHMS[Math.floor(rng() * MOTIF_RHYTHMS.length)];
  const notes: MotifNote[] = [];
  let deg = 3 + Math.floor(rng() * 3); // 3..5 থেকে শুরু — মধ্য-রেজিস্টার
  let pos = 0;
  for (let i = 0; i < rhythm.length; i++) {
    const dur = rhythm[i];
    const isLast = i === rhythm.length - 1;
    if (isLast && rng() < 0.35) {
      notes.push({ pos, dur, deg: -1 }); // শেষে নিঃশ্বাস-বিশ্রাম
    } else {
      notes.push({ pos, dur, deg });
      const steps = [0, -1, 1, -2, 2, -1, 1]; // কাছাকাছি ধাপে হাঁটা — সুরকর্মের মতো
      const step = steps[Math.floor(rng() * steps.length)];
      deg = Math.max(0, Math.min(9, deg + step));
    }
    pos += dur;
  }
  return notes;
}

function varyMotif(motif: MotifNote[], rng: () => number): MotifNote[] {
  const out: MotifNote[] = [];
  const shift = rng() < 0.5 ? 1 : -1;
  for (const mn of motif) {
    if (mn.deg < 0) {
      out.push(mn);
      continue;
    }
    const deg = Math.max(0, Math.min(9, mn.deg + shift));
    if (mn.dur >= 2 && rng() < 0.55) {
      // লম্বা নোট দুই ভাগে — দ্বিতীয় অংশ পার্শ্ব-স্বরে
      const firstDur = Math.max(0.5, Math.round(mn.dur * 0.8) / 2);
      out.push({ pos: mn.pos, dur: firstDur, deg });
      out.push({
        pos: mn.pos + firstDur,
        dur: mn.dur - firstDur,
        deg: Math.max(0, Math.min(9, deg + (rng() < 0.5 ? 1 : -1))),
      });
    } else if (rng() < 0.2) {
      out.push({ ...mn, deg: Math.max(0, Math.min(9, deg + (rng() < 0.5 ? 1 : -1))) });
    } else {
      out.push({ ...mn, deg });
    }
  }
  return out;
}

/** পেন্টাটনিক-সিঁডি: ধাপ → MIDI (রুটের এক অষ্টক উপরে থেকে) */
function pentaLadder(penta: number[], rootMidi: number, deg: number): number {
  const oct = Math.floor(deg / penta.length);
  const idx = ((deg % penta.length) + penta.length) % penta.length;
  return rootMidi + 12 + penta[idx] + 12 * oct;
}

/** শক্তিশালী বিটের নোটকে নিকটতম কর্ড-স্বরে স্ন্যাপ — সুর হারমোনির সাথে বাঁধে */
function snapDegreeToChord(
  deg: number,
  chordPcs: Set<number>,
  penta: number[],
  rootMidi: number
): number {
  for (const d of [deg, deg - 1, deg + 1, deg - 2, deg + 2]) {
    if (d < 0 || d > 9) continue;
    if (chordPcs.has(pentaLadder(penta, rootMidi, d) % 12)) return d;
  }
  return deg;
}

// ------------------------------------------------------------
// §৩.১ প্রধান সংশ্লেষণ-ফাংশন (v2)
// ------------------------------------------------------------

const SR = 44100;

type BarRole = 'intro' | 'verse' | 'chorus' | 'outro';

// ------------------------------------------------------------
// Phase-5 — প্রসিডিউরাল গানের নির্ধারক গ্রিড (একক সত্যের উৎস)।
// বিট/সেকশন-কাঠামো কেবল (মুড, BPM, দৈর্ঘ্য) থেকে নির্ধারক — rng/অডিও
// সংশ্লেষণ নির্ভর নয়। পাইপলাইন (synthesizeInstrumental-এর ভেতরে) ও
// নিশ্চিতকরণ-পূর্ব প্ল্যান-প্রিভিউ একই ফাংশন ডাকে — প্রিভিউ আর রানের
// কাট-গ্রিড কখনো আলাদা হতে পারে না (আলাদা হলে সেটি বাগ)।
// ------------------------------------------------------------

export interface ProceduralSongGrid {
  durationSec: number;
  tempoBpm: number;
  beatSec: number;
  barSec: number;
  totalBars: number;
  roles: BarRole[];
  beatsSec: number[];
  sections: MusicSection[];
}

/** বার-ভূমিকা → শক্তিস্তর (music_video-র সেকশন-ম্যাপের একক উৎস) */
export function barRoleEnergy(name: string): 'quiet' | 'medium' | 'loud' {
  if (name === 'chorus') return 'loud';
  if (name === 'intro' || name === 'outro') return 'quiet';
  return 'medium';
}

/**
 * প্রসিডিউরাল ইনস্ট্রুমেন্টালের বিট-গ্রিড/সেকশন-কাঠামো — অডিও ছাড়াই
 * (সস্তা, নির্ধারক)। synthesizeInstrumental-ও ঠিক এই ফাংশনের ফলই ব্যবহার করে।
 */
export function proceduralSongGrid(spec: {
  mood: MusicMood;
  durationSec: number;
  tempoBpm?: number;
}): ProceduralSongGrid {
  const cfg = MOOD_CONFIGS[spec.mood];
  const durationSec = Math.max(8, Math.min(120, Math.round(spec.durationSec)));
  let bpm = spec.tempoBpm ?? cfg.bpmRange[2];
  bpm = Math.max(cfg.bpmRange[0], Math.min(cfg.bpmRange[1], Math.round(bpm)));
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const totalBars = Math.max(4, Math.ceil(durationSec / barSec));

  const beatsSec: number[] = [];
  for (let t = 0; t < durationSec; t += beatSec) beatsSec.push(Math.round(t * 100) / 100);

  // ---- গান-কাঠামো: intro → verse ↔ chorus → outro ----
  const introBars = Math.max(1, Math.min(4, Math.floor(totalBars / 6)));
  const outroBars = Math.max(1, Math.min(4, Math.floor(totalBars / 8)));
  const mainBars = Math.max(2, totalBars - introBars - outroBars);
  const roles: BarRole[] = [];
  for (let i = 0; i < introBars; i++) roles.push('intro');
  {
    let placed = 0;
    let flip = 0;
    while (placed < mainBars) {
      const seg = mainBars - placed >= 8 ? 4 : Math.max(2, mainBars - placed);
      const r: BarRole = flip % 2 === 0 ? 'verse' : 'chorus';
      for (let i = 0; i < seg && placed < mainBars; i++) {
        roles.push(r);
        placed++;
      }
      flip++;
    }
  }
  while (roles.length < totalBars) roles.push('outro');
  for (let i = introBars + mainBars; i < totalBars; i++) roles[i] = 'outro';

  // ধারাবাহিক একই-ভূমিকার বারগুলো এক সেকশনে
  const sections: MusicSection[] = [];
  for (let bar = 0; bar < totalBars; bar++) {
    const name = roles[bar];
    const s = Math.min(durationSec, bar * barSec);
    const e = Math.min(durationSec, (bar + 1) * barSec);
    const last = sections[sections.length - 1];
    if (last && last.name === name && last.endSec === s) last.endSec = e;
    else sections.push({ name, startSec: s, endSec: e });
  }

  return { durationSec, tempoBpm: bpm, beatSec, barSec, totalBars, roles, beatsSec, sections };
}

/**
 * মিউজিক-ভিডিও পাইপলাইনের মুড-নির্ণয়ের একক উৎস — প্রিভিউ ও রান একই
 * ক্রমে (mood-ক্ষেত্র → মোট-টেক্সট → 'romantic') মুড বের করে।
 */
export function resolveInstrumentalMood(fields: {
  mood?: string;
  idea?: string;
  title?: string;
  genre?: string;
}): MusicMood {
  const moodText = `${fields.mood ?? ''} ${fields.idea ?? ''} ${fields.title ?? ''} ${fields.genre ?? ''}`;
  return detectMoodFromText(String(fields.mood ?? '')) ?? detectMoodFromText(moodText) ?? 'romantic';
}

export async function synthesizeInstrumental(spec: MusicJobSpec): Promise<InstrumentalResult> {
  const cfg = MOOD_CONFIGS[spec.mood];
  const rng = makeRng(spec.seed ?? Date.now() % 100000);

  const grid = proceduralSongGrid(spec);
  const durationSec = grid.durationSec;
  const bpm = grid.tempoBpm;
  const beatSec = grid.beatSec;
  const barSec = grid.barSec;
  const totalBars = grid.totalBars;
  const roles = grid.roles;
  const beatsSec = grid.beatsSec;
  const sections = grid.sections;
  // গ্রিডের roles-থেকে বার-ভাগ (সূত্র-নকল নয় — কাঠামো থেকেই উদ্ভূত,
  // proceduralSongGrid-এর সাথে কখনো আলাদা হতে পারে না)
  const introEnd = roles.findIndex(r => r !== 'intro');
  const introBars = introEnd === -1 ? roles.length : introEnd;
  const mainBars = roles.filter(r => r === 'verse' || r === 'chorus').length;
  const outroBars = Math.max(0, totalBars - introBars - mainBars);

  const n = Math.ceil(durationSec * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  const penta = cfg.minor ? PENTA_MINOR : PENTA_MAJOR;

  // ---- সহযোগী বাদ্যযন্ত্র: বার-লুপ ----
  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = bar * barSec;
    if (barStart >= durationSec) break;
    const role = roles[Math.min(bar, roles.length - 1)];
    const chord = cfg.progression[Math.floor(bar / 2) % cfg.progression.length]; // ধীর হারমোনিক-ছন্দ: ২ বার/কর্ড
    const energy = role === 'intro' ? 0.55 : role === 'outro' ? 0.6 : role === 'chorus' ? 1 : 0.8;

    // ---- আউটরো: প্রথম বারেই ফাইনাল রিং-আউট কর্ড ----
    if (role === 'outro') {
      if (bar === totalBars - outroBars) {
        const remaining = Math.max(1.2, durationSec - barStart);
        for (const tone of chord.tones) {
          renderToneV2(L, R, midiHz(cfg.rootMidi + tone), {
            startSec: barStart,
            durSec: remaining * 0.92,
            gain: 0.12 * cfg.padGain,
            attackSec: 0.3,
            releaseSec: Math.min(2.5, remaining * 0.45),
            harmonics: PAD_HARMONICS,
            chorus: { rateHz: 0.13, depthCents: 4, baseCents: 6 },
            pan: tone === chord.tones[0] ? -0.2 : 0.15,
          }, SR);
        }
        // বেজ-মূল নোটও ধীরে নিভে যায়
        renderToneV2(L, R, midiHz(cfg.rootMidi + chord.root - 12), {
          startSec: barStart,
          durSec: remaining * 0.7,
          gain: 0.15 * cfg.bassGain,
          attackSec: 0.012,
          releaseSec: 1.0,
          decayPerSec: 0.9,
          harmonics: BASS_HARMONICS,
        }, SR);
      }
      continue; // আউটরোতে নিয়মিত বাদ্যযন্ত্র নয় — কর্ডটিই শেষ-কথা
    }

    // ---- প্যাড: স্ট্রিং-সেকশন (কোরাস-LFO দোলায়িত ডিটিউন) ----
    const padTones = role === 'chorus' ? [...chord.tones, chord.tones[0] + 12] : chord.tones;
    for (let ti = 0; ti < padTones.length; ti++) {
      renderToneV2(L, R, midiHz(cfg.rootMidi + padTones[ti]), {
        startSec: barStart,
        durSec: Math.min(barSec + 0.3, durationSec - barStart),
        gain: 0.12 * cfg.padGain * energy,
        attackSec: 0.38,
        releaseSec: 0.75,
        harmonics: PAD_HARMONICS,
        chorus: { rateHz: 0.1 + rng() * 0.06, depthCents: 5, baseCents: 7 },
        pan: ti === 0 ? -0.2 : ti === 2 ? 0.2 : ti === 3 ? -0.08 : 0.06,
      }, SR);
    }

    // ---- বেজ: মুড-নির্ভর প্যাটার্ন, মানবিক ভেলোসিটি ----
    if (role !== 'intro') {
      const bassPattern = role === 'chorus' ? cfg.bassChorus : cfg.bassVerse;
      for (const off of bassPattern) {
        const t0 = barStart + off * beatSec;
        if (t0 >= durationSec - 0.05) break;
        renderToneV2(L, R, midiHz(cfg.rootMidi + chord.root - 12), {
          startSec: t0 + (rng() - 0.5) * 0.005,
          durSec: beatSec * 0.95,
          gain: 0.2 * cfg.bassGain * energy * (0.85 + rng() * 0.25),
          attackSec: 0.008,
          releaseSec: 0.1,
          decayPerSec: 1.5,
          harmonics: BASS_HARMONICS,
          glideCents: -16,
          glideSec: 0.02,
        }, SR);
      }
    }

    // ---- আর্পেজিও: কারপ্লাস-স্ট্রং ছড়ানো তার ----
    if (cfg.arpGain > 0) {
      const stepBeats = role === 'chorus' ? cfg.arpDivChorus : cfg.arpDivVerse;
      const steps = Math.floor(4 / stepBeats + 0.001);
      for (let s = 0; s < steps; s++) {
        const cycle = s % 6; // ৩ তার + অষ্টক-উত্তরণ = ৬-ধাপ ব্রোকেন কর্ড
        const tone = chord.tones[cycle % 3] + (cycle >= 3 ? 12 : 0);
        const t0 = barStart + s * stepBeats * beatSec + (rng() - 0.5) * 0.007;
        if (t0 >= durationSec - 0.05) break;
        renderPluck(L, R, midiHz(cfg.rootMidi + tone + 12), {
          startSec: t0,
          durSec: Math.min(beatSec * stepBeats * 1.9, 1.1),
          gain: 0.15 * cfg.arpGain * energy * (0.72 + rng() * 0.36),
          attackSec: 0.002,
          releaseSec: 0.05,
          pan: s % 2 === 0 ? -0.3 : 0.3,
          bright: 0.5 + rng() * 0.25,
          damp: 0.994 + rng() * 0.0025,
        }, SR, rng);
      }
    }

    // ---- ড্রাম: মুড-নির্ভর প্যাটার্ন + কোরাসে ক্র্যাশ-সোয়েল ----
    if (cfg.percussion && (role === 'verse' || role === 'chorus')) {
      const full = role === 'chorus';
      const kicks = full ? cfg.kickChorus : cfg.kickVerse;
      for (const b of kicks) {
        const t = barStart + b * beatSec;
        if (t < durationSec - 0.05) renderKickV2(L, R, t, 0.52 * cfg.percGain * energy, rng, SR);
      }
      if (full) {
        for (const b of [1, 3]) {
          const t = barStart + b * beatSec;
          if (t < durationSec - 0.05) renderSnare(L, R, t, 0.3 * cfg.percGain * energy, rng, SR);
        }
      } else if (spec.mood === 'joyful') {
        const t = barStart + 3 * beatSec;
        if (t < durationSec - 0.05) renderSnare(L, R, t, 0.18 * cfg.percGain * energy, rng, SR);
      }
      for (let b = 0; b < 4; b++) {
        for (const off of [0, 0.5]) {
          const t = barStart + (b + off) * beatSec;
          if (t >= durationSec - 0.05) break;
          const open = full && off === 0.5 && b === 3;
          renderHat(
            L, R, t,
            (off === 0 ? 0.15 : 0.1) * cfg.percGain * energy * (full ? 1 : 0.72),
            rng, SR, open
          );
        }
      }
      if (full && bar > 0 && roles[bar - 1] !== 'chorus') {
        renderCrash(L, R, barStart, 0.22 * cfg.percGain, rng, SR); // কোরাস-প্রবেশে সোয়েল
      }
    }
  }

  // ---- মোটিফ-মেলোডি: verse/chorus বাক্য (২-বার) ----
  const motif = generateMotif(rng);
  const motifVaried = varyMotif(motif, rng);
  let verseSeen = 0;
  let chorusSeen = 0;
  for (let p = 0; p * 2 < mainBars; p++) {
    const phraseBar = introBars + p * 2;
    if (phraseBar >= totalBars) break;
    const role = roles[phraseBar];
    if (role !== 'verse' && role !== 'chorus') continue;
    const isChorus = role === 'chorus';
    if (isChorus) chorusSeen++;
    else verseSeen++;
    const useVaried = (isChorus && chorusSeen >= 2) || (!isChorus && verseSeen >= 2);
    const source = useVaried ? motifVaried : motif;
    const phraseStart = phraseBar * barSec;
    if (phraseStart >= durationSec) break;
    const energy = isChorus ? 1 : 0.78;

    for (const mn of source) {
      if (mn.deg < 0) continue; // বিশ্রাম
      // বাক্যের প্রতিটি বারের কর্ড মেলাও
      const barInPhrase = Math.floor(mn.pos / 4);
      const chord =
        cfg.progression[Math.floor((phraseBar + barInPhrase) / 2) % cfg.progression.length];
      const chordPcs = new Set(chord.tones.map(t => (cfg.rootMidi + t) % 12));
      let deg = mn.deg;
      if (Number.isInteger(mn.pos) && mn.pos % 2 === 0) {
        deg = snapDegreeToChord(deg, chordPcs, penta, cfg.rootMidi); // শক্তি-বিটে কর্ড-বাঁধন
      }
      const midi = pentaLadder(penta, cfg.rootMidi, deg);
      const startSec = phraseStart + mn.pos * beatSec + (rng() - 0.5) * 0.016; // মাইক্রো-টাইমিং
      const vel = 0.8 + rng() * 0.32; // ভেলোসিটি-তারতম্য
      const leadHarmonics = cfg.leadBright ? LEAD_BRIGHT : LEAD_STRINGS;
      const gainBase = 0.2 * cfg.melodyGain * energy * vel;
      const durSec = mn.dur * beatSec * 0.93;
      renderToneV2(L, R, midiHz(midi), {
        startSec,
        durSec,
        gain: gainBase,
        attackSec: 0.022,
        releaseSec: Math.max(0.09, mn.dur * beatSec * 0.35),
        harmonics: leadHarmonics,
        glideCents: -25,
        glideSec: 0.035,
        decayPerSec: 0.18,
        vibrato:
          mn.dur >= 1.2 ? { rateHz: 5.1 + rng() * 0.6, depthCents: 7, delaySec: 0.2 } : undefined,
      }, SR);
      if (isChorus) {
        // কোরাসে অষ্টক-ডাবলিং — পূর্ণতা ও উজ্জ্বলতা
        renderToneV2(L, R, midiHz(midi + 12), {
          startSec,
          durSec,
          gain: gainBase * 0.34,
          attackSec: 0.02,
          releaseSec: Math.max(0.09, mn.dur * beatSec * 0.3),
          harmonics: LEAD_STRINGS,
          decayPerSec: 0.2,
        }, SR);
      }
    }
  }

  // ---- রিভার্ব (মুড-নির্ভর wet) ----
  applyFreeverb(L, R, SR, cfg.reverbWet, 0.82, 0.25);

  // ---- মাস্টার: সফট-ক্লিপ → নরমালাইজ → ফেড ----
  let peak = 0;
  for (let i = 0; i < n; i++) {
    L[i] = softClip(L[i]);
    R[i] = softClip(R[i]);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const target = 0.84; // ≈ −1.5 dBFS
  const scale = peak > 0 ? target / peak : 1;
  const fadeLen = Math.floor(1.4 * SR);
  for (let i = 0; i < n; i++) {
    let f = 1;
    if (i < fadeLen) f = i / fadeLen;
    if (i > n - fadeLen) f = Math.min(f, (n - i) / fadeLen);
    L[i] *= scale * f;
    R[i] *= scale * f;
  }

  const buffer = encodeWav(L, R, SR);
  const peakDb = 20 * Math.log10(target);

  return {
    buffer,
    meta: {
      mood: spec.mood,
      tempoBpm: bpm,
      keyLabel: cfg.keyLabel,
      durationSec: Math.round((n / SR) * 100) / 100,
      beatsSec,
      sections,
      peakDb: Math.round(peakDb * 10) / 10,
      honestLabel: MUSIC_ENGINE_LABEL,
    },
  };
}

// ------------------------------------------------------------
// §৬.১ গান-বিশ্লেষণ (আপলোড করা গানের জন্য) — অপরিবর্তিত
// ------------------------------------------------------------

export interface AudioEnergyAnalysis {
  durationSec: number;
  sampleRate: number;
  /** শনাক্ত বিট-মুহূর্ত (সেকেন্ড) */
  beatsSec: number[];
  /** এনার্জি-ভিত্তিক বিভাগ */
  sections: { startSec: number; endSec: number; energy: 'quiet' | 'medium' | 'loud' }[];
  /** আনুমানিক টেম্পো (BPM) */
  estimatedBpm: number;
  honestLabel: string;
}

export const AUDIO_ANALYSIS_LABEL =
  'এনার্জি-ভিত্তিক বিশ্লেষণ (সরলীকৃত — নিখুঁত বিট-ট্র্যাকিং নয়)';

/** অডিও ফাইল → 16kHz মনো PCM → এনার্জি-সিরিজ → বিট ও বিভাগ */
export async function analyzeAudioEnergy(file: string): Promise<AudioEnergyAnalysis> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'beats-'));
  try {
    const raw = path.join(tmp, 'a.s16');
    await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-y', '-i', file, '-ar', '16000', '-ac', '1', '-f', 's16le', raw],
      { timeout: 120_000 }
    );
    const { readFile } = await import('fs/promises');
    const pcm = await readFile(raw);
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
    const sr = 16000;
    const durationSec = samples.length / sr;

    // 50ms হপে RMS
    const hop = Math.floor(sr * 0.05);
    const frames = Math.floor(samples.length / hop);
    const energy = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      let sum = 0;
      for (let i = f * hop; i < (f + 1) * hop; i++) {
        const v = samples[i] / 32768;
        sum += v * v;
      }
      energy[f] = Math.sqrt(sum / hop);
    }

    // গড়-নির্ভর পিক-পিকিং → বিট
    const beatsSec: number[] = [];
    const win = 8; // 0.4s
    let lastBeat = -1;
    const minGap = 0.25;
    for (let f = 1; f < frames - 1; f++) {
      let mean = 0;
      let cnt = 0;
      for (let k = Math.max(0, f - win); k < Math.min(frames, f + win); k++) {
        mean += energy[k];
        cnt++;
      }
      mean /= Math.max(1, cnt);
      const t = (f * hop) / sr;
      if (
        energy[f] > energy[f - 1] &&
        energy[f] >= energy[f + 1] &&
        energy[f] > mean * 1.5 &&
        energy[f] > 0.02 &&
        t - lastBeat >= minGap
      ) {
        beatsSec.push(Math.round(t * 100) / 100);
        lastBeat = t;
      }
    }

    // আনুমানিক BPM: প্রধান বিট-ব্যবধানের মধ্যমা
    let estimatedBpm = 0;
    if (beatsSec.length >= 4) {
      const gaps: number[] = [];
      for (let i = 1; i < beatsSec.length; i++) gaps.push(beatsSec[i] - beatsSec[i - 1]);
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      if (median > 0) {
        let bpm = 60 / median;
        while (bpm < 70) bpm *= 2;
        while (bpm > 180) bpm /= 2;
        estimatedBpm = Math.round(bpm);
      }
    }

    // ২-সেকেন্ডের জানালায় গড়-এনার্জি → quiet/medium/loud বিভাগ
    const sections: AudioEnergyAnalysis['sections'] = [];
    const secWin = Math.max(4, Math.floor(sr / hop) * 2); // ≈2s ফ্রেম
    let cursor = 0;
    let emax = 0;
    for (let f = 0; f < frames; f++) emax = Math.max(emax, energy[f]);
    while (cursor < frames) {
      let mean = 0;
      let cnt = 0;
      for (let f = cursor; f < Math.min(frames, cursor + secWin); f++) {
        mean += energy[f];
        cnt++;
      }
      mean /= Math.max(1, cnt);
      const level: 'quiet' | 'medium' | 'loud' = mean > emax * 0.55 ? 'loud' : mean > emax * 0.22 ? 'medium' : 'quiet';
      const startSec = (cursor * hop) / sr;
      const endSec = Math.min(durationSec, ((cursor + secWin) * hop) / sr);
      const prev = sections[sections.length - 1];
      if (prev && prev.energy === level) {
        prev.endSec = endSec;
      } else {
        sections.push({ startSec, endSec, energy: level });
      }
      cursor += secWin;
    }

    return {
      durationSec: Math.round(durationSec * 100) / 100,
      sampleRate: sr,
      beatsSec,
      sections,
      estimatedBpm,
      honestLabel: AUDIO_ANALYSIS_LABEL,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** ইনস্ট্রুমেন্টাল আউটপুটের গুণমান-যাচাই (§৩.৩ ধাপ ৭) */
export async function validateInstrumental(
  wavBuffer: Buffer,
  meta: InstrumentalResult['meta']
): Promise<{ ok: boolean; issues: string[]; loudnessLufs?: number; durationSec: number; peakDb?: number }> {
  const issues: string[] = [];
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'musval-'));
  try {
    const f = path.join(tmp, 'm.wav');
    await writeFile(f, wavBuffer);
    const q = await audioQuality(f);
    if (Math.abs(q.durationSec - meta.durationSec) > 2) {
      issues.push(`দৈর্ঘ্য অসামঞ্জস্য: প্রত্যাশা ${meta.durationSec}s, প্রকৃত ${q.durationSec}s`);
    }
    if (q.durationSec < 5) issues.push('দৈর্ঘ্য অত্যন্ত কম');
    if (q.peakDb != null && q.peakDb > -0.5) issues.push('পিক খুব উঁচু — ক্লিপিং-ঝুঁকি');
    const longSilence = q.silenceRanges.find(r => r.end - r.start > 2.5);
    if (longSilence) issues.push(`দীর্ঘ নীরবতা: ${longSilence.start.toFixed(1)}–${longSilence.end.toFixed(1)}s`);
    return {
      ok: issues.length === 0,
      issues,
      loudnessLufs: q.loudnessLufs,
      durationSec: q.durationSec,
      peakDb: q.peakDb,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** মুডের বাংলা লেবেল */
export function moodLabel(mood: MusicMood): string {
  const map: Record<MusicMood, string> = {
    sad: 'বিষণ্ণ',
    romantic: 'রোমান্টিক',
    joyful: 'আনন্দময়',
    suspense: 'রহস্যময়',
    action: 'অ্যাকশন',
    peaceful: 'শান্ত',
  };
  return map[mood];
}

/** লেখা থেকে মুড-সংকেত (দৃশ্য-বর্ণনা → স্কোর-মুড, §৮-এ ব্যবহৃত) */
export function detectMoodFromText(text: string): MusicMood | null {
  const t = (text ?? '').toLowerCase();
  const table: [MusicMood, RegExp][] = [
    ['sad', /বিদায়|কান্না|কষ্ট|দুঃখ|বিষণ্ণ|হারা|একা|sad|sorrow|tear/],
    ['romantic', /ভালোবাসা|প্রেম|মায়া|স্নেহ|romantic|love/],
    ['joyful', /হাসি|আনন্দ|উৎসব|খুশি|উৎসাহ|joy|festival|celebrat/],
    ['suspense', /রহস্য|গোপন|সন্দেহ|ভয়| tense|suspense|mystery/],
    ['action', /দৌড়|যুদ্ধ|ধাওয়া|লড়াই|আক্রমণ|action|chase|fight/],
    ['peaceful', /শান্ত|ভোর|সন্ধ্যা|নদী|বৃষ্টির পর|প্রকৃতি|peaceful|calm|morning/],
  ];
  for (const [mood, re] of table) {
    if (re.test(t)) return mood;
  }
  return null;
}
