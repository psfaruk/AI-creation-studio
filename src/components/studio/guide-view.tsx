'use client';

// ============================================================
// GuideView — স্থাপত্য, ব্যবহারবিধি, ফেজ-ম্যাপ (নতুন মাস্টার প্ল্যান),
// §৪.৩ Capability Router-টেবিল, §১৪ Definition of Done-এর ১৫ দফা,
// সততার সীমাবদ্ধতা ও রোডম্যাপ। স্থাপত্য-চিত্র খাঁটি CSS/div দিয়ে।
// ============================================================

import type { ReactNode } from 'react';
import {
  BookOpen,
  CheckCircle2,
  CircleDot,
  Info,
  ListChecks,
  Map as MapIcon,
  Route,
  Sparkles,
  Workflow,
} from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// স্থাপত্য-চিত্রের বিল্ডিং ব্লক (খাঁটি div/CSS)
// ------------------------------------------------------------

function DiagramBox({
  title,
  desc,
  strong,
}: {
  title: string;
  desc: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5 text-center shadow-sm',
        strong
          ? 'border-emerald-600/60 bg-emerald-600/10'
          : 'border-emerald-600/35 bg-emerald-600/5',
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</p>
    </div>
  );
}

function DiagramArrow() {
  return (
    <div className="flex justify-center py-0.5" aria-hidden="true">
      <span className="text-lg leading-none text-emerald-600/70 dark:text-emerald-400/70">↓</span>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div
      className="space-y-1.5"
      role="img"
      aria-label="সিস্টেম-স্থাপত্য: চ্যাট UI থেকে Agent Orchestrator, সেখান থেকে Tool Registry ও Creative Job System, তারপর Workers (CogVideoX-3, TTS, FFmpeg, প্রসিডিউরাল ইঞ্জিন) এবং শেষে Storage ও গুণমান-যাচাই"
    >
      <DiagramBox title="ব্যবহারকারী চ্যাট UI" desc="বাংলা চ্যাট · ছবি/অডিও/ভিডিও অ্যাটাচমেন্ট · লাইভ অগ্রগতি" />
      <DiagramArrow />
      <DiagramBox
        strong
        title="Agent Orchestrator"
        desc="intent → পরিকল্পনা → টুল-কল JSON প্রোটোকল"
      />
      <DiagramArrow />
      {/* মাঝের স্তর: মোবাইলে স্ট্যাক, sm+ এ পাশাপাশি */}
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-2">
        <DiagramBox title="Tool Registry" desc="৪১ টুল · zod যাচাই" />
        <DiagramBox title="Creative Job System" desc="নিশ্চিতকরণ → পাইপলাইন → ধাপ-প্রগতি" />
      </div>
      <DiagramArrow />
      <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-2">
        <DiagramBox title="ক্লাউড-মডেল Workers" desc="CogVideoX-3 ভিডিও (t2v+i2v) · ছবি-জেন · LLM · TTS · ASR · VLM" />
        <DiagramBox title="লোকাল Workers" desc="FFmpeg সম্পাদনা · প্রসিডিউরাল মিউজিক · সাউন্ড-ডিজাইন · sharp" />
      </div>
      <DiagramArrow />
      <DiagramBox title="Storage + গুণমান যাচাই" desc="ffprobe / astats / ebur128 / sharp / VLM ধারাবাহিকতা" />
    </div>
  );
}

// ------------------------------------------------------------
// ফেজ-ম্যাপ — নতুন মাস্টার প্ল্যানের ৮ ফেজ বনাম বাস্তবায়ন
// ------------------------------------------------------------

type PhaseState = 'done' | 'blocked-honest';

interface PhaseRow {
  phase: string;
  status: string;
  state: PhaseState;
  note: string;
}

