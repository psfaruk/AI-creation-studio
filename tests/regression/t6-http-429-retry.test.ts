// ============================================================
// REGRESSION TEST 6 — HTTP 429 retry behavior
// (retry bounds, backoff, budget, no infinite retry, permanent
//  errors not retried, channel serialization)
//
// Boundaries:
//  - Modules under test: REAL src/lib/agent/retry.ts (withRetry,
//    parseRetryAfterMs, fullJitterDelayMs, TemporarilyUnavailableError)
//    and REAL src/lib/agent/rate-limit-coordinator.ts (adaptive
//    cooldown, channel serialization).
//  - Mocked: nothing — the failing "provider" is a local closure.
//    All waits use millisecond-scale budgets so real timers stay
//    fast (no fake-timer dependency, no long real-time waits).
//  - The rate-limit-coordinator keeps state on globalThis; each
//    test resets it for isolation.
// ============================================================

import { describe, expect, test, beforeEach } from 'bun:test';

const {
  withRetry,
  parseRetryAfterMs,
  fullJitterDelayMs,
  isRateLimitErrorText,
  TemporarilyUnavailableError,
} = await import('@/lib/agent/retry');

/** Reset the coordinator's globalThis state (isolates channel tests). */
function resetCoordinator(): void {
  (globalThis as unknown as { __rateLimitCoordinator?: unknown }).__rateLimitCoordinator =
    new Map();
}

beforeEach(() => {
  resetCoordinator();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('REG-6: HTTP 429 retry behavior', () => {
  test('REG-6a: 429 exhausts exactly `attempts` tries, then throws TemporarilyUnavailableError (never a false success)', async () => {
    let calls = 0;
    let err: unknown = null;
    try {
      await withRetry(
        async () => {
          calls++;
          throw new Error('HTTP 429 Too Many Requests');
        },
        'reg6a',
        3, // attempts
        2, // baseMs — tiny
        { maxDelayMs: 8 }
      );
    } catch (e) {
      err = e;
    }
    expect(calls).toBe(3); // bounded — not infinite
    expect(err).toBeInstanceOf(TemporarilyUnavailableError);
    expect(String((err as Error).message)).toContain('TEMPORARILY_UNAVAILABLE');
    expect(String((err as Error).message)).toContain('রেট-লিমিট');
  });

  test('REG-6b: permanent errors (401/invalid key) are NOT retried — exactly one attempt', async () => {
    let calls = 0;
    let err: unknown = null;
    try {
      await withRetry(
        async () => {
          calls++;
          const e = new Error('401 Unauthorized — invalid api key') as Error & { status?: number };
          e.status = 401;
          throw e;
        },
        'reg6b',
        4,
        2,
        { maxDelayMs: 8 }
      );
    } catch (e) {
      err = e;
    }
    expect(calls).toBe(1);
    // rethrown as-is, NOT wrapped as temporarily-unavailable
    expect(err).not.toBeInstanceOf(TemporarilyUnavailableError);
    expect(String((err as Error).message)).toContain('401');
  });

  test('REG-6c: successful call after transient 429 resolves without error (retry actually recovers)', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 2) throw new Error('429 rate limit exceeded');
        return 'recovered';
      },
      'reg6c',
      3,
      2,
      { maxDelayMs: 8 }
    );
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  test('REG-6d: onWait fires per retry with ascending attempt numbers and bounded delays', async () => {
    const waits: Array<{ attempt: number; delayMs: number }> = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('429');
        return 'ok';
      },
      'reg6d',
      4,
      3,
      {
        maxDelayMs: 10,
        onWait: (info) => waits.push({ attempt: info.attempt, delayMs: info.delayMs }),
      }
    );
    expect(waits.length).toBe(2);
    expect(waits[0].attempt).toBe(1);
    expect(waits[1].attempt).toBe(2);
    for (const w of waits) {
      expect(w.delayMs).toBeGreaterThanOrEqual(0);
      expect(w.delayMs).toBeLessThanOrEqual(10); // capped by maxDelayMs
    }
  });

  test('REG-6e: Retry-After header is honored (capped by maxDelayMs)', async () => {
    const waits: number[] = [];
    let calls = 0;
    await withRetry(
      async () => {
        calls++;
        if (calls < 2) {
          const e = new Error('429 Too Many Requests') as Error & {
            headers: { get: (k: string) => string | null };
          };
          e.headers = { get: (k) => (k === 'retry-after' ? '30' : null) };
          throw e;
        }
        return 'ok';
      },
      'reg6e',
      3,
      2,
      {
        maxDelayMs: 12, // Retry-After says 30s — must be capped to 12ms here
        onWait: (info) => waits.push(info.delayMs),
      }
    );
    expect(waits.length).toBe(1);
    expect(waits[0]).toBe(12); // min(maxDelayMs, retryAfter)
  });

  test('REG-6f: channel cooldown respects the total wait budget — gives up fast with an honest TemporarilyUnavailableError', async () => {
    const { noteRateLimit } = await import('@/lib/agent/rate-limit-coordinator');
    // simulate a real 429 storm: the tts channel goes into cooldown
    noteRateLimit('tts');
    let calls = 0;
    let err: unknown = null;
    const t0 = Date.now();
    try {
      await withRetry(
        async () => {
          calls++;
          return 'should-not-happen';
        },
        'reg6f',
        5,
        2,
        { channel: 'tts', cooldownBudgetMs: 40 } // total budget 40ms
      );
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - t0;
    // budget exhausted → honest failure, no provider call wasted
    expect(calls).toBe(0);
    expect(err).toBeInstanceOf(TemporarilyUnavailableError);
    // honest rate-limit wording (never a license problem)
    expect(String((err as Error).message)).toContain('রেট-লিমিট');
    // fast-fail: roughly the 40ms budget, not minutes of cooldown
    expect(elapsed).toBeLessThan(2_000);
  });

  test('REG-6g: same-channel calls are serialized (no parallel 429 storm)', async () => {
    const { runSerialized } = await import('@/lib/agent/rate-limit-coordinator');
    const order: string[] = [];
    const f1 = async () => {
      order.push('f1-start');
      await sleep(40);
      order.push('f1-end');
      return 1;
    };
    const f2 = async () => {
      order.push('f2-start');
      await sleep(5);
      order.push('f2-end');
      return 2;
    };
    const [r1, r2] = await Promise.all([runSerialized('asr', f1), runSerialized('asr', f2)]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    // f2 must not start before f1 finished
    expect(order.indexOf('f2-start')).toBeGreaterThan(order.indexOf('f1-end'));
  });
});

