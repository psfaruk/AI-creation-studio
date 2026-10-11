// ============================================================
// Sound Design Engine — নতুন মাস্টার প্ল্যান §৮
// প্রতিটি ভিডিওর জন্য ৫টি আলাদা অডিও-স্তর:
//   A1 সংলাপ · A2 পরিবেশ-শব্দ (ambience) · A3 ফোলে/অ্যাকশন-ইফেক্ট
//   A4 ব্যাকগ্রাউন্ড মিউজিক · A5 বর্ণনা
//
// সততার ঘোষণা: ambience/foley এখানে *সংশ্লেষিত* (PCM গণিত) —
// লাইসেন্সসম্মত রেকর্ডেড সাউন্ড-লাইব্রেরি নয়। সব আউটপুটে এই
// লেবেল থাকে। মিক্সিং-নিয়ম §৮ অনুসারে বাধ্যতামূলক: সংলাপ যেন
// মিউজিকের নিচে চাপা না পড়ে (ducking), মাস্টার ক্লিপিং-মুক্ত।
// ============================================================

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import path from 'path';
import os from 'os';
import { audioQuality } from '@/lib/media/ffmpeg';
import { runFfmpeg } from '@/lib/media/ffmpeg';
import { makeRng, makeBrownNoise, makeLowpass, makeResonator, whiteNoise, softClip, encodeWav, applyFades, normalizePeak } from './pcm';

