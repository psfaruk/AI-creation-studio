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
}): void {
  safeJsonLine('[production-metrics]', {
    ...fields,
    ts: new Date().toISOString(),
  });
}
