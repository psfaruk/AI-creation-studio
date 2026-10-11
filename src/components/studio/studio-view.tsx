'use client';

// ============================================================
// StudioView — মোড-স্টুডিও (নতুন মাস্টার প্ল্যান §১০ Creation Modes)।
// ৩টি সেকশন (Tabs): অডিও স্টুডিও · ভিডিও স্টুডিও · ফিল্ম ডিরেক্টর।
//
// প্রতিটি মোড-কার্ডে বাধ্যতামূলক মেটা (§১০):
// স্ট্যাটাস-ব্যাজ · সমর্থিত ভাষা · সর্বোচ্চ দৈর্ঘ্য · ইঞ্জিন-প্রকৃতি
// · আনুমানিক সময় · GPU-প্রয়োজনীয়তা।
// "শুরু করুন" → ওই মোডের বাংলা draft টেক্সট চ্যাট-কম্পোজারে বসে
// (use-chat-store.setDraft + setActiveView('chat') + ফোকাস)।
// অবরুদ্ধ মোডে বোতাম নেই — ব্যাজ ও নোটেই কারণ (সৎ-অবস্থা)।
// ============================================================

import {
  AudioLines,
  BookOpen,
  CircuitBoard,
  Clapperboard,
  Clock3,
  Cog,
  Film,
  ImagePlay,
  Languages,
  LayoutGrid,
  Megaphone,
  MessagesSquare,
  Mic,
  MicVocal,
  Music,
  PersonStanding,
  Piano,
  PlayCircle,
  ScissorsLineDashed,
  ShieldCheck,
  SlidersHorizontal,
  SmilePlus,
  Timer,
  TriangleAlert,
  Video,
  type LucideIcon,
} from 'lucide-react';

import { toBnDigits } from '@/components/chat/bn-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { useChatStore } from '@/hooks/use-chat-store';
import { useUiView } from '@/hooks/use-ui-view';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// মোড-মডেল (types.ts স্পর্শ না করে লোকালি সংজ্ঞায়িত)
// ------------------------------------------------------------

type ModeStatus = 'active' | 'experimental' | 'blocked';

/** ইঞ্জিন-প্রকৃতির সৎ লেবেল (§১০ বাধ্যতামূলক) */
type EngineNature = 'ai' | 'pipeline' | 'procedural' | 'none';

const ENGINE_LABELS: Record<EngineNature, string> = {
  ai: 'প্রকৃত AI জেনারেশন',
  pipeline: 'সম্পাদনা পাইপলাইন',
  procedural: 'প্রসিডিউরাল সংশ্লেষণ',
  none: 'প্রয়োজনীয় মডেল নেই',
};

interface StudioMode {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
  status: ModeStatus;
  /** চালু মোডে অ্যাম্বার সতর্কতা / পরীক্ষামূলক-ব্যাখ্যা / অবরুদ্ধের কারণ */
  statusNote?: string;
  languages: string;
  maxDuration: string;
  engine: EngineNature;
  eta: string;
  gpu: string;
  /** "শুরু করুন" চাপলে কম্পোজারে বসা draft (অবরুদ্ধ মোডে নেই) */
  draft?: string;
}

// ------------------------------------------------------------
// অডিও স্টুডিও — ৫টি মোড
// ------------------------------------------------------------

