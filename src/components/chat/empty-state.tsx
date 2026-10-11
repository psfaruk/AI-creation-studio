'use client';

// ============================================================
// EmptyState — নতুন চ্যাটের খালি অবস্থা (ক্রিয়েটিভ স্টুডিও)।
// হিরো + ৪টি স্টুডিও-ফিচার কার্ড + কুইক-স্টার্ট চিপ
// (চিপ চাপলে টেক্সট ড্রাফটে বসে ও কম্পোজারে ফোকাস যায়)।
// ============================================================

import {
  AudioLines,
  Clapperboard,
  ImagePlus,
  Sparkles,
  Video,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';

import { useChatStore } from '@/hooks/use-chat-store';

const FEATURES: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: ImagePlus,
    title: 'ছবি স্টুডিও',
    description: 'তৈরি ও এডিট, রং-সংশোধন, পটভূমি বদল, পোস্টার-টাইপোগ্রাফি',
  },
  {
    icon: AudioLines,
    title: 'অডিও স্টুডিও',
    description: 'ভয়েসওভার (ভাষা-যাচাইসহ), ইনস্ট্রুমেন্টাল (প্রসিডিউরাল), সম্পাদনা ও মিক্সিং',
  },
  {
    icon: Video,
    title: 'রিয়েল AI ভিডিও',
    description: 'CogVideoX-3 ডিফিউশন — লেখা বা ছবি থেকে প্রকৃত চলমান দৃশ্য',
  },
  {
    icon: Clapperboard,
    title: 'ফিল্ম ডিরেক্টর',
    description: 'শর্টফিল্ম (৮-স্তর পাইপলাইন), মিউজিক ভিডিও, ট্রেইলার — স্টোরিবোর্ড থেকে চূড়ান্ত কাট',
  },
];

// চিপের লেবেলগুলো কনটেন্ট — ইমোজি রাখা হয়েছে (নির্দেশনা অনুযায়ী)
const QUICK_STARTS = [
  '🎬 ৩০ সেকেন্ডের রোমান্টিক শর্টফিল্ম বানাও',
  '🖼️ একটা সিনেম্যাটিক পাহাড়ি ছবি বানাও',
  '🎙️ এই লেখাটা বাংলা কণ্ঠে পড়ে শোনাও: শুভ বিজয়া! নতুন বছর সুখ, সমৃদ্ধি আর সুস্থ দিন নিয়ে আসুক।',
  '✨ CogVideoX-3 দিয়ে ১০ সেকেন্ডের রিয়েল AI ভিডিও বানাও — ভোরের কুয়াশায় নদীর দৃশ্য',
  '🎵 একটা ভালোবাসার গানের কথা ও কাঠামো পরিকল্পনা করো',
  '🎞️ এই ছবিটাকে চলমান ভিডিও বানাও',
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
          অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও
        </h1>
        <p className="mt-2.5 max-w-lg text-balance text-sm leading-relaxed text-muted-foreground sm:text-base">
          বাংলায় বলুন বা লিখুন — এজেন্ট নিজে পরিকল্পনা করে টুল চালিয়ে বানিয়ে
          দেয়: ছবি তৈরি ও এডিট, ভাষা-যাচাই ভয়েসওভার, রিয়েল AI ভিডিও
          (CogVideoX-3), মিউজিক ভিডিও ও শর্টফিল্ম।
        </p>

        {/* স্টুডিও-ফিচার কার্ড */}
        <div className="mt-8 grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <Card
              key={feature.title}
              className="gap-0 rounded-xl py-4 shadow-sm"
            >
              <CardContent className="flex h-full flex-col items-center gap-2 px-3 text-center">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                  <feature.icon className="size-5" aria-hidden="true" />
                </span>
                <CardTitle className="text-sm font-medium leading-snug">
                  {feature.title}
                </CardTitle>
                <CardDescription className="text-xs leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* কুইক-স্টার্ট চিপ — চাপলে ড্রাফটে বসে */}
        <div
          className="mt-8 w-full"
          role="group"
          aria-label="দ্রুত শুরুর নমুনা — চাপলে লেখাটি ইনপুটে বসবে"
        >
          <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2">
            {QUICK_STARTS.map((text) => (
              <Button
                key={text}
                type="button"
                variant="outline"
                onClick={() => pickQuickStart(text)}
                className="h-auto min-h-11 max-w-full rounded-full px-4 py-2 text-xs font-normal leading-snug text-muted-foreground transition-colors hover:border-emerald-600/40 hover:bg-emerald-600/5 hover:text-foreground"
              >
                {text}
              </Button>
            ))}
          </div>
        </div>

        <p className="mt-6 max-w-md text-xs leading-relaxed text-muted-foreground/80">
          ছবি, অডিও বা ভিডিও আপলোড করে এডিট, ভয়েসওভার বা ছবি-থেকে-ভিডিও
          চাইতে পারেন — কম্পোজারের অ্যাটাচ বোতামে ফাইল যোগ করুন।
        </p>
      </div>
    </div>
  );
}
