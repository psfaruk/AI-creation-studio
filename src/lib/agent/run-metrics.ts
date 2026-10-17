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
  /** Phase-4 B: intent-classification result (single, deterministic; enums/counts
   *  only — never message text). Undefined = classification never ran. */
  intent?: IntentMetrics;
}

/** Phase-4 B: শ্রেণিবিভাগনির্ধারণ + দ্রুত-পথ পরিকল্পনার যাচাইকৃত মাপ (REDACTION-নিরাপদ) */
export interface IntentMetrics {
  category: string;
  confidence: string;
  /** দ্রুত-পথ চলেছে কি না (LLM রাউন্ড-ট্রিপ বাদ) */
  fastPath: boolean;
  /** classifyIntent-এর সময় (ms, নিয়ম-ভিত্তিক — µs-স্কেল প্রত্যাশিত) */
  durationMs: number;
  /** দ্রুত-পথে createProduction-এর সময় (ms); হিন্ট-পথে null — অ-মাপা কখনো বানানো হয় না */
  planningMs: number | null;
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

/** Phase-4 B: রান-শুরুর একবারই চলা নিয়ম-ভিত্তিক শ্রেণিবিভাগনির্ধারণ নথিভুক্ত। */
export function noteIntentClassification(
  runId: string,
  m: { category: string; confidence: string; fastPath: boolean; durationMs: number }
): void {
  const acc = getRunMetrics(runId);
  acc.intent = { ...m, planningMs: null };
}

/** Phase-4 B: দ্রুত-পথের createProduction-সময় জমা (হিন্ট-পথে কখনো ডাকা হয় না)। */
export function noteIntentPlanningMs(runId: string, ms: number): void {
  const acc = getRunMetrics(runId);
  if (!acc.intent) return; // শ্রেণিবিভাগনির্ধারণ ছাড়া পরিকল্পনা-সময় অর্থহীন — নীরব স্কিপ
  acc.intent.planningMs = Math.max(0, Math.round(ms));
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
  /** Phase-5: নির্ধারক সিনেম্যাটিক পরিকল্পক-কলের প্রকৃত সময় (ms)।
   * -1 = পরিকল্পক-পথ চলেনি (চ্যাট/motion_video)। সঞ্চয়কারীর অভিন্ন-নীতি:
   * প্রতিটি ক্ষেত্র সংখ্যা (REDACTION — REG-11b-র "কেবল সংখ্যা" চুক্তি)। */
  planMs: number;
  /** Phase-5: পরিকল্পিত শট-সংখ্যা (-1 = পরিকল্পক চলেনি) */
  plannedShots: number;
  /** Phase-5: পরিকল্পনার সৎ-সমন্বয়-নোটের সংখ্যা (-1 = পরিকল্পক চলেনি) */
  planAdjustments: number;
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
      planMs: -1, plannedShots: -1, planAdjustments: -1,
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

/**
 * Phase-5: নির্ধারক সিনেম্যাটিক পরিকল্পকের প্রকৃত মাপ জমা (এক প্রোডাকশনে
 * একবারই চলে — প্রথম জমাই চূড়ান্ত)। গণনা/সময়-কেবল — কোনো প্রম্পট-টেক্সট নয়।
 */
export function notePlanMetrics(
  productionId: string | null | undefined,
  m: { planMs: number; plannedShots: number; planAdjustments: number }
): void {
  const acc = getProductionMetrics(productionId);
  if (!acc) return;
  acc.planMs = Math.max(0, Math.round(m.planMs));
  acc.plannedShots = m.plannedShots;
  acc.planAdjustments = m.planAdjustments;
}

/** প্রোডাকশন-সমাপ্তিতে সঞ্চয়কারী ফেলে দাও (মেমরি-স্বাস্থ্য) */
export function clearProductionMetrics(productionId: string): void {
  prodAccMap().delete(productionId);
}

// ------------------------------------------------------------
// (D-8/B6 + F3) প্রোডাকশন-সমাপ্তির বিভাজিত সময়-রিপোর্ট + ধাপ→স্টেজ মানচিত্র
//
// নীতি অপরিবর্তিত: REDACTION (কেবল সংখ্যা/সময়), HONESTY (অ-মাপা →
// null — কখনো কাল্পনিক নয়), LOW VOLUME (একই এক-লাইন মেট্রিকসের নতুন
// ঐচ্ছিক timings{} ব্লক — নতুন লাইন নয়)।
// ------------------------------------------------------------

/**
 * (F3) ধাপ-কী → স্টেজ মানচিত্র — SSE step_start/step_end পেলোডের
 * ঐচ্ছিক `stage` ক্ষেত্রের একমাত্র উৎস।
 *
 * Production.status-এর সাথে সম্পর্ক: PLANNING/WAITING_FOR_CONFIRMATION/
 * QUEUED/VALIDATING/PARTIAL/COMPLETED/FAILED/CANCELLED ইতিমধ্যে
 * Production.status-মান (types.ts ProductionStatus + serialize.ts
 * toProductionStatus) — নিচের স্টেজ-মানগুলো ধাপ-স্তরের সূক্ষ্মতর বিভাজন
 * (উদাহ. 'running' প্রোডাকশনের ভেতরে GENERATING_AUDIO চলছে)।
 * LIPSYNC_PROCESSING সৎভাবে N/A — কোনো লিপ-সিঙ্ক প্রসেসিং নেই
 * (MP4-E: provider সৎ 'unsupported' থ্রো করে)।
 *
 * অজানা কী → ম্যাপে এন্ট্রি নেই → stage ক্ষেত্রই পাঠানো হয় না
 * (অনুপস্থিত, কাল্পনিক নয়)। ProductionStep DB-সারি অপরিবর্তিত —
 * serialize.ts-এর status-whitelist অক্ষত।
 */
export const PRODUCTION_STAGES = ['PLANNING', 'GENERATING_AUDIO', 'GENERATING_SHOTS', 'COMPOSITING', 'VALIDATING'] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const STEP_STAGE: Readonly<Record<string, ProductionStage>> = {
  script_breakdown: 'PLANNING',
  visual_plan: 'PLANNING',
  plan: 'PLANNING',
  speech: 'GENERATING_AUDIO',
  sound_design: 'GENERATING_AUDIO',
  synthesize: 'GENERATING_AUDIO',
  song_input: 'GENERATING_AUDIO',
  generate_shots: 'GENERATING_SHOTS',
  final_mix: 'COMPOSITING',
  timeline: 'COMPOSITING',
  assemble: 'COMPOSITING',
  validate: 'VALIDATING',
  final_qc: 'VALIDATING',
  continuity: 'VALIDATING',
};

/**
 * (D-8/B6) [production-metrics] লাইনের নতুন ঐচ্ছিক শীর্ষ-স্তরের timings{}
 * ব্লক। প্রতিটি ক্ষেত্র সংখ্যা-কেবল (REDACTION)। অ-মাপা → null।
 */
export interface ProductionTimingsBlock {
  /** ব্যবহারকারীর নিশ্চিতকরণ-অপেক্ষা (confirmedAt − createdAt);
   *  confirmedAt null (ঐতিহাসিক/অ-নিশ্চিত) → null */
  confirmationHoldMs?: number | null;
  /** লিগ্যাসি সারি-অপেক্ষা (startedAt − createdAt) — দ্রষ্টব্য: ইচ্ছাকৃতভাবে
   *  নিশ্চিতকরণ-অপেক্ষাসহ (pre-D-8 অর্থ, পেছনের সামঞ্জস্যের জন্য অপরিবর্তিত)।
   *  সৎ সারি-অপেক্ষা = queueWaitMs − confirmationHoldMs (উভয়ই থাকলে)। */
  queueWaitMs?: number | null;
  /** সিনেম্যাটিক পরিকল্পক-কলের সময় (plan.planMs; পরিকল্পক না চললে null) */
  planGenerationMs?: number | null;
  /** প্রোভাইডার-সাবমিট (প্রতি-শট যোগফল — video.submitMs) */
  providerSubmissionMs?: number | null;
  /** প্রোভাইডার-জেনারেশন/পোল (video.pollMs) */
  providerGenerationMs?: number | null;
  /** ডাউনলোড (video.downloadMs) */
  downloadMs?: number | null;
  /** যাচাই (video.validateMs) */
  validationMs?: number | null;
  /** অডিও-ধাপগুলোর দেয়াল-সময়ের যোগফল (steps: speech/sound_design/
   *  synthesize/song_input) — ০টি পরিমাপযোগ্য ধাপ → null (0 নয়) */
  audioProcessingMs?: number | null;
  /** ভিডিও-সংযোজন-ধাপগুলোর যোগফল (final_mix/timeline/assemble);
   *  ০টি পরিমাপযোগ্য ধাপ → null */
  videoCompositionMs?: number | null;
  /** মোট কার্যকর-সময় (startedAt → finishedAt) — durationMs-এরই অন্য নাম */
  totalExecutionMs?: number | null;
  /** ব্যবহারকারীর মোট অপেক্ষা (finishedAt − createdAt) — নিশ্চিতকরণ-অপেক্ষা
   *  সহ; দ্রুততম প্রস্তাব→ফলাফল অভিজ্ঞতার মাপ */
  totalUserElapsedMs?: number | null;
}

/** computeFinalTimings-এর ইনপুট — Production সারির সময়-ক্ষেত্রগুলো */
export interface ProductionTimingsRow {
  createdAt: Date | null;
  confirmedAt?: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** computeFinalTimings-এর ইনপুট — ধাপ-সারির প্রাসঙ্গিক ক্ষেত্র */
export interface ProductionTimingsStep {
  key: string;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** (D-8) অডিও-প্রসেসিং হিসেবে গণ্য ধাপ-কী */
export const AUDIO_PROCESSING_STEP_KEYS: readonly string[] = ['speech', 'sound_design', 'synthesize', 'song_input'];
/** (D-8) ভিডিও-সংযোজন হিসেবে গণ্য ধাপ-কী */
export const VIDEO_COMPOSITING_STEP_KEYS: readonly string[] = ['final_mix', 'timeline', 'assemble'];

/** নির্দিষ্ট কী-সেটের ধাপগুলোর দেয়াল-সময়ের যোগফল (মি.সে.)।
 *  একটিও পরিমাপযোগ্য ধাপ না থাকলে null — 0 কখনো বানানো হয় না (সততা)। */
function sumStepWallMs(steps: readonly ProductionTimingsStep[], keys: readonly string[]): number | null {
  let total: number | null = null;
  for (const step of steps) {
    if (!keys.includes(step.key) || !step.startedAt || !step.finishedAt) continue;
    const ms = Math.max(0, step.finishedAt.getTime() - step.startedAt.getTime());
    total = (total ?? 0) + ms;
  }
  return total;
}

function elapsedMs(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  return Math.max(0, to.getTime() - from.getTime());
}

/**
 * (D-8/B6) প্রোডাকশন-সমাপ্তির বিভাজিত সময়-হিসাব — বিশুদ্ধ ফাংশন
 * (রানারের সাফল্য ও failProduction উভয় পথ থেকেই ডাকা হয়; সরাসরি
 * একক-পরীক্ষাযোগ্য)।
 *
 * সততা-চুক্তি:
 *  - confirmedAt না থাকলে confirmationHoldMs = null (কাল্পনিক নয়)
 *  - queueWaitMs = লিগ্যাসি অর্থেই startedAt − createdAt (নিশ্চিতকরণ-অপেক্ষা
 *    সহ) — শীর্ষ-স্তরের লিগ্যাসি queueWaitMs ক্ষেত্রের সাথে সমান মান
 *  - পরিকল্পক না চললে (planMs = -1) planGenerationMs = null
 *  - ০টি পরিমাপযোগ্য অডিও/সংযোজন-ধাপ → null (0 নয়)
 */
export function computeFinalTimings(
  row: ProductionTimingsRow | null,
  steps: readonly ProductionTimingsStep[],
  metricsAcc: ProductionMetricsAcc | null
): ProductionTimingsBlock {
  if (!row) {
    return {
      confirmationHoldMs: null,
      queueWaitMs: null,
      planGenerationMs: null,
      providerSubmissionMs: null,
      providerGenerationMs: null,
      downloadMs: null,
      validationMs: null,
      audioProcessingMs: null,
      videoCompositionMs: null,
      totalExecutionMs: null,
      totalUserElapsedMs: null,
    };
  }
  return {
    confirmationHoldMs: elapsedMs(row.createdAt, row.confirmedAt ?? null),
    // লিগ্যাসি সূত্র অপরিবর্তিত — নিশ্চিতকরণ-অপেক্ষা ইচ্ছাকৃতভাবে অন্তর্ভুক্ত
    // (pre-D-8 ভোক্তারা এই অর্থেইনির্ভর; রানারের শীর্ষ-স্তরের queueWaitMs-এর
    // সাথে বাইট-অভিন্প সূত্র)।
    queueWaitMs: elapsedMs(row.createdAt, row.startedAt),
    planGenerationMs: metricsAcc && metricsAcc.planMs >= 0 ? metricsAcc.planMs : null,
    providerSubmissionMs: metricsAcc ? metricsAcc.submitMsTotal : null,
    providerGenerationMs: metricsAcc ? metricsAcc.pollMsTotal : null,
    downloadMs: metricsAcc ? metricsAcc.downloadMsTotal : null,
    validationMs: metricsAcc ? metricsAcc.validateMsTotal : null,
    audioProcessingMs: sumStepWallMs(steps, AUDIO_PROCESSING_STEP_KEYS),
    videoCompositionMs: sumStepWallMs(steps, VIDEO_COMPOSITING_STEP_KEYS),
    totalExecutionMs: elapsedMs(row.startedAt, row.finishedAt),
    totalUserElapsedMs: elapsedMs(row.createdAt, row.finishedAt),
  };
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
  /** Phase-4 B: intent metrics (null = classification never ran, e.g. chat_only) */
  intent?: IntentMetrics | null;
}):void {
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
  /** Phase-5: সিনেম্যাটিক পরিকল্পনা-মেট্রিকস (null/অনুপস্থিত = পরিকল্পক-পথ
   * চলেনি — চ্যাট/motion_video)। মানগুলি সংখ্যা-কেবল (REDACTION)। */
  plan?: {
    planMs: number;
    plannedShots: number;
    planAdjustments: number;
  } | null;
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
  /** (D-8/B6) বিভাজিত সময়-ব্লক — ঐচ্ছিক: না দিলে timings কীই লাগে না
   *  (t11/t15/t16/smoke-এর আক্ষরিক-বস্তু কল পেছনের-সামঞ্জস্যপূর্ণ)।
   *  লাগে plan{}/video{} ব্লকের বাইরে শীর্ষ-স্তরে (REG-16m plan-চুক্তি +
   *  REG-11b video-সংখ্যা-চুক্তি অক্ষত)। */
  timings?: ProductionTimingsBlock | null;
}): void {
  safeJsonLine('[production-metrics]', {
    ...fields,
    ts: new Date().toISOString(),
  });
}
