// ============================================================
// local-frames.ts v2.1 — নির্ধারক ৮-স্তর প্রসিডিউরাল সিনেমা-ফ্রেম
// (ক্লাউড ইমেজ-জেনারেশন 429/ব্যর্থ হলে সৎ ফলব্যাক — নিউরাল নয়)
//
// ৮ স্তর (পরিবেশ আগে → ভিনিয়েট → আলো → দানা — v2.1 ক্রম):
//   ১. আকাশ-গ্রেডিয়েন্ট (মুড-প্যালেট ৩ রং, হ্যাশ-দিক, gradients seed=)
//   ২. দিগন্ত-পাহাড় (geq সাইন-রিজ ×২, multiply; দিনের মুডে সর্বদা)
//   ৩. ভলিউমেট্রিক মেঘ (uniform-noise → gblur, softlight)
//   ৪. হেজ-ব্লুম (বড়-সিগমা blur → lutrgb টিন্ট, screen)
//   ৫. রেডিয়াল ভিনিয়েট (radial-gradients মাস্ক, multiply — DIY)
//   ৬. নক্ষত্রক্ষেত্র (থ্রেশহোল্ড-নয়েজ: [74..175] → থ্রেশহোল্ড ১৭৩,
//      ~২% কভারেজ, দুই-উজ্জ্বলতা; রাতের মুডে সর্বদা)
//   ৭. আভা-মণ্ডল (রেডিয়াল গ্লো — v2.1: লিনিয়ার-রশ্মি ফ্লাড-বাগ সমাধান)
//   ৮. জ্যোতিষ্ক-চাকতি (সূর্য/চাঁদ — radial, ছোট ব্যাসার্ধ) + ফিল্ম-গ্রেইন
//
// নির্ধারকতা-চুক্তি: একই (seed,width,height,mood) → SHA-256-অভিন্ন বাইট।
//   সব র‍্যান্ডমনেস ইন-ফাইল FNV-1a + splitmix32 (npm-নির্ভরতা শূন্য);
//   প্রমাণিত নির্ধারক ফিল্টার-প্যারামিটার: gradients-এ স্পষ্ট রেখা+seed,
//   noise-এ all_seed, gblur/geq/blend/scale বিশুদ্ধ ফাংশন।
//
// ffmpeg-শিক্ষা (v2.1-এ প্রয়োগিত):
//   ✗ vignette/unsharp ফিল্টার RGB-নেগোশিয়েশনে প্লেন-বিভ্রান্তি করে — নিষিদ্ধ
//   ✗ lut (yuv) RGB-নেগোশিয়েশনে নীরবে বাইপাস হয় — শুধু lutrgb + format=gray-পিন
//   ✗ overlay গ্রাফ-নেগোশিয়েশন বদলে দেয় — বদলে blend ব্যবহার
//   ✓ প্রতিটি ব্লেন্ড-ইনপুটে format=rgb24-পিন
//   ✓ ভিনিয়েট-multiply আলো-উৎস চাপা দেয় → আলো স্তর ভিনিয়েটের পরে
//
// কাঠামো-নিশ্চয়তা: রাত (sad/romantic/suspense/action) → নক্ষত্র সর্বদা;
//   দিন (joyful/peaceful) → পাহাড় সর্বদা; জ্যোতিষ্ক ~৬০% + জোর-পথ।
// ============================================================

import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir } from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

export const LOCAL_FRAME_LABEL =
  'লোকাল প্রসিডিউরাল ফ্রেম (ক্লাউড ইমেজ-জেনারেশন রেট-লিমিটেড — নিউরাল নয়)';

export interface LocalFrameOptions {
  /** হ্যাশ-উৎস — একই seed একই ছবি */
  seed: string;
  width: number;
  height: number;
  /** PNG লেখার পূর্ণ পথ */
  outputPath: string;
  /** মুড — বাংলা/ইংরেজি মুক্ত-টেক্সট মিলবে; অজানা হলে peaceful */
  mood?: string;
  /** ঐচ্ছিক শট/চরিত্র-লেবেল (লগিং-সুবিধা) */
  label?: string;
}

export interface LocalFrameResult {
  path: string;
  layers: string[];
}

// ------------------------------------------------------------
// নির্ধারক হ্যাশ + PRNG (নতুন npm-নির্ভরতা শূন্য)
// ------------------------------------------------------------
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0; // >>>0 — signed-ফেরত বাগ এড়াতে
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

