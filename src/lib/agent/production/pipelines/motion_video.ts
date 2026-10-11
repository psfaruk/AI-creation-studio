// ============================================================
// Motion video pipeline — নতুন মাস্টার প্ল্যান §৪
// ইঞ্জিন-সচেতন দুই পথ:
//  - ai_diffusion (ডিফল্ট): প্রকৃত CogVideoX-3 ক্লাউড-ডিফিউশন শট →
//    FFmpeg স্বাভাবিকীকরণ (scale/crop/fps/setsar)। প্রতি শটে সর্বোচ্চ ১
//    পুনঃচেষ্টা; তারপরও ব্যর্থ হলে সৎ-ফলব্যাক: AI স্টোরিবোর্ড ফ্রেম +
//    Ken Burns ক্যামেরা-মোশন (shotEngineLabels-এ স্পষ্ট লেবেল)।
//  - cinematic_motion: আগের সৎ পথ — স্টোরিবোর্ড + ক্যামেরা-মোশন।
// ধাপ-key: plan → generate_shots → assemble → validate।
//
// এই ফাইলটি শেয়ার্ড AI-শট সহায়কও রপ্তানি করে (music_video ও
// short_film পাইপলাইন পুনঃব্যবহার করে)।
// ============================================================

import path from 'path';
import { readFile, writeFile } from 'fs/promises';
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
import { generateImageBuffer } from '../../sdk-helpers';
import { cachedSynthesizeSpeech } from '../../tts-cache';
import type { ImageSize } from '../../sdk-helpers';
import type { CameraMove } from '@/lib/types';
import { mediaInfo, runFfmpeg } from '@/lib/media/ffmpeg';
import { ASPECT_TO_GEN_SIZE, outputDims, maxShots, SHOT_DURATION_HINT } from '../../capabilities';
import { generateVideoClip, AI_VIDEO_MODEL } from '../../video/ai_video';
import { planSoundscape, renderSoundscapeBed } from '../../audio/sound_design';

// ------------------------------------------------------------
// শেয়ার্ড সহায়ক — অন্য ভিডিও-পাইপলাইনগুলোও ব্যবহার করে
// ------------------------------------------------------------

/** শট-বর্ণনা → CogVideoX-3 মোশন-প্রম্পট (ক্যামেরা-নির্দেশনা সহ) */
export function buildAiVideoPrompt(
  description: string,
  style?: string,
  cameraMove?: CameraMove,
  extra?: string
): string {
  const cam: Record<string, string> = {
    zoom_in: 'slow camera push in',
    zoom_out: 'slow camera pull back',
    pan_left: 'smooth pan to the left',
    pan_right: 'smooth pan to the right',
    static: 'steady camera, subtle handheld feel',
  };
  const parts = [
    (description ?? '').toString().trim().slice(0, 800),
    cameraMove ? cam[cameraMove] ?? 'cinematic camera movement' : 'cinematic camera movement',
    'realistic motion, cinematic, natural lighting, high quality, no text overlay',
  ];
  if (extra) parts.push(extra.toString().trim().slice(0, 300));
  if (style) parts.push(style.toString().trim().slice(0, 150));
  return parts.filter(Boolean).join(', ');
}

/** প্রয়োজনীয় দৈর্ঘ্য → AI-ভিডিওর সমর্থিত মান (৫ বা ১০ সে.) */
export function aiClipDurationSec(neededSec: number): 5 | 10 {
  return neededSec >= 7.5 ? 10 : 5;
}

/** ফাইলের প্রথম বাইটগুলো থেকে ছবির MIME-ধরন */
export async function sniffImageMime(file: string): Promise<'image/png' | 'image/jpeg' | 'image/webp'> {
  const head = await readFile(file).then(b => b.subarray(0, 16));
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return 'image/png';
}