const PHASES: PhaseRow[] = [
  {
    phase: 'Phase 1 — অডিট',
    status: 'সম্পন্ন',
    state: 'done',
    note: 'হার্ডওয়্যার ২ কোর / ৪GB RAM / GPU নেই; CogVideoX-3 ভিডিও-মডেল আবিষ্কার (t2v প্রোব: ৫ সে. → প্রকৃত MP4); TTS ৭-কণ্ঠ ভাষা-প্রোব — কোনো কণ্ঠই বাংলা-প্রশিক্ষিত নয়',
  },
  {
    phase: 'Phase 2 — ভাষা-নিয়ন্ত্রক (§২)',
    status: 'চালু',
    state: 'done',
    note: 'ভাষা শনাক্তকরণ → কণ্ঠ-নির্বাচন → TTS → দৈর্ঘ্য-যাচাই → ASR ব্যাক-চেক → রায় pass/warn/fail; বাংলায় রায় সবসময় "সতর্কতা" + মানব-প্রিভিউ',
  },
  {
    phase: 'Phase 3 — মিউজিক-ইঞ্জিন (§৩)',
    status: 'চালু (পরীক্ষামূলক-সৎ)',
    state: 'done',
    note: '৬ মুড × স্কেল/কর্ড/ছন্দ-সচেতন প্রসিডিউরাল সংশ্লেষণ + বিট-মার্কার — সৎ-লেবেল: "নিউরাল মিউজিক-মডেল নয়"',
  },
  {
    phase: 'Phase 4 — রিয়েল AI ভিডিও (§৪)',
    status: 'চালু',
    state: 'done',
    note: 'CogVideoX-3 ক্লাউড-ডিফিউশন t2v + i2v (ছবি data-URL গ্রহণ করে); ৪২৯-রেট-সীমায় ধৈর্যশীল ৬০ সে. ব্যাকঅফ; Capability Router (§৪.৩) প্রম্পট+UI উভয়ে বাধ্যতামূলক',
  },
  {
    phase: 'Phase 5 — লিপ-সিঙ্ক (§৫)',
    status: 'অনুপলব্ধ-সৎ',
    state: 'blocked-honest',
    note: '৭-ধাপ ওয়ার্কফ্লো ও সম্মতি-নীতি প্রস্তুত, কিন্তু মডেল স্থাপিত নেই — বাধা হার্ডওয়্যার/API/ইন্টিগ্রেশনের (লাইসেন্সে নয়); লিপ-সিঙ্ক ছাড়া কখনো "ঠোঁট নড়ছে" দাবি করা হয় না',
  },
  {
    phase: 'Phase 6 — মিউজিক ভিডিও (§৬)',
    status: 'চালু',
    state: 'done',
    note: 'আপলোড করা গানের এনার্জি-বিট-শনাক্তকরণ (§৬.১) → বিট-সমলয় কাট; গান না থাকলে প্রসিডিউরাল স্কোর',
  },
  {
    phase: 'Phase 7 — ফিল্ম ডিরেক্টর (§৬D)',
    status: 'চালু',
    state: 'done',
    note: '৮-স্তর পাইপলাইন: চিত্রনাট্য → দৃশ্য-বিভাজন → চরিত্র-বাইবেল → অভিনয়-পরিকল্পনা → AI শট → সাউন্ড-ডিজাইন → ধারাবাহিকতা → ফাইনাল মিক্স',
  },
  {
    phase: 'Phase 8 — হার্ডেনিং (§১২)',
    status: 'চালু',
    state: 'done',
    note: 'রেট-লিমিট (চ্যাট ১৫/মি., কনফার্ম ১২/ঘণ্টা) + দৈনিক কোটা (৪০/দিন) + মডেল-রেজিস্ট্রি + /api/system স্বাস্থ্য-চেক + কনকারেন্সি-সীমা',
  },
];

// ------------------------------------------------------------
// §৪.৩ Capability Router — ৮ সারির টেবিল (নতুন: ভিডিওর সাথে নেটিভ অডিও)
// ------------------------------------------------------------

interface RouterRow {
  request: string;
  tool: string;
  engine: string;
  status: 'ready' | 'experimental' | 'unavailable';
}

