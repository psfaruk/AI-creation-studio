// ============================================================
// Run/Production metrics — Phase-1 minimal structured
// observability (no new dependency; one JSON console line per
// run/production end, correlated by runId/productionId).
//
// Principles:
//  - REDACTION: only ids, enums, counts, durations, model names
//    and tool names. NEVER user content, raw error text (category
//    only), keys, tokens or URLs.
//  - HONESTY: unmeasured fields are logged as null — never
//    fabricated.
//  - LOW VOLUME: exactly one line per run end (finalize/fail) and
//    one per production end (finish/fail). Tool-level logging is
//    unchanged (logStep).
//  - HMR-SAFE: accumulator state lives on globalThis (events.ts
//    pattern) so dev-mode module reloads keep counters.
// ============================================================

export interface RunMetricsAccumulator {
  /** total ms spent waiting in LLM-channel retry/cooldown (429 waits) */
  retryWaitMs: number;
  /** number of retry waits observed */
  retryCount: number;
  /** tool names executed in this run (order preserved) */
  toolNames: string[];
}

const g = globalThis as unknown as {
  __runMetricsAcc?: Map<string, RunMetricsAccumulator>;
};

function accMap(): Map<string, RunMetricsAccumulator> {
  if (!g.__runMetricsAcc) g.__runMetricsAcc = new Map();
  return g.__runMetricsAcc;
}

/** Run-scoped accumulator (creates on first touch). */
export function getRunMetrics(runId: string): RunMetricsAccumulator {
  let acc = accMap().get(runId);
  if (!acc) {
    acc = { retryWaitMs: 0, retryCount: 0, toolNames: [] };
    accMap().set(runId, acc);
    // safety valve: never hold more than a few hundred accumulators
    if (accMap().size > 500) {
      const oldest = accMap().keys().next().value;
      if (oldest && oldest !== runId) accMap().delete(oldest);
    }
  }
  return acc;
}

/** Record one retry/cooldown wait (called from withRetry note paths). */
export function noteRetryWait(runId: string, waitMs: number): void {
  const acc = getRunMetrics(runId);
  acc.retryWaitMs += Math.max(0, Math.round(waitMs));
  acc.retryCount += 1;
}

/** Drop the accumulator after the run reached a terminal state. */
export function clearRunMetrics(runId: string): void {
  accMap().delete(runId);
}

// ------------------------------------------------------------
// Phase-3 Workstream D — production-scoped video stage metrics
//
// প্রতি-প্রোডাকশন সঞ্চয়কারী: AI-ভিডিও শটের ধাপ-ভাগ করা সময়
// (submit / poll / download / validate) + ক্যাশ-ফলাফল (Workstream C-এর
// shot_cache কাউন্টার থেকে)। নীতি অপরিবর্তিত: LOW VOLUME (প্রোডাকশন-শেষে
// ঠিক এক লাইন, প্রতি-শট লাইন নয়), REDACTION (কেবল গণনা/সময়/এনাম —
// কোনো প্রম্পট/URL/ব্যবহারকারী-বিষয়বস্তু নয়), HONESTY (না-মাপা → null)।
// ------------------------------------------------------------

export interface ProductionMetricsAcc {
  /** generateVideoClip-এ প্রবেশ করা মোট শট-কল */
  shotsRequested: number;
  /** ডিস্ক-ক্যাশ থেকে ফেরা (প্রোভাইডার-কল এড়ানো) */
  shotsFromCache: number;
  /** চলমান একই-শট প্রজন্মে যোগ দেওয়া (প্রোভাইডার-কল এড়ানো) */
  shotsJoined: number;
  /** প্রকৃত প্রোভাইডার-সাবমিটে যাওয়া শট */
  providerSubmits: number;
  /** বাইপাস করা কল */
  shotsBypassed: number;
  /** ক্যাশে জমা হয়েছে */
  cacheStores: number;
  /** ক্যাশ-এন্ট্রি ভাঙা পাওয়া গেছে */
  cacheInvalid: number;
  /** ধাপ-ভাগ করা মিলিসেকেন্ড (সর্বমোট) */
  submitMsTotal: number;
  pollMsTotal: number;
  downloadMsTotal: number;
  validateMsTotal: number;
}

const gp = globalThis as unknown as {
  __productionMetricsAcc?: Map<string, ProductionMetricsAcc>;
};

function prodAccMap(): Map<string, ProductionMetricsAcc> {
  if (!gp.__productionMetricsAcc) gp.__productionMetricsAcc = new Map();
  return gp.__productionMetricsAcc;
}

