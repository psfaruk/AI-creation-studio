// ============================================================
// Music video pipeline — মাস্টার প্ল্যান §১০ workflow
// গান বিশ্লেষণ → ব্রিফ → চরিত্র → স্টোরিবোর্ড → মোশন →
// গানের সাথে অ্যাসেম্বলি (crossfade, সঠিক দৈর্ঘ্য) → যাচাই।
// সৎ পদ্ধতি: AI স্টোরিবোর্ড + Ken Burns মোশন (ডিফিউশন নয়)।
// ============================================================

import path from 'path';
import type { PipelineFn, StepHandle } from '../runner';
import type { PlannedShot } from '../../film-helpers';
import {
  kenBurnsClip,
  concatClips,
  mixAudioTracks,
  muxAudio,
  imagePromptForShot,
  portraitPrompt,
  sanitize,
  segmentDialogueToCues,
  makeSrt,
  burnSubtitles,
  normalizeShotDurations,
} from '../../film-helpers';
import { generateImageBuffer, editImageBuffer, chatJson } from '../../sdk-helpers';
import { mediaInfo } from '@/lib/media/ffmpeg';
import { ASPECT_TO_GEN_SIZE, outputDims, maxShots } from '../../capabilities';

interface BriefShot extends PlannedShot {
  framePath?: string;
  clipPath?: string;
  character?: string | null;
}

interface BriefCharacter {
  name: string;
  appearance: string;
  portraitPath?: string;
  portraitDataUrl?: string;
}

