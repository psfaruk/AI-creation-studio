'use client';

// ============================================================
// RegistryView — Model & License Registry (মাস্টার প্ল্যান §৮, §৯.১)।
// - শীর্ষে "সিস্টেম" প্যানেল: হার্ডওয়্যার-চিপস + টুল-স্বাস্থ্য +
//   "পুনঃচেক" বোতাম (POST /api/system — use-system হুক, §৯)
// - অবস্থা-ভিত্তিক ভাঁজযোগ্য সেকশন: চালু/পরীক্ষামূলক/অবরুদ্ধ/পরিকল্পিত
// - প্রতি এন্ট্রিতে §৯.১ মেটাডেটা: task_type, supported_languages,
//   requires_gpu, max_duration_sec, fallback_tool, generation_time
//   — বাংলা লেবেলসহ সারি; বাকি capability-রা চিপ হিসেবে।
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  ChevronDown,
  Clock3,
  Cpu,
  ExternalLink,
  HardDrive,
  Info,
  Loader2,
  MemoryStick,
  MonitorCog,
  RefreshCcw,
  Search,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { RecheckError, useRecheckSystem, useSystemInfo, type SystemToolStatus } from '@/hooks/use-system';
import { toast } from '@/hooks/use-toast';
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
// §৯.১ মেটাডেটা-কী — বাংলা লেবেলসহ সারি হিসেবে রেন্ডার
// ------------------------------------------------------------

/** supported_languages অবজেক্টের কোড → বাংলা নাম */
const LANG_CODE_LABEL: Record<string, string> = {
  bn: 'বাংলা',
  en: 'ইংরেজি',
  prompt: 'প্রম্পট',
  instrumental: 'ইনস্ট্রুমেন্টাল',
};

interface HighlightedCap {
  key: string;
  render: () => { label: string; value: string; tone?: 'ok' | 'warn' };
}

/** চেনা capability-কীগুলো — বাংলা লেবেলে সুন্দরভাবে */
function buildHighlightedCaps(caps: Record<string, unknown>): HighlightedCap[] {
  const out: HighlightedCap[] = [];

  if (typeof caps.task_type === 'string' && caps.task_type) {
    out.push({
      key: 'task_type',
      render: () => ({ label: 'কাজের ধরন', value: caps.task_type as string }),
    });
  }

  const langs = caps.supported_languages;
  if (langs && typeof langs === 'object' && !Array.isArray(langs)) {
    for (const [code, val] of Object.entries(langs as Record<string, unknown>)) {
      out.push({
        key: `lang-${code}`,
        render: () => ({
          label: LANG_CODE_LABEL[code] ?? code,
          value: String(val),
          tone: String(val).includes('দুর্বল') || String(val).includes('আংশিক') ? 'warn' : 'ok',
        }),
      });
    }
  } else if (typeof langs === 'string' && langs) {
    out.push({
      key: 'supported_languages',
      render: () => ({ label: 'ভাষা', value: langs }),
    });
  }

  if (typeof caps.requires_gpu === 'boolean') {
    out.push({
      key: 'requires_gpu',
      render: () => ({
        label: 'GPU',
        value: caps.requires_gpu ? 'প্রয়োজন' : 'লাগে না',
        tone: caps.requires_gpu ? 'warn' : 'ok',
      }),
    });
  }

  if (typeof caps.max_duration_sec === 'number') {
    out.push({
      key: 'max_duration_sec',
      render: () => ({ label: 'সর্বোচ্চ দৈর্ঘ্য', value: `${toBnDigits(caps.max_duration_sec as number)} সেকেন্ড` }),
    });
  }

  if (typeof caps.generation_time === 'string' && caps.generation_time) {
    out.push({
      key: 'generation_time',
      render: () => ({ label: 'উৎপাদন-সময়', value: caps.generation_time as string }),
    });
  }

  if (typeof caps.fallback_tool === 'string' && caps.fallback_tool) {
    out.push({
      key: 'fallback_tool',
      render: () => ({ label: 'বিকল্প-টুল', value: caps.fallback_tool as string }),
    });
  }

  return out;
}

const HIGHLIGHTED_KEYS = new Set([
  'task_type',
  'supported_languages',
  'requires_gpu',
  'max_duration_sec',
  'generation_time',
  'fallback_tool',
]);

// ------------------------------------------------------------
// একটি এন্ট্রি কার্ড
// ------------------------------------------------------------

