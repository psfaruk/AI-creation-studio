// ============================================================
// Short film pipeline — মাস্টার প্ল্যান §১১ workflow
// চিত্রনাট্য → দৃশ্য-বিভাজন → চরিত্র বাইবেল → স্টোরিবোর্ড →
// সংলাপ-কণ্ঠ → মোশন → ধারাবাহিকতা-পরীক্ষা → অ্যাসেম্বলি
// (ডাকড অডিও-মিক্স + বাংলা সাবটাইটেল বার্ন) → যাচাই।
//
// সৎ পদ্ধতি: AI স্টোরিবোর্ড ফ্রেম + Ken Burns ক্যামেরা-মোশন +
// TTS সংলাপ + FFmpeg অ্যাসেম্বলি। ডিফিউশন ভিডিও বা লিপ-সিঙ্ক নয়।
// ============================================================

import path from 'path';
import type { PipelineFn, StepHandle } from '../runner';
import {
  kenBurnsClip,
  concatClips,
  mixAudioTracks,
  muxAudio,
  imagePromptForShot,
  portraitPrompt,
  sanitize,
  makeSrt,
  burnSubtitles,
  normalizeShotDurations,
} from '../../film-helpers';
import { generateImageBuffer, editImageBuffer, synthesizeSpeech, chatJson, visionCompare } from '../../sdk-helpers';
import { mediaInfo } from '@/lib/media/ffmpeg';
import { outputDims, maxShots, ASPECT_TO_GEN_SIZE } from '../../capabilities';
import type { CameraMove } from '@/lib/types';

interface DialogueLine {
  character: string;
  line: string;
  emotion?: string;
}

interface Scene {
  index: number;
  location: string;
  timeOfDay: string;
  action: string;
  dialogue: DialogueLine[];
}

interface TimedLine extends DialogueLine {
  sceneIndex: number;
  filePath?: string;
  measuredSec: number;
  startSec: number;
  endSec: number;
}

interface FilmShot {
  sceneIndex: number;
  description: string;
  label: string;
  cameraMove: CameraMove;
  durationSec: number;
  characters: string[];
  // runtime
  framePath?: string;
  clipPath?: string;
  lines?: TimedLine[];
}

const MOVES: CameraMove[] = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'];
const VOICES = ['tongtong', 'jam', 'kazi'] as const;

