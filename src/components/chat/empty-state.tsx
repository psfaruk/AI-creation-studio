'use client';

import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useChatStore } from '@/hooks/use-chat-store';

const FEATURES = [
  '🧠 পরিকল্পনা করে কাজ করে',
  '🛠️ ৮টি টুল বাস্তবে চালায়',
  '📦 আউটপুট সরাসরি চ্যাটে',
] as const;

const QUICK_STARTS = [
  'একটি সুন্দর পাহাড়ি দৃশ্যের ছবি বানাও',
  'বাংলাদেশের প্রযুক্তি খাতের সর্বশেষ খবর খুঁজে আনো',
  'ছোট একটি শুভেচ্ছা বার্তা লিখে তার অডিও বানাও',
  'AI নিয়ে সর্বশেষ ৩টি খবর খুঁজে সারসংক্ষেপ দাও',
] as const;

/** নতুন চ্যাটের খালি অবস্থা — হিরো + ফিচার কার্ড + কুইক-স্টার্ট চিপ */
export function EmptyState() {
  const setDraft = useChatStore((s) => s.setDraft);
  const focusComposer = useChatStore((s) => s.focusComposer);

  const pickQuickStart = (text: string) => {
    setDraft(text);
    focusComposer();
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-10 text-center">
        <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
          <Sparkles className="size-7" aria-hidden="true" />
        </span>

        <h1 className="max-w-xl text-balance text-xl font-semibold leading-snug sm:text-2xl">
          কী করতে চান, বলুন — বাকিটা এজেন্ট সামলে নেবে
        </h1>
        <p className="mt-2.5 max-w-lg text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
          প্ল্যান করে টুল চালিয়ে ছবি, অডিও, তথ্য — সবকিছু বাস্তবে তৈরি করে দেখাবে
        </p>

        <div className="mt-8 grid w-full gap-3 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature}
              className="rounded-xl border bg-card px-4 py-3.5 text-sm shadow-sm"
            >
              {feature}
            </div>
          ))}
        </div>

        <div className="mt-7 flex max-w-2xl flex-wrap justify-center gap-2">
          {QUICK_STARTS.map((text) => (
            <Button
              key={text}
              type="button"
              variant="outline"
              onClick={() => pickQuickStart(text)}
              className="h-11 max-w-full rounded-full px-4 text-xs font-normal text-muted-foreground transition-colors hover:border-emerald-600/40 hover:bg-emerald-600/5 hover:text-foreground"
            >
              {text}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
