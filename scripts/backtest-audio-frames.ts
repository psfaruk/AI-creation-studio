// ============================================================
// scripts/backtest-audio-frames.ts
// মিউজিক-ইঞ্জিন v2 + লোকাল-ফ্রেম v2-এর ভৌত ব্যাকটেস্ট।
//
// চালানো: bun scripts/backtest-audio-frames.ts
//
// যাচাই করে:
//  A) মিউজিক v2 — ৬ মুড × সংশ্লেষণ: সময়, ffprobe যাচাই, LUFS/পিক,
//     নীরবতা-অনুপস্থিতি, নির্ধারকতা (একই seed → অভিন্ন বাইট)
//  B) লোকাল-ফ্রেম v2 — ৬ মুড × ২ মাত্রা (ল্যান্ডস্কেপ+পোর্ট্রেট):
//     সময় (~০.৪ সে. লক্ষ্য), নির্ধারকতা (sha256), কাঠামো-মেট্রিক
//     (sobel-প্রান্ত-গড় — v1-এর প্রায়-শূন্য মানের বিপরীতে)
// ============================================================
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFileCb);

async function sha256(file: string): Promise<string> {
  const buf = await readFile(file);
  return createHash('sha256').update(buf).digest('hex');
}

/** ffmpeg signalstats: YMIN/YMAX/YAVG (এবং ঐচ্ছিক sobel-প্রান্ত-গড়) */
async function frameStats(file: string): Promise<{ ymin: number; ymax: number; yavg: number; edge: number }> {
  async function run(graphSuffix: string): Promise<string> {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      ['-hide_banner', '-i', file, ...graphSuffix.split(' '), '-f', 'null', '-'],
      { timeout: 60_000 }
    ).catch(async e => {
      throw new Error(`frameStats ব্যর্থ: ${String(e.stderr).slice(0, 300)}`);
    });
    return String(stdout);
  }
  // সরাসরি মেট্রিক: -vf দিয়ে দুটি পাস
  const { stderr } = await execFileAsync(
    'ffmpeg',
    ['-hide_banner', '-v', 'info', '-i', file,
     '-vf', 'format=gray,sobel,signalstats,metadata=print',
     '-f', 'null', '-'],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }
  );
  const edgeAvg = Number(/lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(stderr)?.[1] ?? '0');
  const { stderr: s2 } = await execFileAsync(
    'ffmpeg',
    ['-hide_banner', '-v', 'info', '-i', file, '-vf', 'signalstats,metadata=print', '-f', 'null', '-'],
    { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }
  );
  const pick = (k: string) => Number(new RegExp(`lavfi\\.signalstats\\.${k}=([0-9.]+)`).exec(s2)?.[1] ?? '0');
  return { ymin: pick('YMIN'), ymax: pick('YMAX'), yavg: pick('YAVG'), edge: edgeAvg };
}

async function ffprobeAudio(file: string): Promise<{ dur: number; sr: number; ch: number }> {
  const { stdout } = await execFileAsync(
    'ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels:format=duration',
                 '-of', 'default=noprint_wrappers=1', file],
    { timeout: 30_000 }
  );
  const dur = Number(/duration=([0-9.]+)/.exec(stdout)?.[1] ?? '0');
  const sr = Number(/sample_rate=([0-9]+)/.exec(stdout)?.[1] ?? '0');
  const ch = Number(/channels=([0-9]+)/.exec(stdout)?.[1] ?? '0');
  return { dur, sr, ch };
}

