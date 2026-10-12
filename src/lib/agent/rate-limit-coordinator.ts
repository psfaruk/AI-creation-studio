// ============================================================
// Rate-Limit Coordinator — §১০/§১১-র গভীর সমাধান (S9)।
//
// সমস্যা (২০২৬-১০-১১-এর বাস্তব ঘটনা থেকে): স্যান্ডবক্স-জুড়ে
// ৪২৯-উইন্ডো মিনিটের পর মিনিট সক্রিয় থাকে, কিন্তু আগের
// withRetry-বাজেট ছিল ~১৬ সেকেন্ড — ফলে এজেন্ট-রান ধাপ ০-তেই
// "TEMPORARILY_UNAVAILABLE" হয়ে মরে যেত, আর মিউজিক-ভিডিও/ফিল্ম
// তৈরিই শুরু হতো না।
//
// সমাধান — তিনটি স্তর:
//  ১. চ্যানেল-ভিত্তিক অভিযোজিত কুলডাউন (chat/image/tts/asr/video/search):
//     প্রতি পরপর-429-এ কুলডাউন দ্বিগুণ (২০→৪০→৮০→১৬০→৩০০ সে. সীমা)।
//     সফল কলে স্কেলার রিসেট। Retry-After থাকলে সেটি অগ্রাধিকার।
//  ২. চ্যানেল-ভিত্তিক সিরিয়ালাইজেশন: একই চ্যানেলে একাধিক সমান্তরাল
//     অনুরোধ ঢালাও না — একটাই চলে, বাকিরা সারিতে থাকে। সমান্তরাল
//     রান/প্রোডাকশন একসাথে ৪২৯-ঝড় তৈরি করত না।
//  ৩. সব অপেক্ষার আগে কুলডাউন-শেষ পর্যন্ত অপেক্ষা (withRetry-এর
//     সঙ্গী) — ব্যর্থ নয়, সৎ-অপেক্ষা।
//
// সততা: ৪২৯ কখনোই লাইসেন্স/অনুমতির সমস্যা নয় — "সাময়িকভাবে
// অনুপলব্ধ"। এই কোঅর্ডিনেটর সেটিই নিশ্চিত করে: অপেক্ষা করা হয়,
// রান ব্যর্থ হয় না যতক্ষণ বাজেট আছে।
// ============================================================

export type RateLimitChannel = 'chat' | 'image' | 'tts' | 'asr' | 'video' | 'search';

/** অভিযোজিত স্কেলার (সেকেন্ডে) — পরপর 429-এ দ্বিগুণ, সর্বোচ্চ ১২০ সে. (দ্রুত রিকভারি-শনাক্তকরণের সাথে ভারসাম্য) */
const ESCALATION_SEC = [15, 30, 60, 120];
/** একক 429-এও ন্যূনতম এতটা কুলডাউন */
const MIN_COOLDOWN_MS = 8_000;
/** Retry-After-নির্দেশিত অপেক্ষার সর্বোচ্চ সীমা */
const MAX_RETRY_AFTER_MS = 5 * 60_000;

interface ChannelState {
  blockedUntil: number;
  consecutive429: number;
  last429At: number | null;
  lastSuccessAt: number | null;
  total429: number;
  /** চলমান সিরিয়ালাইজড-কলের সংখ্যা (পর্যবেক্ষণ-সংখ্যা) */
  inFlight: number;
  /** সিরিয়ালাইজেশন-চেইন: পরের কল এই promise শেষ হওয়ার পরেই চলবে */
  tail: Promise<unknown>;
}

const g = globalThis as unknown as {
  __rateLimitCoordinator?: Map<string, ChannelState>;
};

function states(): Map<string, ChannelState> {
  if (!g.__rateLimitCoordinator) g.__rateLimitCoordinator = new Map();
  return g.__rateLimitCoordinator;
}

function stateOf(channel: string): ChannelState {
  const map = states();
  let s = map.get(channel);
  if (!s) {
    s = {
      blockedUntil: 0,
      consecutive429: 0,
      last429At: null,
      lastSuccessAt: null,
      total429: 0,
      inFlight: 0,
      tail: Promise.resolve(),
    };
    map.set(channel, s);
  }
  return s;
}

// ------------------------------------------------------------
// ১) অভিযোজিত কুলডাউন
// ------------------------------------------------------------

/**
 * ৪২৯/রেট-লিমিট দেখা গেছে — চ্যানেলের কুলডাউন বাড়াও।
 * `retryAfterMs` (HTTP Retry-After) থাকলে সেটি স্কেলারের চেয়ে
 * বড় হলে সেটিই নেওয়া হয়।
 */
export function noteRateLimit(channel: RateLimitChannel, retryAfterMs?: number | null): void {
  const s = stateOf(channel);
  const idx = Math.min(s.consecutive429, ESCALATION_SEC.length - 1);
  const ladderMs = ESCALATION_SEC[idx] * 1000;
  const fromHeader =
    retryAfterMs != null && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.min(MAX_RETRY_AFTER_MS, retryAfterMs)
      : 0;
  const cooldownMs = Math.max(MIN_COOLDOWN_MS, fromHeader > 0 ? fromHeader : ladderMs);
  const now = Date.now();
  // ইতিমধ্যে-নির্ধারিত কুলডাউনের চেয়ে ছোট হলে কমানো হয় না
  const blockedUntil = Math.max(s.blockedUntil, now + cooldownMs);
  s.blockedUntil = blockedUntil;
  s.consecutive429 = Math.min(s.consecutive429 + 1, 99);
  s.last429At = now;
  s.total429++;
}

