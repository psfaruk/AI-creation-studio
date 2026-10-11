// ============================================================
// Short film pipeline — নতুন মাস্টার প্ল্যান §৭ (৮-স্তর ফিল্ম প্রোডাকশন)
//
//  ১ script_breakdown — চিত্রনাট্য → পূর্ণ-ফিল্ড দৃশ্য-তালিকা
//    ({location, timeOfDay, characters, dialogues, actingNotes,
//    cameraWork, ambientSound, musicCue, estimatedSec}) + শট-বিভাজন
//  ২ character_bible — Character-টেবিল থেকে পোর্ট্রেট পুনঃব্যবহার,
//    নতুন হলে পোর্ট্রেট artifact + db.character.upsert (§৭.২)
//  ৩ acting_plan — প্রতি শটে অভিনয়-নির্দেশনা
//    ({who, action, gaze, bodyHands, facialExpression, speaks, cameraMotion})
//  ৪ speech — ভাষা-নিয়ন্ত্রক দিয়ে সংলাপ (synthesizeVerifiedSpeech —
//    প্রতি কণ্ঠে প্রথম লাইন যাচাই-সহ, বাকিগুলো সরল TTS);
//    প্রতি লাইন আলাদা artifact, রায় metaJson-এ; sound==='narration'
//    হলে A5 বর্ণনা-ট্র্যাক
//  ৫ generate_shots — ai_diffusion (চরিত্র-পোর্ট্রেট i2v) বা
//    cinematic_motion; সৎ-ফলব্যাক ও shotEngineLabels-সহ
//  ৬ sound_design — §৮ ৫-স্তর: A1 সংলাপ · A2 পরিবেশ · A3 ফোলে ·
//    A4 মিউজিক (মুড-কিউ ভিন্ন হলে দৃশ্য-ভিত্তিক টুকরো) · A5 বর্ণনা —
//    mixSoundLayers + DEFAULT_MIX_RULES (ডাকিংসহ)
//  ৭ continuity — VLM ধারাবাহিকতা-যাচাই (রেফারেন্স পোর্ট্রেট বনাম শট-ফ্রেম)
//  ৮ final_mix — ভিডিও টাইমলাইন + ৫-স্তর মিক্স (aac, মাপ-মিলানো),
//    বাংলা সাবটাইটেল বার্ন, §১১ স্তর-A প্রতিবেদন
//
// সততা: লিপ-সিঙ্ক নেই — কথা-বলা শটে মুখের নড়াচড়ার দাবি নয়;
// মিউজিক/পরিবেশ-শব্দ প্রসিডিউরাল সংশ্লেষিত (সৎ লেবেলসহ)।
// ============================================================

import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import type { PipelineFn, StepHandle } from '../runner';
import {
  kenBurnsClip,
  concatClips,
  muxAudio,
  imagePromptForShot,
  portraitPrompt,
  sanitize,
  makeSrt,
  burnSubtitles,
  normalizeShotDurations,
  segmentDialogueToCues,
} from '../../film-helpers';
import { generateImageBuffer, editImageBuffer, synthesizeSpeech, chatJson, visionCompare } from '../../sdk-helpers';
import type { TtsVoice } from '../../sdk-helpers';
import type { CameraMove, FilmMode } from '@/lib/types';
import { ffprobeJson, mediaInfo, runFfmpeg } from '@/lib/media/ffmpeg';
import { ASPECT_TO_GEN_SIZE, outputDims, maxShots } from '../../capabilities';
import { AI_VIDEO_MODEL } from '../../video/ai_video';
import { generateAiShot, buildAiVideoPrompt, toDataUrl } from './motion_video';
import {
  synthesizeVerifiedSpeech,
  resolveVoice,
  verdictLabel,
  type SpeechVerification,
  type SpeechLanguage,
} from '../../audio/language_controller';
import {
  synthesizeInstrumental,
  detectMoodFromText,
  moodLabel,
  type MusicMood,
} from '../../audio/music_engine';
import {
  planSoundscape,
  renderSoundscapeBed,
  mixSoundLayers,
  DEFAULT_MIX_RULES,
  type MixLayer,
  type SoundMixReport,
} from '../../audio/sound_design';
import { db } from '@/lib/db';

// ------------------------------------------------------------
// টাইপ
// ------------------------------------------------------------

interface DialogueLine {
  character: string;
  line: string;
  emotion?: string;
}

interface Scene {
  index: number;
  location: string;
  timeOfDay: string;
  characters: string[];
  action: string;
  actingNotes: string;
  cameraWork: string;
  ambientSound: string;
  musicCue: string;
  estimatedSec: number;
  dialogue: DialogueLine[];
  /** চূড়ান্ত টাইমলাইনে দৃশ্যের শুরু (generate_shots-এর পরে বসে) */
  startSec?: number;
  endSec?: number;
}

interface ActingDirection {
  who: string;
  action: string;
  gaze: string;
  bodyHands: string;
  facialExpression: string;
  speaks: boolean;
  cameraMotion: string;
}

interface FilmShot {
  sceneIndex: number;
  description: string;
  label: string;
  cameraMove: CameraMove;
  durationSec: number;
  characters: string[];
  acting?: ActingDirection;
  framePath?: string;
  clipPath?: string;
}

interface TimedLine extends DialogueLine {
  sceneIndex: number;
  filePath?: string;
  measuredSec: number;
  startSec: number;
  endSec: number;
}

interface BibleEntry {
  name: string;
  portraitDataUrl?: string;
  portraitPath?: string;
  reused: boolean;
}

const MOVES: CameraMove[] = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right', 'static'];
const round2 = (v: number) => Math.round(v * 100) / 100;

const FILM_MODE_DIRECTION: Record<FilmMode, string> = {
  short_film: 'পূর্ণ কাঠামোর ছোট চলচ্চিত্র — সূচনা, উত্তরণ, সমাপ্তি।',
  dialogue_scene: 'একটি টানা সংলাপ-দৃশ্য — দুই/তিন চরিত্রের কথোপকথনেই আবেগ-উত্তরণ।',
  trailer: 'দ্রুত কাটের টিজার/ট্রেইলার — ছোট ছোট আকর্ষণীয় শট, শেষে এক লাইনের ট্যাগ-লাইন।',
  story: 'গল্প-কেন্দ্রিক আখ্যান — দৃশ্যপট ও আবেগ প্রধান, সংলাপ কম।',
};

// ------------------------------------------------------------
// পাইপলাইন
// ------------------------------------------------------------

