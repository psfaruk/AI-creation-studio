'use client';

// ============================================================
// HardwarePanel — হার্ডওয়্যার-সচেতন মডেল ম্যানেজার
// (নতুন পরিকল্পনা §১০ — দশম ধাপ)। GET /api/hardware।
//
// - সেকশন A: হার্ডওয়্যার-প্রোফাইল সারাংশ-কার্ড (CPU/RAM/ডিস্ক/GPU/
//   FFmpeg/প্ল্যাটফর্ম) — HardwareReport থেকে।
// - সেকশন B: প্রতি-মডেল রায় (৯-অবস্থার HardwareVerdict) — বাংলা
//   কারণ + বিকল্প-পথসহ। লম্বা তালিকা max-h-96 পাতলা স্ক্রলবারে।
// - সৎ ফুটার: GPU-না-থাকা স্থায়ী নিষেধ নয় — পরিবেশ বদলালে রায়
//   বদলাবে (probedAt-সহ)।
//
// রঙ-চুক্তি: emerald=প্রস্তুত, amber=যাচাই/সীমা-বাকি,
// stone=হার্ডওয়্যার-বাধা (blue/indigo নিষিদ্ধ)।
// ============================================================

import {
  AlertCircle,
  CircuitBoard,
  ClipboardCheck,
  Cpu,
  HardDrive,
  Info,
  Loader2,
  MemoryStick,
  MonitorCog,
  RefreshCcw,
  Terminal,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import { relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useHardware } from '@/hooks/use-hardware';
import type { HardwareVerdict } from '@/lib/types';
import { cn } from '@/lib/utils';

// ------------------------------------------------------------
// রায় → বাংলা লেবেল + রঙ (৯-অবস্থা)
// ------------------------------------------------------------

const EMERALD = 'border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400';
const AMBER = 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400';
const STONE = 'border-stone-400/50 bg-stone-400/10 text-stone-600 dark:text-stone-300';

interface VerdictMeta {
  label: string;
  className: string;
}

const VERDICT_META: Record<HardwareVerdict, VerdictMeta> = {
  ready: { label: 'প্রস্তুত', className: EMERALD },
  ready_with_limits: { label: 'সীমাসহ প্রস্তুত', className: EMERALD },
  needs_gpu: { label: 'GPU দরকার', className: STONE },
  needs_more_ram: { label: 'আরও RAM দরকার', className: STONE },
  needs_model_download: { label: 'মডেল-ডাউনলোড দরকার', className: STONE },
  license_review_required: { label: 'লাইসেন্স-যাচাই দরকার', className: AMBER },
  provider_rate_limited: { label: 'প্রোভাইডার-রেট-সীমা', className: AMBER },
  integration_incomplete: { label: 'ইন্টিগ্রেশন অসম্পূর্ণ', className: AMBER },
  quality_not_verified: { label: 'মান-যাচাই বাকি', className: AMBER },
};

const UNKNOWN_VERDICT: VerdictMeta = { label: 'অজানা রায়', className: STONE };

/** রানটাইম-সুরক্ষা: চুক্তির বাইরের মান এলেও ভিউ না ভেঙে সৎ লেবেল */
function verdictMeta(verdict: string): VerdictMeta {
  return (VERDICT_META as Record<string, VerdictMeta | undefined>)[verdict] ?? UNKNOWN_VERDICT;
}

/** সংখ্যা-ক্ষেত্রের সুরক্ষিত বাংলা রূপ (অনুপস্থিত হলে '—') */
function bnNum(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? toBnDigits(value) : '—';
}

// ------------------------------------------------------------
// সেকশন A — প্রোফাইল সারাংশ-কার্ড
// ------------------------------------------------------------

function ProfileCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-lg border bg-muted/30 px-3 py-2.5"
      title={sub ? `${label}: ${value} — ${sub}` : `${label}: ${value}`}
    >
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold" title={value}>
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 truncate text-[11px] leading-relaxed text-muted-foreground" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// মূল প্যানেল
// ------------------------------------------------------------

export function HardwarePanel() {
  const { data, loading, error, refresh } = useHardware();

  // প্রাথমিক লোডিং — কঙ্কাল-স্টেট
  if (loading && !data) {
    return (
      <section
        className="rounded-xl border bg-card px-4 py-4 shadow-sm"
        aria-busy="true"
        aria-labelledby="hardware-panel-title"
      >
        <p id="hardware-panel-title" className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MonitorCog className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          হার্ডওয়্যার-পরিমাপ ও মডেল-রায়
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[4.5rem] rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-3 h-24 rounded-lg" />
      </section>
    );
  }

  // এরর — ছোট ইনলাইন বার্তা + পুনঃচেষ্টা (ভিউ কখনো ক্র্যাশ করে না)
  if (error || !data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
        <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <AlertCircle className="size-4 shrink-0 text-red-500" aria-hidden="true" />
          {error ?? 'হার্ডওয়্যার-পরিমাপ ও মডেল-রায় আনা যায়নি।'}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCcw className="size-4" aria-hidden="true" />
          )}
          আবার
        </Button>
      </div>
    );
  }

  const p = data.profile;
  const assessments = Array.isArray(data.assessments) ? data.assessments : [];
  const ffmpegVersion =
    typeof p.ffmpeg === 'string' && p.ffmpeg ? p.ffmpeg.split('-')[0] : null;
  const ffprobeVersion =
    typeof p.ffprobe === 'string' && p.ffprobe ? p.ffprobe.split('-')[0] : null;

  return (
    <section className="rounded-xl border bg-card px-4 py-4 shadow-sm" aria-labelledby="hardware-panel-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="hardware-panel-title" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <MonitorCog className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          হার্ডওয়্যার-পরিমাপ ও মডেল-রায়
          {data.probedAt && (
            <span className="text-xs font-normal text-muted-foreground">
              (শেষ পরিমাপ: {relativeTimeBn(data.probedAt)})
            </span>
          )}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 dark:text-emerald-400"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCcw className="size-4" aria-hidden="true" />
          )}
          পুনঃমাপ
        </Button>
      </div>

      {/* সেকশন A — প্রোফাইল সারাংশ */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="হার্ডওয়্যার-প্রোফাইল">
        <ProfileCard
          icon={Cpu}
          label="CPU"
          value={`${bnNum(p.cpuCores)} কোর`}
          sub={typeof p.cpuModel === 'string' && p.cpuModel ? p.cpuModel : undefined}
        />
        <ProfileCard
          icon={MemoryStick}
          label="RAM"
          value={`মোট ${bnNum(p.totalMemGb)}GB`}
          sub={`খালি ${bnNum(p.freeMemGb)}GB`}
        />
        <ProfileCard
          icon={HardDrive}
          label="ডিস্ক"
          value={`মোট ${bnNum(p.diskTotalGb)}GB`}
          sub={`খালি ${bnNum(p.diskFreeGb)}GB`}
        />
        <ProfileCard
          icon={CircuitBoard}
          label="GPU"
          value={p.gpu?.present ? 'আছে' : 'নেই'}
          sub={p.gpu?.note || undefined}
        />
        <ProfileCard
          icon={Wrench}
          label="FFmpeg"
          value={ffmpegVersion ?? 'পাওয়া যায়নি'}
          sub={ffprobeVersion ? `ffprobe: ${ffprobeVersion}` : undefined}
        />
        <ProfileCard
          icon={Terminal}
          label="প্ল্যাটফর্ম"
          value={p.platform || 'অজানা'}
          sub={p.nodeVersion ? `Node ${p.nodeVersion}` : undefined}
        />
      </div>

      {/* সেকশন B — প্রতি-মডেল রায় (৯-অবস্থা) */}
      <div className="mt-3.5">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <ClipboardCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          মডেল-রায়
          <span className="font-normal text-muted-foreground">
            ({toBnDigits(assessments.length)}টি মডেল)
          </span>
        </p>
        {assessments.length === 0 ? (
          <p className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
            কোনো মডেল-রায় পাওয়া যায়নি।
          </p>
        ) : (
          <ul
            className="max-h-96 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
            aria-label="মডেল-ভিত্তিক হার্ডওয়্যার-রায়"
          >
            {assessments.map((a, i) => {
              const meta = verdictMeta(a.verdict);
              return (
                <li key={a.modelKey || a.name || `assessment-${i}`} className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="min-w-0 flex-1 truncate text-xs font-semibold" title={a.name}>
                      {a.name}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn('h-auto shrink-0 px-2 py-0.5 text-[11px] leading-snug whitespace-nowrap', meta.className)}
                      title={`রায়: ${meta.label}`}
                    >
                      {meta.label}
                    </Badge>
                  </div>
                  {a.reason && (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{a.reason}</p>
                  )}
                  {a.fallback && (
                    <p className="mt-1 text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400">
                      <span className="font-medium">বিকল্প-পথ: </span>
                      {a.fallback}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* সৎ ফুটার — পরিবেশ-পরিবর্তনে রায় বদলায় */}
      <div className="mt-3 space-y-1.5 border-t pt-2.5">
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          GPU নেই মানে স্থায়ীভাবে নিষ্ক্রিয় নয় — হার্ডওয়্যার/পরিবেশ বদলালে রায় বদলাবে।
        </p>
        {data.probedAt && (
          <p className="text-[11px] text-muted-foreground/80">
            পরিমাপের সময়: {relativeTimeBn(data.probedAt)}
          </p>
        )}
      </div>
    </section>
  );
}
