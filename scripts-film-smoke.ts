// film-helpers স্থানীয় স্মোক-টেস্ট (রং-ব্লক ছবি দিয়ে, কোনো AI কল নেই)
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import {
  kenBurnsClip,
  concatClips,
  mixAudioTracks,
  generateAmbientBed,
  burnSubtitles,
  muxAudio,
  makeSrt,
  sanitize,
  imagePromptForShot,
  nearestAspect,
  normalizeShotDurations,
} from './src/lib/agent/film-helpers';
import { mediaInfo, runFfmpeg } from './src/lib/media/ffmpeg';

const dir = '/tmp/film-smoke';
await mkdir(dir, { recursive: true });

// ১. রং-ব্লক ছবি
const colors = [[30, 90, 60], [140, 60, 30], [40, 60, 140], [160, 140, 40], [90, 30, 90], [30, 140, 130], [120, 120, 30]];
const imgs: string[] = [];
for (let i = 0; i < colors.length; i++) {
  const p = path.join(dir, `base-${i}.png`);
  await sharp({ create: { width: 1344, height: 768, channels: 3, background: { r: colors[i][0], g: colors[i][1], b: colors[i][2] } } })
    .png()
    .toFile(p);
  imgs.push(p);
}
console.log('✓ ছবি তৈরি:', imgs.length);

// ২. Ken Burns — সব মুভ ভ্যারিয়েন্ট
const moves = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'] as const;
const clips: string[] = [];
for (let i = 0; i < 5; i++) {
  const out = path.join(dir, `kb-${moves[i]}.mp4`);
  const r = await kenBurnsClip(imgs[i], out, { durationSec: 3, fps: 24, width: 1280, height: 720, move: moves[i] });
  console.log(`✓ kenBurns ${moves[i]}: dur=${r.durationSec} ${r.width}x${r.height}@${r.fps}`);
  clips.push(out);
}
// ভগ্নাংশ-দৈর্ঘ্য পরীক্ষা (২.৫ সে.)
const odd = await kenBurnsClip(imgs[5], path.join(dir, 'kb-odd.mp4'), { durationSec: 2.5, fps: 24, width: 720, height: 1280, move: 'zoom_in' });
console.log(`✓ kenBurns ভগ্নাংশ: dur=${odd.durationSec} ${odd.width}x${odd.height}`);

// ৩. xfade কনক্যাট (৫ ক্লিপ)
const concatOut = path.join(dir, 'concat-xfade.mp4');
await concatClips(clips, concatOut, { transitionSec: 0.5 });
const ci = await mediaInfo(concatOut);
console.log(`✓ concat xfade(৫): dur=${ci.durationSec} (প্রত্যাশা ≈ ${5 * 3 - 4 * 0.5}=13) ${ci.width}x${ci.height}`);

// ৪. >৬ ক্লিপ — concat demuxer পথ
const manyClips: string[] = [];
for (let i = 0; i < 7; i++) {
  const out = path.join(dir, `many-${i}.mp4`);
  await kenBurnsClip(imgs[i % imgs.length], out, { durationSec: 2, fps: 24, width: 640, height: 360, move: 'static' });
  manyClips.push(out);
}
const manyOut = path.join(dir, 'concat-many.mp4');
await concatClips(manyClips, manyOut, { transitionSec: 0.4 });
const mi = await mediaInfo(manyOut);
console.log(`✓ concat demuxer(৭): dur=${mi.durationSec} (প্রত্যাশা ≈ 14) ${mi.width}x${mi.height}`);

// ৫. একক ক্লিপ → কপি
const single = path.join(dir, 'concat-single.mp4');
await concatClips([clips[0]], single, { transitionSec: 0.5 });
console.log('✓ concat একক-কপি');

// ৬. পরিবেশ-শব্দ
const amb = path.join(dir, 'ambient.wav');
await generateAmbientBed(amb, 13);
const ai = await mediaInfo(amb);
console.log(`✓ ambient: dur=${ai.durationSec} sr=${ai.sampleRate} ch=${ai.channels}`);

// ৭. নকল ভয়েস (sine beep ২ সেকেন্ড)
const voice = path.join(dir, 'voice.wav');
await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', voice], { label: 'টেস্ট-ভয়েস' });

// ৮. মিক্স — ভয়েস adelay=1s + ambient + ducking
const mixed = path.join(dir, 'mixed.wav');
const mixedPath = await mixAudioTracks({
  voiceFiles: [{ file: voice, startSec: 1 }],
  ambient: true,
  durationSec: 13,
  outputPath: mixed,
  duck: true,
});
const mxi = await mediaInfo(mixedPath!);
console.log(`✓ মিক্স (duck): dur=${mxi.durationSec} sr=${mxi.sampleRate} ch=${mxi.channels}`);

// ৯. মিক্স — শুধু ভয়েস, ducking নেই (বেড নেই এমন নয় — ambient false, music নেই)
const mixed2 = path.join(dir, 'mixed2.wav');
const r2 = await mixAudioTracks({ voiceFiles: [{ file: voice, startSec: 0 }], ambient: false, durationSec: 5, outputPath: mixed2, duck: false });
const mxi2 = await mediaInfo(r2!);
console.log(`✓ মিক্স (শুধু ভয়েস): dur=${mxi2.durationSec}`);

// ১০. কোনো অডিও নেই → null
const r3 = await mixAudioTracks({ voiceFiles: [], ambient: false, durationSec: 5, outputPath: path.join(dir, 'x.wav'), duck: false });
console.log('✓ শূন্য-মিক্স →', r3);

// ১১. মাক্স (ভিডিও+অডিও)
const muxed = path.join(dir, 'muxed.mp4');
await muxAudio(concatOut, mixed!, muxed, { durationSec: 13, fadeOutSec: 1 });
const muxi = await mediaInfo(muxed);
console.log(`✓ মাক্স: dur=${muxi.durationSec} hasAudio=${muxi.hasAudio} codec=${muxi.audioCodec}`);

// ১২. বাংলা সাবটাইটেল বার্ন
const srt = path.join(dir, 'subs.srt');
await writeFile(srt, makeSrt([
  { start: 0.5, end: 2.5, text: 'ঘুড়ি ওড়ে আকাশে' },
  { start: 3.0, end: 5.0, text: 'ছেলেটি হাসছে — খুশিতে' },
  { start: 5.5, end: 7.5, text: '"আরও উঁচুতে ওড়ো!"' },
]), 'utf-8');
const subbed = path.join(dir, 'subbed.mp4');
await burnSubtitles(muxed, srt, subbed);
const si = await mediaInfo(subbed);
console.log(`✓ সাবটাইটেল-বার্ন: dur=${si.durationSec} ${si.width}x${si.height} hasAudio=${si.hasAudio}`);

// ১৩. ইউটিলিটি
console.log('✓ sanitize:', sanitize('ঘুড়ির গল্প — A Kite Story!!'));
console.log('✓ imagePromptForShot:', imagePromptForShot({ description: 'A boy flying a kite' }, 'watercolor').slice(0, 80) + '…');
console.log('✓ nearestAspect(1344,768):', nearestAspect(1344, 768), '| (768,1344):', nearestAspect(768, 1344), '| (1000,1000):', nearestAspect(1000, 1000));
const shots = [{ durationSec: 3 }, { durationSec: 4 }, { durationSec: 5 }];
normalizeShotDurations(shots, 18);
console.log('✓ normalizeShotDurations(→18):', shots.map(s => s.durationSec).join(','));

console.log('\nসব স্মোক-টেস্ট পাস ✅');
