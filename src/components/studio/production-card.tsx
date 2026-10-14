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

import { useEffect, useState } from 'react';
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

interface ParsedResult {
  quality?: string;
  partialNotes?: string[];
  engine?: string;
  aiShots?: number;
  shots?: number;
  shotEngines?: { index: number; engine: string; label: string; model?: string; error?: string }[];
  honestLabel?: string;
  musicEngine?: string | null;
  musicSource?: string;
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

/** ভিডিও-ইঞ্জিন-সচেতন সততা-নোট (§৪) — ডিফল্ট এখন প্রকৃত AI ডিফিউশন */
const VIDEO_ENGINE_NOTES: Record<VideoEngine, string> = {
  ai_diffusion:
    'প্রতিটি শট CogVideoX-3 ক্লাউড-ডিফিউশনে প্রকৃতভাবে তৈরি হয় — প্রতি শটে ২–৪ মিনিট সময় লাগে; রেট-সীমায় ধৈর্যশীল ব্যাকঅফ হয়, তাই অপেক্ষার সময় বাড়তে পারে।',
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
};

const VIDEO_ENGINE_LABELS: Record<VideoEngine, string> = {
  ai_diffusion: 'প্রকৃত AI ভিডিও (CogVideoX-3) — রিয়েলিস্টিক, ধীর (প্রতি শটে ~৫ মিনিট)',
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
}: {
  spec: CreativeJobSpec;
  onChange: (next: CreativeJobSpec) => void;
}) {
  // (অডিট §D) "উন্নত সেটিংস" কোলাপ্সিবল — কম-ব্যবহৃত ফিল্ডগুলো ভাঁজ-করা;
  // মূল ফর্মে থাকে: মান/ভাষা/ইঞ্জিন/ফিল্ম-মোড/মুড/অনুপাত/দৈর্ঘ্য/কণ্ঠ
  const [advancedOpen, setAdvancedOpen] = useState(false);
  /** স্টাইল-ড্রপডাউনে "কাস্টম" নির্বাচিত — খোলা টেক্সট-ইনপুট দেখায় */
  const [customStyleMode, setCustomStyleMode] = useState(false);

  const isVideo = isVideoType(spec.type);
  const patch = (p: Partial<CreativeJobSpec>) => onChange({ ...spec, ...p });

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

  // resultJson-এর সারাংশ (quality report + §2-C ইঞ্জিন-তথ্য)
  let resultSummary: ParsedResult | null = null;
  if (view.resultJson) {
    try {
      resultSummary = JSON.parse(view.resultJson) as ParsedResult;
    } catch {
      resultSummary = null;
    }
  }

  const spec = editedSpec ?? view.spec;
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
                  <span className="font-medium">সময়:</span> {honestEtaText(spec)}
                </p>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <Button
                  size="lg"
                  onClick={() => void handleConfirm()}
                  disabled={isConfirming}
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
            <SpecEditor spec={spec} onChange={next => setEditedSpec(next)} />
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
