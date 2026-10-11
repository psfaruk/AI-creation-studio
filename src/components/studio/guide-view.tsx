'use client';

// ============================================================
// GuideView — স্থাপত্য, ব্যবহারবিধি, ফেজ-ম্যাপ, সততার সীমাবদ্ধতা
// ও রোডম্যাপ। স্থাপত্য-চিত্রটি খাঁটি CSS/div দিয়ে (mermaid নয়)।
// ============================================================

import type { ReactNode } from 'react';
import {
  BookOpen,
  CheckCircle2,
  CircleDot,
  Info,
  ListChecks,
  Map as MapIcon,
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
      aria-label="সিস্টেম-স্থাপত্য: চ্যাট UI থেকে Agent Orchestrator, সেখান থেকে Tool Registry ও Creative Job System, তারপর Workers এবং শেষে Storage ও গুণমান-যাচাই"
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
        <DiagramBox title="Tool Registry" desc="৩৮ টুল · zod যাচাই" />
        <DiagramBox title="Creative Job System" desc="নিশ্চিতকরণ → পাইপলাইন → ধাপ-প্রগতি" />
      </div>
      <DiagramArrow />
      <DiagramBox title="Workers" desc="Image gen/edit · TTS · FFmpeg ভিডিও/অডিও" />
      <DiagramArrow />
      <DiagramBox title="Storage + গুণমান যাচাই" desc="ffprobe / astats / ebur128 / sharp" />
    </div>
  );
}

// ------------------------------------------------------------
// ফেজ-ম্যাপ — মাস্টার প্ল্যানের ফেজ বনাম বাস্তবায়ন
// ------------------------------------------------------------

interface PhaseRow {
  phase: string;
  status: string;
  done: boolean;
  note: string;
}

const PHASES: PhaseRow[] = [
  {
    phase: 'Image Studio (§৩)',
    status: 'চালু',
    done: true,
    note: '১২ টুলের ক্যাটালগ — তৈরি, এডিট, ইনপেইন্ট, টাইপোগ্রাফি, রপ্তানি (স্যুট ধাপে ধাপে সম্পূর্ণ)',
  },
  {
    phase: 'Audio Studio (§৪)',
    status: 'ভিত্তি চালু',
    done: true,
    note: 'TTS/ASR মূল টুল চালু; প্রসেসিং/মিক্স/যাচাই সংযোজনাধীন',
  },
  {
    phase: 'Video Studio (§৫)',
    status: 'ভিত্তি চালু',
    done: true,
    note: 'FFmpeg ইঞ্জিন + শট-প্ল্যান/মোশন পদ্ধতি; ডিফিউশন ভিডিও-মডেল নয়',
  },
  {
    phase: 'Film Director (§৬)',
    status: 'চালু',
    done: true,
    note: 'চিত্রনাট্য → দৃশ্য-বিভাজন → স্টোরিবোর্ড → কণ্ঠ → রেন্ডার পাইপলাইন-কাঠামো',
  },
  {
    phase: 'Quality / Security (§৯, §১২)',
    status: 'চালু',
    done: true,
    note: 'গুণমান-যাচাই (ffprobe/astats/ebur128/sharp) + লাইসেন্স-রেজিস্ট্রি + রেট-লিমিট',
  },
];

// ------------------------------------------------------------
// পাঠ্য-সেকশন
// ------------------------------------------------------------

const HOW_IT_WORKS = [
  'চ্যাটে সাধারণ ভাষায় অনুরোধ করুন — এজেন্ট পরিকল্পনা করে প্রয়োজনমতো টুল চালায়।',
  'ছোট কাজ (একটি ছবি, ছোট কণ্ঠ, প্রসেসিং) সরাসরি সেশনেই হয়ে যায়।',
  'বড় কাজ (মিউজিক ভিডিও, শর্টফিল্ম, মোশন ভিডিও, দীর্ঘ ভয়েসওভার) আগে সেটিংস-কার্ডে নিশ্চিত করতে হয়।',
  'নিশ্চিত করার পর ধাপে ধাপে লাইভ অগ্রগতি দেখা যায়; শেষে ফাইল ডাউনলোড ও সংশোধন করা যায়।',
  'সব ফাইল গ্যালারিতে জমা হয়; প্রতিটি প্রোডাকশনের অবস্থা মনিটর ভিউতে থাকে।',
];

const CAPABILITIES = [
  'ছবি: তৈরি, এডিট, ইনপেইন্ট, পটভূমি/বস্তু অপসারণ, রিস্টাইল, আপস্কেল, রং, ক্রপ, বাংলা টাইপোগ্রাফি/পোস্টার, ফরম্যাট রপ্তানি।',
  'অডিও: কণ্ঠ তৈরি (৩ কণ্ঠ), লিপিবদ্ধকরণ, গানের কাঠামো-পরিকল্পনা, ট্রিম/মিক্স/EQ/ফেড, গুণমান যাচাই।',
  'ভিডিও: শট-পরিকল্পনা, স্টোরিবোর্ড+ক্যামেরা-মোশন ভিডিও, ছবি→ভিডিও, সম্পাদনা, সাবটাইটেল, উন্নতকরণ, ফ্রেম-ইন্টারপোলেশন, যাচাই।',
  'ফিল্ম: চিত্রনাট্য → দৃশ্য-বিভাজন → চরিত্র বাইবেল → স্টোরিবোর্ড → সংলাপ/ভয়েসওভার → মোশন ক্লিপ → ধারাবাহিকতা পরীক্ষা → চূড়ান্ত রেন্ডার।',
];

const HONESTY = [
  'ভিডিও তৈরি হয় AI স্টোরিবোর্ড + সিনেম্যাটিক ক্যামেরা-মোশন + FFmpeg অ্যাসেম্বলি দিয়ে — ডিফিউশন ভিডিও-মডেল নয়।',
  'সংগীত-সংশ্লেষণ (MusicGen), গান গাওয়া, স্টেম-পৃথকীকরণ ও লিপ-সিঙ্ক লাইসেন্স-নীতির কারণে এখন বন্ধ — রেজিস্ট্রি ভিউতে কারণ দেখুন।',
  'মিউজিক ভিডিওর জন্য নিজের গান আপলোড করুন; সম্পূর্ণ গান কৃত্রিমভাবে তৈরি করা এখন সম্ভব নয়।',
  'ফটোরিয়ালিস্টিক অভিনয়/নিখুঁত চরিত্র-ধারাবাহিকতার নিশ্চয়তা নেই — ব্যর্থ শট সংশোধন করে আবার চালানো যায়।',
  'ASR বাংলা অডিওতে দুর্বল হতে পারে।',
];

const ROADMAP = [
  'নিজস্ব GPU-তে Wan / CogVideoX ডিফিউশন ভিডিও-জেনারেশন',
  'Real-ESRGAN AI-আপস্কেল — নতুন ডিটেইলসহ ছবি বড় করা',
  'Demucs স্টেম-পৃথকীকরণ (কণ্ঠ/বাদ্য আলাদা করা)',
  'লাইসেন্স-যাচাইকৃত singing মডেল — সম্পূর্ণ গান সংশ্লেষণ',
  'লিপ-সিঙ্ক (ঠোঁট-মিলানো) — লাইসেন্স ও সম্মতি-নীতি মেনে',
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

      {/* ফেজ-ম্যাপ */}
      <SectionCard icon={ListChecks} title="ফেজ-ম্যাপ" titleId="phase-map-title">
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
                      {p.done ? (
                        <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                      ) : (
                        <CircleDot className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
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