/** Production-scoped accumulator (creates on first touch; null-scope = চ্যাট-পথ, স্কিপ) */
export function getProductionMetrics(productionId: string | null | undefined): ProductionMetricsAcc | null {
  if (!productionId) return null;
  let acc = prodAccMap().get(productionId);
  if (!acc) {
    acc = {
      shotsRequested: 0, shotsFromCache: 0, shotsJoined: 0, providerSubmits: 0,
      shotsBypassed: 0, cacheStores: 0, cacheInvalid: 0,
      submitMsTotal: 0, pollMsTotal: 0, downloadMsTotal: 0, validateMsTotal: 0,
    };
    prodAccMap().set(productionId, acc);
    // নিরাপত্তা-ভালভ: কয়েকশ-এর বেশি সঞ্চয়কারী কখনো জমে না
    if (prodAccMap().size > 200) {
      const oldest = prodAccMap().keys().next().value;
      if (oldest && oldest !== productionId) prodAccMap().delete(oldest);
    }
  }
  return acc;
}

/** একটি ভিডিও-ধাপের সময় নথিভুক্ত (ai_video থেকে; productionId-স্কোপ না থাকলে নীরব) */
export function noteVideoStage(
  productionId: string | null | undefined,
  stage: 'submit' | 'poll' | 'download' | 'validate',
  ms: number
): void {
  const acc = getProductionMetrics(productionId);
  if (!acc) return;
  const v = Math.max(0, Math.round(ms));
  if (stage === 'submit') acc.submitMsTotal += v;
  else if (stage === 'poll') acc.pollMsTotal += v;
  else if (stage === 'download') acc.downloadMsTotal += v;
  else acc.validateMsTotal += v;
}

/** একটি শট-কলের ফলাফল নথিভুক্ত (cacheHit | joined | generated | bypass) */
export function noteVideoShotOutcome(
  productionId: string | null | undefined,
  outcome: 'cacheHit' | 'joined' | 'generated' | 'bypass'
): void {
  const acc = getProductionMetrics(productionId);
  if (!acc) return;
  if (outcome === 'cacheHit') acc.shotsFromCache++;
  else if (outcome === 'joined') acc.shotsJoined++;
  else if (outcome === 'bypass') acc.shotsBypassed++;
  else acc.providerSubmits++;
}

/** শট-কল শুরুর গণনা */
export function noteVideoShotRequested(productionId: string | null | undefined): void {
  const acc = getProductionMetrics(productionId);
  if (acc) acc.shotsRequested++;
}

/** ক্যাশ-ঘটনা (স্টোর/ইনভ্যালিড) প্রোডাকশন-স্কোপে জমা */
export function noteVideoCacheEvent(productionId: string | null | undefined, kind: 'store' | 'invalid'): void {
  const acc = getProductionMetrics(productionId);
  if (!acc) return;
  if (kind === 'store') acc.cacheStores++;
  else acc.cacheInvalid++;
}

/** প্রোডাকশন-সমাপ্তিতে সঞ্চয়কারী ফেলে দাও (মেমরি-স্বাস্থ্য) */
export function clearProductionMetrics(productionId: string): void {
  prodAccMap().delete(productionId);
}

function safeJsonLine(label: string, fields: Record<string, unknown>): void {
  try {
    console.log(`${label} ${JSON.stringify(fields)}`);
  } catch {
    // a metrics line must never break the run
  }
}

/** One structured line at agent-run end. Unmeasured → null. */
export function logRunMetrics(fields: {
  runId: string;
  conversationId: string;
  outcome: 'completed' | 'failed' | 'interrupted';
  endReason: string | null;
  errorCategory: string | null;
  requestedMode: string | null;
  usedModel: string | null;
  cacheStatus: string | null;
  steps: number | null;
  toolCalls: number | null;
  durationMs: number | null;
  firstTokenMs: number | null;
  retryWaitMs: number | null;
  retryCount: number | null;
  toolNames: string[];
}): void {
  safeJsonLine('[run-metrics]', {
    ...fields,
    toolNames: fields.toolNames.slice(0, 24), // bounded
    ts: new Date().toISOString(),
  });
}

/** One structured line at production end. Unmeasured → null. */
export function logProductionMetrics(fields: {
  productionId: string;
  type: string;
  outcome: 'completed' | 'partial' | 'failed' | 'cancelled';
  queueWaitMs: number | null;
  durationMs: number | null;
  stepsDone: number | null;
  stepsFailed: number | null;
  artifacts: number | null;
  errorCategoryHint: string | null;
  /** Phase-3 D: ভিডিও-ধাপ মেট্রিকস (সঞ্চয়কারী না থাকলে null — চ্যাট-পথ) */
  video?: {
    shotsRequested: number;
    shotsFromCache: number;
    shotsJoined: number;
    providerSubmits: number;
    shotsBypassed: number;
    cacheStores: number;
    cacheInvalid: number;
    submitMs: number;
    pollMs: number;
    downloadMs: number;
    validateMs: number;
  } | null;
}): void {
  safeJsonLine('[production-metrics]', {
    ...fields,
    ts: new Date().toISOString(),
  });
}
