'use client';

// ============================================================
// চ্যাট-মডেল সিলেক্টর — composer-এ বসে।
//
// মিনিমাল-নীতি (ব্যবহারকারীর নির্দেশ): ভেতরে শুধু মডেলের নাম —
// নামের সাথে কোনো সিরিয়াল-নম্বর / ব্যাকেন্ড-চিপ / ট্যাগ / ব্যাজ /
// বর্ণনা নয়। গ্রুপ-হেডারে শুধু প্ল্যাটফর্মের নাম।
//
// GLM-only-নীতি (ব্যবহারকারীর নির্দেশ): শুধু GLM-পরিবারের
// মডেল-গ্রুপ — Z.ai SDK (বিল্ট-ইন), Z.ai API ও BigModel (নিজের কী)।
// এর সাথে "কাস্টম / লোকাল মডেল" গ্রুপ — নিজের OpenAI-কম্প্যাটিবল
// এন্ডপয়েন্ট (কী-ডায়ালগে কনফিগ); কনফিগ না থাকলে সারি-ক্লিক =
// কী-ডায়ালগ (custom প্রি-সিলেক্ট)।
//
// আচরণ-নীতি:
//  - কী-বিহীন এক্সটার্নাল মডেলে ক্লিক = নীরব নির্বাচন নয়, কী-ডায়ালগ
//  - নির্বাচিত মডেলে টিক-চিহ্ন
//  - পুরনো/সরানো মডেল-id সিলেক্টরে ঢুকলে সৎ-ডিফল্টে মাইগ্রেট
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Cpu, Loader2, RefreshCw } from 'lucide-react';

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
      // নীরব — ড্রপডাউন আগের অবস্থাতেই থাকবে
    }
  }, []);

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
      // নীরব
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

  /** মডেল-সারি — শুধু নাম + নির্বাচিত-টিক */
  const renderRow = (m: ModelWithVerification, keyless: boolean) => {
    const selected = m.id === chatModel;
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
        className="gap-2 py-1.5 pl-3"
        aria-label={
          keyless
            ? m.provider === 'custom'
              ? `${m.label} — সেটআপ করুন`
              : `${m.label} — API কী যোগ করুন`
            : `${m.label} নির্বাচন করুন`
        }
      >
        <span className={`min-w-0 flex-1 truncate text-sm ${selected ? 'font-medium text-emerald-700 dark:text-emerald-400' : ''}`}>
          {m.label}
        </span>
        {selected && (
          <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        )}
      </DropdownMenuItem>
    );
  };

  /** প্রোভাইডার-গ্রুপ — হেডারে শুধু প্ল্যাটফর্ম-নাম */
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
          <span className="truncate text-xs font-semibold">{providerInfo.label}</span>
          {isExternal && !hasKey && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                openKeyDialog(providerId);
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
              aria-label={
                providerId === 'custom'
                  ? `${providerInfo.label} সেটআপ করুন`
                  : `${providerInfo.label}-এর API কী যোগ করুন`
              }
            >
              {providerId === 'custom' ? 'সেটআপ লাগবে' : 'কী লাগবে'}
            </button>
          )}
        </DropdownMenuLabel>
        {groupModels.map(m => renderRow(m, isExternal && !hasKey))}
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
        <DropdownMenuContent align="start" side="top" className="max-h-96 w-64 overflow-y-auto">
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>মডেল (GLM)</span>
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
