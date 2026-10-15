// ============================================================
// Phase-1 smoke test — framework sanity + shared invariants.
//
// Verifies:
//  1. bun:test runs with tsconfig path aliases (@/* → src/*)
//  2. the executable tool registry and the UI catalog stay in
//     parity (no silent drift — locks the audit invariant).
// ============================================================

import { describe, expect, test } from 'bun:test';
import { toolParityReport } from '@/lib/agent/registry';
import { TOOL_CATALOG } from '@/lib/types';
import {
  getRunMetrics,
  noteRetryWait,
  clearRunMetrics,
  logRunMetrics,
  logProductionMetrics,
} from '@/lib/agent/run-metrics';

describe('framework smoke', () => {
  test('path alias @/* resolves through tsconfig', async () => {
    const mod = await import('@/lib/agent/retry');
    expect(typeof mod.withRetry).toBe('function');
    expect(typeof mod.TemporarilyUnavailableError).toBe('function');
  });

  test('tool registry ↔ UI catalog parity (executableCount === catalogCount, no drift)', () => {
    const report = toolParityReport(TOOL_CATALOG);
    // Phase-1 baseline: 41 executable tools, 41 catalog entries.
    // If this fails, either a tool was added/removed from one side
    // only — check the change before updating the expected count.
    expect(report.executableCount).toBe(41);
    expect(report.catalogCount).toBe(41);
    expect(report.missingInCatalog).toEqual([]);
    expect(report.missingInRegistry).toEqual([]);
    expect(report.duplicatesInCatalog).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('run-metrics accumulator (Phase-1 observability units)', () => {
  test('retry waits accumulate per run and clear on terminal', () => {
    const rid = 'run-smoke-metrics-1';
    clearRunMetrics(rid);
    noteRetryWait(rid, 4000);
    noteRetryWait(rid, 200);
    const acc = getRunMetrics(rid);
    expect(acc.retryWaitMs).toBe(4200);
    expect(acc.retryCount).toBe(2);
    expect(acc.toolNames).toEqual([]);
    acc.toolNames.push('web_search');
    clearRunMetrics(rid);
    // after clear, a fresh accumulator starts at zero
    expect(getRunMetrics(rid).retryWaitMs).toBe(0);
    expect(getRunMetrics(rid).toolNames).toEqual([]);
    clearRunMetrics(rid);
  });

  test('metrics lines are single-line JSON (loggable without breaking the run)', () => {
    // capture console output to verify the exact wire format
    const original = console.log;
    let captured: string[] = [];
    console.log = (...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    };
    try {
      logRunMetrics({
        runId: 'r1',
        conversationId: 'c1',
        outcome: 'completed',
        endReason: 'final_answer',
        errorCategory: null,
        requestedMode: null,
        usedModel: null,
        cacheStatus: null,
        steps: 1,
        toolCalls: 0,
        durationMs: 100,
        firstTokenMs: null,
        retryWaitMs: 0,
        retryCount: 0,
        toolNames: [],
      });
      logProductionMetrics({
        productionId: 'p1',
        type: 'image',
        outcome: 'failed',
        queueWaitMs: null,
        durationMs: null,
        stepsDone: null,
        stepsFailed: null,
        artifacts: null,
        errorCategoryHint: 'see_error_field',
      });
    } finally {
      console.log = original;
    }
    expect(captured.length).toBe(2);
    expect(captured[0].startsWith('[run-metrics] {')).toBe(true);
    expect(captured[1].startsWith('[production-metrics] {')).toBe(true);
    const runJson = JSON.parse(captured[0].slice('[run-metrics] '.length));
    expect(runJson.runId).toBe('r1');
    expect(runJson.firstTokenMs).toBeNull(); // null = not measured, never fabricated
    const prodJson = JSON.parse(captured[1].slice('[production-metrics] '.length));
    expect(prodJson.outcome).toBe('failed');
    expect(prodJson.queueWaitMs).toBeNull();
  });
});
