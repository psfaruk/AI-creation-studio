// ============================================================
// retry.ts — §১০-র ৪২৯/৫xx-সহনশীল পুনঃচেষ্টা-নীতির বিশুদ্ধ মূল।
//
// S9-গভীর-সমাধান: rate-limit-coordinator-এর সঙ্গী হয়েছে —
//  - চ্যানেল (chat/image/tts/…) দিলে: প্রতিটি চেষ্টার আগে
//    চ্যানেল-কুলডাউন শেষ পর্যন্ত সৎ-অপেক্ষা
//  - একই চ্যানেলে কলগুলো সিরিয়ালাইজড (সমান্তরাল ৪২৯-ঝড় নয়)
//  - ৪২৯-এ coordinator-কে জানানো হয় (অভিযোজিত কুলডাউন)
//  - onWait-কলব্যাক দিলে UI/রান অপেক্ষা-নোট দেখাতে পারে
//
// পুরনো নীতি (S8-3) অপরিবর্তিত:
//  - Retry-After থাকলে সেটিই মানের ভিত্তি (সেকেন্ড বা HTTP-date)
//  - না থাকলে full-jitter এক্সপোনেনশিয়াল ব্যাকঅফ
//  - ৪২৯/রেট-লিমিটে পুনঃচেষ্টা শেষ হলে TemporarilyUnavailableError —
//    ৪২৯ কখনোই লাইসেন্স/অনুমতির সমস্যা নয়, "সাময়িকভাবে অনুপলব্ধ"
// ============================================================

import {
  noteRateLimit,
  noteSuccess,
  runSerialized,
  waitForChannel,
  type RateLimitChannel,
} from './rate-limit-coordinator';

/**
 * সাময়িক অনুপলব্ধতা (রেট-লিমিট/৪২৯-নিঃশেষ)। বার্তার শুরুতেই
 * `TEMPORARILY_UNAVAILABLE:` — কলার/UI এটি দেখে লাইসেন্স-সমস্যার
 * বদলে "সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট)" দেখায়।
 */
export class TemporarilyUnavailableError extends Error {
  constructor(message: string) {
    super(`TEMPORARILY_UNAVAILABLE: ${message}`);
    this.name = 'TemporarilyUnavailableError';
  }
}

/** বার্তাটি রেট-লিমিট/৪২৯ কি না (লাইসেন্স-সমস্যা কখনোই নয়) */
export function isRateLimitErrorText(msg: string): boolean {
  return /429|rate.?limit|too many|TEMPORARILY_UNAVAILABLE/i.test(msg);
}

/** পুনঃচেষ্টা-যোগ্য (৪২৯/রেট-লিমিট/৫xx/টাইমআউট) কি না */
function isRetryableErrorText(msg: string): boolean {
  return /429|rate.?limit|too many|\b5\d{2}\b|timeout|TEMPORARILY_UNAVAILABLE/i.test(msg);
}