function ModelEntryCard({ entry }: { entry: ModelEntryView }) {
  const commercial = COMMERCIAL_META[entry.commercialUse] ?? COMMERCIAL_META.unknown;

  const highlighted = useMemo(
    () => buildHighlightedCaps(entry.capabilities ?? {}),
    [entry.capabilities],
  );
  const restCaps = useMemo(
    () => Object.entries(entry.capabilities ?? {}).filter(([k]) => !HIGHLIGHTED_KEYS.has(k)),
    [entry.capabilities],
  );

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

      {/* §৯.১ মেটাডেটা — বাংলা লেবেলসহ সারি */}
      {highlighted.length > 0 && (
        <dl className="mt-2 space-y-1" aria-label="মডেল-মেটাডেটা">
          {highlighted.map(cap => {
            const { label, value, tone } = cap.render();
            return (
              <div key={cap.key} className="flex items-start gap-1.5 text-xs leading-relaxed">
                <dt className="shrink-0 text-muted-foreground">{label}:</dt>
                <dd
                  className={cn(
                    'min-w-0 flex-1',
                    tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : 'text-foreground/90',
                  )}
                >
                  {value}
                </dd>
              </div>
            );
          })}
        </dl>
      )}

      {restCaps.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="অন্যান্য সক্ষমতা">
          {restCaps.map(([k, v]) => {
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
// সিস্টেম প্যানেল (§৯) — হার্ডওয়্যার + টুল-স্বাস্থ্য + পুনঃচেক
// ------------------------------------------------------------

const TOOL_STATUS_META: Record<SystemToolStatus, { label: string; dot: string; badge: string }> = {
  ok: {
    label: 'সচল',
    dot: 'bg-emerald-500',
    badge: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400',
  },
  degraded: {
    label: 'অবনত',
    dot: 'bg-amber-500',
    badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  down: {
    label: 'বন্ধ',
    dot: 'bg-red-500',
    badge: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
  },
  unknown: {
    label: 'অজানা',
    dot: 'bg-muted-foreground/50',
    badge: 'border-muted bg-muted text-muted-foreground',
  },
};

function HardwareChip({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <span
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-xs shadow-sm"
      title={`${label}: ${value}`}
    >
      <Icon className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="max-w-44 truncate font-medium">{value}</span>
    </span>
  );
}

function SystemPanel() {
  const { data, isLoading, isError, refetch, isFetching } = useSystemInfo();
  const recheck = useRecheckSystem();

  const handleRecheck = () => {
    recheck.mutate(undefined, {
      onError: (error) => {
        if (error instanceof RecheckError && error.status === 429) {
          toast({
            title: 'রেট-সীমা — কিছুক্ষণ পরে চেষ্টা করুন',
            description: 'স্বাস্থ্য-চেক খরচবহুল, তাই ঘন ঘন চালানো সীমিত।',
            variant: 'destructive',
          });
        } else {
          toast({ title: 'পুনঃচেক ব্যর্থ হয়েছে', variant: 'destructive' });
        }
      },
    });
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card px-4 py-4 shadow-sm">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MonitorCog className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          সিস্টেম
        </p>
        <div className="space-y-2">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-8 w-1/2" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="size-4 shrink-0 text-red-500" aria-hidden="true" />
          সিস্টেম-তথ্য লোড করা যায়নি।
        </p>
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void refetch()}>
          <RefreshCcw className="size-4" aria-hidden="true" />
          আবার
        </Button>
      </div>
    );
  }

  const hw = data.hardware;

  return (
    <section className="rounded-xl border bg-card px-4 py-4 shadow-sm" aria-labelledby="system-panel-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="system-panel-title" className="flex items-center gap-2 text-sm font-semibold">
          <MonitorCog className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          সিস্টেম
          <span className="text-xs font-normal text-muted-foreground">
            (শেষ চেক: {relativeTimeBn(data.checkedAt)})
          </span>
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
          onClick={handleRecheck}
          disabled={recheck.isPending || isFetching}
        >
          {recheck.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCcw className="size-4" aria-hidden="true" />
          )}
          {recheck.isPending ? 'চেক হচ্ছে… (মাইক্রো-কল)' : 'পুনঃচেক'}
        </Button>
      </div>

      {/* হার্ডওয়্যার-চিপস */}
      <div className="flex flex-wrap gap-2" aria-label="হার্ডওয়্যার">
        <HardwareChip icon={Cpu} label="CPU" value={`${toBnDigits(hw.cpuCores)} কোর`} />
        <HardwareChip icon={MemoryStick} label="RAM" value={`${toBnDigits(hw.totalMemGb)}GB মোট · ${toBnDigits(hw.freeMemGb)}GB খালি`} />
        <HardwareChip icon={HardDrive} label="ডিস্ক" value={`${toBnDigits(hw.diskFreeGb)}GB খালি / ${toBnDigits(hw.diskTotalGb)}GB`} />
        <HardwareChip icon={Cpu} label="GPU" value={hw.gpu.present ? 'আছে' : hw.gpu.note ?? 'নেই'} />
        <HardwareChip icon={Wrench} label="FFmpeg" value={hw.ffmpeg.split('-')[0]} />
        <HardwareChip icon={Info} label="Node" value={hw.nodeVersion} />
      </div>

      {/* টুল-স্বাস্থ্য তালিকা */}
      <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1" aria-label="টুল-স্বাস্থ্য">
        {data.tools.map((tool) => {
          const meta = TOOL_STATUS_META[tool.status] ?? TOOL_STATUS_META.unknown;
          return (
            <li
              key={tool.key}
              className="flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2"
            >
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', meta.dot)} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-medium">
                  {tool.label}
                  <Badge variant="outline" className={cn('h-auto px-1.5 py-0 text-[10px]', meta.badge)}>
                    {meta.label}
                  </Badge>
                  {typeof tool.latencyMs === 'number' && tool.latencyMs > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] tabular-nums text-muted-foreground">
                      <Clock3 className="size-3" aria-hidden="true" />
                      {toBnDigits(tool.latencyMs)} মি.সে.
                    </span>
                  )}
                  {tool.checkedAt && (
                    <span className="text-[10px] text-muted-foreground/80">
                      ({relativeTimeBn(tool.checkedAt)})
                    </span>
                  )}
                </span>
                {tool.note && (
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                    {tool.note}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {data.note && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {data.note}
        </p>
      )}
    </section>
  );
}

/** লোকাল QueryClient-প্রভাইডার — use-system-এর useQuery-এর জন্য */
function SystemPanelWithProvider() {
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
      <SystemPanel />
    </QueryClientProvider>
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

      {/* সিস্টেম-প্যানেল (§৯) */}
      <SystemPanelWithProvider />

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
          <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
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
