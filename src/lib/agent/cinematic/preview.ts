// ============================================================
// নিশ্চিতকরণ-পূর্ব প্ল্যান-প্রিভিউ — Phase 5 (সার্ভার-সাইড)।
//
// নীতি: প্রিভিউ প্রজন্ম নয় — শূন্য-ব্যয়, নির্ধারক, এবং **পাইপলাইনের
// একই ফাংশনগুলোই** ডাকে (selectCutSegments/planMusicVideo রান ও প্রিভিউ
// উভয়ের একক সত্যের উৎস)। ফলে প্রিভিউতে দেখানো কাট-গ্রিড/শট-কাঠামো
// আর রানে তৈরি হওয়া পরিকল্পনার মধ্যে পার্থক্য হতেই পারে না।
//
// সততা:
//  - আপলোড গান → প্রকৃত ffmpeg বিট-বিশ্লেষণ ('measured'); বিট না
//    পেলে সৎ-ফলব্যাক লেবেল।
//  - প্রসিডিউরাল → synthesizeInstrumental-এর নির্ধারক BPM-গ্রিড
//    (proceduralSongGrid — রান একই গ্রিড ব্যবহার করে; 'bpm_grid_estimate')।
//  - musicSource none → নীরব ('silent')।
//  - শর্টফিল্ম → কাঠামোগত কঙ্কাল — চূড়ান্ত দৃশ্য জেনারেশন-সময়ে
//    চিত্রনাট্য-LLM থেকে তৈরি হয়, প্রিভিউ তা স্পষ্টভাবে বলে।
//  - LLM প্রম্পট-টেক্সট প্রিভিউতে নেই — সৎ ফলব্যাক বর্ণনা দেখায়।
// ============================================================

import { analyzeAudioEnergy, barRoleEnergy, proceduralSongGrid, resolveInstrumentalMood } from '../audio/music_engine';
import { mediaInfo } from '@/lib/media/ffmpeg';
import { maxShots } from '../capabilities';
import type { CreativeJobSpec } from '@/lib/types';
import type { CinematicPlan, CinematicPlanSummary, PlanBeatSource } from './types';
import { BEAT_SOURCE_LABELS_BN } from './types';
import { applyOverrides, planMusicVideo, planShortFilmSkeleton, summarizePlan } from './planner';

export interface PlanPreviewResult {
  plan: CinematicPlan;
  summary: CinematicPlanSummary;
  /** কাট-টাইমিং-উৎসের সৎ বাংলা লেবেল */
  beatSourceLabel: string;
  /** অডিও-বিশ্লেষণের সৎ নোট (আপলোড গানে থাকে; বাকিতে অনুপস্থিত) */
  analysisLabel?: string;
}

// ------------------------------------------------------------
// আপলোড-গানের বিশ্লেষণ-ক্যাশ — সীমাবদ্ধ LRU (artifactId+storedAt কী;
// একই গানের বারবার প্রিভিউতে ffmpeg পুনঃপ্রোব হয় না; storedAt বদলালে
// কী বদলে যায় — নতুন ফাইলে পুরনো বিশ্লেষণ কখনো জুড়ে না)
// ------------------------------------------------------------

interface CachedSongAnalysis {
  durationSec: number;
  beatsSec: number[];
  sections: { startSec: number; endSec: number; energy: string }[];
  bpm: number;
  honestLabel: string;
}

const MAX_CACHED_SONGS = 8;

const g = globalThis as unknown as {
  __songAnalysisCache?: Map<string, CachedSongAnalysis>;
};

function songCache(): Map<string, CachedSongAnalysis> {
  if (!g.__songAnalysisCache) g.__songAnalysisCache = new Map();
  return g.__songAnalysisCache;
}

/**
 * আপলোড-গানের বিশ্লেষণ (ক্যাশ-সহ)। প্রকৃত ffmpeg — কিন্তু ক্লাউড-কল
 * শূন্য (ব্যয়-মুক্ত)। অডিও-স্ট্রিম না থাকলে সৎ ত্রুটি — ডাকনোক্তার কাছে।
 */
export async function analyzeSongArtifactCached(
  artifact: { id: string; storedAt: Date },
  file: string
): Promise<CachedSongAnalysis> {
  const key = `${artifact.id}:${artifact.storedAt.getTime()}`;
  const hit = songCache().get(key);
  if (hit) {
    // LRU স্পর্শ — সাম্প্রতিক এন্ট্রি শেষে যায়
    songCache().delete(key);
    songCache().set(key, hit);
    return hit;
  }
  const info = await mediaInfo(file);
  if (!info.hasAudio) throw new Error('আপলোড করা গানে অডিও স্ট্রিম পাওয়া যায়নি');
  const analysis = await analyzeAudioEnergy(file);
  const value: CachedSongAnalysis = {
    durationSec: info.durationSec,
    beatsSec: analysis.beatsSec,
    sections: analysis.sections.map(s => ({ startSec: s.startSec, endSec: s.endSec, energy: s.energy })),
    bpm: analysis.estimatedBpm,
    honestLabel: analysis.honestLabel,
  };
  songCache().set(key, value);
  while (songCache().size > MAX_CACHED_SONGS) {
    const oldest = songCache().keys().next().value;
    if (oldest === undefined) break;
    songCache().delete(oldest);
  }
  return value;
}

