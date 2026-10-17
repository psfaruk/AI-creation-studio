// ============================================================
// বাস্তব-কথা-সদৃশ টেস্ট WAV নির্মাতা (D-2/B2 — layered audio validation)
//
// পটভূমি: পুরনো টেস্ট-ফিক্সচারগুলো ছিল বিশুদ্ধ ডিজিটাল-নীরবতা
// (encodeWav(new Float32Array(n), …)) — এবং যাচাইকারী নীরবতা-গেট না
// থাকায় সেগুলো "pass" হয়ে যেত (D-2-এর প্রকৃত ত্রুটি: "silent audio
// with a plausible duration can pass verification")।
//
// এখন যাচাইকারী নীরবতা প্রত্যাখ্যান করে — তাই "সুস্থ কথা" ফিক্সচারের
// অবশ্যই অ-নীরব হতে হবে। এই নির্মাতা 320Hz টোন তৈরি করে
// (amp=0.3 → peak ≈ −10.5dB, RMS ≈ −13.5dB — নীরবতা-গেট, শান্ত-ওয়ার্ন
// (−38dB) বা ক্লিপিং (−0.1dB) কোনোটিই ট্রিগার করে না)।
//
// ক্যালিব্রেশন-প্রমাণ (ffmpeg 7.1.5, 2026-10-17): sine=320 →
// peak −18.06dB / RMS −21.07dB; anullsrc → peak/RMS −inf +
// silencedetect(-45dB) পুরো ফাইল জুড়ে এক নীরব-রেঞ্জ।
// ============================================================
import { encodeWav } from '@/lib/agent/audio/pcm';

export interface ToneWavOptions {
  /** সাইন-অ্যামপ্লিচিউড (0–1); ডিফল্ট 0.3 → peak −10.5dB */
  amplitude?: number;
  /** Hz; ডিফল্ট 320 */
  frequency?: number;
  /** ডিফল্ট 24000 */
  sampleRate?: number;
  /** বাম/ডান চ্যানেলের ফেজ-অফসেট (স্টেরিও-বিচিত্রতার জন্য) */
  phase?: number;
}

/** অ-নীরব "কথা-সদৃশ" টোন WAV — duration-সুস্থ পথের ফিক্সচার */
export function toneWavOfSeconds(sec: number, opts: ToneWavOptions = {}): Buffer {
  const sr = opts.sampleRate ?? 24000;
  const amp = opts.amplitude ?? 0.3;
  const freq = opts.frequency ?? 320;
  const phase = opts.phase ?? 0;
  const n = Math.round(sec * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    L[i] = amp * Math.sin(2 * Math.PI * freq * t);
    R[i] = amp * Math.sin(2 * Math.PI * freq * t + phase);
  }
  return encodeWav(L, R, sr);
}

/** বিশুদ্ধ ডিজিত নীরবতা — নীরবতা-প্রত্যাখ্যান গেটের নেতিবাচক ফিক্সচার */
export function silentWavOfSeconds(sec: number, sampleRate = 24000): Buffer {
  const n = Math.round(sec * sampleRate);
  return encodeWav(new Float32Array(n), new Float32Array(n), sampleRate);
}
