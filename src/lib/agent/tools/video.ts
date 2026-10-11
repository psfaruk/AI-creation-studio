// ============================================================
// Video Studio tools — নতুন মাস্টার প্ল্যান §৪–§৫।
// §৪: প্রকৃত AI ভিডিও-জেনারেশন (CogVideoX-3 ক্লাউড ডিফিউশন) —
//     text-to-video ও image-to-video দুটোই (২০২৬-১০-১১ প্রোব-যাচাইকৃত)।
//     cinematic_motion ইঞ্জিন (AI স্টোরিবোর্ড + Ken Burns) সৎ-ফলব্যাক/
//     বিকল্প হিসেবে আছে — কখনো AI-ভিডিও বলে দেখানো হয় না।
// §৫: lip_sync — মডেল নেই, সৎ অবরুদ্ধ।
// ============================================================

import { z } from 'zod';
import path from 'path';
import { copyFile, readFile, writeFile } from 'fs/promises';
import type { ArtifactMeta } from '@/lib/types';
import { saveArtifactFile } from '../storage';
import { createToolArtifact, artifactFilePath, artifactToDataUrl } from '../registry-helpers';
import type { ToolContext, ToolSpec } from '../registry-helpers';
import { runFfmpeg, mediaInfo, makeTempDir, cleanupWorkingDir } from '@/lib/media/ffmpeg';
import { generateImageBuffer } from '../sdk-helpers';
import { ASPECT_TO_GEN_SIZE, outputDims, maxShots, SHOT_DURATION_HINT } from '../capabilities';
import { generateVideoClip, AI_VIDEO_MODEL } from '../video/ai_video';
import { lipSyncCapabilityReport, LIP_SYNC_STATUS } from '../video/lip_sync_module';
import {
  kenBurnsClip,
  concatClips,
  mixAudioTracks,
  imagePromptForShot,
  shotPlanFromLLM,
  sanitize,
  segmentDialogueToCues,
  makeSrt,
  nearestAspect,
} from '../film-helpers';
import type { AspectRatio, CameraMove } from '@/lib/types';

const ASPECTS = ['9:16', '16:9', '1:1', '4:5', '3:2'] as const;
const MOVES = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'] as const;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** টেম্প ডিরেক্টরিতে রেন্ডার করে MP4 artifact হিসেবে নিবন্ধন */
async function registerVideoArtifact(params: {
  ctx: ToolContext;
  file: string;
  fileName: string;
  metaJson?: Record<string, unknown>;
}): Promise<ArtifactMeta> {
  const buffer = await readFile(params.file);
  const { storagePath } = await saveArtifactFile(buffer, 'mp4');
  return createToolArtifact({
    conversationId: params.ctx.conversationId,
    runId: params.ctx.runId,
    kind: 'video',
    mimeType: 'video/mp4',
    fileName: params.fileName,
    size: buffer.length,
    storagePath,
    metaJson: params.metaJson,
  });
}

// ------------------------------------------------------------
// ১. plan_video — আইডিয়া → বাংলা শট-তালিকা দলিল
// ------------------------------------------------------------

