// ============================================================
// Music Generation Engine — নতুন মাস্টার প্ল্যান §৩
//
// সততার ঘোষণা (§৩.৩ "গুরুত্বপূর্ণ সীমাবদ্ধতা" অনুসারে):
//  - এই ইঞ্জিন *প্রসিডিউরাল সংশ্লেষণ* করে — সুর-তত্ত্বভিত্তিক
//    (স্কেল, কর্ড-প্রগ্রেশন, ছন্দ) গাণিতিক অডিও-সংশ্লেষণ। এটি
//    প্রকৃত অডিও তৈরি করে, কিন্তু এটি MusicGen/YuE-ধর্মী
//    নিউরাল মিউজিক-মডেল নয় → সব আউটপুটে "পরীক্ষামূলক" লেবেল।
//  - গান গাওয়া (singing) ও স্টেম-পৃথকীকরণ মডেল এই পরিবেশে নেই —
//    সেগুলো গেটেড থাকে; TTS-কে গান বলে দেখানো হয় না।
//  - TTS-এর কণ্ঠে গানের কথা পড়ে দেওয়াকে "সম্পূর্ণ গাওয়া গান"
//    হিসেবে দেখানো যাবে না (মাস্টার প্ল্যানের নিয়ম)।
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
  'প্রসিডিউরাল সংগীত-সংশ্লেষণ (পরীক্ষামূলক — নিউরাল মিউজিক-মডেল নয়)';

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
// সুর-তত্ত্ব — মুড-কনফিগ
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
}

const MOOD_CONFIGS: Record<MusicMood, MoodConfig> = {
  sad: {
    rootMidi: 57, // A3
    scaleName: 'A মাইনর',
    keyLabel: 'A মাইনর',
    minor: true,
    bpmRange: [62, 84, 72],
    percussion: false,
    padGain: 0.9,
    bassGain: 0.8,
    melodyGain: 0.7,
    arpGain: 0.35,
    percGain: 0,
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
    progression: [
      { root: 0, tones: [0, 4, 7], name: 'C' },
      { root: 7, tones: [7, 11, 14], name: 'G' },
      { root: 9, tones: [9, 12, 16], name: 'Am' },
      { root: 5, tones: [5, 9, 12], name: 'F' },
    ],
  },
  joyful: {
    rootMidi: 67, // G4 এর এক অক্টেভ নিচে ধরি G3=55
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
    arpGain: 0.3,
    percGain: 0.5,
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
// ছোট সহায়ক (PCM-সহায়ক pcm.ts থেকে)
// ------------------------------------------------------------

// ------------------------------------------------------------
// বাদ্যযন্ত্র-সংশ্লেষণ (একক নোট/আঘাত রেন্ডারার)
// ------------------------------------------------------------

interface NoteOpts {
  startSec: number;
  durSec: number;
  gain: number;
  attackSec?: number;
  releaseSec?: number;
  harmonics?: { ratio: number; gain: number }[];
  detune?: number; // সামান্য ডিটিউন (প্যাডের জন্য)
  pan?: number; // -1..1
}

function renderTone(
  L: Float32Array,
  R: Float32Array,
  freqHz: number,
  o: NoteOpts,
  sr: number
): void {
  const start = Math.floor(o.startSec * sr);
  const len = Math.floor(o.durSec * sr);
  const atk = Math.floor((o.attackSec ?? 0.01) * sr);
  const rel = Math.floor((o.releaseSec ?? 0.08) * sr);
  const harmonics = o.harmonics ?? [
    { ratio: 1, gain: 1 },
    { ratio: 2, gain: 0.18 },
    { ratio: 3, gain: 0.05 },
  ];
  const detune = o.detune ?? 0;
  const pan = Math.max(-1, Math.min(1, o.pan ?? 0));
  const gl = o.gain * (1 - Math.max(0, pan)) ** 0.5;
  const gr = o.gain * (1 - Math.max(0, -pan)) ** 0.5;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / sr;
    let env = 1;
    if (i < atk) env = i / Math.max(1, atk);
    if (i > len - rel) env *= (len - i) / Math.max(1, rel);
    // হালকা পার্সিভ ফলঅফ
    env *= Math.exp(-t * 0.35);
    let s = 0;
    for (const h of harmonics) {
      s += h.gain * Math.sin(2 * Math.PI * freqHz * h.ratio * t);
      if (detune) s += h.gain * 0.5 * Math.sin(2 * Math.PI * (freqHz * h.ratio + detune) * t);
    }
    L[idx] += gl * env * s;
    R[idx] += gr * env * s;
  }
}

function renderNoise(
  L: Float32Array,
  R: Float32Array,
  o: NoteOpts & { decaySec: number; rng: () => number },
  sr: number
): void {
  const start = Math.floor(o.startSec * sr);
  const len = Math.floor(o.durSec * sr);
  const pan = Math.max(-1, Math.min(1, o.pan ?? 0));
  const gl = o.gain * (1 - Math.max(0, pan)) ** 0.5;
  const gr = o.gain * (1 - Math.max(0, -pan)) ** 0.5;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / sr;
    const env = Math.exp(-t / o.decaySec);
    const n = o.rng() * 2 - 1;
    L[idx] += gl * env * n;
    R[idx] += gr * env * n;
  }
}

