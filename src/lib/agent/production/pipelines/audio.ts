// ============================================================
// Audio pipeline — মাস্টার প্ল্যান §৪: ভয়েসওভার প্রোডাকশন।
// প্রকারভেদে তিনটি পথ:
//   - voiceover (ডিফল্ট): স্ক্রিপ্ট → খণ্ড-বিভাজন → TTS → মাস্টারিং
//     (concat + loudnorm -16 LUFS) → যাচাই → wav+mp3 artifact
//   - music_plan: plan_music-এর যুক্তি ইনলাইনে চালিয়ে টেক্সট-দলিল artifact
//   - process: আপলোড করা উৎস-অডিও মাস্টারিং ও যাচাই
// ব্যর্থ অংশ partialNotes-এ লেখা হয় — বাকিগুলো দিয়েই কাজ এগোয়।
// ============================================================

import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import type { VoicePreset } from '@/lib/types';
import { runFfmpeg, mediaInfo, audioQuality } from '@/lib/media/ffmpeg';
import type { PipelineContext, PipelineFn, PipelineResult, StepHandle } from '../runner';
import { synthesizeSpeech } from '../../sdk-helpers';
import type { SpeechResult } from '../../sdk-helpers';
import { planMusicContent, chunkScriptForTts, toBn, fmtDb, slugifyTitle, measureLoudnessPrecise } from '../../tools/audio';

// ------------------------------------------------------------
// শেয়ার্ড মাস্টারিং + যাচাই
// ------------------------------------------------------------

/** অংশগুলো জোড়া (প্রয়োজনে) → loudnorm (-16 LUFS) → master.wav + master.mp3 */
async function buildMaster(
  step: StepHandle,
  files: string[],
  workingDir: string
): Promise<{ masterWav: string; masterMp3: string; durationSec: number }> {
  await step.setDetail(`${toBn(files.length)}টি অংশ জোড়া ও loudnorm নরমালাইজেশন (−১৬ LUFS)`);
  const masterWav = path.join(workingDir, 'master.wav');
  const masterMp3 = path.join(workingDir, 'master.mp3');

  const inputs: string[] = [];
  for (const f of files) inputs.push('-i', f);
  const AF = 'aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo';
  let filter: string;
  if (files.length === 1) {
    filter = `[0:a]${AF},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[aout]`;
  } else {
    const pre = files.map((_, i) => `[${i}:a]${AF}[c${i}]`).join(';');
    const labels = files.map((_, i) => `[c${i}]`).join('');
    filter = `${pre};${labels}concat=n=${files.length}:v=0:a=1[cat];[cat]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[aout]`;
  }
  await runFfmpeg(
    [...inputs, '-filter_complex', filter, '-map', '[aout]', '-c:a', 'pcm_s16le', masterWav],
    { label: 'মাস্টারিং', timeoutMs: 240_000 }
  );
  await runFfmpeg(['-i', masterWav, '-c:a', 'libmp3lame', '-b:a', '192k', masterMp3], {
    label: 'MP3 এনকোড',
    timeoutMs: 120_000,
  });
  const info = await mediaInfo(masterWav);
  return { masterWav, masterMp3, durationSec: info.durationSec };
}

/**
 * মাস্টার অডিওর গুণমান যাচাই (দৈর্ঘ্য > 0, পিক ≤ −0.1dB, স্যাম্পল-রেট
 * 44100/48000) ও wav+mp3 উভয় artifact নিবন্ধন। রায়ের এক-লাইন ফেরত দেয়।
 */
async function validateAndRegister(
  ctx: PipelineContext,
  masterWav: string,
  masterMp3: string,
  slug: string,
  meta: Record<string, unknown>
): Promise<string> {
  const q = await audioQuality(masterWav);
  if (!(q.durationSec > 0)) {
    throw new Error('মাস্টার অডিওর দৈর্ঘ্য শূন্য এসেছে — এনকোডিং সমস্যা।');
  }
  const clipping = Number.isFinite(q.peakDb) && (q.peakDb as number) > -0.1;
  if (clipping) {
    ctx.partialNotes.push(`ক্লিপিং-ঝুঁকি: পিক ${fmtDb(q.peakDb)} (loudnorm সত্ত্বেও −০.১ ডিবির ওপরে)।`);
  }
  if (q.sampleRate && ![44100, 48000].includes(q.sampleRate)) {
    ctx.partialNotes.push(`স্যাম্পল-রেট ${toBn(q.sampleRate)} Hz — প্রত্যাশিত 44100/48000 নয়।`);
  }

  const wavBuf = await readFile(masterWav);
  const mp3Buf = await readFile(masterMp3);
  const loudnessLufs = (await measureLoudnessPrecise(masterWav)) ?? q.loudnessLufs ?? null;
  await ctx.registerArtifact({
    buffer: wavBuf,
    kind: 'audio',
    mimeType: 'audio/wav',
    fileName: `${slug}.wav`,
    metaJson: {
      ...meta,
      durationSec: q.durationSec,
      loudnessLufs,
      peakDb: Number.isFinite(q.peakDb) ? q.peakDb : null,
      silenceCount: q.silenceRanges.length,
    },
  });
  await ctx.registerArtifact({
    buffer: mp3Buf,
    kind: 'audio',
    mimeType: 'audio/mpeg',
    fileName: `${slug}.mp3`,
    metaJson: { ...meta, durationSec: q.durationSec, bitrate: '192k' },
  });

  if (clipping) return 'ক্লিপিং-ঝুঁকি';
  if (q.silenceRanges.length > 0) return `শোনার যোগ্য, তবে ${toBn(q.silenceRanges.length)}টি নীরব-অংশ আছে`;
  return 'শোনার যোগ্য — কোনো সমস্যা পাওয়া যায়নি';
}

