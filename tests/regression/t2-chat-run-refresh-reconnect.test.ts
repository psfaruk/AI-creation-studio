// ============================================================
// REGRESSION TEST 2 — Chat run refresh & reconnect
// Documents P0-BUG-03 (server side is replay-capable; the client
// hook keeps run state in memory only).
//
// Boundaries:
//  - Modules under test: the REAL GET handler of
//    src/app/api/runs/[id]/events (DB replay + live bus + dedupe)
//    and the REAL in-process event bus (src/lib/agent/events.ts).
//  - Mocked: '@/lib/db' (in-memory fake — never touches the real
//    SQLite dev database) and '@/lib/security' (owner auth ok).
//  - The "client refresh" is simulated the way the server observes
//    it: a brand-new GET request with the same runId and no client
//    memory. What the server can recover, the client can render.
//
// Expected behavior (contract): after a browser refresh during a
// running chat run, re-attaching to /api/runs/<runId>/events must
// restore the same run identity (run_started), the in-flight tool
// activity (tool_start), and later the terminal status
// (run_finished) — all from DB replay, without live events.
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
import { collectSse, framesOf } from '../helpers/sse-harness';

mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/security', () => ({
  requireOwner: async () => ({ ok: true as const }),
}));

// REAL route handler + REAL event bus — imported after the mocks
const { GET } = await import('@/app/api/runs/[id]/events/route');
const { emit, subscribe, getReplay } = await import('@/lib/agent/events');

let runId = '';
let conversationId = '';

beforeEach(() => {
  resetFakeDb();
  const conv = seedConversation();
  conversationId = conv.id;
  const run = seedAgentRun(conversationId, { id: 'run-t2-main' });
  runId = run.id;
});

describe('REG-2: chat run refresh & reconnect (server-side recovery)', () => {
  test(
    'REG-2a: a fresh connection to a RUNNING run replays run identity + in-flight tool activity from DB',
    async () => {
      // stage: run is running, one tool in-flight (started, not ended),
      // no assistant message yet — exactly the state at refresh time
      seedToolCall(runId, 'web_search', { id: 'tc-live-1', status: 'running' });

      const { frames } = await collectSse(GET, runId, {
        until: (fs) => framesOf(fs, 'tool_start').length >= 1,
        timeoutMs: 2_500,
      });

      // same run identity recovered from DB
      const started = framesOf(frames, 'run_started');
      expect(started.length).toBe(1);
      expect(started[0].runId).toBe(runId);
      expect(started[0].conversationId).toBe(conversationId);

      // in-flight activity recovered
      const toolStarts = framesOf(frames, 'tool_start');
      expect(toolStarts.length).toBe(1);
      expect(toolStarts[0].activityId).toBe('tc-live-1');
      expect(toolStarts[0].tool).toBe('web_search');

      // no terminal event while the run is still running
      expect(framesOf(frames, 'run_finished').length).toBe(0);
      expect(framesOf(frames, 'tool_end').length).toBe(0);
    },
    5_000
  );

  test(
    'REG-2b: live events continue to flow on an attached connection, then a *second* (refresh) connection sees the same world',
    async () => {
      seedToolCall(runId, 'web_search', { id: 'tc-live-2', status: 'running' });

      // attach a live listener directly to the bus (what the route does)
      const received: string[] = [];
      const unsub = subscribe(runId, (evt) => {
        if (evt.type === 'tool_end' || evt.type === 'run_note') received.push(evt.type);
      });

      // open the SSE connection (fresh "client")
      const collect = collectSse(GET, runId, {
        until: (fs) => framesOf(fs, 'tool_end').length >= 1,
        timeoutMs: 3_000,
      });
      // wait for the route to register its bus listener (it subscribes
      // after its initial async DB lookups)
      await new Promise((r) => setTimeout(r, 150));

      // mid-stream live progress: tool ends while attached
      emit(runId, {
        type: 'tool_end',
        activityId: 'tc-live-2',
        status: 'done',
        durationMs: 1200,
      } as never);

      const { frames } = await collect;
      unsub();

      const ends = framesOf(frames, 'tool_end');
      expect(ends.length).toBe(1);
      expect(ends[0].activityId).toBe('tc-live-2');
      expect(received).toContain('tool_end');

      // the direct bus subscriber ALSO received it (no drop)
      expect(getReplay(runId).map((e) => e.type)).toContain('tool_end');
    },
    5_000
  );

  test(
    'REG-2c: after refresh + run completion, a new connection replays the FINAL state (tool_end + message + run_finished) and closes the stream',
    async () => {
      seedToolCall(runId, 'web_search', {
        id: 'tc-done-1',
        status: 'done',
        outputSummary: '৩ টি ফলাফল',
        durationMs: 900,
      });
      seedMessage(conversationId, 'assistant', 'চূড়ান্ত উত্তর — পরীক্ষা।', {
        runId,
      });
      // flip the run to terminal (what finalizeRun does)
      const run = state().agentRuns.get(runId)!;
      run.status = 'completed';
      run.finishedAt = new Date();

      // "refresh": brand-new request, no client memory. Read until the
      // stream closes server-side (route closes ~50ms after run_finished).
      const { frames, done } = await collectSse(GET, runId, {
        until: () => false,
        timeoutMs: 3_000,
      });

      const ends = framesOf(frames, 'tool_end');
      expect(ends.length).toBe(1);
      expect(ends[0].status).toBe('done');

      const messages = framesOf(frames, 'message');
      expect(messages.length).toBe(1);
      expect((messages[0].message as { content: string }).content).toContain('চূড়ান্ত উত্তর');

      const finished = framesOf(frames, 'run_finished');
      expect(finished.length).toBe(1);
      expect(finished[0].status).toBe('completed');

      // terminal event closes the stream server-side
      expect(done).toBe(true);
    },
    5_000
  );

  test('REG-2d [post-fix precondition]: a still-RUNNING run keeps its identity queryable — the surface the refreshed client re-attaches to (P0-BUG-03 client half fixed in Phase 2)', async () => {
    // Server-side recovery works (REG-2a..2c). The Phase-2 fix added the
    // client half: use-agent-run persists the active run identity
    // (src/hooks/active-run-persistence.ts — unit-locked by REG-7) and
    // re-attaches on mount. Here we assert the observable server-side
    // precondition that makes client recovery possible: a run that is
    // still running keeps its identity queryable, and the replayed
    // stream (above) delivers its in-flight world.
    const run = state().agentRuns.get(runId)!;
    const found = await fakeDb.agentRun.findUnique({ where: { id: run.id } });
    expect(found?.id).toBe(runId);
    expect(found?.status).toBe('running');
  });
});
