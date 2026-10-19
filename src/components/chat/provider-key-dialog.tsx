'use client';

// ============================================================
// এক্সটার্নাল-প্রোভাইডার API-কী + Base URL ডায়ালগ, এবং
// অ্যাপের নিজস্ব OpenAI-কম্প্যাটিবল API (/api/v1) ব্যবস্থাপনা।
//
//  অংশ ১ — প্রোভাইডার নির্বাচন (৩টি):
//    • Z.ai API / GLM · BigModel: API কী (মাস্কড, শুধু স্থানীয়
//      ফাইলে সংরক্ষিত) + ঐচ্ছিক Base URL ওভাররাইড
//    • কাস্টম / লোকাল: নিজের OpenAI-কম্প্যাটিবল এন্ডপয়েন্ট
//      (Ollama, LM Studio, vLLM, LiteLLM, টানেল…) —
//      Base URL + মডেলের নাম বাধ্যতামূলক, API কী ঐচ্ছিক;
//      "মডেল-তালিকা আনুন" দিয়ে সংযোগ-পরীক্ষা + মডেল-তালিকা
//  অংশ ২ — অ্যাপের নিজস্ব API:
//    • Base URL: <এই-অ্যাপ>/api/v1 (কপি-করা-যোগ্য)
//    • amai_sk_… কী: তৈরি / দেখান / ঘুরিয়ে / রিভোক
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
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
  XCircle,
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
  /** প্রোভাইডারের অফিসিয়াল ডিফল্ট Base URL (custom-এ খালি) */
  defaultBaseURL?: string;
  /** custom-প্রোভাইডার: সেভ-করা মডেলের নাম */
  model?: string | null;
  /** custom-প্রোভাইডার: baseURL + মডেল-নাম দিয়ে ব্যবহার-উপযোগী কনফিগ আছে কি না */
  configured?: boolean;
}

interface PlatformKeyState {
  hasKey: boolean;
  masked: string | null;
  createdAt: string | null;
}

/** POST /api/provider-keys/probe-এর ফলাফল (custom-এন্ডপয়েন্ট পরীক্ষা) */
interface CustomTestResult {
  ok: boolean;
  baseURL: string;
  modelCount: number;
  models: string[];
  modelsError?: string;
  chat?: {
    ok: boolean;
    content: string | null;
    servedModel: string | null;
    ms: number;
    error: string | null;
  } | null;
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

  // কাস্টম / লোকাল এন্ডপয়েন্ট-ফর্মের অবস্থা
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<CustomTestResult | null>(null);
  const [isSavingCustom, setIsSavingCustom] = useState(false);
  const [isRemovingCustom, setIsRemovingCustom] = useState(false);

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
  const isCustom = effectiveProvider === 'custom';
  const customStatus = keyStatuses?.custom;

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

  // কাস্টম-ফর্ম প্রি-ফিল: ডায়ালগ খুললে বা 'custom'-এ গেলে সেভ-করা
  // কনফিগ থেকে Base URL ও মডেলের নাম বসে; কী-ঘর সবসময় খালি শুরু হয়
  useEffect(() => {
    if (!open) return;
    setCustomBaseUrl(customStatus?.baseURL ?? '');
    setCustomModel(customStatus?.model ?? '');
    setCustomKey('');
    setShowCustomKey(false);
    setTestResult(null);
    // ইচ্ছাকৃতভাবে keyStatuses.custom পড়া হয় (বর্তমান provider নয়) —
    // প্রি-ফিল সবসময় custom-এর সেভ-কনফিগ থেকেই আসে
  }, [open, provider, customStatus]);

