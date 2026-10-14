'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Hourglass,
  Loader2,
  RefreshCcw,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { ActivityStatus, ActivityView } from '@/lib/types';

import { toBnDigits } from '@/components/chat/bn-format';
import { ArtifactList } from '@/components/chat/artifact-view';
import { ToolIcon } from '@/components/chat/tool-icon';
import { cn } from '@/lib/utils';

interface StatusMeta {
  label: string;
  badgeClass: string;
  iconClass: string;
  icon: LucideIcon;
}

// (অডিট §C2) টুল-অ্যাক্টিভিটির পূর্ণ জীবনচক্র — queued/waiting/retrying/
// cancelled নতুন অবস্থাগুলো রিকানেক্ট-রিপ্লে ও ভবিষ্যৎ-সংযোগে আসে
const STATUS_META: Record<ActivityStatus, StatusMeta> = {
  running: {
    label: 'চলছে',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    iconClass: 'animate-spin',
    icon: Loader2,
  },
  done: {
    label: 'সম্পন্ন',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    iconClass: '',
    icon: CheckCircle2,
  },
  failed: {
    label: 'ব্যর্থ',
    badgeClass: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
    iconClass: '',
    icon: XCircle,
  },
  queued: {
    label: 'সারিতে',
    badgeClass: 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300',
    iconClass: '',
    icon: Clock,
  },
  waiting: {
    label: 'অপেক্ষমাণ',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    iconClass: 'animate-pulse',
    icon: Hourglass,
  },
  retrying: {
    label: 'পুনঃচেষ্টা',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
    iconClass: 'animate-spin',
    icon: RefreshCcw,
  },
  cancelled: {
    label: 'বাতিল',
    badgeClass: 'border-stone-400/40 bg-stone-400/10 text-stone-600 dark:text-stone-300',
    iconClass: '',
    icon: XCircle,
  },
};

function StatusBadge({ status }: { status: ActivityStatus }) {
  // অজানা/ভবিষ্যৎ স্ট্যাটাসে ডিফেন্সিভ ফলব্যাক — running-ধাঁচে দেখায়, ক্র্যাশ নয়
  const meta = STATUS_META[status] ?? STATUS_META.running;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        meta.badgeClass,
      )}
    >
      <Icon className={cn('size-3', meta.iconClass)} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

/**
 * (অডিট §C2) চলমান টুলের লাইভ অতিবাহিত-সময় — প্রতি সেকেন্ডে টিক করে
 * ("১২ সে.")। শুধু status==='running' হলে মাউন্ট হয়, তাই স্ট্যাটাস
 * বদলালে/আনমাউন্টে ইন্টারভাল পরিষ্কার হয়ে যায়।
 */
function LiveElapsed({ startedAt }: { startedAt: string }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs)) return null;
  const sec = Math.max(0, Math.floor((nowMs - startMs) / 1_000));
  return (
    <span className="inline-flex shrink-0 items-center text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
      {toBnDigits(sec)} সে.
    </span>
  );
}

/** টুল-এক্টিভিটি কার্ড — Collapsible: ইনপুট/আউটপুট/ত্রুটি + আর্টিফ্যাক্ট */
export function ActivityCard({ activity }: { activity: ActivityView }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border bg-card shadow-sm">
        <CollapsibleTrigger
          className={cn(
            'flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
            'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
          )}
          aria-label={`${activity.title} — বিস্তারিত ${open ? 'লুকান' : 'দেখান'}`}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <ToolIcon name={activity.icon} className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{activity.title}</span>
              <StatusBadge status={activity.status} />
              {activity.status === 'running' && activity.startedAt && (
                <LiveElapsed startedAt={activity.startedAt} />
              )}
            </span>
            {activity.input && (
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {activity.input}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 py-3">
            <div>
              <p className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                ইনপুট
              </p>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                {activity.input}
              </p>
            </div>

            {activity.output && (
              <div>
                <p className="mb-0.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                  আউটপুট
                </p>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                  {activity.output}
                </p>
              </div>
            )}

            {activity.error && (
              <div>
                <p className="mb-0.5 text-[11px] font-medium tracking-wide text-red-600 dark:text-red-400">
                  ত্রুটি
                </p>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-red-600 dark:text-red-400">
                  {activity.error}
                </p>
              </div>
            )}

            {activity.artifacts && activity.artifacts.length > 0 && (
              <ArtifactList artifacts={activity.artifacts} />
            )}

            {activity.durationMs != null && (
              <p className="text-[11px] text-muted-foreground">
                সময়: {toBnDigits((activity.durationMs / 1000).toFixed(1))} সেকেন্ড
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
