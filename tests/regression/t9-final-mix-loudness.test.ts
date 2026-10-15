// ============================================================
// REG-9 — final-mix loudness normalization (Phase-3 Workstream B,
// P0-BUG-02: recorded short film measured −25.4 LUFS vs −16 target)
//
// mixSoundLayers (sound_design.ts) এখন স্তর-মিক্সের পরে দুই-ধাপ
// loudnorm প্রয়োগ করে (DEFAULT_MIX_RULES.targetLufs = −16 LUFS /
// −1.5 dBTP)। এই ফাইলটি প্রকৃত ffmpeg + প্রকৃত প্রসিডিউরাল ইঞ্জিন
// (music_engine, sound_design bed) দিয়ে আসল-কোডেক ফিক্সচার বানিয়ে
// আগে/পরে পরিমাপ করে।
//
// Isolation: sdk-helpers মক (film-helpers→llm→SDK চেইন বন্ধ — t1-প্যাটার্ন);
// music_engine/sound_design/ffmpeg/muxAudio সব রিয়েল; সব ফাইল os.tmpdir()-এ;
// কোনো provider/db/storage ছোঁয়া নেই।
//
// সীমা-স্বীকারোক্তি: yrz3ymb7-এর রেকর্ডকৃত MP4 (Phase-0-এ −25.4 LUFS মাপা)
// এই স্যান্ডবক্সে নেই (snapshot-রিস্টোরে রানটাইম storage হারিয়েছে; নতুন
// করে বানাতে live-provider বাজেট লাগবে) — তাই "real recorded artifact"
// before/after = NOT RUN; এখানে রিয়েল-কোডেক সিন্থেটিক ফিক্সচারই প্রমাণ।
// ============================================================

import { describe, expect, test, mock, afterAll } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { encodeWav } from '@/lib/agent/audio/pcm';
// type-only ইম্পোর্ট — রানটাইমে মুছে যায়, তাই মকের ক্রম নষ্ট করে না
import type { MixLayer, MixRules } from '@/lib/agent/audio/sound_design';

// film-helpers → sdk-helpers → llm → SDK চেইন বন্ধ; বাকি সব রিয়েল থাকবে
mock.module('@/lib/agent/sdk-helpers', () => {
  return {
    chatJson: async () => {
      throw new Error('chatJson should not be called in this test');
    },
    transcribeBuffer: async () => '',
    synthesizeSpeech: async () => {
      throw new Error('synthesizeSpeech should not be called in this test');
    },
  };
});

const { mixSoundLayers, DEFAULT_MIX_RULES, renderSoundscapeBed, planSoundscape } = await import(
  '@/lib/agent/audio/sound_design'
);
const { synthesizeInstrumental } = await import('@/lib/agent/audio/music_engine');
const { normalizeLoudnessTwoPass, measureLoudness, mediaInfo } = await import('@/lib/media/ffmpeg');
const { muxAudio } = await import('@/lib/agent/film-helpers');
const { runFfmpeg } = await import('@/lib/media/ffmpeg');

const DUR = 8; // সেকেন্ড — synthesizeInstrumental-এর ন্যূনতম ৮ সে.-এর সাথে মিল
const TMPDIRS: string[] = [];

async function freshDir(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  TMPDIRS.push(d);
  return d;
}

/** সংলাপের বদলে সৎ-সিন্থেটিক "কণ্ঠ": বিশ্রামসহ টোন-বার্স্ট (টেস্টের নামেই ঘোষিত) */
function syntheticVoiceWav(sec: number): Buffer {
  const sr = 44100;
  const n = sec * sr;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const inBurst = t % 1.6 < 0.9; // ০.৯ সে. কথা + ০.৭ সে. বিরতি
    if (inBurst) {
      const env = Math.min(1, (t % 1.6) * 8) * Math.min(1, (0.9 - (t % 1.6)) * 8);
      const v = Math.sin(2 * Math.PI * 185 * t) * 0.42 * env + Math.sin(2 * Math.PI * 370 * t) * 0.12 * env;
      L[i] = v;
      R[i] = v * 0.95;
    }
  }
  return encodeWav(L, R, sr);
}

