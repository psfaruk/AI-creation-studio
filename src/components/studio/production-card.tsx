'use client';

// ============================================================
// ProductionCard — চ্যাটে দেখানো প্রোডাকশন কার্ড (মাস্টার প্ল্যান পার্ট E)।
// - awaiting_confirmation → বিশিষ্ট অ্যাম্বার ব্যানার + বড় "চালু করুন"/
//   "বাতিল" বাটন + কী-তৈরি-হবে সারাংশ (audit §2-A: অনুমোদন মিস করা
//   অসম্ভব, আর "চলছে"-র মতো দেখায় না)
// - running/queued → ধাপ-তালিকা + অগ্রগতি + "ক্লাউড ভিডিও" প্রোভাইডার-
//   স্ট্যাটাস সারি (§2-B) + বাতিল
// - completed/partial/failed/cancelled → সৎ ইঞ্জিন-ব্যাজ (§2-C) +
//   ফলাফল + সংশোধন/আবার-চালানো
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clapperboard,
  Cloud,
  Film,
  Image as ImageIcon,
  Images,
  Info,
  Loader2,
  Music,
  PencilRuler,
  RefreshCcw,
  Settings2,
  TriangleAlert,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ArtifactList } from '@/components/chat/artifact-view';
import { toBnDigits } from '@/components/chat/bn-format';
import {
  useConfigPanel,
  useShotPlanPreview,
  useSpecValidation,
  type ShotPlanPreviewLive,
  type SpecValidationLive,
} from '@/hooks/use-config-panel';
import { validateFieldsAgainstSchema, type ConfigPanelSchema, type ConfigPanelSongOption } from '@/lib/agent/config-panel';
import { useProductions } from '@/hooks/use-productions';
import { toast } from '@/hooks/use-toast';
import { useUiView } from '@/hooks/use-ui-view';
import type {
  CreativeJobSpec,
  FilmMode,
  MusicMood,
  ProductionStatus,
  ProductionView,
  SpeechLanguage,
  VideoEngine,
  VoicePreset,
} from '@/lib/types';
import type {
  MovementDelivery,
  PlanMovement,
  ShotSize,
} from '@/lib/agent/cinematic/types';
import {
  BEAT_SOURCE_LABELS_BN,
  MOVEMENT_DELIVERY_LABELS_BN,
  PLAN_MOVEMENTS,
  PLAN_MOVEMENT_LABELS_BN,
  SHOT_SIZES,
  SHOT_SIZE_LABELS_BN,
} from '@/lib/agent/cinematic/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// স্ট্যাটাস ব্যাজ
// ------------------------------------------------------------