class Rng {
  private nextFloat: () => number;
  constructor(seed: string) {
    this.nextFloat = splitmix32(fnv1a(seed));
  }
  float(): number {
    return this.nextFloat();
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.nextFloat();
  }
  chance(p: number): boolean {
    return this.nextFloat() < p;
  }
}

// ------------------------------------------------------------
// মুড-সংজ্ঞা (৬ প্যালেট) + বাংলা/ইংরেজি মুক্ত-টেক্সট মিলানো
// ------------------------------------------------------------
type MoodKey = 'sad' | 'romantic' | 'joyful' | 'suspense' | 'action' | 'peaceful';

interface MoodSpec {
  night: boolean;
  /** আকাশ ৩-রং (উপরে→নিচে) */
  sky: [string, string, string];
  cloudOpacity: number;
  haze: { r: number; g: number; b: number; base: number; opacity: number };
  ridgeFar: number;
  ridgeNear: number;
  discCore: string;
  discMid: string;
  haloCore: string;
  haloMid: string;
  haloOpacity: number;
}

const MOOD_SPECS: Record<MoodKey, MoodSpec> = {
  sad: {
    night: true,
    sky: ['0x04060e', '0x0c1530', '0x223158'],
    cloudOpacity: 0.32,
    haze: { r: 0.75, g: 0.9, b: 1.18, base: 16, opacity: 0.24 },
    ridgeFar: 60,
    ridgeNear: 20,
    discCore: '0xf4f7ff',
    discMid: '0xc2cbe8',
    haloCore: '0x8a96c4',
    haloMid: '0x343c5e',
    haloOpacity: 0.5,
  },
  romantic: {
    night: true,
    sky: ['0x120820', '0x3a1140', '0x82305c'],
    cloudOpacity: 0.34,
    haze: { r: 1.1, g: 0.85, b: 1.0, base: 16, opacity: 0.22 },
    ridgeFar: 64,
    ridgeNear: 22,
    discCore: '0xfff2f8',
    discMid: '0xd8b8d0',
    haloCore: '0xb088a8',
    haloMid: '0x483048',
    haloOpacity: 0.5,
  },
  joyful: {
    night: false,
    sky: ['0x4da3e0', '0xa8d4ee', '0xffe3a8'],
    cloudOpacity: 0.42,
    haze: { r: 1.15, g: 1.05, b: 0.85, base: 26, opacity: 0.16 },
    ridgeFar: 150,
    ridgeNear: 40,
    discCore: '0xfff6d8',
    discMid: '0xffd98f',
    haloCore: '0xe8c890',
    haloMid: '0x6a5434',
    haloOpacity: 0.45,
  },
  suspense: {
    night: true,
    sky: ['0x03100b', '0x0a2018', '0x16402c'],
    cloudOpacity: 0.3,
    haze: { r: 0.7, g: 1.1, b: 0.9, base: 12, opacity: 0.24 },
    ridgeFar: 58,
    ridgeNear: 18,
    discCore: '0xe8f2e8',
    discMid: '0xa8c2ae',
    haloCore: '0x7a9a84',
    haloMid: '0x2a3c30',
    haloOpacity: 0.5,
  },
  action: {
    night: true,
    sky: ['0x150709', '0x4a1218', '0xa83a20'],
    cloudOpacity: 0.36,
    haze: { r: 1.2, g: 0.8, b: 0.6, base: 18, opacity: 0.24 },
    ridgeFar: 62,
    ridgeNear: 20,
    discCore: '0xfff0d0',
    discMid: '0xe8a868',
    haloCore: '0xc88850',
    haloMid: '0x502c1c',
    haloOpacity: 0.5,
  },
  peaceful: {
    night: false,
    sky: ['0x8fb8d8', '0xcfe0ea', '0xf2e2c4'],
    cloudOpacity: 0.4,
    haze: { r: 1.05, g: 1.0, b: 0.92, base: 22, opacity: 0.16 },
    ridgeFar: 155,
    ridgeNear: 42,
    discCore: '0xfff8e0',
    discMid: '0xffe0a0',
    haloCore: '0xf0d8a8',
    haloMid: '0x786048',
    haloOpacity: 0.42,
  },
};

