// ============================================================
// Music video pipeline — নতুন মাস্টার প্ল্যান §৬ (৬-ধাপ কাঠামো)
// song_input → visual_plan → characters → generate_shots →
// timeline → final_qc।
//
//  - song_input: আপলোড গান → §৬.১ এনার্জি-বিশ্লেষণ (বিট/সেকশন/BPM);
//    গান না থাকলে §৩ প্রসিডিউরাল ইনস্ট্রুমেন্টাল (সৎ লেবেলসহ)।
//  - visual_plan: সেকশন-ভিত্তিক শট-তালিকা — কাট-পয়েন্ট বিট-মার্কার
//    থেকে সমান দূরত্বে বাছাই (প্রতিটি বিট নয়)।
//  - characters: Character-টেবিল থেকে পোর্ট্রেট পুনঃব্যবহার (§৭.২)।
//  - generate_shots: ai_diffusion (শিল্পী-পোর্ট্রেট data-URL দিয়ে i2v)
//    বা cinematic_motion — সৎ-ফলব্যাক ও লেবেলসহ।
//  - timeline: শট-ক্লিপ বিট-কাটে বসানো (ট্রিম+concat; xfade ≤৬),
//    গান মাস্টার-অডিও, ঐচ্ছিক লিরিক-সাবটাইটেল।
//  - final_qc (§৬.৫): দৈর্ঘ্য-মিল / অডিও-গুণমান / A-V সমলয় যাচাই।
//
// সততা: লিপ-সিঙ্ক নেই — "গায়কের মুখ নড়ছে" দাবি করা হয় না;
// প্রসিডিউরাল গান = পরীক্ষামূলক, নিউরাল মিউজিক-মডেল নয়।
// ============================================================

import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import type { PipelineFn, StepHandle } from '../runner';
import {
  kenBurnsClip,
  concatClips,
  muxAudio,
  portraitPrompt,
  sanitize,
  segmentDialogueToCues,
  makeSrt,
  burnSubtitles,
} from '../../film-helpers';
import { generateImageBuffer, editImageBuffer, chatJson, isRateLimitErrorText } from '../../sdk-helpers';
import { generateLocalFrame, LOCAL_FRAME_LABEL } from '../../local-frames';
import type { CinematicPlan, CinematicShot, PlanBeatSource } from '../../cinematic/types';
import { SHOT_SIZE_LABELS_BN } from '../../cinematic/types';
import { applyOverrides, planMusicVideo, summarizePlan } from '../../cinematic/planner';
import { buildCinematicVideoPrompt, buildCinematicImagePrompt } from '../../cinematic/prompt';
import { notePlanMetrics } from '../../run-metrics';
import { audioQuality, ffprobeJson, mediaInfo, runFfmpeg } from '@/lib/media/ffmpeg';
import { ASPECT_TO_GEN_SIZE, outputDims, maxShots } from '../../capabilities';
import {
  AI_VIDEO_MODEL,
  prewarmVideoClip,
  videoGenerationEtaNote,
} from '../../video/ai_video';
import { generateAiShot, toDataUrl, aiClipDurationSec, type ShotEngineRecord } from './motion_video';
import {
  synthesizeInstrumental,
  analyzeAudioEnergy,
  moodLabel,
  MUSIC_ENGINE_LABEL,
  barRoleEnergy,
  resolveInstrumentalMood,
  type MusicMood,
} from '../../audio/music_engine';
import { resolveVoice } from '../../audio/language_controller';
import { db } from '@/lib/db';

interface MvShot {
  /** Phase-5: যাচাইকৃত সিনেম্যাটিক পরিকল্পনার শট — প্রম্পট/মেটাডেটার
   * একক সত্যের উৎস (size/movement/delivery/framing সব এখানে) */
  cinematic: CinematicShot;
  /** LLM-নামানো চরিত্র (i2v-পোর্ট্রেট ম্যাচের জন্য) থাকলে */
  character?: string | null;
  framePath?: string;
  clipPath?: string;
}