// ------------------------------------------------------------
// পথ ১: ভয়েসওভার (ডিফল্ট)
// ------------------------------------------------------------

async function runVoiceover(ctx: PipelineContext): Promise<PipelineResult> {
  const voice: VoicePreset = ctx.spec.voice ?? 'tongtong';

  // --- prepare: স্ক্রিপ্ট যাচাই ও ≤950-অক্ষর অংশে ভাগ ---
  const chunks = await ctx.runStep('prepare', 'স্ক্রিপ্ট প্রস্তুত', async step => {
    const text = (ctx.spec.text ?? '').trim();
    if (!text) {
      throw new Error('ভয়েসওভার স্ক্রিপ্ট (text) খালি — কণ্ঠ তৈরির জন্য লেখা দরকার।');
    }
    const parts = chunkScriptForTts(text, 950);
    if (parts.length === 0) {
      throw new Error('স্ক্রিপ্ট থেকে উচ্চারণযোগ্য কোনো অংশ পাওয়া যায়নি।');
    }
    await step.setDetail(`স্ক্রিপ্ট ${toBn(text.length)} অক্ষর → ${toBn(parts.length)}টি অংশ`);
    return parts;
  });

  // --- synthesize: প্রতি অংশে TTS (একবার পুনঃচেষ্টাসহ) ---
  const chunkFiles = await ctx.runStep('synthesize', 'কণ্ঠ সংশ্লেষণ', async step => {
    const files: string[] = [];
    let done = 0;
    for (const [idx, text] of chunks.entries()) {
      await ctx.checkCancelled();
      let speech: SpeechResult | null = null;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          speech = await synthesizeSpeech(text, voice);
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!speech) {
        const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
        ctx.partialNotes.push(`অংশ ${toBn(idx + 1)}/${toBn(chunks.length)} সংশ্লেষণ ব্যর্থ: ${msg.slice(0, 180)}`);
        continue;
      }
      const file = path.join(ctx.workingDir, `chunk-${String(idx + 1).padStart(2, '0')}.${speech.ext}`);
      await writeFile(file, speech.buffer);
      try {
        const info = await mediaInfo(file);
        if (!(info.durationSec > 0)) throw new Error('অডিওর দৈর্ঘ্য শূন্য');
        files.push(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.partialNotes.push(`অংশ ${toBn(idx + 1)} ত্রুটিপূর্ণ: ${msg.slice(0, 140)}`);
        continue;
      }
      done++;
      await step.setDetail(`${toBn(done)}/${toBn(chunks.length)} অংশ সম্পন্ন`);
    }
    if (files.length === 0) {
      throw new Error('কোনো অংশই সংশ্লেষণ করা যায়নি — TTS পরিষেবা সাময়িকভাবে ব্যর্থ মনে হচ্ছে। একটু পরে আবার চেষ্টা করো।');
    }
    if (files.length < chunks.length) {
      await step.setDetail(`${toBn(files.length)}/${toBn(chunks.length)} অংশ সফল (বাকিগুলো স্কিপ)`);
    }
    return files;
  });

  // --- master: concat + loudnorm → master.wav + master.mp3 ---
  const master = await ctx.runStep('master', 'মাস্টারিং ও নরমালাইজেশন', step =>
    buildMaster(step, chunkFiles, ctx.workingDir)
  );

  // --- validate: গুণমান যাচাই + উভয় ফরম্যাটে artifact ---
  const verdict = await ctx.runStep('validate', 'গুণমান যাচাই ও রপ্তানি', async () => {
    const slug = slugifyTitle(ctx.spec.title || 'voiceover');
    return validateAndRegister(ctx, master.masterWav, master.masterMp3, slug, {
      voice,
      chunks: chunkFiles.length,
      targetDurationSec: ctx.spec.durationSec ?? null,
    });
  });

  const target = ctx.spec.durationSec ?? null;
  return {
    result: {
      quality: `${verdict}; দৈর্ঘ্য ${toBn(master.durationSec.toFixed(1))} সেকেন্ড${
        target ? ` (লক্ষ্য ${toBn(target)} সে.)` : ''
      }, ${toBn(chunkFiles.length)}টি অংশ, কণ্ঠ ${voice}`,
      durationSec: master.durationSec,
      chunks: chunkFiles.length,
      voice,
      targetDurationSec: target,
    },
  };
}