const planVideoSpec: ToolSpec<{
  idea: string;
  durationSec: number;
  aspect?: (typeof ASPECTS)[number];
}> = {
  name: 'plan_video',
  parameters: z.object({
    idea: z.string().min(3).max(2000),
    durationSec: z.number().int().min(10).max(180),
    aspect: z.enum(ASPECTS).optional(),
  }),
  timeoutMs: 90_000,
  usage:
    '- plan_video: আইডিয়াকে সিনেম্যাটিক শট-তালিকায় ভাগ করে (পরিকল্পনা-দলিল, ভিডিও তৈরি হয় না)। arguments: {idea: "আইডিয়া", durationSec: 10-180, aspect?: "9:16"|"16:9"|"1:1"|"4:5"|"3:2"}. আউটপুট: শট-প্ল্যান টেক্সট artifact (ক্রম, বাংলা বর্ণনা, ক্যামেরা-মুভ, দৈর্ঘ্য)। বড় ভিডিও বানানোর আগে পরিকল্পনা দেখতে চাইলে ব্যবহার করো।',
  inputSummary: i => `আইডিয়া: ${truncate(i.idea, 60)} (${i.durationSec}s)`,
  execute: async (input, ctx) => {
    const count = Math.max(3, Math.min(12, Math.round(input.durationSec / 5)));
    const shots = await shotPlanFromLLM(input.idea, {
      count,
      durationHintSec: { min: 2.5, max: 8 },
      maxCount: 12,
      aspect: input.aspect,
      totalDurationSec: input.durationSec,
    });

    const lines: string[] = [
      `শট-পরিকল্পনা — মোট ${shots.length}টি শট, লক্ষ্য-দৈর্ঘ্য ≈ ${input.durationSec} সেকেন্ড`,
      `মোট যোগফল: ${shots.reduce((a, s) => a + s.durationSec, 0).toFixed(1)} সেকেন্ড`,
      input.aspect ? `টার্গেট অনুপাত: ${input.aspect}` : '',
      '',
      '| ক্রম | বর্ণনা (বাংলা) | ক্যামেরা | দৈর্ঘ্য |',
      '|---|---|---|---|',
    ].filter(Boolean);
    const moveLabels: Record<CameraMove, string> = {
      zoom_in: 'ধীরে জুম-ইন',
      zoom_out: 'জুম-আউট',
      pan_left: 'বাঁয়ে প্যান',
      pan_right: 'ডানে প্যান',
      static: 'স্থির (হালকা ড্রিফট)',
    };
    shots.forEach((s, i) => {
      lines.push(`| ${i + 1} | ${s.label} | ${moveLabels[s.cameraMove]} | ${s.durationSec}s |`);
    });
    lines.push('', 'ইংরেজি বর্ণনা (ইমেজ-জেনারেশনের জন্য):');
    shots.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.description}${s.mood ? ` [মুড: ${s.mood}]` : ''}`);
    });
    const doc = lines.join('\n');

    const buffer = Buffer.from(doc, 'utf-8');
    const { storagePath } = await saveArtifactFile(buffer, 'txt');
    const artifact = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'text',
      mimeType: 'text/plain',
      fileName: 'shot-plan.txt',
      size: buffer.length,
      storagePath,
      metaJson: { tool: 'plan_video', shots: shots.length, durationSec: input.durationSec },
    });
    return {
      summary: `${shots.length}টি শটের পরিকল্পনা তৈরি (≈${shots.reduce((a, s) => a + s.durationSec, 0).toFixed(0)} সেকেন্ড)`,
      resultJson: JSON.stringify({ artifactId: artifact.id, shots, totalSec: shots.reduce((a, s) => a + s.durationSec, 0) }),
      artifacts: [artifact],
    };
  },
};

// ------------------------------------------------------------
// ২. generate_video — আইডিয়া → ছোট ভিডিও (নতুন মাস্টার প্ল্যান §৪)
//    প্রাইমারি ইঞ্জিন: প্রকৃত AI ডিফিউশন (CogVideoX-3, ক্লাউড)
//    বিকল্প/ফলব্যাক: cinematic_motion (স্টোরিবোর্ড + Ken Burns — সৎ লেবেল)
// ------------------------------------------------------------

const generateVideoSpec: ToolSpec<{
  idea: string;
  durationSec: number;
  aspect: (typeof ASPECTS)[number];
  cameraMove?: (typeof MOVES)[number];
  sound: 'none' | 'ambient' | 'native_ai';
  style?: string;
  engine: 'ai_diffusion' | 'cinematic_motion';
}> = {
  name: 'generate_video',
  parameters: z.object({
    idea: z.string().min(3).max(1500),
    durationSec: z.number().int().min(5).max(20),
    aspect: z.enum(ASPECTS).default('16:9'),
    cameraMove: z.enum(MOVES).optional(),
    sound: z.enum(['none', 'ambient', 'native_ai']).default('none'),
    style: z.string().max(300).optional(),
    engine: z.enum(['ai_diffusion', 'cinematic_motion']).default('ai_diffusion'),
  }),
  timeoutMs: 900_000,
  usage:
    `- generate_video: আইডিয়া থেকে ছোট ভিডিও (৫–২০ সে.)। ইঞ্জিন: (ক) "ai_diffusion" (ডিফল্ট) — প্রকৃত AI ভিডিও-জেনারেশন ${AI_VIDEO_MODEL} ক্লাউড ডিফিউশন মডেলে; প্রতি শটে ~২–৪ মিনিট লাগে, শট সীমিত (২০ সে.-এ ৩টির বেশি নয়); (খ) "cinematic_motion" — AI স্টোরিবোর্ড ফ্রেম + ক্যামেরা-মোশন (ডিফিউশন নয়, দ্রুত)। সাউন্ড: "none" (নীরব) | "ambient" (সংশ্লেষিত পরিবেশ-শব্দ) | "native_ai" (ai_diffusion-এর সাথে — মডেল-নির্মিত প্রকৃত AI-অডিও, প্রোব-যাচাইকৃত AAC; এই মোডে ক্লিপ-ট্রানজিশন থাকে না)। AI-শট ব্যর্থ হলে সেই শট সৎ-ফলব্যাকে (ক্যামেরা-মোশন) যায় এবং সারাংশে স্পষ্ট লেবেল হয়। arguments: {idea: "আইডিয়া", durationSec: 5-20, aspect: "9:16"|"16:9"|"1:1"|"4:5"|"3:2" (ডিফল্ট "16:9"), cameraMove?: "zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"static", sound: "none"|"ambient"|"native_ai", style?: "ভিজ্যুয়াল স্টাইল", engine?: "ai_diffusion"|"cinematic_motion"}. মিউজিক ভিডিও/শর্টফিল্মের জন্য propose_job ব্যবহার করো।`,
  inputSummary: i =>
    `রিয়েল AI ভিডিও (${i.engine === 'cinematic_motion' ? 'ক্যামেরা-মোশন' : 'CogVideoX-3'}): ${truncate(i.idea, 50)} — ${i.durationSec}s ${i.aspect}`,
  execute: async (input, ctx) => {
    const aspect = input.aspect;
    const dims = outputDims(aspect, '720p');
    const fps: 24 | 25 | 30 = 30;
    const engine = input.engine;
    const shotCount = Math.max(1, Math.min(engine === 'ai_diffusion' ? 3 : 4, Math.round(input.durationSec / 6)));
    const tempDir = await makeTempDir('gen-video-');
    const shotEngineLabels: string[] = [];
    try {
      // ১) শট-প্ল্যান (উভয় ইঞ্জিনেই দৃশ্য-পরিকল্পনা)
      let shots = await shotPlanFromLLM(input.idea, {
        count: shotCount,
        durationHintSec: SHOT_DURATION_HINT.motion_video,
        maxCount: Math.min(shotCount, maxShots('motion_video', 'standard', engine)),
        aspect,
        totalDurationSec: input.durationSec,
        context: `মোট ${input.durationSec} সেকেন্ড, ${shotCount}টি শট`,
      });
      shots = shots.slice(0, Math.max(1, Math.min(shotCount, shots.length)));
      const totalPlanned = shots.reduce((a, s) => a + s.durationSec, 0);
      if (Math.abs(totalPlanned - input.durationSec) > 0.5 && shots.length > 0) {
        const scale = input.durationSec / Math.max(0.1, totalPlanned);
        shots.forEach(s => (s.durationSec = Math.round(Math.max(1.5, Math.min(10, s.durationSec * scale)) * 10) / 10));
      }

      const clips: string[] = [];
      const nativeAudio = input.sound === 'native_ai' && engine === 'ai_diffusion';
      let nativeAudioShots = 0;

      if (engine === 'ai_diffusion') {
        // ২ক) প্রকৃত AI শট-জেনারেশন (CogVideoX-3) — প্রতি শটে সর্বোচ্চ ১ পুনঃচেষ্টা,
        //     তারপরও ব্যর্থ হলে সৎ-ফলব্যাক: স্টোরিবোর্ড + ক্যামেরা-মোশন (লেবেলসহ)
        for (let i = 0; i < shots.length; i++) {
          const shot = shots[i];
          const clipPath = path.join(tempDir, `aishot-${i}.mp4`);
          const motionPrompt = buildAiVideoPrompt(shot.description, input.style, shot.cameraMove);
          let aiOk = false;
          let shotNativeAudio = false;
          let lastErr = '';
          for (let attempt = 0; attempt < 2 && !aiOk; attempt++) {
            try {
              const clip = await generateVideoClip({
                prompt: motionPrompt,
                durationSec: Math.round(Math.max(5, Math.min(10, shot.durationSec))),
                quality: 'speed',
                withAudio: nativeAudio,
                requestKey: `gen-video-shot-${i}`,
              });
              await writeFile(path.join(tempDir, `ai-raw-${i}.mp4`), clip.buffer);
              shotNativeAudio = nativeAudio && clip.nativeAudio;
              // লক্ষ্য-মাত্রা/fps-এ স্বাভাবিকীকরণ (কেন্দ্র-ক্রপ)
              // native_ai-মোডে মডেল-নির্মিত অডিও-স্ট্রিম সংরক্ষিত থাকে
              const normArgs = [
                '-i', path.join(tempDir, `ai-raw-${i}.mp4`),
                '-vf',
                `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h},fps=${fps},setsar=1`,
              ];
              if (shotNativeAudio) {
                normArgs.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2');
              } else {
                normArgs.push('-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20');
              }
              normArgs.push(clipPath);
              await runFfmpeg(normArgs, { timeoutMs: 180_000, label: `AI শট ${i + 1} স্বাভাবিকীকরণ` });
              aiOk = true;
            } catch (err: any) {
              lastErr = String(err?.message ?? err).slice(0, 160);
            }
          }
          if (aiOk) {
            clips.push(clipPath);
            if (shotNativeAudio) nativeAudioShots++;
            shotEngineLabels.push(
              `শট ${i + 1}: ${AI_VIDEO_MODEL} AI${shotNativeAudio ? ' + নেটিভ-অডিও' : ''}`
            );
          } else {
            // সৎ-ফলব্যাক (স্পষ্ট লেবেলসহ)
            const framePath = path.join(tempDir, `fb-frame-${i}.png`);
            const { buffer } = await generateImageBuffer(imagePromptForShot(shot, input.style), ASPECT_TO_GEN_SIZE[aspect]);
            await writeFile(framePath, buffer);
            const fbPath = path.join(tempDir, `fb-clip-${i}.mp4`);
            await kenBurnsClip(framePath, fbPath, {
              durationSec: shot.durationSec,
              fps,
              width: dims.w,
              height: dims.h,
              move: input.cameraMove ?? shot.cameraMove,
            });
            clips.push(fbPath);
            shotEngineLabels.push(`শট ${i + 1}: ক্যামেরা-মোশন ফলব্যাক (AI-ব্যর্থ: ${lastErr})`);
          }
        }
      } else {
        // ২খ) cinematic_motion ইঞ্জিন (আগের সৎ পাইপলাইন)
        for (let i = 0; i < shots.length; i++) {
          const framePath = path.join(tempDir, `frame-${i}.png`);
          const { buffer } = await generateImageBuffer(imagePromptForShot(shots[i], input.style), ASPECT_TO_GEN_SIZE[aspect]);
          await writeFile(framePath, buffer);
          const clipPath = path.join(tempDir, `clip-${i}.mp4`);
          await kenBurnsClip(framePath, clipPath, {
            durationSec: shots[i].durationSec,
            fps,
            width: dims.w,
            height: dims.h,
            move: input.cameraMove ?? shots[i].cameraMove,
          });
          clips.push(clipPath);
          shotEngineLabels.push(`শট ${i + 1}: ক্যামেরা-মোশন (ইঞ্জিন-নির্বাচিত)`);
        }
      }

      // ৩) কনক্যাট — native_ai-মোডে অডিও-সংরক্ষী পথ (কোনো ট্রানজিশন নেই, সৎ নোট);
      //    বাকি মোডে আগের xfade/ফেড-পথ (নীরব)
      const silentPath = path.join(tempDir, 'silent.mp4');
      if (nativeAudio && clips.length > 1) {
        await concatClipsKeepAudio(clips, silentPath, tempDir);
      } else {
        await concatClips(clips, silentPath, { transitionSec: 0.6 });
      }

      // ৪) সাউন্ড — native_ai-মোডে মডেল-নির্মিত অডিও এমনিতেই আছে;
      //    'ambient' হলে সংশ্লেষিত পরিবেশ-শব্দ (সৎ লেবেল)
      let finalPath = silentPath;
      if (input.sound === 'ambient') {
        const mixed = await mixAudioTracks({
          voiceFiles: [],
          ambient: true,
          durationSec: input.durationSec,
          outputPath: path.join(tempDir, 'audio.wav'),
          duck: false,
        });
        if (mixed) {
          const withAudio = path.join(tempDir, 'final-audio.mp4');
          await runFfmpeg(
            ['-i', silentPath, '-i', mixed, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', withAudio],
            { timeoutMs: 180_000, label: 'পরিবেশ-শব্দ যোগ' }
          );
          finalPath = withAudio;
        }
      }

      // ৫) যাচাই (§১১ স্তর A)
      const info = await mediaInfo(finalPath);
      if (!info.hasVideo || info.durationSec < 1) throw new Error('ভিডিও রেন্ডার সঠিক হয়নি');

      const aiCount = shotEngineLabels.filter(l => l.includes('AI')).length;
      const nativeAudioOk = nativeAudio ? nativeAudioShots > 0 : undefined;
      const artifact = await registerVideoArtifact({
        ctx,
        file: finalPath,
        fileName: `${sanitize(input.idea).slice(0, 32) || 'motion'}.mp4`,
        metaJson: {
          tool: 'generate_video',
          engine,
          aiModel: engine === 'ai_diffusion' ? AI_VIDEO_MODEL : undefined,
          durationSec: info.durationSec,
          aspect,
          width: info.width,
          height: info.height,
          shots: shots.length,
          shotEngineLabels,
          nativeAudioShots: nativeAudio ? nativeAudioShots : undefined,
          honestLabel:
            engine === 'ai_diffusion'
              ? `${aiCount}/${shots.length} শট প্রকৃত AI (${AI_VIDEO_MODEL}); বাকি ক্যামেরা-মোশন ফলব্যাক` +
                (nativeAudio
                  ? nativeAudioOk
                    ? `; ${nativeAudioShots}/${shots.length} শটে মডেল-নির্মিত নেটিভ-অডিও`
                    : '; নেটিভ-অডিও আসেনি (সৎ-তথ্য)'
                  : '')
              : 'cinematic_motion ইঞ্জিন — AI স্টোরিবোর্ড + ক্যামেরা-মোশন (ডিফিউশন নয়)',
        },
      });
      return {
        summary: `ভিডিও তৈরি — ${info.durationSec.toFixed(1)} সে., ${info.width}×${info.height}, ${shots.length}টি শট [${shotEngineLabels.join('; ')}]` +
          (nativeAudio
            ? nativeAudioOk
              ? `; নেটিভ AI-অডিও ${nativeAudioShots} শটে`
              : '; নেটিভ-অডিও আসেনি (সৎ-তথ্য)'
            : ''),
        resultJson: JSON.stringify({
          artifactId: artifact.id,
          engine,
          aiShots: aiCount,
          totalShots: shots.length,
          durationSec: info.durationSec,
          aspect,
          sound: input.sound,
          hasAudio: info.hasAudio,
          nativeAudioShots: nativeAudio ? nativeAudioShots : undefined,
          shotEngineLabels,
        }),
        artifacts: [artifact],
      };
    } finally {
      await cleanupWorkingDir(tempDir);
    }
  },
};

/** শট-বর্ণনা → CogVideoX-3 মোশন-প্রম্পট (ক্যামেরা-নির্দেশনা সহ) */
function buildAiVideoPrompt(description: string, style?: string, cameraMove?: CameraMove): string {
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
    'realistic motion, continuous action, natural lighting, high quality, no text overlay',
  ];
  if (style) parts.push((style ?? '').toString().trim().slice(0, 150));
  return parts.filter(Boolean).join(', ');
}

/**
 * অডিও-সংরক্ষী কনক্যাট (native_ai-মোড) — অডিও-বিহীন ক্লিপে নীরব-ট্র্যাক
 * যোগ করে সব ক্লিপ অভিন্ন স্ট্রিম-গঠনে এনে concat-demuxer দিয়ে জোড়া হয়।
 * এই পথে ভিজ্যুয়াল ট্রানজিশন থাকে না (xfade অডিও ফেলে দেয়) — সৎ নোট।
 */
async function concatClipsKeepAudio(clips: string[], outputPath: string, tempDir: string): Promise<void> {
  if (clips.length === 0) throw new Error('কনক্যাট করার মতো কোনো ক্লিপ নেই');
  const uniform: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const info = await mediaInfo(clips[i]);
    if (info.hasAudio) {
      uniform.push(clips[i]);
      continue;
    }
    // নীরব AAC-ট্র্যাক যোগ (৪৪.১kHz স্টেরিও — অন্য ক্লিপের সাথে অভিন্ন)
    const silentClip = path.join(tempDir, `silentaudio-${i}.mp4`);
    await runFfmpeg(
      [
        '-i', clips[i],
        '-f', 'lavfi',
        '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        silentClip,
      ],
      { timeoutMs: 120_000, label: `নীরব-ট্র্যাক যোগ (ক্লিপ ${i + 1})` }
    );
    uniform.push(silentClip);
  }
  if (uniform.length === 1) {
    await copyFile(uniform[0], outputPath);
    return;
  }
  const listPath = path.join(tempDir, 'concat-list.txt');
  const listContent = uniform.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  const { writeFile: wf } = await import('fs/promises');
  await wf(listPath, listContent, 'utf-8');
  await runFfmpeg(
    [
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '20',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      '-movflags', '+faststart',
      outputPath,
    ],
    { timeoutMs: 300_000, label: 'অডিও-সংরক্ষী কনক্যাট (native_ai)' }
  );
}
// ------------------------------------------------------------
// ৩. animate_image — স্থির ছবি → Ken Burns মোশন ভিডিও
// ------------------------------------------------------------