/** নির্ভুল ebur128 লাউডনেস — চূড়ান্ত সারসংক্ষেপের (শেষ-মিল) মান */
async function preciseLufs(file: string): Promise<number | null> {
  try {
    const { stderr } = await runFfmpeg(['-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-'], {
      label: 'ebur128',
      timeoutMs: 90_000,
    });
    const matches = [...stderr.matchAll(/I:\s*(-?[\d.]+|-inf)\s*LUFS/gi)];
    const last = matches[matches.length - 1];
    if (!last || last[1] === '-inf') return null;
    const v = Number(last[1]);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

const execFileAsync = promisify(execFileCb);
const SR = 44100;

export const SOUND_DESIGN_LABEL = 'সংশ্লেষিত অ্যাম্বিয়েন্স/ফোলে (পরীক্ষামূলক — রেকর্ডেড লাইব্রেরি নয়)';

// ------------------------------------------------------------
// §৮ — স্তর-সংজ্ঞা
// ------------------------------------------------------------

export type SoundLayerId = 'A1_dialogue' | 'A2_ambience' | 'A3_foley' | 'A4_music' | 'A5_narration';

export const SOUND_LAYERS: { id: SoundLayerId; label: string; about: string }[] = [
  { id: 'A1_dialogue', label: 'A1 · সংলাপ', about: 'চরিত্রের কথা — ভাষা-নিয়ন্ত্রক দিয়ে যাচাইকৃত TTS' },
  { id: 'A2_ambience', label: 'A2 · পরিবেশ-শব্দ', about: 'দৃশ্যের আবহ — বৃষ্টি, চায়ের দোকান, রাত, শহর…' },
  { id: 'A3_foley', label: 'A3 · ফোলে/অ্যাকশন', about: '�াপ রাখা, পায়ের শব্দ, দরজা, বজ্র…' },
  { id: 'A4_music', label: 'A4 · ব্যাকগ্রাউন্ড মিউজিক', about: 'দৃশ্যের আবেগ-অনুযায়ী স্কোর (প্রসিডিউরাল)' },
  { id: 'A5_narration', label: 'A5 · বর্ণনা', about: 'ঐচ্ছিক পুরো-দৈর্ঘ্যের ভয়েসওভার' },
];

// ------------------------------------------------------------
// দৃশ্য-সচেতন পরিকল্পনা (§৮ — দৃশ্যের ধরন অনুযায়ী নির্বাচন)
// ------------------------------------------------------------

export type AmbienceKind =
  | 'rain'
  | 'cafe'
  | 'night'
  | 'city_traffic'
  | 'crowd'
  | 'wind'
  | 'river'
  | 'office'
  | 'market';

export type FoleyKind =
  | 'cup_place'
  | 'footsteps'
  | 'door'
  | 'thunder'
  | 'bird'
  | 'clock'
  | 'phone'
  | 'knock';

export interface SoundscapePlan {
  ambience: AmbienceKind[];
  foley: FoleyKind[];
  matchedKeywords: string[];
  honestLabel: string;
}

const AMBIENCE_KEYWORDS: Record<AmbienceKind, RegExp[]> = {
  rain: [/বৃষ্টি|বর্ষণ|রাইন কোট|rain|monsoon|ঝড়/],
  cafe: [/চায়ের দোকান|চা-এর দোকান|ক্যাফে|টি-স্টল|tea (shop|stall)|cafe|রেস্তোরাঁ/],
  night: [/রাত|মধ্যরাত|নিশি|night|midnight|চাঁদ/],
  city_traffic: [/শহর|রাস্তা|যানবাহন|ট্রাফিক|bus|road|street|গাড়ি/],
  crowd: [/ভিড়|জনতা|মানুষে ভরা|crowd|বাজার-হাটের ভিড়/],
  wind: [/বাতাস|হাওয়া|ঝড়ের বাতাস|wind|breeze/],
  river: [/নদী|নৌকা|স্রোত|river|boat|সমুদ্র|সাগর|sea|ওয়েভ/],
  office: [/অফিস|কর্মক্ষেত্র|desk|office|চাকরি/],
  market: [/বাজার|হাট|market|বস্তি/],
};

const FOLEY_KEYWORDS: Record<FoleyKind, RegExp[]> = {
  cup_place: [/চায়ের কাপ|কাপ রাখ|কাপ তুল|cup|mug|চুমুক/],
  footsteps: [/হাঁটা|পায়ে পা|দৌড়|হাঁটছে|walk|run|step/],
  door: [/দরজা|কড়া নাড়|door|knock.*door/],
  thunder: [/বজ্র|বিদ্যুৎ|thunder|thunderstorm/],
  bird: [/পাখি|পাখির ডাক|bird|chirp/],
  clock: [/ঘড়ি|সময়ের টিক|clock|tick/],
  phone: [/ফোন|মোবাইল|phone|call|ring/],
  knock: [/কড়া|দস্তক|knock|টোকা/],
};

/** দৃশ্যের বর্ণনা → অ্যাম্বিয়েন্স/ফোলে পরিকল্পনা (শব্দ-মিল-ভিত্তিক) */
export function planSoundscape(sceneText: string, hints?: { ambience?: string[]; foley?: string[] }): SoundscapePlan {
  const t = (sceneText ?? '').toLowerCase();
  const matched: string[] = [];
  const ambience = new Set<AmbienceKind>();
  const foley = new Set<FoleyKind>();

  for (const [kind, patterns] of Object.entries(AMBIENCE_KEYWORDS) as [AmbienceKind, RegExp[]][]) {
    if (patterns.some(p => p.test(t))) {
      ambience.add(kind);
      matched.push(kind);
    }
  }
  for (const [kind, patterns] of Object.entries(FOLEY_KEYWORDS) as [FoleyKind, RegExp[]][]) {
    if (patterns.some(p => p.test(t))) {
      foley.add(kind);
      matched.push(kind);
    }
  }
  // কিছুই মিললে না → নিরপেক্ষ নরম ঘরের আবহ
  if (ambience.size === 0) ambience.add('wind');

  for (const a of hints?.ambience ?? []) {
    if (a in AMBIENCE_KEYWORDS) ambience.add(a as AmbienceKind);
  }
  for (const f of hints?.foley ?? []) {
    if (f in FOLEY_KEYWORDS) foley.add(f as FoleyKind);
  }

  return { ambience: [...ambience].slice(0, 2), foley: [...foley].slice(0, 3), matchedKeywords: matched, honestLabel: SOUND_DESIGN_LABEL };
}

// ------------------------------------------------------------
// অ্যাম্বিয়েন্স সংশ্লেষণ
// ------------------------------------------------------------

/** এক ধরনের অ্যাম্বিয়েন্স — durationSec দৈর্ঘ্যের stereo বাফার */
export function synthesizeAmbience(kind: AmbienceKind, durationSec: number, seed = 42): { L: Float32Array; R: Float32Array; sr: number } {
  const rng = makeRng(seed + kind.length * 977);
  const n = Math.max(Math.floor(durationSec * SR), SR / 2);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const brown = makeBrownNoise(rng);
  const lp = makeLowpass(0.12);

  const addNoiseBeds = (gain: number, panJitter = 0.15) => {
    for (let i = 0; i < n; i++) {
      const w = whiteNoise(rng);
      const v = lp(w) * gain * (1 + 0.08 * Math.sin((2 * Math.PI * 0.13 * i) / SR));
      L[i] += v * (1 - panJitter * rng() * 0.5);
      R[i] += v * (1 + panJitter * rng() * 0.5);
    }
  };

  switch (kind) {
    case 'rain': {
      addNoiseBeds(0.55);
      // ছাদে/পাতায় বড় ফোঁটার টুকটাক আঘাত
      const drip = makeResonator(2100, SR, 0.985);
      for (let i = 0; i < n; i += Math.floor(SR * (0.05 + rng() * 0.4))) {
        for (let k = 0; k < 240 && i + k < n; k++) {
          const env = Math.exp(-k / 80);
          const v = drip(whiteNoise(rng) * env) * 0.22;
          L[i + k] += v;
          R[i + k] += v * 0.8;
        }
      }
      break;
    }
    case 'cafe': {
      addNoiseBeds(0.3);
      // মৃদু কথার গুঞ্জন — লো-ব্যান্ড নয়েজ স্ফীতি
      const murmur = makeLowpass(0.05);
      for (let i = 0; i < n; i++) {
        const swell = 0.5 + 0.5 * Math.sin((2 * Math.PI * 0.4 * i) / SR + rng() * 0.2);
        const v = murmur(whiteNoise(rng)) * 0.5 * swell;
        L[i] += v;
        R[i] += v * 0.9;
      }
      // মাঝে মাঝে কাপের টুংটাং
      const clink = makeResonator(2600, SR, 0.992);
      for (let i = Math.floor(rng() * SR * 2); i < n; i += Math.floor(SR * (3 + rng() * 6))) {
        for (let k = 0; k < 600 && i + k < n; k++) {
          const env = Math.exp(-k / 160);
          const v = clink(whiteNoise(rng) * env) * 0.12;
          L[i + k] += v * 0.8;
          R[i + k] += v;
        }
      }
      break;
    }
    case 'night': {
      addNoiseBeds(0.1);
      // ঝিঁঝাঁর — দলবদ্ধ ৪.২kHz বার্স্ট
      const chirp = makeResonator(4200, SR, 0.996);
      let i = 0;
      while (i < n) {
        const burstLen = Math.floor(SR * 0.045);
        const group = 3 + Math.floor(rng() * 3);
        for (let g = 0; g < group; g++) {
          const off = i + g * Math.floor(burstLen * 1.7);
          for (let k = 0; k < burstLen && off + k < n; k++) {
            const env = Math.sin((Math.PI * k) / burstLen);
            const v = chirp(whiteNoise(rng) * 0.4) * env * 0.08;
            L[off + k] += v * 0.7;
            R[off + k] += v;
          }
        }
        i += Math.floor(SR * (0.8 + rng() * 1.6));
      }
      break;
    }
    case 'city_traffic': {
      // ধ্বনি-গর্জন + চলে যাওয়া গাড়ির স্ফীতি
      for (let i = 0; i < n; i++) {
        const v = brown() * 0.4;
        L[i] += v;
        R[i] += v * 0.95;
      }
      for (let i = Math.floor(rng() * SR); i < n; i += Math.floor(SR * (2.5 + rng() * 5))) {
        const dur = Math.floor(SR * (1.2 + rng()));
        const bp = makeResonator(400 + rng() * 700, SR, 0.985);
        for (let k = 0; k < dur && i + k < n; k++) {
          const env = Math.sin((Math.PI * k) / dur);
          const pan = 0.4 * Math.sin((Math.PI * k) / dur);
          const v = bp(whiteNoise(rng)) * env * 0.5;
          L[i + k] += v * (1 - pan);
          R[i + k] += v * (1 + pan);
        }
      }
      break;
    }
    case 'crowd': {
      const murmur = makeLowpass(0.06);
      for (let i = 0; i < n; i++) {
        const swell = 0.55 + 0.45 * Math.sin((2 * Math.PI * (0.2 + rng() * 0.05) * i) / SR);
        const v = murmur(whiteNoise(rng)) * 0.75 * swell;
        L[i] += v * 0.9;
        R[i] += v;
      }
      break;
    }
    case 'wind': {
      const wlp = makeLowpass(0.04);
      for (let i = 0; i < n; i++) {
        const gust = 0.4 + 0.6 * Math.abs(Math.sin((2 * Math.PI * 0.09 * i) / SR + Math.sin(i / (SR * 7))));
        const v = wlp(whiteNoise(rng)) * gust * 0.7;
        L[i] += v;
        R[i] += v * 0.92;
      }
      break;
    }
    case 'river': {
      addNoiseBeds(0.5, 0.05);
      const bubble = makeResonator(900, SR, 0.99);
      for (let i = 0; i < n; i += Math.floor(SR * (0.08 + rng() * 0.5))) {
        for (let k = 0; k < 120 && i + k < n; k++) {
          const env = Math.exp(-k / 45);
          const v = bubble(whiteNoise(rng) * env) * 0.08;
          L[i + k] += v;
          R[i + k] += v * 0.85;
        }
      }
      break;
    }
    case 'office': {
      // নিচু হাম + টিকটিক কীবোর্ড
      for (let i = 0; i < n; i++) {
        const hum = Math.sin((2 * Math.PI * 58 * i) / SR) * 0.02 + brown() * 0.12;
        L[i] += hum;
        R[i] += hum;
      }
      for (let i = Math.floor(rng() * SR * 3); i < n; i += Math.floor(SR * (0.4 + rng() * 2.5))) {
        for (let k = 0; k < 60 && i + k < n; k++) {
          const env = Math.exp(-k / 12);
          const v = whiteNoise(rng) * env * 0.06;
          L[i + k] += v;
          R[i + k] += v * 0.7;
        }
      }
      break;
    }
    case 'market': {
      const murmur = makeLowpass(0.06);
      for (let i = 0; i < n; i++) {
        const swell = 0.5 + 0.5 * Math.sin((2 * Math.PI * 0.3 * i) / SR + rng() * 0.1);
        const v = murmur(whiteNoise(rng)) * 0.7 * swell;
        L[i] += v * 0.9;
        R[i] += v;
      }
      const bell = makeResonator(1900, SR, 0.994);
      for (let i = Math.floor(rng() * SR * 4); i < n; i += Math.floor(SR * (5 + rng() * 8))) {
        for (let k = 0; k < 800 && i + k < n; k++) {
          const env = Math.exp(-k / 220);
          const v = bell(whiteNoise(rng) * env) * 0.1;
          L[i + k] += v;
          R[i + k] += v * 0.8;
        }
      }
      break;
    }
  }

  for (let i = 0; i < n; i++) {
    L[i] = softClip(L[i]);
    R[i] = softClip(R[i]);
  }
  return { L, R, sr: SR };
}

// ------------------------------------------------------------
// ফোলে সংশ্লেষণ (এক-মুহূর্তের ঘটনা)
// ------------------------------------------------------------

/** একটি ফোলে-ঘটনা — মোট durationSec টাইমলাইনে atSec মুহূর্তে */
export function synthesizeFoley(kind: FoleyKind, atSec: number, timelineSec: number, seed = 7): { L: Float32Array; R: Float32Array; sr: number } {
  const rng = makeRng(seed + kind.length * 131);
  const n = Math.max(Math.floor(timelineSec * SR), SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const start = Math.floor(Math.max(0, atSec) * SR);

  const addEvent = (offsetSec: number, render: (buf: Float32Array[], base: number, dur: number) => void, durSec: number) => {
    const base = start + Math.floor(offsetSec * SR);
    const dur = Math.floor(durSec * SR);
    render([L, R], base, dur);
  };

  switch (kind) {
    case 'cup_place': {
      const clink = makeResonator(2500, SR, 0.99);
      const thud = makeResonator(240, SR, 0.985);
      addEvent(0, (bufs, base, dur) => {
        for (let k = 0; k < dur; k++) {
          const i = base + k;
          if (i >= n) break;
          const env = Math.exp(-k / 200);
          const v = clink(whiteNoise(rng) * env) * 0.5 + thud(whiteNoise(rng) * Math.exp(-k / 60)) * 0.6;
          L[i] += v * 0.8;
          R[i] += v;
        }
      }, 0.4);
      break;
    }
    case 'footsteps': {
      for (let s = 0; s < 4; s++) {
        const thump = makeResonator(120 - s * 6, SR, 0.98);
        addEvent(s * 0.5, (bufs, base, dur) => {
          for (let k = 0; k < dur; k++) {
            const i = base + k;
            if (i >= n) break;
            const env = Math.exp(-k / 45);
            const v = thump(whiteNoise(rng) * env) * 0.55;
            L[i] += v * (s % 2 ? 1 : 0.85);
            R[i] += v * (s % 2 ? 0.85 : 1);
          }
        }, 0.22);
      }
      break;
    }
    case 'door': {
      const creak = makeResonator(300, SR, 0.995);
      addEvent(0, (bufs, base, dur) => {
        for (let k = 0; k < dur; k++) {
          const i = base + k;
          if (i >= n) break;
          const t = k / SR;
          const env = Math.min(1, k / (SR * 0.05)) * Math.exp(-t * 2.2);
          const freqWobble = 0.5 + 0.5 * Math.sin(t * 14);
          const v = creak(whiteNoise(rng) * env * freqWobble) * 0.4;
          L[i] += v;
          R[i] += v * 0.9;
        }
        // শেষে ঠেলা-শব্দ
        for (let k = dur - Math.floor(SR * 0.15); k < dur; k++) {
          const i = base + k;
          if (i >= n || k < 0) break;
          const env = Math.exp(-(k - (dur - Math.floor(SR * 0.15))) / 50);
          const v = whiteNoise(rng) * env * 0.5;
          L[i] += v;
          R[i] += v;
        }
      }, 1.1);
      break;
    }
    case 'thunder': {
      const rumble = makeBrownNoise(rng);
      addEvent(0, (bufs, base, dur) => {
        for (let k = 0; k < dur; k++) {
          const i = base + k;
          if (i >= n) break;
          const t = k / SR;
          const env = Math.exp(-t * 0.9) * Math.min(1, t * 8);
          const v = rumble() * env * 1.4;
          L[i] += v;
          R[i] += v * 0.95;
        }
      }, 3.2);
      break;
    }
    case 'bird': {
      for (let c = 0; c < 3; c++) {
        const f = 3200 + rng() * 900;
        addEvent(c * 0.35, (bufs, base, dur) => {
          for (let k = 0; k < dur; k++) {
            const i = base + k;
            if (i >= n) break;
            const t = k / SR;
            const env = Math.sin((Math.PI * k) / dur);
            const sweep = Math.sin(2 * Math.PI * (f + 500 * Math.sin(t * 40)) * t);
            const v = sweep * env * 0.16;
            L[i] += v;
            R[i] += v * 0.75;
          }
        }, 0.12);
      }
      break;
    }
    case 'clock': {
      for (let s = 0; s < Math.max(2, Math.floor(timelineSec - atSec)); s++) {
        addEvent(s * 1.0, (bufs, base, dur) => {
          for (let k = 0; k < dur; k++) {
            const i = base + k;
            if (i >= n) break;
            const env = Math.exp(-k / 30);
            const v = whiteNoise(rng) * env * 0.25;
            L[i] += v * (s % 2 ? 1 : 0.8);
            R[i] += v * (s % 2 ? 0.8 : 1);
          }
        }, 0.04);
      }
      break;
    }
    case 'phone': {
      for (let r = 0; r < 3; r++) {
        addEvent(r * 2.2, (bufs, base, dur) => {
          for (let k = 0; k < dur; k++) {
            const i = base + k;
            if (i >= n) break;
            const t = k / SR;
            const on = t % 0.5 < 0.4 ? 1 : 0;
            const v = on ? (Math.sin(2 * Math.PI * 1150 * t) * 0.5 + Math.sin(2 * Math.PI * 1450 * t) * 0.3) * 0.18 : 0;
            L[i] += v * 0.85;
            R[i] += v;
          }
        }, 1.6);
      }
      break;
    }
    case 'knock': {
      for (let s = 0; s < 3; s++) {
        addEvent(s * 0.28, (bufs, base, dur) => {
          for (let k = 0; k < dur; k++) {
            const i = base + k;
            if (i >= n) break;
            const env = Math.exp(-k / 70);
            const v = whiteNoise(rng) * env * 0.7 + Math.sin((2 * Math.PI * 180 * k) / SR) * env * 0.4;
            L[i] += v * 0.9;
            R[i] += v;
          }
        }, 0.15);
      }
      break;
    }
  }
  return { L, R, sr: SR };
}

/** পরিকল্পনা অনুযায়ী সম্পূর্ণ A2+A3 বেড রেন্ডার → WAV বাফার */
export function renderSoundscapeBed(
  plan: SoundscapePlan,
  durationSec: number,
  opts?: { foleyAtSec?: number[]; seed?: number }
): Buffer {
  const n = Math.max(Math.floor(durationSec * SR), SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  for (const kind of plan.ambience) {
    const bed = synthesizeAmbience(kind, durationSec, (opts?.seed ?? 42) + kind.length);
    const g = 0.8 / Math.max(1, plan.ambience.length);
    for (let i = 0; i < n; i++) {
      L[i] += bed.L[i] * g;
      R[i] += bed.R[i] * g;
    }
  }
  let at = opts?.foleyAtSec?.[0] ?? Math.min(1.5, durationSec * 0.3);
  for (const kind of plan.foley) {
    const ev = synthesizeFoley(kind, at, durationSec, (opts?.seed ?? 42) + kind.length * 3);
    for (let i = 0; i < n; i++) {
      L[i] += ev.L[i] * 0.9;
      R[i] += ev.R[i] * 0.9;
    }
    at += 2.2;
    if (at > durationSec - 1) at = Math.max(0.5, durationSec * 0.2);
  }
  applyFades(L, R, SR, 0.6, 0.9);
  normalizePeak(L, R, 0.7);
  return encodeWav(L, R, SR);
}

// ------------------------------------------------------------
// §৮ মিক্সিং-নিয়ম সহ ৫-স্তর মিক্সার
// ------------------------------------------------------------

export interface MixLayer {
  /** স্তর */
  layer: SoundLayerId;
  /** অডিও ফাইলের পাথ (ffmpeg ইনপুট) */
  file: string;
  /** শুরু-মুহূর্ত (সে.) — ডিফল্ট ০ */
  startSec?: number;
  /** dB গেইন সমন্বয় (ডিফল্ট স্তর-নীতি থেকে) */
  gainDbOverride?: number;
}

export interface MixRules {
  /** ডিফল্ট আপেক্ষিক স্তর (dB) — §৮ */
  dialogueDb: number;
  ambienceDb: number;
  foleyDb: number;
  musicDb: number;
  narrationDb: number;
  /** সংলাপ চলাকালে মিউজিক-ডাকিং */
  duckMusic: boolean;
  limiter: boolean;
}

export const DEFAULT_MIX_RULES: MixRules = {
  dialogueDb: -3,
  ambienceDb: -19,
  foleyDb: -12,
  musicDb: -15,
  narrationDb: -7,
  duckMusic: true,
  limiter: true,
};

export interface SoundMixReport {
  ok: boolean;
  issues: string[];
  loudnessLufs?: number;
  peakDb?: number;
  durationSec: number;
  honestLabel: string;
}

/**
 * ৫-স্তর মিক্স — §৮-এর বাধ্যতামূলক নিয়মসহ:
 * সংলাপ প্রধান, মিউজিক ডাকিং, মাস্টার লিমিটার, ebur128 যাচাই।
 */
export async function mixSoundLayers(
  layers: MixLayer[],
  outputPath: string,
  rules: MixRules = DEFAULT_MIX_RULES
): Promise<SoundMixReport> {
  const issues: string[] = [];
  const gainFor = (l: MixLayer): number =>
    l.gainDbOverride ??
    (l.layer === 'A1_dialogue'
      ? rules.dialogueDb
      : l.layer === 'A2_ambience'
        ? rules.ambienceDb
        : l.layer === 'A3_foley'
          ? rules.foleyDb
          : l.layer === 'A4_music'
            ? rules.musicDb
            : rules.narrationDb);

  const inputs: string[] = [];
  const chains: string[] = [];
  let hasDialogue = false;
  let dialogueIdx = -1;
  let musicIdx = -1;

  layers.forEach((l, i) => {
    inputs.push('-i', l.file);
    const delay = Math.round((l.startSec ?? 0) * 1000);
    chains.push(
      `[${i}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,volume=${gainFor(l)}dB,adelay=${delay}:all=1[a${i}]`
    );
    if (l.layer === 'A1_dialogue') {
      hasDialogue = true;
      dialogueIdx = i;
    }
    if (l.layer === 'A4_music') musicIdx = i;
  });

  let outLabel: string;
  if (rules.duckMusic && hasDialogue && musicIdx >= 0 && layers.length >= 2) {
    // সংলাপ-সাইডচেইনে মিউজিক-ডাকিং: সংলাপ asplit → মূল + সাইডচেইন;
    // মিউজিক সরাসরি sidechaincompress-এর মূল ইনপুট (অব্যবহৃত আউটপুট নেই)
    const sideChain = `[a${dialogueIdx}]asplit=2[dlgMain][dlgSc]`;
    const compress = `[a${musicIdx}][dlgSc]sidechaincompress=threshold=0.03:ratio=8:attack=12:release=280[musicDucked]`;
    const mixLabels = layers
      .map((_, i) => (i === musicIdx ? 'musicDucked' : i === dialogueIdx ? 'dlgMain' : `a${i}`))
      .map(lbl => `[${lbl}]`)
      .join('');
    const n = layers.length;
    chains.push(sideChain, compress);
    chains.push(`${mixLabels}amix=inputs=${n}:normalize=0[mixpre]`);
    outLabel = 'mixpre';
  } else {
    const mixLabels = layers.map((_, i) => `[a${i}]`).join('');
    chains.push(`${mixLabels}amix=inputs=${layers.length}:normalize=0[mixpre]`);
    outLabel = 'mixpre';
  }

  const tail = rules.limiter
    ? `[${outLabel}]alimiter=limit=0.971:level=false,aresample=44100[out]`
    : `[${outLabel}]aresample=44100[out]`;
  chains.push(tail);

  const args = ['-hide_banner', '-y', ...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', outputPath];
  await execFileAsync('ffmpeg', args, { timeout: 180_000 });

  // যাচাই: ক্লিপিং-মুক্ততা + নির্ভুল লাউডনেস পরিমাপ
  const q = await audioQuality(outputPath);
  const lufs = await preciseLufs(outputPath);
  if (q.peakDb != null && q.peakDb > -0.1) issues.push(`মাস্টার পিক খুব উঁচু (${q.peakDb.toFixed(1)} dB)`);
  if (q.durationSec <= 0.2) issues.push('মিক্সের দৈর্ঘ্য প্রায় শূন্য');
  const longSilence = q.silenceRanges.find(r => r.end - r.start > 3);
  if (longSilence) issues.push(`দীর্ঘ নীরবতা: ${longSilence.start.toFixed(1)}–${longSilence.end.toFixed(1)}s`);
  if (lufs != null && lufs < -30) issues.push(`লাউডনেস খুব কম (${lufs} LUFS)`);

  return {
    ok: issues.length === 0,
    issues,
    loudnessLufs: lufs ?? undefined,
    peakDb: q.peakDb,
    durationSec: q.durationSec,
    honestLabel: SOUND_DESIGN_LABEL,
  };
}
