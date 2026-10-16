'use client';

// ============================================================
// StudioView — মোড-স্টুডিও (নতুন মাস্টার প্ল্যান §১০ Creation Modes
// + §১১ সৎ স্ট্যাটাস)। ৩টি সেকশন (Tabs): অডিও · ভিডিও · ফিল্ম।
//
// প্রতিটি মোড-কার্ডে বাধ্যতামূলক মেটা (§১০):
// স্ট্যাটাস-ব্যাজ · সমর্থিত ভাষা · সর্বোচ্চ দৈর্ঘ্য · ইঞ্জিন-প্রকৃতি
// · আনুমানিক সময় · GPU-প্রয়োজনীয়তা।
//
// §১১-আপগ্রেড: স্ট্যাটাস এখন লাইভ Availability Matrix থেকে ওই
// মোডের ক্ষমতা-সারির overall রায়ে নির্ণীত (useAvailability) —
// ম্যাট্রিক্স না লোড হলে হার্ডকোডেড সৎ ফলব্যাক। কার্ডে চার-মাত্রিক
// চিপ (লাইসেন্স/প্রোভাইডার/ইন্টিগ্রেশন/রানটাইম) + "শেষ পরীক্ষা" +
// অনুপলব্ধ হলে প্রকৃত কারণ (errorReason) ও বিকল্প-পথ (fallback)।
// "শুরু করুন" → ওই মোডের বাংলা draft টেক্সট চ্যাট-কম্পোজারে বসে।
// ============================================================

import { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  AudioLines,
  BookOpen,
  CalendarCheck,
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
  Volume2,
  type LucideIcon,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { formatDateBn, toBnDigits } from '@/components/chat/bn-format';
import {
  DimensionChip,
  INTEGRATION_META,
  LICENSE_META,
  PROVIDER_META,
  RUNTIME_META,
} from '@/components/studio/availability-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAvailability } from '@/hooks/use-availability';
import { toast } from '@/hooks/use-toast';
import { useChatStore } from '@/hooks/use-chat-store';
import { useUiView } from '@/hooks/use-ui-view';
import type { AvailabilityMatrixRow, MatrixOverall } from '@/lib/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// মোড-মডেল (types.ts স্পর্শ না করে লোকালি সংজ্ঞায়িত)
// ------------------------------------------------------------

/**
 * §১১-সৎ স্ট্যাটাস — ম্যাট্রিক্সের overall রায় থেকে নির্ণীত:
 * available→active, available_with_limits→limited,
 * experimental→experimental, unavailable_here→unavailable, future→future।
 */
type ModeStatus = 'active' | 'limited' | 'experimental' | 'unavailable' | 'future';

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
  /** হার্ডকোডেড সৎ ফলব্যাক — ম্যাট্রিক্স লোড হলে overall রায়ই প্রযোজ্য */
  status: ModeStatus;
  /** Availability Matrix-এর ক্ষমতা-কী (cap-*) — লাইভ রায়ের উৎস */
  matrixKey?: string;
  /** সতর্কতা / পরীক্ষামূলক-ব্যাখ্যা / ফলব্যাক-কারণ (ম্যাট্রিক্স-নোটের ফলব্যাক) */
  statusNote?: string;
  /** অতিরিক্ত সৎ-স্ট্যাটাস-লাইন (S8-2d — বাংলা TTS মান-যাচাই-নির্দেশনা) */
  extraNote?: string;
  languages: string;
  maxDuration: string;
  engine: EngineNature;
  eta: string;
  gpu: string;
  /** "শুরু করুন" চাপলে কম্পোজারে বসা draft (অফ-মোডে নেই) */
  draft?: string;
}

