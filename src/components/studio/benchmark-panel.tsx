'use client';

// ============================================================
// BenchmarkPanel — বাংলা TTS মান-যাচাই ল্যাব
// (নতুন পরিকল্পনা §৪ — তৃতীয় ধাপ)। /api/benchmark/tts।
//
// - স্থায়ী সৎ-ব্যানার: কোনো কণ্ঠই বাংলা-প্রশিন্নত নয় — মানব-শ্রবণ
//   ছাড়া "যাচাইকৃত" দাবি করা হয় না।
// - নিয়ন্ত্রণ: দ্রুত প্রোব (৮ বাক্য) / পূর্ণ বেঞ্চমার্ক (৬০ বাক্য) +
//   চলমান রানে অগ্রগতি-বার ও বাতিল।
// - ফলাফল-সারণি: ৬ শ্রেণির বাক্য × কণ্ঠ × রায় (পাস/সতর্কতা/ব্যর্থ/
//   স্কিপ/ত্রুটি) × দৈর্ঘ্য × নীরবতা × শোনার-প্লেয়ার; সারি-চাপে
//   বিস্তারিত (মূল+নর্মালাইজড বাক্য, নোট, ASR-উপদেশ)।
//
// রঙ-চুক্তি: emerald=পাস, amber=সতর্কতা/যাচাই-বাকি, stone=স্কিপ,
// red=ব্যর্থ/ত্রুটি (blue/indigo নিষিদ্ধ)।
// ============================================================

import { useState } from 'react';
import {
  AlertCircle,
  Ban,
  ChevronDown,
  FlaskConical,
  Info,
  ListChecks,
  Loader2,
  RefreshCcw,
  TriangleAlert,
  Zap,
} from 'lucide-react';

import { relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';
import { withStudioToken } from '@/components/auth/security-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBenchmark, type BenchmarkScope } from '@/hooks/use-benchmark';
import type { BnBenchmarkCategory, TtsBenchmarkReport, TtsBenchmarkSentenceResult } from '@/lib/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// লেবেল ও রঙ-ম্যাপ
// ------------------------------------------------------------

const EMERALD = 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400';
const AMBER = 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400';
const STONE = 'border-stone-400/50 bg-stone-400/10 text-stone-600 dark:text-stone-300';
const RED = 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400';

/** ৬টি বেঞ্চমার্ক-শ্রেণির বাংলা লেবেল */
const CATEGORY_LABEL: Record<BnBenchmarkCategory, string> = {
  conversation: 'কথোপকথন',
  dramatic: 'নাটকীয়',
  emotion: 'আবেগ',
  mixed_bn_en: 'বাংলা-ইংরেজি',
  numbers_dates: 'সংখ্যা/তারিখ',
  long_reading: 'গল্পপাঠ',
};

/** রানটাইম-সুরক্ষা: চুক্তির বাইরের শ্রেণি এলে মূল স্ট্রিংই দেখাও */
function categoryLabel(category: string): string {
  return (CATEGORY_LABEL as Record<string, string | undefined>)[category] ?? category;
}

/** প্রতি-বাক্যের রায় → ব্যাজ */
const RESULT_STATUS_META: Record<
  TtsBenchmarkSentenceResult['status'],
  { label: string; className: string }
> = {
  pass: { label: 'পাস', className: EMERALD },
  warn: { label: 'সতর্কতা', className: AMBER },
  fail: { label: 'ব্যর্থ', className: RED },
  skipped_rate_limited: { label: 'স্কিপ (রেট-লিমিট)', className: STONE },
  error: { label: 'ত্রুটি', className: RED },
};

function resultStatusMeta(status: string): { label: string; className: string } {
  return (
    (RESULT_STATUS_META as Record<string, { label: string; className: string } | undefined>)[status] ?? {
      label: status,
      className: STONE,
    }
  );
}

/** রিপোর্টের সামগ্রিক অবস্থা → ব্যাজ */
const REPORT_STATUS_META: Record<TtsBenchmarkReport['status'], { label: string; className: string }> = {
  running: { label: 'চলছে', className: AMBER },
  completed: { label: 'সম্পন্ন', className: EMERALD },
  failed: { label: 'ব্যর্থ', className: RED },
  cancelled: { label: 'বাতিল', className: STONE },
};

function reportStatusMeta(status: string): { label: string; className: string } {
  return (
    (REPORT_STATUS_META as Record<string, { label: string; className: string } | undefined>)[status] ?? {
      label: status,
      className: STONE,
    }
  );
}

const SCOPE_LABEL: Record<BenchmarkScope, string> = {
  quick: 'দ্রুত প্রোব',
  full: 'পূর্ণ বেঞ্চমার্ক',
};

/** পাতলা স্ক্রলবারের স্টাইল (রেজিস্ট্রি-ভিউয়ের ম্যাট্রিক্স-তালিকার মতো) */
const THIN_SCROLLBAR =
  'pr-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent';

// ------------------------------------------------------------
// ফলাফল-সারণির একটি (প্রসারণযোগ্য) সারি
// ------------------------------------------------------------

function ResultRow({
  index,
  result,
  rowId,
  expanded,
  onToggle,
}: {
  index: number;
  result: TtsBenchmarkSentenceResult;
  rowId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusMeta = resultStatusMeta(result.status);
  const duration = result.checks?.durationSec;
  const silenceRatio = result.checks?.silenceRatio;
  const notes = Array.isArray(result.notes) ? result.notes : [];

  return (
    <>
      <TableRow
        onClick={onToggle}
        className="cursor-pointer select-none"
        aria-expanded={expanded}
        aria-label={`বাক্য ${index + 1} — বিস্তারিত দেখতে চাপ করুন`}
      >
        <TableCell className="px-2 py-2 text-xs tabular-nums text-muted-foreground">
          {toBnDigits(index + 1)}
        </TableCell>
        <TableCell className="px-2 py-2">
          <Badge
            variant="outline"
            className="h-auto px-2 py-0.5 text-[10px] leading-snug whitespace-nowrap border-muted bg-muted/60 text-muted-foreground"
          >
            {categoryLabel(result.category)}
          </Badge>
        </TableCell>
        <TableCell className="max-w-[15rem] px-2 py-2 text-xs">
          <span className="block truncate leading-relaxed" title={result.text}>
            {result.text}
          </span>
        </TableCell>
        <TableCell className="px-2 py-2 text-xs whitespace-nowrap" title={result.voice}>
          {result.voice}
        </TableCell>
        <TableCell className="px-2 py-2">
          <Badge
            variant="outline"
            className={cn('h-auto px-2 py-0.5 text-[10px] leading-snug whitespace-nowrap', statusMeta.className)}
          >
            {statusMeta.label}
          </Badge>
        </TableCell>
        <TableCell className="px-2 py-2 text-xs tabular-nums whitespace-nowrap">
          {typeof duration === 'number' ? toBnDigits(duration.toFixed(1)) : '—'}
        </TableCell>
        <TableCell className="px-2 py-2 text-xs tabular-nums whitespace-nowrap">
          {typeof silenceRatio === 'number' ? toBnDigits(Math.round(silenceRatio * 100)) : '—'}
        </TableCell>
        {/* শোনা-সেল: প্লেয়ারে চাপলে সারি-টগল যেন না হয় */}
        <TableCell className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
          {result.audioUrl ? (
            <audio controls src={withStudioToken(result.audioUrl)} className="h-8" preload="none">
              <a href={withStudioToken(result.audioUrl)} className="text-xs underline">
                অডিও
              </a>
            </audio>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
      </TableRow>

      {expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="bg-muted/30 px-3 py-3 whitespace-normal">
            <dl className="space-y-2 text-xs leading-relaxed">
              <div>
                <dt className="font-medium text-muted-foreground">মূল বাক্য:</dt>
                <dd className="mt-0.5">{result.text}</dd>
              </div>
              {result.normalizedText && result.normalizedText !== result.text && (
                <div>
                  <dt className="font-medium text-muted-foreground">নর্মালাইজকৃত রূপ (TTS-এ পাঠানো):</dt>
                  <dd className="mt-0.5">{result.normalizedText}</dd>
                </div>
              )}
              {notes.length > 0 && (
                <div>
                  <dt className="font-medium text-muted-foreground">নোট:</dt>
                  <dd className="mt-0.5">
                    <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                      {notes.map((note, j) => (
                        <li key={`${rowId}-note-${j}`}>{note}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              {result.asr?.transcript && (
                <div>
                  <dt className="font-medium text-muted-foreground">ASR-ট্রান্সক্রিপ্ট:</dt>
                  <dd className="mt-0.5">{result.asr.transcript}</dd>
                  <dd className="mt-0.5 text-amber-700 dark:text-amber-400">
                    ASR-উপদেশ মাত্র — বাংলা ASR দুর্বল
                  </dd>
                </div>
              )}
            </dl>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ------------------------------------------------------------
// মূল প্যানেল
// ------------------------------------------------------------

export function BenchmarkPanel() {
  const { current, latest, starting, loading, error, start, cancel, refresh } = useBenchmark();
  const [startError, setStartError] = useState<string | null>(null);
  const [pendingScope, setPendingScope] = useState<BenchmarkScope | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const running = current?.status === 'running';
  /** প্রদর্শনীয় রিপোর্ট: চলমান/সাম্প্রতিক রান অগ্রাধিকার পায় */
  const report: TtsBenchmarkReport | null = current ?? latest;
  /** সারসংক্ষেপ-কার্ড চলমান রানের পুরনো রানের থেকে নয় — শেষ হওয়া রান থেকে */
  const completedReport = current && current.status !== 'running' ? current : latest;
  const completedStatus = completedReport ? reportStatusMeta(completedReport.status) : null;

  const results = Array.isArray(report?.results) ? (report?.results as TtsBenchmarkSentenceResult[]) : [];

  const done = current?.progress?.done ?? 0;
  const total = current?.progress?.total ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const lastCategory = results.length > 0 ? results[results.length - 1]?.category : undefined;

  const handleStart = async (scope: BenchmarkScope) => {
    setStartError(null);
    setPendingScope(scope);
    try {
      const message = await start(scope);
      if (message) setStartError(message);
    } finally {
      setPendingScope(null);
    }
  };

  const handleCancel = async () => {
    setStartError(null);
    await cancel();
  };

  const handleRefresh = () => {
    setStartError(null);
    void refresh();
  };

  // প্রাথমিক লোডিং — কঙ্কাল-স্টেট
  if (loading && !current && !latest) {
    return (
      <section
        className="rounded-xl border bg-card px-4 py-4 shadow-sm"
        aria-busy="true"
        aria-labelledby="benchmark-panel-title"
      >
        <p id="benchmark-panel-title" className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FlaskConical className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          বাংলা TTS মান-যাচাই ল্যাব (৬০ বাক্যের বেঞ্চমার্ক)
        </p>
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="mt-3 h-11 w-2/3 rounded-lg" />
        <Skeleton className="mt-3 h-24 rounded-lg" />
      </section>
    );
  }

  // এরর-স্টেট কার্ড-ভাঙা নয় — প্যানেল-শেল (শিরোনাম + ব্যানার + নিয়ন্ত্রণ)
  // সবসময় দৃশ্যমান থাকে; নিচে ইনলাইন এরর + পুনঃচেষ্টা দেখানো হয়

  return (
    <section className="rounded-xl border bg-card px-4 py-4 shadow-sm" aria-labelledby="benchmark-panel-title">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 id="benchmark-panel-title" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <FlaskConical className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          বাংলা TTS মান-যাচাই ল্যাব (৬০ বাক্যের বেঞ্চমার্ক)
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={handleRefresh}
          disabled={loading}
          title="সর্বশেষ স্থিতি আবার আনুন"
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCcw className="size-4" aria-hidden="true" />
          )}
          রিফ্রেশ
        </Button>
      </div>

      {/* স্থায়ী সৎ-ব্যানার — মানব-শ্রবণ বাধ্যতামূলক */}
      <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          কোনো কণ্ঠই বাংলা-প্রশিন্নত নয় — এই ল্যাব যন্ত্র-পরীক্ষা চালায় (দৈর্ঘ্য/নীরবতা/ক্লিপিং + সীমিত
          ASR-উপদেশ)। "যাচাইকৃত" বলার আগে মানব-শ্রবণ বাধ্যতামূলক।
        </span>
      </p>

      {/* নিয়ন্ত্রণ */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="বেঞ্চমার্ক নিয়ন্ত্রণ">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
          onClick={() => void handleStart('quick')}
          disabled={running || starting}
        >
          {pendingScope === 'quick' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Zap className="size-4" aria-hidden="true" />
          )}
          দ্রুত প্রোব (৮ বাক্য)
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
          onClick={() => void handleStart('full')}
          disabled={running || starting}
        >
          {pendingScope === 'full' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ListChecks className="size-4" aria-hidden="true" />
          )}
          পূর্ণ বেঞ্চমার্ক (৬০ বাক্য)
        </Button>
        {running && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
            onClick={() => void handleCancel()}
          >
            <Ban className="size-4" aria-hidden="true" />
            বাতিল করুন
          </Button>
        )}
      </div>
      <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        TTS API-র রেট-লিমিটে কিছু বাক্য "স্কিপ" হতে পারে — সেটি সাময়িক, পরে আবার চালান।
      </p>

      {/* শুরু-ব্যর্থতা / স্টেট-এরর (ডেটাসহ) — ইনলাইন */}
      {(startError || (error && (current || latest))) && (
        <p className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          <span className="flex min-w-0 items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {startError ?? error}
          </span>
          {!startError && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 min-h-8 px-2.5"
              onClick={handleRefresh}
            >
              <RefreshCcw className="size-3.5" aria-hidden="true" />
              আবার
            </Button>
          )}
        </p>
      )}

      {/* চলমান রানের অগ্রগতি */}
      {running && current && (
        <div
          className="mt-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2.5"
          aria-live="polite"
          aria-label="বেঞ্চমার্ক অগ্রগতি"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium">
            <span className="flex flex-wrap items-center gap-1.5">
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-emerald-700 dark:text-emerald-400"
                aria-hidden="true"
              />
              চলছে: {toBnDigits(done)}/{toBnDigits(total)} বাক্য
              {lastCategory && <> · এই মুহূর্তে: {categoryLabel(lastCategory)}</>}
            </span>
            <span className="tabular-nums text-muted-foreground">{toBnDigits(percent)}%</span>
          </div>
          <Progress
            value={percent}
            className="mt-2 h-2 [&_[data-slot=progress-indicator]]:bg-emerald-600"
            aria-label={`${toBnDigits(percent)}% সম্পন্ন`}
          />
        </div>
      )}

      {/* চলমান রান ব্যর্থ/বাতিল হলে সৎ নোট (সারসংক্ষেপ-বিহীন) */}
      {current && current.status !== 'running' && !current.summary && (
        <p
          className={cn(
            'mt-3 flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs leading-relaxed',
            current.status === 'failed'
              ? 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400'
              : 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300',
          )}
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          সর্বশেষ রান {reportStatusMeta(current.status).label} — সারসংক্ষেপ নেই; নিচের ফলাফল আংশিক হতে পারে।
        </p>
      )}

      {/* সারসংক্ষেপ-কার্ড (শেষ হওয়া রান) */}
      {completedReport?.summary && (
        <div className="mt-3 rounded-lg border px-3 py-2.5" aria-label="বেঞ্চমার্ক সারসংক্ষেপ">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="h-auto px-2 py-0.5 text-[11px] leading-snug border-muted bg-muted/60 text-muted-foreground"
            >
              {SCOPE_LABEL[completedReport.scope] ?? completedReport.scope}
            </Badge>
            {completedStatus && (
              <Badge
                variant="outline"
                className={cn('h-auto px-2 py-0.5 text-[11px] leading-snug', completedStatus.className)}
              >
                {completedStatus.label}
              </Badge>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium">
            <span className={cn('rounded-full border px-2.5 py-0.5 tabular-nums', EMERALD)}>
              পাস {toBnDigits(completedReport.summary.pass)}
            </span>
            <span className={cn('rounded-full border px-2.5 py-0.5 tabular-nums', AMBER)}>
              সতর্কতা {toBnDigits(completedReport.summary.warn)}
            </span>
            <span className={cn('rounded-full border px-2.5 py-0.5 tabular-nums', RED)}>
              ব্যর্থ {toBnDigits(completedReport.summary.fail)}
            </span>
            <span className={cn('rounded-full border px-2.5 py-0.5 tabular-nums', STONE)}>
              স্কিপ {toBnDigits(completedReport.summary.skipped)}
            </span>
            {completedReport.summary.error > 0 && (
              <span className={cn('rounded-full border px-2.5 py-0.5 tabular-nums', RED)}>
                ত্রুটি {toBnDigits(completedReport.summary.error)}
              </span>
            )}
          </div>

          {/* বড় সৎ-ব্যাজ: যন্ত্র-পরীক্ষা ≠ মানব-শ্রবণ */}
          <div className="mt-2.5">
            <Badge
              variant="outline"
              className={cn('h-auto px-3 py-1 text-sm font-semibold leading-snug', AMBER)}
            >
              মানব-শ্রবণ যাচাই বাকি
            </Badge>
          </div>

          {completedReport.honestNote && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{completedReport.honestNote}</p>
          )}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
            {completedReport.startedAt && <>শুরু: {relativeTimeBn(completedReport.startedAt)}</>}
            {completedReport.finishedAt && <> · শেষ: {relativeTimeBn(completedReport.finishedAt)}</>}
          </p>
        </div>
      )}

      {/* ফলাফল-সারণী */}
      {results.length > 0 && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold">
              ফলাফল
              <span className="ml-1.5 font-normal text-muted-foreground">
                ({toBnDigits(results.length)} বাক্য)
              </span>
            </p>
            <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ChevronDown className="size-3" aria-hidden="true" />
              সারিতে চাপ দিলে বিস্তারিত
            </p>
          </div>
          <div
            className={cn('max-h-96 overflow-y-auto rounded-lg border', THIN_SCROLLBAR)}
            aria-label="বেঞ্চমার্ক ফলাফল-সারণী"
          >
            <Table className="min-w-[52rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 px-2 text-xs">#</TableHead>
                  <TableHead className="h-9 px-2 text-xs">শ্রেণি</TableHead>
                  <TableHead className="h-9 px-2 text-xs">বাক্য</TableHead>
                  <TableHead className="h-9 px-2 text-xs">কণ্ঠ</TableHead>
                  <TableHead className="h-9 px-2 text-xs">রায়</TableHead>
                  <TableHead className="h-9 px-2 text-xs whitespace-nowrap">দৈর্ঘ্য (সে.)</TableHead>
                  <TableHead className="h-9 px-2 text-xs whitespace-nowrap">নীরবতা (%)</TableHead>
                  <TableHead className="h-9 px-2 text-xs">শুনুন</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((result, i) => {
                  const rowId = result.sentenceId || `row-${i}`;
                  return (
                    <ResultRow
                      key={rowId}
                      index={i}
                      result={result}
                      rowId={rowId}
                      expanded={expandedId === rowId}
                      onToggle={() => setExpandedId((prev) => (prev === rowId ? null : rowId))}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* খালি-স্টেট: কখনো কোনো রান হয়নি — অথবা স্টেট-এরর (ইনলাইন পুনঃচেষ্টাসহ) */}
      {!report && error && (
        <p className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          <span className="flex min-w-0 items-start gap-1.5">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 min-h-8 px-2.5"
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCcw className="size-3.5" aria-hidden="true" />
            )}
            আবার
          </Button>
        </p>
      )}

      {!report && !error && (
        <div className="mt-3 rounded-lg border border-dashed border-stone-400/60 px-4 py-5 text-center">
          <p className="mx-auto max-w-xl text-xs leading-relaxed text-muted-foreground">
            এই ল্যাব বাংলা বাক্যে TTS কণ্ঠের যন্ত্র-পরীক্ষা চালায় — প্রতিটি বাক্যের দৈর্ঘ্য, নীরবতা
            ও ক্লিপিং যাচাই হয়, সঙ্গে সীমিত ASR-উপদেশ; প্রতিটির রায় (পাস/সতর্কতা/ব্যর্থ) ও
            শোনার-প্লেয়ার পাওয়া যায়।
          </p>
          <div className="mt-2.5 flex flex-wrap justify-center gap-1" aria-label="বেঞ্চমার্ক-শ্রেণিসমূহ">
            {Object.values(CATEGORY_LABEL).map((label) => (
              <span
                key={label}
                className="rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] leading-relaxed text-muted-foreground"
              >
                {label}
              </span>
            ))}
          </div>
          <p className="mt-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
            প্রথমবার দ্রুত প্রোব চালিয়ে দেখুন।
          </p>
        </div>
      )}
    </section>
  );
}