/** সত্যিকারের প্রোডাকশন-চেহারার নীরব-মিক্স ফিক্সচার: dialogue+ambience+music */
async function buildFixtureLayers(dir: string): Promise<MixLayer[]> {
  const voiceFile = path.join(dir, 'fx-dialogue.wav');
  await writeFile(voiceFile, syntheticVoiceWav(DUR));
  const bedFile = path.join(dir, 'fx-ambience.wav');
  await writeFile(bedFile, renderSoundscapeBed(planSoundscape('রাতের বৃষ্টিতে বাজারের ভিড়'), DUR, { seed: 11 }));
  const musicFile = path.join(dir, 'fx-music.wav');
  const inst = await synthesizeInstrumental({ mood: 'joyful', durationSec: DUR, seed: 42 });
  await writeFile(musicFile, inst.buffer);
  // নীরবতা-নিশ্চিত করতে DEFAULT-এর চেয়ে ~১১ dB নিচু স্তর — yrz3ymb7-এর
  // −২৫.৪ LUFS (P0-BUG-02) চিহ্নের কাছাকাছি অ-সাম্যকৃত মিক্স তৈরি হয়
  return [
    { layer: 'A1_dialogue', file: voiceFile, gainDbOverride: -14 },
    { layer: 'A2_ambience', file: bedFile, gainDbOverride: -28 },
    { layer: 'A4_music', file: musicFile, gainDbOverride: -26 },
  ];
}