const MOOD_RULES: Array<{ key: MoodKey; re: RegExp }> = [
  { key: 'sad', re: /sad|melanchol|sorrow|grief|লুট|বিষণ্ণ|দুঃখ|দুখ|কষ্ট|শোক|বেদনা|কান্না|বিরহ|ছন্ন/i },
  { key: 'romantic', re: /romantic|romance|love|ভালোবাসা|ভালবাসা|প্রেম|প্রিয়|মায়া|স্নেহ|valobasha|bhalobasha/i },
  { key: 'joyful', re: /joyful|joy|happy|cheer|festival|celebrat|fun|আনন্দ|খুশি|হাসি|উৎসব|উল্লাস|ধুমধাম/i },
  { key: 'suspense', re: /suspense|myster|thrill|tension|horror|fear|dark|রহস্য|থ্রিলার|উত্তেজনা|ভয়|গোপন|রহস্যময়|আঁধার/i },
  { key: 'action', re: /action|fight|war|chase|battle|fast|energ|অ্যাকশন|একশন|যুদ্ধ|লড়াই|তীব্র|দ্রুত|ঝড়/i },
  { key: 'peaceful', re: /peaceful|peace|calm|serene|tranquil|nature|quiet|শান্ত|প্রশান্ত|স্নিগ্ধ|মিষ্টি|সহজ|shanti|shanto/i },
];

function resolveMood(text: string | undefined): MoodKey {
  const t = String(text ?? '').trim();
  if (!t) return 'peaceful';
  const exact = t.toLowerCase() as MoodKey;
  if (exact in MOOD_SPECS) return exact;
  for (const rule of MOOD_RULES) {
    if (rule.re.test(t)) return rule.key;
  }
  return 'peaceful';
}

