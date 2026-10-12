'use client';

// ============================================================
// RateLimitBanner (S9) — সৎ রেট-লিমিট ব্যানার।
// GET /api/system থেকে প্রতি ৩০ সেকেন্ডে হালকা পোলিং করে
// rateLimits.anyBlocked সত্য হলেই চ্যাট-কলামের কম্পোজারের
// উপরে সরু অ্যাম্বার ব্যানার দেখায়। ব্লকড না থাকলে কিছুই রেন্ডার
// হয় না (DOM-ও হালকা থাকে)।
//
// সততা: ৪২৯ সাময়িক — লাইসেন্স/অনুমতির সমস্যা কখনোই নয়।
// চ্যাট-এজেন্ট কোঅর্ডিনেটেড-ব্যাকঅফে অপেক্ষা করে, আর স্টুডিওর
// "দ্রুত তৈরি" ফর্ম LLM ছাড়াই কাজ চালু রাখে।
// ============================================================

import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';

import { toBnDigits } from '@/components/chat/bn-format';
import type { RateLimitChannelStatus, SystemInfo } from '@/hooks/use-system';

const POLL_INTERVAL_MS = 30_000;

/** চ্যানেল-কী → বাংলা লেবেল (rate-limit-coordinator-এর চ্যানেলগুলো) */
const CHANNEL_LABELS: Record<string, string> = {
  chat: 'চ্যাট',
  image: 'ছবি',
  tts: 'কণ্ঠ',
  asr: 'এএসআর',
  video: 'ভিডিও',
  search: 'সার্চ',
};

/**
 * চ্যাট-কলামের রেট-লিমিট ব্যানার। শুধু চ্যাট ভিউতে মাউন্ট থাকে,
 * তাই পোলিং-ও তখনই চলে (আনমাউন্টে ব্যর্ত/অ্যাবর্ট)।
 */
export function RateLimitBanner() {
  // null = এখনো জানা নেই; [] = কোনো চ্যানেল ব্লকড নয়
  const [blockedChannels, setBlockedChannels] = useState<RateLimitChannelStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false; // স্বাস্থ্য-চেক রেট-লিমিটে আটকে থাকলে অনুরোধ জমতে দিও না
    const controller = new AbortController();

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch('/api/system', { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as SystemInfo;
        if (cancelled) return;
        const rl = data.rateLimits;
        setBlockedChannels(rl?.anyBlocked ? rl.channels.filter((c) => c.blocked) : []);
      } catch {
        // নীরব — পরের টিকে আবার চেষ্টা হবে (অ্যাবর্ট-এররও এখানেই থামে)
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  if (!blockedChannels || blockedChannels.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 border-b border-amber-500/30 bg-amber-500/10"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3 sm:px-6">
        <p className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <CloudOff className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>
            ক্লাউড API রেট-লিমিটেড (৪২৯) — সাময়িক; লাইসেন্স-সমস্যা নয়। চ্যাট-এজেন্ট অপেক্ষা করবে;
            স্টুডিও থেকে সরাসরি তৈরি করা যাবে।
          </span>
        </p>
        <ul className="flex shrink-0 flex-wrap gap-1" aria-label="ব্লকড চ্যানেল ও অবশিষ্ট সময়">
          {blockedChannels.map((c) => (
            <li
              key={c.channel}
              className="whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
              title={`টানা ${toBnDigits(c.consecutive429)}টি ৪২৯ · মোট ${toBnDigits(c.total429)}টি`}
            >
              {CHANNEL_LABELS[c.channel] ?? c.channel} {toBnDigits(c.blockedRemainingSec)} সে.
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
