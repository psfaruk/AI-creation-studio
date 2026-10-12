'use client';

// ============================================================
// GalleryView — সব artifact-এর গ্যালারি।
// একবার সব kind একসাথে ফেচ (নির্ভুল গণনা + তাৎক্ষণিক সুইচ),
// kind-ফিল্টার ক্লায়েন্ট-সাইডে, প্রিভিউ ডায়ালগ (ছবি/ভিডিও/অডিও/নথি)।
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AudioLines,
  Download,
  FileText,
  Film,
  Images,
  RefreshCcw,
  TriangleAlert,
} from 'lucide-react';

import { formatSizeBn, relativeTimeBn, toBnDigits, withDownloadParam } from '@/components/chat/bn-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import type { ArtifactMeta } from '@/lib/types';
import { cn } from '@/lib/utils';

interface GalleryItem extends ArtifactMeta {
  createdAt: string;
  conversationTitle: string;
  origin: string;
}

const KIND_FILTERS = [
  { key: '', label: 'সব' },
  { key: 'image', label: 'ছবি' },
  { key: 'audio', label: 'অডিও' },
  { key: 'video', label: 'ভিডিও' },
  { key: 'text', label: 'নথি' },
] as const;

const KIND_EMPTY: Record<string, string> = {
  '': 'এখনো কোনো ফাইল নেই — চ্যাটে ছবি/অডিও/ভিডিও তৈরি করলে এখানে জমা হবে।',
  image: 'এখনো কোনো ছবি নেই — চ্যাটে ছবি চাইলে বা আপলোড করলে এখানে দেখা যাবে।',
  audio: 'এখনো কোনো অডিও নেই — কণ্ঠ তৈরি বা অডিও আপলোড হলে এখানে জমা হবে।',
  video: 'এখনো কোনো ভিডিও নেই — প্রোডাকশনে বা আপলোডে তৈরি ভিডিও এখানে দেখা যাবে।',
  text: 'এখনো কোনো নথি নেই — সাবটাইটেল/লিপি ধরনের ফাইল এখানে জমা হবে।',
};

const ORIGIN_LABEL: Record<string, string> = {
  tool: 'টুল',
  production: 'প্রোডাকশন',
  user_upload: 'আপলোড',
};

// ------------------------------------------------------------
// ভিডিও-সততা সহায়ক — প্রসিডিউরাল-ফলব্যাক শনাক্তকরণ (৪২৯-উইন্ডোর
// ফ্রেমগুলো আর "কেন ব্লার/ছবি-নেই" বোঝা যায় না তা যেন না হয়)
// ------------------------------------------------------------

interface VideoHonestyInfo {
  isProcedural: boolean;
  shotEngineLabels: string[];
  honestLabel: string;
}

/** মেটা থেকে প্রসিডিউরাল-ফলব্যাক চিহ্ন বের করো */
function readVideoHonesty(meta: Record<string, unknown> | undefined): VideoHonestyInfo {
  const labelsRaw = Array.isArray(meta?.shotEngineLabels) ? (meta?.shotEngineLabels as unknown[]) : [];
  const shotEngineLabels = labelsRaw.filter((x): x is string => typeof x === 'string');
  const honestLabel = typeof meta?.honestLabel === 'string' ? (meta.honestLabel as string) : '';
  const hay = [honestLabel, ...shotEngineLabels].join(' ');
  const isProcedural = /প্রসিডিউরাল|procedural|cinematic_motion/.test(hay);
  return { isProcedural, shotEngineLabels, honestLabel };
}

/** প্রসিডিউরাল-ভিডিওর ব্যাখ্যা-কার্ড (গ্যালারি প্রিভিউ-ডায়ালগে) */
function VideoHonestyCard({ info }: { info: VideoHonestyInfo }) {
  return (
    <div
      role="note"
      aria-label="ভিডিও সততা-তথ্য"
      className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800 dark:text-amber-300"
    >
      <p className="flex items-start gap-2 font-medium">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {info.isProcedural
          ? 'এই ভিডিওর শট-ছবিগুলো AI-জেনারেটেড নয়'
          : 'ভিডিও-ইঞ্জিন সম্পর্কে তথ্য'}
      </p>
      {info.isProcedural && (
        <p>
          তৈরির সময় ক্লাউড ইমেজ-জেন API রেট-লিমিটেড (429) থাকায় প্রাইপলাইন সৎ
          ফলব্যাকে লোকাল প্রসিডিউরাল ফ্রেম (রঙিন স্তর-শিল্প — মেঘ/নক্ষত্র/পাহাড়)
          ব্যবহার করেছে। API সচল থাকলে আবার বানালে আসল AI-ছবির শট আসবে —
          এটি লাইসেন্স-বা সফটওয়্যার-সমস্যা নয়, সাময়িক সীমার ফল।
        </p>
      )}
      {info.shotEngineLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="শটভিত্তিক ইঞ্জিন-লেবেল">
          {info.shotEngineLabels.map((label, i) => (
            <span
              key={i}
              className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px]"
            >
              {label}
            </span>
          ))}
        </div>
      )}
      {info.honestLabel && <p className="text-[11px] opacity-90">{info.honestLabel}</p>}
    </div>
  );
}