/** ম্যাট্রিক্সের overall রায় → মোড-স্ট্যাটাস */
function statusFromOverall(overall: MatrixOverall): ModeStatus {
  switch (overall) {
    case 'available':
      return 'active';
    case 'available_with_limits':
      return 'limited';
    case 'experimental':
      return 'experimental';
    case 'unavailable_here':
      return 'unavailable';
    case 'future':
      return 'future';
  }
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
    matrixKey: 'cap-speech',
    languages: 'বাংলা · ইংরেজি · অন্য ভাষা',
    maxDuration: `${toBnDigits(60)} সেকেন্ড / কল`,
    engine: 'ai',
    eta: `${toBnDigits(10)}–${toBnDigits(60)} সেকেন্ড`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    extraNote: 'বাংলা মান-যাচাই: বেঞ্চমার্ক-ল্যাবে (রেজিস্ট্রি ভিউ)',
    draft:
      'এই লেখাটা স্বাভাবিক কণ্ঠে অডিও বানিয়ে দাও: “এখানে আপনার লেখা লিখুন” — ভাষা বাংলা, কণ্ঠ নবনীতা (bn-BD নিউরাল), মান standard।',
  },
  {
    id: 'audio-bn-voiceover',
    icon: Mic,
    title: 'বাংলা ভয়েসওভার',
    description:
      'ভাষা-নিয়ন্ত্রক: TTS → দৈর্ঘ্য-যাচাই → ASR ব্যাক-চেক → রায় (pass/warn/fail)।',
    status: 'active',
    matrixKey: 'cap-speech',
    statusNote: 'কণ্ঠ বাংলা-প্রশিক্ষিত নয় — প্রিভিউ শুনে যাচাই করুন',
    languages: 'বাংলা (যাচাই-রায়সহ) · ইংরেজি',
    maxDuration: `${toBnDigits(90)} সেকেন্ড (${toBnDigits(28)} সে. চাঙ্ক-যাচাই)`,
    engine: 'ai',
    eta: `${toBnDigits(30)} সেকেন্ড – ${toBnDigits(2)} মিনিট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'নিচের স্ক্রিপ্টের বাংলা ভয়েসওভার বানাও — ভাষা-যাচাই (ASR ব্যাক-চেক) চালিয়ে রায় দেখাও: “এখানে আপনার স্ক্রিপ্ট লিখুন” — ভাষা বাংলা, কণ্ঠ নবনীতা (bn-BD নিউরাল), মান standard। বাংলা নিউরাল কণ্ঠ দেশীয় উচ্চারণে পড়বে।',
  },
  {
    id: 'audio-instrumental',
    icon: Piano,
    title: 'ইনস্ট্রুমেন্টাল মিউজিক',
    description:
      '৬ মুড × স্কেল/কর্ড-প্রগ্রেশন/ছন্দ-সচেতন বাদ্য — বিট-মার্কার ও সেকশন-তালিকাসহ।',
    status: 'experimental',
    matrixKey: 'cap-instrumental',
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
      'গায়কের কণ্ঠসহ সম্পূর্ণ গান সংশ্লেষণ — YuE/ACE-Step-ধরনের মডেল দরকার, যা এই পরিবেশে চালু নয়।',
    status: 'future',
    matrixKey: 'cap-full-song',
    statusNote: 'লাইসেন্স-অনুমতি আছে (অ-বাণিজ্যিক) — বাধা GPU/API-এর',
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
// ভিডিও স্টুডিও — ৭টি মোড (নতুন: নেটিভ-অডিওসহ AI ভিডিও)
// ------------------------------------------------------------

const VIDEO_MODES: StudioMode[] = [
  {
    id: 'video-real-ai',
    icon: Film,
    title: 'রিয়েল AI ভিডিও',
    description:
      'CogVideoX-3 ডিফিউশনে লেখা থেকে সম্পূর্ণ নতুন চলমান দৃশ্য — স্টোরিবোর্ড-জুম নয়।',
    status: 'active',
    matrixKey: 'cap-t2v',
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
    matrixKey: 'cap-i2v',
    languages: 'বাংলা নির্দেশনা',
    maxDuration: `প্রতি শট ${toBnDigits(5)}–${toBnDigits(10)} সে.`,
    engine: 'ai',
    eta: `${toBnDigits(2)}–${toBnDigits(4)} মিনিট / শট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'ছবিটা অ্যাটাচ করেছি — এটাকে CogVideoX-3 (i2v) দিয়ে চলমান ভিডিও বানাও: মৃদু ক্যামেরা-মোশন, প্রাকৃতিক আন্দোলন, ৫–১০ সেকেন্ড।',
  },
  {
    id: 'video-native-audio',
    icon: Volume2,
    title: 'নেটিভ-অডিওসহ AI ভিডিও',
    description:
      'CogVideoX-3 with_audio — ভিডিও ও তার নিজস্ব AI-অডিও একসাথে জেনারেট; অডিও-স্ট্রিম ffprobe-যাচাইকৃত।',
    status: 'active',
    matrixKey: 'cap-video-audio',
    statusNote: 'কেবল API-সফলতা যথেষ্ট নয় — অডিও-স্ট্রিম ffprobe দিয়ে যাচাই হয়',
    languages: 'বাংলা আইডিয়া (প্রম্পট অনুবাদসহ)',
    maxDuration: `প্রতি শট ${toBnDigits(5)}–${toBnDigits(10)} সে.`,
    engine: 'ai',
    eta: `${toBnDigits(2)}–${toBnDigits(4)} মিনিট / শট`,
    gpu: 'লোকাল GPU লাগে না (ক্লাউড-মডেল)',
    draft:
      'CogVideoX-3 with_audio দিয়ে ১০ সেকেন্ডের ভিডিও বানাও — ভিডিওর সাথে নেটিভ AI-অডিও চাই (withAudio): বৃষ্টির রাতে পুরনো শহরের গলি, বৃষ্টির শব্দসহ। অনুপাত ১৬:৯।',
  },
  {
    id: 'video-character',
    icon: PersonStanding,
    title: 'চরিত্র-অ্যানিমেশন',
    description:
      'চরিত্রের চলা/বসা/অঙ্গ-ভঙ্গি — অভিনয়-নির্দেশিত প্রম্পটে; জটিল অ্যাকশনে প্রিভিউ-যাচাই দরকার।',
    status: 'experimental',
    matrixKey: 'cap-character-motion',
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
      'অডিওর সাথে ঠোঁট মেলানো — Wav2Lip/MuseTalk-ধরনের লিপ-সিঙ্ক মডেল এই পরিবেশে চালু নয়।',
    status: 'unavailable',
    matrixKey: 'cap-talking-portrait',
    statusNote: 'বাধা লাইসেন্সে নয় — GPU/API/ইন্টিগ্রেশনে',
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
      'গানের সাথে গায়কের ঠোঁট মেলানো — লিপ-সিঙ্ক ও গান-মডেল দুই-ই এখানে চালু নয়।',
    status: 'unavailable',
    matrixKey: 'cap-singing-lipsync',
    statusNote: 'বাধা লাইসেন্সে নয় — GPU/API/ইন্টিগ্রেশনে',
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
    matrixKey: 'cap-video-editing',
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
// ফিল্ম ডিরেক্টর — ৫টি মোড
// ------------------------------------------------------------

// (REG-12r টেস্ট-লক) মোড-তালিকাগুলো এক্সপোর্টেড — সৎ-স্ট্যাটাস-লেবেল
// (যেমন ঠোঁট-সিঙ্ক-নয় statusNote) রিগ্রেশন-টেস্টে আটকে রাখার জন্য।
export const FILM_MODES: StudioMode[] = [
  {
    id: 'film-short',
    icon: Clapperboard,
    title: 'শর্টফিল্ম',
    description:
      '৮-স্তর পাইপলাইন: চিত্রনাট্য → দৃশ্য-বিভাজন → চরিত্র-বাইবেল → অভিনয়-পরিকল্পনা → AI শট → সাউন্ড-ডিজাইন → ধারাবাহিকতা → ফাইনাল মিক্স।',
    status: 'active',
    matrixKey: 'cap-short-film',
    statusNote: 'সংলাপ-অডিও ও AI-দৃশ্য থাকে — ঠোঁট-সিঙ্ক নয়',
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
    matrixKey: 'cap-short-film',
    // (C-F06) সবচেয়ে কথা-ঘন মোড — ভাইবোদের (film-short/film-music-video)
    // মতোই স্পষ্ট ঠোঁট-সিঙ্ক-নয় স্বীকারোক্তি বহন করে
    statusNote: 'সংলাপ-কণ্ঠ ও সাবটাইটেল — ঠোঁট-সিঙ্ক নয়',
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
    matrixKey: 'cap-music-video',
    statusNote: 'গায়কের মুখ নড়ে না (লিপ-সিঙ্ক নেই) — সৎভাবে ঘোষিত',
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
    matrixKey: 'cap-motion-video',
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
    matrixKey: 'cap-motion-video',
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
  limited: {
    label: 'সীমাসহ',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  experimental: {
    label: 'পরীক্ষামূলক',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  unavailable: {
    label: 'অনুপলব্ধ (এখানে)',
    className: 'border-stone-400/50 bg-stone-400/15 text-stone-600 dark:text-stone-300',
  },
  future: {
    label: 'ভবিষ্যৎ',
    className: 'border-dashed border-stone-400/70 bg-transparent text-stone-600 dark:text-stone-300',
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

function ModeCard({
  mode,
  row,
  onStart,
}: {
  mode: StudioMode;
  /** Availability Matrix-এর সংশ্লিষ্ট সারি (না পেলে হার্ডকোডেড ফলব্যাক) */
  row?: AvailabilityMatrixRow;
  onStart: (draft: string) => void;
}) {
  // §১১: ম্যাট্রিক্সের overall রায়ই প্রাধান্য পায়; না লোড হলে হার্ডকোডেড সৎ স্ট্যাটাস
  const status = row ? statusFromOverall(row.overall) : mode.status;
  const meta = STATUS_META[status];
  const isOff = status === 'unavailable' || status === 'future';
  const Icon = mode.icon;

  // অফ-মোডে প্রকৃত কারণ (ম্যাট্রিক্সের errorReason); চালু-ধরনের মোডে সৎ-নোট
  const noteText = isOff ? (row?.errorReason ?? mode.statusNote) : (row?.honestNote ?? mode.statusNote);
  const notePrefix = isOff ? 'কারণ: ' : '';

  return (
    <Card className="flex h-full flex-col gap-3 rounded-xl p-4 shadow-sm sm:p-5">
      {/* হেডার: আইকন + শিরোনাম + স্ট্যাটাস */}
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg',
            isOff
              ? 'bg-muted text-muted-foreground'
              : 'bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold leading-snug">{mode.title}</h3>
            <Badge variant="outline" className={cn('shrink-0 text-[11px]', meta.className)}>
              {meta.label}
            </Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{mode.description}</p>
        </div>
      </div>

      {/* §১১: চার-মাত্রিক স্ট্যাটাস-চিপ + শেষ পরীক্ষা (ম্যাট্রিক্স থেকে) */}
      {row && (
        <div className="flex flex-wrap items-center gap-1" aria-label={`${mode.title} — চার-মাত্রিক স্ট্যাটাস`}>
          <DimensionChip dimension="লাইসেন্স" meta={LICENSE_META[row.license]} />
          <DimensionChip dimension="প্রোভাইডার" meta={PROVIDER_META[row.provider]} />
          <DimensionChip dimension="ইন্টিগ্রেশন" meta={INTEGRATION_META[row.integration]} />
          <DimensionChip dimension="রানটাইম" meta={RUNTIME_META[row.runtime]} />
          {row.lastTestedAt && (
            <span
              className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] leading-relaxed text-muted-foreground"
              title="সর্বশেষ সফল পরীক্ষার তারিখ"
            >
              <CalendarCheck className="size-3 shrink-0" aria-hidden="true" />
              শেষ পরীক্ষা: {formatDateBn(row.lastTestedAt)}
            </span>
          )}
        </div>
      )}

      {/* কারণ / সতর্কতা-নোট */}
      {noteText && (
        <p
          className={cn(
            'flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs leading-relaxed',
            isOff
              ? 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300'
              : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
          )}
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {notePrefix && <span className="font-semibold">{notePrefix}</span>}
            {noteText}
          </span>
        </p>
      )}

      {/* অতিরিক্ত সৎ-স্ট্যাটাস-লাইন (S8-2d — কেবল নির্দিষ্ট মোডে) */}
      {mode.extraNote && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{mode.extraNote}</span>
        </p>
      )}

      {/* বিকল্প-পথ (অফ-মোডে ম্যাট্রিক্সের fallback) */}
      {isOff && row?.fallback && (
        <p className="flex items-start gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-xs leading-relaxed text-emerald-800 dark:text-emerald-300">
          <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">বিকল্প: </span>
            {row.fallback}
          </span>
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
        {isOff ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            এই মোড এই পরিবেশে বন্ধ (লাইসেন্সে নয়) — কারণ ও বিকল্প উপরে; রেজিস্ট্রির ম্যাট্রিক্সে বিস্তারিত।
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

function ModeGrid({
  modes,
  rowByKey,
  onStart,
}: {
  modes: StudioMode[];
  rowByKey: Map<string, AvailabilityMatrixRow>;
  onStart: (draft: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modes.map((mode) => (
        <ModeCard
          key={mode.id}
          mode={mode}
          row={mode.matrixKey ? rowByKey.get(mode.matrixKey) : undefined}
          onStart={onStart}
        />
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// মূল ভিউ
// ------------------------------------------------------------

function StudioViewInner() {
  const setDraft = useChatStore((s) => s.setDraft);
  const focusComposer = useChatStore((s) => s.focusComposer);
  const setActiveView = useUiView((s) => s.setActiveView);

  /** §১১: লাইভ ম্যাট্রিক্স — মোড→ক্ষমতা-সারি ম্যাপ */
  const { data: availability } = useAvailability();
  const rowByKey = useMemo(() => {
    const map = new Map<string, AvailabilityMatrixRow>();
    for (const r of availability?.matrix ?? []) map.set(r.key, r);
    return map;
  }, [availability]);

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
          স্ট্যাটাস-ব্যাজ ও চার-মাত্রিক চিপ লাইভ অ্যাভেইলেবিলিটি ম্যাট্রিক্স থেকে আসে —
          অনুপলব্ধ হলে প্রকৃত কারণ ও বিকল্প-পথসহ।
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
          <ModeGrid modes={AUDIO_MODES} rowByKey={rowByKey} onStart={handleStart} />
        </TabsContent>
        <TabsContent value="video" className="mt-0">
          <ModeGrid modes={VIDEO_MODES} rowByKey={rowByKey} onStart={handleStart} />
        </TabsContent>
        <TabsContent value="film" className="mt-0">
          <ModeGrid modes={FILM_MODES} rowByKey={rowByKey} onStart={handleStart} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** লোকাল QueryClient-প্রভাইডার — useAvailability-এর useQuery-এর জন্য */
export function StudioView() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5 * 60 * 1000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <StudioViewInner />
    </QueryClientProvider>
  );
}