export const musicVideoPipeline: PipelineFn = async ctx => {
  const spec = ctx.spec;
  const aspect = spec.aspect ?? '16:9';
  const fps = spec.fps ?? 30;
  const resolution = spec.quality === 'draft' ? '720p' : '1080p';
  const dims = outputDims(aspect, resolution);
  const wd = ctx.workingDir;
  const genSize = ASPECT_TO_GEN_SIZE[aspect];
  const crossfadeSec = 0.5;

  const notes: string[] = [];

  // ------------------------------------------------------- analyze_song
  let songPath: string | null = null;
  let songDuration = 0;
  let songMood = '';
  let targetDuration = 60;
  await ctx.runStep('analyze_song', 'গান বিশ্লেষণ (দৈর্ঘ্য/মুড)', async (step: StepHandle) => {
    if (spec.songArtifactId) {
      songPath = await ctx.resolveArtifactFile(spec.songArtifactId);
      const info = await mediaInfo(songPath);
      if (!info.hasAudio) throw new Error('আপলোড করা গানে অডিও স্ট্রিম পাওয়া যায়নি');
      songDuration = info.durationSec;
      targetDuration = Math.max(15, Math.min(180, Math.round(spec.durationSec && spec.durationSec > 0 ? spec.durationSec : songDuration)));
      await step.setDetail(`গান: ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.audioCodec}`);
      // LLM মুড/শক্তি বিশ্লেষণ (গানের নাম/ধারণা থেকে — আমরা অডিও-কনটেন্ট শুনতে পারি না)
      try {
        const { chatComplete } = await import('../../llm');
        songMood = (
          await chatComplete([
            {
              role: 'assistant',
              content:
                'মিউজিক ভিডিওর জন্য গানের আবেগ-বিশ্লেষণ: ২-৩টি বাক্যে বাংলায় লেখো গানটির সম্ভাব্য মুড, শক্তি ও ভিজ্যুয়াল-সুযোগ (দ্রষ্টব্য: তুমি অডিও ফাইল শুনতে পারো না — শিরোনাম/ধারণা থেকে বিশ্লেষণ করছ, তাই সৎ থাকো)।',
            },
            {
              role: 'user',
              content: `গান/ধারণা: ${spec.title}\nআইডিয়া: ${spec.idea ?? '(দেওয়া নেই)'}\nদৈর্ঘ্য: ${info.durationSec.toFixed(0)} সেকেন্ড`,
            },
          ])
        ).trim().slice(0, 600);
        await step.setDetail(songMood.slice(0, 200));
      } catch {
        songMood = '';
      }
    } else {
      targetDuration = Math.max(15, Math.min(180, spec.durationSec ?? 60));
      await step.setDetail('নীরব ভিডিও — কোনো গান আপলোড করা হয়নি');
      notes.push('গান ছাড়া মিউজিক ভিডিও — নীরব টাইমলাইন (সংগীত-সংশ্লেষণ মডেল লাইসেন্স-নীতিতে অবরুদ্ধ)।');
    }
  });

  // ------------------------------------------------------- brief
  let shots: BriefShot[] = [];
  let characters: BriefCharacter[] = [];
  let visualStyle = '';
  await ctx.runStep('brief', 'সৃজনশীল ব্রিফ ও শট-তালিকা', async (step: StepHandle) => {
    const count = Math.max(3, Math.min(maxShots('music_video', spec.quality), Math.round(targetDuration / 4)));
    const maxPortraits = spec.quality === 'draft' ? 1 : 2;
    const { data } = await chatJson<{
      mood: string;
      visualStyle: string;
      characters: { name: string; appearance: string }[];
      shots: { description: string; label: string; cameraMove: string; durationSec: number; character?: string }[];
    }>([
      {
        role: 'assistant',
        content:
          'তুমি মিউজিক-ভিডিও পরিচালক। গানের ব্রিফ থেকে ভিজ্যুয়াল-ধারণা ও শট-তালিকা বানাও। ' +
          `ঠিক ${count}টি শট, প্রতিটি ৩-৫ সেকেন্ড, যোগফল ≈ ${targetDuration} সেকেন্ড। ` +
          'cameraMove: "zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"static"। description ইংরেজিতে (ইমেজ-জেনারেশনের জন্য), label বাংলায়। ' +
          'শটগুলো গানের আবেগের সাথে মানানসই দৃশ্য-বিন্যাস হবে। ' +
          `যদি পুনরাবৃত্ত মানুষ-চরিত্র গল্পের জন্য জরুরি হয় তবে সর্বোচ্চ ${maxPortraits}টি চরিত্র দাও (না হলে খালি অ্যারে) — প্রতিটির বিস্তারিত appearance ইংরেজিতে। ` +
          'শটে character থাকলে সেই চরিত্রের নাম দাও। ' +
          'শুধুমাত্র JSON: {"mood":"...","visualStyle":"...","characters":[{"name":"...","appearance":"..."}],"shots":[{"description":"...","label":"...","cameraMove":"...","durationSec":4,"character":"নাম বা null"}]}',
      },
      {
        role: 'user',
        content:
          `শিরোনাম: ${spec.title}\nআইডিয়া: ${spec.idea ?? '(স্বাধীন)'}\nমোট দৈর্ঘ্য: ${targetDuration} সেকেন্ড\n` +
          (songMood ? `গান-বিশ্লেষণ: ${songMood}\n` : '') +
          (spec.style ? `শৈলী-ইঙ্গিত: ${spec.style}\n` : ''),
      },
    ]);

    const rawShots = Array.isArray(data?.shots) ? data.shots : [];
    const moves = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'];
    shots = rawShots
      .filter(s => String(s?.description ?? '').trim())
      .slice(0, maxShots('music_video', spec.quality))
      .map((s, i) => ({
        description: String(s.description).slice(0, 900),
        label: String(s?.label ?? '').slice(0, 120) || `শট ${i + 1}`,
        cameraMove: (moves as string[]).includes(String(s?.cameraMove)) ? (s.cameraMove as PlannedShot['cameraMove']) : (['zoom_in', 'pan_right', 'zoom_out', 'pan_left', 'static'] as const)[i % 5],
        durationSec: Math.max(2.5, Math.min(6, Number(s?.durationSec) || 4)),
        character: s?.character ? String(s.character).slice(0, 60) : null,
      }));
    if (shots.length === 0) {
      throw new Error('শট-তালিকা তৈরি হয়নি — আবার চেষ্টা করো');
    }
    // crossfade-সহ সঠিক মোট পূরণ: যোগফল = target + (n-1)*T
    const wanted = targetDuration + (shots.length - 1) * crossfadeSec;
    normalizeShotDurations(shots, wanted);
    visualStyle = String(data?.visualStyle ?? spec.style ?? '').slice(0, 200);

    const rawChars = Array.isArray(data?.characters) ? data.characters : [];
    characters = rawChars
      .filter(c => String(c?.name ?? '').trim() && String(c?.appearance ?? '').trim())
      .slice(0, maxPortraits)
      .map(c => ({ name: String(c.name).slice(0, 60), appearance: String(c.appearance).slice(0, 600) }));

    await step.setDetail(
      `${shots.length}টি শট${characters.length > 0 ? `, ${characters.length}টি চরিত্র` : ' (দৃশ্য-কেন্দ্রিক)'}`
    );
  });

  // ------------------------------------------------------- characters
  await ctx.runStep('characters', 'চরিত্র রেফারেন্স', async (step: StepHandle) => {
    if (characters.length === 0) {
      await step.setDetail('চরিত্র প্রয়োজন নেই — দৃশ্য-কেন্দ্রিক ব্রিফ');
      return;
    }
    const { writeFile } = await import('fs/promises');
    for (let i = 0; i < characters.length; i++) {
      await ctx.checkCancelled();
      const ch = characters[i];
      await step.setDetail(`${ch.name} — পোর্ট্রেট ${i + 1}/${characters.length}`);
      try {
        const { buffer } = await generateImageBuffer(portraitPrompt(ch.name, ch.appearance), '864x1152');
        const portraitPath = path.join(wd, `character-${i}.png`);
        await writeFile(portraitPath, buffer);
        await ctx.registerArtifact({
          buffer,
          kind: 'image',
          mimeType: 'image/png',
          fileName: `character-${sanitize(ch.name) || i + 1}.png`,
          metaJson: { characterName: ch.name, pipeline: 'music_video' },
        });
        ch.portraitPath = portraitPath;
        ch.portraitDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      } catch (err) {
        ctx.partialNotes.push(
          `চরিত্র "${ch.name}"-এর পোর্ট্রেট ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — দৃশ্য-প্রম্পট ব্যবহৃত হবে`
        );
      }
    }
  });

  // ------------------------------------------------------- storyboard
  await ctx.runStep('storyboard', 'স্টোরিবোর্ড ফ্রেম তৈরি', async (step: StepHandle) => {
    const { writeFile } = await import('fs/promises');
    const valid: BriefShot[] = [];
    for (let i = 0; i < shots.length; i++) {
      await ctx.checkCancelled();
      const shot = shots[i];
      await step.setDetail(`${i + 1}/${shots.length} ফ্রেম${shot.character ? ` (${shot.character})` : ''}`);
      const matching = shot.character ? characters.find(c => c.name === shot.character && c.portraitDataUrl) : null;
      let buffer: Buffer | null = null;
      const tryGen = async () => {
        if (matching?.portraitDataUrl) {
          // একই চরিত্র রাখতে এডিট-মডেল — মুখ/চুল/পোশাক অপরিবর্তিত
          return (
            await editImageBuffer(
              matching.portraitDataUrl,
              `Place this same character in: ${shot.description}. Keep the face, hair and outfit identical to the reference. Consistent character.`,
              genSize
            )
          ).buffer;
        }
        return (await generateImageBuffer(imagePromptForShot(shot, visualStyle || spec.style), genSize)).buffer;
      };
      try {
        buffer = await tryGen();
      } catch {
        try {
          buffer = await tryGen();
        } catch (err) {
          ctx.partialNotes.push(
            `শট ${i + 1}-এর ফ্রেম ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — শট বাদ`
          );
          continue;
        }
      }
      if (!buffer) continue;
      const framePath = path.join(wd, `frame-${i}.png`);
      await writeFile(framePath, buffer);
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
  await ctx.runStep('motion', 'মোশন ক্লিপ তৈরি', async (step: StepHandle) => {
    const valid: BriefShot[] = [];
    for (let i = 0; i < shots.length; i++) {
      await ctx.checkCancelled();
      const shot = shots[i];
      if (!shot.framePath) continue;
      await step.setDetail(`${i + 1}/${shots.length} ক্লিপ (${shot.cameraMove})`);
      const clipPath = path.join(wd, `clip-${i}.mp4`);
      try {
        await kenBurnsClip(shot.framePath, clipPath, {
          durationSec: shot.durationSec,
          fps,
          width: dims.w,
          height: dims.h,
          move: shot.cameraMove,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await kenBurnsClip(shot.framePath, clipPath, {
            durationSec: shot.durationSec,
            fps,
            width: dims.w,
            height: dims.h,
            move: shot.cameraMove,
          });
        } catch {
          ctx.partialNotes.push(`শট ${i + 1}-এর ক্লিপ ব্যর্থ (${msg.slice(0, 120)}) — বাদ`);
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
  let srtContent: string | null = null;
  await ctx.runStep('assemble', 'গানের সাথে টাইমলাইন সাজানো', async (step: StepHandle) => {
    await step.setDetail('ক্রসফেড-কনক্যাট (সঠিক দৈর্ঘ্য)');
    const silentPath = path.join(wd, 'assembled.mp4');
    await concatClips(shots.map(s => s.clipPath!), silentPath, { transitionSec: crossfadeSec });
    const vInfo = await mediaInfo(silentPath);
    finalDuration = vInfo.durationSec;

    // শেষ ক্লিপ ট্রিম করে সঠিক দৈর্ঘ্যে আনা (রাউন্ডিং-ত্রুটি সামলাতে)
    if (Math.abs(finalDuration - targetDuration) > 0.6) {
      const trimmed = path.join(wd, 'assembled-trim.mp4');
      const { runFfmpeg } = await import('@/lib/media/ffmpeg');
      await runFfmpeg(
        [
          '-i', silentPath,
          '-t', targetDuration.toFixed(2),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
          ...(vInfo.hasAudio ? ['-c:a', 'copy'] : ['-an']),
          trimmed,
        ],
        { timeoutMs: 240_000, label: 'চূড়ান্ত দৈর্ঘ্যে ট্রিম' }
      );
      finalVideo = trimmed;
      finalDuration = targetDuration;
    } else {
      finalVideo = silentPath;
    }

    // অডিও: গান → প্রধান ট্র্যাক; না থাকলে ambient বা নীরব
    if (songPath) {
      await step.setDetail('গান বসানো (ফেড-আউট-সহ)');
      const withSong = path.join(wd, 'with-song.mp4');
      await muxAudio(finalVideo, songPath, withSong, { durationSec: finalDuration, fadeOutSec: 2 });
      finalVideo = withSong;
    } else if (spec.sound === 'ambient') {
      await step.setDetail('পরিবেশ-শব্দ বিছানো');
      const audioPath = await mixAudioTracks({
        voiceFiles: [],
        ambient: true,
        durationSec: finalDuration,
        outputPath: path.join(wd, 'audio.wav'),
        duck: false,
      });
      if (audioPath) {
        const withAudio = path.join(wd, 'with-ambient.mp4');
        await muxAudio(finalVideo, audioPath, withAudio, { durationSec: finalDuration, fadeOutSec: 1.5 });
        finalVideo = withAudio;
      }
    }

    // সাবটাইটেল: লিরিক্স দেওয়া থাকলে এবং চাওয়া হলে
    if (spec.subtitles && spec.text && spec.text.trim().length > 3) {
      await step.setDetail('লিরিক্স থেকে সাবটাইটেল');
      try {
        const cues = await segmentDialogueToCues(spec.text, { totalDurationSec: finalDuration });
        srtContent = makeSrt(cues);
        const { writeFile } = await import('fs/promises');
        const srtPath = path.join(wd, 'lyrics.srt');
        await writeFile(srtPath, srtContent, 'utf-8');
        const burned = path.join(wd, 'subtitled.mp4');
        await burnSubtitles(finalVideo, srtPath, burned);
        finalVideo = burned;
      } catch (err) {
        ctx.partialNotes.push(
          `সাবটাইটেল বার্ন ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'})`
        );
      }
    } else if (spec.subtitles && !spec.text) {
      ctx.partialNotes.push('সাবটাইটেল চাওয়া হলেও লিরিক্স (text) দেওয়া হয়নি — বাদ');
    }
    await step.setDetail(`টাইমলাইন: ${finalDuration.toFixed(1)} সেকেন্ড`);
  });

  // ------------------------------------------------------- validate
  const result: Record<string, unknown> = {};
  await ctx.runStep('validate', 'চূড়ান্ত রেন্ডার ও যাচাই', async (step: StepHandle) => {
    await step.setDetail('মিডিয়া পরিদর্শন');
    const info = await mediaInfo(finalVideo);
    const problems: string[] = [];
    if (songPath && Math.abs(info.durationSec - songDuration) > 1.5) {
      ctx.partialNotes.push(
        `দৈর্ঘ্য ${info.durationSec.toFixed(1)} সে. বনাম গান ${songDuration.toFixed(1)} সে. — >১.৫ সে. আলাদা`
      );
      problems.push('দৈর্ঘ্য-বিচ্যুতি (গান)');
    }
    if (info.width !== dims.w || info.height !== dims.h) {
      ctx.partialNotes.push(`রেজোলিউশন ${info.width}×${info.height} — প্রত্যাশিত ${dims.w}×${dims.h}`);
      problems.push('রেজোলিউশন-বিচ্যুতি');
    }
    if (songPath && !info.hasAudio) {
      problems.push('গান থাকা সত্ত্বেও অডিও ট্র্যাক নেই');
    }

    // SRT আলাদা artifact হিসেবে
    if (srtContent) {
      await step.setDetail('SRT নিবন্ধন');
      await ctx.registerArtifact({
        buffer: Buffer.from(srtContent, 'utf-8'),
        kind: 'text',
        mimeType: 'application/x-subrip',
        fileName: 'lyrics.srt',
        metaJson: { pipeline: 'music_video', kind: 'lyrics' },
      });
    }

    await step.setDetail('MP4 নিবন্ধন');
    const { readFile } = await import('fs/promises');
    const buf = await readFile(finalVideo);
    const artifact = await ctx.registerArtifact({
      buffer: buf,
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: `${sanitize(spec.title || 'music-video').slice(0, 40)}.mp4`,
      metaJson: {
        pipeline: 'music_video',
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        aspect,
        shots: shots.length,
        song: !!songPath,
        subtitles: !!srtContent,
        method: 'AI storyboard frames + Ken Burns camera motion + FFmpeg assembly',
      },
    });

    const verdict =
      problems.length === 0
        ? `চমৎকার — ${shots.length}টি শট, ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}@${info.fps}FPS${info.hasAudio ? ', গান-সমন্বয় সহ' : ''}। (পদ্ধতি: AI স্টোরিবোর্ড + ক্যামেরা-মোশন)`
        : `কার্যকর, তবে সতর্কতা: ${problems.join(', ')}। ${info.durationSec.toFixed(1)} সেকেন্ড, ${shots.length}টি শট।`;
    result.quality = verdict;
    result.artifactId = artifact.id;
    result.durationSec = info.durationSec;
    result.shots = shots.length;
    result.aspect = aspect;
    result.hasAudio = info.hasAudio;
    result.notes = notes;
  });

  return { result };
};
