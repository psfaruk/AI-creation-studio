'use client';

// ============================================================
// এক্সটার্নাল-প্রোভাইডার API-কী + Base URL ডায়ালগ, এবং
// অ্যাপের নিজস্ব OpenAI-কম্প্যাটিবল API (/api/v1) ব্যবস্থাপনা।
//
//  অংশ ১ — নিজের GLM কী (দুই প্রোভাইডার, প্রতিটিতে):
//    • API কী (মাস্কড, শুধু স্থানীয় ফাইলে সংরক্ষিত)
//    • Base URL (ঐচ্ছিক ওভাররাইড — ডিফল্ট অফিসিয়াল এন্ডপয়েন্ট;
//      OpenAI-কম্প্যাটিবল যে-কোনো URL চলে)
//  অংশ ২ — অ্যাপের নিজস্ব API:
//    • Base URL: <এই-অ্যাপ>/api/v1 (কপি-করা-যোগ্য)
//    • amai_sk_… কী: তৈরি / দেখান / ঘুরিয়ে / রিভোক
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import {
  EXTERNAL_PROVIDER_ORDER,
  PROVIDERS,
  type ChatProviderId,
} from '@/lib/agent/chat-models';

export interface ProviderKeyStatusView {
  hasKey: boolean;
  masked: string | null;
  source: 'file' | 'env' | null;
  /** চালু Base URL ওভাররাইড — null = ডিফল্ট */
  baseURL?: string | null;
  /** প্রোভাইডারের অফিসিয়াল ডিফল্ট Base URL */
  defaultBaseURL?: string;
}

interface PlatformKeyState {
  hasKey: boolean;
  masked: string | null;
  createdAt: string | null;
}

