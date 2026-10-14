'use client';

// ============================================================
// ProductionsView — সব প্রোডাকশনের মনিটর।
// - তালিকা GET /api/productions থেকে; সক্রিয় হলে প্রতি ৮ সেকেন্ডে রিফ্রেশ
// - সক্রিয় প্রোডাকশনের ডিটেইল fetch + SSE সাবস্ক্রাইব (useProductions স্টোর)
// - প্রতি কার্ড: অবস্থা-ব্যাজ, অগ্রগতি, ধাপ-তালিকা (Collapsible), বাতিল, ফলাফল
// - সেকশন ফিল্টার: সব / চলছে / সম্পন্ন / সমস্যা
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clapperboard,
  Factory,
  Film,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Music,
  RefreshCcw,
  AlertCircle,
  XCircle,
} from 'lucide-react';

import { formatTimeBn, relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';
import { withStudioToken } from '@/components/auth/security-gate';
import { ProductionCard, ProviderStatusRow } from '@/components/studio/production-card';
import { QuickCreateCard } from '@/components/studio/quick-create';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductions } from '@/hooks/use-productions';
import { toast } from '@/hooks/use-toast';
import type {
  ProductionStatus,
  ProductionStepView,
  ProductionSummary,
  ProductionType,
  ProductionView,
} from '@/lib/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// লেবেল ম্যাপ (production-card.tsx-এর STATUS_META থেকে স্থানীয় কপি)
// ------------------------------------------------------------

