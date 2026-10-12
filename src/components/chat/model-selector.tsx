'use client';

// ============================================================
// চ্যাট-মডেল সিলেক্টর — composer-এ বসে।
//
//  - ৫ প্রোভাইডার-গ্রুপ: Z.ai SDK (বিল্ট-ইন, শেয়ার্ড রেট-লিমিট) +
//    DeepSeek / GLM / Groq / OpenRouter (নিজের API কী, আলাদা কোটা)
//  - সৎ ব্যাজ: ✅ যাচাইকৃত / ⏳ অযাচাই / ⚠️ রেট-লিমিট / ❌ ব্যর্থ /
//    🔑 কী লাগবে
//  - কী-বিহীন এক্সটার্নাল মডেলে ক্লিক করলে নীরব নির্বাচন নয় —
//    কী-ডায়ালগ খোলে (সৎ পথ)
//  - "যাচাই করুন" → POST /api/models (প্রকৃত API কল, ক্যাশ ৬ ঘণ্টা)
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  CircleAlert,
  Clock,
  Cpu,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  Zap,
} from 'lucide-react';

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
import type { ChatModelOption, ChatProviderId, ModelVerificationEntry } from '@/lib/agent/chat-models';
import { EXTERNAL_PROVIDER_ORDER, PROVIDERS } from '@/lib/agent/chat-models';
import { ProviderKeyDialog, type ProviderKeyStatusView } from '@/components/chat/provider-key-dialog';

interface ModelWithVerification extends ChatModelOption {
  verification: ModelVerificationEntry | null;
}

interface ModelsResponse {
  models?: ModelWithVerification[];
  providers?: Record<string, ProviderKeyStatusView>;
}

const TAG_LABELS: Record<string, string> = {
  default: 'ডিফল্ট',
  fast: 'দ্রুত',
  vision: 'ভিশন',
  reasoning: 'যুক্তি',
  'long-context': 'লম্বা-কনটেক্সট',
  legacy: 'পুরোনো',
  balanced: 'সুষম',
  'open-source': 'ওপেন-সোর্স',
  'free-tier': 'ফ্রি-টিয়ার',
};

/** কী-অবস্থা-সচেতন সৎ ব্যাজ */
function VerificationBadge({
  v,
  keyless,
}: {
  v: ModelWithVerification['verification'];
  keyless: boolean;
}) {
  if (keyless) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
        <KeyRound className="size-3" aria-hidden="true" />
        কী লাগবে
      </span>
    );
  }
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
        {v.skippedBySharedWindow ? '৪২৯-স্কিপ' : 'রেট-লিমিটেড'}
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
    <span className="inline-flex items-center gap-1 text-[11px] text-destructive" title={v.error}>
      <CircleAlert className="size-3" aria-hidden="true" />
      ব্যর্থ
    </span>
  );
}