// ------------------------------------------------------------
// সহায়ক
// ------------------------------------------------------------
function f(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function clampDim(v: number): number {
  if (!Number.isFinite(v) || v < 64) return 64;
  if (v > 3840) return 3840;
  return Math.round(v);
}

// ------------------------------------------------------------
// মূল জেনারেটর
// ------------------------------------------------------------
export async function generateLocalFrame(opts: LocalFrameOptions): Promise<LocalFrameResult> {
  const seed = String(opts.seed ?? 'local');
  const w = clampDim(opts.width);
  const h = clampDim(opts.height);
  const moodKey = resolveMood(opts.mood);
  const mood = MOOD_SPECS[moodKey];
  const rng = new Rng(`${seed}:frames-v2.1:${moodKey}`);

  // অভ্যন্তরীণ রেন্ডার: দীর্ঘ-অক্ষ ১০২৪px (সুপার-স্যাম্পল), তারপর লক্ষ্য-মাপ
  const long = Math.max(w, h);
  const Wi = long >= h ? 1024 : Math.max(2, Math.round((1024 * w) / long));
  const Hi = long >= h ? Math.max(2, Math.round((1024 * h) / long)) : 1024;

  const layers: string[] = [];
  const parts: string[] = [];
  let blendN = 0;
  let cur = 'sky';

  const blendWith = (layer: string, mode: string, opacity: number): void => {
    blendN += 1;
    const out = `b${blendN}`;
    const op = opacity >= 1 ? '' : `:all_opacity=${opacity.toFixed(3)}`;
    parts.push(`[${cur}][${layer}]blend=all_mode=${mode}${op}[${out}]`);
    cur = out;
  };

  // --- স্তর ১: আকাশ-গ্রেডিয়েন্ট (হ্যাশ-দিক, seed-স্থির) ---
  const dirs: Array<[number, number, number, number]> = [
    [Math.round(Wi * 0.5), 0, Math.round(Wi * 0.5), Hi],
    [0, 0, Wi, Hi],
    [Wi, 0, 0, Hi],
    [Math.round(Wi * 0.22), 0, Math.round(Wi * 0.78), Hi],
  ];
  const [gx0, gy0, gx1, gy1] = dirs[Math.floor(rng.float() * dirs.length) % dirs.length];
  const gseed = Math.floor(rng.range(1, 2147483000));
  parts.push(
    `gradients=s=${Wi}x${Hi}:c0=${mood.sky[0]}:c1=${mood.sky[1]}:c2=${mood.sky[2]}:nb_colors=3:` +
      `x0=${gx0}:y0=${gy0}:x1=${gx1}:y1=${gy1}:seed=${gseed}:duration=0.04,format=rgb24[sky]`
  );
  layers.push('আকাশ-গ্রেডিয়েন্ট');

  // --- স্তর ২: দিগন্ত-পাহাড় (দিনে সর্বদা; রাতে ৫০% — কাঠামো-নিশ্চয়তা) ---
  const wantMountains = !mood.night || rng.chance(0.5);
  if (wantMountains) {
    // কম-রেজোলিউশনে geq (দ্রুত) → scale-আপ (রিজ-নরমালাইজেশন)
    const mw = Math.max(64, Math.round(Wi / 4));
    const mh = Math.max(36, Math.round(Hi / 4));
    const sinPart = (amp: number, freq: number, ph: number): string =>
      `${f(amp)}*sin(X*${f(freq)}+${f(ph)})`;
    const ridgeExpr = (baseFrac: number, amps: number[], freqs: number[], phases: number[]): string =>
      `${f(mh * baseFrac)}-${sinPart(amps[0], freqs[0], phases[0])}` +
      `-${sinPart(amps[1], freqs[1], phases[1])}-${sinPart(amps[2], freqs[2], phases[2])}`;
    // দূরের রিজ — উচ্চতা ~২২-২৯%
    const mf = 0.22 + rng.range(0, 0.07);
    const af1 = mh * (0.05 + rng.range(0, 0.04));
    const kf1 = (2 * Math.PI * (1.5 + rng.range(0, 2))) / mw;
    const pf = rng.range(0, Math.PI * 2);
    const farExpr = ridgeExpr(
      1 - mf,
      [af1, af1 * 0.45, af1 * 0.2],
      [kf1, kf1 * 2.7, kf1 * 5.3],
      [pf, pf * 1.7 + 1.1, pf * 2.3 + 2.2]
    );
    // কাছের রিজ — আরও নিচে, বেশি গাঢ়
    const mn = mf + 0.09 + rng.range(0, 0.05);
    const an1 = mh * (0.04 + rng.range(0, 0.03));
    const kn1 = (2 * Math.PI * (1.2 + rng.range(0, 1.6))) / mw;
    const pn = rng.range(0, Math.PI * 2);
    const nearExpr = ridgeExpr(
      1 - mn,
      [an1, an1 * 0.5, an1 * 0.22],
      [kn1, kn1 * 3.1, kn1 * 6.7],
      [pn, pn * 1.4 + 0.7, pn * 2.8 + 3.1]
    );
    parts.push(
      `color=white:s=${mw}x${mh}:duration=0.04,format=gray,` +
        `geq=lum='if(gt(Y,${nearExpr}),${mood.ridgeNear},if(gt(Y,${farExpr}),${mood.ridgeFar},255))',` +
        `scale=${Wi}:${Hi},format=rgb24[mtn]`
    );
    blendWith('mtn', 'multiply', 1);
    layers.push('দিগন্ত-পাহাড় (geq সাইন-রিজ)');
  }

  // --- স্তর ৩: ভলিউমেট্রিক মেঘ (uniform-noise → gblur, softlight) ---
  const nCloud = Math.floor(rng.range(1, 2147483000));
  const cloudSigma = Math.round(rng.range(20, 34));
  parts.push(
    `color=gray:s=${Wi}x${Hi}:duration=0.04,noise=alls=34:allf=u:all_seed=${nCloud},` +
      `gblur=sigma=${cloudSigma},format=rgb24[cld]`
  );
  blendWith('cld', 'softlight', mood.cloudOpacity);
  layers.push('ভলিউমেট্রিক মেঘ (softlight)');

  // --- স্তর ৪: হেজ-ব্লুম (মুড-টিন্টেড বড়-গ্লো, screen) ---
  const nHaze = Math.floor(rng.range(1, 2147483000));
  const hazeSigma = Math.round(rng.range(58, 84));
  const hz = mood.haze;
  parts.push(
    `color=gray:s=${Wi}x${Hi}:duration=0.04,noise=alls=60:allf=u:all_seed=${nHaze},` +
      `gblur=sigma=${hazeSigma},` +
      `lutrgb='r=clip((val-100)*1.7*${f(hz.r)}+${f(hz.base)},0,255):` +
      `g=clip((val-100)*1.7*${f(hz.g)}+${f(hz.base)},0,255):` +
      `b=clip((val-100)*1.7*${f(hz.b)}+${f(hz.base)},0,255)',format=rgb24[haze]`
  );
  blendWith('haze', 'screen', hz.opacity);
  layers.push('হেজ-ব্লুম (screen)');

  // --- স্তর ৫: রেডিয়াল ভিনিয়েট (radial-gradients মাস্ক, multiply) ---
  // (আলো-উৎসের আগে — v2.1 ক্রম-ফিক্স: ভিনিয়েট পরে আলো যোগ হয়)
  const vcx = Math.round(Wi * (0.44 + rng.range(0, 0.12)));
  const vcy = Math.round(Hi * (0.4 + rng.range(0, 0.12)));
  const vR = Math.round(Math.max(Wi, Hi) * (0.58 + rng.range(0, 0.08)));
  const vseed = Math.floor(rng.range(1, 2147483000));
  parts.push(
    `gradients=s=${Wi}x${Hi}:type=radial:c0=white:c1=0xd8d8d8:c2=0x8a8a8a:nb_colors=3:` +
      `x0=${vcx}:y0=${vcy}:x1=${vcx + vR}:y1=${vcy}:seed=${vseed}:duration=0.04,format=rgb24[vig]`
  );
  blendWith('vig', 'multiply', 1);
  layers.push('রেডিয়াল ভিনিয়েট');

  // --- স্তর ৬: নক্ষত্রক্ষেত্র (রাতে সর্বদা — কাঠামো-নিশ্চয়তা) ---
  if (mood.night) {
    const nStar = Math.floor(rng.range(1, 2147483000));
    parts.push(
      `color=gray:s=${Wi}x${Hi}:duration=0.04,noise=alls=100:allf=u:all_seed=${nStar},` +
        `lutrgb='r=clip((val-173)*127,0,255):g=clip((val-173)*127,0,255):b=clip((val-173)*127,0,255)',` +
        `format=rgb24[stars]`
    );
    blendWith('stars', 'screen', 0.95);
    layers.push('নক্ষত্রক্ষেত্র (থ্রেশহোল্ড-নয়েজ)');
  }

  // --- স্তর ৭+৮: আভা-মণ্ডল ও জ্যোতিষ্ক-চাকতি (~৬০% + জোর-পথ) ---
  const discRoll = rng.chance(0.6) || fnv1a(`${seed}:disc`) % 4 === 0;
  if (discRoll) {
    const dx = Math.round(Wi * (0.16 + rng.range(0, 0.68)));
    const dy = Math.round(Hi * (0.12 + rng.range(0, 0.26)));
    const Rdisc = Math.round(Math.max(Wi, Hi) * (0.035 + rng.range(0, 0.02)));
    const Raura = Math.round(Math.max(Wi, Hi) * (0.16 + rng.range(0, 0.08)));
    const dseed = Math.floor(rng.range(1, 2147483000));
    // আভা আগে (নিচে), চাকতি পরে (উপরে) — উভয়ই রেডিয়াল (লিনিয়ার-ফ্লাড-বাগ নেই)
    parts.push(
      `gradients=s=${Wi}x${Hi}:type=radial:c0=${mood.haloCore}:c1=${mood.haloMid}:c2=black:nb_colors=3:` +
        `x0=${dx}:y0=${dy}:x1=${dx + Raura}:y1=${dy}:seed=${dseed}:duration=0.04,format=rgb24[aura]`
    );
    blendWith('aura', 'screen', mood.haloOpacity);
    parts.push(
      `gradients=s=${Wi}x${Hi}:type=radial:c0=${mood.discCore}:c1=${mood.discMid}:c2=black:nb_colors=3:` +
        `x0=${dx}:y0=${dy}:x1=${dx + Rdisc}:y1=${dy}:seed=${dseed}:duration=0.04,format=rgb24[disc]`
    );
    blendWith('disc', 'screen', 1);
    layers.push('আভা-মণ্ডল (রেডিয়াল গ্লো)');
    layers.push('জ্যোতিষ্ক-চাকতি (রেডিয়াল)');
  }

  // --- শেষ: লক্ষ্য-মাপে scale + ফিল্ম-গ্রেইন ---
  const nGrain = Math.floor(rng.range(1, 2147483000));
  parts.push(`[${cur}]scale=${w}:${h},noise=alls=6:allf=t:all_seed=${nGrain},format=rgb24[out]`);
  layers.push('ফিল্ম-গ্রেইন');

  const graph = parts.join(';');
  const args = [
    '-y',
    '-hide_banner',
    '-v',
    'error',
    '-filter_complex',
    graph,
    '-map',
    '[out]',
    '-frames:v',
    '1',
    opts.outputPath,
  ];

  await mkdir(path.dirname(opts.outputPath), { recursive: true });
  try {
    await execFileAsync('ffmpeg', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (err) {
    const raw = err as { message?: string; stderr?: Buffer | string };
    const detail = [String(raw?.stderr ?? ''), String(raw?.message ?? '')]
      .filter(Boolean)
      .join(' | ');
    throw new Error(
      `লোকাল-ফ্রেম জেনারেশন ব্যর্থ (mood=${moodKey}, ${w}x${h}): ${detail.slice(0, 500)}`
    );
  }

  return { path: opts.outputPath, layers };
}