const animateImageSpec: ToolSpec<{
  image: string;
  durationSec: number;
  cameraMove: (typeof MOVES)[number];
  fps: 24 | 25 | 30;
  aspect?: (typeof ASPECTS)[number];
}> = {
  name: 'animate_image',
  parameters: z.object({
    image: z.string().min(6).max(80),
    durationSec: z.number().int().min(3).max(10).default(5),
    cameraMove: z.enum(MOVES).default('zoom_in'),
    fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).default(30),
    aspect: z.enum(ASPECTS).optional(),
  }),
  timeoutMs: 240_000,
  usage:
    '- animate_image: আপলোড/তৈরি করা স্থির ছবিতে সিনেম্যাটিক ক্যামেরা-মুভমেন্ট (Ken Burns) যোগ করে চলমান ভিডিও বানায়। arguments: {image: "<artifact আইডি>", durationSec: 3-10 (ডিফল্ট 5), cameraMove: "zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"static" (ডিফল্ট "zoom_in"), fps: 24|25|30 (ডিফল্ট 30), aspect?: "9:16"|"16:9"|"1:1"|"4:5"|"3:2" (ডিফল্ট: ছবির মাপ থেকে নিকটতম)}. ব্যবহারকারী ছবি দিয়ে "এটা নড়াও" বললে এটিই ব্যবহার করো।',
  inputSummary: i => `ছবি ${i.image.slice(0, 14)}… → ${i.durationSec}s ${i.cameraMove}`,
  execute: async (input, ctx) => {
    const src = await artifactFilePath(input.image);
    if (src.kind !== 'image') throw new Error('animate_image-এর উৎস অবশ্যই ছবি artifact হতে হবে');
    const info = await mediaInfo(src.path);
    const aspect: AspectRatio = input.aspect ?? nearestAspect(info.width ?? 1024, info.height ?? 1024);
    const dims = outputDims(aspect, '720p');
    const tempDir = await makeTempDir('anim-img-');
    try {
      const outPath = path.join(tempDir, 'animated.mp4');
      await kenBurnsClip(src.path, outPath, {
        durationSec: input.durationSec,
        fps: input.fps,
        width: dims.w,
        height: dims.h,
        move: input.cameraMove,
      });
      const outInfo = await mediaInfo(outPath);
      const artifact = await registerVideoArtifact({
        ctx,
        file: outPath,
        fileName: `animated-${sanitize(src.fileName).slice(0, 32)}.mp4`,
        metaJson: {
          tool: 'animate_image',
          sourceArtifactId: input.image,
          cameraMove: input.cameraMove,
          durationSec: outInfo.durationSec,
          method: 'Ken Burns camera motion over still image',
        },
      });
      return {
        summary: `ছবি থেকে ভিডিও — ${outInfo.durationSec.toFixed(1)} সেকেন্ড, ${outInfo.width}×${outInfo.height}, মুভ: ${input.cameraMove}`,
        resultJson: JSON.stringify({
          artifactId: artifact.id,
          durationSec: outInfo.durationSec,
          aspect,
          width: outInfo.width,
          height: outInfo.height,
          cameraMove: input.cameraMove,
        }),
        artifacts: [artifact],
      };
    } finally {
      await cleanupWorkingDir(tempDir);
    }
  },
};

