// ============================================================
// PCM সংশ্লেষণ-ভিত্তি — WAV এনকোডার, নয়েজ-জেনারেটর, ফিল্টার।
// music_engine ও sound_design উভয়ে ব্যবহৃত (কোড-নকল এড়াতে)।
// ============================================================

/** বীজ-ভিত্তিক ছদ্ম-দৈবিক (পুনরুৎপাদনযোগ্য অডিও) */
export function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** সাদা নয়েজ-জেনারেটর (rng-নির্ভর) */
export function whiteNoise(rng: () => number): number {
  return rng() * 2 - 1;
}

/** ব্রাউন নয়েজ (একক জেনারেটর-অবস্থা) */
export function makeBrownNoise(rng: () => number): () => number {
  let last = 0;
  return () => {
    last = (last + 0.02 * whiteNoise(rng)) / 1.02;
    return last * 3.5;
  };
}

/** এক-মেরুর লো-পাস ফিল্টার (নয়েজ নরম করতে) */
export function makeLowpass(alpha: number): (x: number) => number {
  let y = 0;
  return x => {
    y += alpha * (x - y);
    return y;
  };
}

/** সহজ ব্যান্ড-পাস লক্ষণ (resonator) */
export function makeResonator(freqHz: number, sr: number, decay = 0.995): (x: number) => number {
  const w = (2 * Math.PI * freqHz) / sr;
  const a = Math.sin(w);
  let y1 = 0;
  let y2 = 0;
  return x => {
    const y0 = 2 * Math.cos(w) * decay * y1 - decay * decay * y2 + a * x;
    y2 = y1;
    y1 = y0;
    return y0;
  };
}

/** সফট-ক্লিপ */
export function softClip(x: number): number {
  return Math.tanh(x * 1.2) / Math.tanh(1.2);
}

export const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** 16-bit PCM stereo WAV এনকোড */
export function encodeWav(L: Float32Array, R: Float32Array, sampleRate: number): Buffer {
  const n = Math.min(L.length, R.length);
  const dataLen = n * 4;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataLen, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, L[i]));
    const r = Math.max(-1, Math.min(1, R[i]));
    buf.writeInt16LE(Math.round(l * 32767), o);
    buf.writeInt16LE(Math.round(r * 32767), o + 2);
    o += 4;
  }
  return buf;
}

/** শুরু/শেশ ফেড প্রয়োগ (in-place) */
export function applyFades(L: Float32Array, R: Float32Array, sr: number, inSec: number, outSec: number): void {
  const n = L.length;
  const fi = Math.floor(inSec * sr);
  const fo = Math.floor(outSec * sr);
  for (let i = 0; i < n; i++) {
    let f = 1;
    if (i < fi) f = i / Math.max(1, fi);
    if (i > n - fo) f = Math.min(f, (n - i) / Math.max(1, fo));
    L[i] *= f;
    R[i] *= f;
  }
}

/** পিক-নরমালাইজ (টার্গেট লিনিয়ার অ্যামপ্লিচিউড) */
export function normalizePeak(L: Float32Array, R: Float32Array, target = 0.84): number {
  let peak = 0;
  for (let i = 0; i < L.length; i++) {
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const scale = peak > 0 ? target / peak : 1;
  for (let i = 0; i < L.length; i++) {
    L[i] *= scale;
    R[i] *= scale;
  }
  return 20 * Math.log10(target); // আসন্ন পিক dB
}
