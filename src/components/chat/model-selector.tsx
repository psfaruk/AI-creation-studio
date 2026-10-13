'use client';

// ============================================================
// চ্যাট-মডেল সিলেক্টর — composer-এ বসে।
//
//  - সিরিয়াল-ক্রমে মডেল (১, ২, ৩…); প্রতিটি এন্ট্রির পাশে
//    প্রকৃত ব্যাকেন্ড model-স্ট্রিং (apiModel) দেখানো হয় —
//    ব্যাকএন্ড↔ফ্রন্টএন্ড ১:১ স্বচ্ছ
//  - গ্রুপ: প্ল্যাটফর্ম-ব্যাকেন্ড (Z.ai SDK — একটিই প্রকৃত মডেল:
//    glm-4-plus) + DeepSeek / Z.ai API / BigModel / Groq /
//    OpenRouter (নিজের API কী, আলাদা কোটা)
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
  Server,
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
import { CustomProviderDialog } from '@/components/chat/custom-provider-dialog';

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
  const [customDialogOpen, setCustomDialogOpen] = useState(false);

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
  const currentLabel = current?.label ?? 'GLM-4-Plus (Z.ai SDK)';

  // কাস্টম-প্ল্যাটফর্ম গ্রুপিং — প্রতিটি প্ল্যাটফর্মের নামে আলাদা গ্রুপ
  const customModels = models.filter(m => m.provider === 'custom' && m.customProvider);
  const customGroups = Array.from(
    new Map(customModels.map(m => [m.customProvider!.id, m.customProvider!])).values()
  );

  // সিরিয়াল-নম্বর — সমতল তালিকার অবস্থান অনুযায়ী (১-ভিত্তিক;
  // স্ট্যাটিক-গ্রুপগুলো আগে, তারপর কাস্টম-গ্রুপ — ক্রম অক্ষত)
  const serialOf = (providerId: ChatProviderId, id: string): number => {
    const flatOrder: ChatProviderId[] = ['zai', ...EXTERNAL_PROVIDER_ORDER];
    let n = 0;
    for (const p of flatOrder) {
      for (const m of models) {
        if (m.provider !== p) continue;
        n += 1;
        if (m.provider === providerId && m.id === id) return n;
      }
    }
    // কাস্টম-গ্রুপ: গ্রুপ-ক্রম অনুযায়ী স্ট্যাটিক-সংখ্যার পরে গণনা
    for (const grp of customGroups) {
      for (const m of customModels) {
        if (m.customProvider!.id !== grp.id) continue;
        n += 1;
        if (m.id === id) return n;
      }
    }
    return n;
  };

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
                : 'বিল্ট-ইন পাইপ — প্রকৃত মডেল: glm-4-plus'}
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
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70">
                  {serialOf(m.provider, m.id)}.
                </span>
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
              <span className="flex flex-wrap items-center gap-1">
                {/* প্রকৃত ব্যাকেন্ড model-স্ট্রিং — স্বচ্ছতার জন্য */}
                <span className="rounded-full bg-emerald-600/10 px-1.5 py-px font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                  ↳ {m.apiModel ?? (m.provider === 'zai' ? 'glm-4-plus' : m.id)}
                </span>
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

  /** কাস্টম-প্ল্যাটফর্ম গ্রুপ-রেন্ডার (Base URL + কী-সহ ব্যবহারকারীর নিজের সিস্টেম) */
  const renderCustomGroup = (grp: { id: string; name: string; host: string; language: string }) => {
    const groupModels = customModels.filter(m => m.customProvider!.id === grp.id);
    if (groupModels.length === 0) return null;
    return (
      <div key={`custom-${grp.id}`}>
        <DropdownMenuSeparator className="my-1" />
        <DropdownMenuLabel className="flex items-center justify-between gap-2 py-1.5">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-semibold">
              {grp.name} <span className="font-normal text-muted-foreground">· নিজের প্ল্যাটফর্ম</span>
            </span>
            <span className="truncate text-[10px] font-normal text-muted-foreground">
              {grp.host} · OpenAI-কম্প্যাটিবল{grp.language !== 'auto' ? ` · ভাষা: ${grp.language === 'bn' ? 'বাংলা' : 'English'}` : ''}
            </span>
          </span>
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              setIsOpen(false);
              setCustomDialogOpen(true);
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-emerald-700 transition-colors hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/60"
            aria-label="কাস্টম প্ল্যাটফর্ম সম্পাদনা করুন"
          >
            <Server className="size-3" aria-hidden="true" />
            সম্পাদনা
          </button>
        </DropdownMenuLabel>
        {groupModels.map(m => {
          const selected = m.id === chatModel;
          return (
            <DropdownMenuItem
              key={m.id}
              onClick={() => setChatModel(m.id)}
              className="flex-col items-start gap-0.5 py-2"
              aria-label={`${m.label} নির্বাচন করুন`}
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground/70">
                  {serialOf('custom', m.id)}.
                </span>
                {selected && <span className="size-1.5 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />}
                <span className={`truncate text-sm font-medium ${selected ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                  {m.label}
                </span>
                <span className="ml-auto shrink-0">
                  <VerificationBadge v={m.verification} keyless={false} />
                </span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{m.description}</span>
              <span className="flex flex-wrap items-center gap-1">
                <span className="rounded-full bg-emerald-600/10 px-1.5 py-px font-mono text-[10px] text-emerald-700 dark:text-emerald-400">
                  ↳ {m.apiModel}
                </span>
                <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                  নিজের Base URL
                </span>
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

          {/* সৎ ব্যাখ্যা-ব্যানার: ব্যাকেন্ড↔ফ্রন্টএন্ড ১:১ */}
          <div className="mx-1 mb-1 flex items-start gap-1.5 rounded-lg bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            <span>
              প্রতিটি এন্ট্রির <span className="font-mono">↳</span>-চিহ্নের পরের স্ট্রিংটিই প্রকৃত ব্যাকেন্ড-মডেল।
              প্ল্যাটফর্ম-ব্যাকএন্ড (SDK) পাইপে একটিই মডেল — glm-4-plus; আলাদা কোটায় DeepSeek / Z.ai API /
              Groq / OpenRouter-এর নিজের কী দিন; নিজের সিস্টেম থাকলে নিচের “নিজের API-প্ল্যাটফর্ম”-এ Base URL +
              কী দিয়ে যোগ করুন — সবই প্রকৃত API-তে যায়।
            </span>
          </div>

          {renderGroup('zai')}
          {EXTERNAL_PROVIDER_ORDER.map(p => renderGroup(p))}
          {customGroups.map(grp => renderCustomGroup(grp))}

          {/* নিজের API-প্ল্যাটফর্ম যোগ — Base URL + API Key + মডেল */}
          <DropdownMenuSeparator className="my-1" />
          <DropdownMenuItem
            onClick={() => {
              setIsOpen(false);
              setCustomDialogOpen(true);
            }}
            className="gap-2 py-2"
            aria-label="নিজের API-প্ল্যাটফর্ম যোগ করুন (Base URL, API কী, মডেল নির্বাচন)"
          >
            <Server className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span className="text-xs font-medium">নিজের API-প্ল্যাটফর্ম যোগ করুন</span>
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">Base URL + কী</span>
          </DropdownMenuItem>

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

      <CustomProviderDialog
        open={customDialogOpen}
        onOpenChange={setCustomDialogOpen}
        onProvidersChanged={() => void loadModels()}
      />
    </>
  );
}