interface MvCharacter {
  name: string;
  appearance: string;
  portraitPath?: string;
  portraitDataUrl?: string;
  reused?: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export const musicVideoPipeline: PipelineFn = async ctx => {
  const spec = ctx.spec;
  const aspect = spec.aspect ?? '9:16';
  const fps = spec.fps ?? 30;
  const engine = spec.videoEngine === 'cinematic_motion' ? 'cinematic_motion' : 'ai_diffusion';
  // (অডিট §D) spec-এ স্পষ্ট রেজোলিউশন থাকলে সেটিই; নইলে quality-ভিত্তিক ডিফল্ট
  const resolution = spec.resolution ?? (spec.quality === 'draft' ? '720p' : '1080p');
  const dims = outputDims(aspect, resolution);
  const wd = ctx.workingDir;
  const genSize = ASPECT_TO_GEN_SIZE[aspect];

  const notes: string[] = [];

  // ------------------------------------------------------- song_input
  let songPath: string | null = null;
  let songArtifactId: string | null = null;
  let songDuration = 0;
  /** গান থেকে ব্যবহৃত অংশ (টার্গেট-দৈর্ঘ্য) */
  let songUseSec = 0;
  let targetDuration = 0;
  let beatsSec: number[] = [];
  let sections: { name: string; startSec: number; endSec: number; energy: string }[] = [];
  let songBpm = 0;
  let musicSourceLabel = '';
  let analysisLabel = '';
  /** Phase-5: আপলোড-গানের পথ চলেছে কি না (প্রসিডিউরাল নয়) — বিট-উৎসের সৎ লেবেলের ভিত্তি */
  let uploadedSong = false;
  await ctx.runStep('song_input', 'গান ইনপুট ও বিট-বিশ্লেষণ', async (step: StepHandle) => {
    const desired = spec.durationSec && spec.durationSec > 0 ? spec.durationSec : 60;
    if (spec.songArtifactId) {
      songPath = await ctx.resolveArtifactFile(spec.songArtifactId);
      songArtifactId = spec.songArtifactId;
      uploadedSong = true;
      const info = await mediaInfo(songPath);
      if (!info.hasAudio) throw new Error('আপলোড করা গানে অডিও স্ট্রিম পাওয়া যায়নি');
      songDuration = info.durationSec;
      // §৬.১ — এনার্জি-বিশ্লেষণ: বিট-মার্কার, সেকশন, আনুমানিক BPM
      const analysis = await analyzeAudioEnergy(songPath);
      beatsSec = analysis.beatsSec;
      sections = analysis.sections.map(s => ({ name: s.energy, startSec: s.startSec, endSec: s.endSec, energy: s.energy }));
      songBpm = analysis.estimatedBpm;
      analysisLabel = analysis.honestLabel;
      targetDuration = Math.max(5, Math.min(desired, songDuration));
      songUseSec = targetDuration;
      musicSourceLabel = 'ব্যবহারকারীর আপলোড করা গান';
      await step.setDetail(
        `আপলোড গান ${songDuration.toFixed(1)} সে. — ≈${songBpm || '?'} BPM, ${beatsSec.length}টি বিট-মার্কার (${analysisLabel})`
      );
    } else if (spec.musicSource === 'none') {
      targetDuration = Math.max(15, Math.min(180, desired));
      musicSourceLabel = 'গান নেই — নীরব টাইমলাইন';
      await step.setDetail('গান ছাড়া নীরব মিউজিক-ভিডিও');
      notes.push('গান নেই — নীরব টাইমলাইন (musicSource: none)।');
    } else {
      // §৩ — প্রসিডিউরাল ইনস্ট্রুমেন্টাল (সৎ লেবেলসহ)।
      // মুড-নির্ণয় ও বিট-গ্রিড এখন একক উৎস থেকে (resolveInstrumentalMood /
      // proceduralSongGrid) — নিশ্চিতকরণ-পূর্ব প্ল্যান-প্রিভিউ একই গ্রিড দেখায়।
      const mood: MusicMood = resolveInstrumentalMood({
        mood: spec.mood,
        idea: spec.idea,
        title: spec.title,
        genre: spec.genre,
      });
      const dur = Math.max(8, Math.min(120, desired));
      await step.setDetail(`${moodLabel(mood)} মুডে প্রসিডিউরাল ইনস্ট্রুমেন্টাল (${dur} সে.) সংশ্লেষণ…`);
      const inst = await synthesizeInstrumental({ mood, durationSec: dur, tempoBpm: spec.tempoBpm, genre: spec.genre });
      const wavPath = path.join(wd, 'procedural-song.wav');
      await writeFile(wavPath, inst.buffer);
      const art = await ctx.registerArtifact({
        buffer: inst.buffer,
        kind: 'audio',
        mimeType: 'audio/wav',
        fileName: `${sanitize(spec.title || 'music-video').slice(0, 36)}-instrumental.wav`,
        metaJson: {
          pipeline: 'music_video',
          kind: 'song',
          source: 'procedural',
          mood: inst.meta.mood,
          moodLabel: moodLabel(inst.meta.mood),
          tempoBpm: inst.meta.tempoBpm,
          keyLabel: inst.meta.keyLabel,
          beats: inst.meta.beatsSec.length,
          sections: inst.meta.sections,
          honestLabel: inst.meta.honestLabel,
        },
      });
      songPath = wavPath;
      songArtifactId = art.id;
      songDuration = inst.meta.durationSec;
      beatsSec = inst.meta.beatsSec;
      sections = inst.meta.sections.map(s => ({ name: s.name, startSec: s.startSec, endSec: s.endSec, energy: barRoleEnergy(s.name) }));
      songBpm = inst.meta.tempoBpm;
      targetDuration = songDuration;
      songUseSec = songDuration;
      musicSourceLabel = `প্রসিডিউরাল ইনস্ট্রুমেন্টাল (${moodLabel(inst.meta.mood)}, ${inst.meta.tempoBpm} BPM)`;
      notes.push(
        `গান: পরীক্ষামূলক প্রসিডিউরাল ইনস্ট্রুমেন্টাল — নিউরাল মিউজিক-মডেল নয় (${MUSIC_ENGINE_LABEL})।`
      );
      await step.setDetail(
        `প্রসিডিউরাল গান তৈরি — ${inst.meta.durationSec} সে., ${inst.meta.tempoBpm} BPM, ${beatsSec.length}টি বিট-মার্কার`
      );
    }
  }, { timeoutMs: 6 * 60_000 }); // S10

  const energyAt = (t: number): string => {
    const s = sections.find(x => t >= x.startSec && t < x.endSec);
    return s?.energy ?? 'medium';
  };

  // ------------------------------------------------------- visual_plan
  let shots: MvShot[] = [];
  let characters: MvCharacter[] = [];
  let visualStyle = '';
  /** Phase-5: যাচাইকৃত সিনেম্যাটিক পরিকল্পনা — artifact + final_qc-র জন্য */
  let plan: CinematicPlan | null = null;
  await ctx.runStep('visual_plan', 'সিনেম্যাটিক শট-পরিকল্পনা (নির্ধারক আর্ক + LLM বর্ণনা)', async (step: StepHandle) => {
    const limit = maxShots('music_video', spec.quality, engine);

    // Phase-5: কাট-পয়েন্ট/আর্ক এখন নির্ধারক পরিকল্পকে (cinematic/planner)
    // থেকে — Phase-4-এর অ্যালগরিদম হুবহু ওই মডিউলে উঠেছে; শট-সংখ্যার
    // আচরণ অপরিবর্তিত। নিশ্চিতকরণ-পূর্ব প্রিভিউও একই ফাংশন ডাকে।
    // বিট-উৎসের সৎ লেবেল: কেবল আপলোড-গানের প্রকৃত ffmpeg-বিশ্লেষণই
    // 'measured' — প্রসিডিউরাল গানের বিট নির্ধারক BPM-গ্রিড
    // ('bpm_grid_estimate', প্রিভিউ-পথের সাথে অভিন্ন), নীরব = 'silent'।
    let beatSource: PlanBeatSource;
    if (uploadedSong) beatSource = beatsSec.length > 0 ? 'measured' : 'duration_fallback';
    else if (spec.musicSource === 'none') beatSource = 'silent';
    else beatSource = 'bpm_grid_estimate';

    const planStart = Date.now();
    plan = applyOverrides(
      planMusicVideo({
        engine,
        limit,
        targetDurationSec: targetDuration,
        beatsSec,
        sections: sections.map(s => ({ startSec: s.startSec, endSec: s.endSec, energy: s.energy })),
        beatSource,
        // কাঠামো সবসময় পারফরম্যান্স-আর্ক ধরে (নির্ধারক — প্রিভিউ/রান অভিন্ন);
        // শিল্পী-পোর্ট্রেট (i2v) রান-সময় LLM-চরিত্র থেকে ঐচ্ছিক সমৃদ্ধি।
        hasArtist: true,
        ...(spec.style ? { visualStyle: spec.style } : {}),
      }),
      spec.cinematicOverrides,
      engine
    );
    notePlanMetrics(ctx.productionId, {
      planMs: Date.now() - planStart,
      plannedShots: plan.shots.length,
      planAdjustments: plan.adjustments.length,
    });
    if (plan.adjustments.length > 0) {
      ctx.partialNotes.push(
        `শট-পরিকল্পনায় ${plan.adjustments.length}টি সৎ-সমন্বয় (ক্যামেরা-ডাউনগ্রেড/ব্যবহারকারী-ওভাররাইড) — shot-plan.json artifact-এ বিস্তারিত।`
      );
    }
    const segs = plan.shots.map(cs => {
      const s = cs.startSec ?? 0;
      const e = cs.endSec ?? round2(s + cs.targetDurationSec);
      return { startSec: s, endSec: e, energy: energyAt((s + e) / 2) };
    });

    // S11: পরিকল্পনা-ধাপ কখনো পাইপলাইন মারবে না — ৪২৯-উইন্ডোতেও
    // নিচের নির্ধারক সৎ-বর্ণনা (planner-এর fallbackActionEn) বহাল থাকে।
    // Phase-5: LLM এখন কেবল স্লট-বর্ণনা লেখে — কাঠামো (সাইজ/মুভমেন্ট/কাট)
    // নির্ধারক পরিকল্পনার, LLM-এর হাতে নয়। কল-সংখ্যা Phase-4-এর মতোই ১টি।
    let data: {
      visualStyle: string;
      characters: { name: string; appearance: string }[];
      shots: { description: string; label: string; character?: string | null }[];
    } | null = null;
    try {
      ({ data } = await chatJson<{
        visualStyle: string;
        characters: { name: string; appearance: string }[];
        shots: { description: string; label: string; character?: string | null }[];
      }>([
      {
        role: 'assistant',
        content:
          'তুমি মিউজিক-ভিডিও পরিচালক। ক্যামেরা-কাঠামো (শট-সাইজ/ক্যামেরা-মুভমেন্ট/কাট-পয়েন্ট) নির্ধারক পরিকল্পক ঠিক করে দিয়েছে — তুমি শুধু প্রতিটি স্লটের দৃশ্যমান বর্ণনা লিখবে।\n' +
          `ঠিক ${segs.length}টি শট — প্রতিটি সেগমেন্ট-জানালার জন্য একটি করে।\n` +
          'description ইংরেজিতে — দৃশ্যমান বিষয়: পরিবেশ, চরিত্রের অবস্থান/অঙ্গভঙ্গি, আলো, মুড (ভিডিও-জেনারেশন প্রম্পটে যাবে); label বাংলায় (ছোট)।\n' +
          'description-এ ক্যামেরা-নির্দেশ (zoom/pan/dolly/angle…) লিখো না — সেটি পরিকল্পনা থেকে প্রম্পটে স্বয়ংক্রিয়ভাবে যুক্ত হয়।\n' +
          'গায়ক/শিল্পী-চরিত্র দরকার হলে ঠিক ১টি দাও (সংগীতশিল্পী) — appearance ইংরেজিতে বিস্তারিত (বয়স, চেহারা, পোশাক); পারফরম্যান্স/রিঅ্যাকশন স্লটের shots[].character-এ ওই নাম দাও, অন্যগুলোতে null।\n' +
          'শুধু JSON: {"visualStyle":"...","characters":[{"name":"...","appearance":"..."}],"shots":[{"description":"...","label":"...","character":"নাম বা null"}]}',
      },
      {
        role: 'user',
        content:
          `শিরোনাম: ${spec.title}\nআইডিয়া: ${spec.idea ?? '(স্বাধীন)'}\nমোট দৈর্ঘ্য: ${targetDuration.toFixed(1)} সেকেন্ড\n` +
          `গান-উৎস: ${musicSourceLabel}${songBpm ? ` (${songBpm} BPM)` : ''}\n` +
          `শট-স্লট (কাঠামো স্থির — শুধু বর্ণনা লিখো):\n${segs
            .map(
              (s, i) =>
                `  ${i + 1}. ${s.startSec.toFixed(1)}–${s.endSec.toFixed(1)} সে. [${s.energy}] — ${
                  SHOT_SIZE_LABELS_BN[plan!.shots[i].size]
                } (${plan!.shots[i].subject})`
            )
            .join('\n')}\n` +
          (spec.style ? `শৈলী-ইঙ্গিত: ${spec.style}` : ''),
      },
      ]));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.partialNotes.push(
        isRateLimitErrorText(msg)
          ? 'LLM স্লট-বর্ণনা রেট-লিমিটেড — নির্ধারক সৎ-বর্ণনা ব্যবহৃত (AI-বর্ণনা নয়)।'
          : `LLM স্লট-বর্ণনা ব্যর্থ (${msg.slice(0, 120)}) — নির্ধারক সৎ-বর্ণনা ব্যবহৃত।`
      );
      data = null;
    }

    // স্লট-বর্ণনা পরিকল্পনায় ঢোকানো (কাঠামো অপরিবর্তিত থাকে)
    const rawShots = Array.isArray(data?.shots) ? data.shots : [];
    plan.shots.forEach((cs, i) => {
      const s = rawShots[i];
      const description = String(s?.description ?? '').trim();
      if (description) cs.actionEn = description.slice(0, 800);
      const label = String(s?.label ?? '').trim();
      if (label) cs.labelBn = label.slice(0, 120);
      // Phase-5-fix (P5-5a): LLM কোনো স্লটে শিল্পী-চরিত্রের নাম দিলে
      // সেটি পারফরম্যান্স/রিঅ্যাকশন স্লটের পরিকল্পনা-প্রোভেনেন্সেও বসে
      // (shot-plan.json artifact-এ দৃশ্যমান — আগে সবসময় null থাকত)।
      const named = String(s?.character ?? '').trim();
      if (named && (cs.subject === 'artist_performance' || cs.subject === 'reaction')) {
        cs.character = named.slice(0, 60);
      }
    });
    if (rawShots.length > segs.length) {
      ctx.partialNotes.push(`LLM ${rawShots.length}টি বর্ণনা দিয়েছিল — সেগমেন্ট-সীমা অনুযায়ী ${segs.length}টি রাখা হলো।`);
    }
    visualStyle = String(data?.visualStyle ?? spec.style ?? '').slice(0, 200);
    if (visualStyle) plan.visualStyle = visualStyle;

    const rawChars = Array.isArray(data?.characters) ? data.characters : [];
    characters = rawChars
      .filter(c => String(c?.name ?? '').trim() && String(c?.appearance ?? '').trim())
      .slice(0, 1) // সংগীতশিল্পী-চরিত্র ১টি থাকলেই চলে
      .map(c => ({ name: String(c.name).slice(0, 60), appearance: String(c.appearance).slice(0, 600) }));

    shots = plan.shots.map((cs, i) => ({
      cinematic: cs,
      character: rawShots[i]?.character ? String(rawShots[i].character).slice(0, 60) : null,
    }));

    await step.setDetail(
      `${shots.length}টি শট (নির্ধারক আর্ক: এস্টাব্লিশিং → শক্তি-সচেতন মাঝ → সমাপনি), ${characters.length > 0 ? `চরিত্র: ${characters[0].name}` : 'দৃশ্য-কেন্দ্রিক'}`
    );

    // Phase-5: পরিকল্পনা artifact — পুরো যাচাইকৃত plan (typed, versioned)
    await ctx.registerArtifact({
      buffer: Buffer.from(JSON.stringify(plan, null, 2), 'utf-8'),
      kind: 'text',
      mimeType: 'application/json',
      fileName: 'shot-plan.json',
      metaJson: {
        pipeline: 'music_video',
        kind: 'cinematic_plan',
        version: plan.version,
        shots: plan.shots.length,
        beatSource: plan.beatSource,
        adjustments: plan.adjustments.length,
      },
    });

    // স্পিড-আপ (২০২৬-১০-১৩): AI-পথে প্রথম শট এখনই চালু — চরিত্র-পোর্ট্রেট
    // ও পরের ধাপগুলোর সাথে জেনারেশন ওভারল্যাপ করবে (~২–৭ মিনিট সাশ্রয়)।
    // i2v-রেফারেন্স (শিল্পী-পোর্ট্রেট) পরে আসে বলে প্রথম শট scene-ভিত্তিক।
    if (engine === 'ai_diffusion' && shots.length > 0) {
      prewarmVideoClip(
        {
          prompt: buildCinematicVideoPrompt(shots[0].cinematic, visualStyle || spec.style),
          durationSec: aiClipDurationSec(shots[0].cinematic.targetDurationSec),
          quality: 'speed' as const,
          requestKey: `mv-${ctx.productionId}-shot-1`,
        },
        {
          onStatus: note => {
            step.setDetail(`শট ১ ব্যাকগ্রাউন্ডে: ${note}`).catch(() => undefined);
          },
          // §3-D: প্রি-ওয়ার্ম-পোলও বাতিল মানবে
          isCancelled: () => ctx.isCancelled(),
        }
      );
      ctx.partialNotes.push('স্পিড-আপ: প্রথম AI-শট ভিজ্যুয়াল-পরিকল্পনার পরেই চালু (ওভারল্যাপ)।');
    }
  }, { timeoutMs: 6 * 60_000 }); // S10

  // ------------------------------------------------------- characters
  await ctx.runStep('characters', 'চরিত্র/পারফরম্যান্স রেফারেন্স', async (step: StepHandle) => {
    if (characters.length === 0) {
      await step.setDetail('দৃশ্য-কেন্দ্রিক ভিজ্যুয়াল — কোনো চরিত্র প্রয়োজন নেই');
      return;
    }
    // §৭.২ — Character-টেবিল থেকে মিল-নাম হলে পোর্ট্রেট পুনঃব্যবহার
    const existing = await db.character.findMany({ where: { conversationId: ctx.conversationId } });
    for (const ch of characters) {
      const match = existing.find(c => c.name.trim() === ch.name || c.name.includes(ch.name) || ch.name.includes(c.name.trim()));
      if (match?.portraitArtifactId) {
        try {
          const p = await ctx.resolveArtifactFile(match.portraitArtifactId);
          ch.portraitDataUrl = await toDataUrl(p);
          ch.portraitPath = p;
          ch.reused = true;
          await step.setDetail(`"${ch.name}" — Character-বাইবেল থেকে পোর্ট্রেট পুনঃব্যবহার`);
          continue;
        } catch {
          // পড়তে ব্যর্থ → নতুন পোর্ট্রেট তৈরি হবে
        }
      }
      await step.setDetail(`"${ch.name}" — পোর্ট্রেট তৈরি`);
      // S11: ক্লাউড-পোর্ট্রেট ব্যর্থ (৪২৯-সহ) হলে লোকাল প্রসিডিউরাল
      // পোর্ট্রেট — সৎ লেবেলসহ; Character-টেবিলে কেবল প্রকৃত AI-পোর্ট্রেট
      // ঢোকে (প্রসিডিউরাল ফ্রেমকে স্থায়ী রেফারেন্স বলা অসৎ হবে)।
      const charBase = sanitize(ch.name) || 'artist';
      const localPortraitPath = path.join(wd, `character-${charBase}-local.png`);
      const aiPortraitPath = path.join(wd, `character-${charBase}.png`);
      let buffer: Buffer;
      let portraitIsLocal = false;
      try {
        ({ buffer } = await generateImageBuffer(portraitPrompt(ch.name, ch.appearance), '864x1152'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          const local = await generateLocalFrame({
            seed: `mv-char-${ch.name}`,
            width: 864,
            height: 1152,
            outputPath: localPortraitPath,
            mood: String(spec.mood ?? ''),
            label: ch.name,
          });
          buffer = await readFile(local.path);
          portraitIsLocal = true;
          ctx.partialNotes.push(
            isRateLimitErrorText(msg)
              ? `চরিত্র ${ch.name}-এর পোর্ট্রেট ক্লাউড-রেট-লিমিটেড — ${LOCAL_FRAME_LABEL}`
              : `চরিত্র ${ch.name}-এর পোর্ট্রেট ক্লাউডে ব্যর্থ (${msg.slice(0, 100)}) — ${LOCAL_FRAME_LABEL}`
          );
        } catch (localErr) {
          ctx.partialNotes.push(
            `চরিত্র "${ch.name}"-এর পোর্ট্রেট তৈরি ব্যর্থ (${msg.slice(0, 120)}; লোকাল-ফ্রেম: ${
              localErr instanceof Error ? localErr.message.slice(0, 80) : 'অজানা'
            }) — দৃশ্য-প্রম্পট ব্যবহৃত হবে`
          );
          continue;
        }
      }
      const p = portraitIsLocal ? localPortraitPath : aiPortraitPath;
      if (!portraitIsLocal) await writeFile(p, buffer);
      const art = await ctx.registerArtifact({
        buffer,
        kind: 'image',
        mimeType: 'image/png',
        fileName: `character-${charBase}${portraitIsLocal ? '-local' : ''}.png`,
        metaJson: {
          characterName: ch.name,
          pipeline: 'music_video',
          kind: portraitIsLocal ? 'local-procedural' : 'artist-reference',
          ...(portraitIsLocal
            ? { honestLabel: LOCAL_FRAME_LABEL, note: 'local-procedural — AI পোর্ট্রেট নয়' }
            : {}),
        },
      });
      ch.portraitPath = p;
      ch.portraitDataUrl = `data:image/png;base64,${buffer.toString('base64')}`;
      if (portraitIsLocal) {
        await step.setDetail(`"${ch.name}" — লোকাল প্রসিডিউরাল পোর্ট্রেট (ক্লাউড-রেট-লিমিটেড)`);
        continue; // স্থায়ী Character-রেকর্ড নয় — সৎ সীমা
      }
      // §৭.২ — Character-টেবিলে সংরক্ষণ (পরের প্রোডাকশনে পুনঃব্যবহার)
      await db.character.upsert({
        where: { conversationId_name: { conversationId: ctx.conversationId, name: ch.name } },
        create: {
          conversationId: ctx.conversationId,
          name: ch.name,
          role: 'সংগীতশিল্পী',
          description: ch.appearance.slice(0, 500),
          appearanceJson: JSON.stringify({ appearance: ch.appearance }),
          language: spec.language ?? 'bn',
          voice: spec.voice ?? resolveVoice(spec.language === 'en' ? 'en' : 'bn'),
          portraitArtifactId: art.id,
        },
        update: { portraitArtifactId: art.id },
      });
    }
  }, { timeoutMs: 5 * 60_000 }); // S10

  // ------------------------------------------------------- generate_shots
  const shotEngineLabels: string[] = [];
  const shotEngines: ShotEngineRecord[] = [];
  let aiShots = 0;
  await ctx.runStep(
    'generate_shots',
    engine === 'ai_diffusion' ? `পারফরম্যান্স ক্লিপ জেনারেশন (${AI_VIDEO_MODEL} — ${videoGenerationEtaNote()})` : 'পারফরম্যান্স ক্লিপ জেনারেশন (স্টোরিবোর্ড+ক্যামেরা-মোশন)',
    async (step: StepHandle) => {
      // ট্রানজিশন-প্যাডিং সহ প্রয়োজনীয় দৈর্ঘ্য (timeline-ধাপের কাট-গণিত মেনে)
      const useXfade = shots.length <= 6;
      const T = useXfade ? 0.5 : 0;
      const valid: MvShot[] = [];
      for (let i = 0; i < shots.length; i++) {
        await ctx.checkCancelled();
        const shot = shots[i];
        const needPad = !useXfade ? 0 : i === 0 || i === shots.length - 1 ? T / 2 : T;
        const needed = round2(shot.cinematic.targetDurationSec + needPad);
        const artist = shot.character ? characters.find(c => c.name === shot.character && c.portraitDataUrl) : undefined;
        if (engine === 'ai_diffusion') {
          await step.setDetail(`শট ${i + 1}/${shots.length} জেনারেট হচ্ছে…`);
          try {
            const res = await generateAiShot({
              index: i,
              // Phase-5: প্রম্পট এখন পরিকল্পনার শট থেকে — action/framing/
              // composition/angle/movement/lighting সবই এখান দিয়ে যায়
              prompt: buildCinematicVideoPrompt(shot.cinematic, visualStyle || spec.style),
              neededSec: needed,
              fps,
              width: dims.w,
              height: dims.h,
              workingDir: wd,
              // i2v — শিল্পীর পোর্ট্রেট রেফারেন্স, চেহারা ধরে রাখতে
              imageUrl: artist?.portraitDataUrl,
              // §১০ আইডেম্পোটেন্সি: এই প্রোডাকশনের এই শট = একই request_id
              requestKey: `mv-${ctx.productionId}-shot-${i + 1}`,
              fallbackImagePrompt: buildCinematicImagePrompt(shot.cinematic, visualStyle || spec.style),
              fallbackGenSize: genSize,
              fallbackReferenceUrl: artist?.portraitDataUrl,
              fallbackMove: shot.cinematic.fallbackMove,
              onStatus: note => step.setDetail(`শট ${i + 1}/${shots.length}: ${note}`),
              // §3-D: প্রোভাইডার-পোলের ভেতরেও বাতিল-চেক
              isCancelled: () => ctx.isCancelled(),
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
                  shotId: shot.cinematic.shotId,
                  size: shot.cinematic.size,
                  movement: shot.cinematic.movement,
                  delivery: shot.cinematic.delivery,
                  cameraMove: shot.cinematic.fallbackMove,
                  label: shot.cinematic.labelBn,
                  note: res.frameLocal
                    ? `ক্লাউড AI-জেনারেশন ও ফলব্যাক-ফ্রেম ব্যর্থ — লোকাল প্রসিডিউরাল ফ্রেম (${LOCAL_FRAME_LABEL})`
                    : `AI-জেনারেশন ব্যর্থ — ফলব্যাক ফ্রেম (${res.fallbackError ?? ''})`,
                },
              });
            }
            shotEngineLabels.push(res.engineLabel);
            shotEngines.push({
              index: i + 1,
              engine: res.engine,
              label: res.engineLabel,
              ...(res.aiModel ? { model: res.aiModel } : {}),
              ...(res.fallbackError ? { error: res.fallbackError.slice(0, 200) } : {}),
              ...(res.cacheHit ? { cacheHit: true } : {}),
            });
            valid.push({ ...shot, clipPath: res.clipPath, framePath: res.framePath });
          } catch (err) {
            ctx.partialNotes.push(
              `শট ${i + 1} তৈরি ব্যর্থ (${err instanceof Error ? err.message.slice(0, 140) : 'অজানা'}) — শট বাদ`
            );
          }
        } else {
          // cinematic_motion — চরিত্র-রেফারেন্স-কন্ডিশনড স্টোরিবোর্ড + Ken Burns
          await step.setDetail(`শট ${i + 1}/${shots.length} ফ্রেম${shot.character ? ` (${shot.character})` : ''}`);
          let buffer: Buffer | null = null;
          const tryGen = async (): Promise<Buffer> => {
            if (artist?.portraitDataUrl) {
              return (
                await editImageBuffer(
                  artist.portraitDataUrl,
                  `Place this same character in: ${shot.cinematic.actionEn}. Keep the face, hair and outfit identical to the reference. Consistent character.`,
                  genSize
                )
              ).buffer;
            }
            return (await generateImageBuffer(buildCinematicImagePrompt(shot.cinematic, visualStyle || spec.style), genSize)).buffer;
          };
          // S11: শট-বাদের আগে শেষ-উপায় — লোকাল প্রসিডিউরাল ফ্রেম (সৎ লেবেলসহ)
          let frameIsLocal = false;
          let frameFailReason = '';
          try {
            buffer = await tryGen();
          } catch (err) {
            frameFailReason = err instanceof Error ? err.message : String(err);
            try {
              buffer = await tryGen();
            } catch (err2) {
              const msg2 = err2 instanceof Error ? err2.message : String(err2);
              const rateLimited = isRateLimitErrorText(msg2);
              try {
                const localFrame = await generateLocalFrame({
                  seed: `mv-shot-${i}`,
                  width: dims.w,
                  height: dims.h,
                  outputPath: path.join(wd, `frame-${i}.png`),
                  mood: String(spec.mood ?? ''),
                  label: shot.cinematic.labelBn,
                });
                buffer = await readFile(localFrame.path);
                frameIsLocal = true;
                ctx.partialNotes.push(
                  rateLimited
                    ? `শট ${i + 1}-এর ইমেজ-জেন রেট-লিমিটেড — ${LOCAL_FRAME_LABEL}`
                    : `শট ${i + 1}-এর ফ্রেম ক্লাউডে ব্যর্থ (${msg2.slice(0, 100)}) — ${LOCAL_FRAME_LABEL}`
                );
              } catch (localErr) {
                ctx.partialNotes.push(
                  `শট ${i + 1}-এর ফ্রেম ব্যর্থ (${msg2.slice(0, 120)}) ও লোকাল-ফ্রেমও ব্যর্থ (${
                    localErr instanceof Error ? localErr.message.slice(0, 80) : 'অজানা'
                  }) — শট বাদ`
                );
                continue;
              }
            }
          }
          const framePath = path.join(wd, `frame-${i}.png`);
          if (!frameIsLocal) await writeFile(framePath, buffer);
          await ctx.registerArtifact({
            buffer,
            kind: 'image',
            mimeType: 'image/png',
            fileName: `storyboard-shot-${i + 1}.png`,
            metaJson: {
              shot: i + 1,
              of: shots.length,
              shotId: shot.cinematic.shotId,
              size: shot.cinematic.size,
              movement: shot.cinematic.movement,
              delivery: shot.cinematic.delivery,
              cameraMove: shot.cinematic.fallbackMove,
              label: shot.cinematic.labelBn,
              ...(frameIsLocal
                ? { kind: 'local-procedural', honestLabel: LOCAL_FRAME_LABEL, note: 'local-procedural — AI ফ্রেম নয়' }
                : {}),
            },
          });
          await step.setDetail(`শট ${i + 1}/${shots.length} মোশন ক্লিপ (${shot.cinematic.fallbackMove})`);
          const clipPath = path.join(wd, `clip-${i}.mp4`);
          try {
            await kenBurnsClip(framePath, clipPath, {
              durationSec: needed,
              fps: fps as 24 | 25 | 30,
              width: dims.w,
              height: dims.h,
              move: shot.cinematic.fallbackMove,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            try {
              await kenBurnsClip(framePath, clipPath, {
                durationSec: needed,
                fps: fps as 24 | 25 | 30,
                width: dims.w,
                height: dims.h,
                move: shot.cinematic.fallbackMove,
              });
            } catch {
              ctx.partialNotes.push(`শট ${i + 1}-এর ক্লিপ ব্যর্থ (${msg.slice(0, 120)}) — বাদ`);
              continue;
            }
          }
          shotEngineLabels.push(
            frameIsLocal
              ? `শট ${i + 1}: লোকাল প্রসিডিউরাল ফ্রেম + ক্যামেরা-মোশন (${
                  isRateLimitErrorText(frameFailReason) ? 'ইমেজ-জেন রেট-লিমিটেড' : 'ইমেজ-জেন ব্যর্থ'
                })`
              : `শট ${i + 1}: ক্যামেরা-মোশন (ইঞ্জিন-নির্বাচিত)`
          );
          shotEngines.push({
            index: i + 1,
            engine: frameIsLocal ? 'local_procedural' : 'storyboard',
            label: shotEngineLabels[shotEngineLabels.length - 1],
            ...(frameIsLocal ? { error: frameFailReason.slice(0, 200) } : {}),
          });
          valid.push({ ...shot, framePath, clipPath });
        }
      }
      if (valid.length === 0) throw new Error('কোনো পারফরম্যান্স ক্লিপই তৈরি হয়নি');
      shots = valid;
      await step.setDetail(`${valid.length}টি ক্লিপ সম্পন্ন`);
    },
    // S10: ai_diffusion প্রতি শটে মিনিট নেয় — দীর্ঘ সীমা; cinematic_motion দ্রুত
    { timeoutMs: engine === 'ai_diffusion' ? 45 * 60_000 : 15 * 60_000 }
  );

  // ------------------------------------------------------- timeline
  let finalVideo = '';
  let finalDuration = 0;
  let srtContent: string | null = null;
  await ctx.runStep('timeline', 'বিট-মার্কারে টাইমলাইন অ্যাসেম্বলি', async (step: StepHandle) => {
    await step.setDetail('শট-ক্লিপ বিট-কাট-পয়েন্টে মাপ-ট্রিম');
    const useXfade = shots.length <= 6;
    const T = useXfade ? 0.5 : 0;
    const prepped: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const needPad = !useXfade ? 0 : i === 0 || i === shots.length - 1 ? T / 2 : T;
      const want = round2(shot.cinematic.targetDurationSec + needPad);
      const dst = path.join(wd, `cut-${i}.mp4`);
      await runFfmpeg(
        [
          '-i', shot.clipPath!,
          '-t', want.toFixed(2),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-an', dst,
        ],
        { timeoutMs: 180_000, label: `শট ${i + 1} বিট-কাট ট্রিম` }
      );
      prepped.push(dst);
    }
    await step.setDetail(`${prepped.length}টি ক্লিপ জোড়া`);
    const silentPath = path.join(wd, 'assembled.mp4');
    await concatClips(prepped, silentPath, { transitionSec: T });
    const vInfo = await mediaInfo(silentPath);
    finalDuration = vInfo.durationSec;
    finalVideo = silentPath;

    // গান = মাস্টার-অডিও (ফেড-আউট-সহ, ব্যবহৃত অংশ পর্যন্ত)
    if (songPath) {
      await step.setDetail('গান মাস্টার-অডিও হিসেবে বসানো (ফেড-আউট-সহ)');
      const withSong = path.join(wd, 'with-song.mp4');
      await muxAudio(finalVideo, songPath, withSong, { durationSec: finalDuration, fadeOutSec: 2 });
      finalVideo = withSong;
    }

    // লিরিক্স-ওভারলে/সাবটাইটেল (ঐচ্ছিক)
    if (spec.subtitles && spec.text && spec.text.trim().length > 3) {
      await step.setDetail('লিরিক্স থেকে সাবটাইটেল');
      try {
        const cues = await segmentDialogueToCues(spec.text, { totalDurationSec: finalDuration });
        srtContent = makeSrt(cues);
        const srtPath = path.join(wd, 'lyrics.srt');
        await writeFile(srtPath, srtContent, 'utf-8');
        const burned = path.join(wd, 'subtitled.mp4');
        await burnSubtitles(finalVideo, srtPath, burned);
        finalVideo = burned;
      } catch (err) {
        srtContent = null;
        ctx.partialNotes.push(
          `সাবটাইটেল বার্ন ব্যর্থ (${err instanceof Error ? err.message.slice(0, 120) : 'অজানা'})`
        );
      }
    } else if (spec.subtitles && !spec.text) {
      ctx.partialNotes.push('সাবটাইটেল চাওয়া হলেও লিরিক্স (text) দেওয়া হয়নি — বাদ');
    }
    await step.setDetail(`টাইমলাইন: ${finalDuration.toFixed(1)} সেকেন্ড`);
  }, { timeoutMs: 10 * 60_000 }); // S10

  // ------------------------------------------------------- final_qc
  const result: Record<string, unknown> = {};
  await ctx.runStep('final_qc', 'চূড়ান্ত গুণমান-যাচাই (সমলয়/দৈর্ঘ্য)', async (step: StepHandle) => {
    // (ক) ভিডিওর দৈর্ঘ্য বনাম গানের ব্যবহৃত অংশ — >১.৫ সে. হলে মিলিয়ে দিন
    let info = await mediaInfo(finalVideo);
    const audioTarget = songPath ? songUseSec : targetDuration;
    const problems: string[] = [];
    if (Math.abs(info.durationSec - audioTarget) > 1.5) {
      await step.setDetail(
        `দৈর্ঘ্য মিলছে না (${info.durationSec.toFixed(1)} বনাম ${audioTarget.toFixed(1)} সে.) — ট্রিম দিয়ে মিলিয়ে হচ্ছে`
      );
      const fixed = path.join(wd, 'qc-trim.mp4');
      await runFfmpeg(
        [
          '-i', finalVideo,
          '-t', audioTarget.toFixed(2),
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
          ...(info.hasAudio ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an']),
          fixed,
        ],
        { timeoutMs: 180_000, label: 'দৈর্ঘ্য-সমন্বয় ট্রিম' }
      );
      finalVideo = fixed;
      info = await mediaInfo(fixed);
    }
    // ট্রিমের পরেও দৈর্ঘ্য না মিললে (শট-সীমার কারণে ভিডিও ছোট) — সৎ নোট
    if (Math.abs(info.durationSec - audioTarget) > 1.5) {
      ctx.partialNotes.push(
        `ভিডিও ${info.durationSec.toFixed(1)} সে. বনাম গানের ব্যবহৃত অংশ ${audioTarget.toFixed(1)} সে. — শট-সংখ্যার সীমার কারণে পুরো মেলানো যায়নি; গান ভিডিওর শেষে ফেড-আউট হয়`
      );
      problems.push('দৈর্ঘ্য-বিচ্যুতি (গান)');
    }

    if (!info.hasVideo) problems.push('ভিডিও স্ট্রিম নেই');
    if (songPath && !info.hasAudio) problems.push('গান থাকা সত্ত্বেও অডিও ট্র্যাক নেই');
    if (info.width !== dims.w || info.height !== dims.h) {
      ctx.partialNotes.push(`রেজোলিউশন ${info.width}×${info.height} — প্রত্যাশিত ${dims.w}×${dims.h}`);
      problems.push('রেজোলিউশন-বিচ্যুতি');
    }

    // (খ) অডিও-গুণমান — ক্লিপিং / দীর্ঘ নীরবতা
    let audioQ: Awaited<ReturnType<typeof audioQuality>> | null = null;
    if (info.hasAudio) {
      audioQ = await audioQuality(finalVideo);
      if (audioQ.peakDb != null && Number.isFinite(audioQ.peakDb) && audioQ.peakDb > -0.1) {
        problems.push(`ক্লিপিং-ঝুঁকি (পিক ${audioQ.peakDb.toFixed(1)} dB)`);
      }
      const silence = audioQ.silenceRanges.find(r => r.end - r.start > 3);
      if (silence && songPath) {
        problems.push(`দীর্ঘ নীরবতা ${silence.start.toFixed(1)}–${silence.end.toFixed(1)} সে.`);
      }
    }

    // (গ) A/V সমলয় — স্ট্রিম-দৈর্ঘ্যের পার্থক্য < ০.৫ সে.
    let avSyncOk: boolean | null = null;
    if (info.hasAudio && info.hasVideo) {
      try {
        const probe = await ffprobeJson(finalVideo);
        const v = (probe.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'video');
        const a = (probe.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === 'audio');
        const vd = Number(v?.duration ?? 0);
        const ad = Number(a?.duration ?? 0);
        if (vd > 0 && ad > 0) {
          avSyncOk = Math.abs(vd - ad) < 0.5;
          if (!avSyncOk) problems.push(`A/V স্ট্রিম-দৈর্ঘ্যে অসমলয় (ভিডিও ${vd.toFixed(2)} / অডিও ${ad.toFixed(2)} সে.)`);
        }
      } catch {
        // ffprobe-সমলয় যাচাই ব্যর্থ — অ-বাধামূলক
      }
    }

    // (ঘ) চূড়ান্ত artifact + গুণমান-প্রতিবেদন
    const honestLabel =
      engine === 'ai_diffusion'
        ? aiShots === shots.length
          ? `সব ${shots.length}টি শট প্রকৃত AI (${AI_VIDEO_MODEL}) — ক্লাউড ডিফিউশন ভিডিও`
          : `${aiShots}/${shots.length} শট প্রকৃত AI (${AI_VIDEO_MODEL}); বাকি ${shots.length - aiShots}টি স্টোরিবোর্ড+ক্যামেরা-মোশন ফলব্যাক`
        : 'cinematic_motion ইঞ্জিন — AI স্টোরিবোর্ড + ক্যামেরা-মোশন (প্রকৃত ডিফিউশন ভিডিও নয়)';
    notes.push('লিপ-সিঙ্ক নেই — "গায়কের মুখ নড়ছে" দাবি করা হয় না (§৫ সৎ-অবস্থা)।');

    if (srtContent) {
      await ctx.registerArtifact({
        buffer: Buffer.from(srtContent, 'utf-8'),
        kind: 'text',
        mimeType: 'application/x-subrip',
        fileName: 'lyrics.srt',
        metaJson: { pipeline: 'music_video', kind: 'lyrics' },
      });
    }

    await step.setDetail('চূড়ান্ত MP4 নিবন্ধন');
    const buf = await readFile(finalVideo);
    const artifact = await ctx.registerArtifact({
      buffer: buf,
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: `${sanitize(spec.title || 'music-video').slice(0, 40)}.mp4`,
      metaJson: {
        pipeline: 'music_video',
        engine,
        aiModel: engine === 'ai_diffusion' && aiShots > 0 ? AI_VIDEO_MODEL : null,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        fps: info.fps,
        aspect,
        shots: shots.length,
        song: {
          source: spec.songArtifactId ? 'uploaded' : spec.musicSource === 'none' ? 'none' : 'procedural',
          label: musicSourceLabel,
          bpm: songBpm || null,
          artifactId: songArtifactId,
          ...(analysisLabel ? { analysis: analysisLabel } : {}),
        },
        cutPoints: shots.map(s => s.cinematic.startSec ?? 0),
        shotEngineLabels,
        shotEngines,
        // Phase-5: যাচাইকৃত সিনেম্যাটিক পরিকল্পনার সৎ সারসংক্ষেপ (গণনা/এনাম-কেবল)
        ...(plan ? { cinematicPlan: summarizePlan(plan, engine) } : {}),
        subtitles: !!srtContent,
        avSyncOk,
        honestLabel,
        lipSync: false,
      },
    });

    const verdict =
      problems.length === 0
        ? `চমৎকার — ${shots.length}টি শট, ${info.durationSec.toFixed(1)} সেকেন্ড, ${info.width}×${info.height}@${info.fps}FPS${info.hasAudio ? `, গান-সমন্বয়-সহ (${musicSourceLabel})` : ''}। (${honestLabel})`
        : `কার্যকর, তবে সতর্কতা: ${problems.join(', ')}। ${info.durationSec.toFixed(1)} সেকেন্ড, ${shots.length}টি শট।`;
    result.quality = verdict;
    result.artifactId = artifact.id;
    result.durationSec = info.durationSec;
    result.shots = shots.length;
    result.engine = engine;
    result.shotEngineLabels = shotEngineLabels;
    result.shotEngines = shotEngines;
    result.aiShots = aiShots;
    result.songBpm = songBpm || null;
    result.musicSource = musicSourceLabel;
    result.musicEngine =
      spec.songArtifactId || spec.musicSource === 'none' ? null : 'procedural_instrumental';
    result.avSyncOk = avSyncOk;
    result.aspect = aspect;
    result.hasAudio = info.hasAudio;
    result.honestLabel = honestLabel;
    // Phase-5: পরিকল্পনার সারসংক্ষেপ resultJson-এও (কার্ড/রিপোর্টের জন্য)
    if (plan) result.cinematicPlan = summarizePlan(plan, engine);
    result.notes = notes;
  }, { timeoutMs: 10 * 60_000 }); // S10

  return { result };
};
