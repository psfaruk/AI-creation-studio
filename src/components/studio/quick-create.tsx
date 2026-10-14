'use client';

// ============================================================
// QuickCreateCard (S9) — "⚡ দ্রুত তৈরি"।
// চ্যাট-LLM ছাড়াই সরাসরি POST /api/productions-এ
// মিউজিক ভিডিও / শর্ট ফিল্ম / মোশন ভিডিও / ইনস্ট্রুমেন্টাল
// মিউজিক প্রস্তাব তৈরি — রেট-লিমিটেড (৪২৯) উইন্ডোতেও
// স্টুডিওর কাজ চালু থাকে।
//
// সফল হলে: সাফল্য-টোস্ট + তালিকা রিফ্রেশ — নতুন কার্ড
// awaiting_confirmation অবস্থায় একই ভিউতে বসে এবং
// production-card.tsx-এর বিদ্যমান "নিশ্চিত করুন" বাটন দেখায়।
// সার্ভারের সৎ adjustments/notes ফর্মের নিচে ছোট নোটে দেখানো হয়।
// ============================================================

import { useState, type FormEvent } from 'react';
import { Loader2, Zap } from 'lucide-react';

import { toBnDigits } from '@/components/chat/bn-format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import type {
  AspectRatio,
  CreativeJobSpec,
  ProductionSummary,
  QualityPreset,
  SpecAdjustment,
  VideoEngine,
} from '@/lib/types';

// (অডিট সম্পূর্ণকরণ) চতুর্থ দ্রুত-তৈরি পথ — অডিও/ইনস্ট্রুমেন্টাল;
// স্পেকে type:'audio' + audioOperation:'instrumental' হয়
type QuickType = 'music_video' | 'short_film' | 'motion_video' | 'audio_instrumental';

const TYPE_OPTIONS: { value: QuickType; label: string }[] = [
  { value: 'music_video', label: 'মিউজিক ভিডিও' },
  { value: 'short_film', label: 'শর্ট ফিল্ম' },
  { value: 'motion_video', label: 'মোশন ভিডিও' },
  { value: 'audio_instrumental', label: 'ইনস্ট্রুমেন্টাল মিউজিক' },
];

/** ধরন-ভিত্তিক ডিফল্ট ও সীমা (§১৫ যাচাই-সীমার সাথে সঙ্গত)।
 *  ইনস্ট্রুমেন্টালে aspect নেই (অডিও) — পাইপলাইনের নিজস্ব
 *  ৮–১২০ সে. ক্ল্যাম্প অনুযায়ী সীমা। */
const TYPE_META: Record<
  QuickType,
  {
    durationSec: number;
    aspect?: AspectRatio;
    min: number;
    max: number;
    fieldLabel: string;
    isAudioInstrumental?: boolean;
  }
> = {
  music_video: { durationSec: 40, aspect: '9:16', min: 15, max: 180, fieldLabel: 'আইডিয়া' },
  short_film: { durationSec: 40, aspect: '16:9', min: 30, max: 120, fieldLabel: 'গল্প' },
  motion_video: { durationSec: 12, aspect: '16:9', min: 5, max: 20, fieldLabel: 'আইডিয়া' },
  audio_instrumental: {
    durationSec: 30,
    min: 8,
    max: 120,
    fieldLabel: 'আইডিয়া ও মুড',
    isAudioInstrumental: true,
  },
};

const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: '9:16', label: '৯:১৬ — ভার্টিকাল' },
  { value: '16:9', label: '১৬:৯ — ল্যান্ডস্কেপ' },
  { value: '1:1', label: '১:১ — স্কয়ার' },
  { value: '4:5', label: '৪:৫ — পোর্ট্রেট' },
  { value: '3:2', label: '৩:২' },
];

const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: 'draft', label: 'ড্রাফট — দ্রুত' },
  { value: 'standard', label: 'স্ট্যান্ডার্ড' },
  { value: 'high', label: 'উচ্চ — ধীর' },
];

const ENGINE_OPTIONS: { value: VideoEngine; label: string }[] = [
  { value: 'ai_diffusion', label: 'প্রকৃত AI (CogVideoX-3)' },
  { value: 'cinematic_motion', label: 'স্টোরিবোর্ড+ক্যামেরা-মোশন (দ্রুত)' },
];

interface CreateProductionResponse {
  production: ProductionSummary;
  adjustments: SpecAdjustment[];
  notes: string[];
  steps: string[];
  conversationId: string;
}

/** সার্ভারের সৎ সমন্বয়/নোট — সফল তৈরির পরে ফর্মের নিচে দেখানো হয় */
interface HonestResult {
  adjustments: SpecAdjustment[];
  notes: string[];
}