// ------------------------------------------------------------
// ৪. process_video — ট্রিম/জোড়া/স্পিড/স্কেল/ক্রপ/অডিও-সংযোজন
// ------------------------------------------------------------

const processVideoSpec: ToolSpec<{
  video: string;
  op: 'trim' | 'concat' | 'speed' | 'scale' | 'crop' | 'add_audio' | 'replace_audio';
  startSec?: number;
  endSec?: number;
  speed?: number;
  width?: number;
  height?: number;
  extraVideoId?: string;
  audioArtifactId?: string;
  audioStartSec?: number;
}> = {
  name: 'process_video',
  parameters: z.object({
    video: z.string().min(6).max(80),
    op: z.enum(['trim', 'concat', 'speed', 'scale', 'crop', 'add_audio', 'replace_audio']),
    startSec: z.number().min(0).max(7200).optional(),
    endSec: z.number().min(0).max(7200).optional(),
    speed: z.number().min(0.25).max(4).optional(),
    width: z.number().int().min(16).max(3840).optional(),
    height: z.number().int().min(16).max(3840).optional(),
    extraVideoId: z.string().min(6).max(80).optional(),
    audioArtifactId: z.string().min(6).max(80).optional(),
    audioStartSec: z.number().min(0).max(7200).optional(),
  }),
  timeoutMs: 300_000,
  usage:
    '- process_video: ভিডিও সম্পাদনা — ট্রিম, জোড়া, স্পিড, রেজোলিউশন, ক্রপ, অডিও যোগ/বদল। arguments: {video: "<artifact আইডি>", op: "trim"|"concat"|"speed"|"scale"|"crop"|"add_audio"|"replace_audio", startSec?, endSec? (trim), speed?: 0.25-4, width?, height? (scale/crop), extraVideoId?: "<দ্বিতীয় ভিডিও artifact>" (concat), audioArtifactId?: "<অডিও artifact>", audioStartSec?: অডিও শুরুর সময়}। প্রতিটি অপে প্রাসঙ্গিক প্যারামিটার দাও (যেমন op="trim" হলে startSec+endSec)।',
  inputSummary: i => `${i.op}: ভিডিও ${i.video.slice(0, 14)}…`,
  execute: async (input, ctx) => {
    const src = await artifactFilePath(input.video);
    if (src.kind !== 'video') throw new Error('process_video-এর উৎস অবশ্যই ভিডিও artifact হতে হবে');
    const srcInfo = await mediaInfo(src.path);
    const tempDir = await makeTempDir('proc-vid-');
    try {
      const outPath = path.join(tempDir, 'out.mp4');
      const args: string[] = [];
      let videoFilter = '';

      switch (input.op) {
        case 'trim': {
          const start = Math.max(0, input.startSec ?? 0);
          const end = Math.min(input.endSec ?? srcInfo.durationSec, srcInfo.durationSec);
          if (end - start < 0.2) throw new Error('trim ব্যবধি খুব ছোট — startSec < endSec দাও');
          args.push('-ss', start.toFixed(3), '-i', src.path, '-t', (end - start).toFixed(3));
          break;
        }
        case 'concat': {
          if (!input.extraVideoId) throw new Error('concat-এর জন্য extraVideoId দরকার');
          const other = await artifactFilePath(input.extraVideoId);
          if (other.kind !== 'video') throw new Error('extraVideoId অবশ্যই ভিডিও artifact হবে');
          const otherInfo = await mediaInfo(other.path);
          const w = srcInfo.width ?? 1280;
          const h = srcInfo.height ?? 720;
          const fps = Math.round(srcInfo.fps ?? 30);
          const prep = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1`;
          const chains: string[] = [`[1:v]${prep}[v1]`];
          let mapAudio = '';
          if (srcInfo.hasAudio && otherInfo.hasAudio) {
            chains.push(`[0:v][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]`);
            mapAudio = '[a]';
          } else if (srcInfo.hasAudio) {
            chains.push(`anullsrc=r=44100:cl=stereo:d=${otherInfo.durationSec.toFixed(2)}[s1]`);
            chains.push(`[0:v][0:a][v1][s1]concat=n=2:v=1:a=1[v][a]`);
            mapAudio = '[a]';
          } else if (otherInfo.hasAudio) {
            chains.push(`anullsrc=r=44100:cl=stereo:d=${srcInfo.durationSec.toFixed(2)}[s0]`);
            chains.push(`[0:v][s0][v1][1:a]concat=n=2:v=1:a=1[v][a]`);
            mapAudio = '[a]';
          } else {
            chains.push(`[0:v][v1]concat=n=2:v=1:a=0[v]`);
          }
          args.push('-i', src.path, '-i', other.path);
          args.push('-filter_complex', chains.join(';'));
          args.push('-map', '[v]');
          if (mapAudio) args.push('-map', mapAudio);
          args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k');
          args.push(outPath);
          const info = await runAndRegister(args, outPath, ctx, input, src);
          return info;
        }
        case 'speed': {
          const speed = input.speed ?? 1;
          if (speed === 1) throw new Error('speed=1 কোনো পরিবর্তন আনে না — 0.25-4 এর ভিন্ন মান দাও');
          videoFilter = `setpts=PTS/${speed.toFixed(3)}`;
          args.push('-i', src.path);
          if (srcInfo.hasAudio) {
            // atempo প্রতিটি 0.5-2 এর মধ্যে — চেইন করে ব্যাপক সীমা
            const tempos: string[] = [];
            let remaining = speed;
            while (remaining > 2.0001) {
              tempos.push('atempo=2.0');
              remaining /= 2;
            }
            while (remaining < 0.4999) {
              tempos.push('atempo=0.5');
              remaining /= 0.5;
            }
            tempos.push(`atempo=${remaining.toFixed(4)}`);
            args.push('-filter_complex', `[0:v]${videoFilter}[v];[0:a]${tempos.join(',')}[a]`, '-map', '[v]', '-map', '[a]');
          } else {
            args.push('-vf', videoFilter);
          }
          break;
        }
        case 'scale': {
          const w = evenNum(input.width ?? srcInfo.width ?? 1280);
          const h = evenNum(input.height ?? srcInfo.height ?? 720);
          videoFilter = `scale=${w}:${h}:flags=lanczos`;
          args.push('-i', src.path, '-vf', videoFilter);
          break;
        }
        case 'crop': {
          const w = evenNum(input.width ?? srcInfo.width ?? 1280);
          const h = evenNum(input.height ?? srcInfo.height ?? 720);
          if (w > (srcInfo.width ?? 0) || h > (srcInfo.height ?? 0)) {
            throw new Error(`ক্রপ-সাইজ (${w}×${h}) উৎস (${srcInfo.width}×${srcInfo.height})-এর মধ্যে থাকতে হবে`);
          }
          videoFilter = `crop=${w}:${h}:(in_w-${w})/2:(in_h-${h})/2`;
          args.push('-i', src.path, '-vf', videoFilter);
          break;
        }
        case 'add_audio':
        case 'replace_audio': {
          if (!input.audioArtifactId) throw new Error(`${input.op}-এর জন্য audioArtifactId দরকার`);
          const audio = await artifactFilePath(input.audioArtifactId);
          if (audio.kind !== 'audio') throw new Error('audioArtifactId অবশ্যই অডিও artifact হবে');
          const audioStart = Math.max(0, input.audioStartSec ?? 0);
          args.push('-i', src.path);
          args.push('-ss', audioStart.toFixed(3), '-i', audio.path);
          args.push(
            '-filter_complex',
            '[1:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=whole_dur=' + Math.max(1, srcInfo.durationSec + 5).toFixed(2) + '[a]',
            '-map', '0:v:0', '-map', '[a]',
            '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest'
          );
          break;
        }
      }

      if (!args.includes(outPath)) {
        // সাধারণ ট্রান্সকোড পথ — অডিও যথাসম্ভব সংরক্ষণ
        if (input.op === 'trim' || input.op === 'speed') {
          args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p');
          if (srcInfo.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k');
          else args.push('-an');
        } else if (input.op === 'scale' || input.op === 'crop') {
          args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'copy');
        }
        args.push(outPath);
      }

      return await runAndRegister(args, outPath, ctx, input, src);
    } finally {
      await cleanupWorkingDir(tempDir);
    }
  },
};

function evenNum(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

async function runAndRegister(
  args: string[],
  outPath: string,
  ctx: ToolContext,
  input: { op: string; video: string },
  src: { fileName: string }
): Promise<{ summary: string; resultJson: string; artifacts: ArtifactMeta[] }> {
  await runFfmpeg(args, { timeoutMs: 260_000, label: `ভিডিও সম্পাদনা (${input.op})` });
  const info = await mediaInfo(outPath);
  if (!info.hasVideo) throw new Error('আউটপুট ভিডিও স্ট্রিম পাওয়া যায়নি');
  const artifact = await registerVideoArtifact({
    ctx,
    file: outPath,
    fileName: `${sanitize(src.fileName).slice(0, 30)}-${input.op}.mp4`,
    metaJson: { tool: 'process_video', op: input.op, durationSec: info.durationSec, width: info.width, height: info.height },
  });
  return {
    summary: `${input.op} সম্পন্ন — ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}${info.hasAudio ? ', অডিও-সহ' : ''}`,
    resultJson: JSON.stringify({ artifactId: artifact.id, op: input.op, durationSec: info.durationSec, width: info.width, height: info.height, hasAudio: info.hasAudio }),
    artifacts: [artifact],
  };
}

// ------------------------------------------------------------
// ৫. enhance_video — color/sharpen/denoise/stabilize
// ------------------------------------------------------------

const enhanceVideoSpec: ToolSpec<{
  video: string;
  op: 'color' | 'sharpen' | 'denoise' | 'stabilize';
  brightness?: number;
  saturation?: number;
  contrast?: number;
  strength?: 'light' | 'strong';
}> = {
  name: 'enhance_video',
  parameters: z.object({
    video: z.string().min(6).max(80),
    op: z.enum(['color', 'sharpen', 'denoise', 'stabilize']),
    brightness: z.number().min(-0.5).max(0.5).optional(),
    saturation: z.number().min(0).max(3).optional(),
    contrast: z.number().min(0.5).max(2).optional(),
    strength: z.enum(['light', 'strong']).optional(),
  }),
  timeoutMs: 420_000,
  usage:
    '- enhance_video: ভিডিও উন্নতকরণ — রং-গ্রেডিং (brightness/saturation/contrast), শার্পেন, ডিনয়েজ বা স্ট্যাবিলাইজ (দুই-পাস vidstab, কাঁপা ভিডিওর জন্য)। arguments: {video: "<artifact আইডি>", op: "color"|"sharpen"|"denoise"|"stabilize", brightness?: -0.5..0.5, saturation?: 0-3, contrast?: 0.5-2 (op="color"), strength?: "light"|"strong" (sharpen/denoise/stabilize)। স্ট্যাবিলাইজ ধীর — ছোট ক্লিপে ভালো চলে।',
  inputSummary: i => `${i.op}: ভিডিও ${i.video.slice(0, 14)}…`,
  execute: async (input, ctx) => {
    const src = await artifactFilePath(input.video);
    if (src.kind !== 'video') throw new Error('enhance_video-এর উৎস অবশ্যই ভিডিও artifact হতে হবে');
    const srcInfo = await mediaInfo(src.path);
    const tempDir = await makeTempDir('enh-vid-');
    try {
      const outPath = path.join(tempDir, 'enhanced.mp4');
      const strength = input.strength ?? 'light';
      let vf: string;
      switch (input.op) {
        case 'color': {
          const b = input.brightness ?? 0;
          const s = input.saturation ?? 1;
          const c = input.contrast ?? 1;
          if (b === 0 && s === 1 && c === 1) throw new Error('অন্তত একটি প্যারামিটার দাও (brightness/saturation/contrast)');
          vf = `eq=brightness=${b.toFixed(3)}:saturation=${s.toFixed(3)}:contrast=${c.toFixed(3)}`;
          break;
        }
        case 'sharpen':
          vf = strength === 'strong' ? 'unsharp=5:5:1.6:5:5:0.4' : 'unsharp=5:5:0.8:5:5:0.2';
          break;
        case 'denoise':
          vf = strength === 'strong' ? 'hqdn3d=4:4:9:9' : 'hqdn3d=1.5:1.5:6:6';
          break;
        case 'stabilize': {
          // দুই-পাস vidstab — বিশ্লেষণ তারপর রূপান্তর
          const shake = strength === 'strong' ? 'shakiness=8' : 'shakiness=5';
          const smooth = strength === 'strong' ? 30 : 12;
          const trfFile = path.join(tempDir, 'stab.trf');
          await runFfmpeg(
            ['-i', src.path, '-vf', `vidstabdetect=${shake}:result=${trfFile}`, '-f', 'null', '-'],
            { timeoutMs: 380_000, label: 'স্ট্যাবিলাইজ বিশ্লেষণ (পাস ১)' }
          );
          vf = `vidstabtransform=input=${trfFile.replace(/:/g, '\\:')}:smoothing=${smooth}:optzoom=1`;
          break;
        }
      }
      const args = ['-i', src.path, '-vf', vf, '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p'];
      if (srcInfo.hasAudio) args.push('-c:a', 'copy');
      else args.push('-an');
      args.push(outPath);
      await runFfmpeg(args, { timeoutMs: 380_000, label: `ভিডিও উন্নতকরণ (${input.op})` });
      const info = await mediaInfo(outPath);
      const artifact = await registerVideoArtifact({
        ctx,
        file: outPath,
        fileName: `${sanitize(src.fileName).slice(0, 30)}-${input.op}.mp4`,
        metaJson: { tool: 'enhance_video', op: input.op, strength, durationSec: info.durationSec },
      });
      return {
        summary: `${input.op} উন্নতকরণ সম্পন্ন — ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}`,
        resultJson: JSON.stringify({ artifactId: artifact.id, op: input.op, strength, durationSec: info.durationSec }),
        artifacts: [artifact],
      };
    } finally {
      await cleanupWorkingDir(tempDir);
    }
  },
};

// ------------------------------------------------------------
// ৬. interpolate_video — minterpolate ফ্রেম-ইন্টারপোলেশন (ধীর!)
// ------------------------------------------------------------

const interpolateVideoSpec: ToolSpec<{
  video: string;
  targetFps: 24 | 30 | 60;
}> = {
  name: 'interpolate_video',
  parameters: z.object({
    video: z.string().min(6).max(80),
    targetFps: z.union([z.literal(24), z.literal(30), z.literal(60)]),
  }),
  timeoutMs: 420_000,
  usage:
    '- interpolate_video: মোশন-ইন্টারপোলেশন দিয়ে ফ্রেম-রেট বাড়িয়ে নড়াচড়া মসৃণ করে (minterpolate)। সতর্কতা: খুবই ধীর — ২০ সেকেন্ডের ক্লিপেও কয়েক মিনিট লাগতে পারে; ছোট ক্লিপে ব্যবহার করো। arguments: {video: "<artifact আইডি>", targetFps: 24|30|60}। ধীরগতির (slow-mo) ভিডিও বা মসৃণ প্যানের জন্য।',
  inputSummary: i => `${i.targetFps}fps: ভিডিও ${i.video.slice(0, 14)}…`,
  execute: async (input, ctx) => {
    const src = await artifactFilePath(input.video);
    if (src.kind !== 'video') throw new Error('interpolate_video-এর উৎস অবশ্যই ভিডিও artifact হতে হবে');
    const srcInfo = await mediaInfo(src.path);
    if (srcInfo.durationSec > 45) {
      throw new Error(`ইন্টারপোলেশন খুব ধীর — ${srcInfo.durationSec.toFixed(0)} সেকেন্ডের ক্লিপ বড় (৪৫ সেকেন্ডের নিচে দাও)`);
    }
    const tempDir = await makeTempDir('interp-vid-');
    try {
      const outPath = path.join(tempDir, 'interp.mp4');
      const args = [
        '-i', src.path,
        '-vf', `minterpolate=fps=${input.targetFps}:mi_mode=mldiff:mc_mode=aobmc:vsbmc=1`,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
      ];
      if (srcInfo.hasAudio) args.push('-c:a', 'copy');
      else args.push('-an');
      args.push(outPath);
      await runFfmpeg(args, { timeoutMs: 380_000, label: 'ফ্রেম-ইন্টারপোলেশন (ধীর)' });
      const info = await mediaInfo(outPath);
      const artifact = await registerVideoArtifact({
        ctx,
        file: outPath,
        fileName: `${sanitize(src.fileName).slice(0, 30)}-${input.targetFps}fps.mp4`,
        metaJson: { tool: 'interpolate_video', targetFps: input.targetFps, fromFps: srcInfo.fps, durationSec: info.durationSec },
      });
      return {
        summary: `${input.targetFps} FPS-এ ইন্টারপোলেট সম্পন্ন — ${info.durationSec.toFixed(1)} সেকেন্ড (আগে ছিল ${srcInfo.fps ?? '?'} FPS)`,
        resultJson: JSON.stringify({ artifactId: artifact.id, fromFps: srcInfo.fps, toFps: info.fps, durationSec: info.durationSec }),
        artifacts: [artifact],
      };
    } finally {
      await cleanupWorkingDir(tempDir);
    }
  },
};

// ------------------------------------------------------------
// ৭. generate_subtitles — লেখা → সময়-নির্ধারিত SRT
// ------------------------------------------------------------

const generateSubtitlesSpec: ToolSpec<{
  text: string;
  totalDurationSec?: number;
  language?: 'bn';
}> = {
  name: 'generate_subtitles',
  parameters: z.object({
    text: z.string().min(4).max(6000),
    totalDurationSec: z.number().min(3).max(600).optional(),
    language: z.literal('bn').optional(),
  }),
  timeoutMs: 90_000,
  usage:
    '- generate_subtitles: স্ক্রিপ্ট/সংলাপ থেকে সময়-নির্ধারিত SRT সাবটাইটেল ফাইল বানায় (১-৪ সেকেন্ডের কিউ)। arguments: {text: "স্ক্রিপ্ট/সংলাপ", totalDurationSec?: ভিডিওর দৈর্ঘ্য (দিলে কিউগুলো সেই সময়ে ছড়ানো হয়), language?: "bn"}. ভিডিওতে বাংলা সাবটাইটেল বসাতে চাইলে আগে এটি দিয়ে SRT বানাও — বার্ন-ইন শর্টফিল্ম পাইপলাইনে হয়।',
  inputSummary: i => `${truncate(i.text.replace(/\s+/g, ' '), 50)}`,
  execute: async (input, ctx) => {
    const cues = await segmentDialogueToCues(input.text, {
      totalDurationSec: input.totalDurationSec,
      language: input.language ?? 'bn',
    });
    if (cues.length === 0) throw new Error('সাবটাইটেল কিউ তৈরি হয়নি');
    const srt = makeSrt(cues);
    const buffer = Buffer.from(srt, 'utf-8');
    const { storagePath } = await saveArtifactFile(buffer, 'srt');
    const artifact = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'text',
      mimeType: 'application/x-subrip',
      fileName: 'subtitles.srt',
      size: buffer.length,
      storagePath,
      metaJson: { tool: 'generate_subtitles', cues: cues.length, totalDurationSec: input.totalDurationSec ?? null },
    });
    return {
      summary: `${cues.length}টি কিউ-এর সাবটাইটেল (SRT) তৈরি`,
      resultJson: JSON.stringify({ artifactId: artifact.id, cues: cues.length, spanSec: cues[cues.length - 1].end }),
      artifacts: [artifact],
    };
  },
};

// ------------------------------------------------------------
// ৮. validate_video — গুণমান পরীক্ষা
// ------------------------------------------------------------

const validateVideoSpec: ToolSpec<{
  video: string;
  expectedFps?: number;
}> = {
  name: 'validate_video',
  parameters: z.object({
    video: z.string().min(6).max(80),
    expectedFps: z.number().min(1).max(120).optional(),
  }),
  timeoutMs: 60_000,
  usage:
    '- validate_video: ভিডিওর গুণমান যাচাই — দৈর্ঘ্য, রেজোলিউশন (জোড় সংখ্যা), ফ্রেম-রেট, স্ট্রিম ও অডিও-উপস্থিতি; বাংলা রায় দেয়। arguments: {video: "<artifact আইডি>", expectedFps?: প্রত্যাশিত ফ্রেম-রেট}. ভিডিও তৈরি/সম্পাদনার পরে যাচাইয়ের জন্য।',
  inputSummary: i => `ভিডিও ${i.video.slice(0, 14)}…`,
  execute: async input => {
    const src = await artifactFilePath(input.video);
    if (src.kind !== 'video') throw new Error('validate_video-এর উৎস অবশ্যই ভিডিও artifact হতে হবে');
    const info = await mediaInfo(src.path);

    const checks: Record<string, boolean | string | number> = {};
    const problems: string[] = [];
    checks.durationSec = info.durationSec;
    checks.hasVideo = info.hasVideo;
    if (!info.hasVideo) problems.push('ভিডিও স্ট্রিম নেই');
    if (info.durationSec <= 0) problems.push('দৈর্ঘ্য শূন্য');
    if (info.width && info.width % 2 !== 0) problems.push(`প্রস্থ বিজোড় (${info.width})`);
    if (info.height && info.height % 2 !== 0) problems.push(`উচ্চতা বিজোড় (${info.height})`);
    if (input.expectedFps && info.fps) {
      checks.fpsOk = Math.abs(info.fps - input.expectedFps) <= 1;
      if (!checks.fpsOk) problems.push(`ফ্রেম-রেট ${info.fps} — প্রত্যাশিত ${input.expectedFps}`);
    }
    checks.hasAudio = info.hasAudio;

    const verdict =
      problems.length === 0
        ? `রায়: ঠিক আছে — ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}@${info.fps ?? '?'}FPS, কোডেক ${info.videoCodec}${info.hasAudio ? `, অডিও ${info.audioCodec}` : ', নীরব'}`
        : `রায়: সমস্যা পাওয়া গেছে — ${problems.join('; ')}`;
    return {
      summary: verdict,
      resultJson: JSON.stringify({
        artifactId: input.video,
        checks,
        problems,
        info: {
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          fps: info.fps,
          videoCodec: info.videoCodec,
          hasAudio: info.hasAudio,
          audioCodec: info.audioCodec,
          sampleRate: info.sampleRate,
          sizeBytes: info.sizeBytes,
        },
      }),
      artifacts: [],
    };
  },
};

// ------------------------------------------------------------
// ২খ. image_to_video — রেফারেন্স ছবি → প্রকৃত AI ভিডিও (§৪.১-B)
//     CogVideoX-3 image-to-video: ছবির পরিচয়/পোশাক যতটা সম্ভব ধরে
//     রেখে নতুন মোশন তৈরি হয় (প্রোব-যাচাইকৃত)।
// ------------------------------------------------------------

const imageToVideoSpec: ToolSpec<{
  image: string;
  motionPrompt: string;
  durationSec: number;
  withAudio: boolean;
}> = {
  name: 'image_to_video',
  parameters: z.object({
    image: z.string().min(1).max(120),
    motionPrompt: z.string().min(3).max(1200),
    durationSec: z.number().int().min(5).max(10).default(5),
    withAudio: z.boolean().default(false),
  }),
  timeoutMs: 900_000,
  usage:
    `- image_to_video: রেফারেন্স ছবি থেকে প্রকৃত AI ভিডিও (CogVideoX-3 image-to-video ডিফিউশন) — ছবির পরিচয়/পোশাক/পরিবেশ যতটা সম্ভব ধরে রেখে motionPrompt-এ বর্ণিত নড়াচড়া তৈরি হয়। প্রতিটি ক্লিপে ~২–৪ মিনিট লাগে। withAudio: true হলে মডেল-নির্মিত প্রকৃত AI-অডিওও আসে (প্রোব-যাচাইকৃত AAC স্ট্রিম; পরিবেশ-শব্দ/অ্যাম্বিয়েন্স ধাঁচের)। এটি animate_image-এর চেয়ে ভিন্ন — animate_image শুধু ক্যামেরা-মুভমেন্ট (Ken Burns) যোগ করে, নতুন মোশন তৈরি করে না। arguments: {image: "<ছবির artifact আইডি>", motionPrompt: "কী নড়াচড়া হবে — যেমন: এই চরিত্রটি বৃষ্টিতে হাঁটছে, ছাতা খুলছে, পেছনে তাকাচ্ছে", durationSec: 5|10 (ডিফল্ট 5), withAudio: true|false (ডিফল্ট false)}`,
  inputSummary: i => `ছবি→AI ভিডিও: ${truncate(i.motionPrompt, 50)} — ${i.durationSec}s${i.withAudio ? ' +নেটিভ-অডিও' : ''}`,
  execute: async (input, ctx) => {
    const src = await artifactFilePath(input.image);
    if (src.kind !== 'image') throw new Error('image_to_video-র উৎস অবশ্যই ছবি artifact হতে হবে');
    const { dataUrl } = await artifactToDataUrl(input.image);

    const tempDir = await makeTempDir('i2v-');
    try {
      let clip;
      let lastErr = '';
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          clip = await generateVideoClip({
            prompt: `${input.motionPrompt}. Keep the person, clothing and scene consistent with the reference image, realistic motion, cinematic quality, no text overlay`,
            durationSec: input.durationSec,
            imageUrl: dataUrl,
            quality: 'speed',
            withAudio: input.withAudio,
            requestKey: `i2v-${input.image}`,
          });
          ok = true;
        } catch (err: any) {
          lastErr = String(err?.message ?? err).slice(0, 160);
        }
      }
      if (!ok || !clip) {
        throw new Error(
          `AI image-to-video দুইবার ব্যর্থ (${lastErr})। সৎ বিকল্প: animate_image (ক্যামেরা-মোশন — নতুন মোশন তৈরি হয় না, তবে নির্ভরযোগ্য)।`
        );
      }
      // লক্ষ্য-মাত্রায় স্বাভাবিকীকরণ (কেন্দ্র-ক্রপ)
      const aspect = nearestAspect(clip.info.width ?? 720, clip.info.height ?? 1280);
      const dims = outputDims(aspect, '720p');
      const rawPath = path.join(tempDir, 'raw.mp4');
      await writeFile(rawPath, clip.buffer);
      const finalPath = path.join(tempDir, 'final.mp4');
      await runFfmpeg(
        [
          '-i', rawPath,
          '-vf',
          `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=increase,crop=${dims.w}:${dims.h},fps=30,setsar=1`,
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '20',
          finalPath,
        ],
        { timeoutMs: 180_000, label: 'i2v স্বাভাবিকীকরণ' }
      );
      const info = await mediaInfo(finalPath);
      const nativeAudioCame = input.withAudio && info.hasAudio;
      const artifact = await registerVideoArtifact({
        ctx,
        file: finalPath,
        fileName: `${sanitize(input.motionPrompt).slice(0, 32) || 'i2v'}.mp4`,
        metaJson: {
          tool: 'image_to_video',
          aiModel: AI_VIDEO_MODEL,
          sourceImage: input.image,
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          nativeAudio: input.withAudio ? Boolean(nativeAudioCame) : undefined,
          honestLabel:
            `প্রকৃত AI image-to-video (${AI_VIDEO_MODEL})` +
            (input.withAudio
              ? nativeAudioCame
                ? ' + মডেল-নির্মিত নেটিভ AI-অডিও'
                : ' (নেটিভ-অডিও চাওয়া হয়েছিল, আসেনি — সৎ-তথ্য)'
              : ''),
        },
      });
      return {
        summary: `ছবি থেকে AI ভিডিও তৈরি — ${info.durationSec.toFixed(1)} সে., ${info.width}×${info.height} (${AI_VIDEO_MODEL}, রেফারেন্স: ${src.fileName})` +
          (input.withAudio
            ? nativeAudioCame
              ? '; নেটিভ AI-অডিওসহ'
              : '; নেটিভ-অডিও আসেনি (সৎ-তথ্য)'
            : ''),
        resultJson: JSON.stringify({
          artifactId: artifact.id,
          aiModel: AI_VIDEO_MODEL,
          sourceImage: input.image,
          durationSec: info.durationSec,
          width: info.width,
          height: info.height,
          hasAudio: info.hasAudio,
          nativeAudio: input.withAudio ? Boolean(nativeAudioCame) : undefined,
        }),
        artifacts: [artifact],
      };
    } finally {
      await cleanupWorkingDir(tempDir);
    }
  },
};

// ------------------------------------------------------------
// ৯. lip_sync — §৫ সৎ-অবরুদ্ধ (মডেল নেই; কর্মপ্রবাহ-স্থাপত্যসহ)
// ------------------------------------------------------------

const lipSyncSpec: ToolSpec<{
  video?: string;
  image?: string;
  audio?: string;
  isSinging?: boolean;
}> = {
  name: 'lip_sync',
  parameters: z.object({
    video: z.string().max(80).optional(),
    image: z.string().max(80).optional(),
    audio: z.string().max(80).optional(),
    isSinging: z.boolean().optional(),
  }),
  timeoutMs: 10_000,
  usage:
    '- lip_sync: [অবরুদ্ধ — §৫] ঠোঁট-মিলানো মডেল এই পরিবেশে স্থাপিত নেই (GPU-বিহীন সার্ভার)। ডাকলে সৎ ক্ষমতা-প্রতিবেদন পাবে: পরিকল্পিত ৭-ধাপ ওয়ার্কফ্লো, গান-গাওয়ার জন্য অতিরিক্ত প্রয়োজনীয়তা, সম্মতি-নিয়ম ও প্রার্থী মডেল (MuseTalk)। বিকল্প: শর্টফিল্ম পাইপলাইন (সংলাপ-অডিও + সাবটাইটেলসহ AI ভিডিও), অথবা generate_subtitles। গায়কের মুখ নড়ছে — এমন দাবি কখনো করা হয় না। arguments: {image?: "চরিত্রের ছবি artifact", audio?: "সংলাপ-অডিও artifact", isSinging?: boolean}',
  inputSummary: i =>
    `লিপ-সিঙ্ক অনুরোধ (অবরুদ্ধ${i.isSinging ? ' — গান-গাওয়া' : ''})`,
  execute: async () => {
    // মিথ্যা সফলতা নয় — §৫-এর সৎ ক্ষমতা-প্রতিবেদন
    const report = lipSyncCapabilityReport();
    throw new Error(
      `লিপ-সিঙ্ক এখন অবরুদ্ধ। কারণ: ${report.reason} প্রার্থী মডেল: ${report.candidate.name} (${report.candidate.url}) — ${report.candidate.note} বিকল্প: শর্টফিল্ম পাইপলাইন (সংলাপ-অডিও + বাংলা সাবটাইটেলসহ AI ভিডিও) ব্যবহার করো।`
    );
  },
};

export const VIDEO_TOOLS: ToolSpec[] = [
  planVideoSpec,
  generateVideoSpec,
  imageToVideoSpec,
  animateImageSpec,
  processVideoSpec,
  enhanceVideoSpec,
  interpolateVideoSpec,
  generateSubtitlesSpec,
  validateVideoSpec,
  lipSyncSpec,
];
