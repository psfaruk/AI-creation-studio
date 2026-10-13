'use client';

// ============================================================
// কাস্টম API-প্ল্যাটফর্ম ডায়ালগ — ব্যবহারকারীর নিজের
// OpenAI-কম্প্যাটিবল সিস্টেম যুক্ত করার পথ:
//   Base URL + API Key + মডেল-নির্বাচন (+ ভাষা)
//
//  - "মডেল তালিকা আনুন" → POST /api/custom-providers/probe
//    (সার্ভার প্ল্যাটফর্মের আসল GET /models-এ Bearer কী-সহ ডাকে)
//  - /models না থাকলে মডেল-নাম হাতে লিখেও যোগ করা যায় (সৎ ব্যবস্থা)
//  - সংরক্ষণ → POST /api/custom-providers; কী কেবল লোকাল
//    storage/custom-providers.json-এ (.gitignore-সুরক্ষিত)
//  - তালিকা থেকে যেকোনো প্ল্যাটফর্ম সম্পাদনা/রিফ্রেশ/মুছে ফেলা যায়
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import {
  CircleAlert,
  Eye,
  EyeOff,
  Globe,
  Image as ImageIcon,
  Loader2,
  Lock,
  PlusCircle,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';

/** GET /api/custom-providers-এর আকৃতি (কী মাস্কড) */
export interface CustomProviderCard {
  id: string;
  name: string;
  baseUrl: string;
  keyMasked: string;
  language: 'auto' | 'bn' | 'en';
  modelCount: number;
  createdAt: string;
  lastSyncAt?: string;
}

interface ProbeResponse {
  ok: boolean;
  models?: string[];
  host?: string;
  ms?: number;
  error?: string;
  authFailed?: boolean;
}

const LANG_LABELS: Record<'auto' | 'bn' | 'en', string> = {
  auto: 'স্বয়ংক্রিয় (মডেলের ডিফল্ট)',
  bn: 'বাংলা',
  en: 'English',
};

/** ইমেজ-মডেলের আন্দাজ — চ্যাটে চলবে না বলে সৎ সতর্কতা */
function looksLikeImageModel(apiModel: string): boolean {
  return /cogview|dall-?e|imagen|flux|stable-?diffusion|sd3|sdxl|image|banana/i.test(apiModel);
}

export function CustomProviderDialog({
  open,
  onOpenChange,
  onProvidersChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** যোগ/সম্পাদনা/মুছে ফেলার পরে মডেল-তালিকা রিফ্রেশের কলব্যাক */
  onProvidersChanged?: () => void;
}) {
  // ---- বিদ্যমান প্ল্যাটফর্মের তালিকা ----
  const [providers, setProviders] = useState<CustomProviderCard[] | null>(null);
  const [isLoadingProviders, setIsLoadingProviders] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // ---- যোগ-ফর্মের অবস্থা ----
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [language, setLanguage] = useState<'auto' | 'bn' | 'en'>('auto');
  const [showKey, setShowKey] = useState(false);

  // ---- প্রোব-ফলাফল ----
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manualModel, setManualModel] = useState('');

  const [isSaving, setIsSaving] = useState(false);

  const loadProviders = useCallback(async () => {
    setIsLoadingProviders(true);
    try {
      const res = await fetch('/api/custom-providers');
      const data = (await res.json().catch(() => null)) as { providers?: CustomProviderCard[] } | null;
      setProviders(Array.isArray(data?.providers) ? data!.providers! : []);
    } catch {
      setProviders([]);
    } finally {
      setIsLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadProviders();
      // ফর্ম রিসেট
      setName('');
      setBaseUrl('');
      setApiKey('');
      setLanguage('auto');
      setShowKey(false);
      setProbeError(null);
      setAvailableModels(null);
      setSelected(new Set());
      setManualModel('');
    }
  }, [open, loadProviders]);

  // ---- মডেল-তালিকা আনা (লাইভ প্রোব) ----
  const runProbe = useCallback(async () => {
    if (probeBusy) return;
    const url = baseUrl.trim();
    const key = apiKey.trim();
    if (!url || !key) {
      setProbeError('আগে Base URL ও API কী দুটোই পূরণ করুন।');
      return;
    }
    setProbeBusy(true);
    setProbeError(null);
    try {
      const res = await fetch('/api/custom-providers/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: url, apiKey: key }),
      });
      const data = (await res.json().catch(() => null)) as ProbeResponse | null;
      if (!data || !data.ok || !Array.isArray(data.models)) {
        setAvailableModels(null);
        setSelected(new Set());
        setProbeError(data?.error ?? 'মডেল-তালিকা আনা যায়নি — নিচের ঘরে মডেল-নাম হাতে লিখে যোগ করতে পারেন।');
        return;
      }
      setAvailableModels(data.models);
      // ডিফল্টে সব নির্বাচিত — ব্যবহারকারী বাদ দিতে পারবেন
      setSelected(new Set(data.models));
      toast({
        title: `মডেল পাওয়া গেছে: ${data.models.length}টি`,
        description: `${data.host ?? ''} · ${data.ms ?? 0}ms`,
      });
    } catch {
      setProbeError('নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।');
    } finally {
      setProbeBusy(false);
    }
  }, [probeBusy, baseUrl, apiKey]);

  // ---- হাতে-লেখা মডেল যোগ ----
  const addManualModel = useCallback(() => {
    const m = manualModel.trim();
    if (!m) return;
    if (looksLikeImageModel(m)) {
      toast({
        title: 'এটি সম্ভবত ইমেজ-মডেল',
        description: 'চ্যাটে ব্যবহারে ত্রুটি আসতে পারে — তবু যোগ করা হলো (সৎ ব্যাজ থাকবে)।',
      });
    }
    setAvailableModels(prev => Array.from(new Set([...(prev ?? []), m])).sort((a, b) => a.localeCompare(b)));
    setSelected(prev => new Set([...prev, m]));
    setManualModel('');
  }, [manualModel]);

  // ---- সংরক্ষণ ----
  const saveProvider = useCallback(async () => {
    if (isSaving) return;
    const models = Array.from(selected);
    if (models.length === 0) {
      toast({
        title: 'অন্তত একটি মডেল নির্বাচন করুন',
        description: '"মডেল তালিকা আনুন" চাপুন, বা নিচের ঘরে মডেল-নাম হাতে লিখুন।',
        variant: 'destructive',
      });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/custom-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || undefined,
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim(),
          language,
          models,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; warning?: string } | null;
      if (!res.ok) {
        toast({ title: 'সংরক্ষণ ব্যর্থ', description: data?.error ?? 'আবার চেষ্টা করুন।', variant: 'destructive' });
        return;
      }
      toast({
        title: 'কাস্টম প্ল্যাটফর্ম যোগ হয়েছে',
        description: `মডেল-সিলেক্টরে ${models.length}টি মডেল যুক্ত হলো${data?.warning ? ` — ${data.warning}` : ''}`,
      });
      // ফর্ম রিসেট + তালিকা রিফ্রেশ
      setName('');
      setBaseUrl('');
      setApiKey('');
      setLanguage('auto');
      setAvailableModels(null);
      setSelected(new Set());
      setManualModel('');
      await loadProviders();
      onProvidersChanged?.();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, selected, name, baseUrl, apiKey, language, loadProviders, onProvidersChanged]);

  // ---- প্ল্যাটফর্ম মুছে ফেলা ----
  const deleteProvider = useCallback(
    async (id: string, providerName: string) => {
      if (busyId) return;
      if (!window.confirm(`"${providerName}" প্ল্যাটফর্মটি সরিয়ে দিতে চাও? এর সব মডেল তালিকা থেকে চলে যাবে।`)) {
        return;
      }
      setBusyId(id);
      try {
        const res = await fetch(`/api/custom-providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          toast({ title: 'মুছে ফেলা ব্যর্থ', description: data?.error ?? '', variant: 'destructive' });
          return;
        }
        toast({ title: `${providerName} সরিয়ে দেওয়া হয়েছে` });
        await loadProviders();
        onProvidersChanged?.();
      } catch {
        toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
      } finally {
        setBusyId(null);
      }
    },
    [busyId, loadProviders, onProvidersChanged]
  );

  // ---- সংরক্ষিত কী দিয়ে রিফ্রেশ (সম্পাদনা-ফর্মে ফলাফল আনে) ----
  const refreshProvider = useCallback(
    async (id: string) => {
      if (busyId) return;
      setBusyId(id);
      try {
        const res = await fetch(`/api/custom-providers/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
        const data = (await res.json().catch(() => null)) as ProbeResponse | null;
        if (!res.ok || !data?.ok) {
          toast({ title: 'রিফ্রেশ ব্যর্থ', description: data?.error ?? '', variant: 'destructive' });
          return;
        }
        setAvailableModels(data.models ?? []);
        setSelected(new Set(data.models ?? []));
        toast({ title: `লাইভ তালিকা এলো: ${data.models?.length ?? 0}টি মডেল`, description: 'পছন্দমতো বেছে "সংরক্ষণ করুন" চাপুন।' });
      } catch {
        toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
      } finally {
        setBusyId(null);
      }
    },
    [busyId]
  );

  const toggleModel = useCallback((m: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            নিজের API-প্ল্যাটফর্ম যুক্ত করুন
          </DialogTitle>
          <DialogDescription>
            তোমার নিজের তৈরি OpenAI-কম্প্যাটিবল সিস্টেম যোগ করো — Base URL + API Key + মডেল নির্বাচন।
            প্রতিটি চ্যাট-কল সরাসরি তোমার প্ল্যাটফর্মে যাবে (যেমন:{' '}
            <span className="font-mono text-[11px]">https://…/api/v1</span>)।
          </DialogDescription>
        </DialogHeader>

        {/* ---------- বিদ্যমান প্ল্যাটফর্মের তালিকা ---------- */}
        {isLoadingProviders ? (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            তালিকা লোড হচ্ছে…
          </div>
        ) : providers && providers.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              যুক্ত প্ল্যাটফর্ম ({providers.length})
            </p>
            <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {providers.map(p => {
                let host = p.baseUrl;
                try {
                  host = new URL(p.baseUrl).host;
                } catch {
                  /* যথাযথ URL নয় — পুরোটা দেখাও */
                }
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2"
                  >
                    <Globe className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{p.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {host} · {p.modelCount}টি মডেল · {p.keyMasked}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshProvider(p.id)}
                      disabled={busyId === p.id}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                      aria-label={`${p.name}-এর মডেল-তালিকা রিফ্রেশ করুন`}
                      title="লাইভ মডেল-তালিকা এনে নিচের ফর্মে দেখাও"
                    >
                      {busyId === p.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RefreshCw className="size-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteProvider(p.id, p.name)}
                      disabled={busyId === p.id}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                      aria-label={`${p.name} সরিয়ে দিন`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* ---------- যোগ-ফর্ম ---------- */}
        <div className="space-y-3">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <PlusCircle className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            নতুন প্ল্যাটফর্ম
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cp-name" className="text-xs">
                নাম (ঐচ্ছিক)
              </Label>
              <Input
                id="cp-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="যেমন: আমার প্ল্যাটফর্ম"
                autoComplete="off"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cp-language" className="text-xs">
                উত্তরের ভাষা
              </Label>
              <Select value={language} onValueChange={v => setLanguage(v as 'auto' | 'bn' | 'en')}>
                <SelectTrigger id="cp-language" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{LANG_LABELS.auto}</SelectItem>
                  <SelectItem value="bn">{LANG_LABELS.bn}</SelectItem>
                  <SelectItem value="en">{LANG_LABELS.en}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-baseurl" className="text-xs">
              Base URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cp-baseurl"
              value={baseUrl}
              onChange={e => {
                setBaseUrl(e.target.value);
                setAvailableModels(null);
                setProbeError(null);
              }}
              placeholder="https://your-platform.example/api/v1"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
              className="h-9 font-mono text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-apikey" className="text-xs">
              API Key <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                id="cp-apikey"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => {
                  setApiKey(e.target.value);
                  setProbeError(null);
                }}
                placeholder="যেমন: amai_sk_…"
                autoComplete="off"
                spellCheck={false}
                className="h-9 pr-10 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={showKey ? 'কী লুকান' : 'কী দেখান'}
              >
                {showKey ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
              </button>
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              কী শুধু তোমার সার্ভারে storage/custom-providers.json-এ থাকে — কখনো GitHub-এ যায় না।
            </p>
          </div>

          {/* প্রোব-বাটন */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runProbe()}
              disabled={probeBusy || baseUrl.trim() === '' || apiKey.trim() === ''}
            >
              {probeBusy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Globe className="size-3.5" aria-hidden="true" />
              )}
              মডেল তালিকা আনুন (লাইভ)
            </Button>
            {availableModels && (
              <span className="text-[11px] text-muted-foreground">
                {availableModels.length}টি পাওয়া গেছে · নির্বাচিত {selected.size}
              </span>
            )}
          </div>

          {probeError && (
            <div
              role="alert"
              className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
            >
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>{probeError}</span>
            </div>
          )}

          {/* মডেল-নির্বাচন */}
          {availableModels && availableModels.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">মডেল নির্বাচন (যেগুলো চ্যাটে দেখাবে)</Label>
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {availableModels.map(m => {
                  const imagey = looksLikeImageModel(m);
                  const checked = selected.has(m);
                  return (
                    <label
                      key={m}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleModel(m)}
                        aria-label={`${m} ${checked ? 'বাদ দিন' : 'নির্বাচন করুন'}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{m}</span>
                      {imagey && (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-px text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-400"
                          title="সম্ভবত ইমেজ-জেনারেশন মডেল — চ্যাটে নাও চলতে পারে"
                        >
                          <ImageIcon className="size-2.5" aria-hidden="true" />
                          ইমেজ?
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* হাতে-লেখা মডেল-যোগ (/models নেই এমন প্ল্যাটফর্মের জন্য) */}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="cp-manual-model" className="text-xs">
                মডেল-নাম হাতে লিখে যোগ (ঐচ্ছিক)
              </Label>
              <Input
                id="cp-manual-model"
                value={manualModel}
                onChange={e => setManualModel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addManualModel();
                  }
                }}
                placeholder="যেমন: glm-5.3"
                autoComplete="off"
                spellCheck={false}
                className="h-9 font-mono text-xs"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={addManualModel}
              disabled={manualModel.trim() === ''}
            >
              <PlusCircle className="size-3.5" aria-hidden="true" />
              যোগ
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="sm"
            onClick={() => void saveProvider()}
            disabled={isSaving || baseUrl.trim() === '' || apiKey.trim() === '' || selected.size === 0}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Server className="size-4" aria-hidden="true" />
            )}
            প্ল্যাটফর্ম সংরক্ষণ করুন
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
