'use client';

// ============================================================
// KaggleGpuMusicCard — ঐচ্ছিক রিমোট-প্রোভাইডার "ক্যাগল GPU (মিউজিক)"।
//
// - জব পাঠায়: POST /api/kaggle/jobs (type:'music')
// - পোল করে:  GET /api/kaggle/jobs/[id] — আনুমানিক ৫ সেকেন্ড অন্তর,
//   শুধু pending/running অবস্থায়; done/failed-এ ও unmount-এ থামে।
//   একক টাইমার + in-flight গার্ড — ডুপ্লিকেট-লুপ/ওভারল্যাপ নেই।
// - রিফ্রেশ-রিকভারি: মাউন্টে সাম্প্রতিক জব এনে কোনো pending/running
//   জব থাকলে সেটির ট্র্যাকিং পুনরায় শুরু হয়।
// - সততা: নকল অগ্রগতি-শতাংশ নেই — শুধু জানা অবস্থা + অতিবাহিত সময়;
//   pending > ২ মিনিট হলে কর্মী-অফলাইন *ইঙ্গিত*; গাওয়া কণ্ঠ নয়।
//
// ডিফল্ট ইনস্ট্রুমেন্টাল-পথ (প্রসিডিউরাল) সম্পূর্ণ অপরিবর্তিত —
// এই প্রদানকারী সম্পূর্ণ অপ্ট-ইন।
// ============================================================

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Cpu, ExternalLink, Loader2, Send, TriangleAlert } from 'lucide-react';

import { relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';
import { withStudioToken } from '@/components/auth/security-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import {
  KAGGLE_JOB_POLL_INTERVAL_MS,
  shouldContinuePolling,
  type KaggleJobView,
} from '@/lib/kaggle/status';
import { cn } from '@/lib/utils';

/** [id]-রুট done-জবে ঐচ্ছিক artifactUrl যোগ করে (বিদ্যমান গ্যালারি-পথ) */
interface KaggleJobViewWithArtifact extends KaggleJobView {
  artifactUrl?: string;
}

const DURATION_OPTIONS = [30, 60, 90, 120, 150, 180] as const;

