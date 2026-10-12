'use client';

// ============================================================
// KeysView — প্ল্যাটফর্ম API-কী ব্যবস্থাপনা প্যানেল
//
// ব্যবহারকারীর নিজ-প্ল্যাটফর্মের আয়না:
//  "Let other people and apps use your real AI models — each key
//   is bound to one model, rate-limited, and every call is logged."
//   · Model-bound · Rate-limited · Every call logged · SHA-256 hash
//   · "This platform only lists models verified with live API
//      calls — no fake labels."
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Check,
  Copy,
  Eye,
  Gauge,
  History,
  Image as ImageIcon,
  KeyRound,
  Languages,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  ScanEye,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';

// ------------------------------------------------------------
// ধরন
// ------------------------------------------------------------

interface PlatformModelInfo {
  id: string;
  name: string;
  kind: 'chat' | 'vision' | 'image';
  description: string;
  backend: string;
  sizes?: string[];
  verification: {
    ok: boolean;
    servedModel?: string;
    ms?: number;
    rateLimited?: boolean;
    error?: string;
    testedAt: string;
  } | null;
}

interface KeyRecord {
  id: string;
  name: string;
  keyMasked: string;
  modelId: string;
  rateLimitPerMin: number;
  defaultLanguage: string;
  status: string;
  createdAt: string;
  revokedAt: string | null;
  stats: {
    totalRequests: number;
    last24h: number;
    avgLatencyMs: number | null;
    lastUsedAt: string | null;
    recentErrors: Array<{ at: string; status: number; error: string | null; endpoint: string }>;
  };
}

interface KeysPayload {
  keys: KeyRecord[];
  models: PlatformModelInfo[];
}

const KIND_LABEL: Record<PlatformModelInfo['kind'], string> = {
  chat: 'চ্যাট',
  vision: 'ভিশন',
  image: 'ইমেজ',
};

const KIND_ICON: Record<PlatformModelInfo['kind'], typeof MessageSquare> = {
  chat: MessageSquare,
  vision: ScanEye,
  image: ImageIcon,
};

// ------------------------------------------------------------
// কপি-বাটন (ছোট)
// ------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={label ? 'sm' : 'icon'}
      className={cn(label ? 'h-8 gap-1.5' : 'size-8 shrink-0')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // ক্লিপবোর্ড অনুমতি নেই — নীরব
        }
      }}
      aria-label={label ? `${label} কপি করুন` : 'কপি করুন'}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {label ? <span>{copied ? 'কপি হয়েছে' : label}</span> : null}
    </Button>
  );
}

/** curl-উদাহরণ ব্লক */
function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="rounded-lg border bg-muted/40">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium">{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="max-h-64 overflow-auto px-3 py-2.5 text-[11px] leading-relaxed">
        <code className="break-all whitespace-pre-wrap">{code}</code>
      </pre>
    </div>
  );
}

// ------------------------------------------------------------
// মূল ভিউ
// ------------------------------------------------------------