const STATUS_META: Record<ProductionStatus, { label: string; className: string }> = {
  awaiting_confirmation: { label: 'নিশ্চয়তার অপেক্ষায়', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  queued: { label: 'সারিতে', className: 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300' },
  running: { label: 'চলছে', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  validating: { label: 'যাচাই হচ্ছে', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  completed: { label: 'সম্পন্ন', className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' },
  partial: { label: 'আংশিক সফল', className: 'border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400' },
  failed: { label: 'ব্যর্থ', className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400' },
  cancelled: { label: 'বাতিল', className: 'border-muted bg-muted text-muted-foreground' },
  cancelling: { label: 'বাতিল হচ্ছে', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

const TYPE_META: Record<string, { label: string; icon: typeof Film }> = {
  image: { label: 'ছবি প্রোডাকশন', icon: ImageIcon },
  audio: { label: 'অডিও প্রোডাকশন', icon: Music },
  motion_video: { label: 'মোশন ভিডিও', icon: Film },
  music_video: { label: 'মিউজিক ভিডিও', icon: Music },
  short_film: { label: 'শর্টফিল্ম', icon: Clapperboard },
};

const VIDEO_TYPES = ['motion_video', 'music_video', 'short_film'] as const;

const isVideoType = (type: CreativeJobSpec['type']) =>
  (VIDEO_TYPES as readonly string[]).includes(type);

// ------------------------------------------------------------
// §2-A: কী তৈরি হবে + সৎ সময়-অনুমান (নিশ্চিতকরণের আগে)
// ------------------------------------------------------------

/** প্রকারভেদে "কী তৈরি হবে"-র এক লাইনের বিবরণ */
function whatWillBeMade(spec: CreativeJobSpec): string {
  const aspect = spec.aspect ?? '16:9';
  const dur = spec.durationSec ? `${toBnDigits(spec.durationSec)} সেকেন্ডের ` : '';
  switch (spec.type) {
    case 'image':
      return `১টি চূড়ান্ত ছবি (${spec.format ? spec.format.toUpperCase() : 'PNG'}, ${aspect})`;
    case 'audio':
      return spec.audioOperation === 'instrumental'
        ? 'ইনস্ট্রুমেন্টাল সংগীত (WAV + MP3, বিট-মার্কার-সহ)'
        : 'কথা/ভয়েসওভার অডিও (পছন্দের কণ্ঠে)';
    case 'motion_video':
      return `${dur}মোশন ভিডিও (${aspect}, ${toBnDigits(spec.fps ?? 30)}fps) — ${
        spec.videoEngine === 'cinematic_motion' ? 'স্টোরিবোর্ড+ক্যামেরা-মোশন শট' : 'প্রতিটি শট ক্লাউড AI (CogVideoX-3) ডিফিউশনে'
      }`;
    case 'music_video':
      return `${dur}মিউজিক ভিডিও (${aspect}) — ${
        spec.songArtifactId ? 'আপনার আপলোড করা গানের সাথে সমলয়' : 'প্রসিডিউরাল ইন্সট্রুমেন্টাল স্কোরের সাথে'
      }`;
    case 'short_film':
      return `${dur}শর্টফিল্ম (${aspect}) — দৃশ্য, সংলাপ-কণ্ঠ ও সাবটাইটেল-সহ`;
    default:
      return 'স্রষ্টা-কাজের ফলাফল';
  }
}

/** প্রকার/ইঞ্জিনভেদে সৎ সময়-অনুমান (মোটামুটি রেঞ্জ — প্রম্পট বলে না) */
function honestEtaText(spec: CreativeJobSpec): string {
  const ai = spec.videoEngine !== 'cinematic_motion';
  switch (spec.type) {
    case 'image':
      return 'আনুমানিক ৩০–৯০ সেকেন্ড';
    case 'audio':
      return spec.audioOperation === 'instrumental' ? 'আনুমানিক ১–২ মিনিট' : 'আনুমানিক ১–৩ মিনিট';
    case 'motion_video':
      return ai ? 'আনুমানিক ৩–১০ মিনিট (প্রতি AI-শটে ২–৪ মিনিট)' : 'আনুমানিক ২–৪ মিনিট';
    case 'music_video':
      return ai ? 'আনুমানিক ৮–২০ মিনিট (AI-শটগুলো একে একে)' : 'আনুমানিক ৩–৬ মিনিট';
    case 'short_film':
      return ai ? 'আনুমানিক ১০–৩০ মিনিট (AI-শট + কণ্ঠ + সাউন্ড)' : 'আনুমানিক ৫–১০ মিনিট';
    default:
      return 'কয়েক মিনিট';
  }
}

// ------------------------------------------------------------
// §2-C: ফলাফলের সৎ ইঞ্জিন-ব্যাজ
// ------------------------------------------------------------

export interface ParsedResult {
  quality?: string;
  partialNotes?: string[];
  /**
   * (C-F05) পাইপলাইনের সৎ-স্ট্যাটাস নোট (যেমন MV-র "লিপ-সিঙ্ক নেই…") —
   * resultJson.notes: string[] থেকে আসে। পুরনো ফলাফলে নেই — প্রতিরোধমূলক:
   * উপস্থিত হলেই রেন্ডার হয়, অনুপস্থিত হলে কিছুই হয় না।
   */
  notes?: string[];
  engine?: string;
  aiShots?: number;
  shots?: number;
  shotEngines?: { index: number; engine: string; label: string; model?: string; error?: string }[];
  honestLabel?: string;
  musicEngine?: string | null;
  musicSource?: string;
  /** Phase-5: সিনেম্যাটিক পরিকল্পনার সারসংক্ষেপ (মিউজিক-ভিডিও/শর্টফিল্ম) */
  cinematicPlan?: {
    shotCount: number;
    totalPlannedSec: number;
    beatSource: string;
    deliveryCounts: Record<string, number>;
  };
}

/**
 * resultJson → নিরাপদ ParsedResult (বিকৃত/খালি JSON → null)।
 * (C-F05) notes-র প্রতিরোধমূলক স্বাভাবিকীকরণ: কেবল string-এন্ট্রিগুলোই
 * থাকে — পাইপলাইন-চুক্তি `notes: string[]`, তবে পুরনো/বিকৃত ফলাফলে
 * অ্যারে-নয়/অ-স্ট্রিং মান এসেও কার্ড যেন ভাঙভাঙ না করে।
 */
export function parseResultSummary(resultJson: string | null | undefined): ParsedResult | null {
  if (!resultJson) return null;
  try {
    const parsed = JSON.parse(resultJson) as ParsedResult;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...parsed,
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
        : undefined,
    };
  } catch {
    return null;
  }
}

/** ফলাফল-বিভাগে দেখানোর সৎ ইঞ্জিন-ব্যাজগুলো */
function EngineBadges({ view, result }: { view: ProductionView; result: ParsedResult | null }) {
  if (!result) return null;
  const badges: { key: string; label: string; className: string; title?: string }[] = [];

  if (isVideoType(view.spec.type)) {
    const records = result.shotEngines ?? [];
    const aiCount = records.length
      ? records.filter(r => r.engine === 'ai_video').length
      : (result.aiShots ?? 0);
    const total = records.length || result.shots || 0;
    const fallbackCount = records.filter(r => r.engine === 'storyboard_fallback').length;
    const localCount = records.filter(r => r.engine === 'local_procedural').length;
    const storyboardCount = records.filter(r => r.engine === 'storyboard').length;

    if (result.engine === 'ai_diffusion' && aiCount > 0) {
      badges.push({
        key: 'ai',
        label: `🎬 AI ভিডিও (CogVideoX-3)${total ? ` — ${toBnDigits(aiCount)}/${toBnDigits(total)} শট` : ''}`,
        className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
        title: 'প্রকৃত ক্লাউড ডিফিউশন ভিডিও — CogVideoX-3',
      });
    }
    if (result.engine === 'cinematic_motion') {
      badges.push({
        key: 'sb',
        label: '🖼 স্টোরিবোর্ড+ক্যামেরা-মোশন (AI ডিফিউশন নয়)',
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        title: 'ব্যবহারকারী-নির্বাচিত cinematic_motion ইঞ্জিন',
      });
    } else if (fallbackCount > 0) {
      badges.push({
        key: 'fb',
        label: `🖼 স্টোরিবোর্ড-ফলব্যাক (ক্যামেরা-মোশন)${total ? ` — ${toBnDigits(fallbackCount)} শট` : ''}`,
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        title: 'AI ভিডিও-জেনারেশন ব্যর্থ হওয়া শটে সৎ-ফলব্যাক',
      });
    }
    if (storyboardCount > 0 && result.engine !== 'cinematic_motion') {
      badges.push({
        key: 'sb2',
        label: `🖼 স্টোরিবোর্ড-শট — ${toBnDigits(storyboardCount)} টি`,
        className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
      });
    }
    if (localCount > 0) {
      badges.push({
        key: 'lp',
        label: `🎨 লোকাল প্রসিডিউরাল ফ্রেম — ${toBnDigits(localCount)} শট (নিউরাল নয়)`,
        className: 'border-stone-400/50 bg-stone-400/10 text-stone-600 dark:text-stone-300',
      });
    }
  }
  if (result.musicEngine === 'procedural_instrumental') {
    badges.push({
      key: 'music',
      label: '🎹 লোকাল ইন্সট্রুমেন্টাল (প্রসিডিউরাল)',
      className: 'border-stone-400/50 bg-stone-400/10 text-stone-600 dark:text-stone-300',
      title: 'স্থানীয় প্রসিডিউরাল মিউজিক-ইঞ্জিন — নিউরাল মিউজিক-মডেল নয়',
    });
  }
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="আউটপুটের ইঞ্জিন-সততা">
      {badges.map(b => (
        <Badge key={b.key} variant="outline" title={b.title ?? b.label} className={cn('h-auto px-2 py-0.5 text-[11px] leading-snug', b.className)}>
          {b.label}
        </Badge>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// §2-B: "ক্লাউড ভিডিও" প্রোভাইডার-স্ট্যাটাস সারি (চলমান প্যানেলে)
// — productions-view-ও পুনঃব্যবহার করে
// ------------------------------------------------------------

export function ProviderStatusRow({ provider }: { provider: NonNullable<ProductionView['providerStatus']> }) {
  const busy = provider.busy;
  const cooldownSec = Math.ceil(provider.cooldownRemainingMs / 1000);
  const state = busy
    ? `প্রোভাইডার ব্যস্ত — একটি কাজ একসাথে চলে${provider.inFlightSec ? ` (${toBnDigits(provider.inFlightSec)} সে. ধরে)` : ''}`
    : cooldownSec > 1
      ? `কুলডাউন চলছে (~${toBnDigits(cooldownSec)} সে.)`
      : 'মুক্ত';
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs"
      title={provider.lastError ? `সর্বশেষ সমস্যা: ${provider.lastError}` : 'CogVideoX-3 ক্লাউড প্রোভাইডারের বর্তমান অবস্থা'}
    >
      <span className="flex min-w-0 items-center gap-1.5 font-medium">
        <Cloud className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        ক্লাউড ভিডিও (CogVideoX-3)
      </span>
      <span
        className={cn(
          'min-w-0 truncate',
          busy
            ? 'text-amber-700 dark:text-amber-400'
            : cooldownSec > 1
              ? 'text-amber-700/90 dark:text-amber-400/90'
              : 'text-emerald-700 dark:text-emerald-400',
        )}
      >
        {state}
        {provider.inFlightTaskId && busy ? (
          <span className="ml-1 font-mono text-[10px] text-muted-foreground">#{provider.inFlightTaskId.slice(0, 8)}…</span>
        ) : null}
      </span>
    </div>
  );
}

/** দৈর্ঘ্যের নির্বাচনযোগ্য অপশন (§১৫ সীমার ভেতরে কয়েকটি বোধগম্য মান) */
const DURATION_OPTIONS: Record<string, number[]> = {
  motion_video: [5, 8, 10, 12, 15, 20],
  music_video: [15, 30, 60, 90, 120, 180],
  short_film: [30, 45, 60, 90, 120],
};

const IMAGE_FORMAT_LABELS: Record<NonNullable<CreativeJobSpec['format']>, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
};

/**
 * ভিডিও-ইঞ্জিন-সচেতন সততা-নোট (§৪) — ডিফল্ট এখন প্রকৃত AI ডিফিউশন।
 * (REG-12r টেস্ট-লক) এক্সপোর্টেড — অতিরঞ্জিত বিশেষণ/বাদ-পড়া ফলব্যাক-
 * স্বীকারোক্তি রিগ্রেশনে আটকে রাখার জন্য।
 */
export const VIDEO_ENGINE_NOTES: Record<VideoEngine, string> = {
  ai_diffusion:
    'প্রতিটি শট CogVideoX-3 ক্লাউড-ডিফিউশনে তৈরির জন্যই চেষ্টা হয় — প্রতি শটে ২–৪ মিনিট সময় লাগে; রেট-সীমায় ধৈর্যশীল ব্যাকঅফ হয়, তাই অপেক্ষার সময় বাড়তে পারে। রেট-সীমা/ব্যর্থতায় কিছু শট স্টোরিবোর্ড+ক্যামেরা-মোশনে নামতে পারে (ফলাফল-লেবেলে দেখা যাবে)।',
  cinematic_motion:
    'ভিডিও তৈরি হয় AI স্টোরিবোর্ড + সিনেম্যাটিক ক্যামেরা-মোশন পাইপলাইনে — ডিফিউশন ভিডিও-মডেল নয়; ফটোরিয়ালিস্টিক অভিনয়ের নিশ্চয়তা নেই।',
};

/** প্রসিডিউরাল-স্কোরের সৎ নোট (গান ছাড়া মিউজিক ভিডিও) */
const PROCEDURAL_SCORE_NOTE =
  'গান আপলোড করা হয়নি — প্রসিডিউরাল ইনস্ট্রুমেন্টাল স্কোর বসবে (নিউরাল মিউজিক-মডেল নয়)। নিজের গান অ্যাটাচ করলে সেটিই ব্যবহৃত হবে।';

/** গান ছাড়া ও স্কোর-নিষ্ক্রিয় মিউজিক ভিডিওর নোট */
const NO_SONG_NOTE =
  'গান আপলোড করা হয়নি এবং সংগীত-স্কোর বন্ধ রাখা হয়েছে — ভিডিও নীরব থাকবে। চাইলে গানের অডিও আপলোড করে আবার অনুরোধ করুন।';

/** ছোট অ্যাম্বার সতর্কতা-নোট */
function AmberNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

// ------------------------------------------------------------
// নতুন ফিল্ডের লেবেল-ম্যাপ (§২/§৪/§১০)
// ------------------------------------------------------------

const LANGUAGE_LABELS: Record<SpeechLanguage, string> = {
  bn: 'বাংলা',
  en: 'ইংরেজি',
  hi: 'হিন্দি',
  ur: 'উর্দু',
  zh: 'চীনা',
};

/**
 * (REG-12r টেস্ট-লক) এক্সপোর্টেড — O-3: অ-যাচাইকৃত গুণগত বিশেষণ
 * ("রিয়েলিস্টিক") আর নেই; প্রকৃত ইঞ্জিন + প্রকৃত খরচই বলে।
 */
export const VIDEO_ENGINE_LABELS: Record<VideoEngine, string> = {
  ai_diffusion: 'প্রকৃত AI ডিফিউশন ভিডিও (CogVideoX-3) — ধীর (প্রতি শটে ~২–৪ মিনিট)',
  cinematic_motion: 'স্টোরিবোর্ড+ক্যামেরা-মোশন — দ্রুত (মিনিটের ভেতর)',
};

const FILM_MODE_LABELS: Record<FilmMode, string> = {
  short_film: 'শর্টফিল্ম',
  dialogue_scene: 'সংলাপ-দৃশ্য',
  trailer: 'ট্রেইলার',
  story: 'গল্প',
};

const MOOD_LABELS: Record<MusicMood, string> = {
  sad: 'বিষণ্ণ',
  romantic: 'রোমান্টিক',
  joyful: 'আনন্দময়',
  suspense: 'রহস্যময়',
  action: 'অ্যাকশন',
  peaceful: 'শান্ত',
};

/**
 * কণ্ঠ-রেজিস্ট্রি (২০২৬-১০-১৩): Microsoft Edge-নিউরাল প্রধান —
 * bn-BD কণ্ঠগুলো সত্যিই বাংলা-প্রশিক্ষিত (দেশীয় উচ্চারণ); z-ai কণ্ঠগুলো
 * ফলব্যাক (বাংলা পড়তে পারে না)।
 */
const VOICE_OPTIONS: { id: VoicePreset; label: string; group: string }[] = [
  { id: 'bn-BD-NabanitaNeural', label: 'নবনীতা — বাংলা নিউরাল (নারী)', group: 'বাংলা নিউরাল (সুপারিশকৃত)' },
  { id: 'bn-BD-PradeepNeural', label: 'প্রদীপ — বাংলা নিউরাল (পুরুষ)', group: 'বাংলা নিউরাল (সুপারিশকৃত)' },
  { id: 'bn-IN-TanishaaNeural', label: 'তানিশা — বাংলা, ভারত (নারী)', group: 'বাংলা নিউরাল (সুপারিশকৃত)' },
  { id: 'bn-IN-BashkarNeural', label: 'ভাস্কর — বাংলা, ভারত (পুরুষ)', group: 'বাংলা নিউরাল (সুপারিশকৃত)' },
  { id: 'en-US-AriaNeural', label: 'আরিয়া — ইংরেজি নিউরাল (নারী)', group: 'ইংরেজি নিউরাল' },
  { id: 'en-US-GuyNeural', label: 'গাই — ইংরেজি নিউরাল (পুরুষ)', group: 'ইংরেজি নিউরাল' },
  { id: 'en-GB-SoniaNeural', label: 'সোনিয়া — ব্রিটিশ ইংরেজি (নারী)', group: 'ইংরেজি নিউরাল' },
  { id: 'hi-IN-SwaraNeural', label: 'স্বরা — হিন্দি নিউরাল (নারী) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'hi-IN-MadhurNeural', label: 'মধুর — হিন্দি নিউরাল (পুরুষ) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'ur-PK-UzmaNeural', label: 'উজমা — উর্দু নিউরাল (নারী) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'ur-PK-AsadNeural', label: 'আসাদ — উর্দু নিউরাল (পুরুষ) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'zh-CN-XiaoxiaoNeural', label: 'শিয়াওশিয়াও — চীনা সরলীকৃত (নারী) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'zh-CN-YunxiNeural', label: 'ইউনশি — চীনা সরলীকৃত (পুরুষ) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'zh-HK-HiuMaanNeural', label: 'হিউমান — ক্যান্টনিজ (নারী) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'zh-TW-HsiaoChenNeural', label: 'শিয়াওচেন — চীনা প্রথাগত (নারী) — অপরীক্ষিত', group: 'অন্য ভাষা (Edge-নিউরাল, এই পরিবেশে অপরীক্ষিত)' },
  { id: 'jam', label: 'jam — ইংরেজি (z-ai)', group: 'z-ai (ফলব্যাক)' },
  { id: 'douji', label: 'douji (z-ai)', group: 'z-ai (ফলব্যাক)' },
  { id: 'tongtong', label: 'tongtong (z-ai)', group: 'z-ai (ফলব্যাক)' },
  { id: 'kazi', label: 'kazi (z-ai)', group: 'z-ai (ফলব্যাক)' },
  { id: 'chuichui', label: 'chuichui (z-ai)', group: 'z-ai (ফলব্যাক)' },
  { id: 'xiaochen', label: 'xiaochen (z-ai)', group: 'z-ai (ফলব্যাক)' },
  { id: 'luodo', label: 'luodo (z-ai)', group: 'z-ai (ফলব্যাক)' },
];

const MOOD_OPTIONS: MusicMood[] = ['sad', 'romantic', 'joyful', 'suspense', 'action', 'peaceful'];

/** (অডিট §D) টেম্পো-অপশন — §১৫ সীমা (৬০–১৭০ BPM) মাথামথিতে কয়েকটি বোধগম্য মান */
const TEMPO_OPTIONS: number[] = [70, 80, 90, 100, 110, 120, 130, 140, 150];

/** (অডিট §D) ভিজ্যুয়াল-স্টাইল প্রিসেট — কাঁচা মান ব্যাকএন্ড-প্রম্পটে যায়;
 *  প্রিসেট-বহির্ভূত মান (যেমন LLM-সেট) "কাস্টম" টেক্সট-ইনপুটে সম্ভব */
const STYLE_PRESETS: { value: string; label: string }[] = [
  { value: 'cinematic', label: 'সিনেম্যাটিক' },
  { value: 'natural', label: 'ন্যাচারাল' },
  { value: 'anime', label: 'অ্যানিমে' },
  { value: 'fantasy', label: 'ফ্যান্টাসি' },
  { value: 'retro', label: 'রেট্রো' },
  { value: 'documentary', label: 'ডকুমেন্টারি' },
  { value: 'neon-cyberpunk', label: 'নিয়ন-সাইবারপাংক' },
];

// ------------------------------------------------------------
// সেটিংস সারাংশ (নিশ্চিতকরণের আগে দেখানো)
// ------------------------------------------------------------

function specSummaryText(spec: CreativeJobSpec): string[] {
  const bits: string[] = [];
  bits.push(`মান: ${spec.quality === 'draft' ? 'ড্রাফট (দ্রুত)' : spec.quality === 'high' ? 'উচ্চ' : 'স্ট্যান্ডার্ড'}`);
  if (spec.language) bits.push(`ভাষা: ${LANGUAGE_LABELS[spec.language] ?? spec.language}`);
  if (spec.videoEngine) bits.push(`ইঞ্জিন: ${spec.videoEngine === 'ai_diffusion' ? 'AI (CogVideoX-3)' : 'ক্যামেরা-মোশন'}`);
  if (spec.filmMode) bits.push(`ফিল্ম-মোড: ${FILM_MODE_LABELS[spec.filmMode] ?? spec.filmMode}`);
  if (spec.mood && MOOD_LABELS[spec.mood as MusicMood]) bits.push(`মুড: ${MOOD_LABELS[spec.mood as MusicMood]}`);
  else if (spec.mood) bits.push(`মুড: ${String(spec.mood)}`);
  if (typeof spec.tempoBpm === 'number') bits.push(`টেম্পো: ${toBnDigits(spec.tempoBpm)} BPM`);
  if (spec.aspect) bits.push(`অনুপাত: ${toBnDigits(spec.aspect)}`);
  if (spec.durationSec) bits.push(`দৈর্ঘ্য: ${toBnDigits(spec.durationSec)} সেকেন্ড`);
  if (spec.fps) bits.push(`FPS: ${toBnDigits(spec.fps)}`);
  // সততা: uploaded_song কিন্তু আসল গান-আর্টিফ্যাক্ট নেই → প্রসিডিউরাল হবে (নোট-সহ সৎ লেবেল)
  if (spec.sound === 'uploaded_song' && !spec.songArtifactId) {
    bits.push('শব্দ: প্রসিডিউরাল ইনস্ট্রুমেন্টাল (আপলোড করা গান নেই)');
  } else if (spec.sound) {
    bits.push(`শব্দ: ${{ none: 'নীরব', ambient: 'পরিবেশ-শব্দ', narration: 'ভয়েসওভার', uploaded_song: 'আপলোড করা গান' }[spec.sound]}`);
  }
  if (spec.voice) {
    const vLabel = VOICE_OPTIONS.find(v => v.id === spec.voice);
    bits.push(`কণ্ঠ: ${vLabel ? vLabel.label : spec.voice}`);
  }
  if (spec.subtitles) bits.push('সাবটাইটেল: হ্যাঁ');
  if (spec.format) bits.push(`ফরম্যাট: ${IMAGE_FORMAT_LABELS[spec.format]}`);
  if (spec.resolution) bits.push(`রেজোলিউশন: ${spec.resolution}`);
  if (spec.genre) bits.push(`জনরা: ${spec.genre}`);
  if (spec.style) bits.push(`স্টাইল: ${spec.style}`);
  return bits;
}

/**
 * (অডিট §A3) ব্যর্থ প্রোডাকশনের অতিবাহিত-সময় —
 * startedAt ও finishedAt দুটোই থাকলেই দেখানো যায় ("৩ মি. ২০ সে.")
 */
function elapsedTextBn(startedAt?: string, finishedAt?: string): string {
  if (!startedAt || !finishedAt) return '';
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(finishedAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '';
  const totalSec = Math.round((endMs - startMs) / 1000);
  if (totalSec < 60) return `${toBnDigits(totalSec)} সে.`;
  return `${toBnDigits(Math.floor(totalSec / 60))} মি. ${toBnDigits(totalSec % 60)} সে.`;
}

// ------------------------------------------------------------
// সম্পাদনাযোগ্য সেটিংস (§১৪ ক্যাটালগ)
// ------------------------------------------------------------

function SpecEditor({
  spec,
  onChange,
  songs,
  fieldErrors,
  onSongsMenuOpen,
}: {
  spec: CreativeJobSpec;
  onChange: (next: CreativeJobSpec) => void;
  /** Phase-4 C: মিউজিক ভিডিওর গান-নির্বাচনের অপশন (কথোপকথনের আপলোড) */
  songs?: ConfigPanelSongOption[];
  /** Phase-4 C: ক্ষেত্র-স্তরের যাচাই-ত্রুটি (স্কিমা-সচেতন) */
  fieldErrors?: { key: string; messageBn: string }[];
  /**
   * (A2-F02) গান-নির্বাচক খোলার মুহূর্তের ট্রিগার — কার্ড খোলার *পরে* চ্যাটে
   * আপলোড করা গানও পৃষ্ঠা-রিফ্রেশ ছাড়াই তালিকায় আসে (স্কিমা-পুনঃআনা)।
   */
  onSongsMenuOpen?: () => void;
}) {
  const errFor = (key: string) => fieldErrors?.find(e => e.key === key)?.messageBn;
  // (অডিট §D) "উন্নত সেটিংস" কোলাপ্সিবল — কম-ব্যবহৃত ফিল্ডগুলো ভাঁজ-করা;
  // মূল ফর্মে থাকে: মান/ভাষা/ইঞ্জিন/ফিল্ম-মোড/মুড/অনুপাত/দৈর্ঘ্য/কণ্ঠ
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** স্টাইল-ড্রপডাউনে "কাস্টম" নির্বাচিত — খোলা টেক্সট-ইনপুট দেখায় */
  const [customStyleMode, setCustomStyleMode] = useState(false);

  const isVideo = isVideoType(spec.type);
  // (Phase-4 review-fix) null = স্পষ্ট "মান মুছে ফেলো" সংকেত — JSON.stringify-এ
  // undefined-কী বাদ পড়ে যায়, ফলে আগের ডিসিলেক্ট-এডিট নীরবে হারিয়ে যেত
  // (সংরক্ষিত songArtifactId টিকে থাকত)। null ওয়্যারে বর্তমান থাকে এবং
  // সার্ভারের confirm/revise-মার্জ ওটিকে কী-মুছুনি হিসেবেই দেখে।
  type SpecPatch = Partial<Omit<CreativeJobSpec, 'songArtifactId' | 'sound'>> & {
    songArtifactId?: string | null;
    sound?: CreativeJobSpec['sound'] | null;
  };
  const patch = (p: SpecPatch) => onChange({ ...spec, ...p } as CreativeJobSpec);

  const showsLanguage = isVideo || spec.type === 'audio';
  const showsVideoEngine = isVideo;
  const showsFilmMode = spec.type === 'short_film';
  const showsMood =
    spec.type === 'music_video' ||
    (spec.type === 'audio' && spec.audioOperation === 'instrumental');

  // --- কম-ব্যবহৃত ফিল্ডের দৃশ্যমানতা (উন্নত সেকশনে) ---
  const showsResolution = isVideo;
  const showsTempo =
    spec.type === 'music_video' ||
    (spec.type === 'audio' && spec.audioOperation === 'instrumental');
  const showsGenre = spec.type === 'music_video' || spec.type === 'audio';
  const showsStyle = isVideo || spec.type === 'image';

  // দৈর্ঘ্যের অপশন — বর্তমান মান তালিকায় না থাকলেও দেখাও (রিসেট/পুরোনো স্পেকের জন্য)
  const durationBase = DURATION_OPTIONS[spec.type] ?? [];
  const durationOptions =
    spec.durationSec !== undefined && !durationBase.includes(spec.durationSec)
      ? [...durationBase, spec.durationSec].sort((a, b) => a - b)
      : durationBase;

  // টেম্পো-অপশন — একইভাবে পুরোনো/অ-তালিকা মানও দেখাও
  const tempoOptions =
    spec.tempoBpm !== undefined && !TEMPO_OPTIONS.includes(spec.tempoBpm)
      ? [...TEMPO_OPTIONS, spec.tempoBpm].sort((a, b) => a - b)
      : TEMPO_OPTIONS;

  // স্টাইল — প্রিসেট-বহির্ভূত বর্তমান মান (যেমন LLM-সেট) ড্রপডাউনেই দেখাও
  const currentStyle = (spec.style ?? '').trim();
  const styleIsPreset = STYLE_PRESETS.some(p => p.value === currentStyle);
  const showStyleInput = customStyleMode || (currentStyle !== '' && !styleIsPreset);

  // ভাঁজ-করা সেকশনে কয়টি ফিল্ড অ-ডিফল্ট মানে নির্ধারিত —
  // ট্রিগারে ব্যাজ, যাতে লুকানো সেটিংস অনাবিষ্কৃত না থাকে
  const advancedSetCount = [
    isVideo && spec.fps != null,
    showsResolution && spec.resolution != null,
    showsTempo && spec.tempoBpm != null,
    showsGenre && (spec.genre ?? '').trim() !== '',
    showsStyle && currentStyle !== '',
    spec.type === 'image' && spec.format != null,
    spec.type === 'image' && (spec.overlayText ?? '').trim() !== '',
    spec.type === 'short_film' && spec.subtitles === false,
  ].filter(Boolean).length;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="col-span-2 space-y-1.5 sm:col-span-1">
        <Label className="text-xs text-muted-foreground">মান</Label>
        <Select value={spec.quality} onValueChange={v => patch({ quality: v as CreativeJobSpec['quality'] })}>
          <SelectTrigger className="h-9 bg-background text-sm" aria-label="মান">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">ড্রাফট — দ্রুত প্রিভিউ</SelectItem>
            <SelectItem value="standard">স্ট্যান্ডার্ড</SelectItem>
            <SelectItem value="high">উচ্চ — ধীর</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {showsLanguage && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">ভাষা</Label>
          <Select
            value={spec.language ?? 'bn'}
            onValueChange={v => patch({ language: v as SpeechLanguage })}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="ভাষা">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bn">বাংলা</SelectItem>
              <SelectItem value="en">ইংরেজি</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {showsVideoEngine && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">ভিডিও-ইঞ্জিন</Label>
          <Select
            value={spec.videoEngine ?? 'ai_diffusion'}
            onValueChange={v => patch({ videoEngine: v as VideoEngine })}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="ভিডিও-ইঞ্জিন">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ai_diffusion">{VIDEO_ENGINE_LABELS.ai_diffusion}</SelectItem>
              <SelectItem value="cinematic_motion">{VIDEO_ENGINE_LABELS.cinematic_motion}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {showsFilmMode && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">ফিল্ম-মোড</Label>
          <Select
            value={spec.filmMode ?? 'short_film'}
            onValueChange={v => patch({ filmMode: v as FilmMode })}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="ফিল্ম-মোড">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short_film">শর্টফিল্ম</SelectItem>
              <SelectItem value="dialogue_scene">সংলাপ-দৃশ্য</SelectItem>
              <SelectItem value="trailer">ট্রেইলার</SelectItem>
              <SelectItem value="story">গল্প</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Phase-4 C (C1): মিউজিক ভিডিওর গান-উৎস নির্বাচন — আপলোড-করা গান
          (কথোপকথনের অডিও) বা প্রসিডিউরাল ইনস্ট্রুমেন্টাল (সৎ-নোটসহ)।
          (Radix-চুক্তি: SelectItem-এর value কখনো খালি-স্ট্রিং নয় —
          "কোনো গান নয়" অবস্থার জন্য সেন্টিনেল মান) */}
      {spec.type === 'music_video' && (
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs text-muted-foreground">গানের উৎস</Label>
          <Select
            value={spec.songArtifactId ?? '__no_song__'}
            onValueChange={v =>
              patch(
                v === '__no_song__'
                  ? // (review-fix) null-সংকেত: ডিসিলেক্ট সংরক্ষিত গান-আইডি মুছে দেয় —
                    // undefined হলে JSON-এ কী-ই যেত না, সার্ভার-মার্জ পুরোনো
                    // গানটিই ফিরিয়ে আনত (এডিট নীরবে অগ্রাহ্য হত)।
                    { songArtifactId: null, musicSource: 'procedural', sound: null }
                  : { songArtifactId: v, musicSource: 'uploaded_song', sound: 'uploaded_song' }
              )
            }
            onOpenChange={open => {
              // (A2-F02) খোলার মুহূর্তে স্কিমা সদ্যি — নতুন আপলোড করা গান
              // ড্রপডাউন খোলা অবস্থাতেই তালিকায় এসে যায়
              if (open) onSongsMenuOpen?.();
            }}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="গানের উৎস">
              <SelectValue placeholder="প্রসিডিউরাল ইনস্ট্রুমেন্টাল" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__no_song__">প্রসিডিউরাল ইনস্ট্রুমেন্টাল (পরীক্ষামূলক, গাওয়া নয়)</SelectItem>
              {(songs ?? []).map(s => (
                <SelectItem key={s.id} value={s.id}>
                  🎵 {s.fileName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] leading-snug text-muted-foreground">
            {(songs ?? []).length === 0
              ? // (A2-F02) এখন হিন্টটি সত্য: নির্বাচক আবার খুললেই সদ্য-তালিকা
                // আসে (আগে ক্যাশ কখনো বাতিল হত না — পুরো পৃষ্ঠা-রিফ্রেশ লাগত)
                'এই কথোপকথনে আপলোড করা গান নেই — চাইলে চ্যাটে গানের অডিও আপলোড করে এই নির্বাচকটি বন্ধ করে আবার খুলুন'
              : 'আপলোড করা গানটিই ভিডিওর সাথে সমলয় হবে — নতুন গান আপলোড করলে নির্বাচকটি আবার খুলুন'}
          </p>
          {errFor('songArtifactId') && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">{errFor('songArtifactId')}</p>
          )}
        </div>
      )}

      {showsMood && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">মুড</Label>
          <Select
            value={spec.mood && MOOD_LABELS[spec.mood as MusicMood] ? (spec.mood as MusicMood) : ''}
            onValueChange={v => patch({ mood: v as MusicMood })}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="মুড">
              <SelectValue placeholder="স্বয়ংক্রিয়" />
            </SelectTrigger>
            <SelectContent>
              {MOOD_OPTIONS.map(m => (
                <SelectItem key={m} value={m}>{MOOD_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {(isVideo || spec.type === 'image') && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">অনুপাত</Label>
          <Select value={spec.aspect ?? '16:9'} onValueChange={v => patch({ aspect: v as CreativeJobSpec['aspect'] })}>
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="অনুপাত">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="9:16">৯:১৬ — ভার্টিকাল</SelectItem>
              <SelectItem value="16:9">১৬:৯ — ল্যান্ডস্কেপ</SelectItem>
              <SelectItem value="1:1">১:১ — স্কয়ার</SelectItem>
              <SelectItem value="4:5">৪:৫ — পোর্ট্রেট</SelectItem>
              <SelectItem value="3:2">৩:২</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isVideo && (
        <div className="col-span-2 space-y-1.5 sm:col-span-1">
          <Label className="text-xs text-muted-foreground">দৈর্ঘ্য</Label>
          <Select
            value={spec.durationSec !== undefined ? String(spec.durationSec) : ''}
            onValueChange={v => patch({ durationSec: Number(v) })}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="দৈর্ঘ্য">
              <SelectValue placeholder="স্বয়ংক্রিয়" />
            </SelectTrigger>
            <SelectContent>
              {durationOptions.map(sec => (
                <SelectItem key={sec} value={String(sec)}>
                  {toBnDigits(sec)} সেকেন্ড
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {spec.type === 'audio' && (
        <div className="col-span-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">কণ্ঠ</Label>
          <Select
            value={spec.voice ?? (spec.language === 'en' ? 'en-US-AriaNeural' : 'bn-BD-NabanitaNeural')}
            onValueChange={v => patch({ voice: v as CreativeJobSpec['voice'] })}
          >
            <SelectTrigger className="h-9 bg-background text-sm" aria-label="কণ্ঠ">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['বাংলা নিউরাল (সুপারিশকৃত)', 'ইংরেজি নিউরাল', 'z-ai (ফলব্যাক)'].map(group => (
                <div key={group}>
                  <div className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{group}</div>
                  {VOICE_OPTIONS.filter(v => v.group === group).map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.label}</SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* (অডিট §D) ⚙ উন্নত সেটিংস — কম-ব্যবহৃত নিয়ন্ত্রণ ভাঁজ-করা; ভিতরে
          কোনো ফিল্ড নির্ধারিত থাকলে ট্রিগারে ব্যাজে সংখ্যা দেখায় */}
      <Collapsible
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        className="col-span-2 sm:col-span-3"
      >
        <CollapsibleTrigger
          className={cn(
            'flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors',
            'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
          )}
          aria-label={`উন্নত সেটিংস ${advancedOpen ? 'লুকান' : 'দেখান'}`}
        >
          <Settings2 className="size-3.5 shrink-0" aria-hidden="true" />
          উন্নত সেটিংস
          {advancedSetCount > 0 && (
            <Badge
              variant="secondary"
              className="h-auto border-emerald-600/30 bg-emerald-600/10 px-1.5 py-0 text-[10px] leading-snug text-emerald-700 dark:text-emerald-400"
            >
              {toBnDigits(advancedSetCount)}টি নির্ধারিত
            </Badge>
          )}
          <ChevronDown
            className={cn(
              'ml-auto size-3.5 shrink-0 transition-transform duration-200',
              advancedOpen && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-3">
            {isVideo && (
              <div className="col-span-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">ফ্রেম-রেট</Label>
                <Select value={String(spec.fps ?? 30)} onValueChange={v => patch({ fps: Number(v) as 24 | 25 | 30 })}>
                  <SelectTrigger className="h-9 bg-background text-sm" aria-label="ফ্রেম-রেট">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">২৪ — সিনেম্যাটিক</SelectItem>
                    <SelectItem value="25">২৫</SelectItem>
                    <SelectItem value="30">৩০ — সোশ্যাল</SelectItem>
                    {/* Phase-4 D: সৎ-নিষ্ক্রিয় অপশন — কারণসহ দৃশ্যমান,
                        নীরব প্রতিশ্রুতি নয় (৬০FPS পাইপলাইনে নেই) */}
                    <SelectItem value="60" disabled title="৬০FPS পাইপলাইনে নেই — রেন্ডার ২৪/২৫/৩০-তেই হয়">
                      ৬০ — অসমর্থিত
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {showsResolution && (
              <div className="col-span-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">রেজোলিউশন</Label>
                <Select
                  value={spec.resolution ?? ''}
                  onValueChange={v => patch({ resolution: v as CreativeJobSpec['resolution'] })}
                >
                  <SelectTrigger className="h-9 bg-background text-sm" aria-label="রেজোলিউশন">
                    <SelectValue placeholder="স্বয়ংক্রিয়" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720p">720p (দ্রুত)</SelectItem>
                    <SelectItem value="1080p">1080p (উচ্চ মান)</SelectItem>
                    {/* Phase-4 D: সৎ-নিষ্ক্রিয় ৪K — কারণসহ */}
                    <SelectItem value="4k" disabled title="৪K এই পাইপলাইনে নেই — সর্বোচ্চ ১০৮০p">
                      ৪K — অসমর্থিত
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  না বাছলে মান অনুযায়ী স্বয়ংক্রিয় (draft→720p, নইলে 1080p)
                </p>
              </div>
            )}

            {showsTempo && (
              <div className="col-span-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">টেম্পো (BPM)</Label>
                <Select
                  value={spec.tempoBpm !== undefined ? String(spec.tempoBpm) : ''}
                  onValueChange={v => patch({ tempoBpm: Number(v) })}
                >
                  <SelectTrigger className="h-9 bg-background text-sm" aria-label="টেম্পো (BPM)">
                    <SelectValue placeholder="মুড অনুযায়ী" />
                  </SelectTrigger>
                  <SelectContent>
                    {tempoOptions.map(bpm => (
                      <SelectItem key={bpm} value={String(bpm)}>
                        {toBnDigits(bpm)} BPM
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  মিনিটে বিট (BPM) — না বাছলে মুড অনুযায়ী
                </p>
              </div>
            )}

            {showsGenre && (
              <div className="col-span-1 space-y-1.5">
                <Label htmlFor="spec-genre" className="text-xs text-muted-foreground">
                  জনরা (ধরন)
                </Label>
                <Input
                  id="spec-genre"
                  value={spec.genre ?? ''}
                  onChange={e => patch({ genre: e.target.value })}
                  maxLength={60}
                  placeholder="যেমন: modern, folk, cinematic"
                  className="h-9 bg-background text-sm"
                />
              </div>
            )}

            {showsStyle && (
              <div className="col-span-2 space-y-1.5 sm:col-span-1">
                <Label className="text-xs text-muted-foreground">স্টাইল</Label>
                <Select
                  value={currentStyle !== '' ? currentStyle : customStyleMode ? '__custom__' : ''}
                  onValueChange={v => {
                    if (v === '__custom__') {
                      setCustomStyleMode(true);
                      return;
                    }
                    setCustomStyleMode(false);
                    patch({ style: v });
                  }}
                >
                  <SelectTrigger className="h-9 bg-background text-sm" aria-label="স্টাইল">
                    <SelectValue placeholder="স্বয়ংক্রিয়" />
                  </SelectTrigger>
                  <SelectContent>
                    {STYLE_PRESETS.map(p => (
                      <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                    ))}
                    {currentStyle !== '' && !styleIsPreset && (
                      <SelectItem value={currentStyle}>{currentStyle}</SelectItem>
                    )}
                    <SelectItem value="__custom__">কাস্টম</SelectItem>
                  </SelectContent>
                </Select>
                {showStyleInput && (
                  <Input
                    value={spec.style ?? ''}
                    onChange={e =>
                      patch({ style: e.target.value.trim() === '' ? undefined : e.target.value })
                    }
                    maxLength={60}
                    placeholder="নিজের স্টাইল লিখুন"
                    className="h-9 bg-background text-sm"
                    aria-label="স্টাইল (কাস্টম)"
                  />
                )}
              </div>
            )}

            {spec.type === 'image' && spec.format !== undefined && (
              <div className="col-span-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">ফরম্যাট</Label>
                <Select value={spec.format} onValueChange={v => patch({ format: v as CreativeJobSpec['format'] })}>
                  <SelectTrigger className="h-9 bg-background text-sm" aria-label="ফরম্যাট">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="jpeg">JPEG</SelectItem>
                    <SelectItem value="webp">WebP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {spec.type === 'short_film' && (
              <div className="col-span-2 flex min-h-14 items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2 sm:col-span-1">
                <Label htmlFor="spec-subtitles" className="text-xs leading-snug text-muted-foreground">
                  সাবটাইটেল বার্ন-ইন
                </Label>
                <Switch
                  id="spec-subtitles"
                  checked={spec.subtitles ?? true}
                  onCheckedChange={checked => patch({ subtitles: checked })}
                  className="data-[state=checked]:bg-emerald-600"
                />
              </div>
            )}

            {spec.type === 'image' && spec.overlayText !== undefined && (
              <div className="col-span-2 space-y-1.5 sm:col-span-3">
                <Label className="text-xs text-muted-foreground">লেখা (টাইপোগ্রাফি)</Label>
                <Textarea
                  value={spec.overlayText ?? ''}
                  onChange={e => patch({ overlayText: e.target.value })}
                  rows={2}
                  className="bg-background text-sm"
                  aria-label="লেখা"
                />
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Phase-4 C: ক্ষেত্র-স্তরের যাচাই-ত্রুটির সারাংশ — স্কিমা-সচেতন
          (নিষ্ক্রিয় অপশন/সীমা-লঙ্ঘন/অজানা মান); চূড়ান্ত রায় confirm-এ সার্ভার */}
      {(fieldErrors?.length ?? 0) > 0 && (
        <div
          className="col-span-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 sm:col-span-3"
          role="alert"
        >
          <p className="text-xs font-medium text-red-600 dark:text-red-400">সেটিংস যাচাই — সংশোধন দরকার:</p>
          <ul className="mt-1 space-y-0.5">
            {fieldErrors!.map(e => (
              <li key={e.key} className="text-xs leading-snug text-red-600/90 dark:text-red-400/90">
                • {e.messageBn}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// ধাপ-তালিকা
// ------------------------------------------------------------

function StepList({ view }: { view: ProductionView }) {
  return (
    <ol className="space-y-1.5" aria-label="প্রোডাকশন ধাপ">
      {view.steps.map(step => (
        <li key={step.id} className="flex items-start gap-2.5 text-sm">
          <span className="mt-0.5 shrink-0" aria-hidden="true">
            {step.status === 'done' ? (
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
            ) : step.status === 'running' ? (
              <span className="flex animate-pulse items-center justify-center">
                <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
              </span>
            ) : step.status === 'failed' ? (
              <XCircle className="size-4 text-red-500" />
            ) : step.status === 'skipped' ? (
              <Ban className="size-4 text-muted-foreground" />
            ) : (
              <CircleDashed className="size-4 text-muted-foreground/60" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className={cn('block leading-tight', step.status === 'pending' && 'text-muted-foreground/70')}>
              {step.title}
            </span>
            {step.detail && <span className="block text-xs text-muted-foreground">{step.detail}</span>}
            {step.error && <span className="block text-xs text-red-500">{step.error}</span>}
          </span>
          {(step.status === 'done' || step.status === 'failed') && step.durationMs != null && step.durationMs > 0 && (
            <span
              className={cn(
                'mt-0.5 shrink-0 text-[11px] tabular-nums text-muted-foreground/80',
                step.status === 'failed' && 'text-red-600/80 dark:text-red-400/80',
              )}
            >
              {toBnDigits((step.durationMs / 1000).toFixed(1))} সেকেন্ড
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ------------------------------------------------------------
// Phase-4 E: পরিকল্পনা-প্রিভিউ (নিশ্চিতকরণের আগে) — কাঠামোগত পরিকল্পনা:
// কী তৈরি হবে, কর্মপথ-ধাপ, আনুমানিক শট, অডিও-কৌশল, আউটপুট সেটিংস,
// পরিচিত সীমা ও সময়-অনুমান (স্পষ্টভাবে "ঐতিহাসিক" লেবেলসহ)।
// পরিকল্পনা-প্রদর্শন ≠ উৎপাদন: এখানে কোনো প্রজন্মই শুরু হয় না।
// ------------------------------------------------------------

function PlanPreview({
  spec,
  songs,
  schema,
}: {
  spec: CreativeJobSpec;
  songs?: ConfigPanelSongOption[];
  schema: ConfigPanelSchema | null;
}) {
  const [open, setOpen] = useState(false);
  const isVideo = isVideoType(spec.type);
  const steps = schema?.plannedSteps ?? [];
  const shots = schema?.estimatedShots;
  const limitations = schema?.limitations ?? [];

  const songName =
    spec.type === 'music_video' && spec.songArtifactId
      ? (songs ?? []).find(s => s.id === spec.songArtifactId)?.fileName ?? 'আপলোড করা গান'
      : null;
  const audioStrategy =
    spec.type === 'music_video'
      ? songName
        ? `আপনার গান (${songName}) — বিট-মার্কারে ভিজ্যুয়াল সমলয়`
        : 'প্রসিডিউরাল ইনস্ট্রুমেন্টাল স্কোর (নিউরাল মিউজিক-মডেল নয় — সৎ-লেবেল)'
      : spec.type === 'short_film'
        ? `সংলাপ-কণ্ঠ (${spec.language === 'en' ? 'ইংরেজি' : 'বাংলা'})${spec.subtitles !== false ? ' + বার্ন-ইন সাবটাইটেল' : ''} + সাউন্ড-ডিজাইন`
        : spec.type === 'audio'
          ? spec.audioOperation === 'instrumental'
            ? 'প্রসিডিউরাল ইনস্ট্রুমেন্টাল সংশ্লেষণ (পরীক্ষামূলক)'
            : 'ভাষা-নিয়ন্ত্রক TTS + ASR ব্যাক-চেক'
          : spec.sound === 'none'
            ? 'নীরব ভিডিও'
            : 'পরিবেশ-শব্দ/ভয়েসওভার';

  const outputBits: string[] = [];
  if (spec.aspect) outputBits.push(`অনুপাত ${spec.aspect}`);
  if (spec.resolution) outputBits.push(spec.resolution);
  else if (isVideo) outputBits.push(spec.quality === 'draft' ? '৭২০p (draft)' : '১০৮০p');
  if (spec.fps) outputBits.push(`${spec.fps}fps`);
  if (spec.format) outputBits.push(spec.format.toUpperCase());

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors',
          'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
        )}
        aria-label={`পরিকল্পনা-প্রিভিউ ${open ? 'লুকান' : 'দেখান'}`}
      >
        <PencilRuler className="size-3.5 shrink-0" aria-hidden="true" />
        📋 পরিকল্পনা-প্রিভিউ — কী কী ধাপে তৈরি হবে
        <ChevronDown
          className={cn('ml-auto size-3.5 shrink-0 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2.5 rounded-lg border bg-muted/20 px-3 py-3 text-xs leading-relaxed">
          <p>
            <span className="font-medium">কী তৈরি হবে:</span> {whatWillBeMade(spec)}
          </p>
          {steps.length > 0 && (
            <div>
              <p className="font-medium">কর্মপথ (নিশ্চিত করলে এই ধাপগুলোই চলবে):</p>
              <ol className="mt-1 space-y-0.5 pl-4">
                {steps.map((s, i) => (
                  <li key={s.key} className="list-decimal text-muted-foreground">
                    <span className="text-foreground/90">{s.title}</span>
                    {i === steps.length - 1 ? ' — এখানেই শেষ' : ''}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {isVideo && shots && shots.engine && (
            <p>
              <span className="font-medium">আনুমানিক শট-সংখ্যা:</span> {toBnDigits(shots.min)}–{toBnDigits(shots.max)} টি
              {shots.engine === 'ai_diffusion'
                ? ' — প্রতিটি CogVideoX-3 ডিফিউশনে (প্রতি শটে ~২–৪ মিনিট)'
                : ' — স্টোরিবোর্ড+ক্যামেরা-মোশন ইঞ্জিনে (দ্রুত)'}
            </p>
          )}
          <p>
            <span className="font-medium">অডিও-কৌশল:</span> {audioStrategy}
          </p>
          {outputBits.length > 0 && (
            <p>
              <span className="font-medium">আউটপুট সেটিংস:</span> {outputBits.join(' · ')}
            </p>
          )}
          {limitations.length > 0 && (
            <div>
              <p className="font-medium">পরিচিত সীমা (সৎ-ঘোষণা):</p>
              <ul className="mt-1 space-y-0.5 pl-4">
                {limitations.map(l => (
                  <li key={l} className="list-disc text-muted-foreground">{l}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground">
            <span className="font-medium">সময়-অনুমান:</span> {honestEtaText(spec)}{' '}
            <span className="text-muted-foreground/80">(ঐতিহাসিক অনুমান — প্রকৃত সময় ভিন্ন হতে পারে)</span>
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Phase-5 §5: মুভমেন্ট-ডেলিভারির সৎ ব্যাজ (লোকাল-মোশন/প্রম্পট-নির্দেশিত/সৎ-বিকল্পে নামানো)।
 *  P5-5b কপি-ঐক্য: downgraded_to_local-এর জন্য কার্ডজুড়ে একটিই ক্যানোনিক্যাল
 *  বাক্য "সৎ-বিকল্পে নামানো" (গণনা-সারি ও ফলাফল-সারির সঙ্গে অভিন্ন) —
 *  "সৎ" শব্দটি বাক্যের ভেতরেই থাকায় আলাদা "(সৎ)" সাফিক্সের দরকার নেই। */
const DELIVERY_BADGE_LABELS_BN: Record<MovementDelivery, string> = {
  ...MOVEMENT_DELIVERY_LABELS_BN,
  downgraded_to_local: 'সৎ-বিকল্পে নামানো',
};

function DeliveryBadge({ delivery }: { delivery: MovementDelivery }) {
  const cls: Record<MovementDelivery, string> = {
    local_motion: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
    prompt_guided: 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300',
    downgraded_to_local: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  };
  return (
    <Badge
      variant="outline"
      className={cn('h-auto shrink-0 px-1.5 py-0.5 text-[10px] leading-snug', cls[delivery])}
      title={DELIVERY_BADGE_LABELS_BN[delivery]}
    >
      {DELIVERY_BADGE_LABELS_BN[delivery]}
    </Badge>
  );
}

const THIN_SCROLL =
  'pr-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent';

/** সৎ-সমন্বয়ের তালিকা একবারে যতটি দেখানো হয় — বেশি হলে সৎ কাটা-লেবেল বসে (P5-5b) */
const VISIBLE_ADJUSTMENTS = 8;

// ------------------------------------------------------------
// Phase-5 §7: শট-পরিকল্পনা-প্রিভিউ — নিশ্চিতকরণের আগে সার্ভারে
// নির্ধারকভাবে বানানো পরিকল্পনা (শূন্য-ব্যয় — কোনো প্রজন্ম নয়)।
// মিউজিক-ভিডিওতে প্রতি-শট সাইজ/মুভমেন্ট সম্পাদনাযোগ্য — সম্পাদনা
// spec.cinematicOverrides হয়ে যায়, সার্ভারে পুনঃপরিকল্পনা + পুনঃযাচাই
// হয় (confirm §15-এর একই পথ)। শর্টফিল্মে কাঠামোগত কঙ্কাল — রিভিউ-কেবল।
// ------------------------------------------------------------

function ShotPlanPreview({
  spec,
  conversationId,
  onChange,
}: {
  spec: CreativeJobSpec;
  conversationId?: string;
  onChange: (next: CreativeJobSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  const { shotPlan, loadingPlan } = useShotPlanPreview(spec, conversationId);
  const isMv = spec.type === 'music_video';

  if (!loadingPlan && !shotPlan) return null;

  /** প্রতি-শট সম্পাদনা → spec.cinematicOverrides (সার্ভারেই পুনঃযাচাই) */
  const applyShotEdit = (index: number, patch: { size?: ShotSize; movement?: PlanMovement }) => {
    const shot = shotPlan?.plan.shots[index];
    if (!shot) return;
    const others = (spec.cinematicOverrides?.shots ?? []).filter(o => o.index !== index);
    const entry: { index: number; size?: ShotSize; movement?: PlanMovement } = {
      index,
      // প্রিভিউ-পরিকল্পনার বর্তমান মানই ভিত্তি; নতুন নির্বাচন তার উপরে বসে
      size: patch.size ?? shot.size,
      movement: patch.movement ?? shot.movement,
    };
    const shots = [...others, entry].sort((a, b) => a.index - b.index);
    onChange({ ...spec, cinematicOverrides: { shots } });
  };

  const dc = shotPlan?.summary.deliveryCounts;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border bg-background px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors',
          'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
        )}
        aria-label={`শট-পরিকল্পনা ${open ? 'লুকান' : 'দেখান'}`}
      >
        <Clapperboard className="size-3.5 shrink-0" aria-hidden="true" />
        🎬 শট-পরিকল্পনা — {isMv ? 'ক্যামেরা-নির্দেশনাসহ (সম্পাদনাযোগ্য)' : 'কাঠামো (রিভিউ-কেবল)'}
        <ChevronDown
          className={cn('ml-auto size-3.5 shrink-0 transition-transform duration-200', open && 'rotate-180')}
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2.5 rounded-lg border bg-muted/20 px-3 py-3 text-xs leading-relaxed">
          {loadingPlan && !shotPlan ? (
            <p className="flex items-center gap-1.5 text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> শট-পরিকল্পনা হিসাব হচ্ছে (নির্ধারক, ব্যয়-মুক্ত)…
            </p>
          ) : shotPlan ? (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="text-[11px] font-normal">
                  {toBnDigits(shotPlan.summary.shotCount)}টি শট
                </Badge>
                <Badge variant="secondary" className="text-[11px] font-normal">
                  মোট ≈{toBnDigits(Math.round(shotPlan.summary.totalPlannedSec))} সে.
                </Badge>
                <Badge variant="outline" className="text-[11px] font-normal">
                  কাট-উৎস: {shotPlan.beatSourceLabel}
                </Badge>
              </div>
              {dc && (
                <p className="text-muted-foreground">
                  <span className="font-medium">ক্যামেরা-ডেলিভারি:</span> {toBnDigits(dc.local_motion ?? 0)}টি লোকাল
                  ক্যামেরা-মোশন (নিশ্চিত) · {toBnDigits(dc.prompt_guided ?? 0)}টি প্রম্পট-নির্দেশিত ·{' '}
                  {toBnDigits(dc.downgraded_to_local ?? 0)}টি সৎ-বিকল্পে নামানো
                </p>
              )}
              {shotPlan.analysisLabel && (
                <p className="text-muted-foreground">অডিও-বিশ্লেষণ: {shotPlan.analysisLabel}</p>
              )}
              {shotPlan.narrativeReview && shotPlan.narrativeReview.warnings.length > 0 && (
                <div
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2"
                  role="alert"
                  aria-label="ন্যারেটিভ-পর্যালোচনা সতর্কতা"
                >
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    ⚠ ন্যারেটিভ-পর্যালোচনা: {toBnDigits(shotPlan.narrativeReview.warnings.length)}টি সতর্কতা (ক্রম/
                    ধারাবাহিকতার সম্পর্ক-যাচাই)
                  </p>
                  <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto pl-4 text-muted-foreground">
                    {shotPlan.narrativeReview.warnings.map((w, i) => (
                      <li key={`${w.code}-${i}`} className="list-disc">
                        <span className="font-mono text-[10px] text-muted-foreground/80">{w.shotId ?? ''}</span>{' '}
                        {w.messageBn}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-[11px] text-muted-foreground">{shotPlan.narrativeReview.scopeNoteBn}</p>
                </div>
              )}
              <div>
                <p className="font-medium">শট-তালিকা (ক্রমে):</p>
                <ul className={cn('mt-1 max-h-72 space-y-1.5 overflow-y-auto', THIN_SCROLL)} aria-label="শট-তালিকা">
                  {shotPlan.plan.shots.map((s, i) => (
                    <li key={s.shotId} className="rounded-md border bg-background/60 px-2.5 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{s.shotId}</span>
                        {/* P5-5b: হেডার বর্তমান শট-অবস্থা (size) থেকেই গৃহীত —
                            ফ্রেমিং-ওভাররাইডের পরেও সদ্য-মান দেখায়; labelBn
                            পরিকল্পক-লেখা ও ওভাররাইড-পূর্ববর্তী। শর্টফিল্মে
                            labelBn-এ দৃশ্য-উদ্দেশ্য থাকে — সহায়ক প্রসঙ্গ হিসেবে
                            মৃদু রঙে রয়ে যায় (নন-হেডার ব্যবহার)। */}
                        <span className="min-w-0 flex-1 truncate">
                          শট {toBnDigits(s.order + 1)} — {SHOT_SIZE_LABELS_BN[s.size]}
                          {!isMv && <span className="text-muted-foreground"> · {s.labelBn}</span>}
                        </span>
                        <DeliveryBadge delivery={s.delivery} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span>{SHOT_SIZE_LABELS_BN[s.size]}</span>
                        <span aria-hidden="true">·</span>
                        <span>{PLAN_MOVEMENT_LABELS_BN[s.movement]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{toBnDigits(s.targetDurationSec.toFixed(1))} সে.</span>
                        {s.startSec != null && s.endSec != null && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="tabular-nums">
                              কাট {toBnDigits(s.startSec.toFixed(1))}–{toBnDigits(s.endSec.toFixed(1))} সে.
                            </span>
                          </>
                        )}
                      </div>
                      {isMv && (
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          <div>
                            <label className="sr-only" htmlFor={`shot-size-${s.shotId}`}>
                              {s.shotId} ফ্রেমিং বদলান
                            </label>
                            <Select value={s.size} onValueChange={v => applyShotEdit(i, { size: v as ShotSize })}>
                              <SelectTrigger
                                id={`shot-size-${s.shotId}`}
                                className="h-8 bg-background text-[11px]"
                                aria-label={`${s.shotId} ফ্রেমিং`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {SHOT_SIZES.map(sz => (
                                  <SelectItem key={sz} value={sz} className="text-xs">
                                    {SHOT_SIZE_LABELS_BN[sz]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="sr-only" htmlFor={`shot-move-${s.shotId}`}>
                              {s.shotId} ক্যামেরা-মুভমেন্ট বদলান
                            </label>
                            <Select
                              value={s.movement}
                              onValueChange={v => applyShotEdit(i, { movement: v as PlanMovement })}
                            >
                              <SelectTrigger
                                id={`shot-move-${s.shotId}`}
                                className="h-8 bg-background text-[11px]"
                                aria-label={`${s.shotId} ক্যামেরা-মুভমেন্ট`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PLAN_MOVEMENTS.map(mv => (
                                  <SelectItem key={mv} value={mv} className="text-xs">
                                    {PLAN_MOVEMENT_LABELS_BN[mv]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
              {shotPlan.plan.adjustments.length > 0 && (
                <div>
                  <p className="font-medium">
                    সৎ-সমন্বয় ({toBnDigits(shotPlan.plan.adjustments.length)}টি — সৎ-বিকল্পে নামানো/আপনার সম্পাদনা):
                  </p>
                  <ul className={cn('mt-1 max-h-24 space-y-0.5 overflow-y-auto pl-4', THIN_SCROLL)}>
                    {shotPlan.plan.adjustments.slice(0, VISIBLE_ADJUSTMENTS).map((a, i) => (
                      <li key={`${a.field}-${i}`} className="list-disc text-muted-foreground">
                        {a.field}: {a.from} → {a.to} ({a.reason})
                      </li>
                    ))}
                  </ul>
                  {/* P5-5b: কাটা তালিকা সৎভাবে লেবেল-করা — মোট সংখ্যা শিরোনামেই আছে */}
                  {shotPlan.plan.adjustments.length > VISIBLE_ADJUSTMENTS && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      … প্রথম {toBnDigits(VISIBLE_ADJUSTMENTS)}টি দেখানো হচ্ছে
                    </p>
                  )}
                </div>
              )}
              <div>
                <p className="font-medium">পরিচিত সীমা (সৎ-ঘোষণা):</p>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {shotPlan.summary.limitations.map(l => (
                    <li key={l} className="list-disc text-muted-foreground">
                      {l}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-muted-foreground">
                {isMv
                  ? 'সম্পাদনা করলে পরিকল্পনা সার্ভারে পুনঃহিসাব ও পুনঃযাচাই হয় — এখানে কোনো প্রজন্ম শুরু হয় না; “✓ চালু করুন” চাপলেই চূড়ান্ত।'
                  : 'চূড়ান্ত দৃশ্য ও শট-তালিকা জেনারেশন-সময়ে চিত্রনাট্য থেকে তৈরি হবে — এটি কাঠামোগত প্রিভিউ, তাই প্রতি-শট সম্পাদনা নেই।'}
              </p>
            </>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Phase-4 D: লাইভ যাচাই-ফলাফলের কমপ্যাক্ট ব্লক (verdict + সমন্বয়/নোট/ত্রুটি) */
function ValidationLiveBlock({ live, validating }: { live: SpecValidationLive | null; validating: boolean }) {
  if (!live && !validating) return null;
  const meta: Record<SpecValidationLive['verdict'], { label: string; cls: string }> = {
    supported: { label: '✓ সমর্থিত', cls: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' },
    supported_with_limitations: { label: '⚠ সীমাসহ সমর্থিত', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
    unsupported: { label: '✕ অসমর্থিত', cls: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400' },
    requires_clarification: { label: '? স্পষ্টীকরণ প্রয়োজন', cls: 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300' },
    temporarily_unavailable: { label: '⏳ সাময়িকভাবে ব্যস্ত প্রোভাইডার — অপেক্ষাসহ চলবে', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  };
  const m = live ? meta[live.verdict] : null;
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/20 px-3 py-2.5 text-xs" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        {validating && !live ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> সার্ভারে সেটিংস যাচাই হচ্ছে…
          </span>
        ) : m ? (
          <Badge variant="outline" className={cn('h-auto px-2 py-0.5 text-[11px] leading-snug', m.cls)}>{m.label}</Badge>
        ) : null}
        <span className="text-[11px] text-muted-foreground">সার্ভার-যাচাই (নিশ্চিত করার সময় আবার পুনঃযাচাই হয়)</span>
      </div>
      {live && live.errors.length > 0 && (
        <ul className="space-y-0.5">
          {live.errors.map((e, i) => (
            <li key={i} className="text-red-600 dark:text-red-400">• {e}</li>
          ))}
        </ul>
      )}
      {live && live.adjustments.length > 0 && (
        <div>
          <p className="font-medium text-muted-foreground">স্বয়ংক্রিয় সমন্বয় হবে:</p>
          <ul className="mt-0.5 space-y-0.5">
            {live.adjustments.map((a, i) => (
              <li key={i} className="text-amber-700 dark:text-amber-400">
                • {a.field}: {a.from} → {a.to} ({a.reason})
              </li>
            ))}
          </ul>
        </div>
      )}
      {live && live.notes.length > 0 && (
        <details className="text-muted-foreground">
          <summary className="cursor-pointer select-none">সৎ-নোট ({toBnDigits(live.notes.length)}টি)</summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {live.notes.map((n, i) => (
              <li key={i} className="list-disc">{n}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// মূল কার্ড
// ------------------------------------------------------------

export function ProductionCard({ productionId }: { productionId: string }) {
  const view = useProductions(s => s.productions[productionId]);
  const ensureFetched = useProductions(s => s.ensureFetched);
  const subscribe = useProductions(s => s.subscribe);
  const confirmProduction = useProductions(s => s.confirmProduction);
  const cancelProduction = useProductions(s => s.cancelProduction);
  const reviseProduction = useProductions(s => s.reviseProduction);

  const [editedSpec, setEditedSpec] = useState<CreativeJobSpec | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [revisionId, setRevisionId] = useState<string | null>(null);
  // Phase-4 C+D: সার্ভার-মালিকানাধীন প্যানেল-স্কিমা (ক্ষেত্র/অপশন/সীমা/নিষ্ক্রিয়-
  // কারণ — capabilities.ts থেকে আসে, ক্লায়েন্ট-হার্ডকোড নয়) + লাইভ স্পেক-যাচাই।
  // রায় কেবল প্রদর্শনের জন্য — confirm-এ সার্ভার নিজেই পুনঃযাচাই করে।
  // (হুক-ক্রম: শীঘ্র-ফেরতের আগেই সব হুক — rules-of-hooks)
  // (A2-F02) refresh: গান-নির্বাচক খোলার মুহূর্তে স্কিমা সদ্যি-করার হাতল
  const { schema, refresh: refreshPanelSchema } = useConfigPanel(
    view?.spec.type ?? 'image',
    view?.conversationId
  );
  const awaitingSpec =
    view && view.status === 'awaiting_confirmation' ? (editedSpec ?? view.spec) : null;
  const { live, validating } = useSpecValidation(awaitingSpec);
  const fieldErrors = useMemo(
    () =>
      schema && awaitingSpec
        ? validateFieldsAgainstSchema(schema, awaitingSpec as unknown as Record<string, unknown>)
        : [],
    [schema, awaitingSpec]
  );

  useEffect(() => {
    void ensureFetched(productionId);
  }, [productionId, ensureFetched]);

  useEffect(() => {
    if (view) subscribe(productionId);
  }, [view, productionId, subscribe]);

  if (!view) {
    return (
      <div className="rounded-xl border bg-card p-3 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="mr-2 inline size-4 animate-spin" aria-hidden="true" />
        প্রোডাকশন লোড হচ্ছে…
      </div>
    );
  }

  const typeMeta = TYPE_META[view.type] ?? TYPE_META.image;
  const TypeIcon = typeMeta.icon;
  const statusMeta = STATUS_META[view.status];
  const isAwaiting = view.status === 'awaiting_confirmation';
  const isActive = ['queued', 'running', 'validating', 'cancelling'].includes(view.status);
  const isDone = ['completed', 'partial'].includes(view.status);

  // resultJson-এর সারাংশ (quality report + §2-C ইঞ্জিন-তথ্য + C-F05 সৎ-নোট)
  const resultSummary = parseResultSummary(view.resultJson);

  const spec = editedSpec ?? view.spec;
  const songs = schema?.sourceOptions?.songs;
  /** লাইভ-যাচাই অসমর্থিত বললে নিশ্চিত-বাটন বন্ধ (সার্ভার-পুনঃযাচাইও ৪২২ দিত) */
  const liveBlocksConfirm = live?.verdict === 'unsupported';
  // (অডিট §A3) ব্যর্থ হলে কত সময় লেগেছিল — startedAt+finishedAt দুটোই থাকলে
  const failedElapsedText =
    view.status === 'failed' ? elapsedTextBn(view.startedAt, view.finishedAt) : '';

  const handleConfirm = async () => {
    setIsConfirming(true);
    const ok = await confirmProduction(productionId, editedSpec ? (editedSpec as unknown as Record<string, unknown>) : undefined);
    setIsConfirming(false);
    if (ok) toast({ title: 'প্রোডাকশন শুরু হয়েছে', description: view.title });
  };

  const handleRevise = async (label = 'সংশোধন-প্রস্তাব তৈরি হয়েছে') => {
    setIsRevising(true);
    const revision = await reviseProduction(productionId, (editedSpec ?? view.spec) as unknown as Record<string, unknown>);
    setIsRevising(false);
    if (revision) {
      setRevisionId(revision.id);
      toast({ title: label, description: 'নিচের নতুন কার্ডে নিশ্চিত করুন' });
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* হেডার */}
      <div className="flex items-start gap-3 border-b bg-muted/40 px-4 py-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          <TypeIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-semibold">{view.title}</p>
            <Badge variant="outline" className={cn('shrink-0 text-[11px]', statusMeta.className)}>
              {statusMeta.label}
            </Badge>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{typeMeta.label}</span>
            {/* S9: ইঞ্জিনের সৎ লেবেল — সব অবস্থাতেই কার্ডে দেখা যায় (শুধু অপেক্ষার-সময় নয়) */}
            {isVideoType(view.spec.type) && view.spec.videoEngine && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={cn(
                    view.spec.videoEngine === 'cinematic_motion' &&
                      'font-medium text-amber-700 dark:text-amber-400',
                  )}
                >
                  {view.spec.videoEngine === 'cinematic_motion'
                    ? 'ইঞ্জিন: ক্যামেরা-মোশন (AI ডিফিউশন নয়)'
                    : 'ইঞ্জিন: AI ডিফিউশন (CogVideoX-3)'}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-4 px-4 py-3.5">
        {/* §2-A: নিশ্চিতকরণের অপেক্ষা — বিশিষ্ট অ্যাম্বার ব্যানার (এটা কখনো
            অগ্রগতি/"চলছে"-র মতো দেখায় না; প্রজন্ম এখনো শুরুই হয়নি) */}
        {isAwaiting && (
          <div className="space-y-3.5">
            <div
              role="status"
              className="rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-3.5"
              aria-live="polite"
            >
              <p className="flex items-start gap-2.5 text-sm font-semibold leading-relaxed text-amber-800 dark:text-amber-300">
                <span className="mt-0.5 shrink-0 text-lg leading-none" aria-hidden="true">⏸</span>
                আপনার অনুমোদনের অপেক্ষায় — নিচের বাটনে শুরু করুন
              </p>
              <div className="mt-2.5 space-y-1 border-l-2 border-amber-500/40 pl-3 text-xs leading-relaxed text-amber-900/85 dark:text-amber-200/85">
                <p>
                  <span className="font-medium">কী তৈরি হবে:</span> {whatWillBeMade(spec)}
                </p>
                <p>
                  <span className="font-medium">সময় (ঐতিহাসিক অনুমান):</span> {honestEtaText(spec)}
                </p>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <Button
                  size="lg"
                  onClick={() => void handleConfirm()}
                  disabled={isConfirming || liveBlocksConfirm}
                  title={liveBlocksConfirm ? 'সার্ভার-যাচাই অসমর্থিত বলেছে — নিচের ত্রুটিগুলো ঠিক করুন' : undefined}
                  className="min-h-11 bg-emerald-600 px-5 text-base font-semibold text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                >
                  {isConfirming ? <Loader2 className="size-5 animate-spin" aria-hidden="true" /> : <BadgeCheck className="size-5" aria-hidden="true" />}
                  ✓ চালু করুন
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => void cancelProduction(productionId)}
                  className="min-h-11 border-red-500/30 px-4 text-base text-red-600 hover:bg-red-500/10 dark:text-red-400"
                >
                  <Ban className="size-5" aria-hidden="true" />
                  ✕ বাতিল
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {specSummaryText(spec).map(bit => (
                <Badge key={bit} variant="secondary" className="text-[11px] font-normal">
                  {bit}
                </Badge>
              ))}
            </div>
            {/* Phase-4 E: পরিকল্পনা-প্রিভিউ — কর্মপথ/শট-আনুমান/অডিও-কৌশল/সীমা।
                প্রদর্শন প্রজন্ম নয়: নিশ্চিত করার আগে কোনো ব্যয়বহুল কাজ শুরু হয় না */}
            <PlanPreview spec={spec} songs={songs} schema={schema} />
            {/* Phase-5 §7: সিনেম্যাটিক শট-পরিকল্পনা — নির্ধারক, ব্যয়-মুক্ত,
                সার্ভার-গণনাকৃত; মিউজিক-ভিডিওতে প্রতি-শট সম্পাদনা → ওভাররাইড */}
            {(spec.type === 'music_video' || spec.type === 'short_film') && (
              <ShotPlanPreview
                spec={spec}
                conversationId={view.conversationId}
                onChange={next => setEditedSpec(next)}
              />
            )}
            {/* Phase-4 D: লাইভ সার্ভার-যাচাই (ডিবাউন্সড) — verdict +
                সমন্বয়/নোট/ত্রুটি; ক্লায়েন্ট-দাবি কখনো রায় বদলায় না */}
            <ValidationLiveBlock live={live} validating={validating} />
            <SpecEditor
              spec={spec}
              onChange={next => setEditedSpec(next)}
              songs={songs}
              fieldErrors={fieldErrors}
              onSongsMenuOpen={refreshPanelSchema}
            />
            {isVideoType(spec.type) && (
              <AmberNote text={VIDEO_ENGINE_NOTES[spec.videoEngine ?? 'ai_diffusion']} />
            )}
            {spec.type === 'music_video' &&
              spec.songArtifactId === undefined &&
              spec.sound !== 'uploaded_song' && (
                <AmberNote
                  text={spec.musicSource === 'none' ? NO_SONG_NOTE : PROCEDURAL_SCORE_NOTE}
                />
              )}
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <PencilRuler className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              সেটিংস বদলে নিশ্চিত করতে পারেন — “✓ চালু করুন” চাপার আগে প্রকৃত জেনারেশন শুরু হয় না।
            </p>
          </div>
        )}

        {/* চলমান অবস্থা */}
        {isActive && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{STATUS_META[view.status].label}…</span>
                <span>{view.progress}%</span>
              </div>
              <Progress value={view.progress} className="h-1.5" aria-label="অগ্রগতি" />
            </div>
            {/* §2-B: ক্লাউড ভিডিও-প্রোভাইডারের সৎ স্ট্যাটাস (ব্যস্ত/কুলডাউন/মুক্ত) */}
            {isVideoType(view.spec.type) && view.providerStatus && (
              <ProviderStatusRow provider={view.providerStatus} />
            )}
            <StepList view={view} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void cancelProduction(productionId)}
              disabled={view.status === 'cancelling'}
              className="border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
            >
              <Ban className="size-4" aria-hidden="true" />
              {view.status === 'cancelling' ? '✕ বাতিল হচ্ছে…' : '✕ বাতিল করুন'}
            </Button>
          </div>
        )}

        {/* ফলাফল */}
        {(isDone || view.status === 'failed' || view.status === 'cancelled') && (
          <div className="space-y-3">
            {view.status === 'cancelled' && (
              <p className="flex items-start gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <Ban className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                বাতিল করা হয়েছে — কোনো চূড়ান্ত ফাইল তৈরির নিশ্চয়তা নেই। চাইলে নিচের “🔁 আবার চালান” দিয়ে নতুন প্রস্তাব তৈরি করুন।
              </p>
            )}
            {view.status === 'failed' && (view.error || failedElapsedText) && (
              <div className="space-y-1 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {view.error && (
                  <p className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    {view.error}
                  </p>
                )}
                {failedElapsedText && (
                  <p className="flex items-start gap-2">
                    <span className="mt-px shrink-0 leading-none" aria-hidden="true">⏱</span>
                    সময় লেগেছে: {failedElapsedText}
                  </p>
                )}
              </div>
            )}
            {/* §2-C: আউটপুটের সৎ ইঞ্জিন-ব্যাজ (AI ভিডিও / স্টোরিবোর্ড-ফলব্যাক /
                লোকাল প্রসিডিউরাল) — কী দিয়ে তৈরি হলো সেটাই বলে */}
            {(isDone || view.status === 'partial') && (
              <EngineBadges view={view} result={resultSummary} />
            )}
            {resultSummary?.partialNotes && resultSummary.partialNotes.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <p className="mb-1 font-medium">আংশিক — কী ব্যর্থ হয়েছে:</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {resultSummary.partialNotes.slice(0, 4).map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {resultSummary?.quality && (
              <p className="text-xs text-muted-foreground">{resultSummary.quality}</p>
            )}
            {/* (C-F05) পাইপলাইনের সৎ-স্ট্যাটাস নোট — resultJson.notes
                (যেমন MV-র "লিপ-সিঙ্ক নেই…")। প্রতিরোধমূলক: পুরনো ফলাফলে
                নোট-ক্ষেত্রই নেই — তখন এই ব্লকটি রেন্ডারই হয় না। */}
            {resultSummary?.notes && resultSummary.notes.length > 0 && (
              <ul
                className="space-y-0.5 text-xs leading-relaxed text-muted-foreground"
                aria-label="ফলাফলের সৎ-অবস্থা নোট"
              >
                {resultSummary.notes.slice(0, 6).map((n, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    <span>{n}</span>
                  </li>
                ))}
                {resultSummary.notes.length > 6 && (
                  <li className="pl-5">…আরও {toBnDigits(resultSummary.notes.length - 6)}টি নোট</li>
                )}
              </ul>
            )}
            {/* Phase-5: চূড়ান্ত ফলাফলে সিনেম্যাটিক পরিকল্পনার সৎ সারসংক্ষেপ */}
            {resultSummary?.cinematicPlan && (
              <p className="text-xs text-muted-foreground">
                <span className="font-medium">শট-পরিকল্পনা:</span>{' '}
                {toBnDigits(resultSummary.cinematicPlan.shotCount)}টি শট · কাট-উৎস:{' '}
                {BEAT_SOURCE_LABELS_BN[resultSummary.cinematicPlan.beatSource as keyof typeof BEAT_SOURCE_LABELS_BN] ??
                  resultSummary.cinematicPlan.beatSource}{' '}
                · ডেলিভারি: {toBnDigits(resultSummary.cinematicPlan.deliveryCounts?.local_motion ?? 0)} লোকাল /{' '}
                {toBnDigits(resultSummary.cinematicPlan.deliveryCounts?.prompt_guided ?? 0)} প্রম্পট-নির্দেশিত /{' '}
                {toBnDigits(resultSummary.cinematicPlan.deliveryCounts?.downgraded_to_local ?? 0)} সৎ-বিকল্পে নামানো
              </p>
            )}
            {view.artifacts.length > 0 && <ArtifactList artifacts={view.artifacts} />}
            {(isDone || view.status === 'failed' || view.status === 'cancelled') && (
              <div className="flex flex-wrap gap-2">
                {view.status === 'completed' && view.artifacts.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => useUiView.getState().setActiveView('gallery')}
                  >
                    <Images className="size-4" aria-hidden="true" />
                    গ্যালারিতে দেখুন
                  </Button>
                )}
                {isDone && (
                  <Button size="sm" variant="outline" onClick={() => void handleRevise()} disabled={isRevising}>
                    {isRevising ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="size-4" aria-hidden="true" />}
                    সংশোধন করুন
                  </Button>
                )}
                {/* §2-E: ব্যর্থ/বাতিল হলে নিরাপদ পুনঃচালানোর পথ — বিদ্যমান
                    revise এন্ডপয়েন্টই (নতুন awaiting_confirmation প্রস্তাব তৈরি
                    করে; সরাসরি চালু করে না) */}
                {(view.status === 'failed' || view.status === 'cancelled') && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleRevise('আবার চালানোর প্রস্তাব তৈরি হয়েছে')}
                    disabled={isRevising}
                    className="border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
                  >
                    {isRevising ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="size-4" aria-hidden="true" />}
                    🔁 আবার চালান
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* সংশোধন-প্রস্তাব — নতুন কার্ড এখানেই দেখাও (nested) */}
      {revisionId && (
        <div className="border-t bg-muted/30 px-4 py-3">
          <ProductionCard productionId={revisionId} />
        </div>
      )}
    </div>
  );
}