  // ---- কাস্টম / লোকাল: সংযোগ-পরীক্ষা + মডেল-তালিকা ----
  const testCustom = useCallback(async () => {
    if (isTesting) return;
    const url = customBaseUrl.trim();
    const model = customModel.trim();
    const key = customKey.trim();

    if (!looksLikeHttpUrl(url)) {
      toast({
        title: 'আগে Base URL দিন',
        description: 'http:// বা https:// দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন (যেমন http://localhost:11434/v1)।',
        variant: 'destructive',
      });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const payload: Record<string, unknown> = {
        provider: 'custom',
        baseURL: url,
        chatTest: model !== '', // মডেলের নাম দিলে প্রকৃত চ্যাট-কল পরীক্ষা
      };
      if (key !== '') payload.key = key; // শুধু এই কলে — সেভ হয় না
      if (model !== '') payload.model = model;
      const res = await fetch('/api/provider-keys/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as (CustomTestResult & { error?: string }) | null;
      if (!res.ok) {
        toast({
          title: 'সংযোগ পরীক্ষা ব্যর্থ',
          description: data?.error ?? 'আবার চেষ্টা করুন।',
          variant: 'destructive',
        });
        return;
      }
      if (data) setTestResult(data);
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsTesting(false);
    }
  }, [isTesting, customBaseUrl, customModel, customKey]);

  // ---- কাস্টম / লোকাল: কনফিগ সংরক্ষণ ----
  const saveCustom = useCallback(async () => {
    if (isSavingCustom) return;
    const url = customBaseUrl.trim();
    const model = customModel.trim();
    const key = customKey.trim();

    if (!looksLikeHttpUrl(url)) {
      toast({
        title: 'Base URL সঠিক নয়',
        description: 'http:// বা https:// দিয়ে শুরু হওয়া সম্পূর্ণ URL দিন (যেমন http://localhost:11434/v1)।',
        variant: 'destructive',
      });
      return;
    }
    if (model === '') {
      toast({
        title: 'মডেলের নাম দিন',
        description: 'এন্ডপয়েন্টে যে নামে মডেল সার্ভ হয় সেই নামটি দিন (যেমন llama3.2) — "মডেল-তালিকা আনুন" থেকেও বেছে নেওয়া যায়।',
        variant: 'destructive',
      });
      return;
    }
    if (key !== '' && (key.length > 500 || /\s/.test(key))) {
      toast({
        title: 'API কী-র আকৃতি সঠিক নয়',
        description: 'কী ১–৫০০ অক্ষরের ও ভেতরে সাদাস্থান-বিহীন হতে হবে — লোকাল সার্ভারে কী না লাগলে খালি রাখুন।',
        variant: 'destructive',
      });
      return;
    }

    setIsSavingCustom(true);
    try {
      const res = await fetch('/api/provider-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // key: '' মানে কী-হীন কনফিগ (লোকাল সার্ভারে স্বাভাবিক)
        body: JSON.stringify({ provider: 'custom', baseURL: url, model, key }),
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
      toast({
        title: 'কাস্টম / লোকাল মডেল: সংরক্ষিত',
        description: `মডেল-তালিকায় "কাস্টম / লোকাল মডেল" গ্রুপ থেকে "${model}" বেছে নিন — পুরো অ্যাপ এই এন্ডপয়েন্টে চলবে।`,
      });
      onKeysChanged?.();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsSavingCustom(false);
    }
  }, [isSavingCustom, customBaseUrl, customModel, customKey, onKeysChanged]);

  // ---- কাস্টম / লোকাল: কনফিগ মুছে ফেলা ----
  const removeCustom = useCallback(async () => {
    if (isRemovingCustom) return;
    setIsRemovingCustom(true);
    try {
      const res = await fetch('/api/provider-keys?provider=custom', { method: 'DELETE' });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({
          title: 'মুছে ফেলা ব্যর্থ',
          description: data?.error ?? 'আবার চেষ্টা করুন।',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'কাস্টম কনফিগ মুছে ফেলা হয়েছে',
        description: 'Base URL, মডেলের নাম ও কী — সব মুছে গেছে।',
      });
      onKeysChanged?.();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsRemovingCustom(false);
    }
  }, [isRemovingCustom, onKeysChanged]);

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

  const selectedCustomModel = customModel.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            API কী ও Base URL
          </DialogTitle>
          <DialogDescription>
            নিজের GLM কী + Base URL দিন, নিজের লোকাল / কাস্টম এন্ডপয়েন্ট যোগ করুন, অথবা নিচে
            অ্যাপের নিজস্ব OpenAI-কম্প্যাটিবল API (<code className="rounded bg-muted px-1">/api/v1</code>)
            থেকে কী নিন।
          </DialogDescription>
        </DialogHeader>

        {/* ---------- অংশ ১: প্রোভাইডার নির্বাচন + কী / এন্ডপয়েন্ট ---------- */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-foreground">১ · প্রোভাইডার বেছে কী / এন্ডপয়েন্ট দিন</p>

          {/* প্রোভাইডার নির্বাচন (Z.ai API · GLM BigModel · কাস্টম/লোকাল) */}
          <div
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
            role="radiogroup"
            aria-label="প্রোভাইডার নির্বাচন (Z.ai API / GLM / কাস্টম-লোকাল)"
          >
            {EXTERNAL_PROVIDER_ORDER.map(p => {
              const active = effectiveProvider === p;
              const st = keyStatuses?.[p];
              // custom-এ "ব্যবহার-উপযোগী" মানে কনফিগার্ড (baseURL + মডেল-নাম);
              // GLM-দুটিতে মানে API কী আছে
              const ready = p === 'custom'
                ? (st?.configured ?? st?.hasKey) === true
                : st?.hasKey === true;
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
                      {p === 'custom' ? 'কাস্টম / লোকাল' : PROVIDERS[p].label}
                    </span>
                    {ready && (
                      <span className="ml-auto inline-flex shrink-0 items-center rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        {p === 'custom' ? 'কনফিগার্ড ✓' : 'কী ✓'}
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-1 text-[11px] text-muted-foreground">
                    {p === 'custom'
                      ? st?.configured && st.model
                        ? st.model
                        : 'Ollama · LM Studio · vLLM'
                      : PROVIDERS[p].keyHint}
                  </span>
                </button>
              );
            })}
          </div>

          {isCustom ? (
            /* ================= কাস্টম / লোকাল এন্ডপয়েন্ট ফর্ম ================= */
            <div className="space-y-2.5">
              {/* সেভ-করা কনফিগের অবস্থা */}
              <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                <p className="font-semibold text-foreground">সেভ-করা কনফিগ</p>
                {customStatus?.configured ? (
                  <ul className="mt-1 space-y-0.5">
                    <li>
                      Base URL: <span className="font-mono text-[11px]" dir="ltr">{customStatus.baseURL ?? '—'}</span>
                    </li>
                    <li>
                      মডেল: <span className="font-mono text-[11px]" dir="ltr">{customStatus.model ?? '—'}</span>
                    </li>
                    {customStatus.masked && (
                      <li>
                        কী: <span className="font-mono text-[11px]" dir="ltr">{customStatus.masked}</span>
                        {customStatus.source === 'env' ? ' (environment variable থেকে)' : ' (স্থানীয় ফাইল থেকে)'}
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="mt-1">
                    এখনো কোনো কনফিগ সেভ করা নেই — নিচে Base URL ও মডেলের নাম দিয়ে সংরক্ষণ করুন।
                  </p>
                )}
              </div>

              {/* Base URL (বাধ্যতামূলক) */}
              <div className="space-y-1.5">
                <Label htmlFor="custom-base-url" className="flex items-center gap-1.5 text-xs">
                  <Globe className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  Base URL <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="custom-base-url"
                  type="text"
                  value={customBaseUrl}
                  onChange={e => setCustomBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434/v1"
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="url"
                  dir="ltr"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  উদাহরণ — Ollama: <span className="font-mono" dir="ltr">http://localhost:11434/v1</span> ·
                  LM Studio: <span className="font-mono" dir="ltr">http://localhost:1234/v1</span> ·
                  vLLM: <span className="font-mono" dir="ltr">http://localhost:8000/v1</span>
                </p>
                <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                  কল দেয় এই অ্যাপের সার্ভার — এন্ডপয়েন্টটি সার্ভার থেকে পৌঁছানো যায় এমন ঠিকানা হতে
                  হবে (localhost শুধু তখনই যদি অ্যাপ নিজ মেশিনে চলে; রিমোট ডিপ্লয়ে হলে টানেল/LAN
                  ঠিকানা দিন)।
                </p>
              </div>

              {/* API কী (ঐচ্ছিক) */}
              <div className="space-y-1.5">
                <Label htmlFor="custom-api-key" className="text-xs">
                  API কী <span className="text-muted-foreground">(ঐচ্ছিক)</span>
                </Label>
                <div className="relative">
                  <Input
                    id="custom-api-key"
                    type={showCustomKey ? 'text' : 'password'}
                    value={customKey}
                    onChange={e => setCustomKey(e.target.value)}
                    placeholder={customStatus?.masked ? 'নতুন কী বসালে বদলে যাবে…' : 'কী লাগলে এখানে দিন…'}
                    autoComplete="off"
                    spellCheck={false}
                    className="pr-10 font-mono text-xs"
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCustomKey(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={showCustomKey ? 'কী লুকান' : 'কী দেখান'}
                  >
                    {showCustomKey ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  লোকাল সার্ভারে কী না লাগলে খালি রাখুন — খালি সেভ করলে কী-হীন কনফিগই সেভ হবে।
                </p>
              </div>

              {/* মডেলের নাম (বাধ্যতামূলক) */}
              <div className="space-y-1.5">
                <Label htmlFor="custom-model-name" className="flex items-center gap-1.5 text-xs">
                  <Cpu className="size-3 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  মডেলের নাম <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="custom-model-name"
                  type="text"
                  value={customModel}
                  onChange={e => setCustomModel(e.target.value)}
                  placeholder="llama3.2"
                  autoComplete="off"
                  spellCheck={false}
                  dir="ltr"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  এন্ডপয়েন্টে যে নামে মডেল সার্ভ হয় (যেমন llama3.2, qwen2.5:7b)।
                </p>
              </div>

              {/* সংযোগ-পরীক্ষা + মডেল-তালিকা */}
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void testCustom()}
                  disabled={isTesting}
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                >
                  {isTesting ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                  )}
                  {isTesting ? 'আনা হচ্ছে…' : 'মডেল-তালিকা আনুন'}
                </Button>

                {testResult && (
                  <div className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed">
                    {/* প্রকৃত চ্যাট-কলের ফল */}
                    {testResult.chat ? (
                      testResult.chat.ok ? (
                        <p className="flex items-start gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          সংযোগ ঠিক ✓ — মডেল{' '}
                          <span className="font-mono" dir="ltr">
                            {testResult.chat.servedModel ?? selectedCustomModel}
                          </span>{' '}
                          উত্তর দিয়েছে ({testResult.chat.ms} ms)।
                        </p>
                      ) : (
                        <p className="flex items-start gap-1.5 font-medium text-destructive">
                          <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          চ্যাট-কল ব্যর্থ — {testResult.chat.error}
                        </p>
                      )
                    ) : (
                      <p className="text-muted-foreground">
                        চ্যাট-পরীক্ষা করা হয়নি — মডেলের নাম দিয়ে আবার চাপলে প্রকৃত কল হবে।
                      </p>
                    )}

                    {/* /models তালিকার ফল */}
                    {testResult.modelsError ? (
                      <p className="text-amber-700 dark:text-amber-400">
                        ⚠ /models তালিকা আনা যায়নি — কিছু সার্ভারে এই এন্ডপয়েন্ট থাকে না।
                        {testResult.chat?.ok
                          ? ' তবে চ্যাট-কল সফল — এন্ডপয়েন্ট কাজ করছে।'
                          : ' মডেলের নাম দিয়ে আবার চেষ্টা করুন।'}
                        <span className="mt-0.5 block truncate font-mono text-muted-foreground" dir="ltr" title={testResult.modelsError}>
                          {testResult.modelsError}
                        </span>
                      </p>
                    ) : testResult.models.length > 0 ? (
                      <div>
                        <p className="mb-1 text-muted-foreground">
                          {testResult.models.length}টি মডেল পাওয়া গেছে — ক্লিক করে মডেলের নাম বসান:
                        </p>
                        <ul
                          className="max-h-48 overflow-y-auto rounded-md border border-border bg-background"
                          role="listbox"
                          aria-label="এন্ডপয়েন্টের মডেল-তালিকা"
                        >
                          {testResult.models.map(mid => {
                            const picked = mid === selectedCustomModel;
                            return (
                              <li key={mid}>
                                <button
                                  type="button"
                                  role="option"
                                  aria-selected={picked}
                                  onClick={() => setCustomModel(mid)}
                                  className={`flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[11px] transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/40 ${
                                    picked
                                      ? 'bg-emerald-50 font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                                      : ''
                                  }`}
                                  dir="ltr"
                                >
                                  <span className="min-w-0 flex-1 truncate">{mid}</span>
                                  {picked && (
                                    <Check className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                                  )}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        /models-এ কোনো মডেলের নাম পাওয়া যায়নি — হাতে মডেলের নাম লিখে পরীক্ষা করুন।
                      </p>
                    )}
                  </div>
                )}
              </div>

              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                Base URL, মডেলের নাম ও কী শুধু তোমার সার্ভারের storage/provider-keys.json ফাইলে
                থাকে — কখনো GitHub-এ আপলোড হয় না, কোনো তৃতীয় পক্ষকেও পাঠানো হয় না।
              </p>

              <div className="flex flex-row items-center gap-2 pt-0.5">
                {customStatus?.configured ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void removeCustom()}
                    disabled={isRemovingCustom}
                    className="text-destructive hover:text-destructive"
                  >
                    {isRemovingCustom ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-4" aria-hidden="true" />
                    )}
                    কনফিগ মুছে দাও
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground">কোনো কনফিগ সংরক্ষিত নেই</span>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void saveCustom()}
                  disabled={isSavingCustom}
                  className="ml-auto bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {isSavingCustom ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <KeyRound className="size-4" aria-hidden="true" />
                  )}
                  সংরক্ষণ করো
                </Button>
              </div>
            </div>
          ) : (
            /* ================= Z.ai API / GLM BigModel ফর্ম (আগের মতোই) ================= */
            <>
              {/* নির্বাচিত প্রোভাইডারের তথ্য */}
              <div className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                <p>{effectiveInfo.note}</p>
                {effectiveInfo.keyUrl && (
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
                )}
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
            </>
          )}
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