describe('REG-6: retry parsing units', () => {
  test('REG-6h: parseRetryAfterMs reads err.retryAfter / headers / message text', () => {
    expect(parseRetryAfterMs({ retryAfter: 30 } as never)).toBe(30_000);
    expect(
      parseRetryAfterMs({ headers: { get: (k: string) => (k === 'retry-after' ? '45' : null) } } as never)
    ).toBe(45_000);
    expect(parseRetryAfterMs(new Error('Rate limited — Retry-After: 20 seconds') as never)).toBe(20_000);
    expect(parseRetryAfterMs(new Error('no retry information') as never)).toBeNull();
  });

  test('REG-6i: fullJitterDelayMs stays within [floor, min(maxDelay, base*2^attempt)]', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      for (let i = 0; i < 50; i++) {
        const d = fullJitterDelayMs(10, attempt, 90);
        const ceiling = Math.min(90, 10 * Math.pow(2, attempt));
        expect(d).toBeGreaterThanOrEqual(Math.min(5, ceiling) - 1);
        expect(d).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  test('REG-6j: isRateLimitErrorText classification (429 is never a license problem)', () => {
    expect(isRateLimitErrorText('HTTP 429')).toBe(true);
    expect(isRateLimitErrorText('rate limit exceeded')).toBe(true);
    expect(isRateLimitErrorText('Too Many Requests')).toBe(true);
    expect(isRateLimitErrorText('TEMPORARILY_UNAVAILABLE: x')).toBe(true);
    expect(isRateLimitErrorText('403 Forbidden')).toBe(false);
    expect(isRateLimitErrorText('invalid api key')).toBe(false);
  });
});