function renderKick(L: Float32Array, R: Float32Array, startSec: number, gain: number, sr: number): void {
  const start = Math.floor(startSec * sr);
  const len = Math.floor(0.16 * sr);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx < 0 || idx >= L.length) continue;
    const t = i / sr;
    const freq = 110 * Math.exp(-t * 22) + 42;
    const env = Math.exp(-t * 15);
    const s = Math.sin(2 * Math.PI * freq * t) * env * gain;
    L[idx] += s;
    R[idx] += s;
  }
}

// ------------------------------------------------------------
// §৩.১ প্রধান সংশ্লেষণ-ফাংশন
// ------------------------------------------------------------

const SR = 44100;

export async function synthesizeInstrumental(spec: MusicJobSpec): Promise<InstrumentalResult> {
  const cfg = MOOD_CONFIGS[spec.mood];
  const rng = makeRng(spec.seed ?? Date.now() % 100000);

  const durationSec = Math.max(8, Math.min(120, Math.round(spec.durationSec)));
  let bpm = spec.tempoBpm ?? cfg.bpmRange[2];
  bpm = Math.max(cfg.bpmRange[0], Math.min(cfg.bpmRange[1], Math.round(bpm)));
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const totalBars = Math.max(4, Math.ceil(durationSec / barSec));

  const n = Math.ceil(durationSec * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  const beatsSec: number[] = [];
  for (let t = 0; t < durationSec; t += beatSec) beatsSec.push(Math.round(t * 100) / 100);

  const sections: MusicSection[] = [];
  const introBars = Math.min(2, Math.max(1, Math.floor(totalBars / 6)));
  const outroBars = Math.min(2, Math.max(1, Math.floor(totalBars / 8)));
  const mainBars = totalBars - introBars - outroBars;
  sections.push({ name: 'intro', startSec: 0, endSec: Math.min(durationSec, introBars * barSec) });
  // মূল অংশ verse/chorus পাল্টায় (২ বার করে)
  let cursor = introBars;
  let toggle = 0;
  while (cursor < introBars + mainBars) {
    const segBars = Math.min(2, introBars + mainBars - cursor);
    const s = cursor * barSec;
    const e = Math.min(durationSec, (cursor + segBars) * barSec);
    sections.push({ name: toggle % 2 === 0 ? 'verse' : 'chorus', startSec: s, endSec: e });
    cursor += segBars;
    toggle++;
  }
  sections.push({
    name: 'outro',
    startSec: Math.min(durationSec, (introBars + mainBars) * barSec),
    endSec: durationSec,
  });

  const penta = cfg.minor ? PENTA_MINOR : PENTA_MAJOR;
  let melodyMidi = cfg.rootMidi + 12;

  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = bar * barSec;
    if (barStart >= durationSec) break;
    const chord = cfg.progression[bar % cfg.progression.length];
    const sectionName = sectionAt(sections, barStart);
    const isIntro = sectionName === 'intro';
    const isOutro = sectionName === 'outro';
    const isChorus = sectionName === 'chorus';
    const energy = isIntro ? 0.55 : isOutro ? 0.5 : isChorus ? 1.0 : 0.8;

    // --- প্যাড: স্থায়ী কর্ড ---
    for (const tone of chord.tones) {
      const midi = cfg.rootMidi + tone;
      renderTone(L, R, midiHz(midi), {
        startSec: barStart,
        durSec: Math.min(barSec + 0.25, durationSec - barStart),
        gain: 0.16 * cfg.padGain * energy,
        attackSec: 0.5,
        releaseSec: 0.9,
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.12 },
        ],
        detune: 0.7,
        pan: tone === chord.tones[0] ? -0.2 : tone === chord.tones[2] ? 0.2 : 0,
      }, SR);
    }

    // --- বেজ: বারে দুই আঘাত ---
    const bassMidi = cfg.rootMidi + chord.root - 12;
    for (const beatOff of [0, 2]) {
      renderTone(L, R, midiHz(bassMidi), {
        startSec: barStart + beatOff * beatSec,
        durSec: beatSec * 1.8,
        gain: 0.22 * cfg.bassGain * energy,
        attackSec: 0.02,
        releaseSec: 0.3,
        harmonics: [
          { ratio: 1, gain: 1 },
          { ratio: 2, gain: 0.08 },
        ],
      }, SR);
    }

    // --- আর্পেজিও: প্রতি অষ্টম-নোটে কর্ড-টোন ---
    if (cfg.arpGain > 0 && !isIntro) {
      for (let i = 0; i < 8; i++) {
        const tone = chord.tones[i % chord.tones.length];
        const midi = cfg.rootMidi + tone + 12;
        renderTone(L, R, midiHz(midi), {
          startSec: barStart + i * (beatSec / 2),
          durSec: beatSec * 0.5,
          gain: 0.08 * cfg.arpGain * energy,
          attackSec: 0.005,
          releaseSec: 0.12,
          harmonics: [
            { ratio: 1, gain: 1 },
            { ratio: 3, gain: 0.15 },
          ],
          pan: i % 2 === 0 ? -0.3 : 0.3,
        }, SR);
      }
    }

    // --- মেলোডি: পেন্টাটনিক বিচরণ ---
    if (!isIntro || bar >= 1) {
      let pos = 0;
      while (pos < 4) {
        const step = rng() < 0.3 ? 1.5 : rng() < 0.6 ? 1 : 0.5;
        const dur = step * beatSec;
        const jump = Math.floor(rng() * 5) - 2;
        melodyMidi = Math.max(cfg.rootMidi + 7, Math.min(cfg.rootMidi + 24, melodyMidi + jump));
        if (rng() < 0.6) {
          renderTone(L, R, midiHz(melodyMidi), {
            startSec: barStart + pos * beatSec,
            durSec: dur * 0.95,
            gain: 0.2 * cfg.melodyGain * energy,
            attackSec: 0.01,
            releaseSec: Math.max(0.1, dur * 0.5),
            harmonics: [
              { ratio: 1, gain: 1 },
              { ratio: 2, gain: 0.2 },
              { ratio: 4, gain: 0.04 },
            ],
          }, SR);
        }
        pos += step;
      }
    }

    // --- পার্কাশন (মুডে চালু হলে) ---
    if (cfg.percussion && !isIntro) {
      for (let b = 0; b < 4; b++) {
        const t = barStart + b * beatSec;
        if (t >= durationSec) break;
        if (b === 0 || b === 2) renderKick(L, R, t, 0.5 * cfg.percGain * energy, SR);
        renderNoise(L, R, {
          startSec: t + beatSec / 2,
          durSec: 0.06,
          gain: 0.05 * cfg.percGain * energy,
          decaySec: 0.015,
          rng,
          pan: 0.25,
          attackSec: 0.001,
          releaseSec: 0.01,
        }, SR);
        if (b === 1 || b === 3) {
          renderNoise(L, R, {
            startSec: t,
            durSec: 0.15,
            gain: 0.09 * cfg.percGain * energy,
            decaySec: 0.05,
            rng,
            pan: -0.15,
            attackSec: 0.001,
            releaseSec: 0.02,
          }, SR);
        }
      }
    }
  }

  // --- মাস্টার: সফট-ক্লিপ + নরমালাইজ + শুরু/শেষ ফেড ---
  let peak = 0;
  for (let i = 0; i < n; i++) {
    L[i] = softClip(L[i]);
    R[i] = softClip(R[i]);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const target = 0.84; // ≈ −1.5 dBFS
  const scale = peak > 0 ? target / peak : 1;
  const fadeLen = Math.floor(1.2 * SR);
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

function sectionAt(sections: MusicSection[], t: number): string {
  for (const s of sections) {
    if (t >= s.startSec && t < s.endSec) return s.name;
  }
  return sections[sections.length - 1]?.name ?? 'verse';
}

// ------------------------------------------------------------
// §৬.১ গান-বিশ্লেষণ (আপলোড করা গানের জন্য)
// এনার্জি-ভিত্তিক বিট-শনাক্তকরণ ও আনুমানিক বিভাগ-বিভাজন।
// সৎ সীমা: এটি সংগীত-তথ্য-বিশ্লেষণ (music information retrieval)-এর
// সরলীকৃত সংস্করণ — নিখুঁত বিট-ট্র্যাকিং নয়।
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
