'use client';

// ============================================================
// RegistryView — Model & License Registry (মাস্টার প্ল্যান §৮)।
// - অবস্থা-ভিত্তিক ভাঁজযোগ্য সেকশন: চালু/পরীক্ষামূলক/অবরুদ্ধ/পরিকল্পিত
// - শীর্ষ সারাংশ-স্ট্রিপ + নীতি-নোট, নাম/লাইসেন্স অনুসন্ধান
// - প্রতি এন্ট্রিতে: ক্যাটাগরি ও বাণিজ্যিক-ব্যবহার ব্যাজ, সক্ষমতা-চিপ,
//   হার্ডওয়্যার-নোট ও টীকা
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Cpu,
  ExternalLink,
  Info,
  RefreshCcw,
  Search,
  ShieldCheck,
} from 'lucide-react';

import { toBnDigits } from '@/components/chat/bn-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { ModelEntryView, ModelStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// লেবেল ম্যাপ
// ------------------------------------------------------------

interface SectionMeta {
  key: ModelStatus;
  label: string;
  className: string;
  dotClass: string;
}

const SECTIONS: SectionMeta[] = [
  {
    key: 'enabled',
    label: 'চালু',
    className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
  },
  {
    key: 'experimental',
    label: 'পরীক্ষামূলক',
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    dotClass: 'bg-amber-500',
  },
  {
    key: 'blocked',
    label: 'অবরুদ্ধ',
    className: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
    dotClass: 'bg-red-500',
  },
  {
    key: 'planned',
    label: 'পরিকল্পিত',
    className: 'border-muted bg-muted text-muted-foreground',
    dotClass: 'bg-muted-foreground/50',
  },
];

const COMMERCIAL_META: Record<string, { label: string; className: string }> = {
  allowed: { label: 'বাণিজ্যিক-সম্মত', className: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400' },
  restricted: { label: 'সীমিত', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  unknown: { label: 'অজানা', className: 'border-muted bg-muted text-muted-foreground' },
  not_applicable: { label: 'প্রযোজ্য নয়', className: 'border-muted bg-muted text-muted-foreground' },
};

const CATEGORY_LABEL: Record<string, string> = {
  llm: 'LLM',
  image: 'ছবি',
  audio: 'অডিও',
  video: 'ভিডিও',
  utility: 'সহায়ক',
  infrastructure: 'অবকাঠামো',
};

/** সক্ষমতার মান স্ট্রিং-এ রূপান্তর — সর্বোচ্চ ২৪ অক্ষর */
function stringifyCapability(value: unknown): string {
  let s: string;
  if (Array.isArray(value)) s = value.map(String).join(', ');
  else if (typeof value === 'string') s = value;
  else s = String(value);
  return s.length > 24 ? `${s.slice(0, 23)}…` : s;
}

// ------------------------------------------------------------
// একটি এন্ট্রি কার্ড
// ------------------------------------------------------------

function ModelEntryCard({ entry }: { entry: ModelEntryView }) {
  const commercial = COMMERCIAL_META[entry.commercialUse] ?? COMMERCIAL_META.unknown;
  const capabilities = Object.entries(entry.capabilities ?? {});

  return (
    <li className="rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-sm font-semibold">{entry.name}</p>
        <Badge variant="secondary" className="text-[11px] font-normal">
          {CATEGORY_LABEL[entry.category] ?? entry.category}
        </Badge>
        <Badge variant="outline" className={cn('text-[11px]', commercial.className)}>
          {commercial.label}
        </Badge>
      </div>

      <p className="mt-1 text-xs text-muted-foreground">
        সরবরাহকারী: {entry.provider} · লাইসেন্স: {entry.license}
        {entry.licenseUrl && (
          <>
            {' · '}
            <a
              href={entry.licenseUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline dark:text-emerald-400"
            >
              লাইসেন্স-লিংক
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </>
        )}
      </p>

      {capabilities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="সক্ষমতা">
          {capabilities.map(([k, v]) => {
            const full = `${k}: ${Array.isArray(v) ? v.map(String).join(', ') : String(v)}`;
            return (
              <span
                key={k}
                title={full}
                className="max-w-full truncate rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {k}: {stringifyCapability(v)}
              </span>
            );
          })}
        </div>
      )}

      {entry.hardwareNotes && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Cpu className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          হার্ডওয়্যার: {entry.hardwareNotes}
        </p>
      )}
      {entry.notes && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {entry.notes}
        </p>
      )}
    </li>
  );
}