export function ModelSelector({ disabled }: { disabled?: boolean }) {
  const chatModel = useChatStore((s) => s.chatModel);
  const setChatModel = useChatStore((s) => s.setChatModel);
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyDialogProvider, setKeyDialogProvider] = useState<ChatProviderId | null>(null);

  const loadModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const json = (await res.json()) as ModelsResponse;
        if (json && typeof json === 'object') setData(json);
      }
    } catch {
      // নীরব — ড্রপডাউন খালি/পুরোনো অবস্থায় থাকবে
    }
  }, []);

  // ক্যাশ-করা যাচাই-স্ট্যাটাস লোড (নতুন API কল নয়)
  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const runVerification = useCallback(async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    try {
      const res = await fetch('/api/models', { method: 'POST' });
      if (res.ok) {
        const json = (await res.json()) as ModelsResponse;
        if (json && typeof json === 'object') setData(json);
      }
    } catch {
      // নীরব — ব্যাজ আগের অবস্থাতেই থাকবে
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying]);

  const openKeyDialog = useCallback((provider: ChatProviderId) => {
    setIsOpen(false); // ড্রপডাউন বন্ধ → ডায়ালগ খোলে (ফোকাস-কনফ্লিক্ট এড়াতে)
    setKeyDialogProvider(provider);
    setKeyDialogOpen(true);
  }, []);

  const models = data?.models ?? [];
  const providers = data?.providers ?? {};
  const current = models.find(m => m.id === chatModel);
  const currentLabel = current?.label ?? 'অটো (প্ল্যাটফর্ম ডিফল্ট)';

  /** প্রোভাইডার-গ্রুপ অনুযায়ী মডেল-রেন্ডার */
  const renderGroup = (providerId: ChatProviderId) => {
    const providerInfo = PROVIDERS[providerId];
    const groupModels = models.filter(m => m.provider === providerId);
    if (groupModels.length === 0) return null;
    const isExternal = providerId !== 'zai';
    const hasKey = !isExternal || providers[providerId]?.hasKey === true;

    return (
      <div key={providerId}>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuLabel className="flex items-center justify-between gap-2 py-1.5">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-semibold">{providerInfo.label}</span>
            <span className="truncate text-[10px] font-normal text-muted-foreground">
              {isExternal
                ? hasKey
                  ? 'নিজের API কী · আলাদা কোটা'
                  : 'নিজের API কী লাগবে'
                : 'কী লাগে না · সব মডেল একই পাইপ (শেয়ার্ড রেট-লিমিট)'}
            </span>
          </span>
          {isExternal && !hasKey && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                openKeyDialog(providerId);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
              aria-label={`${providerInfo.label}-এর API কী যোগ করুন`}
            >
              <KeyRound className="size-3" aria-hidden="true" />
              কী যোগ করুন
            </button>
          )}
          {isExternal && hasKey && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                openKeyDialog(providerId);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/60"
              aria-label={`${providerInfo.label}-এর কী পরিচালনা করুন`}
            >
              <KeyRound className="size-3" aria-hidden="true" />
              কী ✓
            </button>
          )}
        </DropdownMenuLabel>
        {groupModels.map(m => {
          const selected = m.id === chatModel;
          const keyless = isExternal && !hasKey;
          return (
            <DropdownMenuItem
              key={m.id || 'default'}
              onClick={() => {
                if (keyless) {
                  openKeyDialog(m.provider);
                  return;
                }
                setChatModel(m.id);
              }}
              className="flex-col items-start gap-0.5 py-2"
              aria-label={
                keyless
                  ? `${m.label} — API কী যোগ করুন`
                  : `${m.label} নির্বাচন করুন`
              }
            >
              <span className="flex w-full items-center gap-1.5">
                {selected && <span className="size-1.5 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />}
                <span className={`truncate text-sm font-medium ${selected ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                  {m.label}
                </span>
                {m.tags.includes('fast') && <Zap className="size-3 shrink-0 text-amber-500" aria-hidden="true" />}
                <span className="ml-auto shrink-0">
                  <VerificationBadge v={m.verification} keyless={keyless} />
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
      </div>
    );
  };

  return (
    <>
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

          {/* সৎ ব্যাখ্যা-ব্যানার: কেন মডেল বদলেও ৪২৯ যায় */}
          <div className="mx-1 mb-1 flex items-start gap-1.5 rounded-lg bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>
              Z.ai SDK-গ্রুপের সব মডেল একই ব্যাকএন্ড পাইপে চলে — তাই ওই গ্রুপে মডেল বদলালেও
              ৪২৯ এড়ানো যায় না। আলাদা কোটা চাইলে DeepSeek (V4) / Z.ai API (GLM-5.3) / Groq /
              OpenRouter-এর নিজের কী যোগ করুন — সবই প্রকৃত API-তে যায়।
            </span>
          </div>

          {renderGroup('zai')}
          {EXTERNAL_PROVIDER_ORDER.map(p => renderGroup(p))}

          {models.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              মডেল-তালিকা লোড হচ্ছে…
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ProviderKeyDialog
        open={keyDialogOpen}
        onOpenChange={setKeyDialogOpen}
        initialProvider={keyDialogProvider}
        keyStatuses={data?.providers ?? null}
        onKeysChanged={() => void loadModels()}
      />
    </>
  );
}
