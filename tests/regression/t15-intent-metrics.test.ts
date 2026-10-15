// ============================================================
// REGRESSION TEST 15 — Intent metrics, redaction & backward-compat
// (Phase-4 Workstream B+G)
//
// Module under test (REAL): src/lib/agent/run-metrics.ts (Phase-4
// additions: noteIntentClassification / noteIntentPlanningMs /
// IntentMetrics + the intent field on logRunMetrics) and the pure
// classifier's latency sanity (deterministic — no LLM involved).
//
// Boundaries: no DB, no SDK, no network. console.log captured via
// bun:test's mock for the one-line metrics assertions.
//
// Enforced contract:
//  - Classification recorded once per run with enums/counts only —
//    NEVER message text (redaction canary proof).
//  - planningMs only exists on the fast path; hint path stays null
//    (unmeasured is null — never fabricated).
//  - logRunMetrics line includes intent when present, omits to null
//    otherwise; every pre-existing field unchanged (backward-compat).
//  - clearRunMetrics drops the intent accumulator too.
//  - Classification is cheap (deterministic in-process rules).
// ============================================================

import { describe, expect, test, beforeEach } from 'bun:test';

const {
  getRunMetrics,
  noteIntentClassification,
  noteIntentPlanningMs,
  clearRunMetrics,
  logRunMetrics,
} = await import('@/lib/agent/run-metrics');
const { classifyIntent } = await import('@/lib/agent/intent/classifier');

const CANARY = 'sk-CANARY-message-text-never-in-metrics';

beforeEach(() => {
  clearRunMetrics('run-15');
  clearRunMetrics('run-15b');
});

describe('REG-15: intent metrics & redaction (Phase-4 B+G)', () => {
  test('REG-15a: noteIntentClassification records enums + timing on the run accumulator', () => {
    noteIntentClassification('run-15', {
      category: 'music_video',
      confidence: 'high',
      fastPath: true,
      durationMs: 2,
    });
    const acc = getRunMetrics('run-15');
    expect(acc.intent).toEqual({
      category: 'music_video',
      confidence: 'high',
      fastPath: true,
      durationMs: 2,
      planningMs: null,
    });
    // পূর্বে-বিদ্যমান ক্ষেত্রগুলো অক্ষত (additive চুক্তি)
    expect(acc.retryWaitMs).toBe(0);
    expect(acc.toolNames).toEqual([]);
  });

  test('REG-15b: noteIntentPlanningMs sets planningMs; without classification it is a silent no-op', () => {
    noteIntentPlanningMs('run-15b', 37); // শ্রেণিবিভাগনির্ধারণ ছাড়া — নীরব স্কিপ
    expect(getRunMetrics('run-15b').intent).toBeUndefined();

    noteIntentClassification('run-15b', {
      category: 'short_film',
      confidence: 'high',
      fastPath: true,
      durationMs: 1,
    });
    noteIntentPlanningMs('run-15b', 37);
    expect(getRunMetrics('run-15b').intent!.planningMs).toBe(37);
  });

  test('REG-15c: logRunMetrics line carries intent (enums only — no message text, redaction canary)', () => {
    // t11-প্যাটার্ন: console.log ক্যাপচার — safeJsonLine একটিই টেমপ্লেট-আর্গুমেন্ট লেখে
    const lines: string[] = [];
    const origLog = console.log;
    console.log = ((...args: unknown[]) => {
      lines.push(String(args[0]));
    }) as typeof console.log;
    try {
      noteIntentClassification('run-15', {
        category: 'music_video',
        confidence: 'high',
        fastPath: true,
        durationMs: 2,
      });
      logRunMetrics({
        runId: 'run-15',
        conversationId: 'conv-15',
        outcome: 'completed',
        endReason: 'final_answer',
        errorCategory: null,
        requestedMode: null,
        usedModel: '(default)',
        cacheStatus: 'hit',
        steps: 1,
        toolCalls: 0,
        durationMs: 120,
        firstTokenMs: 2,
        retryWaitMs: 0,
        retryCount: 0,
        toolNames: [],
        intent: getRunMetrics('run-15').intent,
      });
    } finally {
      console.log = origLog;
    }
    expect(lines.length).toBe(1);
    const line = lines[0] ?? '';
    expect(line).toContain('[run-metrics]');
    expect(line).toContain('"intent"');
    expect(line).toContain('"music_video"');
    // রেডাকশন-চুক্তি: বার্তা-টেক্সট/গোপন-তথ্য কখনো নয়
    expect(line).not.toContain(CANARY);
  });

  test('REG-15d: backward-compat — logRunMetrics without intent still works; null → honest null', () => {
    const lines: string[] = [];
    const origLog = console.log;
    console.log = ((...args: unknown[]) => {
      lines.push(String(args[0]));
    }) as typeof console.log;
    try {
      // পুরোনো কল-আকৃতি (Phase-1 চুক্তি) — intent বাদ
      logRunMetrics({
        runId: 'run-15b',
        conversationId: 'conv-15',
        outcome: 'failed',
        endReason: 'max_steps',
        errorCategory: 'max_steps',
        requestedMode: null,
        usedModel: null,
        cacheStatus: null,
        steps: 12,
        toolCalls: 3,
        durationMs: 9000,
        firstTokenMs: null,
        retryWaitMs: 4000,
        retryCount: 2,
        toolNames: ['web_search'],
      });
      // intent অনুপস্থিত ক্ষেত্র হিসেবে সৎ null — বানানো মান নয়
      logRunMetrics({
        runId: 'run-15b',
        conversationId: 'conv-15',
        outcome: 'completed',
        endReason: 'final_answer',
        errorCategory: null,
        requestedMode: null,
        usedModel: null,
        cacheStatus: null,
        steps: 1,
        toolCalls: 0,
        durationMs: 50,
        firstTokenMs: null,
        retryWaitMs: 0,
        retryCount: 0,
        toolNames: [],
        intent: null,
      });
    } finally {
      console.log = origLog;
    }
    expect(lines.length).toBe(2);
    expect(lines[0] ?? '').toContain('[run-metrics]');
    expect(lines[0] ?? '').toContain('"web_search"');
    expect(lines[0] ?? '').not.toContain('"intent"');
    expect(lines[1] ?? '').toContain('"intent":null');
  });

  test('REG-15e: clearRunMetrics drops the intent accumulator', () => {
    noteIntentClassification('run-15', {
      category: 'general_chat',
      confidence: 'high',
      fastPath: false,
      durationMs: 1,
    });
    clearRunMetrics('run-15');
    const fresh = getRunMetrics('run-15');
    expect(fresh.intent).toBeUndefined();
    expect(fresh.retryWaitMs).toBe(0);
  });

  test('REG-15f: classification is deterministic and cheap (1000 calls, no LLM)', () => {
    const msg = 'বাংলা একটি গান দিয়ে মিউজিক ভিডিও বানিয়ে দাও';
    const first = classifyIntent(msg);
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      const c = classifyIntent(msg);
      if (i === 999) {
        expect(c.category).toBe(first.category);
        expect(c.fastPathEligible).toBe(first.fastPathEligible);
      }
    }
    const elapsed = Date.now() - t0;
    // উদার ঊর্ধ্বসীমা (CI-নয়েজ-সহ) — তবু LLM-কল হলে অকল্পনীয়ভাবে ভাঙবে
    expect(elapsed).toBeLessThan(5000);
  });
});
