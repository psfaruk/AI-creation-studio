'use client';

// ============================================================
// RegistryView — Model & License Registry (মাস্টার প্ল্যান §৮, §৯.১)
// + Model & Tool Availability Matrix (নতুন পরিকল্পনা §১৫-এর প্রথম
// Deliverable — চার-মাত্রিক সৎ রায়)।
//
// - শীর্ষে "অ্যাভেইলেবিলিটি ম্যাট্রিক্স" প্যানেল: usageMode-ঘোষণা +
//   ফিল্টার-চিপ + প্রসারণযোগ্য সারি (apiEndpoint / শেষ পরীক্ষা /
//   সৎ-নোট / বিকল্প / প্রকৃত-কারণ) + লেজেন্ড — GET /api/availability
// - তারপর "সিস্টেম" প্যানেল (§৯): হার্ডওয়্যার-চিপস + টুল-স্বাস্থ্য +
//   "পুনঃচেক" (POST /api/system)
// - অবস্থা-ভিত্তিক ভাঁজযোগ্য সেকশন: চালু/পরীক্ষামূলক/অবরুদ্ধ/পরিকল্পিত
//   ("অবরুদ্ধ" শুধু প্রকৃত লাইসেন্স-বাধায় — এখন কেউই নয়, তাই সৎ নোট)
// - প্রতি এন্ট্রিতে §৯.১ মেটাডেটা + চার-মাত্রিক চিপ + API + পরীক্ষা-নোট
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
  History,
  Info,
  Loader2,
  MemoryStick,
  MonitorCog,
  RefreshCcw,
  Search,
  ShieldCheck,
  TableProperties,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { formatDateBn, relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';
import {
  DimensionChip,
  INTEGRATION_META,
  LICENSE_META,
  OverallBadge,
  PROVIDER_META,
  RUNTIME_META,
  type AvailMeta,
} from '@/components/studio/availability-badges';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAvailability } from '@/hooks/use-availability';
import { RecheckError, useRecheckSystem, useSystemInfo, type SystemToolStatus } from '@/hooks/use-system';
import { toast } from '@/hooks/use-toast';
import type { AvailabilityMatrixRow, MatrixOverall, ModelEntryView, ModelStatus } from '@/lib/types';
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
// একটি এন্ট্রি কার্ড (§৯.১ + চার-মাত্রিক স্ট্যাটাস)
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

  const hasDims = Boolean(entry.licenseStatus || entry.providerStatus || entry.integrationStatus || entry.runtimeStatus);

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

      {/* চার-মাত্রিক স্ট্যাটাস-চিপ (নতুন পরিকল্পনা §২) */}
      {hasDims && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="চার-মাত্রিক স্ট্যাটাস">
          {entry.licenseStatus && <DimensionChip dimension="লাইসেন্স" meta={LICENSE_META[entry.licenseStatus]} />}
          {entry.providerStatus && <DimensionChip dimension="প্রোভাইডার" meta={PROVIDER_META[entry.providerStatus]} />}
          {entry.integrationStatus && <DimensionChip dimension="ইন্টিগ্রেশন" meta={INTEGRATION_META[entry.integrationStatus]} />}
          {entry.runtimeStatus && <DimensionChip dimension="রানটাইম" meta={RUNTIME_META[entry.runtimeStatus]} />}
        </div>
      )}

      {/* সংশ্লিষ্ট টুল */}
      {entry.tools && entry.tools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="সংশ্লিষ্ট টুল">
          {entry.tools.map((tool) => (
            <span
              key={tool}
              title={tool}
              className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {tool}
            </span>
          ))}
        </div>
      )}

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

      {/* API-পথ */}
      {entry.apiEndpoint && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[11px]">
          <span className="shrink-0 text-muted-foreground">API:</span>
          <code className="break-all rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground/90">
            {entry.apiEndpoint}
          </code>
          {entry.apiModelId && <span className="text-muted-foreground">({entry.apiModelId})</span>}
        </p>
      )}

      {/* শেষ পরীক্ষা */}
      {(entry.lastTestedAt || entry.lastTestNote) && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <History className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            শেষ পরীক্ষা{entry.lastTestedAt ? `: ${formatDateBn(entry.lastTestedAt)}` : ''}
            {entry.lastTestNote ? ` — ${entry.lastTestNote}` : ''}
          </span>
        </p>
      )}

      {/* প্রকৃত বাধার কারণ (লাইসেন্স নয় যদি না হয়) */}
      {entry.errorReason && (
        <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-semibold">অনুপলব্ধতার প্রকৃত কারণ: </span>
            {entry.errorReason}
          </span>
        </p>
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
// অ্যাভেইলেবিলিটি ম্যাট্রিক্স প্যানেল (§১৫-এর প্রথম Deliverable)
// ------------------------------------------------------------

type MatrixFilter = MatrixOverall | 'all';

const MATRIX_FILTERS: Array<{ key: MatrixFilter; label: string }> = [
  { key: 'all', label: 'সব' },
  { key: 'available', label: 'চালু' },
  { key: 'available_with_limits', label: 'সীমাসহ' },
  { key: 'experimental', label: 'পরীক্ষামূলক' },
  { key: 'unavailable_here', label: 'অনুপলব্ধ' },
  { key: 'future', label: 'ভবিষ্যৎ' },
];

/** ডেস্কটপ টেবিল-গ্রিড: ক্ষমতা + ৪ মাত্রা + সামগ্রিক */
const MATRIX_GRID_COLS =
  'md:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)]';

/** ম্যাট্রিক্সের একটি প্রসারণযোগ্য সারি */
function MatrixRow({ row, legend }: { row: AvailabilityMatrixRow; legend: Record<string, string> }) {
  const [open, setOpen] = useState(false);

  const dims: Array<{ dimension: string; meta: AvailMeta; legendText: string }> = [
    { dimension: 'লাইসেন্স', meta: LICENSE_META[row.license], legendText: legend[row.license] ?? LICENSE_META[row.license].title },
    { dimension: 'প্রোভাইডার', meta: PROVIDER_META[row.provider], legendText: legend[row.provider] ?? PROVIDER_META[row.provider].title },
    { dimension: 'ইন্টিগ্রেশন', meta: INTEGRATION_META[row.integration], legendText: legend[row.integration] ?? INTEGRATION_META[row.integration].title },
    { dimension: 'রানটাইম', meta: RUNTIME_META[row.runtime], legendText: legend[row.runtime] ?? RUNTIME_META[row.runtime].title },
  ];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'overflow-hidden rounded-lg border bg-card',
          row.overall === 'future' && 'border-dashed border-stone-400/60',
        )}
      >
        <CollapsibleTrigger
          className="flex min-h-11 w-full flex-col gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-600/50 md:gap-0 md:py-2"
          aria-expanded={open}
        >
          {/* মোবাইল: স্ট্যাকড কার্ড */}
          <div className="flex flex-col gap-2 md:hidden">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs leading-snug font-semibold">{row.capability}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{row.model}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                <OverallBadge overall={row.overall} />
                <ChevronDown
                  className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                  aria-hidden="true"
                />
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {dims.map(d => (
                <DimensionChip key={d.dimension} dimension={d.dimension} meta={d.meta} />
              ))}
            </div>
          </div>

          {/* ডেস্কটপ: টেবিল-সারি */}
          <div className={cn('hidden items-center gap-x-3 md:grid', MATRIX_GRID_COLS)}>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold" title={row.capability}>
                {row.capability}
              </p>
              <p className="truncate text-[11px] text-muted-foreground" title={row.model}>
                {row.model}
              </p>
              {row.tools.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {row.tools.slice(0, 2).map(tool => (
                    <span
                      key={tool}
                      title={tool}
                      className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 text-[9px] text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                  {row.tools.length > 2 && (
                    <span className="text-[9px] text-muted-foreground">+{toBnDigits(row.tools.length - 2)}</span>
                  )}
                </div>
              )}
            </div>
            <DimensionChip meta={LICENSE_META[row.license]} withPrefix={false} />
            <DimensionChip meta={PROVIDER_META[row.provider]} withPrefix={false} />
            <DimensionChip meta={INTEGRATION_META[row.integration]} withPrefix={false} />
            <DimensionChip meta={RUNTIME_META[row.runtime]} withPrefix={false} />
            <span className="flex items-center justify-between gap-1">
              <OverallBadge overall={row.overall} />
              <ChevronDown
                className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                aria-hidden="true"
              />
            </span>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-2.5 border-t px-3 py-3 sm:px-4">
            {/* চার-মাত্রিক বিশ্লেষণ — কোন মাত্রা বাধা তা স্পষ্ট */}
            <dl className="grid gap-2 sm:grid-cols-2" aria-label="চার-মাত্রিক স্ট্যাটাস বিশ্লেষণ">
              {dims.map(d => (
                <div key={d.dimension} className="flex items-start gap-1.5">
                  <dt className="shrink-0 text-[11px] font-medium text-muted-foreground">{d.dimension}:</dt>
                  <dd className="min-w-0 flex-1">
                    <DimensionChip meta={d.meta} withPrefix={false} />
                    <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{d.legendText}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <dl className="space-y-1 text-xs leading-relaxed">
              {row.apiEndpoint && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 text-muted-foreground">API:</dt>
                  <dd className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground/90">
                    {row.apiEndpoint}
                    {row.apiModelId ? ` (${row.apiModelId})` : ''}
                  </dd>
                </div>
              )}
              {row.lastTestedAt && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 text-muted-foreground">শেষ পরীক্ষা:</dt>
                  <dd className="min-w-0 flex-1 text-foreground/90">
                    {formatDateBn(row.lastTestedAt)}
                    {row.lastTestNote ? ` — ${row.lastTestNote}` : ''}
                  </dd>
                </div>
              )}
              {row.honestNote && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 text-muted-foreground">সৎ-নোট:</dt>
                  <dd className="min-w-0 flex-1 text-foreground/90">{row.honestNote}</dd>
                </div>
              )}
              {row.fallback && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 text-muted-foreground">বিকল্প-পথ:</dt>
                  <dd className="min-w-0 flex-1 text-emerald-700 dark:text-emerald-400">{row.fallback}</dd>
                </div>
              )}
              {row.tools.length > 0 && (
                <div className="flex gap-1.5">
                  <dt className="shrink-0 text-muted-foreground">টুল:</dt>
                  <dd className="flex min-w-0 flex-1 flex-wrap gap-1">
                    {row.tools.map(tool => (
                      <span
                        key={tool}
                        title={tool}
                        className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                      >
                        {tool}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>

            {row.errorReason && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">অনুপলব্ধতার প্রকৃত কারণ: </span>
                  {row.errorReason}
                </span>
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function AvailabilityMatrixPanel() {
  const { data, isLoading, isError, refetch } = useAvailability();
  const [filter, setFilter] = useState<MatrixFilter>('all');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0 };
    for (const r of data?.matrix ?? []) {
      c.all += 1;
      c[r.overall] = (c[r.overall] ?? 0) + 1;
    }
    return c;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    return filter === 'all' ? data.matrix : data.matrix.filter(r => r.overall === filter);
  }, [data, filter]);

  if (isLoading) {
    return (
      <section className="rounded-xl border bg-card px-4 py-4 shadow-sm" aria-busy="true" aria-labelledby="availability-matrix-title">
        <p id="availability-matrix-title" className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <TableProperties className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          মডেল ও টুল অ্যাভেইলেবিলিটি ম্যাট্রিক্স
        </p>
        <div className="space-y-2">
          <Skeleton className="h-9 w-2/3" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="size-4 shrink-0 text-red-500" aria-hidden="true" />
          ম্যাট্রিক্স লোড করা যায়নি।
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => void refetch()}
        >
          <RefreshCcw className="size-4" aria-hidden="true" />
          আবার
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-xl border bg-card px-4 py-4 shadow-sm" aria-labelledby="availability-matrix-title">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <h2 id="availability-matrix-title" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <TableProperties className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          মডেল ও টুল অ্যাভেইলেবিলিটি ম্যাট্রিক্স
          <span className="text-xs font-normal text-muted-foreground">
            ({toBnDigits(data.matrix.length)} ক্ষমতা)
          </span>
        </h2>
        <span className="text-[11px] text-muted-foreground">তৈরি: {relativeTimeBn(data.generatedAt)}</span>
      </div>

      {/* ব্যবহার-ধারার ঘোষণা (লাইসেন্স-রায়ের ভিত্তি) */}
      <div className="mb-3 rounded-lg border border-emerald-600/30 bg-emerald-600/5 px-3 py-2.5">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs font-medium">
          <span>
            পরিবেশ: <span className="font-normal text-foreground/90">{data.usageMode.environment}</span>
          </span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span>
            ব্যবহার: <span className="font-normal text-foreground/90">{data.usageMode.usage}</span>
          </span>
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {data.usageMode.note}
        </p>
      </div>

      {/* ফিল্টার-চিপ (সামগ্রিক অবস্থা অনুযায়ী) */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="সামগ্রিক অবস্থা অনুযায়ী ফিল্টার">
        {MATRIX_FILTERS.map(f => {
          const active = filter === f.key;
          const count = counts[f.key] ?? 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={active}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium transition-colors',
                active
                  ? 'border-emerald-600/50 bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/15 dark:text-emerald-400'
                  : 'bg-card text-muted-foreground hover:bg-muted/50',
              )}
            >
              {f.label}
              <span className="text-[10px] tabular-nums opacity-70">{toBnDigits(count)}</span>
            </button>
          );
        })}
      </div>

      {/* ডেস্কটপ টেবিল-হেডার */}
      <div
        className={cn('mb-1.5 hidden px-3 text-[11px] font-medium text-muted-foreground md:grid', MATRIX_GRID_COLS)}
        aria-hidden="true"
      >
        <span>ক্ষমতা</span>
        <span>লাইসেন্স</span>
        <span>প্রোভাইডার</span>
        <span>ইন্টিগ্রেশন</span>
        <span>রানটাইম</span>
        <span>সামগ্রিক</span>
      </div>

      {/* সারি-তালিকা (লম্বা হলে স্ক্রল) */}
      {rows.length === 0 ? (
        <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
          এই ফিল্টারে কোনো সারি নেই।
        </p>
      ) : (
        <div
          className="grid max-h-[28rem] grid-cols-1 gap-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
          aria-label="অ্যাভেইলেবিলিটি ম্যাট্রিক্স সারিসমূহ"
        >
          {rows.map(row => (
            <MatrixRow key={row.key} row={row} legend={data.legend} />
          ))}
        </div>
      )}

      {/* লেজেন্ড */}
      <div className="mt-3 border-t pt-2.5">
        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">লেজেন্ড</p>
        <div className="flex flex-wrap gap-1">
          {Object.entries(data.legend).map(([legendKey, legendText]) => (
            <span
              key={legendKey}
              className="rounded-full border bg-muted/40 px-2 py-0.5 text-[10px] leading-relaxed text-muted-foreground"
            >
              {legendText}
            </span>
          ))}
        </div>
      </div>
    </section>
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

// ------------------------------------------------------------
// মূল ভিউ
// ------------------------------------------------------------

function RegistryViewInner() {
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
  const blockedCount = totalByStatus.blocked ?? 0;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          মডেল ও লাইসেন্স রেজিস্ট্রি
        </h1>
        <p className="text-sm text-muted-foreground">কোন মডেল কী লাইসেন্সে চালু — স্বচ্ছতার সর্বজনীন তালিকা</p>
      </header>

      {/* অ্যাভেইলেবিলিটি ম্যাট্রিক্স (§১৫ — প্রথম Deliverable, শীর্ষে) */}
      <AvailabilityMatrixPanel />

      {/* সিস্টেম-প্যানেল (§৯) */}
      <SystemPanel />

      {/* সারাংশ-স্ট্রিপ + সততা-নোট */}
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
            <span className={cn(blockedCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
              {toBnDigits(blockedCount)}
            </span>{' '}
            অবরুদ্ধ (লাইসেন্সে)
          </span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span>
            <span className="text-muted-foreground">{toBnDigits(totalByStatus.planned ?? 0)}</span> পরিকল্পিত
          </span>
        </p>
        <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
          {blockedCount === 0
            ? 'কোনো মডেল লাইসেন্স-অবরুদ্ধ নয় — অনুপলব্ধতার প্রকৃত কারণ (হার্ডওয়্যার/API/ইন্টিগ্রেশন) উপরের ম্যাট্রিক্সে দেখুন।'
            : 'অবরুদ্ধ মডেলের প্রকৃত কারণ (লাইসেন্স বনাম হার্ডওয়্যার/API) উপরের ম্যাট্রিক্সে মাত্রা-ভিত্তিক দেখানো হয়েছে।'}
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

/** লোকাল QueryClient-প্রভাইডার — use-system + use-availability উভয়ের জন্য */
export function RegistryView() {
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
      <RegistryViewInner />
    </QueryClientProvider>
  );
}