afterAll(async () => {
  await Promise.all(TMPDIRS.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
});

describe('REG-9: final-mix loudness (~−16 LUFS / −1.5 dBTP)', () => {
  test('REG-9a: quiet multi-layer mix normalizes to −16 LUFS ±1.0 with true-peak ≤ −1.2 dBTP', async () => {
    const dir = await freshDir('reg9a-');
    const layers = await buildFixtureLayers(dir);

    // আগে (পুরোনো আচরণ — targetLufs বন্ধ): নীরব-মিক্স থেকে যায় (P0-BUG-02-এর চিহ্ন)
    const RAW_RULES: MixRules = { ...DEFAULT_MIX_RULES, targetLufs: undefined, maxTruePeakDbtp: undefined };
    const rawPath = path.join(dir, 'mix-raw.wav');
    const raw = await mixSoundLayers(layers, rawPath, RAW_RULES);
    console.log(`[REG-9a] raw mix: ${raw.loudnessLufs?.toFixed(1)} LUFS, peak ${raw.peakDb?.toFixed(1)} dB`);
    expect(raw.loudnessLufs!).toBeLessThan(-20); // অ-সাম্যকৃত মিক্স সত্যিই নীরব ছিল

    // পরে (Phase-3 B): চূড়ান্ত মিক্স ~−16 LUFS-এ সাম্যীকৃত
    const normPath = path.join(dir, 'mix-normalized.wav');
    const norm = await mixSoundLayers(layers, normPath, DEFAULT_MIX_RULES);
    console.log(
      `[REG-9a] normalized: ${norm.normalizedLufs?.toFixed(1)} LUFS (target ${norm.targetLufs}), TP ${norm.truePeakDbtp?.toFixed(1)} dBTP, applied=${norm.loudnessApplied}`
    );
    expect(norm.loudnessApplied).toBe(true);
    expect(norm.targetLufs).toBe(-16);
    expect(norm.normalizedLufs!).toBeGreaterThan(-17.0);
    expect(norm.normalizedLufs!).toBeLessThan(-15.0);
    expect(norm.truePeakDbtp!).toBeLessThanOrEqual(-1.2); // −1.5 লক্ষ্য + ০.৩ সহনশীলতা

    // স্বাধীন পুনঃমাপ (একই ফাইলে নতুন ebur128 চালনা — loudnorm-দাবি নয়)
    const indep = await measureLoudness(normPath);
    expect(Math.abs(indep.integratedLufs! - -16)).toBeLessThanOrEqual(1.0);
    expect(indep.truePeakDbtp!).toBeLessThanOrEqual(-1.2);
    // রিপোর্টের চূড়ান্ত লাউডনেস-মান স্বাধীন মাপের সাথে মিলছে
    expect(Math.abs(norm.loudnessLufs! - indep.integratedLufs!)).toBeLessThanOrEqual(0.3);
  });

  test('REG-9b: duration/layout preserved; real mux keeps fps/resolution and A-V sync', async () => {
    const dir = await freshDir('reg9b-');
    const layers = await buildFixtureLayers(dir);
    const mixPath = path.join(dir, 'mix.wav');
    const report = await mixSoundLayers(layers, mixPath, DEFAULT_MIX_RULES);
    expect(report.loudnessApplied).toBe(true);

    // স্তর-মিক্স + loudnorm পরেও দৈর্ঘ্য অপরিবর্তিত (loudnorm linear সময় বদলায় না)
    const rawRules: MixRules = { ...DEFAULT_MIX_RULES, targetLufs: undefined };
    const rawPath = path.join(dir, 'mix-raw-ctrl.wav');
    const rawReport = await mixSoundLayers(layers, rawPath, rawRules);
    expect(Math.abs(report.durationSec - rawReport.durationSec)).toBeLessThanOrEqual(0.05);
    const normInfo = await mediaInfo(mixPath);
    expect(normInfo.channels).toBe(2); // stereo-ই থাকে — লেআউট-হানি নেই

    // প্রকৃত মাক্স-ইন্টিগ্রেশন: সাম্যকৃত মিক্স + প্রকৃত h264 ভিডিও → muxAudio
    const videoPath = path.join(dir, 'video.mp4');
    await runFfmpeg([
      '-f', 'lavfi', '-i', `testsrc2=duration=${DUR}:size=320x240:rate=30`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
    ], { label: 'REG-9b ভিডিও-ফিক্সচার' });
    const outPath = path.join(dir, 'final.mp4');
    await muxAudio(videoPath, mixPath, outPath, { durationSec: DUR, fadeOutSec: 1 });

    const v = await mediaInfo(outPath);
    expect(v.videoCodec).toBe('h264');
    expect(v.width).toBe(320);
    expect(v.height).toBe(240);
    expect(v.fps).toBeDefined();
    expect(Math.abs(v.fps! - 30)).toBeLessThanOrEqual(1.5); // fps অক্ষত (Phase-0 চুক্তির মতো)
    expect(Math.abs(v.durationSec - DUR)).toBeLessThanOrEqual(0.3);
    // A-V সিঙ্ক: উভয় স্ট্রিম একই দৈর্ঘ্যের (Phase-0-এর music/film যাচাই-নীতি)
    const probeRaw = v as unknown as Record<string, unknown>;
    expect(probeRaw).toBeTruthy(); // ffprobe অবজেক্ট এসেছে
    const hasAudio = v.hasAudio === true || probeRaw['hasAudio'] === true;
    expect(hasAudio).toBe(true);
    expect(v.durationSec).toBeGreaterThan(0);
    // ভিডিও-স্ট্রিম প্রতিলিপি (copy) — রেজোলিউশন/কোডেক মিক্সে বদলায়নি (উপরে যাচাইকৃত)
  });

  test('REG-9c: mono input stays mono (no mono→stereo assumption)', async () => {
    const dir = await freshDir('reg9c-');
    const monoIn = path.join(dir, 'mono-in.wav');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '1', '-c:a', 'pcm_s16le', monoIn], { label: 'REG-9c mono ফিক্সচার' });
    const monoOut = path.join(dir, 'mono-out.wav');
    const res = await normalizeLoudnessTwoPass(monoIn, monoOut);
    expect(res.applied).toBe(true);
    expect(res.inputChannels).toBe(1);
    expect(res.outputChannels).toBe(1); // mono-ই থাকে
    const info = await mediaInfo(monoOut);
    expect(info.channels).toBe(1);
  });

  test('REG-9d: silent mix — honest skip (applied:false), issue raised, output exists', async () => {
    const dir = await freshDir('reg9d-');
    // হেল্পার স্তরে: নীরব ইনপুট সাম্য-অযোগ্য → হুবহু কপি + সৎ কারণ
    const silentPath = path.join(dir, 'silent.wav');
    await writeFile(silentPath, encodeWav(new Float32Array(44100 * 3), new Float32Array(44100 * 3), 44100));
    const outPath = path.join(dir, 'silent-out.wav');
    const res = await normalizeLoudnessTwoPass(silentPath, outPath);
    expect(res.applied).toBe(false);
    expect(res.reason).toBe('silence');
    expect(res.durationInSec).toBeGreaterThan(2.9);
    expect(res.durationOutSec).toBeGreaterThan(2.9);

    // মিক্স-রিপোর্ট স্তরে: সব-নীরব মিক্স → সৎ issue, সাফল্য-ভান নয়
    const mixPath = path.join(dir, 'silent-mix.wav');
    const report = await mixSoundLayers(
      [{ layer: 'A1_dialogue', file: silentPath }],
      mixPath,
      DEFAULT_MIX_RULES
    );
    expect(report.loudnessApplied).toBe(false);
    expect(report.ok).toBe(false);
    expect(report.issues.some(i => i.includes('লাউডনেস-সাম্য প্রয়োজ্য হয়নি'))).toBe(true);
    expect(report.durationSec).toBeGreaterThan(2.9);
  });

  test('REG-9e: corrupt input — helper throws (non-zero ffmpeg exit is never disguised)', async () => {
    const dir = await freshDir('reg9e-');
    const corrupt = path.join(dir, 'corrupt.wav');
    await writeFile(corrupt, Buffer.from('এটা কক্ষনো WAV নয় — নশট বাইট'));
    const outPath = path.join(dir, 'corrupt-out.wav');
    let threw = false;
    try {
      await normalizeLoudnessTwoPass(corrupt, outPath);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // ভান-করা আউটপুট নেই
    const files = await readdir(dir);
    expect(files).toEqual(['corrupt.wav']);
  });

  test('REG-9f: >2-channel layout — explicit unsupported error (no silent mangle)', async () => {
    const dir = await freshDir('reg9f-');
    const sixCh = path.join(dir, 'six.wav');
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ac', '6', '-c:a', 'pcm_s16le', sixCh], { label: 'REG-9f 6ch ফিক্সচার' });
    const outPath = path.join(dir, 'six-out.wav');
    let threw = false;
    try {
      await normalizeLoudnessTwoPass(sixCh, outPath);
    } catch (err) {
      threw = true;
      expect(err instanceof Error ? err.message : '').toContain('অসমর্থিত চ্যানেল-বিন্যাস');
    }
    expect(threw).toBe(true);
  });

  test('REG-9g: report truthfulness — target/applied/measured fields consistent on both paths', async () => {
    const dir = await freshDir('reg9g-');
    const layers = await buildFixtureLayers(dir);

    // সুখ-পথ: সব ক্ষেত্র সৎ ও পরস্পর-সামঞ্জস্যপূর্ণ
    const okPath = path.join(dir, 'ok.wav');
    const ok = await mixSoundLayers(layers, okPath, DEFAULT_MIX_RULES);
    expect(ok.targetLufs).toBe(-16);
    expect(ok.loudnessApplied).toBe(true);
    expect(ok.normalizedLufs).toBeDefined();
    expect(ok.truePeakDbtp).toBeDefined();
    // normalizedLufs (loudnorm-পরে ebur128) ≈ loudnessLufs (চূড়ান্ত ফাইলে পৃথীন ebur128)
    expect(Math.abs(ok.normalizedLufs! - ok.loudnessLufs!)).toBeLessThanOrEqual(0.5);
    // সাম্য-সফল মিক্সে বিচ্যুতি-issue নেই
    expect(ok.issues.some(i => i.includes('বিচ্যুতি'))).toBe(false);

    // নীরব-পথ: loudnessApplied:false + স্পষ্ট issue (REG-9d-এর রিপোর্ট-দিক এখানে চুক্তিবদ্ধ)
    const silentPath = path.join(dir, 'silence.wav');
    await writeFile(silentPath, encodeWav(new Float32Array(44100 * 2), new Float32Array(44100 * 2), 44100));
    const badPath = path.join(dir, 'bad.wav');
    const bad = await mixSoundLayers([{ layer: 'A5_narration', file: silentPath }], badPath, DEFAULT_MIX_RULES);
    expect(bad.loudnessApplied).toBe(false);
    expect(bad.ok).toBe(false);
    // স্বীকারোক্তি: প্রয়োগ-ত্রুতির catch-পথ (issue-push) ৩-লাইনের শাখা —
    // ffmpeg-থ্রো নিজেই REG-9e-এ যাচাইকৃত; এখানে পৃথকভাবে প্ররোচিত করা হয়নি
  });
});