/** (টেস্ট-সাহায্য) গান-বিশ্লেষণ ক্যাশ সম্পূর্ণ ফেলে দাও */
export function resetSongAnalysisCacheForTests(): void {
  songCache().clear();
}

// ------------------------------------------------------------
// মিউজিক-ভিডিও — পাইপলাইন-অভিন্ন ইনপুট থেকে নির্ধারক পরিকল্পনা
// ------------------------------------------------------------

const mvEngine = (spec: CreativeJobSpec): 'ai_diffusion' | 'cinematic_motion' =>
  spec.videoEngine === 'cinematic_motion' ? 'cinematic_motion' : 'ai_diffusion';

/**
 * মিউজিক-ভিডিওর প্রকৃত প্রিভিউ-পরিকল্পনা — song_input + visual_plan-এর
 * একই সূত্র (দৈর্ঘ্য-ক্ল্যাম্প, বিট-উৎস, শট-সংখ্যা) প্রতিফলন করে।
 * `song` আর্টিফ্যাক্ট-সমাধান হয়ে আসা ফাইল (আপলোড গান) বা null।
 */
export async function buildMusicVideoPlanPreview(opts: {
  spec: CreativeJobSpec;
  song: { id: string; storedAt: Date; file: string } | null;
}): Promise<PlanPreviewResult> {
  const spec = opts.spec;
  const engine = mvEngine(spec);
  const desired = spec.durationSec && spec.durationSec > 0 ? spec.durationSec : 60;

  let targetDuration = 0;
  let beatsSec: number[] = [];
  let sections: { startSec: number; endSec: number; energy: string }[] = [];
  let beatSource: PlanBeatSource = 'duration_fallback';
  let analysisLabel: string | undefined;

  if (spec.songArtifactId && opts.song) {
    // আপলোড গান — প্রকৃত বিশ্লেষণ (পাইপলাইন song_input-এর মতোই)
    const analysis = await analyzeSongArtifactCached(opts.song, opts.song.file);
    targetDuration = Math.max(5, Math.min(desired, analysis.durationSec));
    beatsSec = analysis.beatsSec;
    sections = analysis.sections;
    beatSource = beatsSec.length > 0 ? 'measured' : 'duration_fallback';
    analysisLabel = analysis.honestLabel;
  } else if (spec.musicSource === 'none') {
    targetDuration = Math.max(15, Math.min(180, desired));
    beatSource = 'silent';
  } else {
    // প্রসিডিউরাল — রান যে নির্ধারক গ্রিডে গান বানাবে, ঠিক সেটিই
    // (অডিও সংশ্লেষণ ছাড়াই — proceduralSongGrid একক উৎস)
    const mood = resolveInstrumentalMood({
      mood: spec.mood,
      idea: spec.idea,
      title: spec.title,
      genre: spec.genre,
    });
    const dur = Math.max(8, Math.min(120, desired));
    const grid = proceduralSongGrid({ mood, durationSec: dur, tempoBpm: spec.tempoBpm });
    targetDuration = grid.durationSec;
    beatsSec = grid.beatsSec;
    sections = grid.sections.map(s => ({ startSec: s.startSec, endSec: s.endSec, energy: barRoleEnergy(s.name) }));
    beatSource = 'bpm_grid_estimate';
  }

  const plan = applyOverrides(
    planMusicVideo({
      engine,
      limit: maxShots('music_video', spec.quality, engine),
      targetDurationSec: targetDuration,
      beatsSec,
      sections,
      beatSource,
      // কাঠামো নির্ধারক: পারফরম্যান্স-আর্ক ধরে রাখা হয়; শিল্পী-পোর্ট্রেট
      // (i2v-রেফারেন্স) রান-সময় LLM-চরিত্র থেকে ঐচ্ছিক সমৃদ্ধি।
      hasArtist: true,
      ...(spec.style ? { visualStyle: spec.style } : {}),
    }),
    spec.cinematicOverrides,
    engine
  );

  return {
    plan,
    summary: summarizePlan(plan, engine),
    beatSourceLabel: BEAT_SOURCE_LABELS_BN[plan.beatSource],
    ...(analysisLabel ? { analysisLabel } : {}),
  };
}

// ------------------------------------------------------------
// শর্টফিল্ম — কাঠামোগত কঙ্কাল (সৎ লেবেলসহ)
// ------------------------------------------------------------

export function buildShortFilmPlanPreview(opts: { spec: CreativeJobSpec }): PlanPreviewResult {
  const spec = opts.spec;
  const engine = mvEngine(spec);
  // পাইপলাইনের দৈর্ঘ্য-ক্ল্যাম্প হুবহু
  const durationSec = Math.max(30, Math.min(120, spec.durationSec ?? 60));
  const plan = planShortFilmSkeleton({
    engine,
    limit: maxShots('short_film', spec.quality, engine),
    durationSec,
  });
  const summary = summarizePlan(plan, engine);
  summary.limitations.push(
    'এটি কাঠামোগত কঙ্কাল — চূড়ান্ত দৃশ্য ও শট-তালিকা জেনারেশন-সময়ে চিত্রনাট্য থেকে তৈরি হবে; তাই প্রতি-শট সম্পাদনা এখানে নেই।'
  );
  return {
    plan,
    summary,
    beatSourceLabel: BEAT_SOURCE_LABELS_BN[plan.beatSource],
  };
}
