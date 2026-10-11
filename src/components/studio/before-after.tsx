'use client';

// ============================================================
// BeforeAfter — আগে/পরে তুলনা-স্লাইডার (Image Studio)।
// পরের ছবি পুরো দেখায়, আগের ছবি বাম দিক থেকে pos% পর্যন্ত ক্লিপড।
// পুরো এলাকা জুড়ে অদৃশ্য range ইনপুট — ড্র্যাগ, ক্লিক ও কিবোর্ডের জন্য
// (৪৪px+ টাচ-টার্গেট হ্যান্ডেল, কোনো বাহ্যিক নির্ভরতা নেই)।
// ============================================================

import { useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BeforeAfter({
  beforeUrl,
  afterUrl,
  alt,
}: {
  beforeUrl: string;
  afterUrl: string;
  alt: string;
}) {
  const [pos, setPos] = useState(50);

  return (
    <div
      className={cn(
        'relative w-full overflow-hidden rounded-xl border bg-muted select-none',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-emerald-500 has-[:focus-visible]:ring-offset-2'
      )}
    >
      {/* পরের ছবি — সম্পূর্ণ (লেআউট নির্ধারণ করে) */}
      <img
        src={afterUrl}
        alt={`${alt} — পরে`}
        draggable={false}
        className="pointer-events-none block w-full select-none"
      />
      {/* আগের ছবি — বাম দিক থেকে pos% পর্যন্ত ক্লিপড */}
      <img
        src={beforeUrl}
        alt={`${alt} — আগে`}
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />
      {/* বিভাজক রেখা + ৪৪px টাচ-টার্গেট হ্যান্ডেল */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.6)]"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-black/60 text-white backdrop-blur-sm">
          <ChevronsLeftRight className="h-5 w-5" />
        </span>
      </div>
      {/* কোণার লেবেল */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white"
      >
        আগে
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2 right-2 rounded-md bg-black/55 px-2 py-0.5 text-xs font-medium text-white"
      >
        পরে
      </span>
      {/* অদৃশ্য range ইনপুট — ড্র্যাগ/ক্লিক/কিবোর্ড নিয়ন্ত্রণ */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={pos}
        onChange={e => setPos(Number(e.target.value))}
        aria-label="আগে ও পরে তুলনা"
        className="absolute inset-0 h-full w-full cursor-ew-resize touch-none opacity-0"
      />
    </div>
  );
}