// ------------------------------------------------------------
// পথ ২: গানের কাঠামো-পরিকল্পনা (music_plan)
// ------------------------------------------------------------

async function runMusicPlan(ctx: PipelineContext): Promise<PipelineResult> {
  const idea = (ctx.spec.text ?? ctx.spec.idea ?? '').trim();

  await ctx.runStep('prepare', 'ভাবনা বিশ্লেষণ', async step => {
    if (!idea) {
      throw new Error('গানের আইডিয়া খালি — text বা idea ক্ষেত্রে কিছু লেখা দরকার।');
    }
    await step.setDetail(`আইডিয়া: ${idea.length > 120 ? idea.slice(0, 119) + '…' : idea}`);
  });

  const plan = await ctx.runStep('plan', 'গানের কাঠামো ও লিরিক্স পরিকল্পনা', async step => {
    await step.setDetail('কাঠামো, লিরিক্স ও বাদ্যযন্ত্র-নির্দেশনা তৈরি হচ্ছে');
    const { plan: musicPlan, document } = await planMusicContent(idea, {
      durationSec: ctx.spec.durationSec,
    });
    await ctx.registerArtifact({
      buffer: Buffer.from(document, 'utf-8'),
      kind: 'text',
      mimeType: 'text/plain',
      fileName: 'song-plan.txt',
      metaJson: {
        planTitle: musicPlan.title,
        sections: musicPlan.songSections.length,
        tempoBpm: musicPlan.tempoBpm,
        key: musicPlan.key,
      },
    });
    return musicPlan;
  });

  return {
    result: {
      quality: `গানের কাঠামো-পরিকল্পনা তৈরি: ${plan.title} — ${toBn(plan.songSections.length)}টি সেকশন, ${toBn(
        plan.tempoBpm
      )} BPM, স্কেল ${plan.key}`,
      title: plan.title,
      tempoBpm: plan.tempoBpm,
      key: plan.key,
      sections: plan.songSections.length,
    },
  };
}

// ------------------------------------------------------------
// পথ ৩: উৎস-অডিও মাস্টারিং (process)
// ------------------------------------------------------------

async function runProcess(ctx: PipelineContext): Promise<PipelineResult> {
  const ids = ctx.spec.sourceAudioArtifactIds ?? [];

  const files = await ctx.runStep('prepare', 'উৎস-অডিও প্রস্তুত', async step => {
    if (ids.length === 0) {
      throw new Error('process কাজে sourceAudioArtifactIds-এ অন্তত একটি অডিও artifact আইডি দরকার।');
    }
    const files: string[] = [];
    for (const [i, id] of ids.entries()) {
      const p = await ctx.resolveArtifactFile(id);
      const info = await mediaInfo(p);
      if (!info.hasAudio) {
        throw new Error(`${toBn(i + 1)} নম্বর উৎস-ফাইলে কোনো অডিও স্ট্রিম নেই।`);
      }
      files.push(p);
    }
    await step.setDetail(`${toBn(files.length)}টি উৎস-অডিও যাচাই সম্পন্ন`);
    return files;
  });

  const master = await ctx.runStep('master', 'মাস্টারিং ও নরমালাইজেশন', step =>
    buildMaster(step, files, ctx.workingDir)
  );

  const verdict = await ctx.runStep('validate', 'গুণমান যাচাই ও রপ্তানি', async () => {
    const slug = slugifyTitle(ctx.spec.title || 'audio-master');
    return validateAndRegister(ctx, master.masterWav, master.masterMp3, slug, {
      sources: files.length,
      sourceArtifactIds: ids,
    });
  });

  return {
    result: {
      quality: `${verdict}; দৈর্ঘ্য ${toBn(master.durationSec.toFixed(1))} সেকেন্ড, ${toBn(
        files.length
      )}টি উৎস-ফাইল মাস্টার করা হয়েছে`,
      durationSec: master.durationSec,
      sources: files.length,
    },
  };
}

// ------------------------------------------------------------
// প্রবেশদ্বার — audioOperation অনুযায়ী পথ-নির্বাচন
// ------------------------------------------------------------

export const audioPipeline: PipelineFn = async ctx => {
  const op = ctx.spec.audioOperation ?? 'voiceover';
  if (op === 'music_plan') return runMusicPlan(ctx);
  if (op === 'process') return runProcess(ctx);
  return runVoiceover(ctx);
};