const STATUS_META: Record<ProductionStatus, { label: string; className: string }> = {
  awaiting_confirmation: { label: 'নিশ্চয়তার অপেক্ষায়', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  queued: { label: 'সারিতে', className: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  running: { label: 'চলছে', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  validating: { label: 'যাচাই হচ্ছে', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  completed: { label: 'সম্পন্ন', className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' },
  partial: { label: 'আংশিক সফল', className: 'border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400' },
  failed: { label: 'ব্যর্থ', className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400' },
  cancelled: { label: 'বাতিল', className: 'border-muted bg-muted text-muted-foreground' },
  cancelling: { label: 'বাতিল হচ্ছে', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

const TYPE_META: Record<ProductionType, { label: string; icon: typeof Film }> = {
  image: { label: 'ছবি', icon: ImageIcon },
  audio: { label: 'অডিও', icon: AudioLines },
  motion_video: { label: 'মোশন ভিডিও', icon: Film },
  music_video: { label: 'মিউজিক ভিডিও', icon: Music },
  short_film: { label: 'শর্টফিল্ম', icon: Clapperboard },
};

/** সক্রিয় অবস্থা — এগুলোর জন্য ডিটেইল+SSE এবং লিস্ট-রিফ্রেশ চালু থাকে */
const ACTIVE_STATUSES: ProductionStatus[] = ['awaiting_confirmation', 'queued', 'running', 'validating', 'cancelling'];

const SECTION_FILTERS = [
  { key: 'all', label: 'সব', match: (_s: ProductionStatus) => true },
  { key: 'active', label: 'চলছে', match: (s: ProductionStatus) => ACTIVE_STATUSES.includes(s) },
  { key: 'done', label: 'সম্পন্ন', match: (s: ProductionStatus) => s === 'completed' },
  { key: 'problem', label: 'সমস্যা', match: (s: ProductionStatus) => s === 'partial' || s === 'failed' || s === 'cancelled' },
] as const;

const SECTION_EMPTY: Record<string, string> = {
  all: 'এখনো কোনো প্রোডাকশন নেই — উপরের “দ্রুত তৈরি” ফর্ম বা চ্যাট থেকে শুরু করুন।',
  active: 'এখন কোনো চলমান প্রোডাকশন নেই।',
  done: 'এখনো কোনো সম্পন্ন প্রোডাকশন নেই।',
  problem: 'কোনো সমস্যাযুক্ত প্রোডাকশন নেই।',
};

/** দীর্ঘ ত্রুটি-বার্তা ২০০ অক্ষরে ছেঁটে দাও */
function truncateError(text: string): string {
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function stepStatusIcon(status: ProductionStepView['status']) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
    case 'running':
      return <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" aria-hidden="true" />;
    case 'failed':
      return <XCircle className="size-4 text-red-500" aria-hidden="true" />;
    case 'skipped':
      return <Ban className="size-4 text-muted-foreground" aria-hidden="true" />;
    default:
      return <CircleDashed className="size-4 text-muted-foreground/60" aria-hidden="true" />;
  }
}

// ------------------------------------------------------------
// একটি প্রোডাকশন কার্ড (লাইভ ভিউ স্টোর থেকে)
// ------------------------------------------------------------

function ProductionMonitorCard({ summary, onRevised }: { summary: ProductionSummary; onRevised?: () => void }) {
  const view = useProductions(s => s.productions[summary.id]);
  const ensureFetched = useProductions(s => s.ensureFetched);
  const cancelProduction = useProductions(s => s.cancelProduction);
  const reviseProduction = useProductions(s => s.reviseProduction);

  const [open, setOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isRerunning, setIsRerunning] = useState(false);

  // স্টোরে লাইভ ভিউ থাকলে সেটিই নতুন (SSE আপডেট করে)
  const status: ProductionStatus = view?.status ?? summary.status;
  const progress = view?.progress ?? summary.progress;
  const artifactCount = view?.artifacts.length ?? summary.artifactCount;
  const finishedAt = view?.finishedAt ?? summary.finishedAt;

  const typeMeta = TYPE_META[summary.type] ?? TYPE_META.image;
  const TypeIcon = typeMeta.icon;
  const statusMeta = STATUS_META[status] ?? STATUS_META.awaiting_confirmation;
  const isActive = ACTIVE_STATUSES.includes(status);
  const currentStep = view?.steps.find(st => st.status === 'running') ?? view?.steps.find(st => st.id === view?.currentStepKey);

  // খোলা মাত্র ডিটেইল না থাকলে fetch (সক্রিয় প্রোডাকশন অভিভাবক থেকে আগেই এসে থাকে)
  useEffect(() => {
    if (open && !view) void ensureFetched(summary.id);
  }, [open, view, summary.id, ensureFetched]);

  const handleCancel = async () => {
    setIsCancelling(true);
    await cancelProduction(summary.id);
    setIsCancelling(false);
  };

  // §2-E: ব্যর্থ/বাতিল প্রোডাকশনের নিরাপদ পুনঃচালানো — বিদ্যমান revise
  // এন্ডপয়েন্টই; নতুন awaiting_confirmation প্রস্তাব তৈরি হয় (সরাসরি চালু নয়)
  const handleRerun = async () => {
    setIsRerunning(true);
    const revision = await reviseProduction(summary.id, {});
    setIsRerunning(false);
    if (revision) {
      toast({ title: 'আবার চালানোর প্রস্তাব তৈরি হয়েছে', description: 'নিশ্চিত করার অপেক্ষায় — তালিকা রিফ্রেশ হচ্ছে' });
      onRevised?.();
    }
  };

  const showError = (status === 'failed' || status === 'partial') && (view?.error ?? '');
  const showArtifacts = (status === 'completed' || status === 'partial') && (view?.artifacts.length ?? 0) > 0;
  const artifactThumbs = (view?.artifacts ?? []).slice(0, 6);

  return (
    <li className="overflow-hidden rounded-xl border bg-card shadow-sm">
      {/* হেডার */}
      <div className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          <TypeIcon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 truncate text-sm font-semibold" title={summary.title}>
              {summary.title}
            </p>
            <Badge variant="outline" className={cn('shrink-0 text-[11px]', statusMeta.className)}>
              {statusMeta.label}
            </Badge>
            {view?.parentProductionId && (
              <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
                সংশোধন
              </Badge>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span>{typeMeta.label}</span>
            <span aria-hidden="true">·</span>
            <span title={new Date(summary.createdAt).toLocaleString('bn-BD')}>তৈরি {relativeTimeBn(summary.createdAt)}</span>
            {finishedAt && (
              <>
                <span aria-hidden="true">·</span>
                <span>শেষ {formatTimeBn(finishedAt)}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>{toBnDigits(artifactCount)}টি ফাইল</span>
          </p>
        </div>
      </div>

      {/* বডি */}
      <div className="space-y-3 px-4 pb-3">
        {isActive && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">
                {status === 'awaiting_confirmation' ? 'নিশ্চয়তার অপেক্ষায় — চ্যাটের কার্ড থেকে নিশ্চিত করুন' : currentStep ? `চলছে: ${currentStep.title}` : `${statusMeta.label}…`}
              </span>
              <span className="shrink-0">{toBnDigits(progress)}%</span>
            </div>
            <Progress value={progress} className="h-1.5" aria-label="অগ্রগতি" />
            {/* §2-B: ক্লাউড ভিডিও-প্রোভাইডারের সৎ স্ট্যাটাস */}
            {view && ['motion_video', 'music_video', 'short_film'].includes(view.spec.type) && view.providerStatus && (
              <ProviderStatusRow provider={view.providerStatus} />
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-11 border-red-500/30 text-red-600 hover:bg-red-500/10 dark:text-red-400"
              onClick={() => void handleCancel()}
              disabled={isCancelling || status === 'cancelling'}
            >
              <Ban className="size-4" aria-hidden="true" />
              {status === 'cancelling' ? '✕ বাতিল হচ্ছে…' : '✕ বাতিল করুন'}
            </Button>
          </div>
        )}

        {(status === 'failed' || status === 'cancelled') && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
            onClick={() => void handleRerun()}
            disabled={isRerunning}
          >
            {isRerunning ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCcw className="size-4" aria-hidden="true" />}
            🔁 আবার চালান
          </Button>
        )}

        {showError && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {truncateError(showError)}
          </p>
        )}

        {status === 'completed' && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1 py-1 text-[11px] font-normal" title="চ্যাট ভিউতে প্রোডাকশন কার্ড দেখুন">
              <MessageSquare className="size-3 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              চ্যাটে দেখুন
            </Badge>
          </div>
        )}

        {showArtifacts && (
          <div className="flex flex-wrap gap-1.5" aria-label="ফলাফল ফাইল">
            {artifactThumbs.map(a =>
              a.kind === 'image' ? (
                <img
                  key={a.id}
                  src={withStudioToken(a.url)}
                  alt={a.fileName}
                  loading="lazy"
                  title={a.fileName}
                  className="size-14 rounded-md border object-cover"
                />
              ) : (
                <span
                  key={a.id}
                  title={a.fileName}
                  className="flex size-14 items-center justify-center rounded-md border bg-muted/50 text-[10px] text-muted-foreground"
                >
                  {a.kind === 'video' ? '🎬' : a.kind === 'audio' ? '🎵' : '📄'}
                </span>
              ),
            )}
            {(view?.artifacts.length ?? 0) > 6 && (
              <span className="flex size-14 items-center justify-center rounded-md border border-dashed text-[11px] text-muted-foreground">
                +{toBnDigits((view?.artifacts.length ?? 0) - 6)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* বিস্তারিত (Collapsible) */}
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="flex min-h-11 w-full items-center justify-between border-t px-4 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600/50"
          aria-expanded={open}
        >
          {open ? 'বিস্তারিত লুকান' : 'ধাপ-প্রগতি ও বিস্তারিত'}
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t-0 px-4 py-3">
          {!view ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ডিটেইল লোড হচ্ছে…
            </p>
          ) : view.steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {status === 'awaiting_confirmation'
                ? 'নিশ্চিত করার পর ধাপ-তালিকা এখানে দেখা যাবে।'
                : 'কোনো ধাপ রেকর্ড হয়নি।'}
            </p>
          ) : (
            <ol className="space-y-1.5" aria-label="প্রোডাকশন ধাপ">
              {view.steps.map(step => (
                <li key={step.id} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 shrink-0">{stepStatusIcon(step.status)}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block leading-tight', step.status === 'pending' && 'text-muted-foreground/70')}>
                      {toBnDigits(step.seq)}. {step.title}
                    </span>
                    {step.detail && <span className="block text-xs text-muted-foreground">{step.detail}</span>}
                    {step.error && <span className="block text-xs text-red-500">{step.error}</span>}
                  </span>
                  {step.durationMs != null && step.durationMs > 0 && (
                    <span className="shrink-0 pt-0.5 text-[11px] text-muted-foreground">
                      {toBnDigits((step.durationMs / 1000).toFixed(1))} সে
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

// ------------------------------------------------------------
// মূল ভিউ
// ------------------------------------------------------------

export function ProductionsView() {
  const [summaries, setSummaries] = useState<ProductionSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [section, setSection] = useState<string>('all');

  const applyView = useProductions(s => s.applyView);
  const subscribe = useProductions(s => s.subscribe);
  // লাইভ ভিউ-ম্যাপ — স্টোরে আপডেট এলে পিল-গণনা/ফিল্টার সাথে সাথে সঠিক হয়
  const productionsMap = useProductions(s => s.productions);

  // এক সেশনে যেসব id ডিটেইল+সাবস্ক্রাইব নিশ্চিত হয়েছে
  const ensuredRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/productions');
      if (!res.ok) throw new Error('সার্ভার সমস্যা');
      const list = (await res.json()) as ProductionSummary[];
      setSummaries(list);
      setError(false);
    } catch {
      setSummaries(prev => prev ?? []);
      setError(true);
    }
  }, []);

  useEffect(() => {
    setSummaries(null);
    void load();
  }, [load, reload]);

  // সারাংশ + লাইভ ভিউ মিশিয়ে প্রকৃত অবস্থা (স্টোরে নতুন হলে সেটিই প্রাধান্য পায়)
  const liveList = useMemo(
    () =>
      (summaries ?? []).map(s => ({
        ...s,
        status: (productionsMap[s.id]?.status ?? s.status) as ProductionStatus,
        progress: productionsMap[s.id]?.progress ?? s.progress,
      })),
    [summaries, productionsMap],
  );

  // তালিকায় (সার্ভার-সত্য) কোনো সক্রিয় থাকলে রিফ্রেশ-ইন্টারভাল চালু থাকে —
  // সব শেষ হলে শেষ একটি রিফ্রেশের পরেই ইন্টারভাল বন্ধ হয়
  const hasActive = useMemo(
    () => (summaries ?? []).some(s => ACTIVE_STATUSES.includes(s.status)),
    [summaries],
  );

  // কোনো সক্রিয় প্রোডাকশন থাকলে প্রতি ৮ সেকেন্ডে তালিকা রিফ্রেশ
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => void load(), 8000);
    return () => clearInterval(timer);
  }, [hasActive, load]);

  // সক্রিয় প্রোডাকশন: ডিটেইল fetch + SSE সাবস্ক্রাইব (প্রতিটি একবারই)
  useEffect(() => {
    if (!summaries) return;
    for (const s of summaries) {
      if (!ACTIVE_STATUSES.includes(s.status) || ensuredRef.current.has(s.id)) continue;
      ensuredRef.current.add(s.id);
      void (async () => {
        try {
          const res = await fetch(`/api/productions/${s.id}`);
          if (!res.ok) return;
          const view = (await res.json()) as ProductionView;
          applyView(view);
          subscribe(s.id);
        } catch {
          // নীরব — পরের লিস্ট-রিফ্রেশে আবার চেষ্টা হবে না, কিন্তু কার্ড ভিউ কাজ করবে
        }
      })();
    }
  }, [summaries, applyView, subscribe]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: liveList.length };
    for (const s of liveList) {
      for (const f of SECTION_FILTERS) {
        if (f.key !== 'all' && f.match(s.status)) c[f.key] = (c[f.key] ?? 0) + 1;
      }
    }
    return c;
  }, [liveList]);

  const filtered = useMemo(() => {
    const f = SECTION_FILTERS.find(x => x.key === section);
    return f ? liveList.filter(s => f.match(s.status)) : liveList;
  }, [liveList, section]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Factory className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          প্রোডাকশন মনিটর
        </h1>
        <p className="text-sm text-muted-foreground">সব ক্রিয়েটিভ কাজের অবস্থা, অগ্রগতি ও ফলাফল</p>
      </header>

      {/* S9: ⚡ দ্রুত তৈরি — LLM ছাড়াই সরাসরি প্রস্তাব (রেট-লিমিটেড সময়ের সৎ-পথ) */}
      <QuickCreateCard
        onCreated={() => {
          setSection('all');
          setReload(n => n + 1);
        }}
      />

      {/* সেকশন ফিল্টার */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="অবস্থা অনুযায়ী ফিল্টার">
        {SECTION_FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setSection(f.key)}
            aria-pressed={section === f.key}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
              section === f.key
                ? 'border-emerald-600/50 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-80">{toBnDigits(counts[f.key] ?? 0)}</span>
          </button>
        ))}
      </div>

      {summaries === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
          <AlertCircle className="size-6 text-red-500" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">তালিকা লোড করা যায়নি।</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
            onClick={() => setReload(n => n + 1)}
          >
            <RefreshCcw className="size-4" aria-hidden="true" />
            আবার চেষ্টা করুন
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {SECTION_EMPTY[section] ?? SECTION_EMPTY.all}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map(p =>
            p.status === 'awaiting_confirmation' ? (
              // নিশ্চয়তার অপেক্ষায় — চ্যাট-কার্ডের বিদ্যমান নিশ্চিত-বাটনসহ সম্পূর্ণ কার্ড
              <li key={p.id}>
                <ProductionCard productionId={p.id} />
              </li>
            ) : (
              <ProductionMonitorCard key={p.id} summary={p} onRevised={() => setReload(n => n + 1)} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}