export const shortFilmPipeline: PipelineFn = async ctx => {
  const spec = ctx.spec;
  const aspect = spec.aspect ?? '16:9';
  const fps = spec.fps ?? 24;
  const durationSec = Math.max(30, Math.min(120, spec.durationSec ?? 60));
  const subtitlesOn = spec.subtitles ?? true;
  const resolution = spec.quality === 'draft' ? '720p' : '1080p';
  const dims = outputDims(aspect, resolution);
  const genSize = ASPECT_TO_GEN_SIZE[aspect];
  const wd = ctx.workingDir;
  const crossfadeSec = 0.4;

  // ------------------------------------------------------- script_writer
  let title = spec.title;
  let logline = '';
  let scenes: Scene[] = [];
  const characterVoices: Record<string, string> = {};
  const characterAppearance: Record<string, string> = {};
  await ctx.runStep('script_writer', 'চিত্রনাট্য রচনা', async (step: StepHandle) => {
    // সংলাপ-বাজেট: ≈২.৫ অক্ষর/সেকেন্ড (কথা কম, দৃশ্য বেশি — সিনেম্যাটিক)
    const dialogueBudget = Math.round(durationSec * 2.5);
    const { data } = await chatJson<{
      title: string;
      logline: string;
      characters: { name: string; appearancePrompt: string; voice?: string }[];
      scenes: { index: number; location: string; timeOfDay: string; action: string; dialogue: { character: string; line: string; emotion?: string }[] }[];
    }>([
      {
        role: 'assistant',
        content:
          'তুমি একজন পুরস্কারজয়ী বাংলা চিত্রনাট্যকার। গল্প থেকে ছোট চলচ্চিত্রের চিত্রনাট্য লেখো।\n' +
          `মোট দৈর্ঘ্য ${durationSec} সেকেন্ড — সংলাপের মোট অক্ষর সর্বোচ্চ ${dialogueBudget}-এর মধ্যে রাখো (কথা কম, দৃশ্য বেশি)।\n` +
          '৩-৬টি দৃশ্য, প্রতিটিতে সংক্ষিপ্ত action (বাংলায়) ও সংলাপ। চরিত্র সর্বোচ্চ ৩জন।\n' +
          'প্রতিটি চরিত্রের appearancePrompt ইংরেজিতে বিস্তারিত (বাইবেল-পোর্ট্রেটের জন্য: বয়স, মুখ, চুল, পোশাক), voice এর একটি: "tongtong"|"jam"|"kazi"।\n' +
          'dialogue-র character অবশ্যই চরিত্র-তালিকার নাম হবে। সংলাপ বাংলায়।\n' +
          'শুধুমাত্র JSON: {"title":"...","logline":"...","characters":[{"name":"...","appearancePrompt":"...","voice":"tongtong"}],"scenes":[{"index":1,"location":"...","timeOfDay":"...","action":"...","dialogue":[{"character":"...","line":"...","emotion":"..."}]}]}',
      },
      { role: 'user', content: `গল্প: ${spec.story ?? spec.idea ?? spec.title}`.slice(0, 4000) },
    ]);
    if (!data || !Array.isArray(data.scenes) || data.scenes.length === 0) {
      throw new Error('চিত্রনাট্য তৈরি হয়নি');
    }
    title = String(data.title ?? title).slice(0, 120);
    logline = String(data.logline ?? '').slice(0, 400);
    const chars = Array.isArray(data.characters) ? data.characters : [];
    for (const c of chars.slice(0, 3)) {
      const name = String(c?.name ?? '').trim().slice(0, 60);
      if (!name) continue;
      const voice = VOICES.includes(String(c?.voice) as (typeof VOICES)[number]) ? String(c.voice) : spec.voice ?? 'tongtong';
      characterVoices[name] = voice;
      characterAppearance[name] = String(c?.appearancePrompt ?? `a character named ${name}`).slice(0, 600);
    }
    scenes = data.scenes.slice(0, 6).map((s, i) => ({
      index: Number(s?.index) || i + 1,
      location: String(s?.location ?? '').slice(0, 120),
      timeOfDay: String(s?.timeOfDay ?? 'দিন').slice(0, 40),
      action: String(s?.action ?? '').slice(0, 600),
      dialogue: (Array.isArray(s?.dialogue) ? s.dialogue : [])
        .filter((d: DialogueLine) => String(d?.line ?? '').trim())
        .slice(0, 5)
        .map((d: DialogueLine) => ({
          character: String(d?.character ?? '').slice(0, 60),
          line: String(d?.line ?? '').slice(0, 300),
          emotion: d?.emotion ? String(d.emotion).slice(0, 40) : undefined,
        })),
    }));
    await step.setDetail(`"${title}" — ${scenes.length}টি দৃশ্য, ${Object.keys(characterVoices).length}টি চরিত্র`);

    // চিত্রনাট্য artifact — ব্যবহারকারীর পাঠযোগ্য দলিল
    const doc = [
      `${title}`,
      logline ? `লগলাইন: ${logline}` : '',
      `দৈর্ঘ্য-লক্ষ্য: ${durationSec} সেকেন্ড · অনুপাত ${aspect} · ${fps}fps`,
      '',
      ...scenes.flatMap(s => [
        `দৃশ্য ${s.index} — ${s.location} (${s.timeOfDay})`,
        s.action,
        ...(s.dialogue.length > 0
          ? s.dialogue.map(d => `${d.character}${d.emotion ? ` (${d.emotion})` : ''}: "${d.line}"`)
          : ['(সংলাপহীন দৃশ্য)']),
        '',
      ]),
    ]
      .filter(l => l !== '')
      .join('\n');
    await ctx.registerArtifact({
      buffer: Buffer.from(doc, 'utf-8'),
      kind: 'text',
      mimeType: 'text/plain',
      fileName: 'screenplay.txt',
      metaJson: { pipeline: 'short_film', scenes: scenes.length },
    });
  });

  // ------------------------------------------------------- scene_breakdown
  let shots: FilmShot[] = [];
  await ctx.runStep('scene_breakdown', 'দৃশ্য ও শট বিভাজন', async (step: StepHandle) => {
    const maxShotCount = maxShots('short_film', spec.quality);
    const count = Math.max(3, Math.min(maxShotCount, Math.round(durationSec / 6)));
    const { data } = await chatJson<{
      shots: { sceneIndex: number; description: string; label?: string; cameraMove: string; durationSec: number; characters?: string[] }[];
    }>([
      {
        role: 'assistant',
        content:
          'তুমি চিত্রনাট্য থেকে শট-তালিকা বানাও (shot breakdown)।\n' +
          `ঠিক ${count}টি শট (সর্বোচ্চ ${maxShotCount}), প্রতিটি ৩-৭ সেকেন্ড, যোগফল ≈ ${durationSec} সেকেন্ড।\n` +
          'প্রতিটি দৃশ্য কমপক্ষে একটি শট পাবে। description ইংরেজিতে (সেই দৃশ্যের দৃশ্যমান বিষয়: পরিবেশ, চরিত্রের অবস্থান/ভঙ্গি, আলো — ইমেজ-জেনারেশনের জন্য), label বাংলায়।\n' +
          'cameraMove: "zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"static"। দৃশ্যে উপস্থিত চরিত্রের নাম characters-এ।\n' +
          'শুধুমাত্র JSON: {"shots":[{"sceneIndex":1,"description":"...","label":"...","cameraMove":"zoom_in","durationSec":5,"characters":["নাম"]}]}',
      },
      {
        role: 'user',
        content:
          `চিত্রনাট্য (${durationSec} সেকেন্ড, ${count}টি শট):\n` +
          scenes
            .map(
              s =>
                `দৃশ্য ${s.index} (${s.location}, ${s.timeOfDay}): ${s.action} [সংলাপ: ${
                  s.dialogue.map(d => `${d.character}: ${d.line}`).join(' | ') || 'নেই'
                }]`
            )
            .join('\n'),
      },
    ]);
    const rawShots = Array.isArray(data?.shots) ? data.shots : [];
    shots = rawShots
      .filter(s => String(s?.description ?? '').trim())
      .slice(0, maxShotCount)
      .map((s, i) => ({
        sceneIndex: Number(s?.sceneIndex) || scenes[0]?.index || 1,
        description: String(s.description).slice(0, 900),
        label: String(s?.label ?? '').slice(0, 120) || `শট ${i + 1}`,
        cameraMove: MOVES.includes(String(s?.cameraMove) as CameraMove) ? (s.cameraMove as CameraMove) : MOVES[i % MOVES.length],
        durationSec: Math.max(3, Math.min(7, Number(s?.durationSec) || 5)),
        characters: (Array.isArray(s?.characters) ? s.characters : []).map(c => String(c).slice(0, 60)).slice(0, 3),
      }));
    if (shots.length === 0) throw new Error('শট-বিভাজন তৈরি হয়নি');
    normalizeShotDurations(shots, durationSec);
    await step.setDetail(`${shots.length}টি শট, যোগফল ≈ ${shots.reduce((a, s) => a + s.durationSec, 0).toFixed(1)} সে.`);
  });

  // ------------------------------------------------------- character_bible
  interface Bible {
    name: string;
    portraitDataUrl?: string;
  }
  const bible: Bible[] = [];
  await ctx.runStep('character_bible', 'চরিত্র বাইবেল ও পোর্ট্রেট', async (step: StepHandle) => {
    // শটে আসলে যে চরিত্রগুলো দরকার (সর্বোচ্চ ৩)
    const needed = new Set<string>();
    for (const shot of shots) {
      for (const name of shot.characters) needed.add(name);
    }
    const selected = Object.keys(characterVoices).filter(n => needed.has(n)).slice(0, 3);
    if (selected.length === 0) {
      await step.setDetail('কোনো চরিত্র পোর্ট্রেট লাগবে না');
      return;
    }
    const { writeFile } = await import('fs/promises');
    for (let i = 0; i < selected.length; i++) {
      await ctx.checkCancelled();
      const name = selected[i];
      await step.setDetail(`${name} — পোর্ট্রেট ${i + 1}/${selected.length}`);
      const entry: Bible = { name };
      try {
        const { buffer } = await generateImageBuffer(portraitPrompt(name, characterAppearance[name] ?? `character "${name}"`), '864x1152');
        entry.portraitDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
        const p = path.join(wd, `bible-${i}.png`);
        await writeFile(p, buffer);
        await ctx.registerArtifact({
          buffer,
          kind: 'image',
          mimeType: 'image/png',
          fileName: `bible-${sanitize(name) || i + 1}.png`,
          metaJson: { characterName: name, voice: characterVoices[name], pipeline: 'short_film', kind: 'character-bible' },
        });
        bible.push(entry);
      } catch (err) {
        ctx.partialNotes.push(
          `চরিত্র "${name}"-এর পোর্ট্রেট ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — দৃশ্য-প্রম্পট ব্যবহৃত হবে`
        );
      }
    }
    await step.setDetail(`${bible.length}টি পোর্ট্রেট সম্পন্ন`);
  });

  // ------------------------------------------------------- storyboard
  await ctx.runStep('storyboard', 'স্টোরিবোর্ড তৈরি', async (step: StepHandle) => {
    const { writeFile } = await import('fs/promises');
    const valid: FilmShot[] = [];
    for (let i = 0; i < shots.length; i++) {
      await ctx.checkCancelled();
      const shot = shots[i];
      await step.setDetail(`${i + 1}/${shots.length} ফ্রেম${shot.characters.length > 0 ? ` (${shot.characters.join(', ')})` : ''}`);
      const matching = shot.characters.map(c => bible.find(b => b.name === c)).find(Boolean);
      let buffer: Buffer | null = null;
      const tryGen = async () => {
        if (matching?.portraitDataUrl) {
          return (
            await editImageBuffer(
              matching.portraitDataUrl,
              `Same person (identical face, hair, outfit) now in: ${shot.description}. Keep the character consistent with the reference portrait.`,
              genSize
            )
          ).buffer;
        }
        return (await generateImageBuffer(imagePromptForShot(shot, spec.style), genSize)).buffer;
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
        metaJson: { shot: i + 1, of: shots.length, sceneIndex: shot.sceneIndex, cameraMove: shot.cameraMove, label: shot.label },
      });
      valid.push({ ...shot, framePath });
    }
    if (valid.length === 0) throw new Error('কোনো স্টোরিবোর্ড ফ্রেমই তৈরি হয়নি');
    shots = valid;
    await step.setDetail(`${valid.length}টি ফ্রেম সম্পন্ন`);
  });

  // ------------------------------------------------------- speech
  const timedLines: TimedLine[] = [];
  await ctx.runStep('speech', 'সংলাপ/ভয়েসওভার তৈরি', async (step: StepHandle) => {
    const allLines: (DialogueLine & { sceneIndex: number })[] = [];
    for (const scene of scenes) {
      for (const d of scene.dialogue) allLines.push({ ...d, sceneIndex: scene.index });
    }
    // সংলাপ না থাকলে লগলাইন থেকে বর্ণনকারী-লাইন
    if (allLines.length === 0 && logline) {
      allLines.push({
        character: Object.keys(characterVoices)[0] ?? 'নরেটর',
        line: logline.slice(0, 300),
        emotion: 'বর্ণনা',
        sceneIndex: scenes[0]?.index ?? 1,
      });
    }
    if (allLines.length === 0) {
      await step.setDetail('কোনো সংলাপ নেই — নীরব চলচ্চিত্র');
      return;
    }
    const { writeFile } = await import('fs/promises');
    let done = 0;
    for (let i = 0; i < allLines.length; i++) {
      await ctx.checkCancelled();
      const d = allLines[i];
      await step.setDetail(`${i + 1}/${allLines.length} লাইন সংশ্লেষিত — ${d.character}`);
      const voice = (characterVoices[d.character] ?? spec.voice ?? 'tongtong') as (typeof VOICES)[number];
      try {
        const speech = await synthesizeSpeech(d.line, voice, 1);
        const filePath = path.join(wd, `line-${i}.wav`);
        await writeFile(filePath, speech.buffer);
        const info = await mediaInfo(filePath);
        timedLines.push({ ...d, filePath, measuredSec: info.durationSec, startSec: 0, endSec: 0 });
        done++;
      } catch (err) {
        ctx.partialNotes.push(
          `"${d.character}"-এর লাইন ${i + 1} TTS ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — শুধু সাবটাইটেলে থাকবে`
        );
        timedLines.push({ ...d, measuredSec: Math.max(1.5, d.line.length / 14), startSec: 0, endSec: 0 });
      }
    }
    await step.setDetail(`${done}/${allLines.length} লাইন সফল`);
  });

  // সংলাপ→শট বণ্টন + শট-দৈর্ঘ্য সমন্বয় (মোশনের আগেই স্থির হয়)
  const assignLinesAndDurations = () => {
    for (const shot of shots) shot.lines = [];
    const byScene = new Map<number, TimedLine[]>();
    for (const l of timedLines) {
      if (!byScene.has(l.sceneIndex)) byScene.set(l.sceneIndex, []);
      byScene.get(l.sceneIndex)!.push(l);
    }
    const stray: TimedLine[] = [];
    for (const scene of scenes) {
      const sceneShots = shots.filter(s => s.sceneIndex === scene.index);
      const lines = byScene.get(scene.index) ?? [];
      if (sceneShots.length === 0) {
        stray.push(...lines);
        continue;
      }
      let li = 0;
      for (const shot of sceneShots) {
        while (li < lines.length) {
          const line = lines[li];
          const used = (shot.lines ?? []).reduce((a, l) => a + l.measuredSec + 0.25, 0);
          if (used + line.measuredSec + 0.3 <= shot.durationSec || (shot.lines ?? []).length === 0) {
            shot.lines!.push(line);
            li++;
          } else {
            break;
          }
        }
      }
      // দৃশ্যের বাকি লাইন ওই দৃশ্যের শেষ শটে
      while (li < lines.length) {
        sceneShots[sceneShots.length - 1].lines!.push(lines[li]);
        li++;
      }
    }
    for (const l of stray) shots[shots.length - 1].lines!.push(l);
    // শট-দৈর্ঘ্য = max(পরিকল্পিত, নিজের লাইনের মোট + ০.৪)
    for (const shot of shots) {
      const linesDur = (shot.lines ?? []).reduce((a, l) => a + l.measuredSec + 0.25, 0);
      shot.durationSec = Math.round(Math.max(shot.durationSec, linesDur + 0.4) * 10) / 10;
    }
  };

  // চূড়ান্ত টাইমলাইন-অফসেট (crossfade সংকোচন হিসাবে) — assemble-এ
  const computeOffsets = () => {
    let prefix = 0;
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const shotStart = Math.max(0, prefix - i * crossfadeSec);
      let cursor = shotStart + 0.15;
      for (const line of shot.lines ?? []) {
        line.startSec = Math.round(cursor * 100) / 100;
        line.endSec = Math.round((cursor + line.measuredSec) * 100) / 100;
        cursor += line.measuredSec + 0.25;
      }
      prefix += shot.durationSec;
    }
    return Math.max(1, prefix - (shots.length - 1) * crossfadeSec);
  };

  // ------------------------------------------------------- motion
  await ctx.runStep('motion', 'শট-প্রতি মোশন ক্লিপ', async (step: StepHandle) => {
    assignLinesAndDurations();
    const valid: FilmShot[] = [];
    for (let i = 0; i < shots.length; i++) {
      await ctx.checkCancelled();
      const shot = shots[i];
      if (!shot.framePath) continue;
      await step.setDetail(`${i + 1}/${shots.length} ক্লিপ (${shot.cameraMove}, ${shot.durationSec.toFixed(1)} সে.)`);
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

  // ------------------------------------------------------- continuity
  const continuityWarnings: string[] = [];
  await ctx.runStep('continuity', 'ধারাবাহিকতা পরীক্ষা', async (step: StepHandle) => {
    const characterShots = shots.filter(s => s.characters.length > 0).slice(0, 3);
    if (characterShots.length === 0 || bible.length === 0) {
      await step.setDetail('চরিত্র-ধারাবাহিকতা পরীক্ষার মতো নমুনা নেই');
      return;
    }
    const { readFile } = await import('fs/promises');
    let checked = 0;
    for (const shot of characterShots) {
      const match = shot.characters.map(c => bible.find(b => b.name === c)).find(Boolean);
      if (!match?.portraitDataUrl || !shot.framePath) continue;
      await ctx.checkCancelled();
      await step.setDetail(`${shot.label} — ফ্রেম পরীক্ষা ${checked + 1}/${characterShots.length}`);
      try {
        const frameBuf = await readFile(shot.framePath);
        const frameDataUrl = `data:image/png;base64,${frameBuf.toString('base64')}`;
        const answer = await visionCompare(
          match.portraitDataUrl,
          frameDataUrl,
          `প্রথম ছবিটি রেফারেন্স চরিত্র "${match.name}"-এর পোর্ট্রেট, দ্বিতীয়টি একটি সিনেম্যাটিক ফ্রেম। দ্বিতীয় ফ্রেমে কি একই ব্যক্তি (মুখ/চুল/পোশাক) ধারাবাহিকভাবে আছে? বাংলায় ১ বাক্যে সৎ উত্তর দাও — মিললে কী মিলেছে, না মিললে কী অমিল।`
        );
        if (answer) continuityWarnings.push(`${shot.label}: ${answer.slice(0, 160)}`);
        checked++;
      } catch (err) {
        continuityWarnings.push(`${shot.label}: পরীক্ষা ব্যর্থ (${err instanceof Error ? err.message.slice(0, 80) : 'অজানা'})`);
      }
    }
    await step.setDetail(`${checked}টি ফ্রেম পরীক্ষিত — সতর্কতা অ-বাধামূলক`);
  });

  // ------------------------------------------------------- assemble
  let finalVideo = '';
  let finalDuration = 0;
  let srtContent: string | null = null;
  await ctx.runStep('assemble', 'টাইমলাইন অ্যাসেম্বলি ও সাউন্ড ডিজাইন', async (step: StepHandle) => {
    await step.setDetail('সংলাপ-টাইমলাইন হিসাব');
    const total = computeOffsets();

    await step.setDetail(`${shots.length}টি শট জোড়া (${crossfadeSec} সে. ক্রসফেড)`);
    const silentPath = path.join(wd, 'assembled.mp4');
    await concatClips(shots.map(s => s.clipPath!), silentPath, { transitionSec: crossfadeSec });
    const vInfo = await mediaInfo(silentPath);
    finalDuration = vInfo.durationSec;
    finalVideo = silentPath;

    // অডিও-মিক্স: সংলাপ অফসেটে + পরিবেশ-শব্দ (ডাকড)
    const voiceFiles = timedLines.filter(l => l.filePath).map(l => ({ file: l.filePath!, startSec: l.startSec }));
    if (voiceFiles.length > 0 || spec.sound !== 'none') {
      await step.setDetail(`${voiceFiles.length}টি কণ্ঠ + পরিবেশ-শব্দ মিক্স`);
      const audioPath = await mixAudioTracks({
        voiceFiles,
        ambient: true,
        durationSec: finalDuration,
        outputPath: path.join(wd, 'audio.wav'),
        duck: true,
      });
      if (audioPath) {
        const withAudio = path.join(wd, 'with-audio.mp4');
        await muxAudio(finalVideo, audioPath, withAudio, { durationSec: finalDuration, fadeOutSec: 1.2 });
        finalVideo = withAudio;
      }
    }

    // সাবটাইটেল: সংলাপ-টাইমলাইন থেকে SRT → libass বার্ন
    if (subtitlesOn && timedLines.length > 0) {
      await step.setDetail('বাংলা সাবটাইটেল বার্ন');
      const cues = timedLines
        .filter(l => l.line.trim())
        .map(l => ({
          start: l.startSec,
          end: Math.max(l.startSec + 0.8, l.endSec),
          text: `${l.character}: ${l.line}`,
        }));
      srtContent = makeSrt(cues);
      const { writeFile } = await import('fs/promises');
      const srtPath = path.join(wd, 'dialogue.srt');
      await writeFile(srtPath, srtContent, 'utf-8');
      try {
        const burned = path.join(wd, 'subtitled.mp4');
        await burnSubtitles(finalVideo, srtPath, burned);
        finalVideo = burned;
      } catch (err) {
        ctx.partialNotes.push(
          `সাবটাইটেল বার্ন ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — SRT আলাদাভাবে থাকবে`
        );
      }
    }
    await step.setDetail(`চূড়ান্ত টাইমলাইন: ${finalDuration.toFixed(1)} সেকেন্ড (হিসাব ${total.toFixed(1)})`);
  });

  // ------------------------------------------------------- validate
  const result: Record<string, unknown> = {};
  await ctx.runStep('validate', 'চূড়ান্ত রেন্ডার ও যাচাই', async (step: StepHandle) => {
    await step.setDetail('মিডিয়া পরিদর্শন');
    const info = await mediaInfo(finalVideo);
    const problems: string[] = [];
    if (!info.hasVideo) problems.push('ভিডিও স্ট্রিম নেই');
    if (Math.abs(info.durationSec - durationSec) > 3) {
      ctx.partialNotes.push(
        `দৈর্ঘ্য ${info.durationSec.toFixed(1)} সে. — লক্ষ্য ${durationSec} সে. থেকে >৩ সে. আলাদা (সংলাপ-সময়ের কারণে হতে পারে)`
      );
      problems.push('দৈর্ঘ্য-বিচ্যুতি');
    }
    if (info.width !== dims.w || info.height !== dims.h) {
      ctx.partialNotes.push(`রেজোলিউশন ${info.width}×${info.height} — প্রত্যাশিত ${dims.w}×${dims.h}`);
      problems.push('রেজোলিউশন-বিচ্যুতি');
    }
    if (timedLines.some(l => l.filePath) && !info.hasAudio) {
      problems.push('সংলাপ থাকা সত্ত্বেও অডিও ট্র্যাক নেই');
    }

    if (srtContent) {
      await step.setDetail('SRT নিবন্ধন');
      await ctx.registerArtifact({
        buffer: Buffer.from(srtContent, 'utf-8'),
        kind: 'text',
        mimeType: 'application/x-subrip',
        fileName: `${sanitize(title).slice(0, 32) || 'film'}-dialogue.srt`,
        metaJson: { pipeline: 'short_film', kind: 'dialogue', lines: timedLines.length },
      });
    }

    await step.setDetail('চূড়ান্ত MP4 নিবন্ধন');
    const { readFile } = await import('fs/promises');
    const buf = await readFile(finalVideo);
    const artifact = await ctx.registerArtifact({
      buffer: buf,
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: `${sanitize(title).slice(0, 40) || 'short-film'}.mp4`,
      metaJson: {
        pipeline: 'short_film',
        title,
        logline,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        aspect,
        shots: shots.length,
        scenes: scenes.length,
        subtitles: !!srtContent,
        method: 'AI storyboard frames + Ken Burns camera motion + TTS dialogue + FFmpeg assembly',
      },
    });

    const verdict =
      problems.length === 0
        ? `চমৎকার — ${shots.length}টি শট, ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}@${info.fps}FPS${info.hasAudio ? ', সংলাপ-সাউন্ড-সহ' : ''}${srtContent ? ', বাংলা সাবটাইটেল-সহ' : ''}। (পদ্ধতি: AI স্টোরিবোর্ড + ক্যামেরা-মোশন + TTS)`
        : `কার্যকর, তবে সতর্কতা: ${problems.join(', ')}। ${info.durationSec.toFixed(1)} সেকেন্ড, ${shots.length}টি শট।`;
    result.quality = verdict;
    result.artifactId = artifact.id;
    result.title = title;
    result.characters = Object.keys(characterVoices);
    result.durationSec = info.durationSec;
    result.shots = shots.length;
    result.continuityWarnings = continuityWarnings;
  });

  return { result };
};