/** একক-মান থেকে মিলিসেকেন্ড ("30" / "30s" / 30 / HTTP-date) — না বুঝলে null */
function coerceRetryAfterMs(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    // ≤১০০০ হলে সেকেন্ড-অনুমান, নয়তো মিলিসেকেন্ড
    return raw <= 1000 ? Math.round(raw * 1000) : Math.round(raw);
  }
  const s = String(raw).trim();
  if (!s) return null;
  const withUnit = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?)$/i);
  if (withUnit) {
    const v = Number(withUnit[1]);
    return /^ms$/i.test(withUnit[2]) ? Math.round(v) : Math.round(v * 1000);
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const sec = Number(s);
    return sec <= 1000 ? Math.round(sec * 1000) : Math.round(sec);
  }
  const asDate = Date.parse(s); // HTTP-date (যেমন: Fri, 11 Oct 2026 18:00:00 GMT)
  if (!Number.isNaN(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
}

/**
 * §১০: ত্রুটি-বস্তু থেকে Retry-After বের করা। ক্রমানুসারে দেখা হয়:
 * err.retryAfter / err.retry_after → err.headers['retry-after'] (বা Headers.get)
 * → বার্তা-টেক্সটে "Retry-After: …"। মান সেকেন্ড বা HTTP-date হতে পারে।
 */
export function parseRetryAfterMs(err: unknown): number | null {
  const e = err as any;
  const fromProp = coerceRetryAfterMs(e?.retryAfter ?? e?.retry_after);
  if (fromProp != null) return fromProp;
  const h = e?.headers;
  const headerRaw =
    typeof h?.get === 'function' ? h.get('retry-after') : (h?.['retry-after'] ?? h?.['Retry-After']);
  const fromHeader = coerceRetryAfterMs(headerRaw);
  if (fromHeader != null) return fromHeader;
  const msg = String(e?.message ?? e ?? '');
  const m = msg.match(/retry[- ]after\s*[:=]?\s*([^\n;]{1,40})/i);
  if (m) return coerceRetryAfterMs(m[1]);
  return null;
}

/**
 * Full-jitter এক্সপোনেনশিয়াল ব্যাকঅফ (§১০):
 * delay = random(baseMs/2, min(maxDelayMs, baseMs * 2^attempt))
 */
export function fullJitterDelayMs(baseMs: number, attempt: number, maxDelayMs: number): number {
  const ceiling = Math.max(1, Math.min(maxDelayMs, baseMs * Math.pow(2, attempt)));
  const floor = Math.min(baseMs / 2, ceiling);
  return Math.round(floor + Math.random() * (ceiling - floor));
}

export interface RetryWaitInfo {
  /** এটি কোন চেষ্টা (১-ভিত্তিক) */
  attempt: number;
  /** এই চেষ্টার আগে কত মি.সে. অপেক্ষা করা হবে */
  delayMs: number;
  /** চ্যানেল-কুলডাউনের কারণে অপেক্ষা কি না */
  fromCooldown: boolean;
  channel: RateLimitChannel | null;
  /** চ্যানেল আর কত মি.সে. ব্লকড ছিল (fromCooldown হলে) */
  blockedMs: number;
}

export interface RetryOptions {
  maxDelayMs?: number;
  /** রেট-লিমিট-চ্যানেল — দিলে কুলডাউন-সচেতন + সিরিয়ালাইজড হয় */
  channel?: RateLimitChannel;
  /** প্রতিটি অপেক্ষার আগে ডাকা হয় (UI-নোটের জন্য) */
  onWait?: (info: RetryWaitInfo) => void;
  /** এই কলের মোট অপেক্ষা-বাজেট (কুলডাউন+ব্যাকঅফ মিলে; ডিফল্ট ৫ মিনিট)।
   *  S10: আগে প্রতি attempt নতুন বাজেট হিসেব হতো — এখন সব attempt মিলে একটিই বাজেট */
  cooldownBudgetMs?: number;
}

/**
 * ৪২৯/৫xx হলে ব্যাকঅফ-সহ পুনঃচেষ্টা — TTS/ASR/LLM/ছবি-সার্চ/ভিডিও সবখানে ব্যবহৃত।
 * channel দিলে: কুলডাউন-শেষ পর্যন্ত সৎ-অপেক্ষা + একই চ্যানেলে কল সিরিয়ালাইজড।
 * ৪২৯-নিঃশেষে TemporarilyUnavailableError (লাইসেন্স-সমস্যা নয়),
 * ৫xx/টাইমআউট-নিঃশেষে সাধারণ সৎ-ব্যর্থতা।
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 4,
  baseMs = 4000,
  opts?: RetryOptions
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(attempts));
  const maxDelayMs = opts?.maxDelayMs ?? 90_000;
  const channel = opts?.channel;
  // S10-গভীর-সমাধান: বাজেট এখন এই কলের সম্পূর্ণ মোট অপেক্ষা-সীমা
  // (কুলডাউন-অপেক্ষা + ব্যাকঅফ-অপেক্ষা মিলে)। আগে প্রতি attempt নতুন
  // বাজেট পেত — ৫ চেষ্টায় ~৩০ মিনিট পর্যন্ত ঝুলে থাকত (৪২৯-উইন্ডোতে
  // বাস্তবে ঘটেছিল: শর্ট-ফিল্মের speech-ধাপ ~১০.৫ মিনিট TTS-অপেক্ষায়)।
  let waitBudgetMs = opts?.cooldownBudgetMs ?? 5 * 60_000;
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    // (ক) চ্যানেল-কুলডাউন চলছে কি না — বাকি বাজেটের মধ্যে মুক্ত না
    //     হলে নিষ্ফল চেষ্টা বাদ — সরাসরি সৎ-ব্যর্থতা
    if (channel) {
      if (waitBudgetMs <= 0) {
        throw new TemporarilyUnavailableError(
          `${label} — ${channel}-চ্যানেল রেট-লিমিট-অপেক্ষার মোট বাজেট শেষ`
        );
      }
      const waited = await waitForChannel(channel, waitBudgetMs);
      if (waited === -1) {
        const finalMsg = `${channel}-চ্যানেল রেট-লিমিট-কুলডাউনে বাধা অতিক্রম করছে না`;
        throw new TemporarilyUnavailableError(`${label} — ${finalMsg}`);
      }
      waitBudgetMs -= waited;
      if (waited > 0) {
        opts?.onWait?.({
          attempt: i + 1,
          delayMs: waited,
          fromCooldown: true,
          channel,
          blockedMs: waited,
        });
      }
    }
    // (খ) চ্যানেল-সিরিয়ালাইজেশন — এক চ্যানেলে একাধিক সমান্তরাল কল নয়
    const exec = channel ? () => runSerialized(channel, fn) : fn;
    try {
      const result = await exec();
      if (channel) noteSuccess(channel);
      return result;
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      if (i === maxAttempts - 1) break;
      if (!isRetryableErrorText(msg)) throw err;
      // (গ) ৪২৯/রেট-লিমিট হলে coordinator-কে জানাও (অভিযোজিত কুলডাউন)
      const isRateLimit = isRateLimitErrorText(msg);
      const ra = parseRetryAfterMs(err);
      if (isRateLimit && channel) noteRateLimit(channel, ra);
      // §১০: Retry-After থাকলে সেটিই (সীমা-ছদে), নয়তো full-jitter
      const delayMs =
        ra != null && isRateLimit
          ? Math.max(0, Math.min(maxDelayMs, ra))
          : fullJitterDelayMs(baseMs, i, maxDelayMs);
      // S10: পরের অপেক্ষা বাকি বাজেট ছাড়িয়ে গেলে ঘুরপাক নয় —
      // এখনই সৎ-ব্যর্থতা (মোট-বাজেট শব্দার্থের দ্বিতীয়ার্ধ)
      if (channel && delayMs >= waitBudgetMs) {
        throw new TemporarilyUnavailableError(
          `${label} — পুনঃচেষ্টার অপেক্ষা-বাজেট (${Math.round(waitBudgetMs / 1000)} সে.) শেষ — সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট)`
        );
      }
      if (channel) waitBudgetMs -= delayMs;
      opts?.onWait?.({
        attempt: i + 1,
        delayMs,
        fromCooldown: false,
        channel: channel ?? null,
        blockedMs: 0,
      });
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  const finalMsg = String((lastErr as any)?.message ?? lastErr).slice(0, 200);
  if (isRateLimitErrorText(finalMsg)) {
    throw new TemporarilyUnavailableError(
      `${label} — সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট): ${finalMsg}`
    );
  }
  throw new Error(`${label} — সব পুনঃচেষ্টা ব্যর্থ: ${finalMsg}`);
}