const ROUTER_ROWS: RouterRow[] = [
  {
    request: 'ছবি থেকে ভিডিও',
    tool: 'image_to_video',
    engine: 'CogVideoX-3 image-to-video (ক্লাউড ডিফিউশন)',
    status: 'ready',
  },
  {
    request: 'নতুন দৃশ্য তৈরি',
    tool: 'generate_video',
    engine: 'CogVideoX-3 text-to-video (ক্লাউড ডিফিউশন)',
    status: 'ready',
  },
  {
    request: 'চরিত্রের শরীর নড়ানো',
    tool: 'generate_video (অভিনয়-নির্দেশিত প্রম্পট)',
    engine: 'CogVideoX-3 (ক্যারেক্টার-মোশন প্রম্পট সহ)',
    status: 'experimental',
  },
  {
    request: 'ভিডিওর সাথে নেটিভ অডিও',
    tool: 'generate_video (withAudio)',
    engine: 'CogVideoX-3 with_audio (ক্লাউড)',
    status: 'ready',
  },
  {
    request: 'কথা বলার ঠোঁট মেলানো',
    tool: 'lip_sync',
    engine: 'লিপ-সিঙ্ক মডেল নেই (এই পরিবেশে স্থাপিত নয়)',
    status: 'unavailable',
  },
  {
    request: 'দৃশ্য জোড়া ও কাট',
    tool: 'process_video',
    engine: 'FFmpeg (সম্পাদনা — জেনারেশন নয়)',
    status: 'ready',
  },
  {
    request: 'রং, স্থিতিশীলতা, সাবটাইটেল',
    tool: 'enhance_video / generate_subtitles',
    engine: 'FFmpeg ফিল্টার + LLM সাবটাইটেল',
    status: 'ready',
  },
  {
    request: 'একাধিক দৃশ্যের চলচ্চিত্র',
    tool: 'propose_job (short_film পাইপলাইন)',
    engine: '৮-স্টেজ ফিল্ম প্রোডাকশন পাইপলাইন',
    status: 'ready',
  },
];

const ROUTER_STATUS_META: Record<RouterRow['status'], { label: string; className: string }> = {
  ready: { label: 'চালু', className: 'text-emerald-700 dark:text-emerald-400' },
  experimental: { label: 'পরীক্ষামূলক', className: 'text-amber-700 dark:text-amber-400' },
  unavailable: { label: 'অনুপলব্ধ', className: 'text-stone-600 dark:text-stone-300' },
};

// ------------------------------------------------------------
// §১৪ Definition of Done — ১৫ দফার সৎ অবস্থা
// (অনুপলব্ধ মানে লাইসেন্স-বাধা নয় — কারণ হার্ডওয়্যার/API/ইন্টিগ্রেশন)
// ------------------------------------------------------------

type DodStatus = 'active' | 'experimental' | 'unavailable';

interface DodRow {
  item: string;
  status: DodStatus;
}

const DOD_ROWS: DodRow[] = [
  { item: 'বাংলা-প্রথম চ্যাট UI + সংযুক্তি + লাইন অগ্রগতি', status: 'active' },
  { item: 'টুল রেজিস্ট্রি — ৪১ টুল, zod-যাচাইকৃত ইনপুট', status: 'active' },
  { item: 'ছবি স্টুডিও — ১২ টুল (তৈরি থেকে রপ্তানি)', status: 'active' },
  { item: 'TTS কণ্ঠ তৈরি — সব ভাষায় প্রকৃত AI', status: 'active' },
  { item: 'বাংলা ভয়েসওভার — ভাষা-যাচাই + ASR ব্যাক-চেক (রায় সবসময় "সতর্কতা")', status: 'active' },
  { item: 'ইনস্ট্রুমেন্টাল মিউজিক — প্রসিডিউরাল, নিউরাল-মডেল নয়', status: 'experimental' },
  { item: 'পূর্ণ গান (কণ্ঠসংগীতসহ) সংশ্লেষণ — বাধা: GPU/API (লাইসেন্স নয়)', status: 'unavailable' },
  { item: 'রিয়েল AI ভিডিও — CogVideoX-3 t2v', status: 'active' },
  { item: 'ছবি → রিয়েল AI ভিডিও — CogVideoX-3 i2v', status: 'active' },
  { item: 'চরিত্র-অ্যানিমেশন — মোশন-প্রম্পট-ভিত্তিক, ফলাফল পরিবর্তনশীল', status: 'experimental' },
  { item: 'লিপ-সিঙ্ক / কথা-বলা চরিত্র — বাধা: GPU/API/ইন্টিগ্রেশন (লাইসেন্স নয়)', status: 'unavailable' },
  { item: 'মিউজিক ভিডিও — গান-সমলয় বিট-মার্কার কাট', status: 'active' },
  { item: 'শর্টফিল্ম — ৮-স্তর পাইপলাইন + চরিত্র-ধারাবাহিকতা + সাবটাইটেল', status: 'active' },
  { item: 'গুণমান-যাচাই — ffprobe / astats / ebur128 / VLM', status: 'active' },
  { item: 'সততা-নীতি — অনুপলব্ধ ক্ষমতা কখনো লুকানো হয় না (রেজিস্ট্রি + স্টুডিও-ব্যাজ + অ্যাভেইলেবিলিটি ম্যাট্রিক্স)', status: 'active' },
];