export const shortFilmPipeline: PipelineFn = async ctx => {
  const spec = ctx.spec;
  const aspect = spec.aspect ?? '16:9';
  const fps = spec.fps ?? 24;
  const durationSec = Math.max(30, Math.min(120, spec.durationSec ?? 60));
  const subtitlesOn = spec.subtitles !== false;
  const engine = spec.videoEngine === 'cinematic_motion' ? 'cinematic_motion' : 'ai_diffusion';
  const language: SpeechLanguage = spec.language === 'en' ? 'en' : 'bn';
  const resolution = spec.quality === 'draft' ? '720p' : '1080p';
  const dims = outputDims(aspect, resolution);
  const genSize = ASPECT_TO_GEN_SIZE[aspect];
  const wd = ctx.workingDir;
  const crossfadeSec = 0.4;
  const filmMode: FilmMode = spec.filmMode ?? 'short_film';

  // ------------------------------------------------------- ১ script_breakdown
  let title = spec.title;
  let logline = '';
  let scenes: Scene[] = [];
  let shots: FilmShot[] = [];
  const characterVoices: Record<string, TtsVoice> = {};
  const characterAppearance: Record<string, string> = {};
  await ctx.runStep('script_breakdown', 'চিত্রনাট্য ও দৃশ্য-বিভাজন (৮-স্তর §৭)', async (step: StepHandle) => {
    const dialogueBudget = Math.round(durationSec * 2.5);
    const { data } = await chatJson<{
      title: string;
      logline: string;
      characters: { name: string; appearancePrompt: string; voice?: string }[];
      scenes: {
        location: string;
        timeOfDay: string;
        characters: string[];
        action: string;
        actingNotes?: string;
        cameraWork?: string;
        ambientSound?: string;
        musicCue?: string;
        estimatedSec?: number;
        dialogues: { character: string; text: string; emotion?: string }[];
      }[];
    }>([
      {
        role: 'assistant',
        content:
          'তুমি একজন পুরস্কারজয়ী বাংলা চিত্রনাট্যকার ও পরিচালক। গল্প থেকে ছোট চলচ্চিত্রের চিত্রনাট্য লেখো।\n' +
          `নির্দেশনা: ${FILM_MODE_DIRECTION[filmMode]}\n` +
          `মোট দৈর্ঘ্য ${durationSec} সেকেন্ড — সংলাপের মোট অক্ষর সর্বোচ্চ ${dialogueBudget}-এর মধ্যে (কথা কম, দৃশ্য বেশি)।\n` +
          '৩–৬টি দৃশ্য, চরিত্র সর্বোচ্চ ৩জন। প্রতিটি দৃশ্যে সম্পূর্ণ ফিল্ড দাও:\n' +
          '  location (বাংলায়), timeOfDay (সকাল/দুপুর/সন্ধ্যা/রাত…), characters (উপস্থিত চরিত্রের নাম-অ্যারে),\n' +
          '  action (দৃশ্যে কী ঘটে — বাংলায়), actingNotes (অভিনয়-নির্দেশনা), cameraWork (ক্যামেরা-ধরন),\n' +
          '  ambientSound (পরিবেশ-শব্দের ইঙ্গিত — বৃষ্টি/চায়ের দোকান/শহর/রাত…), musicCue (মিউজিক-মুড-ইঙ্গিত), estimatedSec,\n' +
          '  dialogues: [{character, text (বাংলায়), emotion}]\n' +
          'প্রতিটি চরিত্রের appearancePrompt ইংরেজিতে বিস্তারিত (বয়স, মুখ, চুল, পোশাক), voice এর একটি: "jam"|"kazi"|"douji"|"tongtong"।\n' +
          'dialogues-র character অবশ্যই চরিত্র-তালিকার নাম হবে।\n' +
          'শুধু JSON: {"title":"...","logline":"...","characters":[{"name":"...","appearancePrompt":"...","voice":"jam"}],"scenes":[{"location":"...","timeOfDay":"...","characters":["নাম"],"action":"...","actingNotes":"...","cameraWork":"...","ambientSound":"...","musicCue":"...","estimatedSec":10,"dialogues":[{"character":"...","text":"...","emotion":"..."}]}]}',
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
      // ভাষা-নিয়ন্ত্রকের প্রোফাইল মেনে কণ্ঠ (বাংলায় jam/douji ছাড়া আর কিছু নয়)
      characterVoices[name] = resolveVoice(language, String(c?.voice ?? '') || undefined);
      characterAppearance[name] = String(c?.appearancePrompt ?? `a character named ${name}`).slice(0, 600);
    }
    scenes = data.scenes.slice(0, 6).map((s, i) => ({
      index: i + 1,
      location: String(s?.location ?? '').slice(0, 120),
      timeOfDay: String(s?.timeOfDay ?? 'দিন').slice(0, 40),
      characters: (Array.isArray(s?.characters) ? s.characters : []).map(c => String(c).slice(0, 60)).slice(0, 3),
      action: String(s?.action ?? '').slice(0, 600),
      actingNotes: String(s?.actingNotes ?? '').slice(0, 300),
      cameraWork: String(s?.cameraWork ?? '').slice(0, 200),
      ambientSound: String(s?.ambientSound ?? '').slice(0, 120),
      musicCue: String(s?.musicCue ?? '').slice(0, 120),
      estimatedSec: Math.max(3, Math.min(30, Number(s?.estimatedSec) || 8)),
      dialogue: (Array.isArray(s?.dialogues) ? s.dialogues : [])
        .filter((d: { character?: unknown; text?: unknown }) => String(d?.text ?? '').trim())
        .slice(0, 5)
        .map((d: { character?: unknown; text?: unknown; emotion?: unknown }) => ({
          character: String(d?.character ?? '').slice(0, 60),
          line: String(d?.text ?? '').slice(0, 300),
          emotion: d?.emotion ? String(d.emotion).slice(0, 40) : undefined,
        })),
    }));

    // শট-বিভাজন (একই ধাপে দ্বিতীয় LLM-কল — দৃশ্য থেকে শট-তালিকা)
    const maxShotCount = maxShots('short_film', spec.quality, engine);
    const segCap = engine === 'ai_diffusion' ? 9 : 7;
    const count = Math.max(3, Math.min(maxShotCount, Math.ceil(durationSec / segCap)));
    const { data: sd } = await chatJson<{
      shots: { sceneIndex: number; description: string; label?: string; cameraMove: string; durationSec: number; characters?: string[] }[];
    }>([
      {
        role: 'assistant',
        content:
          'তুমি চিত্রনাট্য থেকে শট-তালিকা বানাও (shot breakdown)।\n' +
          `ঠিক ${count}টি শট (সর্বোচ্চ ${maxShotCount}), প্রতিটি ${engine === 'ai_diffusion' ? '৪–৯' : '৩–৭'} সেকেন্ড, যোগফল ≈ ${durationSec} সেকেন্ড।\n` +
          'প্রতিটি দৃশ্য কমপক্ষে একটি শট পাবে। description ইংরেজিতে (দৃশ্যমান বিষয়: পরিবেশ, চরিত্রের অবস্থান/ভঙ্গি, আলো — ভিডিও/ইমেজ-জেনারেশনের জন্য), label বাংলায়।\n' +
          'cameraMove: "zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"static"। দৃশ্যে উপস্থিত চরিত্রের নাম characters-এ।\n' +
          'শুধু JSON: {"shots":[{"sceneIndex":1,"description":"...","label":"...","cameraMove":"zoom_in","durationSec":5,"characters":["নাম"]}]}',
      },
      {
        role: 'user',
        content:
          `চিত্রনাট্য (${durationSec} সেকেন্ড, ${count}টি শট):\n` +
          scenes
            .map(
              s =>
                `দৃশ্য ${s.index} (${s.location}, ${s.timeOfDay}): ${s.action} [অভিনয়: ${s.actingNotes}] [সংলাপ: ${
                  s.dialogue.map(d => `${d.character}: ${d.line}`).join(' | ') || 'নেই'
                }]`
            )
            .join('\n'),
      },
    ]);
    const rawShots = Array.isArray(sd?.shots) ? sd.shots : [];
    shots = rawShots
      .filter(s => String(s?.description ?? '').trim())
      .slice(0, maxShotCount)
      .map((s, i) => ({
        sceneIndex: Number(s?.sceneIndex) || scenes[0]?.index || 1,
        description: String(s.description).slice(0, 900),
        label: String(s?.label ?? '').slice(0, 120) || `শট ${i + 1}`,
        cameraMove: (MOVES.includes(String(s?.cameraMove) as CameraMove) ? s.cameraMove : MOVES[i % MOVES.length]) as CameraMove,
        durationSec: Math.max(3, Math.min(segCap, Number(s?.durationSec) || 5)),
        characters: (Array.isArray(s?.characters) ? s.characters : []).map(c => String(c).slice(0, 60)).slice(0, 3),
      }));
    if (shots.length === 0) {
      // সৎ ফলব্যাক — প্রতি দৃশ্যে একটি শট
      shots = scenes.slice(0, maxShotCount).map((s, i) => ({
        sceneIndex: s.index,
        description: `${s.location}, ${s.timeOfDay}. ${s.action}`,
        label: `দৃশ্য ${s.index}`,
        cameraMove: MOVES[i % MOVES.length],
        durationSec: Math.min(segCap, Math.max(3, s.estimatedSec)),
        characters: s.characters,
      }));
      ctx.partialNotes.push('LLM শট-বিভাজন দেয়নি — প্রতি দৃশ্যে একটি করে শট রাখা হয়েছে।');
    }
    normalizeShotDurations(shots, durationSec);
    await step.setDetail(
      `"${title}" — ${scenes.length}টি দৃশ্য, ${shots.length}টি শট, ${Object.keys(characterVoices).length}টি চরিত্র (মোড: ${filmMode})`
    );

    // চিত্রনাট্য artifact — ব্যবহারকারীর পাঠযোগ্য দলিল
    const doc = [
      `${title}`,
      logline ? `লগলাইন: ${logline}` : '',
      `দৈর্ঘ্য-লক্ষ্য: ${durationSec} সেকেন্ড · অনুপাত ${aspect} · ${fps}fps · ইঞ্জিন ${engine}`,
      '',
      ...scenes.flatMap(s => [
        `দৃশ্য ${s.index} — ${s.location} (${s.timeOfDay}) · আনুমানিক ${s.estimatedSec} সে.`,
        s.action,
        s.actingNotes ? `অভিনয়: ${s.actingNotes}` : '',
        s.cameraWork ? `ক্যামেরা: ${s.cameraWork}` : '',
        s.ambientSound ? `পরিবেশ-শব্দ: ${s.ambientSound}` : '',
        s.musicCue ? `মিউজিক-কিউ: ${s.musicCue}` : '',
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
      metaJson: { pipeline: 'short_film', scenes: scenes.length, shots: shots.length, filmMode },
    });
  });

  // ------------------------------------------------------- ২ character_bible
  const bible: BibleEntry[] = [];
  await ctx.runStep('character_bible', 'চরিত্র বাইবেল ও পোর্ট্রেট', async (step: StepHandle) => {
    // শটে আসলে যে চরিত্রগুলো দরকার (সর্বোচ্চ ৩)
    const needed = new Set<string>();
    for (const scene of scenes) for (const c of scene.characters) needed.add(c);
    for (const shot of shots) for (const c of shot.characters) needed.add(c);
    const selected = Object.keys(characterVoices).filter(n => needed.has(n)).slice(0, 3);
    if (selected.length === 0) {
      await step.setDetail('কোনো চরিত্র পোর্ট্রেট লাগবে না');
      return;
    }
    // §৭.২ — Character-টেবিল থেকে reuse (একই কথোপকথনে মিল-নাম)
    const existing = await db.character.findMany({ where: { conversationId: ctx.conversationId } });
    for (let i = 0; i < selected.length; i++) {
      await ctx.checkCancelled();
      const name = selected[i];
      const match = existing.find(
        c => c.name.trim() === name || c.name.includes(name) || name.includes(c.name.trim())
      );
      if (match?.portraitArtifactId) {
        try {
          const p = await ctx.resolveArtifactFile(match.portraitArtifactId);
          bible.push({ name, portraitPath: p, portraitDataUrl: await toDataUrl(p), reused: true });
          await step.setDetail(`"${name}" — Character-বাইবেল থেকে পোর্ট্রেট পুনঃব্যবহার (${i + 1}/${selected.length})`);
          continue;
        } catch {
          // পড়তে ব্যর্থ → নতুন পোর্ট্রেট
        }
      }
      await step.setDetail(`${name} — পোর্ট্রেট তৈরি (${i + 1}/${selected.length})`);
      const entry: BibleEntry = { name, reused: false };
      try {
        const { buffer } = await generateImageBuffer(
          portraitPrompt(name, characterAppearance[name] ?? `character "${name}"`),
          '864x1152'
        );
        entry.portraitDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
        const p = path.join(wd, `bible-${i}.png`);
        entry.portraitPath = p;
        await writeFile(p, buffer);
        const art = await ctx.registerArtifact({
          buffer,
          kind: 'image',
          mimeType: 'image/png',
          fileName: `bible-${sanitize(name) || i + 1}.png`,
          metaJson: {
            characterName: name,
            voice: characterVoices[name],
            pipeline: 'short_film',
            kind: 'character-bible',
          },
        });
        // §৭.২ — স্থায়ী Character-বাইবেল রেকর্ড (conversationId+name unique)
        await db.character.upsert({
          where: { conversationId_name: { conversationId: ctx.conversationId, name } },
          create: {
            conversationId: ctx.conversationId,
            name,
            role: 'চলচ্চিত্র-চরিত্র',
            description: (characterAppearance[name] ?? `character "${name}"`).slice(0, 500),
            appearanceJson: JSON.stringify({ appearance: characterAppearance[name] ?? null }),
            language,
            voice: characterVoices[name],
            portraitArtifactId: art.id,
          },
          update: { portraitArtifactId: art.id },
        });
        bible.push(entry);
      } catch (err) {
        ctx.partialNotes.push(
          `চরিত্র "${name}"-এর পোর্ট্রেট ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — দৃশ্য-প্রম্পট ব্যবহৃত হবে`
        );
      }
    }
    await step.setDetail(
      `${bible.length}টি পোর্ট্রেট সম্পন্ন${bible.some(b => b.reused) ? ' (পুনঃব্যবহৃতসহ)' : ''}`
    );
  });

  // ------------------------------------------------------- ৩ acting_plan
  await ctx.runStep('acting_plan', 'অভিনয়-পরিকল্পনা (প্রতি শটে)', async (step: StepHandle) => {
    const { data } = await chatJson<{ shots: { index: number; who?: string; action?: string; gaze?: string; bodyHands?: string; facialExpression?: string; speaks?: boolean; cameraMotion?: string }[] }>([
      {
        role: 'assistant',
        content:
          'তুমি অভিনয়-শিক্ষক (acting coach)। প্রতিটি শটের জন্য স্পষ্ট অভিনয়-নির্দেশনা দাও — এগুলো ভিডিও-জেনারেশন প্রম্পটে যুক্ত হবে।\n' +
          'প্রতিটি শটে: who (কে/কারা), action (শারীরিক কাজ), gaze (কোথায় তাকাচ্ছে), bodyHands (হাত/দেহের ভঙ্গি), facialExpression (মুখের অভিব্যক্তি), speaks (ওই শটে কথা বলে কি না — true/false), cameraMotion (ক্যামেরা-চলা)।\n' +
          'মানগুলো ইংরেজিতে সংক্ষিপ্ত বাক্যে (ভিডিও-মডেল বোঝার জন্য)। সংলাপ-শটে speaks=true হবে (তবে মুখের নড়াচড়ার নিখুঁত লিপ-সিঙ্ক নেই — সেটা দাবি কোরো না)।\n' +
          'শুধু JSON: {"shots":[{"index":1,"who":"...","action":"...","gaze":"...","bodyHands":"...","facialExpression":"...","speaks":false,"cameraMotion":"..."}]}',
      },
      {
        role: 'user',
        content:
          `শট-তালিকা:\n${shots
            .map(
              (s, i) =>
                `${i + 1}. (দৃশ্য ${s.sceneIndex}) ${s.description} [চরিত্র: ${s.characters.join(', ') || 'নেই'}] [সংলাপ-দৃশ্য: ${
                  scenes.find(sc => sc.index === s.sceneIndex)?.dialogue.length ? 'হ্যাঁ' : 'না'
                }]`
            )
            .join('\n')}`,
      },
    ]);
    const raw = Array.isArray(data?.shots) ? data.shots : [];
    let matched = 0;
    shots.forEach((shot, i) => {
      const d = raw.find(x => Number(x?.index) === i + 1) ?? raw[i];
      if (!d) return;
      shot.acting = {
        who: String(d.who ?? '').slice(0, 120) || shot.characters.join(', '),
        action: String(d.action ?? '').slice(0, 200) || scenes.find(s => s.index === shot.sceneIndex)?.actingNotes?.slice(0, 200) || '',
        gaze: String(d.gaze ?? '').slice(0, 120),
        bodyHands: String(d.bodyHands ?? '').slice(0, 120),
        facialExpression: String(d.facialExpression ?? '').slice(0, 120),
        speaks: d.speaks === true,
        cameraMotion: String(d.cameraMotion ?? '').slice(0, 120) || shot.cameraMove,
      };
      if (d.who || d.action) matched++;
    });
    if (matched === 0) {
      ctx.partialNotes.push('অভিনয়-পরিকল্পনা LLM থেকে আসেনি — দৃশ্য-নোট থেকে সরল নির্দেশনা ব্যবহৃত হবে।');
    }
    await step.setDetail(`${matched}/${shots.length}টি শটে অভিনয়-নির্দেশনা যুক্ত`);
  });

  // ------------------------------------------------------- ৪ speech
  const timedLines: TimedLine[] = [];
  let narrationPath: string | null = null;
  let narrationText = '';
  const verificationSummaries: Record<string, unknown>[] = [];
  await ctx.runStep('speech', 'সংলাপ তৈরি (ভাষা-নিয়ন্ত্রক)', async (step: StepHandle) => {
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
    // A5 বর্ণনা-ট্র্যাক (spec.sound === 'narration' হলে)
    if (spec.sound === 'narration') {
      narrationText = [logline, ...scenes.map(s => s.action)].filter(Boolean).join(' ').slice(0, 600);
      if (narrationText.trim()) {
        const voice = resolveVoice(language, spec.voice);
        try {
          const speech = await synthesizeSpeech(narrationText, voice, 1);
          const p = path.join(wd, 'narration.wav');
          await writeFile(p, speech.buffer);
          const info = await mediaInfo(p);
          if (info.durationSec > 0.5) {
            narrationPath = p;
            await ctx.registerArtifact({
              buffer: speech.buffer,
              kind: 'audio',
              mimeType: 'audio/wav',
              fileName: 'narration-a5.wav',
              metaJson: {
                pipeline: 'short_film',
                layer: 'A5',
                kind: 'narration',
                voice,
                language,
                durationSec: info.durationSec,
              },
            });
            await step.setDetail(`A5 বর্ণনা-ট্র্যাক তৈরি (${info.durationSec.toFixed(1)} সে., ${voice})`);
          }
        } catch (err) {
          ctx.partialNotes.push(
            `বর্ণনা-ট্র্যাক (A5) ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'})`
          );
        }
      }
    }
    if (allLines.length === 0) {
      await step.setDetail('কোনো সংলাপ নেই — দৃশ্য+সাউন্ড-ডিজাইনে চলবে');
      return;
    }

    // প্রতি কণ্ঠে প্রথম লাইন ভাষা-নিয়ন্ত্রকে যাচাই-সহ; বাকিগুলো সরল TTS (খরচ-নিয়ন্ত্রণ)
    const verifiedVoices = new Set<string>();
    const warnedVoices = new Set<string>();
    let done = 0;
    for (let i = 0; i < allLines.length; i++) {
      await ctx.checkCancelled();
      const d = allLines[i];
      const voice = characterVoices[d.character] ?? resolveVoice(language, spec.voice);
      const isFirstOfVoice = !verifiedVoices.has(voice);
      await step.setDetail(
        `${i + 1}/${allLines.length} লাইন — ${d.character}${isFirstOfVoice ? ' (ভাষা-নিয়ন্ত্রকে যাচাই-সহ)' : ''}`
      );
      let buffer: Buffer | null = null;
      let ext = 'wav';
      let verification: SpeechVerification | null = null;
      try {
        if (isFirstOfVoice) {
          const out = await synthesizeVerifiedSpeech(
            {
              task: 'speech',
              language,
              script: d.line,
              voiceId: voice,
              outputFormat: 'wav',
              sampleRate: 24000,
              speed: 1,
            },
            { verify: true }
          );
          buffer = out.buffer;
          ext = out.ext;
          verification = out.verification;
          verifiedVoices.add(voice);
        } else {
          const out = await synthesizeSpeech(d.line, voice, 1);
          buffer = out.buffer;
          ext = out.ext;
        }
      } catch (err) {
        ctx.partialNotes.push(
          `"${d.character}"-এর লাইন ${i + 1} TTS ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — শুধু সাবটাইটেলে থাকবে`
        );
        timedLines.push({ ...d, measuredSec: Math.max(1.5, d.line.length / 14), startSec: 0, endSec: 0 });
        continue;
      }
      const filePath = path.join(wd, `line-${i}.${ext}`);
      try {
        await writeFile(filePath, buffer);
        const info = await mediaInfo(filePath);
        if (!(info.durationSec > 0)) throw new Error('অডিওর দৈর্ঘ্য শূন্য');
        timedLines.push({ ...d, filePath, measuredSec: info.durationSec, startSec: 0, endSec: 0 });
        done++;
      } catch (err) {
        ctx.partialNotes.push(
          `লাইন ${i + 1} ত্রুটিপূর্ণ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — শুধু সাবটাইটেলে থাকবে`
        );
        timedLines.push({ ...d, measuredSec: Math.max(1.5, d.line.length / 14), startSec: 0, endSec: 0 });
        continue;
      }
      // প্রতিটি সংলাপ-লাইন আলাদা artifact — রায় metaJson-এ
      await ctx.registerArtifact({
        buffer,
        kind: 'audio',
        mimeType: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        fileName: `dialogue-${i + 1}-${sanitize(d.character) || 'line'}.${ext}`,
        metaJson: {
          pipeline: 'short_film',
          layer: 'A1',
          kind: 'dialogue',
          character: d.character,
          text: d.line.slice(0, 200),
          emotion: d.emotion ?? null,
          voice,
          language,
          sceneIndex: d.sceneIndex,
          verification: verification
            ? {
                verdict: verification.verdict,
                verdictLabel: verdictLabel(verification.verdict),
                similarity: verification.similarity,
                detectedLanguage: verification.detectedLanguage,
                durationSec: verification.durationSec,
                expectedSec: verification.expectedSec,
                notes: verification.notes,
              }
            : { verdictLabel: null, note: 'এই কণ্ঠের প্রথম লাইনের যাচাই-রায় দেখুন' },
        },
      });
      if (verification) {
        verificationSummaries.push({
          character: d.character,
          voice,
          verdict: verification.verdict,
          verdictLabel: verdictLabel(verification.verdict),
          similarity: verification.similarity,
          detectedLanguage: verification.detectedLanguage,
          notes: verification.notes,
        });
        if (verification.verdict === 'warn' && !warnedVoices.has(voice)) {
          warnedVoices.add(voice);
          if (language === 'bn') {
            ctx.partialNotes.push(
              'বাংলা কণ্ঠ-যাচাই: ASR বাংলা বোঝে না — রায় "সতর্কতা"; প্রিভিউ শুনে নিশ্চিত করুন (§২)।'
            );
          } else {
            ctx.partialNotes.push(`কণ্ঠ "${voice}"-এর যাচাই-রায়: সতর্কতা — প্রিভিউ শুনে নিশ্চিত করুন।`);
          }
        }
        if (verification.verdict === 'fail') {
          ctx.partialNotes.push(
            `কণ্ঠ "${voice}"-এর যাচাই-রায়: ব্যর্থ — অডিও সঠিকভাবে পড়া হয়নি বলে সন্দেহ (${verification.notes[0] ?? ''})`
          );
        }
      }
    }
    await step.setDetail(`${done}/${allLines.length} সংলাপ-লাইন সফল`);
  });

  // সংলাপ→দৃশ্য বণ্টন + শট-দৈর্ঘ্য সমন্বয় (generate_shots-এর শুরুতে চলে)
  const assignLinesAndDurations = () => {
    const useXfade = shots.length <= 6;
    const T = useXfade ? crossfadeSec : 0;
    const capPerShot = engine === 'ai_diffusion' ? 10 : 20;
    // দৃশ্যের সংলাপ ধরে রাখতে শেষ শট প্রয়োজনে বাড়ানো
    for (const scene of scenes) {
      const sceneShots = shots.filter(s => s.sceneIndex === scene.index);
      if (sceneShots.length === 0) continue;
      const lines = timedLines.filter(l => l.sceneIndex === scene.index && l.filePath);
      if (lines.length === 0) continue;
      const linesDur = lines.reduce((a, l) => a + l.measuredSec + 0.25, 0);
      const sceneDur = sceneShots.reduce((a, s) => a + s.durationSec, 0);
      if (linesDur + 0.3 > sceneDur) {
        const last = sceneShots[sceneShots.length - 1];
        const room = Math.max(0, capPerShot - last.durationSec);
        const give = Math.min(linesDur + 0.3 - sceneDur, room);
        if (give > 0) last.durationSec = round2(last.durationSec + give);
        const newDur = sceneShots.reduce((a, s) => a + s.durationSec, 0);
        if (linesDur + 0.3 > newDur) {
          ctx.partialNotes.push(
            `দৃশ্য ${scene.index}-এর সংলাপ শট-সময়ের চেয়ে দীর্ঘ — কথা পরের দৃশ্যে গড়িয়ে যেতে পারে (AI-ক্লিপ ${capPerShot} সে.-এ সীমিত)`
          );
        }
      }
    }
    // AI-পথে শট-দৈর্ঘ্য ৫/১০-গ্রিডে ক্ল্যাম্প (ক্লিপ-দৈর্ঘ্যের সাথে মিলতে)
    if (engine === 'ai_diffusion') {
      for (const s of shots) {
        const d = s.durationSec >= 7.5 ? 10 : 5;
        if (d < s.durationSec) {
          ctx.partialNotes.push(
            `শট "${s.label}" ${s.durationSec.toFixed(1)} সে. দরকার ছিল, AI-ক্লিপ ${d} সে.-এ সীমিত — দৃশ্য সংকুচিত`
          );
          s.durationSec = d;
        } else if (d > s.durationSec) {
          s.durationSec = d; // ৫-গ্রিডে উপরের দিকে নেওয়া নিরাপদ (ট্রিম নয়)
        }
      }
    }
    // চূড়ান্ত টাইমলাইন-অফসেট — দৃশ্য-শুরু শট-সীমানা থেকে, সংলাপ ধারাবাহিক (কখনো ওভারল্যাপ নয়)
    const sceneStart = new Map<number, number>();
    let prefix = 0;
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if (!sceneStart.has(s.sceneIndex)) sceneStart.set(s.sceneIndex, Math.max(0, round2(prefix - i * T)));
      prefix += s.durationSec;
    }
    for (const scene of scenes) {
      const start = sceneStart.get(scene.index) ?? 0;
      scene.startSec = start;
      scene.endSec = round2(start + shots.filter(s => s.sceneIndex === scene.index).reduce((a, s) => a + s.durationSec, 0));
    }
    let cursor = 0;
    for (const scene of scenes) {
      const start = sceneStart.get(scene.index) ?? 0;
      let lc = Math.max(cursor, round2(start + 0.15));
      for (const l of timedLines.filter(l => l.sceneIndex === scene.index)) {
        l.startSec = round2(lc);
        l.endSec = round2(lc + Math.max(0.8, l.measuredSec));
        lc = round2(lc + l.measuredSec + 0.25);
      }
      cursor = lc;
    }
    return round2(useXfade ? prefix - (shots.length - 1) * T : prefix);
  };

  // ------------------------------------------------------- ৫ generate_shots
  const shotEngineLabels: string[] = [];
  let aiShots = 0;
  await ctx.runStep(
    'generate_shots',
    engine === 'ai_diffusion' ? `AI ভিডিও-শট জেনারেশন (${AI_VIDEO_MODEL})` : 'স্টোরিবোর্ড ও ক্যামেরা-মোশন ক্লিপ',
    async (step: StepHandle) => {
      assignLinesAndDurations();
      const valid: FilmShot[] = [];
      for (let i = 0; i < shots.length; i++) {
        await ctx.checkCancelled();
        const shot = shots[i];
        const matching = shot.characters.map(c => bible.find(b => b.name === c)).find(Boolean);
        // অভিনয়-নির্দেশনা → ইংরেজি AI-প্রম্পট-অংশ
        const actingText = shot.acting
          ? [
              `Acting: ${shot.acting.who || 'the character'} ${shot.acting.action}`.trim(),
              shot.acting.gaze ? `gaze ${shot.acting.gaze}` : '',
              shot.acting.bodyHands ? `body language ${shot.acting.bodyHands}` : '',
              shot.acting.facialExpression ? `facial expression ${shot.acting.facialExpression}` : '',
            ]
              .filter(Boolean)
              .join(', ')
          : '';
        if (engine === 'ai_diffusion') {
          await step.setDetail(`শট ${i + 1}/${shots.length} জেনারেট হচ্ছে…`);
          try {
            const res = await generateAiShot({
              index: i,
              prompt: buildAiVideoPrompt(shot.description, spec.style, shot.cameraMove, actingText || undefined),
              neededSec: shot.durationSec,
              fps,
              width: dims.w,
              height: dims.h,
              workingDir: wd,
              // i2v — চরিত্রের পোর্ট্রেট রেফারেন্স, পরিচয়-ধারাবাহিকতার জন্য
              imageUrl: matching?.portraitDataUrl,
              // §১০ আইডেম্পোটেন্সি: এই প্রোডাকশনের এই শট = একই request_id
              requestKey: `sf-${ctx.productionId}-shot-${i + 1}`,
              fallbackImagePrompt: imagePromptForShot(shot, spec.style),
              fallbackGenSize: genSize,
              fallbackReferenceUrl: matching?.portraitDataUrl,
              fallbackMove: shot.cameraMove,
              onStatus: note => step.setDetail(`শট ${i + 1}/${shots.length}: ${note}`),
            });
            if (res.usedAi) {
              aiShots++;
            } else if (res.framePath) {
              await ctx.registerArtifact({
                buffer: await readFile(res.framePath),
                kind: 'image',
                mimeType: 'image/png',
                fileName: `storyboard-shot-${i + 1}.png`,
                metaJson: {
                  shot: i + 1,
                  of: shots.length,
                  sceneIndex: shot.sceneIndex,
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
              `শট ${i + 1} ("${shot.label}") তৈরি ব্যর্থ (${err instanceof Error ? err.message.slice(0, 140) : 'অজানা'}) — শট বাদ`
            );
          }
        } else {
          // cinematic_motion — চরিত্র-রেফারেন্স-কন্ডিশনড স্টোরিবোর্ড + Ken Burns
          await step.setDetail(`শট ${i + 1}/${shots.length} ফ্রেম${shot.characters.length > 0 ? ` (${shot.characters.join(', ')})` : ''}`);
          let buffer: Buffer | null = null;
          const tryGen = async (): Promise<Buffer> => {
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
          const framePath = path.join(wd, `frame-${i}.png`);
          await writeFile(framePath, buffer);
          await ctx.registerArtifact({
            buffer,
            kind: 'image',
            mimeType: 'image/png',
            fileName: `storyboard-shot-${i + 1}.png`,
            metaJson: { shot: i + 1, of: shots.length, sceneIndex: shot.sceneIndex, cameraMove: shot.cameraMove, label: shot.label },
          });
          await step.setDetail(`শট ${i + 1}/${shots.length} মোশন ক্লিপ (${shot.cameraMove}, ${shot.durationSec.toFixed(1)} সে.)`);
          const clipPath = path.join(wd, `clip-${i}.mp4`);
          const kbOpts = {
            durationSec: shot.durationSec,
            fps: fps as 24 | 25 | 30,
            width: dims.w,
            height: dims.h,
            move: shot.cameraMove,
          };
          try {
            await kenBurnsClip(framePath, clipPath, kbOpts);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
              await kenBurnsClip(framePath, clipPath, kbOpts);
            } catch {
              ctx.partialNotes.push(`শট ${i + 1}-এর ক্লিপ ব্যর্থ (${msg.slice(0, 120)}) — বাদ`);
              continue;
            }
          }
          shotEngineLabels.push(`শট ${i + 1}: ক্যামেরা-মোশন (ইঞ্জিন-নির্বাচিত)`);
          valid.push({ ...shot, framePath, clipPath });
        }
      }
      if (valid.length === 0) throw new Error('কোনো শট ক্লিপই তৈরি হয়নি');
      shots = valid;
      await step.setDetail(`${valid.length}টি শট ক্লিপ সম্পন্ন`);
    }
  );

  // ------------------------------------------------------- ৬ sound_design
  let mixPath: string | null = null;
  let mixReport: SoundMixReport | null = null;
  let scoreHonestLabel = '';
  const usedLayers: string[] = [];
  await ctx.runStep('sound_design', 'সাউন্ড ডিজাইন (A1–A5 স্তর)', async (step: StepHandle) => {
    const total = assignLinesAndDurations(); // চূড়ান্ত অফসেট (শট-সেট চূড়ান্ত হওয়ার পরে)
    const layers: MixLayer[] = [];
    const soundOn = spec.sound !== 'none';

    // A1 — মোট সংলাপ-অডিও এক টাইমলাইনে (অবস্থানসহ)
    const lineFiles = timedLines.filter(l => l.filePath);
    if (lineFiles.length > 0) {
      const a1 = path.join(wd, 'a1-dialogue-timeline.wav');
      await step.setDetail(`A1 সংলাপ-টাইমলাইন (${lineFiles.length}টি লাইন)`);
      await buildPositionedTrack(
        lineFiles.map(l => ({ file: l.filePath!, startSec: l.startSec })),
        a1,
        total
      );
      layers.push({ layer: 'A1_dialogue', file: a1, startSec: 0 });
      usedLayers.push('A1 সংলাপ');
    }

    // A2+A3 — প্রতি দৃশ্যে planSoundscape → বেড → অবস্থানসহ এক ট্র্যাক
    if (soundOn && scenes.length > 0) {
      const bedEntries: { file: string; startSec: number; lenSec?: number }[] = [];
      for (const scene of scenes) {
        const start = scene.startSec ?? 0;
        const end = scene.endSec ?? start;
        const dur = round2(end - start);
        if (dur <= 0.3) continue;
        // §৮ — দৃশ্যের বর্ণনা + ambientSound/musicCue হিন্ট থেকে পরিকল্পনা
        const plan = planSoundscape(
          `${scene.location} ${scene.timeOfDay} ${scene.action} ${scene.actingNotes} ${scene.ambientSound} ${scene.musicCue}`,
          {}
        );
        const bedPath = path.join(wd, `bed-${scene.index}.wav`);
        const foleyAt = timedLines.filter(l => l.sceneIndex === scene.index && l.filePath).map(l => Math.max(0, l.startSec - start));
        await writeFile(bedPath, renderSoundscapeBed(plan, dur, { foleyAtSec: foleyAt.length ? foleyAt : undefined }));
        bedEntries.push({ file: bedPath, startSec: start, lenSec: dur });
        await step.setDetail(
          `দৃশ্য ${scene.index}: ${plan.ambience.join('+')}${plan.foley.length ? ` + ফোলে ${plan.foley.join('+')}` : ''}`
        );
      }
      if (bedEntries.length > 0) {
        const a23 = path.join(wd, 'a23-soundscape.wav');
        await buildPositionedTrack(bedEntries, a23, total);
        // A2+A3 প্রি-মিক্সড বেড — ইঞ্জিনের নিজস্ব অ্যাম্বিয়েন্স/ফোলে ভারসাম্য
        layers.push({ layer: 'A2_ambience', file: a23, startSec: 0, gainDbOverride: -17 });
        usedLayers.push('A2 পরিবেশ + A3 ফোলে (প্রি-মিক্সড বেড)');
      }
    }

    // A4 — মিউজিক: spec.mood বা দৃশ্যের musicCue থেকে; কিউ ভিন্ন হলে দৃশ্য-ভিত্তিক টুকরো
    if (soundOn && scenes.length > 0) {
      const filmMood: MusicMood =
        detectMoodFromText(String(spec.mood ?? '')) ??
        detectMoodFromText(`${spec.story ?? ''} ${spec.idea ?? ''} ${logline}`) ??
        'peaceful';
      const sceneMoods = scenes.map(sc => ({
        scene: sc,
        mood: detectMoodFromText(`${sc.musicCue ?? ''} ${sc.action ?? ''}`),
      }));
      const distinctMoods = [...new Set(sceneMoods.map(m => m.mood).filter(Boolean))] as MusicMood[];
      const musicEntries: { file: string; startSec: number; lenSec?: number }[] = [];
      if (distinctMoods.length <= 1) {
        const mood = distinctMoods[0] ?? filmMood;
        const dur = Math.max(8, Math.min(120, Math.round(total)));
        await step.setDetail(`A4 স্কোর: ${moodLabel(mood)} (${dur} সে., প্রসিডিউরাল)`);
        const inst = await synthesizeInstrumental({ mood, durationSec: dur, tempoBpm: spec.tempoBpm, genre: spec.genre });
        const f = path.join(wd, 'a4-score.wav');
        await writeFile(f, inst.buffer);
        musicEntries.push({ file: f, startSec: 0 });
        scoreHonestLabel = inst.meta.honestLabel;
      } else {
        await step.setDetail(`A4 স্কোর: দৃশ্য-কিউ অনুযায়ী ${distinctMoods.length}টি মুড-টুকরো`);
        for (const sm of sceneMoods) {
          const start = sm.scene.startSec ?? 0;
          const end = sm.scene.endSec ?? start;
          const dur = round2(end - start);
          if (dur <= 0.3) continue;
          const mood = sm.mood ?? filmMood;
          const inst = await synthesizeInstrumental({ mood, durationSec: Math.max(8, Math.min(120, Math.round(dur + 1))) });
          const f = path.join(wd, `a4-scene-${sm.scene.index}.wav`);
          await writeFile(f, inst.buffer);
          musicEntries.push({ file: f, startSec: start, lenSec: dur });
        }
      }
      if (musicEntries.length > 0) {
        const a4 = path.join(wd, 'a4-music-timeline.wav');
        await buildPositionedTrack(musicEntries, a4, total);
        layers.push({ layer: 'A4_music', file: a4, startSec: 0 });
        usedLayers.push(`A4 মিউজিক (প্রসিডিউরাল স্কোর${scoreHonestLabel ? ` — ${scoreHonestLabel}` : ''})`);
      }
    }

    // A5 — বর্ণনা (speech-ধাপে তৈরি); সংলাপ থাকলে শেষ সংলাপ শেষ হওয়ার পরে বসে (ওভারল্যাপ এড়াতে)
    if (narrationPath) {
      const lastLineEnd = timedLines.reduce((a, l) => Math.max(a, l.endSec), 0);
      const narrationStart = lineFiles.length > 0 ? round2(lastLineEnd + 0.5) : 0;
      layers.push({ layer: 'A5_narration', file: narrationPath, startSec: narrationStart });
      usedLayers.push(`A5 বর্ণনা (${narrationStart.toFixed(1)} সে. থেকে)`);
    }

    // ৫-স্তর মিক্স — DEFAULT_MIX_RULES (সংলাপ-ডাকিং + লিমিটারসহ)
    if (layers.length > 0) {
      await step.setDetail(`${layers.length}টি স্তর মিক্স (ডাকিং+লিমিটারসহ)`);
      mixPath = path.join(wd, 'final-mix.wav');
      mixReport = await mixSoundLayers(layers, mixPath, DEFAULT_MIX_RULES);
      if (!mixReport.ok) {
        mixReport.issues.forEach(i => ctx.partialNotes.push(`সাউন্ড-মিক্স: ${i}`));
      }
      await step.setDetail(
        `মিক্স সম্পন্ন — ${mixReport.durationSec.toFixed(1)} সে., লাউডনেস ${mixReport.loudnessLufs?.toFixed(1) ?? '?'} LUFS, পিক ${mixReport.peakDb?.toFixed(1) ?? '?'} dB`
      );
    } else {
      await step.setDetail('কোনো অডিও-স্তর নেই — নীরব চলচ্চিত্র');
    }
  });

  // ------------------------------------------------------- ৭ continuity
  const continuityWarnings: string[] = [];
  await ctx.runStep('continuity', 'ধারাবাহিকতা পরীক্ষা (VLM)', async (step: StepHandle) => {
    const characterShots = shots.filter(s => s.characters.length > 0).slice(0, 3);
    if (characterShots.length === 0 || bible.length === 0) {
      await step.setDetail('চরিত্র-ধারাবাহিকতা পরীক্ষার মতো নমুনা নেই');
      return;
    }
    let checked = 0;
    for (const shot of characterShots) {
      const match = shot.characters.map(c => bible.find(b => b.name === c)).find(Boolean);
      if (!match?.portraitDataUrl) continue;
      await ctx.checkCancelled();
      await step.setDetail(`${shot.label} — ফ্রেম পরীক্ষা ${checked + 1}/${characterShots.length}`);
      try {
        // AI-পথে ফ্রেম ফাইল নেই — ক্লিপ থেকে একটি ফ্রেম বের করা
        let frameDataUrl: string;
        if (shot.framePath) {
          frameDataUrl = await toDataUrl(shot.framePath);
        } else if (shot.clipPath) {
          const framePath = path.join(wd, `cont-frame-${shot.sceneIndex}-${checked}.png`);
          await runFfmpeg(
            ['-ss', '1', '-i', shot.clipPath, '-frames:v', '1', framePath],
            { timeoutMs: 60_000, label: 'ধারাবাহিকতা-ফ্রেম এক্সট্র্যাক্ট' }
          );
          frameDataUrl = await toDataUrl(framePath);
        } else {
          continue;
        }
        const answer = await visionCompare(
          match.portraitDataUrl,
          frameDataUrl,
          `প্রথম ছবিটি রেফারেন্স চরিত্র "${match.name}"-এর পোর্ট্রেট, দ্বিতীয়টি একটি সিনেম্যাটিক ফ্রেম। দ্বিতীয় ফ্রেমে কি একই ব্যক্তি (মুখ/চুল/পোশাক) ধারাবাহিকভাবে আছে? বাংলায় ১ বাক্যে সৎ উত্তর দাও — মিললে কী মিলেছে, না মিললে কী অমিল।`
        );
        if (answer) {
          continuityWarnings.push(`${shot.label}: ${answer.slice(0, 160)}`);
          // সন্দেহজনক উত্তর → partialNotes (VLM-অনুমান চূড়ান্ত সত্য নয়)
          if (/অমিল|মেলেনি|একই ব্যক্তি নয়|নয় একই|different|not the same/i.test(answer)) {
            ctx.partialNotes.push(
              `ধারাবাহিকতা-সন্দেহ ("${shot.label}"): ${answer.slice(0, 140)} — VLM-অনুমান চূড়ান্ত সত্য নয়, ফ্রেম নিজে দেখে নিশ্চিত করুন।`
            );
          }
        }
        checked++;
      } catch (err) {
        continuityWarnings.push(`${shot.label}: পরীক্ষা ব্যর্থ (${err instanceof Error ? err.message.slice(0, 80) : 'অজানা'})`);
      }
    }
    await step.setDetail(`${checked}টি ফ্রেম পরীক্ষিত — সতর্কতা অ-বাধামূলক`);
  });

  // ------------------------------------------------------- ৮ final_mix
  const result: Record<string, unknown> = {};
  await ctx.runStep('final_mix', 'টাইমলাইন, সাবটাইটেল ও ফাইনাল মিক্স', async (step: StepHandle) => {
    await step.setDetail(`${shots.length}টি শট জোড়া (${crossfadeSec} সে. ক্রসফেড)`);
    const silentPath = path.join(wd, 'assembled.mp4');
    await concatClips(
      shots.map(s => s.clipPath!),
      silentPath,
      { transitionSec: crossfadeSec }
    );
    let videoPath = silentPath;
    let vInfo = await mediaInfo(silentPath);

    // ৫-স্তর অডিও-মিক্স যোগ (মাপ-মিলানো দৈর্ঘ্য, aac)
    if (mixPath) {
      await step.setDetail('৫-স্তর অডিও-মিক্স যোগ (aac)');
      const withAudio = path.join(wd, 'with-mix.mp4');
      await muxAudio(videoPath, mixPath, withAudio, { durationSec: vInfo.durationSec, fadeOutSec: 1.2 });
      videoPath = withAudio;
      vInfo = await mediaInfo(withAudio);
    }

    // বাংলা সাবটাইটেল (spec.subtitles !== false হলে) — মাপা সংলাপ-সময় থেকে
    let srtContent: string | null = null;
    const dialogues = timedLines.filter(l => l.line.trim());
    if (subtitlesOn && dialogues.length > 0) {
      await step.setDetail('বাংলা সাবটাইটেল বার্ন');
      const cues = dialogues.map(l => ({
        start: l.startSec,
        end: Math.max(l.startSec + 0.8, l.endSec),
        text: `${l.character}: ${l.line}`,
      }));
      srtContent = makeSrt(cues);
    } else if (subtitlesOn && narrationText) {
      // সংলাপ নেই — বর্ণনা/গল্প-লেখা থেকে কিউ-বিভাজন
      try {
        const cues = await segmentDialogueToCues(narrationText || logline || title, {
          totalDurationSec: vInfo.durationSec,
        });
        if (cues.length > 0) srtContent = makeSrt(cues);
      } catch {
        srtContent = null;
      }
    }
    if (srtContent) {
      const srtPath = path.join(wd, 'dialogue.srt');
      await writeFile(srtPath, srtContent, 'utf-8');
      try {
        const burned = path.join(wd, 'subtitled.mp4');
        await burnSubtitles(videoPath, srtPath, burned);
        videoPath = burned;
        vInfo = await mediaInfo(burned);
      } catch (err) {
        ctx.partialNotes.push(
          `সাবটাইটেল বার্ন ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'}) — SRT আলাদাভাবে থাকবে`
        );
      }
    } else if (subtitlesOn && dialogues.length === 0 && !narrationText) {
      ctx.partialNotes.push('সাবটাইটেলের মতো কোনো লেখা নেই — বাদ');
    }

    // চূড়ান্ত যাচাই — §১১ স্তর-A
    const problems: string[] = [];
    if (!vInfo.hasVideo) problems.push('ভিডিও স্ট্রিম নেই');
    if (Math.abs(vInfo.durationSec - durationSec) > 4) {
      ctx.partialNotes.push(
        `দৈর্ঘ্য ${vInfo.durationSec.toFixed(1)} সে. — লক্ষ্য ${durationSec} সে. থেকে >৪ সে. আলাদা (সংলাপ/শট-সময়ের কারণে হতে পারে)`
      );
      problems.push('দৈর্ঘ্য-বিচ্যুতি');
    }
    if (vInfo.width !== dims.w || vInfo.height !== dims.h) {
      ctx.partialNotes.push(`রেজোলিউশন ${vInfo.width}×${vInfo.height} — প্রত্যাশিত ${dims.w}×${dims.h}`);
      problems.push('রেজোলিউশন-বিচ্যুতি');
    }
    if (vInfo.fps && Math.abs(vInfo.fps - fps) > 1.5) problems.push(`FPS ${vInfo.fps} — প্রত্যাশিত ${fps}`);
    if (mixPath && !vInfo.hasAudio) problems.push('অডিও-মিক্স থাকা সত্ত্বেও অডিও ট্র্যাক নেই');
    let avSyncOk: boolean | null = null;
    if (vInfo.hasAudio && vInfo.hasVideo) {
      try {
        const probe = await ffprobeJson(videoPath);
        const v = (probe.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'video');
        const a = (probe.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'audio');
        const vd = Number(v?.duration ?? 0);
        const ad = Number(a?.duration ?? 0);
        if (vd > 0 && ad > 0) {
          avSyncOk = Math.abs(vd - ad) < 0.5;
          if (!avSyncOk) problems.push(`A/V স্ট্রিম-দৈর্ঘ্যে অসমলয় (ভিডিও ${vd.toFixed(2)} / অডিও ${ad.toFixed(2)} সে.)`);
        }
      } catch {
        // অ-বাধামূলক
      }
    }

    const honestLabel =
      engine === 'ai_diffusion'
        ? aiShots === shots.length
          ? `সব ${shots.length}টি শট প্রকৃত AI (${AI_VIDEO_MODEL}) — ক্লাউড ডিফিউশন ভিডিও`
          : `${aiShots}/${shots.length} শট প্রকৃত AI (${AI_VIDEO_MODEL}); বাকি ${shots.length - aiShots}টি স্টোরিবোর্ড+ক্যামেরা-মোশন ফলব্যাক`
        : 'cinematic_motion ইঞ্জিন — AI স্টোরিবোর্ড + ক্যামেরা-মোশন (প্রকৃত ডিফিউশন ভিডিও নয়)';

    // SRT artifact
    if (srtContent) {
      await ctx.registerArtifact({
        buffer: Buffer.from(srtContent, 'utf-8'),
        kind: 'text',
        mimeType: 'application/x-subrip',
        fileName: `${sanitize(title).slice(0, 32) || 'film'}-dialogue.srt`,
        metaJson: { pipeline: 'short_film', kind: 'dialogue', lines: dialogues.length },
      });
    }

    await step.setDetail('চূড়ান্ত MP4 নিবন্ধন');
    const buf = await readFile(videoPath);
    const artifact = await ctx.registerArtifact({
      buffer: buf,
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: `${sanitize(title).slice(0, 40) || 'short-film'}.mp4`,
      metaJson: {
        pipeline: 'short_film',
        title,
        logline,
        engine,
        aiModel: engine === 'ai_diffusion' && aiShots > 0 ? AI_VIDEO_MODEL : null,
        durationSec: vInfo.durationSec,
        width: vInfo.width,
        height: vInfo.height,
        fps: vInfo.fps,
        aspect,
        shots: shots.length,
        scenes: scenes.length,
        filmMode,
        language,
        layers: usedLayers,
        shotEngineLabels,
        subtitles: !!srtContent,
        speechVerification: verificationSummaries,
        mix: mixReport
          ? { loudnessLufs: mixReport.loudnessLufs ?? null, peakDb: mixReport.peakDb ?? null, issues: mixReport.issues, honestLabel: mixReport.honestLabel }
          : null,
        avSyncOk,
        honestLabel,
        lipSync: false, // §৫ — কথা-বলা শটে মুখের নড়াচড়ার দাবি নয়
      },
    });

    const verdict =
      problems.length === 0
        ? `চমৎকার — ${shots.length}টি শট / ${scenes.length}টি দৃশ্য, ${vInfo.durationSec.toFixed(1)} সেকেন্ড, ${vInfo.width}×${vInfo.height}@${vInfo.fps}FPS${vInfo.hasAudio ? `, ${usedLayers.length}টি অডিও-স্তর-সহ` : ''}${srtContent ? ', বাংলা সাবটাইটেল-সহ' : ''}। (${honestLabel})`
        : `কার্যকর, তবে সতর্কতা: ${problems.join(', ')}। ${vInfo.durationSec.toFixed(1)} সেকেন্ড, ${shots.length}টি শট।`;
    result.quality = verdict;
    result.artifactId = artifact.id;
    result.title = title;
    result.logline = logline;
    result.characters = Object.keys(characterVoices);
    result.durationSec = vInfo.durationSec;
    result.shots = shots.length;
    result.scenes = scenes.length;
    result.engine = engine;
    result.shotEngineLabels = shotEngineLabels;
    result.layers = usedLayers;
    result.continuityWarnings = continuityWarnings;
    result.subtitles = !!srtContent;
    result.honestLabel = honestLabel;
    result.technicalReport = {
      hasVideo: vInfo.hasVideo,
      hasAudio: vInfo.hasAudio,
      durationSec: vInfo.durationSec,
      width: vInfo.width,
      height: vInfo.height,
      fps: vInfo.fps,
      videoCodec: vInfo.videoCodec,
      audioCodec: vInfo.audioCodec,
      avSyncOk,
      loudnessLufs: mixReport?.loudnessLufs ?? null,
      peakDb: mixReport?.peakDb ?? null,
      mixIssues: mixReport?.issues ?? [],
      subtitleBurned: !!srtContent,
    };
  });

  return { result };
};

// ------------------------------------------------------------
// সহায়ক — অবস্থানসহ অডিও-ট্র্যাক (A1/A2A3/A4 টাইমলাইন বানাতে)
// ------------------------------------------------------------

/**
 * একাধিক অডিও-খণ্ড নির্দিষ্ট মুহূর্তে বসিয়ে মোট দৈর্ঘ্যের একটি
 * টাইমলাইন রেন্ডার করে (adelay + amix + apad/atrim)।
 */
async function buildPositionedTrack(
  entries: { file: string; startSec: number; lenSec?: number }[],
  outputPath: string,
  totalSec: number
): Promise<void> {
  const inputs: string[] = [];
  const chains: string[] = [];
  entries.forEach((e, i) => {
    inputs.push('-i', e.file);
    const parts = ['aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo'];
    if (e.lenSec && e.lenSec > 0) parts.push(`atrim=0:${e.lenSec.toFixed(2)}`, 'asetpts=N/SR/TB');
    const delay = Math.max(0, Math.round(e.startSec * 1000));
    if (delay > 0) parts.push(`adelay=${delay}:all=1`);
    chains.push(`[${i}:a]${parts.join(',')}[t${i}]`);
  });
  const labels = entries.map((_, i) => `[t${i}]`).join('');
  chains.push(
    `${labels}amix=inputs=${entries.length}:normalize=0,apad=whole_dur=${totalSec.toFixed(2)},atrim=0:${totalSec.toFixed(2)}[out]`
  );
  await runFfmpeg(
    [...inputs, '-filter_complex', chains.join(';'), '-map', '[out]', '-c:a', 'pcm_s16le', outputPath],
    { timeoutMs: 180_000, label: 'অবস্থানসহ অডিও-টাইমলাইন রেন্ডার' }
  );
}