async function main(): Promise<void> {
  const { synthesizeInstrumental, validateInstrumental } = await import(
    '../src/lib/agent/audio/music_engine'
  );
  const { generateLocalFrame, LOCAL_FRAME_LABEL } = await import('../src/lib/agent/local-frames');

  console.log('=== A) মিউজিক-ইঞ্জিন v2 ব্যাকটেস্ট ===');
  const moods = ['sad', 'romantic', 'joyful', 'suspense', 'action', 'peaceful'] as const;
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'music-v2-'));
  let allOk = true;
  try {
    for (const mood of moods) {
      const t0 = Date.now();
      const res = await synthesizeInstrumental({ mood, durationSec: 20, seed: 424242 });
      const synthMs = Date.now() - t0;
      const wav = path.join(tmp, `${mood}.wav`);
      const { writeFile } = await import('fs/promises');
      await writeFile(wav, res.buffer);
      const probe = await ffprobeAudio(wav);
      const val = await validateInstrumental(res.buffer, res.meta);
      const secNames = res.meta.sections.map(s => s.name).join('→');
      const durOk = Math.abs(probe.dur - res.meta.durationSec) < 0.3;
      const ok = val.ok && durOk && probe.sr === 44100 && probe.ch === 2;
      if (!ok) allOk = false;
      console.log(
        `${ok ? '✅' : '❌'} ${mood.padEnd(9)} সংশ্লেষণ=${(synthMs / 1000).toFixed(1)}s ` +
        `দৈর্ঘ্য=${probe.dur.toFixed(1)}s (টার্গেট ${res.meta.durationSec}) ` +
        `bpm=${res.meta.tempoBpm} সেকশন=${secNames} ` +
        `LUFS=${val.loudnessLufs?.toFixed(1) ?? '?'}dB পিক=${val.peakDb?.toFixed(1) ?? '?'}dB ` +
        `${val.issues.length ? 'সমস্যা: ' + val.issues.join('; ') : ''}`
      );
    }
    // নির্ধারকতা: একই seed → অভিন্ন বাইট
    const a = await synthesizeInstrumental({ mood: 'romantic', durationSec: 12, seed: 777 });
    const b = await synthesizeInstrumental({ mood: 'romantic', durationSec: 12, seed: 777 });
    const c = await synthesizeInstrumental({ mood: 'romantic', durationSec: 12, seed: 778 });
    const h = (x: Buffer) => createHash('sha256').update(x).digest('hex').slice(0, 16);
    const detOk = h(a.buffer) === h(b.buffer) && h(a.buffer) !== h(c.buffer);
    if (!detOk) allOk = false;
    console.log(`${detOk ? '✅' : '❌'} নির্ধারকতা: একই seed=${h(a.buffer)} ভিন্ন seed=${h(c.buffer)}`);

    console.log('\n=== B) লোকাল-ফ্রেম v2 ব্যাকটেস্ট ===');
    console.log(`লেবেল: ${LOCAL_FRAME_LABEL}`);
    const dims: Array<[number, number]> = [[1280, 720], [720, 1280]];
    let frameOk = true;
    for (const mood of moods) {
      for (const [W, H] of dims) {
        const out = path.join(tmp, `f-${mood}-${W}x${H}.png`);
        const t0 = Date.now();
        const r = await generateLocalFrame({
          seed: `bt-${mood}`,
          width: W,
          height: H,
          outputPath: out,
          mood,
        });
        const ms = Date.now() - t0;
        const st = await frameStats(out);
        // কাঠামো-ন্যূনতম: প্রান্ত-গড় ≥ ১.৫ (v1 ছিল ~০), পূর্ণ-কালো/সাদা নয়
        const ok = st.edge >= 1.5 && st.ymin < 60 && st.ymax > 180 && ms < 15_000;
        if (!ok) frameOk = false;
        console.log(
          `${ok ? '✅' : '❌'} ${mood.padEnd(9)} ${W}x${H} ${ms}ms ` +
          `প্রান্ত-গড়=${st.edge.toFixed(1)} Y[${st.ymin.toFixed(0)}..${st.ymax.toFixed(0)}] গড়=${st.yavg.toFixed(0)} ` +
          `স্তর=${r.layers.length}`
        );
      }
    }
    // নির্ধারকতা
    const d1 = path.join(tmp, 'det-a.png');
    const d2 = path.join(tmp, 'det-b.png');
    const d3 = path.join(tmp, 'det-c.png');
    await generateLocalFrame({ seed: 'det', width: 640, height: 360, outputPath: d1, mood: 'sad' });
    await generateLocalFrame({ seed: 'det', width: 640, height: 360, outputPath: d2, mood: 'sad' });
    await generateLocalFrame({ seed: 'det2', width: 640, height: 360, outputPath: d3, mood: 'sad' });
    const s1 = await sha256(d1);
    const s2 = await sha256(d2);
    const s3 = await sha256(d3);
    const detOk2 = s1 === s2 && s1 !== s3;
    if (!detOk2) frameOk = false;
    console.log(`${detOk2 ? '✅' : '❌'} নির্ধারকতা: একই seed=${s1.slice(0, 16)} ভিন্ন seed=${s3.slice(0, 16)}`);

    console.log(`\n=== ফলাফল: মিউজিক ${allOk ? 'সব ✅' : '❌ সমস্যা আছে'} · ফ্রেম ${frameOk ? 'সব ✅' : '❌ সমস্যা আছে'} ===`);
    process.exitCode = allOk && frameOk ? 0 : 1;
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

void main();
