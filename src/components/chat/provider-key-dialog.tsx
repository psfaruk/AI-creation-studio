'use client';

// ============================================================
// এক্সটার্নাল-প্রোভাইডার API-কী ডায়ালগ।
//  - প্রোভাইডার বেছে কী পেস্ট করা → POST /api/provider-keys
//  - raw কী কখনোই ফেরে না — শুধু মাস্কড প্রিভিউ (sk-a1…b2c)
//  - কী স্থানীয়ভাবে storage/provider-keys.json-এ থাকে
//    (.gitignore-সুরক্ষিত — GitHub-এ যায় না)
//  - সৎ নোট: কোন প্রোভাইডার ফ্রি-টিয়ার, কোনটি পে-অ্যাজ-ইউ-গো
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, ExternalLink, KeyRound, Loader2, Lock, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  useEffect(() => {
    if (open) {
      setProvider(initialProvider ?? 'zai-api');
      setKeyValue('');
      setShowKey(false);
    }
  }, [open, initialProvider]);

  // GLM-only ক্যাটালগে EXTERNAL_PROVIDER_ORDER-এ সব স্লট বৈধ —
  // পুরনো মান থাকলে সৎ-ডিফল্টে ফেরাও
  const effectiveProvider: ChatProviderId = provider in PROVIDERS ? provider : 'zai-api';
  const effectiveInfo = PROVIDERS[effectiveProvider];
  const status = keyStatuses?.[effectiveProvider];

  const saveKey = useCallback(async () => {
    if (isSaving) return;
    const trimmed = keyValue.trim();
    if (trimmed.length < 8 || /\s/.test(trimmed)) {
      toast({
        title: 'কী-এর আকৃতি সঠিক নয়',
        description: 'অন্তত ৮ অক্ষরের, ভেতরে সাদাস্থান-বিহীন কী দিন।',
        variant: 'destructive',
      });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch('/api/provider-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: effectiveProvider, key: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        toast({
          title: 'কী সংরক্ষণ ব্যর্থ',
          description: data?.error ?? 'আবার চেষ্টা করুন।',
          variant: 'destructive',
        });
        return;
      }
      setKeyValue('');
      toast({
        title: `${effectiveInfo.label}: কী সংরক্ষিত`,
        description: 'মডেল-তালিকায় "যাচাই করুন" চাপলে প্রকৃত সংযোগ পরীক্ষা হবে।',
      });
      onKeysChanged?.();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, keyValue, effectiveProvider, effectiveInfo.label, onKeysChanged]);

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
          title: 'কী মুছে ফেলা ব্যর্থ',
          description: data?.error ?? 'আবার চেষ্টা করুন।',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: `${effectiveInfo.label}: কী মুছে ফেলা হয়েছে` });
      onKeysChanged?.();
    } catch {
      toast({ title: 'নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন', variant: 'destructive' });
    } finally {
      setIsRemoving(false);
    }
  }, [isRemoving, effectiveProvider, effectiveInfo.label, onKeysChanged]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            নিজের GLM প্রোভাইডারের API কী
          </DialogTitle>
          <DialogDescription>
            Z.ai SDK-র বিল্ট-ইন পথ সবার সাথে শেয়ার্ড রেট-লিমিটে চলে। নিজের GLM কী দিলে
            আলাদা কোটায় GLM-৫.৩ / GLM-৪ সিরিজের মডেল চলবে।
          </DialogDescription>
        </DialogHeader>

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
              placeholder="কী এখানে পেস্ট করুন…"
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
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            কী শুধু তোমার সার্ভারের storage/provider-keys.json ফাইলে থাকে — কখনো GitHub-এ
            আপলোড হয় না, কোনো তৃতীয় পক্ষকেও পাঠানো হয় না।
          </p>
        </div>

        <DialogFooter className="flex-row items-center gap-2 sm:justify-between">
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
            disabled={isSaving || keyValue.trim().length === 0}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
            {status?.hasKey ? 'কী বদলাও' : 'কী সংরক্ষণ করো'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
