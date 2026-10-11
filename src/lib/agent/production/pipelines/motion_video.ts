// ============================================================
// Motion video pipeline — মাস্টার প্ল্যান §৫.১/৫.২
// পরিকল্পনা → স্টোরিবোর্ড (AI ফ্রেম) → Ken Burns মোশন →
// অ্যাসেম্বলি (+ ভয়েসওভার/পরিবেশ-শব্দ) → যাচাই।
// সৎ পদ্ধতি: ডিফিউশন ভিডিও নয় — স্টোরিবোর্ড + ক্যামেরা-মোশন।
// ============================================================

import path from 'path';
import type { PipelineFn, StepHandle } from '../runner';
import type { PlannedShot } from '../../film-helpers';
import {
  kenBurnsClip,
  concatClips,
  mixAudioTracks,
  muxAudio,
  shotPlanFromLLM,
  imagePromptForShot,
  normalizeShotDurations,
  sanitize,
} from '../../film-helpers';
import { generateImageBuffer, synthesizeSpeech } from '../../sdk-helpers';
import { mediaInfo } from '@/lib/media/ffmpeg';
import { ASPECT_TO_GEN_SIZE, outputDims, maxShots, SHOT_DURATION_HINT } from '../../capabilities';

export const motionVideoPipeline: PipelineFn = async ctx => {
  const spec = ctx.spec;
  const aspect = spec.aspect ?? '16:9';
  const fps = spec.fps ?? 30;
  const durationSec = Math.max(5, Math.min(20, spec.durationSec ?? 10));
  const sound = spec.sound ?? 'none';
  const resolution = spec.quality === 'draft' ? '720p' : '1080p';
  const dims = outputDims(aspect, resolution);
  const wd = ctx.workingDir;

  // ------------------------------------------------------- plan
  let shots: (PlannedShot & { framePath?: string; clipPath?: string })[] = [];
  await ctx.runStep('plan', 'দৃশ্য-পরিকল্পনা', async (step: StepHandle) => {
    if (spec.sourceImageArtifactId) {
      // image-to-video: উৎস ছবি থেকে একক শট
      const src = await ctx.resolveArtifactFile(spec.sourceImageArtifactId);
      shots = [
        {
          description: spec.idea || 'Source image brought to life with cinematic camera motion',
          label: spec.idea ? spec.idea.slice(0, 80) : 'উৎস ছবির দৃশ্য',
          cameraMove: spec.cameraMove ?? 'zoom_in',
          durationSec,
          framePath: src,
        },
      ];
      await step.setDetail('উৎস ছবি থেকে ১টি শট');
      return;
    }
    const count = Math.max(1, Math.min(maxShots('motion_video', spec.quality), Math.round(durationSec / 5)));
    shots = await shotPlanFromLLM(spec.idea ?? spec.title, {
      count,
      durationHintSec: SHOT_DURATION_HINT.motion_video,
      maxCount: maxShots('motion_video', spec.quality),
      aspect,
      totalDurationSec: durationSec,
      context: `মোশন ভিডিও — মোট ${durationSec} সেকেন্ড, ${aspect}, ${fps}fps`,
    });
    normalizeShotDurations(shots, durationSec);
    await step.setDetail(`${shots.length}টি শট পরিকল্পিত`);
  });

  // ------------------------------------------------------- storyboard
  await ctx.runStep('storyboard', 'স্টোরিবোর্ড ফ্রেম তৈরি', async (step: StepHandle) => {
    const valid: typeof shots = [];
    for (let i = 0; i < shots.length; i++) {
      await ctx.checkCancelled();
      const shot = shots[i];
      if (shot.framePath) {
        // উৎস ছবির শট — নতুন ফ্রেম লাগে না
        valid.push(shot);
        continue;
      }
      await step.setDetail(`${i + 1}/${shots.length} ফ্রেম তৈরি`);
      const prompt = imagePromptForShot(shot, spec.style);
      const genSize = ASPECT_TO_GEN_SIZE[aspect];
      let buffer: Buffer | null = null;
      try {
        buffer = (await generateImageBuffer(prompt, genSize)).buffer;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          buffer = (await generateImageBuffer(prompt, genSize)).buffer; // একবার পুনঃচেষ্টা
        } catch {
          ctx.partialNotes.push(`শট ${i + 1}-এর ফ্রেম তৈরি ব্যর্থ (${msg.slice(0, 120)}) — শট বাদ`);
          continue;
        }
      }
      if (!buffer) continue;
      const framePath = path.join(wd, `frame-${i}.png`);
      const { writeFile } = await import('fs/promises');
      await writeFile(framePath, buffer);
      // স্টোরিবোর্ড ব্যবহারকারীকে দেখানো যায় — artifact হিসেবে নিবন্ধন
      await ctx.registerArtifact({
        buffer,
        kind: 'image',
        mimeType: 'image/png',
        fileName: `storyboard-shot-${i + 1}.png`,
        metaJson: { shot: i + 1, of: shots.length, cameraMove: shot.cameraMove, label: shot.label },
      });
      valid.push({ ...shot, framePath });
    }
    if (valid.length === 0) throw new Error('কোনো স্টোরিবোর্ড ফ্রেমই তৈরি হয়নি');
    shots = valid;
    await step.setDetail(`${valid.length}টি ফ্রেম সম্পন্ন`);
  });

  // ------------------------------------------------------- motion
  await ctx.runStep('motion', 'ক্যামেরা-মোশন ক্লিপ তৈরি', async (step: StepHandle) => {
    const valid: typeof shots = [];
    for (let i = 0; i < shots.length; i++) {
      await ctx.checkCancelled();
      const shot = shots[i];
      if (!shot.framePath) continue;
      await step.setDetail(`${i + 1}/${shots.length} ক্লিপ (${shot.cameraMove})`);
      const clipPath = path.join(wd, `clip-${i}.mp4`);
      const move = spec.cameraMove ?? shot.cameraMove;
      try {
        await kenBurnsClip(shot.framePath, clipPath, {
          durationSec: shot.durationSec,
          fps,
          width: dims.w,
          height: dims.h,
          move,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await kenBurnsClip(shot.framePath, clipPath, {
            durationSec: shot.durationSec,
            fps,
            width: dims.w,
            height: dims.h,
            move,
          });
        } catch {
          ctx.partialNotes.push(`শট ${i + 1}-এর মোশন ক্লিপ ব্যর্থ (${msg.slice(0, 120)}) — বাদ`);
          continue;
        }
      }
      valid.push({ ...shot, clipPath });
    }
    if (valid.length === 0) throw new Error('কোনো মোশন ক্লিপই তৈরি হয়নি');
    shots = valid;
    await step.setDetail(`${valid.length}টি ক্লিপ সম্পন্ন`);
  });

  // ------------------------------------------------------- assemble
  let finalVideo = '';
  let finalDuration = 0;
  await ctx.runStep('assemble', 'টাইমলাইন অ্যাসেম্বলি ও সাউন্ড', async (step: StepHandle) => {
    await step.setDetail('ক্লিপ জোড়া লাগানো');
    const silentPath = path.join(wd, 'assembled.mp4');
    await concatClips(shots.map(s => s.clipPath!), silentPath, { transitionSec: 0.6 });
    const vInfo = await mediaInfo(silentPath);
    finalDuration = vInfo.durationSec;

    // সাউন্ড: narration (spec.text থাকলে TTS) > ambient > none
    if (sound === 'narration' && spec.text && spec.text.trim().length > 1) {
      await step.setDetail('ভয়েসওভার তৈরি');
      // TTS সীমা ≤১০২৪ অক্ষর — লম্বা স্ক্রিপ্ট বাক্যে ভাগ
      const chunks = chunkText(spec.text, 950);
      const voiceFiles: { file: string; startSec: number }[] = [];
      let cursor = 0;
      for (let i = 0; i < chunks.length; i++) {
        const filePath = path.join(wd, `voice-${i}.wav`);
        try {
          const speech = await synthesizeSpeech(chunks[i], spec.voice ?? 'tongtong', 1);
          const { writeFile } = await import('fs/promises');
          await writeFile(filePath, speech.buffer);
          const info = await mediaInfo(filePath);
          voiceFiles.push({ file: filePath, startSec: cursor });
          cursor += info.durationSec + 0.2;
        } catch (err) {
          ctx.partialNotes.push(
            `ভয়েসওভার খণ্ড ${i + 1} ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'})`
          );
        }
      }
      if (voiceFiles.length > 0) {
        await step.setDetail('অডিও মিক্স (ভয়েসওভার + পরিবেশ-শব্দ)');
        const audioPath = await mixAudioTracks({
          voiceFiles,
          ambient: true,
          durationSec: finalDuration,
          outputPath: path.join(wd, 'audio.wav'),
          duck: true,
        });
        if (audioPath) {
          const withAudio = path.join(wd, 'assembled-audio.mp4');
          await muxAudio(silentPath, audioPath, withAudio, { durationSec: finalDuration, fadeOutSec: 1 });
          finalVideo = withAudio;
        } else {
          finalVideo = silentPath;
        }
      } else {
        finalVideo = silentPath;
      }
    } else if (sound === 'ambient') {
      await step.setDetail('পরিবেশ-শব্দ বিছানো');
      const audioPath = await mixAudioTracks({
        voiceFiles: [],
        ambient: true,
        durationSec: finalDuration,
        outputPath: path.join(wd, 'audio.wav'),
        duck: false,
      });
      if (audioPath) {
        const withAudio = path.join(wd, 'assembled-audio.mp4');
        await muxAudio(silentPath, audioPath, withAudio, { durationSec: finalDuration, fadeOutSec: 1.5 });
        finalVideo = withAudio;
      } else {
        finalVideo = silentPath;
      }
    } else {
      finalVideo = silentPath;
    }
    await step.setDetail(`চূড়ান্ত টাইমলাইন: ${finalDuration.toFixed(1)} সেকেন্ড`);
  });

  // ------------------------------------------------------- validate
  const result: Record<string, unknown> = {};
  await ctx.runStep('validate', 'চূড়ান্ত রেন্ডার ও যাচাই', async (step: StepHandle) => {
    await step.setDetail('মিডিয়া পরিদর্শন');
    const info = await mediaInfo(finalVideo);
    const problems: string[] = [];
    if (!info.hasVideo) problems.push('ভিডিও স্ট্রিম নেই');
    if (Math.abs(info.durationSec - durationSec) > 2) {
      ctx.partialNotes.push(
        `দৈর্ঘ্য ${info.durationSec.toFixed(1)} সে. — লক্ষ্য ${durationSec} সে. থেকে >২ সে. আলাদা`
      );
      problems.push('দৈর্ঘ্য-বিচ্যুতি');
    }
    if (info.width !== dims.w || info.height !== dims.h) {
      ctx.partialNotes.push(
        `রেজোলিউশন ${info.width}×${info.height} — প্রত্যাশিত ${dims.w}×${dims.h}`
      );
      problems.push('রেজোলিউশন-বিচ্যুতি');
    }
    if (sound !== 'none' && !info.hasAudio) {
      ctx.partialNotes.push(`শব্দ-মোড "${sound}" চাওয়া হলেও অডিও ট্র্যাক নেই`);
      problems.push('অডিও অনুপস্থিত');
    }

    await step.setDetail('MP4 নিবন্ধন');
    const buf = await import('fs/promises').then(fs => fs.readFile(finalVideo));
    const artifact = await ctx.registerArtifact({
      buffer: buf,
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: `${sanitize(spec.title || 'motion-video').slice(0, 40)}.mp4`,
      metaJson: {
        pipeline: 'motion_video',
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        aspect,
        shots: shots.length,
        sound,
        method: 'AI storyboard frames + Ken Burns camera motion + FFmpeg assembly',
      },
    });

    const verdict =
      problems.length === 0
        ? `চমৎকার — ${shots.length}টি শট, ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}@${info.fps}FPS${info.hasAudio ? ', অডিও-সহ' : ''}। (পদ্ধতি: AI স্টোরিবোর্ড + সিনেম্যাটিক ক্যামেরা-মোশন)`
        : `কার্যকর, তবে কিছু সতর্কতা: ${problems.join(', ')}। ${info.durationSec.toFixed(1)} সেকেন্ড, ${shots.length}টি শট।`;
    result.quality = verdict;
    result.artifactId = artifact.id;
    result.durationSec = info.durationSec;
    result.shots = shots.length;
    result.aspect = aspect;
    result.sound = sound;
    result.hasAudio = info.hasAudio;
  });

  return { result };
};

/** TTS-উপযোগী বাক্য-খণ্ড (≤maxChars, বাক্য-সীমায়) */
function chunkText(text: string, maxChars: number): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.split(/(?<=[।!?\.])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if ((current + ' ' + s).trim().length > maxChars && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
