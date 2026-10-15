// ============================================================
// REGRESSION TEST 4 — SSE event replay contract
// (disconnect → reconnect: ordering, replay, dedupe, terminal)
//
// Boundaries:
//  - Modules under test: REAL event bus (src/lib/agent/events.ts)
//    and the REAL GET handler of /api/runs/[id]/events (forward()
//    dedupe + DB replay ordering).
//  - Mocked: '@/lib/db' (in-memory fake) and '@/lib/security'.
//
// Contract under test:
//  1. bus: events emitted before any subscriber are retained in
//     the replay buffer (ordering preserved, cap 100).
//  2. bus: after run_finished the buffer stays available for a
//     late joiner during the grace window.
//  3. route: duplicate events for the same activityId are deduped
//     (tool_start ×2 → 1 delivery; run_finished ×2 → 1 delivery).
//  4. route: reconnect after disconnect replays DB-durable events
//     in order (tool_start → tool_end → message → run_finished),
//     exactly one terminal event, and the stream closes.
//  5. route: non-durable events (text_delta) are NOT replayed from
//     DB on reconnect — by design (final message is authoritative).
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import {
  fakeDb,
  resetFakeDb,
  seedConversation,
  seedAgentRun,
  seedToolCall,
  seedMessage,
  state,
} from '../helpers/fake-db';
import { collectSse, framesOf, type SseFrame } from '../helpers/sse-harness';

mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/security', () => ({
  requireOwner: async () => ({ ok: true as const }),
}));

const { GET } = await import('@/app/api/runs/[id]/events/route');
const bus = await import('@/lib/agent/events');

let runId = '';
let conversationId = '';

beforeEach(() => {
  resetFakeDb();
  const conv = seedConversation();
  conversationId = conv.id;
  const run = seedAgentRun(conv.id, { id: 'run-t4-main' });
  runId = run.id;
});

describe('REG-4: SSE event replay (bus level)', () => {
  test('REG-4a: events emitted before subscribe are recoverable via getReplay, order preserved', () => {
    const rid = 'run-t4-bus-a';
    bus.emit(rid, { type: 'run_started', runId: rid, conversationId: 'c' } as never);
    bus.emit(rid, { type: 'tool_start', activityId: 'a1', tool: 'web_search' } as never);
    bus.emit(rid, { type: 'text_delta', delta: 'প্রথম' } as never);
    bus.emit(rid, { type: 'tool_end', activityId: 'a1', status: 'done' } as never);

    const replay = bus.getReplay(rid);
    expect(replay.map((e) => e.type)).toEqual([
      'run_started',
      'tool_start',
      'text_delta',
      'tool_end',
    ]);
  });

  test('REG-4b: replay buffer is capped at 100 events (oldest trimmed)', () => {
    const rid = 'run-t4-bus-cap';
    for (let i = 0; i < 105; i++) {
      bus.emit(rid, { type: 'run_note', note: `n${i}` } as never);
    }
    const replay = bus.getReplay(rid);
    expect(replay.length).toBe(100);
    // oldest 5 trimmed
    expect((replay[0] as { note: string }).note).toBe('n5');
    expect((replay[99] as { note: string }).note).toBe('n104');
  });

  test('REG-4c: after run_finished the buffer remains available for a late joiner (grace window)', () => {
    const rid = 'run-t4-bus-fin';
    bus.emit(rid, { type: 'run_started', runId: rid, conversationId: 'c' } as never);
    bus.emit(rid, { type: 'run_finished', runId: rid, status: 'completed' } as never);

    // all listeners gone — late joiner can still drain within grace
    const replay = bus.getReplay(rid);
    expect(replay.length).toBe(2);
    expect(replay[1].type).toBe('run_finished');
  });
});

describe('REG-4: SSE event replay (route level)', () => {
  test(
    'REG-4d: duplicate events for the same activityId are deduped on the wire (tool_start ×2, run_finished ×2)',
    async () => {
      seedToolCall(runId, 'web_search', { id: 'tc-dup-1', status: 'running' });

      // live-emit duplicates straight to the bus while attached
      const collect = collectSse(GET, runId, {
        until: (fs) => framesOf(fs, 'run_finished').length >= 1,
        timeoutMs: 2_500,
      });
      // small wait for the route to attach its listener
      await new Promise((r) => setTimeout(r, 120));
      bus.emit(runId, { type: 'tool_start', activityId: 'tc-dup-1', tool: 'web_search', title: 'খোঁজ' } as never);
      bus.emit(runId, { type: 'tool_start', activityId: 'tc-dup-1', tool: 'web_search', title: 'খোঁজ' } as never);
      bus.emit(runId, { type: 'text_delta', delta: 'হ্যালো' } as never);
      bus.emit(runId, { type: 'tool_end', activityId: 'tc-dup-1', status: 'done' } as never);
      bus.emit(runId, { type: 'run_finished', runId, status: 'completed' } as never);
      bus.emit(runId, { type: 'run_finished', runId, status: 'completed' } as never);

      const { frames } = await collect;
      const starts = framesOf(frames, 'tool_start').filter((f) => f.activityId === 'tc-dup-1');
      const finished = framesOf(frames, 'run_finished');
      const deltas = framesOf(frames, 'text_delta');

      expect(starts.length).toBe(1); // deduped
      expect(finished.length).toBe(1); // deduped + closes stream
      expect(deltas.length).toBe(1); // text_delta is forwarded as-is (no dedupe by design)
    },
    5_000
  );

  test(
    'REG-4e: disconnect → reconnect replays durable events in order with exactly one terminal event, and text_delta is not replayed',
    async () => {
      // first connection: attach, see a live text_delta, then disconnect
      const first = collectSse(GET, runId, {
        until: (fs) => framesOf(fs, 'text_delta').length >= 1,
        timeoutMs: 3_000,
      });
      // let the route register its bus listener
      await new Promise((r) => setTimeout(r, 150));
      bus.emit(runId, { type: 'text_delta', delta: 'স্ট্রিম' } as never);
      const firstPass = await first;
      expect(framesOf(firstPass.frames, 'text_delta').length).toBe(1);

      // run finishes while NOBODY is connected (disconnect window)
      seedToolCall(runId, 'web_search', {
        id: 'tc-r-1',
        status: 'done',
        outputSummary: 'ফলাফল',
        durationMs: 800,
      });
      seedMessage(conversationId, 'assistant', 'চূড়ান্ত উত্তর।', { runId });
      const run = state().agentRuns.get(runId)!;
      run.status = 'completed';
      run.finishedAt = new Date();

      // reconnect: everything durable replays from DB, in order; the
      // stream closes after the single terminal event
      const { frames, done } = await collectSse(GET, runId, {
        until: () => false,
        timeoutMs: 3_000,
      });

      const seq: string[] = frames.map((f) => f.type);
      // per toolCall: tool_start precedes tool_end; message before run_finished
      expect(seq.indexOf('tool_start')).toBeLessThan(seq.indexOf('tool_end'));
      expect(seq.indexOf('tool_end')).toBeLessThan(seq.indexOf('message'));
      expect(seq.indexOf('message')).toBeLessThan(seq.indexOf('run_finished'));
      expect(framesOf(frames, 'run_finished').length).toBe(1);
      expect(framesOf(frames, 'run_finished')[0].status).toBe('completed');
      // missing-event behavior: text_delta is not durable — absent from DB replay
      expect(framesOf(frames, 'text_delta').length).toBe(0);
      // stream closed after terminal event
      expect(done).toBe(true);
    },
    10_000
  );
});
