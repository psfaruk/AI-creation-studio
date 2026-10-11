// ============================================================
// Video Studio tools — মাস্টার প্ল্যান §৫-এর বাস্তবায়ন।
// সৎ সত্য: এই পরিবেশে ডিফিউশন ভিডিও-মডেল নেই — ভিডিও তৈরি হয়
// AI স্টোরিবোর্ড ফ্রেম + সিনেম্যাটিক ক্যামেরা-মোশন (zoompan/Ken
// Burns) + FFmpeg অ্যাসেম্বলি দিয়ে। ব্যবহার-নির্দেশিকাও (usage)
// তা-ই বলে।
// ============================================================

import { z } from 'zod';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import type { ArtifactMeta } from '@/lib/types';
import { saveArtifactFile } from '../storage';
import { createToolArtifact, artifactFilePath } from '../registry-helpers';
import type { ToolContext, ToolSpec } from '../registry-helpers';
import { runFfmpeg, mediaInfo, makeTempDir, cleanupWorkingDir } from '@/lib/media/ffmpeg';
import { generateImageBuffer } from '../sdk-helpers';
import { ASPECT_TO_GEN_SIZE, outputDims, maxShots, SHOT_DURATION_HINT } from '../capabilities';
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
// ২. generate_video — আইডিয়া → ছোট ভিডিও (ইনলাইন মিনি-পাইপলাইন)
// সৎ পদ্ধতি: AI স্টোরিবোর্ড ফ্রেম + Ken Burns মোশন + FFmpeg
// ------------------------------------------------------------

const generateVideoSpec: ToolSpec<{
  idea: string;
  durationSec: number;
  aspect: (typeof ASPECTS)[number];
  cameraMove?: (typeof MOVES)[number];
  sound: 'none' | 'ambient';
  style?: string;
}> = {
  name: 'generate_video',
  parameters: z.object({
    idea: z.string().min(3).max(1500),
    durationSec: z.number().int().min(5).max(20),
    aspect: z.enum(ASPECTS).default('16:9'),
    cameraMove: z.enum(MOVES).optional(),
    sound: z.enum(['none', 'ambient']).default('none'),
    style: z.string().max(300).optional(),
  }),
  timeoutMs: 420_000,
  usage:
    '- generate_video: আইডিয়া থেকে ছোট ভিডিও (৫-২০ সেকেন্ড) তৈরি — পদ্ধতি: AI স্টোরিবোর্ড ফ্রেম + সিনেম্যাটিক ক্যামেরা-মোশন (Ken Burns zoompan) + FFmpeg অ্যাসেম্বলি (ডিফিউশন ভিডিও-মডেল নয়)। arguments: {idea: "আইডিয়া", durationSec: 5-20, aspect: "9:16"|"16:9"|"1:1"|"4:5"|"3:2" (ডিফল্ট "16:9"), cameraMove?: "zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"static" (সব শটে জোর করে), sound: "none"|"ambient" (ডিফল্ট "none", ambient = সৎ সংশ্লেষিত হালকা পরিবেশ-শব্দ), style?: "ভিজ্যুয়াল স্টাইল"}. বড়/দীর্ঘ ভিডিও (২০ সেকেন্ড+) বা মিউজিক ভিডিও/শর্টফিল্মের জন্য এটি নয় — propose_job ব্যবহার করো।',
  inputSummary: i => `${truncate(i.idea, 50)} — ${i.durationSec}s ${i.aspect}`,
  execute: async (input, ctx) => {
    const aspect = input.aspect;
    const dims = outputDims(aspect, '720p');
    const fps: 24 | 25 | 30 = 30;
    const shotCount = Math.max(1, Math.min(3, Math.round(input.durationSec / 6)));
    const tempDir = await makeTempDir('gen-video-');
    try {
      // ১) শট-প্ল্যান
      let shots = await shotPlanFromLLM(input.idea, {
        count: shotCount,
        durationHintSec: SHOT_DURATION_HINT.motion_video,
        maxCount: Math.min(shotCount, maxShots('motion_video', 'standard')),
        aspect,
        totalDurationSec: input.durationSec,
        context: `মোট ${input.durationSec} সেকেন্ড, ${shotCount}টি শট`,
      });
      shots = shots.slice(0, Math.max(1, Math.min(3, shots.length)));
      // দৈর্ঘ্য মোট টার্গেটে মানানসই
      const totalPlanned = shots.reduce((a, s) => a + s.durationSec, 0);
      if (Math.abs(totalPlanned - input.durationSec) > 0.5 && shots.length > 0) {
        const scale = input.durationSec / Math.max(0.1, totalPlanned);
        shots.forEach(s => (s.durationSec = Math.round(Math.max(1.5, Math.min(6, s.durationSec * scale)) * 10) / 10));
      }

      // ২) স্টোরিবোর্ড ফ্রেম
      const frames: string[] = [];
      for (let i = 0; i < shots.length; i++) {
        const prompt = imagePromptForShot(shots[i], input.style);
        const { buffer } = await generateImageBuffer(prompt, ASPECT_TO_GEN_SIZE[aspect]);
        const framePath = path.join(tempDir, `frame-${i}.png`);
        await writeFile(framePath, buffer);
        frames.push(framePath);
      }

      // ৩) Ken Burns মোশন ক্লিপ
      const clips: string[] = [];
      for (let i = 0; i < frames.length; i++) {
        const move: CameraMove = input.cameraMove ?? shots[i].cameraMove;
        const clipPath = path.join(tempDir, `clip-${i}.mp4`);
        await kenBurnsClip(frames[i], clipPath, {
          durationSec: shots[i].durationSec,
          fps,
          width: dims.w,
          height: dims.h,
          move,
        });
        clips.push(clipPath);
      }

      // ৪) কনক্যাট
      const silentPath = path.join(tempDir, 'silent.mp4');
      await concatClips(clips, silentPath, { transitionSec: 0.6 });

      // ৫) সাউন্ড (ঐচ্ছিক ambient) + চূড়ান্ত
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

      // ৬) যাচাই
      const info = await mediaInfo(finalPath);
      if (!info.hasVideo || info.durationSec < 1) throw new Error('ভিডিও রেন্ডার সঠিক হয়নি');

      const artifact = await registerVideoArtifact({
        ctx,
        file: finalPath,
        fileName: `${sanitize(input.idea).slice(0, 32) || 'motion'}.mp4`,
        metaJson: {
          tool: 'generate_video',
          durationSec: info.durationSec,
          aspect,
          width: info.width,
          height: info.height,
          shots: shots.length,
          method: 'AI storyboard frames + Ken Burns camera motion + FFmpeg',
        },
      });
      return {
        summary: `ভিডিও তৈরি — ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}, ${shots.length}টি শট (AI স্টোরিবোর্ড + ক্যামেরা-মোশন)`,
        resultJson: JSON.stringify({
          artifactId: artifact.id,
          durationSec: info.durationSec,
          shots: shots.length,
          aspect,
          sound: input.sound,
          hasAudio: info.hasAudio,
        }),
        artifacts: [artifact],
      };
    } finally {
      await cleanupWorkingDir(tempDir);
    }
  },
};

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
// ৯. lip_sync — GATED (লাইসেন্স/সম্মতি-নীতি)
// ------------------------------------------------------------

