// ============================================================
// সার্ভার-সাইড রেট-লিমিটিং (in-memory) — API রুটে ব্যবহারের জন্য।
// - checkRateLimit: স্লাইডিং-উইন্ডো লিমিট (Map<key, number[]>)
// - checkDailyProductionQuota: দৈনিক প্রোডাকশন কোটা (এশিয়া/ঢাকা দিন)
// globalThis-ক্যাশ করা (events.ts-এর মতো) — HMR-এ নতুন module
// instance হলেও জমা অবস্থা টিকে থাকে।
// ============================================================

import { db } from '@/lib/db';

/** রেট-লিমিট ফলাফল */
export interface RateLimitResult {
  allowed: boolean;
  /** পরবর্তী সুযোগ পেতে কত সেকেন্ড অপেক্ষা করতে হবে */
  retryAfterSec?: number;
}

/** দৈনিক কোটার ফলাফল */
export interface DailyQuotaResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * সুবিধাজনক প্রিসেট — মূল এজেন্ট API রুটে যুক্ত করবে:
 *  - chat: প্রতি মিনিটে ১৫টি চ্যাট-বার্তা
 *  - confirm: প্রতি ঘণ্টায় ১২টি প্রোডাকশন নিশ্চয়তা
 */
export const RATE_LIMITS = {
  chat: { limit: 15, windowMs: 60_000 },
  confirm: { limit: 12, windowMs: 60 * 60_000 },
  systemCheck: { limit: 4, windowMs: 10 * 60_000 },
} as const;

// HMR-নিরাপদ গ্লোবাল ক্যাশ: key → উইন্ডোর ভেতরের টাইমস্ট্যাম্পগুলো
const g = globalThis as unknown as {
  __rateLimitWindows?: Map<string, number[]>;
};
const windows: Map<string, number[]> = (g.__rateLimitWindows ??= new Map());

/**
 * স্লাইডিং-উইন্ডো রেট-লিমিট যাচাই (in-memory)।
 *
 * প্রতিটি key-এর জন্য শেষ `windowMs` মিলিসেকেন্ডের টাইমস্ট্যাম্প তালিকা রাখা
 * হয়; উইন্ডোর বাইরের পুরনো এন্ট্রি বাদ দিয়ে (prune) গণনা করা হয়।
 * সীমার নিচে হলে বর্তমান সময় যোগ করে allowed, নাহলে প্রাচীনতম
 * টাইমস্ট্যাম্প থেকে retryAfterSec হিসাব করে denied।
 *
 * @param key অনন্য শনাক্তকারী (যেমন: `chat:{ip}` বা `confirm:{ip}`)
 * @param limit উইন্ডোতে সর্বোচ্চ কতবার অনুমোদিত
 * @param windowMs উইন্ডোর দৈর্ঘ্য মিলিসেকেন্ডে
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const list = windows.get(key) ?? [];

  // উইন্ডোর বাইরের পুরনো টাইমস্ট্যাম্প বাদ দাও
  const pruned = list.filter(ts => now - ts < windowMs);

  if (pruned.length >= limit) {
    // সীমা অতিক্রম — প্রাচীনতম এন্ট্রি মুক্ত হওয়া পর্যন্ত অপেক্ষা
    const oldest = pruned[0];
    windows.set(key, pruned);
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  pruned.push(now);
  windows.set(key, pruned);
  return { allowed: true };
}

/** এশিয়া/ঢাকা (UTC+06:00) অনুযায়ী "আজকের" দিন শুরুর UTC টাইমস্ট্যাম্প */
function dhakaDayStartMs(now: Date): number {
  // ঢাকা-সময়ে প্রক্ষেপিত তারিখ নাও, সেই দিনের ০০:০০ (UTC ঘড়িতে) বসাও,
  // তারপর ৬ ঘণ্টা পিছিয়ে আসল UTC মুহূর্তে ফিরে যাও।
  const shifted = new Date(now.getTime() + 6 * 3600_000);
  const dayStartShifted = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  return dayStartShifted - 6 * 3600_000;
}

/**
 * দৈনিক প্রোডাকশন কোটা যাচাই — আজকের (এশিয়া/ঢাকা) তারিখে কতটি
 * Production তৈরি হয়েছে তা গণনা করে।
 *
 * @param limit দিনে সর্বোচ্চ কতটি প্রোডাকশন অনুমোদিত (ডিফল্ট ৪০)
 */
export async function checkDailyProductionQuota(limit = 40): Promise<DailyQuotaResult> {
  const startOfToday = new Date(dhakaDayStartMs(new Date()));
  const used = await db.production.count({
    where: { createdAt: { gte: startOfToday } },
  });
  return { allowed: used < limit, used, limit };
}