const JOB_STATUS_META: Record<KaggleJobView['status'], { label: string; className: string }> = {
  pending: {
    label: 'সারিতে',
    className: 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300',
  },
  running: {
    label: 'চলছে (GPU-তে)',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  done: {
    label: 'সম্পন্ন',
    className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  },
  failed: {
    label: 'ব্যর্থ',
    className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400',
  },
};

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${toBnDigits(min)} মি ${toBnDigits(sec)} সে` : `${toBnDigits(sec)} সেকেন্ড`;
}

export function KaggleGpuMusicCard() {
  const [prompt, setPrompt] = useState('');
  const [durationSec, setDurationSec] = useState<number>(60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<KaggleJobViewWithArtifact | null>(null);
  const [recent, setRecent] = useState<KaggleJobViewWithArtifact[] | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const trackedIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // ---- পোলিং: একক লুপ, in-flight গার্ড, unmount/terminal-এ বন্ধ ----
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const applyJob = useCallback(
    (job: KaggleJobViewWithArtifact) => {
      setActiveJob(job);
      trackedIdRef.current = job.id;
      if (!shouldContinuePolling(job)) stopPolling();
    },
    [stopPolling],
  );

  const pollOnce = useCallback(async () => {
    const id = trackedIdRef.current;
    if (!id || inFlightRef.current) return;
    inFlightRef.current = true;
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/kaggle/jobs/${id}`, { signal: ac.signal });
      if (!res.ok) return; // সাময়িক ব্যর্থতা — পরের টিকে আবার চেষ্টা
      const data = (await res.json()) as { job?: KaggleJobViewWithArtifact };
      if (data.job && data.job.id === id) applyJob(data.job);
    } catch {
      // abort/নেটওয়ার্ক-ত্রুটি — চুপ; পরের টিকে আবার
    } finally {
      inFlightRef.current = false;
    }
  }, [applyJob]);

  const startPolling = useCallback(
    (id: string) => {
      trackedIdRef.current = id;
      void pollOnce();
      if (pollTimerRef.current) return; // টাইমার আছে — লক্ষ্য-আইডি বদলেছে, ডুপ্লিকেট নয়
      pollTimerRef.current = setInterval(() => void pollOnce(), KAGGLE_JOB_POLL_INTERVAL_MS);
    },
    [pollOnce],
  );

  // unmount-এ পোলিং + চলমান অনুরোধ বাতিল
  useEffect(() => stopPolling, [stopPolling]);

  // চলমান জবে প্রতি সেকেন্ডে অতিবাহিত-সময় টিক (নকল-শতাংশ নয়)
  useEffect(() => {
    if (!activeJob || !shouldContinuePolling(activeJob)) return;
    const t = setInterval(() => setNowTick(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [activeJob]);

  // মাউন্টে সাম্প্রতিক জব + রিফ্রেশ-রিকভারি (চলমান জব আবার ট্র্যাক)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/kaggle/jobs?limit=5');
        if (res.status === 503) {
          if (!cancelled) setNotConfigured(true);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: KaggleJobViewWithArtifact[] };
        if (cancelled) return;
        const jobs = data.jobs ?? [];
        setRecent(jobs);
        const active = jobs.find(j => shouldContinuePolling(j));
        if (active) applyJob(active);
      } catch {
        // নীরব — প্রথম পোলেই আবার চেষ্টা হবে
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyJob]);

  // terminal-অবস্থায় এসেছে — সাম্প্রতিক তালিকা একবার রিফ্রেশ
  useEffect(() => {
    if (!activeJob || shouldContinuePolling(activeJob)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/kaggle/jobs?limit=5');
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: KaggleJobViewWithArtifact[] };
        if (!cancelled) setRecent(data.jobs ?? []);
      } catch {
        // নীরব
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeJob]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting || notConfigured) return;
    const trimmed = prompt.trim();
    if (!trimmed) return; // native required-ও রক্ষা করে

    // কর্মী-চুক্তি: [duration=N] ডিরেক্টিভ (১–১৮০ সে., worker.py পার্স করে)
    const fullPrompt = `${trimmed} [duration=${durationSec}]`;

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/kaggle/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'music', prompt: fullPrompt }),
      });
      if (res.status === 503) setNotConfigured(true);
      const data = (await res.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        type?: string;
        error?: string;
      };
      if (!res.ok || !data.id) {
        toast({ title: data.error ?? 'জব তৈরি করা যায়নি', variant: 'destructive' });
        return;
      }

      const nowIso = new Date().toISOString();
      const newJob: KaggleJobViewWithArtifact = {
        id: data.id,
        type: 'music',
        prompt: fullPrompt,
        status: 'pending',
        resultUrl: null,
        error: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        stale: false,
        workerMayBeOffline: false,
        elapsedMs: 0,
      };
      stopPolling();
      applyJob(newJob);
      startPolling(newJob.id);
      setRecent(prev => (prev ? [newJob, ...prev].slice(0, 5) : prev));
      setPrompt('');
      toast({
        title: 'মিউজিক-জব সারিতে যোগ হয়েছে',
        description: 'ক্যাগল কর্মী চালু থাকলে প্রসেস শুরু হবে (kaggle/README.md)',
      });
    } catch {
      toast({ title: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTrackRecent = (job: KaggleJobViewWithArtifact) => {
    stopPolling();
    applyJob(job);
    if (shouldContinuePolling(job)) startPolling(job.id);
  };

  const statusMeta = activeJob ? (JOB_STATUS_META[activeJob.status] ?? JOB_STATUS_META.failed) : null;
  const isActive = activeJob ? shouldContinuePolling(activeJob) : false;
  const elapsedMs = activeJob ? Math.max(0, nowTick - Date.parse(activeJob.createdAt)) : 0;
  // মিডিয়া-উৎস: অ্যাপ-আর্টিফ্যাক্ট হলে টোকেন-সহ app-URL; নাহলে সরাসরি
  // পাবলিক Supabase URL (কখনো সেশন-টোকেন বাইরের হোস্টে পাঠানো হয় না)
  const audioSrc = activeJob
    ? activeJob.artifactUrl
      ? withStudioToken(activeJob.artifactUrl)
      : (activeJob.resultUrl ?? '')
    : '';

  return (
    <Card className="gap-4 rounded-xl py-5">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <Cpu className="size-4" aria-hidden="true" />
          </span>
          ক্যাগল GPU মিউজিক — MusicGen (T4)
          <Badge variant="secondary" className="shrink-0 text-[11px] font-normal">
            ঐচ্ছিক প্রদানকারী
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed sm:text-sm">
          প্রোভাইডার: Kaggle GPU (music) · facebook/musicgen-medium · সর্বোচ্চ{' '}
          {toBnDigits(180)} সেকেন্ড। রিমোট কিউ — কাজ চলাকালে এই পাতা খোলা রাখুন।
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 px-4 sm:px-6">
        {/* সৎ-নোট (নীতি: honestLabel সব জায়গায়) */}
        <p className="flex items-start gap-1.5 rounded-lg border border-stone-400/40 bg-stone-400/10 px-3 py-2 text-xs leading-relaxed text-stone-600 dark:text-stone-300">
          <span className="mt-px shrink-0" aria-hidden="true">🎹</span>
          নিউরাল মিউজিক-মডেল (MusicGen) — তবে গান গাওয়া কণ্ঠ/বাংলা লিরিক্স নয়, শুধু
          ইনস্ট্রুমেন্টাল-ধাঁচের অডিও। কাজ প্রসেস করতে Kaggle নোটবুক-কর্মী চালু থাকতে
          হবে (kaggle/README.md)। ডিফল্ট ইনস্ট্রুমেন্টাল-পথ (প্রসিডিউরাল) অপরিবর্তিত।
        </p>

        {/* সার্ভার-কনফিগ-নেই অবস্থা */}
        {notConfigured && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            সার্ভারে Supabase কনফিগার করা নেই — SUPABASE_URL ও SUPABASE_KEY (service_role)
            পরিবেশ-ভেরিয়েবল দরকার। ডিফল্ট মিউজিক-পথ ঠিকই চলবে।
          </p>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 space-y-1.5 sm:col-span-2">
              <Label htmlFor="kaggle-music-prompt" className="text-xs text-muted-foreground">
                মিউজিক-প্রম্পট
              </Label>
              <Textarea
                id="kaggle-music-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
                rows={2}
                maxLength={900}
                placeholder="যেমন: upbeat electronic dance track with warm synth pads and steady kick…"
                className="bg-background text-base md:text-sm"
                aria-label="মিউজিক-প্রম্পট"
              />
            </div>

            <div className="col-span-3 space-y-1.5 sm:col-span-1">
              <Label htmlFor="kaggle-music-duration" className="text-xs text-muted-foreground">
                দৈর্ঘ্য (সেকেন্ড)
              </Label>
              <Select
                value={String(durationSec)}
                onValueChange={(v) => setDurationSec(Number(v))}
                disabled={notConfigured}
              >
                <SelectTrigger
                  id="kaggle-music-duration"
                  className="min-h-11 bg-background text-sm"
                  aria-label="দৈর্ঘ্য (সেকেন্ড)"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {toBnDigits(d)} সে.
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] leading-snug text-muted-foreground">
                T4 GPU-তে বেশি দৈর্ঘ্য = বেশি সময়
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={isSubmitting || notConfigured}
              className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              মিউজিক-জব পাঠান
            </Button>
            <p className="text-[11px] leading-snug text-muted-foreground">
              জব সারিতে (queued) যাবে — কর্মী চালু হলেই তৈরি শুরু।
            </p>
          </div>
        </form>

        {/* ---- সক্রিয়/নির্বাচিত জবের লাইভ অবস্থা ---- */}
        {activeJob && statusMeta && (
          <div
            role="status"
            aria-live="polite"
            className="space-y-3 rounded-xl border bg-muted/20 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={cn('text-[11px]', statusMeta.className)}>
                {statusMeta.label}
              </Badge>
              <span className="font-mono text-[11px] text-muted-foreground" title={activeJob.id}>
                জব {activeJob.id.slice(0, 8)}…
              </span>
              {isActive && (
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  অতিবাহিত: {formatElapsed(elapsedMs)}
                </span>
              )}
            </div>

            <p className="min-w-0 text-sm leading-relaxed text-foreground/90">
              {activeJob.prompt.length > 140 ? `${activeJob.prompt.slice(0, 140)}…` : activeJob.prompt}
            </p>

            {/* কর্মী-অফলাইন ইঙ্গিত (pending > ২ মিনিট — ইঙ্গিত, প্রমাণ নয়) */}
            {activeJob.workerMayBeOffline && activeJob.status === 'pending' && (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                ক্যাগল কর্মী সম্ভবত বন্ধ। এই সারিতে-থাকা জবটি প্রসেস করতে Kaggle নোটবুকটি
                চালু করুন। (২ মিনিটের বেশি অপেক্ষার ইঙ্গিত — নিশ্চিত প্রমাণ নয়; জবটি
                সারিতেই থাকবে।)
              </p>
            )}

            {/* স্টেল-নোট (৯০ মিনিটের বেশি running-এ আটকে ছিল) */}
            {activeJob.stale && (
              <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-600 dark:text-red-400">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                এই জবটি ৯০ মিনিটের বেশি &quot;running&quot; অবস্থায় আটকে ছিল — কর্মী-সেশন
                সম্ভবত বন্ধ হয়ে গিয়েছিল। নতুন করে পাঠান।
              </p>
            )}

            {/* ব্যর্থতার বার্তা */}
            {activeJob.status === 'failed' && activeJob.error && (
              <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs leading-relaxed text-red-600 dark:text-red-400">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {activeJob.error.length > 300 ? `${activeJob.error.slice(0, 300)}…` : activeJob.error}
              </p>
            )}

            {/* সম্পন্ন — অডিও প্লেয়ার + লিংক */}
            {activeJob.status === 'done' && audioSrc && (
              <div className="space-y-2">
                <audio controls preload="metadata" src={audioSrc} className="h-10 w-full" aria-label="ক্যাগল GPU-তে তৈরি মিউজিক" />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <a
                    href={audioSrc}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  >
                    <ExternalLink className="size-3" aria-hidden="true" />
                    অডিও নতুন ট্যাবে খুলুন
                  </a>
                  <span>ফাইলটি Supabase Storage-এ (পাবলিক outputs বাকেট) — গ্যালারিতেও যুক্ত হয়।</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---- সাম্প্রতিক জব (রিফ্রেশ-রিকভারি + পুরনো ফল দেখা) ---- */}
        {recent && recent.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">সাম্প্রতিক ক্যাগল-জব</p>
            <ul className="max-h-44 space-y-1 overflow-y-auto pr-1" aria-label="সাম্প্রতিক ক্যাগল জব">
              {recent.map((job) => {
                const meta = JOB_STATUS_META[job.status] ?? JOB_STATUS_META.failed;
                const isTracked = activeJob?.id === job.id;
                return (
                  <li key={job.id}>
                    <button
                      type="button"
                      onClick={() => handleTrackRecent(job)}
                      aria-pressed={isTracked}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/50',
                        isTracked && 'border-emerald-600/40 bg-emerald-600/5',
                      )}
                    >
                      <span
                        className={cn('size-2 shrink-0 rounded-full border', meta.className)}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground/90" title={job.prompt}>
                        {job.prompt.length > 42 ? `${job.prompt.slice(0, 42)}…` : job.prompt}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{meta.label}</span>
                      <span className="shrink-0 text-muted-foreground/80">
                        {relativeTimeBn(job.createdAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