const DOD_STATUS_META: Record<DodStatus, { label: string; className: string }> = {
  active: { label: 'চালু', className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' },
  experimental: { label: 'পরীক্ষামূলক', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  unavailable: { label: 'অনুপলব্ধ', className: 'border-stone-400/50 bg-stone-400/15 text-stone-600 dark:text-stone-300' },
};

// ------------------------------------------------------------
// পাঠ্য-সেকশন
// ------------------------------------------------------------

const HOW_IT_WORKS = [
  'চ্যাটে সাধারণ ভাষায় অনুরোধ করুন — এজেন্ট পরিকল্পনা করে প্রয়োজনমতো টুল চালায়।',
  'ছোট কাজ (একটি ছবি, ছোট কণ্ঠ, প্রসেসিং) সরাসরি সেশনেই হয়ে যায়।',
  'বড় কাজ (মিউজিক ভিডিও, শর্টফিল্ম, মোশন ভিডিও, দীর্ঘ ভয়েসওভার) আগে সেটিংস-কার্ডে নিশ্চিত করতে হয়।',
  'নিশ্চিত করার পর ধাপে ধাপে লাইভ অগ্রগতি দেখা যায়; শেষে ফাইল ডাউনলোড ও সংশোধন করা যায়।',
  '"স্টুডিও" ভিউ থেকে তৈরির মোড বেছে নিলে প্রস্তুত নির্দেশনা সরাসরি চ্যাটে বসে যায়।',
  'সব ফাইল গ্যালারিতে জমা হয়; প্রতিটি প্রোডাকশনের অবস্থা মনিটর ভিউতে থাকে।',
];

const CAPABILITIES = [
  'ছবি: তৈরি, এডিট, ইনপেইন্ট, পটভূমি/বস্তু অপসারণ, রিস্টাইল, আপস্কেল, রং, ক্রপ, বাংলা টাইপোগ্রাফি/পোস্টার, ফরম্যাট রপ্তানি।',
  'অডিও: কণ্ঠ তৈরি (৭ কণ্ঠ, ভাষা-নিয়ন্ত্রকসহ যাচাই), লিপিবদ্ধকরণ, ইনস্ট্রুমেন্টাল (প্রসিডিউরাল), ট্রিম/মিক্স/EQ/ফেড, গুণমান যাচাই।',
  'ভিডিও: রিয়েল AI ভিডিও (CogVideoX-3 t2v/i2v), নেটিভ AI-অডিওসহ ভিডিও (with_audio), শট-পরিকল্পনা, সম্পাদনা, সাবটাইটেল, উন্নতকরণ, ফ্রেম-ইন্টারপোলেশন, যাচাই।',
  'ফিল্ম: চিত্রনাট্য → দৃশ্য-বিভাজন → চরিত্র বাইবেল → অভিনয়-পরিকল্পনা → AI শট → সাউন্ড-ডিজাইন → ধারাবাহিকতা → চূড়ান্ত রেন্ডার।',
];

const HONESTY = [
  'রিয়েল AI ভিডিও ক্লাউড-ডিফিউশনে (CogVideoX-3) হয় — প্রতি শটে ২–৪ মিনিট এবং রেট-সীমায় অপেক্ষা বাড়তে পারে; ধৈর্য নিয়ে অপেক্ষা করুন।',
  'কোনো TTS কণ্ঠই বাংলা-প্রশিক্ষিত নয় — বাংলা পাঠের রায় সবসময় "সতর্কতা"; প্রিভিউ শুনে যাচাই করুন।',
  'ইনস্ট্রুমেন্টাল মিউজিক প্রসিডিউরাল সংশ্লেষণ — নিউরাল মিউজিক-মডেল নয়।',
  'গান-গাওয়া মডেল ও লিপ-সিঙ্ক মডেল এই পরিবেশে নেই (বাধা: হার্ডওয়্যার/API/ইন্টিগ্রেশন — লাইসেন্সে নয়) — এমন অনুরোধ করলে সৎভাবে জানানো হয়, মিথ্যা প্রতিশ্রুতি দেওয়া হয় না।',
  'মিউজিক ভিডিওর জন্য নিজের গান আপলোড করা ভালো; গান ছাড়া হলে প্রসিডিউরাল স্কোর বসে।',
  'ফটোরিয়ালিস্টিক অভিনয়/নিখুঁত চরিত্র-ধারাবাহিকতার নিশ্চয়তা নেই — ব্যর্থ শট সংশোধন করে আবার চালানো যায়।',
  'ASR বাংলা অডিওতে দুর্বল — বাংলা ভয়েসওভারের যাচাই-রায় মূলত দৈর্ঘ্য ও ইংরেজি-রাউন্ড-ট্রিপের ওপর নির্ভরশীল।',
];

const ROADMAP = [
  'স্ব-হোস্টেড GPU-তে Wan / CogVideoX — রেট-সীমা ছাড়া নিজের যন্ত্রে ডিফিউশন',
  'Real-ESRGAN AI-আপস্কেল — নতুন ডিটেইলসহ ছবি বড় করা',
  'Demucs স্টেম-পৃথকীকরণ (কণ্ঠ/বাদ্য আলাদা করা)',
  'লাইসেন্স-যাচাইকৃত singing মডেল — সম্পূর্ণ গান সংশ্লেষণ',
  'লিপ-সিঙ্ক (MuseTalk-প্রার্থী) — লাইসেন্স ও সম্মতি-নীতি মেনে',
  'বাংলা-শক্ত ASR মডেল — ভয়েসওভার-যাচাই আরও নির্ভরযোগ্য করা',
];

// ------------------------------------------------------------
// সেকশন-কার্ড ও বুলেট-তালিকা
// ------------------------------------------------------------

function SectionCard({
  icon: Icon,
  title,
  titleId,
  children,
}: {
  icon: typeof Info;
  title: string;
  titleId: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card px-4 py-4 shadow-sm" aria-labelledby={titleId}>
      <h2 id={titleId} className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-inside list-disc space-y-1.5 text-sm leading-relaxed text-muted-foreground">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function GuideView() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          গাইড ও স্থাপত্য
        </h1>
        <p className="text-sm text-muted-foreground">Agentic AI Creative Studio — ব্যবহারবিধি ও সততার সীমা</p>
      </header>

      <SectionCard icon={Info} title="কীভাবে কাজ করে" titleId="how-it-works-title">
        <BulletList items={HOW_IT_WORKS} />
      </SectionCard>

      {/* স্থাপত্য-চিত্র */}
      <SectionCard icon={Workflow} title="স্থাপত্য" titleId="architecture-title">
        <ArchitectureDiagram />
      </SectionCard>

      <SectionCard icon={Sparkles} title="স্টুডিও ক্ষমতা" titleId="capabilities-title">
        <BulletList items={CAPABILITIES} />
      </SectionCard>

      {/* ফেজ-ম্যাপ (নতুন মাস্টার প্ল্যান — ৮ ফেজ) */}
      <SectionCard icon={ListChecks} title="ফেজ-ম্যাপ — ৮ ফেজ" titleId="phase-map-title">
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-10 text-xs">ফেজ</TableHead>
                <TableHead className="h-10 text-xs">অবস্থা</TableHead>
                <TableHead className="h-10 text-xs">নোট</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PHASES.map(p => (
                <TableRow key={p.phase}>
                  <TableCell className="py-2.5 text-xs font-medium">{p.phase}</TableCell>
                  <TableCell className="py-2.5 text-xs">
                    <span className="inline-flex items-center gap-1">
                      {p.state === 'done' ? (
                        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <CircleDot className="size-3.5 text-stone-500 dark:text-stone-400" aria-hidden="true" />
                      )}
                      {p.status}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 text-xs leading-relaxed text-muted-foreground">{p.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      {/* §৪.৩ Capability Router */}
      <SectionCard icon={Route} title="Capability Router (§৪.৩) — কে কী করবে" titleId="router-title">
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
          অনুরোধের ধরন অনুযায়ী সঠিক ইঞ্জিন বাছাই বাধ্যতামূলক — FFmpeg-কে কখনো AI
          ভিডিও-মডেল হিসেবে দেখানো হয় না।
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-10 text-xs whitespace-nowrap">অনুরোধ</TableHead>
                <TableHead className="h-10 text-xs whitespace-nowrap">টুল</TableHead>
                <TableHead className="h-10 text-xs whitespace-nowrap">ইঞ্জিন</TableHead>
                <TableHead className="h-10 text-xs whitespace-nowrap">স্ট্যাটাস</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ROUTER_ROWS.map(row => {
                const meta = ROUTER_STATUS_META[row.status];
                return (
                  <TableRow key={row.request}>
                    <TableCell className="py-2.5 text-xs font-medium">{row.request}</TableCell>
                    <TableCell className="py-2.5 text-xs">{row.tool}</TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">{row.engine}</TableCell>
                    <TableCell className={cn('py-2.5 text-xs font-medium whitespace-nowrap', meta.className)}>
                      {meta.label}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </SectionCard>

      {/* §১৪ Definition of Done */}
      <SectionCard icon={ListChecks} title="Definition of Done (§১৪) — ১৫ দফার সৎ অবস্থা" titleId="dod-title">
        <ul className="space-y-1.5">
          {DOD_ROWS.map((row, i) => {
            const meta = DOD_STATUS_META[row.status];
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm leading-relaxed">
                <span className="min-w-0 flex-1">
                  <span className="mr-1 text-muted-foreground">{i + 1}.</span>
                  {row.item}
                </span>
                <span
                  className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                    meta.className,
                  )}
                >
                  {meta.label}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          লাইসেন্স-কারণে অবরুদ্ধ মডেল নেই — “অনুপলব্ধ” ক্ষমতাগুলোর প্রকৃত কারণ হার্ডওয়্যার/API/ইন্টিগ্রেশন।
          প্রতিটি ক্ষমতার চার-মাত্রিক রায় (লাইসেন্স · প্রোভাইডার · ইন্টিগ্রেশন · রানটাইম) রেজিস্ট্রি ভিউয়ের
          “অ্যাভেইলেবিলিটি ম্যাট্রিক্স”-এ দেখুন।
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          পাঁচ-মাত্রার স্ট্যাটাস (লাইসেন্স/প্রোভাইডার/ইন্টিগ্রেশন/রানটাইম/গুণমান) + বাংলা TTS
          বেঞ্চমার্ক-ল্যাব (রেজিস্ট্রি ভিউ)।
        </p>
      </SectionCard>

      {/* সততার সীমাবদ্ধতা */}
      <SectionCard icon={Info} title="সততার সীমাবদ্ধতা" titleId="honesty-title">
        <BulletList items={HONESTY} />
      </SectionCard>

      {/* রোডম্যাপ */}
      <SectionCard icon={MapIcon} title="রোডম্যাপ" titleId="roadmap-title">
        <BulletList items={ROADMAP} />
      </SectionCard>
    </div>
  );
}
