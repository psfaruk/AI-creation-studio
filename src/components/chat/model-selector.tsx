'use client';

// ============================================================
// চ্যাট-মডেল সিলেক্টর — composer-এ বসে।
//  - ক্যাটালগ (chat-models.ts) + রানটাইম যাচাই-স্ট্যাটাস (/api/models)
//  - সৎ ব্যাজ: ✅ যাচাইকৃত / ⏳ অযাচাই / ⚠️ রেট-লিমিট / ❌ ব্যর্থ
//  - "যাচাই করুন" বাটন → POST /api/models (প্রকৃত API কল, ক্যাশ ৬ ঘণ্টা)
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, ChevronDown, CircleAlert, Clock, Cpu, Loader2, RefreshCw, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useChatStore } from '@/hooks/use-chat-store';
import type { ChatModelOption } from '@/lib/agent/chat-models';

interface ModelWithVerification extends ChatModelOption {
  verification: {
    ok: boolean;
    servedModel?: string;
    ms?: number;
    rateLimited?: boolean;
    error?: string;
    testedAt: string;
  } | null;
}

const TAG_LABELS: Record<string, string> = {
  default: 'ডিফল্ট',
  fast: 'দ্রুত',
  vision: 'ভিশন',
  reasoning: 'যুক্তি',
  'long-context': 'লম্বা-কনটেক্সট',
  legacy: 'পুরোনো',
  balanced: 'সুষম',
};

function VerificationBadge({ v }: { v: ModelWithVerification['verification'] }) {
  if (!v) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="size-3" aria-hidden="true" />
        অযাচাই
      </span>
    );
  }
  if (v.rateLimited) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
        <Clock className="size-3" aria-hidden="true" />
        রেট-লিমিটেড — অযাচাই
      </span>
    );
  }
  if (v.ok) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <BadgeCheck className="size-3" aria-hidden="true" />
        যাচাইকৃত{v.ms ? ` · ${v.ms < 1000 ? `${v.ms}ms` : `${(v.ms / 1000).toFixed(1)}s`}` : ''}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
      <CircleAlert className="size-3" aria-hidden="true" />
      ব্যর্থ
    </span>
  );
}

export function ModelSelector({ disabled }: { disabled?: boolean }) {
  const chatModel = useChatStore((s) => s.chatModel);
  const setChatModel = useChatStore((s) => s.setChatModel);
  const [models, setModels] = useState<ModelWithVerification[] | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  // ক্যাশ-করা যাচাই-স্ট্যাটাস লোড (নতুন API কল নয়)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/models')
      .then(res => (res.ok ? res.json() : null))
      .then((data: { models?: ModelWithVerification[] } | null) => {
        if (!cancelled && Array.isArray(data?.models)) setModels(data!.models!);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const runVerification = useCallback(async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    try {
      const res = await fetch('/api/models', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as { models?: ModelWithVerification[] };
        if (Array.isArray(data?.models)) setModels(data!.models!);
      }
    } catch {
      // নীরব — ব্যাজ আগের অবস্থাতেই থাকবে
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying]);

  const current = models?.find(m => m.id === chatModel);
  const currentLabel = current?.label ?? 'অটো (প্ল্যাটফর্ম ডিফল্ট)';

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          className="h-11 shrink-0 gap-1.5 rounded-xl px-2.5 text-muted-foreground hover:text-foreground"
          aria-label={`চ্যাট মডেল নির্বাচন করুন (বর্তমান: ${currentLabel})`}
          title={`চ্যাট মডেল: ${currentLabel}`}
        >
          <Cpu className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span className="hidden max-w-28 truncate text-xs font-medium sm:inline">
            {currentLabel}
          </span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="max-h-96 w-80 overflow-y-auto">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>AI মডেল নির্বাচন করুন</span>
          <button
            type="button"
            onClick={() => void runVerification()}
            disabled={isVerifying}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="মডেলগুলোর প্রাপ্যতা যাচাই করুন"
          >
            {isVerifying ? (
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="size-3" aria-hidden="true" />
            )}
            {isVerifying ? 'যাচাই চলছে…' : 'যাচাই করুন'}
          </button>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {(models ?? []).map(m => {
          const selected = m.id === chatModel;
          return (
            <DropdownMenuItem
              key={m.id || 'default'}
              onClick={() => setChatModel(m.id)}
              className="flex-col items-start gap-0.5 py-2"
              aria-label={`${m.label} নির্বাচন করুন`}
            >
              <span className="flex w-full items-center gap-1.5">
                {selected && <span className="size-1.5 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />}
                <span className={`truncate text-sm font-medium ${selected ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                  {m.label}
                </span>
                {m.tags.includes('fast') && (
                  <Zap className="size-3 shrink-0 text-amber-500" aria-hidden="true" />
                )}
                <span className="ml-auto shrink-0">
                  <VerificationBadge v={m.verification} />
                </span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{m.description}</span>
              <span className="flex flex-wrap gap-1">
                {m.tags.map(t => (
                  <span
                    key={t}
                    className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground"
                  >
                    {TAG_LABELS[t] ?? t}
                  </span>
                ))}
              </span>
            </DropdownMenuItem>
          );
        })}
        {models === null && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            মডেল-তালিকা লোড হচ্ছে…
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