// ------------------------------------------------------------
// মূল ভিউ
// ------------------------------------------------------------

export function RegistryView() {
  const [entries, setEntries] = useState<ModelEntryView[] | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState('');
  // ডিফল্ট: "চালু" খোলা, বাকি ভাঁজা
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ enabled: true });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setEntries(null);
      setError(false);
      try {
        const res = await fetch('/api/registry');
        if (!res.ok) throw new Error('সার্ভার সমস্যা');
        const list = (await res.json()) as ModelEntryView[];
        if (!cancelled) setEntries(list);
      } catch {
        if (!cancelled) {
          setEntries([]);
          setError(true);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const q = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    const map: Record<string, ModelEntryView[]> = {};
    for (const meta of SECTIONS) map[meta.key] = [];
    for (const e of entries ?? []) {
      if (!map[e.status]) map[e.status] = [];
      map[e.status].push(e);
    }
    if (q) {
      // অনুসন্ধানে নাম বা লাইসেন্স মেলাও
      for (const meta of SECTIONS) {
        map[meta.key] = map[meta.key].filter(
          e => e.name.toLowerCase().includes(q) || e.license.toLowerCase().includes(q),
        );
      }
    }
    return map;
  }, [entries, q]);

  const totalByStatus = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries ?? []) c[e.status] = (c[e.status] ?? 0) + 1;
    return c;
  }, [entries]);

  const searching = q.length > 0;
  const anyResult = SECTIONS.some(meta => (grouped[meta.key] ?? []).length > 0);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          মডেল ও লাইসেন্স রেজিস্ট্রি
        </h1>
        <p className="text-sm text-muted-foreground">কোন মডেল কী লাইসেন্সে চালু — স্বচ্ছতার সর্বজনীন তালিকা</p>
      </header>

      {/* সারাংশ-স্ট্রিপ + নীতি-নোট */}
      <div className="rounded-xl border border-emerald-600/30 bg-emerald-600/5 px-4 py-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium" aria-label="অবস্থা অনুযায়ী গণনা">
          <span>
            <span className="text-emerald-700 dark:text-emerald-400">{toBnDigits(totalByStatus.enabled ?? 0)}</span> চালু
          </span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span>
            <span className="text-amber-700 dark:text-amber-400">{toBnDigits(totalByStatus.experimental ?? 0)}</span> পরীক্ষামূলক
          </span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span>
            <span className="text-red-600 dark:text-red-400">{toBnDigits(totalByStatus.blocked ?? 0)}</span> অবরুদ্ধ
          </span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span>
            <span className="text-muted-foreground">{toBnDigits(totalByStatus.planned ?? 0)}</span> পরিকল্পিত
          </span>
        </p>
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          অযাচাইকৃত বা নন-কমার্শিয়াল মডেল উৎপাদনে ব্যবহৃত হয় না।
        </p>
      </div>

      {/* অনুসন্ধান */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="নাম বা লাইসেন্স খুঁজুন"
          aria-label="নাম বা লাইসেন্স খুঁজুন"
          className="min-h-11 bg-card pl-9"
        />
      </div>

      {entries === null ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-4 py-10 text-center">
          <AlertCircle className="size-6 text-red-500" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">রেজিস্ট্রি লোড করা যায়নি।</p>
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
      ) : !anyResult ? (
        <p className="rounded-xl border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          কিছু পাওয়া যায়নি — অন্য নাম বা লাইসেন্স দিয়ে খুঁজে দেখুন।
        </p>
      ) : (
        <div className="space-y-3">
          {SECTIONS.map(meta => {
            const list = grouped[meta.key] ?? [];
            if (list.length === 0) return null;
            const isOpen = searching ? true : (openSections[meta.key] ?? false);
            return (
              <Collapsible
                key={meta.key}
                open={isOpen}
                onOpenChange={open => setOpenSections(prev => ({ ...prev, [meta.key]: open }))}
              >
                <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <CollapsibleTrigger
                    className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-sm font-medium transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600/50"
                    aria-expanded={isOpen}
                  >
                    <span className={cn('size-2 shrink-0 rounded-full', meta.dotClass)} aria-hidden="true" />
                    {meta.label}
                    <Badge variant="outline" className={cn('text-[11px]', meta.className)}>
                      {toBnDigits(list.length)}
                    </Badge>
                    <ChevronDown
                      className={cn('ml-auto size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')}
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="border-t px-4 py-3">
                    <ul className="space-y-2.5">
                      {list.map(e => (
                        <ModelEntryCard key={e.id} entry={e} />
                      ))}
                    </ul>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