/** সফল কল — স্কেলার রিসেট, কুলডাউন তুলে দাও */
export function noteSuccess(channel: RateLimitChannel): void {
  const s = stateOf(channel);
  s.consecutive429 = 0;
  s.blockedUntil = 0;
  s.lastSuccessAt = Date.now();
}

/** চ্যানেল এখন কত মি.সে. ব্লকড (0 = মুক্ত) */
export function channelBlockedMs(channel: RateLimitChannel): number {
  const s = stateOf(channel);
  return Math.max(0, s.blockedUntil - Date.now());
}

/** চ্যানেল ব্লকড কি না */
export function isChannelBlocked(channel: RateLimitChannel): boolean {
  return channelBlockedMs(channel) > 0;
}

/**
 * চ্যানেল এখন দীর্ঘ কুলডাউনে কি না (গভীর-সমাধানের দ্রুত-গেট)।
 * সত্য হলে কলারকে ক্লাউড-চেষ্টা বাদ দিয়ে সরাসরি লোকাল-ফলব্যাকে
 * যাওয়া উচিত — প্রতি শটে/ধাপে মিনিটের রিট্রাই-অপেক্ষা নয়।
 * (৪২৯-উইন্ডোর বাস্তব প্রেক্ষাপট: কুলডাউন >৬০ সে. মানে জানালা এখনো
 * দীর্ঘ — সৎ-লেবেলসহ লোকাল পথই ব্যবহারকারীর জন্য দ্রুততম।)
 */
export function cloudSkipAdvised(channel: RateLimitChannel, minRemainingMs = 60_000): boolean {
  return channelBlockedMs(channel) > minRemainingMs;
}

/**
 * চ্যানেল মুক্ত হওয়া পর্যন্ত অপেক্ষা (সৎ-অপেক্ষা, ব্যর্থতা নয়)।
 * @returns প্রকৃত অপেক্ষার মি.সে. (0 = অপেক্ষার দরকার ছিল না);
 *          -1 = বাজেট শেষ হলেও এখনো ব্লকড (কলার নিষ্ফল চেষ্টা বাদ দিতে পারে)
 */
export async function waitForChannel(
  channel: RateLimitChannel,
  maxWaitMs = 5 * 60_000
): Promise<number> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const blocked = channelBlockedMs(channel);
    if (blocked <= 0) return 0;
    if (Date.now() >= deadline) return -1; // এখনো ব্লকড — সৎ-ব্যর্থতার সংকেত
    const sleepMs = Math.min(blocked + 250, Math.max(250, deadline - Date.now()));
    await new Promise(r => setTimeout(r, sleepMs));
  }
}

// ------------------------------------------------------------
// ২) চ্যানেল-সিরিয়ালাইজেশন — এক চ্যানেলে একাধিক সমান্তরাল
// কল নয় (৪২৯-ঝড় প্রতিরোধ)। কল-বডি নয়, শুধু "টানেল" সিরিয়ালাইজ হয়।
// ------------------------------------------------------------

/**
 * চ্যানেলের সিরিয়াল-টানেলে ঢুকে `fn` চালাও। একই চ্যানেলের আগের
 * কল শেষ হওয়ার আগে এটি শুরু হয় না। fn-এর ফল/ত্রুটি অপরিবর্তিত
 * ফেরে।
 */
export async function runSerialized<T>(channel: RateLimitChannel, fn: () => Promise<T>): Promise<T> {
  const s = stateOf(channel);
  // নিজের পালা: আগের tail শেষ হওয়া — ত্রুটিতেও চেইন ভাঙবে না
  const myTurn = s.tail.then(() => undefined, () => undefined);
  const run = (async () => {
    await myTurn;
    s.inFlight++;
    try {
      return await fn();
    } finally {
      s.inFlight--;
    }
  })();
  // চেইন আপডেট — run-এর ফল যা-ই হোক, পরের কল আটকাবে না
  s.tail = run.then(() => undefined, () => undefined);
  return run;
}

// ------------------------------------------------------------
// ৩) পরিসংখ্যান — /api/system ও UI-র সৎ-স্ট্যাটাসের জন্য
// ------------------------------------------------------------

export interface ChannelStatus {
  channel: RateLimitChannel | string;
  blocked: boolean;
  blockedRemainingSec: number;
  consecutive429: number;
  total429: number;
  last429AgoSec: number | null;
  inFlight: number;
}

export interface CoordinatorStatus {
  /** এখন অন্তত একটি চ্যানেল ব্লকড কি না */
  anyBlocked: boolean;
  channels: ChannelStatus[];
}

export function coordinatorStatus(): CoordinatorStatus {
  const now = Date.now();
  const channels: ChannelStatus[] = [];
  for (const [channel, s] of states()) {
    const remaining = Math.max(0, s.blockedUntil - now);
    channels.push({
      channel,
      blocked: remaining > 0,
      blockedRemainingSec: Math.ceil(remaining / 1000),
      consecutive429: s.consecutive429,
      total429: s.total429,
      last429AgoSec: s.last429At ? Math.round((now - s.last429At) / 1000) : null,
      inFlight: s.inFlight,
    });
  }
  return { anyBlocked: channels.some(c => c.blocked), channels };
}