export function QuickCreateCard({ onCreated }: { onCreated: () => void }) {
  const [type, setType] = useState<QuickType>('music_video');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [durationSec, setDurationSec] = useState<number>(TYPE_META.music_video.durationSec);
  const [aspect, setAspect] = useState<AspectRatio>(TYPE_META.music_video.aspect ?? '16:9');
  const [quality, setQuality] = useState<QualityPreset>('standard');
  const [videoEngine, setVideoEngine] = useState<VideoEngine>('ai_diffusion');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<HonestResult | null>(null);

  const meta = TYPE_META[type];

  /** ধরন বদলালে ডিফল্ট দৈর্ঘ্য/অনুপাতও সেট হয় */
  const changeType = (next: QuickType) => {
    setType(next);
    setDurationSec(TYPE_META[next].durationSec);
    setAspect(TYPE_META[next].aspect ?? '16:9');
    setResult(null);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) return; // native required-ও রক্ষা করে

    const clampedDuration = Math.min(meta.max, Math.max(meta.min, durationSec || meta.durationSec));
    const spec: CreativeJobSpec =
      type === 'audio_instrumental'
        ? {
            type: 'audio',
            audioOperation: 'instrumental',
            title: trimmedTitle,
            quality,
            durationSec: clampedDuration,
            // পাইপলাইন আইডিয়া/শিরোনাম থেকেই মুড শনাক্ত করে (detectMoodFromText)
            idea: trimmedBody,
          }
        : {
            type,
            title: trimmedTitle,
            quality,
            aspect,
            durationSec: clampedDuration,
            videoEngine,
            // short_film-এ ফিল্ডের নাম story, বাকিদের idea
            ...(type === 'short_film' ? { story: trimmedBody } : { idea: trimmedBody }),
          };

    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/productions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec }), // conversationId বাদ — সার্ভার নতুন কথোপকথন বানাবে
      });
      const data = (await res.json().catch(() => ({}))) as CreateProductionResponse & {
        error?: string;
        alternatives?: string[];
      };
      if (!res.ok) {
        toast({
          title: data.error ?? 'প্রস্তাব তৈরি করা যায়নি',
          description: data.alternatives?.length
            ? `বিকল্প: ${data.alternatives.join('; ')}`
            : undefined,
          variant: 'destructive',
        });
        return;
      }

      setResult({ adjustments: data.adjustments ?? [], notes: data.notes ?? [] });
      toast({
        title: 'প্রস্তাব তৈরি হয়েছে',
        description: 'নিচের কার্ডে সেটিংস দেখে "নিশ্চিত করুন" চাপুন',
      });
      setTitle('');
      setBody('');
      onCreated();
    } catch {
      toast({ title: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="gap-4 rounded-xl py-5">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <Zap className="size-4" aria-hidden="true" />
          </span>
          ⚡ দ্রুত তৈরি
        </CardTitle>
        <CardDescription className="text-xs leading-relaxed sm:text-sm">
          চ্যাট-এজেন্ট ছাড়াই সরাসরি প্রস্তাব — রেট-লিমিটেড সময়েও কাজ চালু থাকে। প্রস্তাবটি
          নিচেই &quot;নিশ্চয়তার অপেক্ষায়&quot; কার্ড হিসেবে বসবে।
        </CardDescription>
      </CardHeader>

      <CardContent className="px-4 sm:px-6">
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {/* কাজের ধরন */}
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label htmlFor="quick-type" className="text-xs text-muted-foreground">
                কাজের ধরন
              </Label>
              <Select value={type} onValueChange={(v) => changeType(v as QuickType)}>
                <SelectTrigger id="quick-type" className="min-h-11 bg-background text-sm" aria-label="কাজের ধরন">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* শিরোনাম */}
            <div className="col-span-2 space-y-1.5 sm:col-span-2">
              <Label htmlFor="quick-title" className="text-xs text-muted-foreground">
                শিরোনাম
              </Label>
              <Input
                id="quick-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
                placeholder="যেমন: বর্ষার বিকেল"
                className="min-h-11 bg-background text-base md:text-sm"
                aria-label="শিরোনাম"
              />
            </div>

            {/* আইডিয়া / গল্প */}
            <div className="col-span-2 space-y-1.5 sm:col-span-3">
              <Label htmlFor="quick-body" className="text-xs text-muted-foreground">
                {meta.fieldLabel}
              </Label>
              <Textarea
                id="quick-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                rows={3}
                maxLength={2000}
                placeholder={
                  type === 'short_film'
                    ? 'সংক্ষিপ্ত গল্প লিখুন — দৃশ্য, চরিত্র ও সমাপ্তি…'
                    : type === 'audio_instrumental'
                      ? 'মুড ও অনুভূতি লিখুন — যেমন: বিষণ্ণ বর্ষার সন্ধ্যা, ধীর ধীর পিয়ানো…'
                      : 'সৃজনশীল ব্রিফ লিখুন — দৃশ্য, আবেগ, ভিজ্যুয়াল স্টাইল…'
                }
                className="bg-background text-base md:text-sm"
                aria-label={meta.fieldLabel}
              />
            </div>

            {/* দৈর্ঘ্য */}
            <div className="col-span-1 space-y-1.5">
              <Label htmlFor="quick-duration" className="text-xs text-muted-foreground">
                দৈর্ঘ্য (সেকেন্ড)
              </Label>
              <Input
                id="quick-duration"
                type="number"
                inputMode="numeric"
                value={durationSec}
                onChange={(e) => setDurationSec(Number(e.target.value))}
                min={meta.min}
                max={meta.max}
                step={1}
                className="min-h-11 bg-background text-base md:text-sm"
                aria-label="দৈর্ঘ্য (সেকেন্ড)"
              />
              <p className="text-[11px] leading-snug text-muted-foreground">
                সীমা: {toBnDigits(meta.min)}–{toBnDigits(meta.max)} সে.
              </p>
            </div>

            {/* আনুপাতিক মাধ্যম — ভিডিও-ধর্মী প্রকারেই (অডিওতে প্রযোজ্য নয়) */}
            {meta.aspect && (
              <div className="col-span-1 space-y-1.5">
                <Label className="text-xs text-muted-foreground">আনুপাতিক মাধ্যম</Label>
                <Select value={aspect} onValueChange={(v) => setAspect(v as AspectRatio)}>
                  <SelectTrigger className="min-h-11 bg-background text-sm" aria-label="আনুপাতিক মাধ্যম">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_OPTIONS.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* মান */}
            <div className="col-span-2 space-y-1.5 sm:col-span-1">
              <Label className="text-xs text-muted-foreground">মান</Label>
              <Select value={quality} onValueChange={(v) => setQuality(v as QualityPreset)}>
                <SelectTrigger className="min-h-11 bg-background text-sm" aria-label="মান">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_OPTIONS.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* ইঞ্জিন — ভিডিও-ধর্মী প্রকারে; ইনস্ট্রুমেন্টালে সৎ মাইক্রো-লেবেল */}
            {meta.isAudioInstrumental ? (
              <div className="col-span-2 space-y-1.5 sm:col-span-3">
                <Label className="text-xs text-muted-foreground">মিউজিক-ইঞ্জিন</Label>
                <p className="flex items-start gap-1.5 rounded-lg border border-stone-400/40 bg-stone-400/10 px-3 py-2 text-xs leading-relaxed text-stone-600 dark:text-stone-300">
                  <span className="mt-px shrink-0" aria-hidden="true">🎹</span>
                  প্রসিডিউরাল — নিউরাল মিউজিক-মডেল নয় (মুড-সচেতন স্থানীয় সংশ্লেষণ; গান গাওয়া কণ্ঠ নয়)
                </p>
              </div>
            ) : (
              <div className="col-span-2 space-y-1.5 sm:col-span-3">
                <Label className="text-xs text-muted-foreground">ইঞ্জিন</Label>
                <Select value={videoEngine} onValueChange={(v) => setVideoEngine(v as VideoEngine)}>
                  <SelectTrigger className="min-h-11 bg-background text-sm" aria-label="ইঞ্জিন">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENGINE_OPTIONS.map((en) => (
                      <SelectItem key={en.value} value={en.value}>
                        {en.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  রেট-লিমিটেড সময়ে cinematic_motion দ্রুত ও লোকাল-বান্ধব
                </p>
              </div>
            )}
          </div>

          {/* সৎ সমন্বয়/নোট — সফল তৈরির পরে (S9) */}
          {result && (result.adjustments.length > 0 || result.notes.length > 0) && (
            <div
              role="status"
              className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
            >
              {result.adjustments.length > 0 && (
                <ul className="space-y-0.5">
                  {result.adjustments.map((a, i) => (
                    <li key={`adj-${i}`}>
                      সেটিংস সমন্বয় — {a.field}: {a.from} → {a.to} ({a.reason})
                    </li>
                  ))}
                </ul>
              )}
              {result.notes.length > 0 && (
                <ul className="space-y-0.5">
                  {result.notes.map((n, i) => (
                    <li key={`note-${i}`}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="min-h-11 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Zap className="size-4" aria-hidden="true" />
              )}
              প্রস্তাব তৈরি করুন
            </Button>
            <p className="text-[11px] leading-snug text-muted-foreground">
              তৈরির পরই কার্ডে সেটিংস সম্পাদনা করে নিশ্চিত করা যাবে।
            </p>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