const lipSyncSpec: ToolSpec<{
  video?: string;
  image?: string;
  audio?: string;
}> = {
  name: 'lip_sync',
  parameters: z.object({
    video: z.string().max(80).optional(),
    image: z.string().max(80).optional(),
    audio: z.string().max(80).optional(),
  }),
  timeoutMs: 10_000,
  usage:
    '- lip_sync: [অবরুদ্ধ] ঠোঁট-মিলানো (lip-sync) মডেল — লাইসেন্স ও সম্মতি-নীতির কারণে এখন চালু নেই; ডাকলে সৎ ব্যাখ্যা পাবে। বিকল্প: ভিডিওতে সংলাপ-সাবটাইটেল (শর্টফিল্ম পাইপলাইন বা generate_subtitles) ব্যবহার করো।',
  inputSummary: () => 'লিপ-সিঙ্ক অনুরোধ (অবরুদ্ধ)',
  execute: async () => {
    throw new Error(
      'লিপ-সিঙ্ক মডেল লাইসেন্স/সম্মতি-নীতির কারণে এখন চালু নেই। বিকল্প: ভিডিওতে সংলাপ-সাবটাইটেল ব্যবহার করো (শর্টফিল্ম পাইপলাইন সাবটাইটেল বার্ন করে, অথবা generate_subtitles দিয়ে SRT বানিয়ে নিজে বসাতে পারো)।'
    );
  },
};

export const VIDEO_TOOLS: ToolSpec[] = [
  planVideoSpec,
  generateVideoSpec,
  animateImageSpec,
  processVideoSpec,
  enhanceVideoSpec,
  interpolateVideoSpec,
  generateSubtitlesSpec,
  validateVideoSpec,
  lipSyncSpec,
];