const AUDIO_MODES: StudioMode[] = [
  {
    id: 'audio-tts',
    icon: AudioLines,
    title: 'টেক্সট-টু-স্পিচ (TTS)',
    description: 'লেখাকে স্বাভাবিক কণ্ঠের অডিওতে রূপ দেয় — সব ভাষায় প্রকৃত AI কণ্ঠ।',
    status: 'active',
    languages: 'বাংলা · ইংরেজি · অন্য ভাষা',
    maxDuration: `${toBnDigits(60)} সেকেন্ড / কল`,
    engine: 'ai',
    eta: `${toBnDigits(10)}–${toBnDigits(60)} সেকেন্ড`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'এই লেখাটা স্বাভাবিক কণ্ঠে অডিও বানিয়ে দাও: “এখানে আপনার লেখা লিখুন” — ভাষা বাংলা, কণ্ঠ jam, মান standard।',
  },
  {
    id: 'audio-bn-voiceover',
    icon: Mic,
    title: 'বাংলা ভয়েসওভার',
    description:
      'ভাষা-নিয়ন্ত্রক: TTS → দৈর্ঘ্য-যাচাই → ASR ব্যাক-চেক → রায় (pass/warn/fail)।',
    status: 'active',
    statusNote: 'কণ্ঠ বাংলা-প্রশিক্ষিত নয় — প্রিভিউ শুনে যাচাই করুন',
    languages: 'বাংলা (যাচাই-রায়সহ) · ইংরেজি',
    maxDuration: `${toBnDigits(90)} সেকেন্ড (${toBnDigits(28)} সে. চাঙ্ক-যাচাই)`,
    engine: 'ai',
    eta: `${toBnDigits(30)} সেকেন্ড – ${toBnDigits(2)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'নিচের স্ক্রিপ্টের বাংলা ভয়েসওভার বানাও — ভাষা-যাচাই (ASR ব্যাক-চেক) চালিয়ে রায় দেখাও: “এখানে আপনার স্ক্রিপ্ট লিখুন” — ভাষা বাংলা, কণ্ঠ jam, মান standard। মনে রেখো, কণ্ঠ বাংলা-প্রশিক্ষিত নয় — তাই আমি প্রিভিউ শুনে নিশ্চিত হব।',
  },
  {
    id: 'audio-instrumental',
    icon: Piano,
    title: 'ইনস্ট্রুমেন্টাল মিউজিক',
    description:
      '৬ মুড × স্কেল/কর্ড-প্রগ্রেশন/ছন্দ-সচেতন বাদ্য — বিট-মার্কার ও সেকশন-তালিকাসহ।',
    status: 'experimental',
    statusNote: 'প্রসিডিউরাল সংশ্লেষণ — নিউরাল মিউজিক-মডেল নয়',
    languages: 'ভাষা-নিরপেক্ষ (বাদ্য)',
    maxDuration: `${toBnDigits(120)} সেকেন্ড`,
    engine: 'procedural',
    eta: `${toBnDigits(20)}–${toBnDigits(60)} সেকেন্ড`,
    gpu: 'লোকাল GPU লাগে না (CPU-সংশ্লেষণ)',
    draft:
      '৩০ সেকেন্ডের রোমান্টিক মুডের ইনস্ট্রুমেন্টাল বানাও — টেম্পো ৯০ BPM। (এটা প্রসিডিউরাল সংশ্লেষণ — নিউরাল মিউজিক-মডেল নয়, তবু বিট-মার্কারসহ চাই।)',
  },
  {
    id: 'audio-full-song',
    icon: MicVocal,
    title: 'পূর্ণ গান — কণ্ঠসংগীতসহ',
    description:
      'গায়কের কণ্ঠসহ সম্পূর্ণ গান সংশ্লেষণ — ACE-Step/YuE-ধরনের মডেল দরকার, যা এই পরিবেশে নেই।',
    status: 'blocked',
    statusNote: 'গান-গাওয়া মডেল নেই',
    languages: '—',
    maxDuration: '—',
    engine: 'none',
    eta: '—',
    gpu: 'GPU ১২GB+ প্রয়োজন হতো',
  },
  {
    id: 'audio-editing',
    icon: SlidersHorizontal,
    title: 'অডিও এডিটিং ও মিক্সিং',
    description:
      'ট্রিম, জোড়া, ফেড, ভলিউম, নরমালাইজ, EQ/কমপ্রেস/রিভার্ব ও মাল্টি-ট্র্যাক মিক্স।',
    status: 'active',
    languages: 'ভাষা-নিরপেক্ষ',
    maxDuration: `${toBnDigits(10)} মিনিট+ (ফাইল অনুযায়ী)`,
    engine: 'pipeline',
    eta: `${toBnDigits(5)}–${toBnDigits(30)} সেকেন্ড`,
    gpu: 'লোকাল GPU লাগে না (FFmpeg)',
    draft:
      'এই অডিওটা সম্পাদনা করো — শুরু-শেষে ১ সেকেন্ড ফেড, লাউডনেস নরমালাইজ এবং MP3-এ এক্সপোর্ট। (অডিও ফাইলটা কম্পোজারের অ্যাটাচ বোতামে যোগ করে দিন)',
  },
];

// ------------------------------------------------------------
// ভিডিও স্টুডিও — ৬টি মোড
// ------------------------------------------------------------

const VIDEO_MODES: StudioMode[] = [
  {
    id: 'video-real-ai',
    icon: Film,
    title: 'রিয়েল AI ভিডিও',
    description:
      'CogVideoX-3 ডিফিউশনে লেখা থেকে সম্পূর্ণ নতুন চলমান দৃশ্য — স্টোরিবোর্ড-জুম নয়।',
    status: 'active',
    statusNote: 'CogVideoX-3 ডিফিউশন — প্রতি শটে ২–৪ মিনিট',
    languages: 'বাংলা আইডিয়া (প্রম্পট অনুবাদসহ)',
    maxDuration: `প্রতি শট ${toBnDigits(5)}–${toBnDigits(10)} সে.`,
    engine: 'ai',
    eta: `প্রতি শটে ${toBnDigits(2)}–${toBnDigits(4)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'CogVideoX-3 দিয়ে ১০ সেকেন্ডের রিয়েল AI ভিডিও বানাও — আইডিয়া: ভোরের কুয়াশায় নদীর ওপর সূর্য উঠছে, সিনেম্যাটিক লুক। ভিডিও-ইঞ্জিন: প্রকৃত AI (CogVideoX-3), অনুপাত ১৬:৯, মান standard।',
  },
  {
    id: 'video-i2v',
    icon: ImagePlay,
    title: 'ছবি → AI ভিডিও',
    description:
      'রেফারেন্স ছবির ভিত্তিতে CogVideoX-3 (i2v) চলমান দৃশ্য — পরিচয় যতটা সম্ভব ধরে রাখে।',
    status: 'active',
    languages: 'বাংলা নির্দেশনা',
    maxDuration: `প্রতি শট ${toBnDigits(5)}–${toBnDigits(10)} সে.`,
    engine: 'ai',
    eta: `${toBnDigits(2)}–${toBnDigits(4)} মিনিট / শট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'ছবিটা অ্যাটাচ করেছি — এটাকে CogVideoX-3 (i2v) দিয়ে চলমান ভিডিও বানাও: মৃদু ক্যামেরা-মোশন, প্রাকৃতিক আন্দোলন, ৫–১০ সেকেন্ড।',
  },
  {
    id: 'video-character',
    icon: PersonStanding,
    title: 'চরিত্র-অ্যানিমেশন',
    description:
      'চরিত্রের চলা/বসা/অঙ্গ-ভঙ্গি — অভিনয়-নির্দেশিত প্রম্পটে; জটিল অ্যাকশনে প্রিভিউ-যাচাই দরকার।',
    status: 'experimental',
    statusNote: 'মোশন-প্রম্পট-ভিত্তিক; ফলাফল পরিবর্তনশীল',
    languages: 'বাংলা নির্দেশনা',
    maxDuration: `প্রতি শট ${toBnDigits(5)}–${toBnDigits(10)} সে.`,
    engine: 'ai',
    eta: `${toBnDigits(2)}–${toBnDigits(4)} মিনিট / শট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'এই চরিত্রের ছবিটা অ্যানিমেট করো — অভিনয়-নির্দেশ: মৃদু হেসে মাথা নাড়াচ্ছে, বাতাসে চুল উড়ছে; ৮ সেকেন্ড। ফলাফল পরিবর্তনশীল হলে প্রিভিউ দেখিয়ে মত জানাও।',
  },
  {
    id: 'video-lipsync',
    icon: SmilePlus,
    title: 'কথা-বলা চরিত্র — লিপ-সিঙ্ক',
    description:
      'অডিওর সাথে ঠোঁট মেলানো — MuseTalk-ধরনের লিপ-সিঙ্ক মডেল এই পরিবেশে স্থাপিত নয়।',
    status: 'blocked',
    statusNote: 'লিপ-সিঙ্ক মডেল নেই',
    languages: '—',
    maxDuration: '—',
    engine: 'none',
    eta: '—',
    gpu: 'GPU ৪–১২GB প্রয়োজন হতো',
  },
  {
    id: 'video-singing-lipsync',
    icon: Music,
    title: 'গান-গাওয়া লিপ-সিঙ্ক',
    description:
      'গানের সাথে গায়কের ঠোঁট মেলানো — লিপ-সিঙ্ক ও গান-মডেল দুই-ই এখন নেই।',
    status: 'blocked',
    statusNote: 'লিপ-সিঙ্ক ও গান-গাওয়া মডেল দুই-ই নেই',
    languages: '—',
    maxDuration: '—',
    engine: 'none',
    eta: '—',
    gpu: 'GPU ১২GB+ প্রয়োজন হতো',
  },
  {
    id: 'video-editing',
    icon: ScissorsLineDashed,
    title: 'ভিডিও এডিটিং',
    description:
      'ট্রিম, জোড়া, স্পিড, ক্রপ, ট্রানজিশন, অডিও-সংযোজন — FFmpeg সম্পাদনা।',
    status: 'active',
    statusNote: 'FFmpeg সম্পাদনা — AI-জেনারেশন নয়',
    languages: 'ভাষা-নিরপেক্ষ',
    maxDuration: `${toBnDigits(10)} মিনিট+ (ফাইল অনুযায়ী)`,
    engine: 'pipeline',
    eta: `${toBnDigits(5)}–${toBnDigits(60)} সেকেন্ড`,
    gpu: 'লোকাল GPU লাগে না (FFmpeg)',
    draft:
      'এই ভিডিওটা সম্পাদনা করো — প্রথম ১০ সেকেন্ড রেখে বাকিটা ট্রিম, শেষে ১ সেকেন্ড ফেড-আউট, ১০৮০p-এ এক্সপোর্ট। (ভিডিও ফাইলটা কম্পোজারের অ্যাটাচ বোতামে যোগ করে দিন)',
  },
];

// ------------------------------------------------------------
// ফিল্ম ডিরেক্টর — ৫টি মোড (সবই চালু)
// ------------------------------------------------------------

const FILM_MODES: StudioMode[] = [
  {
    id: 'film-short',
    icon: Clapperboard,
    title: 'শর্টফিল্ম',
    description:
      '৮-স্তর পাইপলাইন: চিত্রনাট্য → দৃশ্য-বিভাজন → চরিত্র-বাইবেল → অভিনয়-পরিকল্পনা → AI শট → সাউন্ড-ডিজাইন → ধারাবাহিকতা → ফাইনাল মিক্স।',
    status: 'active',
    statusNote: '৮-স্তর পাইপলাইন',
    languages: 'বাংলা সংলাপ + সাবটাইটেল',
    maxDuration: `${toBnDigits(30)}–${toBnDigits(120)} সেকেন্ড`,
    engine: 'ai',
    eta: `${toBnDigits(10)}–${toBnDigits(40)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-শট)',
    draft:
      '৩০ সেকেন্ডের শর্টফিল্ম বানাও — গল্প: জেলের ছেলে ভোরবেলা নদীতে নেমে জীবনে প্রথম বড় মাছ ধরে। মুড heartfelt, বাংলা সংলাপ + সাবটাইটেল, অনুপাত ১৬:৯, মান draft।',
  },
  {
    id: 'film-dialogue',
    icon: MessagesSquare,
    title: 'সংলাপ-দৃশ্য',
    description:
      'দুই/তিন চরিত্রের কথোপকথনের দৃশ্য — সংলাপ-TTS মাপা-দৈর্ঘ্য টাইমলাইনে বসে।',
    status: 'active',
    languages: 'বাংলা · ইংরেজি',
    maxDuration: `${toBnDigits(20)}–${toBnDigits(60)} সেকেন্ড`,
    engine: 'ai',
    eta: `${toBnDigits(5)}–${toBnDigits(20)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না',
    draft:
      'চা-দোকানে দুই বন্ধুর একটা মজার সংলাপ-দৃশ্য বানাও — বাংলা সংলাপ, ২০ সেকেন্ড, অনুপাত ১৬:৯, মান standard।',
  },
  {
    id: 'film-music-video',
    icon: Music,
    title: 'মিউজিক ভিডিও',
    description:
      'আপলোড করা গানের বিট-মার্কারে কাট-মিলানো ভিজ্যুয়াল — গান না দিলে প্রসিডিউরাল ইনস্ট্রুমেন্টাল স্কোর।',
    status: 'active',
    languages: 'যেকোনো গান (ভিষয়-নিরপেক্ষ ভিজ্যুয়াল)',
    maxDuration: `${toBnDigits(15)}–${toBnDigits(180)} সেকেন্ড`,
    engine: 'ai',
    eta: `${toBnDigits(10)}–${toBnDigits(30)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না',
    draft:
      'গান আপলোড করেছি — এটা দিয়ে একটা মিউজিক ভিডিও বানাও: মুড romantic, অনুপাত 9:16, দৈর্ঘ্য ৩০ সেকেন্ড, মান draft। গানের বিট-মার্কারে কাট মিলিয়ে দিও।',
  },
  {
    id: 'film-trailer',
    icon: Megaphone,
    title: 'সিনেম্যাটিক ট্রেইলার',
    description:
      'শর্ট টেকে টেনশন-বিল্ডআপ + বাংলা টাইটেল-কার্ড + পরিবেশ-শব্দ ও সাউন্ড-ডিজাইন।',
    status: 'active',
    languages: 'বাংলা টেক্সট-ওভারলে',
    maxDuration: `${toBnDigits(15)}–${toBnDigits(60)} সেকেন্ড`,
    engine: 'ai',
    eta: `${toBnDigits(5)}–${toBnDigits(20)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না',
    draft:
      'একটা সিনেম্যাটিক ট্রেইলার বানাও — থিম: ঢাকা শহরের এক রাতের রহস্য-গল্প। ২০ সেকেন্ড, অনুপাত ১৬:৯, বাংলা টাইটেল-কার্ড + পরিবেশ-শব্দ, মান draft।',
  },
  {
    id: 'film-story',
    icon: BookOpen,
    title: 'গল্প-ভিত্তিক ভিডিও',
    description:
      'গল্প বলা ভিডিও — বর্ণনা (ভয়েসওভার) + দৃশ্য + সাবটাইটেল।',
    status: 'active',
    languages: 'বাংলা বর্ণনা + সাবটাইটেল',
    maxDuration: `${toBnDigits(30)}–${toBnDigits(90)} সেকেন্ড`,
    engine: 'ai',
    eta: `${toBnDigits(10)}–${toBnDigits(30)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না',
    draft:
      'ঠাকুরদার শোনানো লোকগাঁয়ের গল্প দিয়ে একটা গল্প-ভিত্তিক ভিডিও বানাও — বাংলা ভয়েসওভার বর্ণনা, ৪৫ সেকেন্ড, অনুপাত ১৬:৯, মান standard।',
  },
];

// ------------------------------------------------------------
// স্ট্যাটাস-ব্যাজ ও কার্ড
// ------------------------------------------------------------

const STATUS_META: Record<ModeStatus, { label: string; className: string }> = {
  active: {
    label: 'চালু',
    className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  },
  experimental: {
    label: 'পরীক্ষামূলক',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  blocked: {
    label: 'অবরুদ্ধ',
    className: 'border-stone-400/50 bg-stone-400/15 text-stone-600 dark:text-stone-300',
  },
};

/** মেটা-সারি: আইকন + লেবেল + মান */
function ModeMetaRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <li className="flex items-start gap-1.5 text-xs leading-relaxed">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/80" aria-hidden="true" />
      <span className="min-w-0">
        <span className="text-muted-foreground">{label}: </span>
        <span className="text-foreground/90">{value}</span>
      </span>
    </li>
  );
}

function ModeCard({ mode, onStart }: { mode: StudioMode; onStart: (draft: string) => void }) {
  const status = STATUS_META[mode.status];
  const Icon = mode.icon;

  return (
    <Card className="flex h-full flex-col gap-3 rounded-xl p-4 shadow-sm sm:p-5">
      {/* হেডার: আইকন + শিরোনাম + স্ট্যাটাস */}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            mode.status === 'blocked'
              ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold leading-snug">{mode.title}</h3>
            <Badge variant="outline" className={cn('shrink-0 text-[11px]', status.className)}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mode.description}</p>
        </div>
      </div>

      {/* সতর্কতা / পরীক্ষামূলক-ব্যাখ্যা / অবরুদ্ধের কারণ */}
      {mode.statusNote && (
        <p
          className={cn(
            'flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs leading-relaxed',
            mode.status === 'blocked'
              ? 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
          )}
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {mode.statusNote}
        </p>
      )}

      {/* বাধ্যতামূলক মেটা (§১০) */}
      <ul className="space-y-1.5" aria-label={`${mode.title} — মোড-মেটা`}>
        <ModeMetaRow icon={Languages} label="ভাষা" value={mode.languages} />
        <ModeMetaRow icon={Timer} label="সর্বোচ্চ দৈর্ঘ্য" value={mode.maxDuration} />
        <ModeMetaRow icon={Cog} label="ইঞ্জিন" value={ENGINE_LABELS[mode.engine]} />
        <ModeMetaRow icon={Clock3} label="আনুমানিক সময়" value={mode.eta} />
        <ModeMetaRow icon={CircuitBoard} label="GPU" value={mode.gpu} />
      </ul>

      {/* অ্যাকশন */}
      <div className="mt-auto">
        {mode.status === 'blocked' ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
            এই মোড এখন বন্ধ — উপলব্ধ হলে রেজিস্ট্রি ভিউতে আপডেট হবে।
          </p>
        ) : (
          <Button
            type="button"
            onClick={() => onStart(mode.draft ?? '')}
            className="h-11 w-full rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 focus-visible:ring-emerald-600/40 dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            <PlayCircle className="size-4" aria-hidden="true" />
            শুরু করুন
          </Button>
        )}
      </div>
    </Card>
  );
}

function ModeGrid({ modes, onStart }: { modes: StudioMode[]; onStart: (draft: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modes.map((mode) => (
        <ModeCard key={mode.id} mode={mode} onStart={onStart} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// মূল ভিউ
// ------------------------------------------------------------

export function StudioView() {
  const setDraft = useChatStore((s) => s.setDraft);
  const focusComposer = useChatStore((s) => s.focusComposer);
  const setActiveView = useUiView((s) => s.setActiveView);

  /** "শুরু করুন" → draft বসাও → চ্যাট-ভিউ → কম্পোজারে ফোকাস */
  const handleStart = (draft: string) => {
    if (!draft.trim()) return;
    setDraft(draft);
    setActiveView('chat');
    focusComposer();
    toast({
      title: 'স্টুডিও-মোড প্রস্তুত',
      description: 'ড্রাফট চ্যাটে বসেছে — ইচ্ছামতো সম্পাদনা করে পাঠান।',
    });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-5 space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <LayoutGrid className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          স্টুডিও — তৈরির মোড
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          কী বানাতে চান বেছে নিন — প্রতিটি মোডের ইঞ্জিন-প্রকৃতি, সময় ও সীমা স্পষ্ট লেখা আছে।
          “শুরু করুন” চাপলে মোডের প্রস্তুত নির্দেশনা চ্যাটে বসে যাবে।
        </p>
      </header>

      <Tabs defaultValue="audio" className="gap-4">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl p-1 sm:w-auto">
          <TabsTrigger
            value="audio"
            className="min-h-11 shrink-0 rounded-lg px-4 text-xs sm:text-sm"
          >
            <AudioLines className="size-4" aria-hidden="true" />
            অডিও স্টুডিও
          </TabsTrigger>
          <TabsTrigger
            value="video"
            className="min-h-11 shrink-0 rounded-lg px-4 text-xs sm:text-sm"
          >
            <Video className="size-4" aria-hidden="true" />
            ভিডিও স্টুডিও
          </TabsTrigger>
          <TabsTrigger
            value="film"
            className="min-h-11 shrink-0 rounded-lg px-4 text-xs sm:text-sm"
          >
            <Clapperboard className="size-4" aria-hidden="true" />
            ফিল্ম ডিরেক্টর
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audio" className="mt-0">
          <ModeGrid modes={AUDIO_MODES} onStart={handleStart} />
        </TabsContent>
        <TabsContent value="video" className="mt-0">
          <ModeGrid modes={VIDEO_MODES} onStart={handleStart} />
        </TabsContent>
        <TabsContent value="film" className="mt-0">
          <ModeGrid modes={FILM_MODES} onStart={handleStart} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