/** ক্লিপবোর্ডে কপি — পুরনো ব্রাউজারে ফলব্যাকসহ */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // নিচের ফলব্যাকে যাও
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Base URL-এর ক্লায়েন্ট-সাইড আকৃতি-যাচাই (সার্ভারেও হয়) */
function looksLikeHttpUrl(v: string): boolean {
  const t = v.trim();
  if (t.length < 8 || t.length > 300 || /\s/.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ProviderKeyDialog({
  open,
  onOpenChange,
  initialProvider,
  keyStatuses,
  onKeysChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ডায়ালগ খোলার সময় প্রি-সিলেক্ট করা প্রোভাইডার */
  initialProvider?: ChatProviderId | null;
  /** বর্তমান কী-অবস্থা (GET /api/models বা /api/provider-keys থেকে) */
  keyStatuses: Record<string, ProviderKeyStatusView> | null;
  /** কী সেভ/মুছে ফেলার পরে কলব্যাক (স্ট্যাটাস রিফ্রেশের জন্য) */
  onKeysChanged?: () => void;
}) {
  const [provider, setProvider] = useState<ChatProviderId>(initialProvider ?? 'zai-api');
  const [keyValue, setKeyValue] = useState('');
  const [baseUrlValue, setBaseUrlValue] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // প্ল্যাটফর্ম-API অংশের অবস্থা
  const [platform, setPlatform] = useState<PlatformKeyState | null>(null);
  const [platformFullKey, setPlatformFullKey] = useState<string | null>(null);
  const [platformBusy, setPlatformBusy] = useState(false);

  // GLM-only ক্যাটালগে EXTERNAL_PROVIDER_ORDER-এ সব স্লট বৈধ —
  // পুরনো মান থাকলে সৎ-ডিফল্টে ফেরাও
  const effectiveProvider: ChatProviderId = provider in PROVIDERS ? provider : 'zai-api';
  const effectiveInfo = PROVIDERS[effectiveProvider];
  const status = keyStatuses?.[effectiveProvider];
  const currentBaseURLOverride = status?.baseURL ?? null;
  const defaultBaseURL = status?.defaultBaseURL ?? effectiveInfo.baseURL ?? '';

  const loadPlatformKey = useCallback(async () => {
    try {
      const res = await fetch('/api/platform-key');
      if (res.ok) {
        const json = (await res.json()) as PlatformKeyState;
        setPlatform(json);
        setPlatformFullKey(null);
      }
    } catch {
      // নীরব — সেকশন আগের অবস্থাতেই
    }
  }, []);

  useEffect(() => {
    if (open) {
      setProvider(initialProvider ?? 'zai-api');
      setKeyValue('');
      setShowKey(false);
      void loadPlatformKey();
    }
  }, [open, initialProvider, loadPlatformKey]);

  // প্রোভাইডার বদলালে Base URL ইনপুট সেই প্রোভাইডারের বর্তমান ওভাররাইডে সেট
  useEffect(() => {
    const st = keyStatuses?.[provider];
    setBaseUrlValue(st?.baseURL ?? '');
  }, [provider, keyStatuses]);

  const saveKey = useCallback(async () => {
    if (isSaving) return;
    const trimmedKey = keyValue.trim();
    const trimmedUrl = baseUrlValue.trim();

    // কী দিলে আকৃতি যাচাই
    if (trimmedKey !== '' && (trimmedKey.length < 8 || /\s/.test(trimmedKey))) {
      toast({
        title: 'কী-এর আকৃতি সঠিক নয়',
        description: 'অন্তত ৮ অক্ষরের, ভেতরে সাদাস্থান-বিহীন কী দিন।',
        variant: 'destructive',
      });
      return;
    }
    // Base URL দিলে আকৃতি যাচাই
    if (trimmedUrl !== '' && !looksLikeHttpUrl(trimmedUrl)) {
      toast({
        title: 'Base URL সঠিক নয়',
        description: 'http:// বা https:// দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন (যেমন https://api.z.ai/api/paas/v4)।',
        variant: 'destructive',
      });
      return;
    }
    // কী নেই ধরে শুধু URL বদলাতে চাইলে — বিদ্যমান কী লাগবেই
    if (trimmedKey === '' && !status?.hasKey) {
      toast({
        title: 'আগে কী দিন',
        description: 'Base URL সংরক্ষণের জন্য অন্তত একবার API কী দিতে হবে।',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = { provider: effectiveProvider };
      if (trimmedKey !== '') payload.key = trimmedKey;
      // সবসময় URL-অবস্থা পাঠানো হয় — '' মানে ডিফল্টে ফেরানো
      payload.baseURL = trimmedUrl === '' ? null : trimmedUrl;
      const res = await fetch('/api/provider-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({
          title: 'সংরক্ষণ ব্যর্থ',
          description: data?.error ?? 'আবার চেষ্টা করুন।',
          variant: 'destructive',
        });
        return;
      }
      setKeyValue('');
      const urlNote = trimmedUrl === ''
        ? currentBaseURLOverride
          ? ' Base URL ডিফল্টে ফিরে গেছে।'
          : ''
        : ` Base URL: ${trimmedUrl}`;
      toast({
        title: `${effectiveInfo.label}: সংরক্ষিত`,
        description: `মডেল-তালিকায় "যাচাই করুন" চাপলে প্রকৃত সংযোগ পরীক্ষা হবে।${urlNote}`,
      });
      onKeysChanged?.();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, keyValue, baseUrlValue, effectiveProvider, effectiveInfo.label, onKeysChanged, status?.hasKey, currentBaseURLOverride]);

  const removeKey = useCallback(async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/provider-keys?provider=${encodeURIComponent(effectiveProvider)}`, {
        method: 'DELETE',
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({
          title: 'মুছে ফেলা ব্যর্থ',
          description: data?.error ?? 'আবার চেষ্টা করুন।',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: `${effectiveInfo.label}: কী ও Base URL মুছে ফেলা হয়েছে` });
      onKeysChanged?.();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsRemoving(false);
    }
  }, [isRemoving, effectiveProvider, effectiveInfo.label, onKeysChanged]);

  // ---- প্ল্যাটফর্ম-কী অ্যাকশন ----
  const generatePlatformKey = useCallback(async () => {
    if (platformBusy) return;
    setPlatformBusy(true);
    try {
      const res = await fetch('/api/platform-key', { method: 'POST' });
      const data = (await res.json().catch(() => null)) as
        | { key?: string; message?: string; error?: string }
        | null;
      if (!res.ok || !data?.key) {
        toast({
          title: 'কী তৈরি ব্যর্থ',
          description: data?.error ?? 'আবার চেষ্টা করুন।',
          variant: 'destructive',
        });
        return;
      }
      setPlatformFullKey(data.key);
      setPlatform({ hasKey: true, masked: null, createdAt: new Date().toISOString() });
      toast({ title: 'প্ল্যাটফর্ম-কী তৈরি হয়েছে', description: data.message ?? 'কপি করে ক্লায়েন্টে বসিয়ে নিন।' });
      void loadPlatformKey();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setPlatformBusy(false);
    }
  }, [platformBusy, loadPlatformKey]);

  const revealPlatformKey = useCallback(async () => {
    if (platformFullKey) {
      setPlatformFullKey(null);
      return;
    }
    try {
      const res = await fetch('/api/platform-key?reveal=1');
      const data = (await res.json().catch(() => null)) as { key?: string } | null;
      if (!res.ok || !data?.key) {
        toast({ title: 'কী দেখানো যায়নি', variant: 'destructive' });
        return;
      }
      setPlatformFullKey(data.key);
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    }
  }, [platformFullKey]);

  const revokePlatformKey = useCallback(async () => {
    if (platformBusy) return;
    setPlatformBusy(true);
    try {
      const res = await fetch('/api/platform-key', { method: 'DELETE' });
      if (!res.ok) {
        toast({ title: 'রিভোক ব্যর্থ', variant: 'destructive' });
        return;
      }
      setPlatformFullKey(null);
      toast({ title: 'প্ল্যাটফর্ম-কী রিভোক হয়েছে', description: '/api/v1 এখন শুধু মালিক-সেশনে চলবে।' });
      void loadPlatformKey();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setPlatformBusy(false);
    }
  }, [platformBusy, loadPlatformKey]);

  const appApiBase =
    typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1';

  const baseUrlChanged = baseUrlValue.trim() !== (currentBaseURLOverride ?? '');
  const canSave = !isSaving && (keyValue.trim() !== '' || (baseUrlChanged && (status?.hasKey ?? false)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            API কী ও Base URL
          </DialogTitle>
          <DialogDescription>
            নিজের GLM কী + Base URL দিন, অথবা নিচে অ্যাপের নিজস্ব OpenAI-কম্প্যাটিবল
            API (<code className="rounded bg-muted px-1">/api/v1</code>) থেকে কী নিন।
          </DialogDescription>
        </DialogHeader>

        {/* ---------- অংশ ১: নিজের GLM কী + Base URL ---------- */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">১ · নিজের GLM প্রোভাইডারের কী</p>

          {/* প্রোভাইডার নির্বাচন (দুটি GLM-এন্ডপয়েন্ট — মিশ্রণ নেই) */}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="GLM প্রোভাইডার নির্বাচন">
            {EXTERNAL_PROVIDER_ORDER.map(p => {
              const active = effectiveProvider === p;
              const has = keyStatuses?.[p]?.hasKey;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setProvider(p)}
                  className={`flex flex-col items-start gap-0.5 rounded-xl border p-2.5 text-left transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className={`text-sm font-medium ${active ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                      {PROVIDERS[p].label}
                    </span>
                    {has && (
                      <span className="ml-auto inline-flex items-center rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        কী ✓
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">{PROVIDERS[p].keyHint}</span>
                </button>
              );
            })}
          </div>

          {/* নির্বাচিত প্রোভাইডারের তথ্য */}
          <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <p>{effectiveInfo.note}</p>
            <p className="mt-1.5 flex items-center gap-1">
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
              <a
                href={effectiveInfo.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {effectiveInfo.label}-এর API কী নিন (এই লিংকে)
              </a>
            </p>
            {status?.hasKey && (
              <p className="mt-1.5 rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                বর্তমান কী: {status.masked}
                {status.source === 'env' ? ' (environment variable থেকে)' : ' (স্থানীয় ফাইল থেকে)'}
              </p>
            )}
          </div>

          {/* কী ইনপুট */}
          <div className="space-y-2">
            <Label htmlFor="provider-api-key" className="text-xs">
              {effectiveInfo.label} API কী {effectiveInfo.keyHint ? `(${effectiveInfo.keyHint})` : ''}
            </Label>
            <div className="relative">
              <Input
                id="provider-api-key"
                type={showKey ? 'text' : 'password'}
                value={keyValue}
                onChange={e => setKeyValue(e.target.value)}
                placeholder={status?.hasKey ? 'নতুন কী বসালে বদলে যাবে…' : 'কী এখানে পেস্ট করুন…'}
                autoComplete="off"
                spellCheck={false}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={showKey ? 'কী লুকান' : 'কী দেখান'}
              >
                {showKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>

            {/* Base URL ইনপুট (ঐচ্ছিক ওভাররাইড) */}
            <Label htmlFor="provider-base-url" className="flex items-center gap-1.5 pt-1 text-xs">
              <Globe className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Base URL <span className="text-muted-foreground">(ঐচ্ছিক — খালি রাখলে ডিফল্ট)</span>
            </Label>
            <div className="flex gap-1.5">
              <Input
                id="provider-base-url"
                type="text"
                value={baseUrlValue}
                onChange={e => setBaseUrlValue(e.target.value)}
                placeholder={defaultBaseURL}
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
                dir="ltr"
                className="font-mono text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 px-2"
                onClick={() => setBaseUrlValue('')}
                disabled={baseUrlValue === ''}
                aria-label="Base URL ডিফল্টে ফেরান"
                title="ডিফল্ট এন্ডপয়েন্টে ফেরাও"
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {currentBaseURLOverride ? (
                <>
                  এখন চালু: <span className="font-mono">{currentBaseURLOverride}</span> (কাস্টম) — খালি
                  করে সেভ করলে ডিফল্ট <span className="font-mono">{defaultBaseURL}</span>-এ ফিরে যাবে।
                </>
              ) : (
                <>
                  ডিফল্ট: <span className="font-mono">{defaultBaseURL}</span> — অন্য কোনো
                  OpenAI-কম্প্যাটিবল এন্ডপয়েন্ট ব্যবহার করলে সেটি এখানে বসান।
                </>
              )}
            </p>

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              কী শুধু তোমার সার্ভারের storage/provider-keys.json ফাইলে থাকে — কখনো GitHub-এ
              আপলোড হয় না, কোনো তৃতীয় পক্ষকেও পাঠানো হয় না।
            </p>
          </div>

          <div className="flex flex-row items-center gap-2">
            {status?.hasKey ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void removeKey()}
                disabled={isRemoving}
                className="text-destructive hover:text-destructive"
              >
                {isRemoving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
                কী মুছে দাও
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">কোনো কী সংরক্ষিত নেই</span>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => void saveKey()}
              disabled={!canSave}
              className="ml-auto bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
              সংরক্ষণ করো
            </Button>
          </div>
        </div>

        {/* ---------- অংশ ২: অ্যাপের নিজস্ব /api/v1 ---------- */}
        <div className="space-y-3 rounded-xl border border-emerald-200/60 bg-emerald-50/40 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Plug className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            ২ · এই অ্যাপের নিজস্ব API (OpenAI-কম্প্যাটিবল)
          </p>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">Base URL (যেকোনো OpenAI-ক্লায়েন্টে বসান):</p>
            <div className="flex gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]" dir="ltr">
                {appApiBase}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 px-2"
                onClick={async () => {
                  const ok = await copyText(appApiBase);
                  toast(
                    ok
                      ? { title: 'Base URL কপি হয়েছে' }
                      : { title: 'কপি করা যায়নি — হাতে বেছে নিন', variant: 'destructive' }
                  );
                }}
                aria-label="Base URL কপি করুন"
              >
                <Copy className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              API কী {platform?.hasKey ? '(মাস্কড):' : '(এখনো তৈরি করা হয়নি):'}
            </p>
            <div className="flex gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]" dir="ltr">
                {platformFullKey ?? platform?.masked ?? '— কী নেই —'}
              </code>
              {platform?.hasKey && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2"
                  onClick={() => void revealPlatformKey()}
                  aria-label={platformFullKey ? 'কী লুকান' : 'কী দেখান'}
                >
                  {platformFullKey ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
                </Button>
              )}
              {(platformFullKey ?? false) && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 px-2"
                  onClick={async () => {
                    if (!platformFullKey) return;
                    const ok = await copyText(platformFullKey);
                    toast(
                      ok
                        ? { title: 'কী কপি হয়েছে' }
                        : { title: 'কপি করা যায়নি — হাতে বেছে নিন', variant: 'destructive' }
                    );
                  }}
                  aria-label="কী কপি করুন"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              ক্লায়েন্ট-উদাহরণ: Base URL <span className="font-mono">{appApiBase}</span> + এই কী
              বসিয়ে মডেল <span className="font-mono">glm-4-plus</span> (কী লাগে না),
              <span className="font-mono"> glm-5.3</span> ইত্যাদি ব্যবহার করুন।
            </p>
          </div>

          <div className="flex flex-row items-center gap-2 pt-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void generatePlatformKey()}
              disabled={platformBusy}
              className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              {platformBusy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-3.5" aria-hidden="true" />
              )}
              {platform?.hasKey ? 'নতুন কী (ঘুরিয়ে দাও)' : 'কী তৈরি করো'}
            </Button>
            {platform?.hasKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void revokePlatformKey()}
                disabled={platformBusy}
                className="ml-auto text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                রিভোক
              </Button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            কীটি শুধু তোমার সার্ভারে (storage/platform-key.json) থাকে। ঘোরানোর সাথে সাথে পুরনো
            কী অচল হয়। রিভোক করলে /api/v1 শুধু মালিক-সেশন টোকেনে চলবে।
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