/** লোকাল ছবি-ফাইল → data-URL (i2v রেফারেন্স হিসেবে) */
export async function toDataUrl(file: string): Promise<string> {
  const buf = await readFile(file);
  const mime = await sniffImageMime(file);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export interface AiShotRequest {
  index: number;
  /** ইংরেজি মোশন-প্রম্পট */
  prompt: string;
  /** প্রয়োজনীয় দৈর্ঘ্য (৫/১০ সে.-এ ক্ল্যাম্প) */
  neededSec: number;
  fps: number;
  width: number;
  height: number;
  workingDir: string;
  /** i2v রেফারেন্স (চরিত্রের পোর্ট্রেট data-URL) */
  imageUrl?: string;
  /** §১০ আইডেম্পোটেন্সি-চাবি (productionId + শট-সূচি) — একই লজিক্যাল শটের পুনঃসাবমিটে একই request_id */
  requestKey?: string;
  /** AI ব্যর্থ হলে ফলব্যাক-ফ্রেমের প্রম্পট */
  fallbackImagePrompt: string;
  /** ফলব্যাক-ফ্রেমের জেনারেশন সাইজ */
  fallbackGenSize: ImageSize;
  /** ফলব্যাক ফ্রেম চরিত্র-রেফারেন্স দিয়ে এডিট হবে (ঐচ্ছিক data-URL) */
  fallbackReferenceUrl?: string;
  fallbackMove: CameraMove;
  onStatus?: (note: string) => Promise<void> | void;
}

export interface AiShotResult {
  clipPath: string;
  /** সৎ ইঞ্জিন-লেবেল (shotEngineLabels-এ যায়) */
  engineLabel: string;
  usedAi: boolean;
  /** ফলব্যাক হলে স্টোরিবোর্ড ফ্রেমের পাথ (artifact নিবন্ধনের জন্য) */
  framePath?: string;
  aiModel?: string;
  fallbackError?: string;
}

/**
 * একটি শটের সম্পূর্ণ চক্র: প্রকৃত AI ভিডিও (সর্বোচ্চ ১ পুনঃচেষ্টা) →
 * লক্ষ্য-মাত্রা/fps-এ স্বাভাবিকীকরণ। দুই বারই ব্যর্থ হলে সৎ-ফলব্যাক:
 * AI স্টোরিবোর্ড ফ্রেম + Ken Burns ক্যামেরা-মোশন — engineLabel-এ স্পষ্ট
 * লেবেল (§৪.৩ সততা: FFmpeg-কে কখনো AI ভিডিও বলে দেখানো হয় না)।
 */
export async function generateAiShot(req: AiShotRequest): Promise<AiShotResult> {
  const rawPath = path.join(req.workingDir, `ai-raw-${req.index}.mp4`);
  const clipPath = path.join(req.workingDir, `aishot-${req.index}.mp4`);
  const duration = aiClipDurationSec(req.neededSec);
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await req.onStatus?.(
        attempt === 0
          ? `${AI_VIDEO_MODEL}-এ জেনারেট হচ্ছে (${duration} সে. — ২–৪ মিনিট লাগতে পারে)…`
          : 'AI-জেনারেশন পুনঃচেষ্টা চলছে…'
      );
      const clip = await generateVideoClip(
        {
          prompt: req.prompt,
          durationSec: duration,
          quality: 'speed',
          ...(req.imageUrl ? { imageUrl: req.imageUrl } : {}),
          // §১০: লজিক্যাল শটের আইডেম্পোটেন্সি-চাবি — পুনঃচেষ্টায়ও একই request_id
          ...(req.requestKey ? { requestKey: req.requestKey } : {}),
        },
        { onStatus: note => void req.onStatus?.(note) }
      );
      await writeFile(rawPath, clip.buffer);
      // লক্ষ্য-মাত্রা/fps-এ স্বাভাবিকীকরণ (কেন্দ্র-ক্রপ)
      await runFfmpeg(
        [
          '-i', rawPath,
          '-vf',
          `scale=${req.width}:${req.height}:force_original_aspect_ratio=increase,crop=${req.width}:${req.height},fps=${req.fps},setsar=1`,
          '-an',
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
          clipPath,
        ],
        { timeoutMs: 180_000, label: `AI শট ${req.index + 1} স্বাভাবিকীকরণ` }
      );
      return {
        clipPath,
        engineLabel: `শট ${req.index + 1}: প্রকৃত AI (${clip.model})`,
        usedAi: true,
        aiModel: clip.model,
      };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  // সৎ-ফলব্যাক — স্টোরিবোর্ড ফ্রেম + Ken Burns (লেবেলসহ)
  await req.onStatus?.('AI-জেনারেশন ব্যর্থ — স্টোরিবোর্ড+ক্যামেরা-মোশন ফলব্যাক');
  let buffer: Buffer;
  try {
    if (req.fallbackReferenceUrl) {
      const { editImageBuffer } = await import('../../sdk-helpers');
      buffer = (
        await editImageBuffer(
          req.fallbackReferenceUrl,
          `Place this same character in: ${req.fallbackImagePrompt}. Keep the face, hair and outfit identical to the reference. Consistent character.`,
          req.fallbackGenSize
        )
      ).buffer;
    } else {
      buffer = (await generateImageBuffer(req.fallbackImagePrompt, req.fallbackGenSize)).buffer;
    }
  } catch (err) {
    throw new Error(`AI-শট ও ফলব্যাক-ফ্রেম দুটোই ব্যর্থ (AI: ${lastErr.slice(0, 140)}; ফ্রেম: ${err instanceof Error ? err.message.slice(0, 100) : 'অজানা'})`);
  }
  const framePath = path.join(req.workingDir, `fb-frame-${req.index}.png`);
  await writeFile(framePath, buffer);
  const fallbackDur = Math.max(1.5, Math.min(10, req.neededSec));
  await kenBurnsClip(framePath, clipPath, {
    durationSec: fallbackDur,
    fps: req.fps as 24 | 25 | 30,
    width: req.width,
    height: req.height,
    move: req.fallbackMove,
  });
  return {
    clipPath,
    framePath,
    usedAi: false,
    engineLabel: `শট ${req.index + 1}: ক্যামেরা-মোশন ফলব্যাক (AI-ব্যর্থ: ${lastErr.slice(0, 120)})`,
    fallbackError: lastErr.slice(0, 240),
  };
}

// ------------------------------------------------------------
// পাইপলাইন
// ------------------------------------------------------------

interface MotionShot extends PlannedShot {
  framePath?: string;
  clipPath?: string;
}

export const motionVideoPipeline: PipelineFn = async ctx => {
  const spec = ctx.spec;
  const aspect = spec.aspect ?? '16:9';
  const fps = spec.fps ?? 30;
  const durationSec = Math.max(5, Math.min(20, spec.durationSec ?? 10));
  const sound = spec.sound ?? 'none';
  const engine = spec.videoEngine === 'cinematic_motion' ? 'cinematic_motion' : 'ai_diffusion';
  const resolution = spec.quality === 'draft' ? '720p' : '1080p';
  const dims = outputDims(aspect, resolution);
  const genSize = ASPECT_TO_GEN_SIZE[aspect];
  const wd = ctx.workingDir;
  const shotEngineLabels: string[] = [];
  let aiShots = 0;
  const result: Record<string, unknown> = {};

  // ------------------------------------------------------- plan
  let shots: MotionShot[] = [];
  let sourceImageFile: string | null = null;
  await ctx.runStep('plan', 'দৃশ্য-পরিকল্পনা ও ক্যাপাবিলিটি-রাউটিং', async (step: StepHandle) => {
    if (spec.sourceImageArtifactId) {
      // image-to-video: উৎস ছবি থেকে একক শট (AI পথে প্রকৃত i2v)
      sourceImageFile = await ctx.resolveArtifactFile(spec.sourceImageArtifactId);
      shots = [
        {
          description: spec.idea || 'Source image brought to life with cinematic camera motion',
          label: spec.idea ? spec.idea.slice(0, 80) : 'উৎস ছবির দৃশ্য',
          cameraMove: spec.cameraMove ?? 'zoom_in',
          durationSec,
          ...(engine === 'cinematic_motion' ? { framePath: sourceImageFile } : {}),
        },
      ];
      await step.setDetail(
        `উৎস ছবি থেকে ১টি শট — ${engine === 'ai_diffusion' ? `ছবি→ভিডিও AI (${AI_VIDEO_MODEL})` : 'ক্যামেরা-মোশন'}`
      );
      return;
    }
    const limit = maxShots('motion_video', spec.quality, engine);
    const perShot = engine === 'ai_diffusion' ? 10 : 5;
    const count = Math.max(1, Math.min(limit, Math.round(durationSec / perShot)));
    shots = await shotPlanFromLLM(spec.idea ?? spec.title, {
      count,
      durationHintSec: SHOT_DURATION_HINT.motion_video,
      maxCount: limit,
      aspect,
      totalDurationSec: durationSec,
      context: `মোশন ভিডিও — মোট ${durationSec} সেকেন্ড, ${aspect}, ${fps}fps, ইঞ্জিন: ${engine}`,
    });
    normalizeShotDurations(shots, durationSec);
    if (engine === 'ai_diffusion') {
      // AI-ক্লিপ ৫/১০ সেকেন্ডে আসে — শট-দৈর্ঘ্য সেই গ্রিডে ক্ল্যাম্প
      for (const s of shots) s.durationSec = aiClipDurationSec(s.durationSec);
    }
    await step.setDetail(
      `${shots.length}টি শট পরিকল্পিত — ইঞ্জিন: ${
        engine === 'ai_diffusion' ? `প্রকৃত AI (${AI_VIDEO_MODEL}, প্রতি শটে ২–৪ মিনিট)` : 'cinematic_motion (স্টোরিবোর্ড+ক্যামেরা-মোশন)'
      }`
    );
  });

  // ------------------------------------------------------- generate_shots
  await ctx.runStep(
    'generate_shots',
    engine === 'ai_diffusion' ? `AI ভিডিও-শট জেনারেশন (${AI_VIDEO_MODEL})` : 'স্টোরিবোর্ড ও ক্যামেরা-মোশন ক্লিপ',
    async (step: StepHandle) => {
      // উৎস-ছবির i2v রেফারেন্স (AI পথে)
      let sourceDataUrl: string | undefined;
      if (engine === 'ai_diffusion' && sourceImageFile) {
        sourceDataUrl = await toDataUrl(sourceImageFile);
      }
      const valid: MotionShot[] = [];
      for (let i = 0; i < shots.length; i++) {
        await ctx.checkCancelled();
        const shot = shots[i];
        if (engine === 'ai_diffusion') {
          await step.setDetail(`শট ${i + 1}/${shots.length} জেনারেট হচ্ছে…`);
          try {
            const res = await generateAiShot({
              index: i,
              prompt: buildAiVideoPrompt(shot.description, spec.style, shot.cameraMove),
              neededSec: shot.durationSec,
              fps,
              width: dims.w,
              height: dims.h,
              workingDir: wd,
              imageUrl: sourceDataUrl,
              // §১০ আইডেম্পোটেন্সি: এই প্রোডাকশনের এই শট = একই request_id
              requestKey: `${ctx.productionId}-shot-${i + 1}`,
              fallbackImagePrompt: imagePromptForShot(shot, spec.style),
              fallbackGenSize: genSize,
              fallbackMove: spec.cameraMove ?? shot.cameraMove,
              onStatus: note => step.setDetail(`শট ${i + 1}/${shots.length}: ${note}`),
            });
            if (res.usedAi) {
              aiShots++;
            } else if (res.framePath) {
              // ফলব্যাক-ফ্রেম artifact হিসেবে (সৎ লেবেলসহ)
              await ctx.registerArtifact({
                buffer: await readFile(res.framePath),
                kind: 'image',
                mimeType: 'image/png',
                fileName: `storyboard-shot-${i + 1}.png`,
                metaJson: {
                  shot: i + 1,
                  of: shots.length,
                  cameraMove: shot.cameraMove,
                  label: shot.label,
                  note: `AI-জেনারেশন ব্যর্থ — ফলব্যাক ফ্রেম (${res.fallbackError ?? ''})`,
                },
              });
            }
            shotEngineLabels.push(res.engineLabel);
            valid.push({ ...shot, clipPath: res.clipPath, framePath: res.framePath });
          } catch (err) {
            ctx.partialNotes.push(
              `শট ${i + 1} তৈরি ব্যর্থ (${err instanceof Error ? err.message.slice(0, 140) : 'অজানা'}) — শট বাদ`
            );
          }
        } else {
          // cinematic_motion — আগের সৎ পথ: স্টোরিবোর্ড ফ্রেম + Ken Burns
          if (!shot.framePath) {
            await step.setDetail(`শট ${i + 1}/${shots.length} — ফ্রেম তৈরি`);
            const prompt = imagePromptForShot(shot, spec.style);
            let buffer: Buffer | null = null;
            try {
              buffer = (await generateImageBuffer(prompt, genSize)).buffer;
            } catch {
              try {
                buffer = (await generateImageBuffer(prompt, genSize)).buffer; // একবার পুনঃচেষ্টা
              } catch (err) {
                ctx.partialNotes.push(
                  `শট ${i + 1}-এর ফ্রেম তৈরি ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — শট বাদ`
                );
                continue;
              }
            }
            const framePath = path.join(wd, `frame-${i}.png`);
            await writeFile(framePath, buffer);
            await ctx.registerArtifact({
              buffer,
              kind: 'image',
              mimeType: 'image/png',
              fileName: `storyboard-shot-${i + 1}.png`,
              metaJson: { shot: i + 1, of: shots.length, cameraMove: shot.cameraMove, label: shot.label },
            });
            shot.framePath = framePath;
          }
          await step.setDetail(`শট ${i + 1}/${shots.length} — মোশন ক্লিপ (${shot.cameraMove})`);
          const clipPath = path.join(wd, `clip-${i}.mp4`);
          const kbOpts = {
            durationSec: shot.durationSec,
            fps: fps as 24 | 25 | 30,
            width: dims.w,
            height: dims.h,
            move: (spec.cameraMove ?? shot.cameraMove) as MotionShot['cameraMove'],
          };
          try {
            await kenBurnsClip(shot.framePath!, clipPath, kbOpts);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
              await kenBurnsClip(shot.framePath!, clipPath, kbOpts);
            } catch {
              ctx.partialNotes.push(`শট ${i + 1}-এর মোশন ক্লিপ ব্যর্থ (${msg.slice(0, 120)}) — বাদ`);
              continue;
            }
          }
          shotEngineLabels.push(`শট ${i + 1}: ক্যামেরা-মোশন (ইঞ্জিন-নির্বাচিত)`);
          valid.push({ ...shot, clipPath });
        }
      }
      if (valid.length === 0) throw new Error('কোনো শট ক্লিপই তৈরি হয়নি');
      shots = valid;
      await step.setDetail(`${valid.length}টি শট ক্লিপ সম্পন্ন`);
    }
  );

  // ------------------------------------------------------- assemble
  let finalVideo = '';
  let finalDuration = 0;
  let soundDesignLabel = '';
  await ctx.runStep('assemble', 'টাইমলাইন অ্যাসেম্বলি ও সাউন্ড', async (step: StepHandle) => {
    await step.setDetail('ক্লিপ জোড়া লাগানো');
    const silentPath = path.join(wd, 'assembled.mp4');
    await concatClips(
      shots.map(s => s.clipPath!),
      silentPath,
      { transitionSec: engine === 'ai_diffusion' ? 0.3 : 0.6 }
    );
    let videoPath = silentPath;
    let vInfo = await mediaInfo(silentPath);
    // লক্ষ্য-দৈর্ঘ্যে ট্রিম (AI-ক্লিপ ৫/১০-সে. কোয়ান্টাইজড বলে বাড়তি অংশ কাটা)
    if (vInfo.durationSec > durationSec + 0.6) {
      const trimmed = path.join(wd, 'assembled-trim.mp4');
      await runFfmpeg(
        [
          '-i', silentPath,
          '-t', durationSec.toFixed(2),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
          '-an', trimmed,
        ],
        { timeoutMs: 180_000, label: 'লক্ষ্য-দৈর্ঘ্যে ট্রিম' }
      );
      videoPath = trimmed;
      vInfo = await mediaInfo(trimmed);
    }
    finalDuration = vInfo.durationSec;
    finalVideo = videoPath;

    // §৮ সাউন্ড-ডিজাইন থেকে পরিবেশ-বিছানা (ধারণা থেকে পরিকল্পিত — সৎ লেবেলসহ)
    const renderBed = async (): Promise<string | null> => {
      try {
        const plan = planSoundscape(`${spec.idea ?? ''} ${spec.title ?? ''}`.trim() || 'cinematic atmosphere', {});
        const bedPath = path.join(wd, 'soundscape-bed.wav');
        await writeFile(bedPath, renderSoundscapeBed(plan, finalDuration, {}));
        soundDesignLabel = `পরিবেশ-শব্দ: ${plan.ambience.join('+')}${plan.foley.length ? ` + ফোলে ${plan.foley.join('+')}` : ''} — ${plan.honestLabel}`;
        return bedPath;
      } catch (err) {
        ctx.partialNotes.push(
          `পরিবেশ-শব্দ বিছানো ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — নীরব/শুধু-কণ্ঠ থাকবে`
        );
        return null;
      }
    };

    if (sound === 'narration' && spec.text && spec.text.trim().length > 1) {
      await step.setDetail('ভয়েসওভার তৈরি');
      const chunks = chunkText(spec.text, 950);
      const voiceFiles: { file: string; startSec: number }[] = [];
      let cursor = 0;
      for (let i = 0; i < chunks.length; i++) {
        const filePath = path.join(wd, `voice-${i}.wav`);
        try {
          const speech = await cachedSynthesizeSpeech(chunks[i], spec.voice ?? 'tongtong', 1);
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
        await step.setDetail('অডিও মিক্স (ভয়েসওভার + §৮ পরিবেশ-বিছানা, ডাকিংসহ)');
        const bedPath = await renderBed();
        const audioPath = await mixAudioTracks({
          voiceFiles,
          ambient: !bedPath,
          ...(bedPath ? { musicFile: bedPath } : {}),
          durationSec: finalDuration,
          outputPath: path.join(wd, 'audio.wav'),
          duck: true,
        });
        if (audioPath) {
          const withAudio = path.join(wd, 'assembled-audio.mp4');
          await muxAudio(finalVideo, audioPath, withAudio, { durationSec: finalDuration, fadeOutSec: 1 });
          finalVideo = withAudio;
        }
      }
    } else if (sound === 'ambient') {
      await step.setDetail('§৮ সাউন্ড-ডিজাইন থেকে পরিবেশ-বিছানা');
      const bedPath = await renderBed();
      if (bedPath) {
        const withAudio = path.join(wd, 'assembled-audio.mp4');
        await muxAudio(finalVideo, bedPath, withAudio, { durationSec: finalDuration, fadeOutSec: 1.5 });
        finalVideo = withAudio;
      }
    }
    await step.setDetail(`চূড়ান্ত টাইমলাইন: ${finalDuration.toFixed(1)} সেকেন্ড`);
  });

  // ------------------------------------------------------- validate
  await ctx.runStep('validate', 'চূড়ান্ত যাচাই (দৈর্ঘ্য/মাত্রা/কোডেক)', async (step: StepHandle) => {
    await step.setDetail('ffprobe মিডিয়া-পরিদর্শন');
    const info = await mediaInfo(finalVideo);
    const problems: string[] = [];
    if (!info.hasVideo) problems.push('ভিডিও স্ট্রিম নেই');
    if (info.videoCodec && info.videoCodec !== 'h264') problems.push(`ভিডিও-কোডেক ${info.videoCodec} (h264 প্রত্যাশিত)`);
    if (Math.abs(info.durationSec - durationSec) > 2) {
      ctx.partialNotes.push(
        `দৈর্ঘ্য ${info.durationSec.toFixed(1)} সে. — লক্ষ্য ${durationSec} সে. থেকে >২ সে. আলাদা (AI-ক্লিপ ৫/১০ সে.-গ্রিডে কোয়ান্টাইজড)`
      );
      problems.push('দৈর্ঘ্য-বিচ্যুতি');
    }
    if (info.width !== dims.w || info.height !== dims.h) {
      ctx.partialNotes.push(`রেজোলিউশন ${info.width}×${info.height} — প্রত্যাশিত ${dims.w}×${dims.h}`);
      problems.push('রেজোলিউশন-বিচ্যুতি');
    }
    if (sound !== 'none' && !info.hasAudio) {
      ctx.partialNotes.push(`শব্দ-মোড "${sound}" চাওয়া হলেও অডিও ট্র্যাক নেই`);
      problems.push('অডিও অনুপস্থিত');
    }

    const honestLabel =
      engine === 'ai_diffusion'
        ? aiShots === shots.length
          ? `সব ${shots.length}টি শট প্রকৃত AI (${AI_VIDEO_MODEL}) — ক্লাউড ডিফিউশন ভিডিও`
          : `${aiShots}/${shots.length} শট প্রকৃত AI (${AI_VIDEO_MODEL}); বাকি ${shots.length - aiShots}টি স্টোরিবোর্ড+ক্যামেরা-মোশন ফলব্যাক`
        : 'cinematic_motion ইঞ্জিন — AI স্টোরিবোর্ড + ক্যামেরা-মোশন (প্রকৃত ডিফিউশন ভিডিও নয়)';

    await step.setDetail('চূড়ান্ত MP4 নিবন্ধন');
    const buf = await readFile(finalVideo);
    const artifact = await ctx.registerArtifact({
      buffer: buf,
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: `${sanitize(spec.title || 'motion-video').slice(0, 40)}.mp4`,
      metaJson: {
        pipeline: 'motion_video',
        engine,
        aiModel: engine === 'ai_diffusion' && aiShots > 0 ? AI_VIDEO_MODEL : null,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        aspect,
        shots: shots.length,
        sound,
        shotEngineLabels,
        ...(soundDesignLabel ? { soundDesign: soundDesignLabel } : {}),
        honestLabel,
        lipSync: false, // §৫ — লিপ-সিঙ্ক মডেল নেই, দাবিও নেই
      },
    });

    const verdict =
      problems.length === 0
        ? `চমৎকার — ${shots.length}টি শট, ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}@${info.fps}FPS${info.hasAudio ? ', অডিও-সহ' : ''}। (${honestLabel})`
        : `কার্যকর, তবে সতর্কতা: ${problems.join(', ')}। ${info.durationSec.toFixed(1)} সেকেন্ড, ${shots.length}টি শট। (${honestLabel})`;
    result.quality = verdict;
    result.artifactId = artifact.id;
    result.durationSec = info.durationSec;
    result.shots = shots.length;
    result.engine = engine;
    result.shotEngineLabels = shotEngineLabels;
    result.aspect = aspect;
    result.sound = sound;
    result.hasAudio = info.hasAudio;
    result.honestLabel = honestLabel;
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