/** প্রতি পেজে ৪০টি — সর্বোচ্চ ১২০টি একসাথে রেন্ডার */
const PAGE_SIZE = 40;
const MAX_VISIBLE = 120;

// ------------------------------------------------------------
// নথি (text) প্রিভিউ — ফাইলের বিষয়বস্তু এনে ছোট ঝলক দেখায়
// ------------------------------------------------------------

function TextPreviewBody({ item }: { item: GalleryItem }) {
  // মাউন্টে 'loading' থেকে শুরু; key={item.id} দিয়ে প্রতি ফাইলে নতুন করে মাউন্ট হয়
  const [state, setState] = useState<'loading' | 'error' | { text: string }>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch(item.url)
      .then(res => (res.ok ? res.text() : Promise.reject(new Error('ফেচ ব্যর্থ'))))
      .then(text => {
        if (!cancelled) setState({ text });
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [item.url]);

  if (state === 'loading') {
    return <p className="py-6 text-center text-sm text-muted-foreground">নথি লোড হচ্ছে…</p>;
  }
  if (state === 'error') {
    return <p className="py-6 text-center text-sm text-red-600 dark:text-red-400">নথি পড়া যায়নি — ডাউনলোড করে দেখুন।</p>;
  }
  const full = state.text;
  const preview = full.length > 1500 ? `${full.slice(0, 1500)}…` : full;
  return (
    <pre className="max-h-72 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed whitespace-pre-wrap break-words [scrollbar-width:thin]">
      {preview || '(খালি নথি)'}
    </pre>
  );
}

// ------------------------------------------------------------
// মূল ভিউ
// ------------------------------------------------------------

export function GalleryView() {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [kind, setKind] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<GalleryItem | null>(null);

  // একবারে সব kind ফেচ (সীমা ৩০০) — গণনা নির্ভুল, ফিল্টার-সুইচ তাৎক্ষণিক
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setItems(null);
      setError(false);
      try {
        const res = await fetch('/api/gallery?limit=300');
        if (!res.ok) throw new Error('সার্ভার সমস্যা');
        const list = (await res.json()) as GalleryItem[];
        if (!cancelled) setItems(list);
      } catch {
        if (!cancelled) {
          setItems([]);
          setError(true);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // ফিল্টার বদলালে পেজিং রিসেট
  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [kind]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': items?.length ?? 0 };
    if (items) {
      for (const it of items) c[it.kind] = (c[it.kind] ?? 0) + 1;
    }
    return c;
  }, [items]);

  const filtered = useMemo(
    () => (items ?? []).filter(it => kind === '' || it.kind === kind),
    [items, kind],
  );
  const shown = filtered.slice(0, Math.min(visible, MAX_VISIBLE));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Images className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          গ্যালারি
        </h1>
        <p className="text-sm text-muted-foreground">সব তৈরি ও আপলোড করা ফাইল এক জায়গায়</p>
      </header>

      {/* kind-ফিল্টার পিল — প্রতিটিতে গণনা */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="ফাইলের ধরন অনুযায়ী ফিল্টার">
        {KIND_FILTERS.map(f => (
          <button
            key={f.key || 'all'}
            type="button"
            onClick={() => setKind(f.key)}
            aria-pressed={kind === f.key}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium transition-colors',
              kind === f.key
                ? 'border-emerald-600/50 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                : 'bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
            <span className="ml-1.5 text-xs opacity-80">{toBnDigits(counts[f.key] ?? 0)}</span>
          </button>
        ))}
      </div>

      {items === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
          <AlertCircle className="size-6 text-red-500" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">গ্যালারি লোড করা যায়নি।</p>
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
          {KIND_EMPTY[kind] ?? KIND_EMPTY['']}
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shown.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setPreview(item)}
                  className="group w-full overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-emerald-600/50 focus-visible:outline-none"
                  aria-label={`${item.fileName} প্রিভিউ করুন`}
                >
                  {item.kind === 'image' ? (
                    <img
                      src={item.url}
                      alt={item.fileName}
                      loading="lazy"
                      className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 bg-muted/50 text-muted-foreground">
                      {item.kind === 'video' ? (
                        <Film className="size-8 text-emerald-600/70 dark:text-emerald-400/70" aria-hidden="true" />
                      ) : item.kind === 'audio' ? (
                        <AudioLines className="size-8 text-emerald-600/70 dark:text-emerald-400/70" aria-hidden="true" />
                      ) : (
                        <FileText className="size-8 text-emerald-600/70 dark:text-emerald-400/70" aria-hidden="true" />
                      )}
                      <span className="text-[11px]">
                        {item.kind === 'video' ? 'ভিডিও' : item.kind === 'audio' ? 'অডিও' : 'নথি'}
                      </span>
                      {item.kind === 'video' && readVideoHonesty(item.meta).isProcedural && (
                        <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                          প্রসিডিউরাল ফ্রেম
                        </span>
                      )}
                    </span>
                  )}
                  <span className="block space-y-1 px-2.5 py-2">
                    <span className="block truncate text-xs font-medium" title={item.fileName}>
                      {item.fileName}
                    </span>
                    <span className="flex items-center justify-between gap-1.5">
                      <span
                        className="min-w-0 truncate text-[11px] text-muted-foreground"
                        title={new Date(item.createdAt).toLocaleString('bn-BD')}
                      >
                        {relativeTimeBn(item.createdAt)}
                      </span>
                      <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px] font-normal">
                        {ORIGIN_LABEL[item.origin] ?? item.origin}
                      </Badge>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {/* দীর্ঘ তালিকা: পেজিং */}
          <div className="flex flex-col items-center gap-2 pt-1">
            {visible < MAX_VISIBLE && filtered.length > visible && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
                onClick={() => setVisible(v => Math.min(v + PAGE_SIZE, MAX_VISIBLE))}
              >
                আরও দেখান
                <span className="text-xs opacity-80">
                  ({toBnDigits(Math.min(visible + PAGE_SIZE, MAX_VISIBLE, filtered.length))}/{toBnDigits(filtered.length)})
                </span>
              </Button>
            )}
            {filtered.length > MAX_VISIBLE && visible >= MAX_VISIBLE && (
              <p className="text-xs text-muted-foreground">
                মোট {toBnDigits(filtered.length)}টির মধ্যে প্রথম {toBnDigits(MAX_VISIBLE)}টি দেখানো হচ্ছে
              </p>
            )}
          </div>
        </>
      )}

      {/* শেয়ারড প্রিভিউ ডায়ালগ */}
      <Dialog open={preview !== null} onOpenChange={open => !open && setPreview(null)}>
        <DialogContent className={cn('sm:max-w-3xl', preview?.kind === 'text' && 'sm:max-w-xl')}>
          <DialogTitle className="truncate pr-8 text-sm font-medium">{preview?.fileName}</DialogTitle>
          <DialogDescription className="sr-only">ফাইলের প্রিভিউ</DialogDescription>
          {preview && (
            <div className="space-y-4">
              {preview.kind === 'image' && (
                <img
                  src={preview.url}
                  alt={preview.fileName}
                  className="mx-auto max-h-[62vh] w-auto rounded-lg border"
                />
              )}
              {preview.kind === 'video' && (
                <>
                  <video
                    controls
                    preload="metadata"
                    src={preview.url}
                    className="max-h-[60vh] w-full rounded-lg bg-black"
                    aria-label={preview.fileName}
                  />
                  {(() => {
                    const info = readVideoHonesty(preview.meta);
                    if (info.shotEngineLabels.length === 0 && !info.honestLabel) return null;
                    return <VideoHonestyCard info={info} />;
                  })()}
                </>
              )}
              {preview.kind === 'audio' && (
                <audio controls preload="metadata" src={preview.url} className="w-full" aria-label={preview.fileName} />
              )}
              {preview.kind === 'text' && <TextPreviewBody key={preview.id} item={preview} />}

              <div className="flex items-center justify-center gap-3">
                <Button
                  asChild
                  className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
                >
                  <a href={withDownloadParam(preview.url)} download>
                    <Download className="size-4" aria-hidden="true" />
                    ডাউনলোড
                  </a>
                </Button>
                {preview.conversationTitle && (
                  <span className="max-w-[45%] truncate text-xs text-muted-foreground" title={preview.conversationTitle}>
                    কথোপকথন: {preview.conversationTitle}
                  </span>
                )}
              </div>
              {formatSizeBn(preview.size) && (
                <p className="text-center text-xs text-muted-foreground">আকার: {formatSizeBn(preview.size)}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
