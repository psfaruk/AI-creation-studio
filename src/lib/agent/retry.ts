// ============================================================
// retry.ts — §১০-র ৪২৯/৫xx-সহনশীল পুনঃচেষ্টা-নীতির বিশুদ্ধ মূল।
//
// sdk-helpers.ts থেকে আলাদা করা হয়েছে যাতে llm.ts-ও একই নীতি
// ব্যবহার করতে পারে import-cycle ছাড়া (sdk-helpers → llm একমুখী)।
// sdk-helpers.ts এগুলো re-export করে — পুরনো সব ইমপোর্টার অক্ষত।
//
// নীতি (§১০):
//  - Retry-After থাকলে সেটিই মানের ভিত্তি (সেকেন্ড বা HTTP-date)
//  - না থাকলে full-jitter এক্সপোনেনশিয়াল ব্যাকঅফ
//  - ৪২৯/রেট-লিমিটে পুনঃচেষ্টা শেষ হলে TemporarilyUnavailableError —
//    ৪২৯ কখনোই লাইসেন্স/অনুমতির সমস্যা নয়, "সাময়িকভাবে অনুপলব্ধ"
// ============================================================

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
  return /429|rate.?limit|too many/i.test(msg);
}

/** পুনঃচেষ্টা-যোগ্য (৪২৯/রেট-লিমিট/৫xx/টাইমআউট) কি না */
function isRetryableErrorText(msg: string): boolean {
  return /429|rate.?limit|too many|\b5\d{2}\b|timeout/i.test(msg);
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

/**
 * ৪২৯/৫xx হলে ব্যাকঅফ-সহ পুনঃচেষ্টা — TTS/ASR/LLM/ছবি-সার্চ সবখানে ব্যবহৃত।
 * ৪২৯-নিঃশেষে TemporarilyUnavailableError (লাইসেন্স-সমস্যা নয়),
 * ৫xx/টাইমআউট-নিঃশেষে সাধারণ সৎ-ব্যর্থতা।
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  attempts = 4,
  baseMs = 4000,
  opts?: { maxDelayMs?: number }
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(attempts));
  const maxDelayMs = opts?.maxDelayMs ?? 90_000;
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      if (i === maxAttempts - 1) break;
      if (!isRetryableErrorText(msg)) throw err;
      // §১০: Retry-After থাকলে সেটিই (৯০ সে.-ছাদে সীমিত), নয়তো full-jitter
      const ra = parseRetryAfterMs(err);
      const delayMs =
        ra != null
          ? Math.max(0, Math.min(maxDelayMs, ra))
          : fullJitterDelayMs(baseMs, i, maxDelayMs);
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