export function KeysView() {
  const [payload, setPayload] = useState<KeysPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', modelId: '', rate: '120', language: 'auto' });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ full: string; name: string; modelId: string } | null>(null);

  const [verifyBusy, setVerifyBusy] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/keys', { cache: 'no-store' });
      if (!res.ok) throw new Error(`তালিকা আনা যায়নি (${res.status})`);
      const data = (await res.json()) as KeysPayload;
      setPayload(data);
      setError(null);
      setForm(f => ({ ...f, modelId: f.modelId || data.models.find(m => m.verification?.ok)?.id || data.models[0]?.id || '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'অজানা ত্রুটি');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const baseUrl = `${origin}/api/v1`;

  const verifiedCount = useMemo(
    () => payload?.models.filter(m => m.verification?.ok).length ?? 0,
    [payload]
  );

  const createKey = useCallback(async () => {
    if (!form.name.trim() || !form.modelId) return;
    setCreating(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          modelId: form.modelId,
          rateLimitPerMin: Number.parseInt(form.rate, 10) || 120,
          defaultLanguage: form.language,
        }),
      });
      const data = (await res.json()) as { full?: string; error?: string };
      if (!res.ok || !data.full) throw new Error(data.error ?? 'কী তৈরি যায়নি');
      setCreated({ full: data.full, name: form.name.trim(), modelId: form.modelId });
      setCreateOpen(false);
      setForm({ name: '', modelId: form.modelId, rate: '120', language: 'auto' });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'কী তৈরি যায়নি');
    } finally {
      setCreating(false);
    }
  }, [form, reload]);

  const verifyModel = useCallback(
    async (model: string) => {
      setVerifyBusy(model);
      try {
        await fetch('/api/keys/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        await reload();
      } finally {
        setVerifyBusy(null);
      }
    },
    [reload]
  );

  const revokeKey = useCallback(
    async (id: string) => {
      setRevokingId(id);
      try {
        await fetch(`/api/keys/${id}`, { method: 'DELETE' });
        await reload();
      } finally {
        setRevokingId(null);
      }
    },
    [reload]
  );

  const selectedModel = payload?.models.find(m => m.id === form.modelId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
      {/* ---------- হেডার ---------- */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <KeyRound className="size-5 text-emerald-600" aria-hidden />
              API Keys
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              অন্য মানুষ ও অ্যাপকে আপনার <strong>প্রকৃত AI মডেল</strong> ব্যবহার করতে দিন — প্রতিটি কী
              একটি মডেলে বাঁধা, রেট-লিমিটেড, আর প্রতিটি কল লগ হয়।
            </p>
          </div>
          <Button type="button" onClick={() => setCreateOpen(true)} className="gap-1.5">
            <Plus className="size-4" aria-hidden />
            কী তৈরি করুন
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {[
            { icon: ShieldCheck, label: 'Model-bound' },
            { icon: Gauge, label: 'Rate-limited' },
            { icon: History, label: 'প্রতিটি কল লগ হয়' },
            { icon: KeyRound, label: 'SHA-256 হ্যাশে সংরক্ষিত' },
          ].map(({ icon: Icon, label }) => (
            <Badge key={label} variant="secondary" className="gap-1 font-normal">
              <Icon className="size-3" aria-hidden />
              {label}
            </Badge>
          ))}
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>সমস্যা</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* ---------- কী-তালিকা ---------- */}
      <section aria-label="কী-তালিকা" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          আপনার কী{' '}
          <span className="font-normal text-muted-foreground">
            ({toBnDigits(payload?.keys.length ?? 0)}টি)
          </span>
        </h2>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> লোড হচ্ছে…
          </div>
        ) : (payload?.keys.length ?? 0) === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
              <KeyRound className="size-8 text-muted-foreground/50" aria-hidden />
              <p className="text-sm text-muted-foreground">
                এখনো কোনো কী নেই — &ldquo;কী তৈরি করুন&rdquo; থেকে শুরু করুন।
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {payload!.keys.map(k => (
              <KeyCard
                key={k.id}
                record={k}
                revoking={revokingId === k.id}
                onRevoke={() => void revokeKey(k.id)}
              />
            ))}
          </div>
        )}
      </section>

      <Separator />

      {/* ---------- মডেল-তালিকা ---------- */}
      <section aria-label="প্ল্যাটফর্ম-মডেল" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">প্ল্যাটফর্ম-মডেল</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              এই প্ল্যাটফর্ম কেবল <strong>লাইভ API-কলে যাচাইকৃত</strong> মডেলই তালিকাভুক্ত করে — কোনো
              ভুয়া লেবেল নয়। (যাচাইকৃত: {toBnDigits(verifiedCount)}/
              {toBnDigits(payload?.models.length ?? 0)})
            </p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {payload?.models.map(m => {
            const v = m.verification;
            const Icon = KIND_ICON[m.kind];
            return (
              <Card key={m.id} className="gap-3">
                <CardHeader className="pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Icon className="size-4 text-emerald-600" aria-hidden />
                      {m.name}
                    </CardTitle>
                    {v?.ok ? (
                      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                        <BadgeCheck className="size-3" aria-hidden /> যাচাইকৃত
                      </Badge>
                    ) : v?.rateLimited ? (
                      <Badge variant="destructive">৪২৯</Badge>
                    ) : (
                      <Badge variant="secondary">অযাচাই</Badge>
                    )}
                  </div>
                  <CardDescription className="font-mono text-[11px]">({m.id})</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
                  <p className="leading-relaxed">{m.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="outline">{KIND_LABEL[m.kind]}</Badge>
                    {v?.servedModel ? (
                      <Badge variant="outline" className="font-mono">
                        served: {v.servedModel}
                      </Badge>
                    ) : null}
                    {v?.ms != null ? (
                      <Badge variant="outline">{toBnDigits(v.ms)}ms</Badge>
                    ) : null}
                  </div>
                  {v?.ok && v.testedAt ? (
                    <p className="text-[11px]">
                      সর্বশেষ যাচাই: {relativeTimeBn(v.testedAt)}
                    </p>
                  ) : null}
                  {v && !v.ok && v.error ? (
                    <p className="text-[11px] text-destructive">{v.error}</p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 w-full gap-1.5"
                    onClick={() => void verifyModel(m.id)}
                    disabled={verifyBusy !== null}
                  >
                    {verifyBusy === m.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <RefreshCw className="size-3.5" aria-hidden />
                    )}
                    লাইভ-যাচাই করুন
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* ---------- API ডকুমেন্টেশন ---------- */}
      <section aria-label="API ডকুমেন্টেশন" className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold">API ডকুমেন্টেশন</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            OpenAI-কম্প্যাটিবল এন্ডপয়েন্ট — যেকোনো OpenAI ক্লায়েন্টকে এই বেস URL-এ আপনার কীসহ
            নির্দেশ করুন।
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
          <span className="text-xs font-medium">Base URL</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{baseUrl}</code>
          <CopyButton text={baseUrl} />
        </div>
        <div className="grid gap-3">
          <CodeBlock
            title="GET List models"
            code={`curl ${baseUrl}/models \\\n  -H "Authorization: Bearer amai_sk_…"`}
          />
          <CodeBlock
            title="POST Chat completions"
            code={`curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer amai_sk_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "glm-4-plus",\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`}
          />
          <CodeBlock
            title="POST Chat completions — স্ট্রিমিং"
            code={`curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer amai_sk_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "glm-4-plus",\n    "stream": true,\n    "messages": [{"role": "user", "content": "Hello!"}]\n  }'`}
          />
          <CodeBlock
            title="POST Chat completions — glm-5v-turbo (Vision)"
            code={`curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer amai_sk_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "glm-5v-turbo",\n    "messages": [{\n      "role": "user",\n      "content": [\n        {"type": "text", "text": "What is in this image?"},\n        {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}}\n      ]\n    }]\n  }'`}
          />
          <CodeBlock
            title="POST Image generation — cogview-3"
            code={`curl ${baseUrl}/images/generations \\\n  -H "Authorization: Bearer amai_sk_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "model": "cogview-3",\n    "prompt": "a red circle on white background",\n    "size": "1024x1024"\n  }'`}
          />
        </div>
      </section>

      {/* ---------- কী-তৈরি ডায়ালগ ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>নতুন API কী</DialogTitle>
            <DialogDescription>
              কীটি একটি নির্দিষ্ট মডেলে বাঁধা হবে — কেবল সেই মডেলেই ডাকা যাবে।
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-name">নাম</Label>
              <Input
                id="key-name"
                placeholder="যেমন: Hello"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                maxLength={60}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>মডেল</Label>
              <Select
                value={form.modelId}
                onValueChange={v => setForm(f => ({ ...f, modelId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="মডেল বাছুন" />
                </SelectTrigger>
                <SelectContent>
                  {payload?.models.map(m => (
                    <SelectItem key={m.id} value={m.id} disabled={!m.verification?.ok}>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-xs">{m.id}</span>
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          {KIND_LABEL[m.kind]}
                        </Badge>
                        {m.verification?.ok ? (
                          <BadgeCheck className="size-3 text-emerald-600" aria-hidden />
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedModel ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {selectedModel.description}
                  {!selectedModel.verification?.ok
                    ? ' — (এই মডেল এখনো লাইভ-যাচাই হয়নি; আগে যাচাই করুন)'
                    : ''}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="key-rate">রেট-লিমিট (req/min)</Label>
                <Input
                  id="key-rate"
                  type="number"
                  min={1}
                  max={600}
                  value={form.rate}
                  onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>ডিফল্ট ভাষা</Label>
                <Select
                  value={form.language}
                  onValueChange={v => setForm(f => ({ ...f, language: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">স্বয়ংক্রিয়</SelectItem>
                    <SelectItem value="bn">বাংলা</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              বাতিল
            </Button>
            <Button onClick={() => void createKey()} disabled={creating || !form.name.trim() || !form.modelId}>
              {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              কী তৈরি করুন
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- তৈরি-হওয়া কী (একবারই দেখানো) ---------- */}
      <Dialog
        open={created != null}
        onOpenChange={open => {
          if (!open) setCreated(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="size-4 text-emerald-600" aria-hidden />
              কী তৈরি হয়েছে — এখনই কপি করুন
            </DialogTitle>
            <DialogDescription>
              &ldquo;{created?.name}&rdquo; → <span className="font-mono">{created?.modelId}</span>।
              পূর্ণ কী <strong>আর কখনো দেখানো হবে না</strong> — সার্ভারে কেবল SHA-256 হ্যাশ থাকে।
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{created?.full}</code>
            <CopyButton text={created?.full ?? ''} />
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>সম্পন্ন</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------
// কী-কার্ড
// ------------------------------------------------------------

function KeyCard({
  record,
  revoking,
  onRevoke,
}: {
  record: KeyRecord;
  revoking: boolean;
  onRevoke: () => void;
}) {
  const active = record.status === 'active';
  const s = record.stats;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <span className="truncate">{record.name}</span>
              {active ? (
                <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                  <Activity className="size-3" aria-hidden /> Active
                </Badge>
              ) : (
                <Badge variant="secondary">Revoked</Badge>
              )}
              {record.defaultLanguage !== 'auto' ? (
                <Badge variant="outline" className="gap-1">
                  <Languages className="size-3" aria-hidden />
                  {record.defaultLanguage === 'bn' ? 'বাংলা' : 'EN'}
                </Badge>
              ) : null}
            </CardTitle>
            <div className="mt-1.5 flex items-center gap-1.5">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {record.keyMasked}
              </code>
              <CopyButton text={record.keyMasked} />
            </div>
          </div>
          {active ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" disabled={revoking}>
                  {revoking ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden />
                  )}
                  Revoke
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>কী বাতিল করবেন?</AlertDialogTitle>
                  <AlertDialogDescription>
                    &ldquo;{record.name}&rdquo; ({record.keyMasked}) বাতিল হলে এই কী দিয়ে আর কোনো
                    API-কল চলবে না। এটি ফেরানো যায় না।
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>না, থাক</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={onRevoke}
                  >
                    হ্যাঁ, বাতিল করুন
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-1.5 pb-3">
          <Badge variant="secondary" className="font-mono text-[11px]">
            {record.modelId}
          </Badge>
          <Badge variant="outline">{toBnDigits(record.rateLimitPerMin)} req/min</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="মোট অনুরোধ" value={toBnDigits(s.totalRequests)} />
          <Stat label="শেষ ২৪ঘা" value={toBnDigits(s.last24h)} />
          <Stat
            label="গড় latency"
            value={s.avgLatencyMs != null ? `${toBnDigits(s.avgLatencyMs)}ms` : '—'}
          />
          <Stat
            label="সর্বশেষ ব্যবহার"
            value={s.lastUsedAt ? relativeTimeBn(s.lastUsedAt) : 'কখনো নয়'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}
