// ============================================================
// REGRESSION TEST 3 — Duplicate submission
// Documents the duplicate-active-run half of P0-BUG-03.
//
// Boundaries:
//  - Module under test: the REAL POST handler of /api/chat
//    (src/app/api/chat/route.ts) — conversation resolution, user
//    message creation, and (unconditional) AgentRun creation.
//  - Mocked:
//      '@/lib/db'            → in-memory fake (no dev DB writes)
//      '@/lib/security'      → owner auth ok
//      '@/lib/agent/orchestrator' → startAgentRun recorded noop
//      '@/lib/agent/storage' → saveArtifactFile noop (no attachments
//                              are sent, so it must not be called)
//  - No network, no LLM, no tool execution.
//
// Question: can the same logical request be submitted twice while
// an active run exists, creating duplicate concurrent runs?
//
// Current behavior (CONFIRMED by this test): YES — POST /api/chat
// creates a new AgentRun unconditionally; the only duplicate guard
// is the client-side in-memory isRunActive flag, which a refresh
// or a second tab does not share.
//
// Expected idempotency contract (recorded, NOT enforced in
// Phase 1): while a run for the same conversation is still
// `running`, a new submission should be rejected (409) or
// deduplicated until the active run reaches a terminal state.
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { fakeDb, resetFakeDb, seedConversation, seedAgentRun } from '../helpers/fake-db';

const startAgentRunCalls: string[] = [];

mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/security', () => ({
  requireOwner: async () => ({ ok: true as const }),
}));
mock.module('@/lib/agent/orchestrator', () => ({
  startAgentRun: (id: string) => {
    startAgentRunCalls.push(id);
  },
}));
mock.module('@/lib/agent/storage', () => ({
  saveArtifactFile: async () => {
    throw new Error('no attachments are sent in this test — saveArtifactFile must not run');
  },
}));

// REAL chat route handler — imported after the mocks
const { POST } = await import('@/app/api/chat/route');

function chatRequest(conversationId: string, content: string): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ conversationId, content }),
  });
}

beforeEach(() => {
  resetFakeDb();
  startAgentRunCalls.length = 0;
});

describe('REG-3: duplicate submission of the same logical request', () => {
  test('REG-3a [current behavior, CONFIRMED]: two identical submissions both create ACTIVE runs — no server-side idempotency guard', async () => {
    const conv = seedConversation('conv-dup');
    // an active run already exists (e.g. the user refreshed and the
    // client lost isRunActive — the P0-BUG-03 scenario)
    seedAgentRun(conv.id, { id: 'run-active-1', status: 'running' });

    const res1 = await POST(chatRequest(conv.id, 'একই অনুরোধ — প্রথম পাঠ'));
    expect(res1.status).toBe(200);
    const data1 = (await res1.json()) as { runId: string; conversationId: string };
    expect(data1.conversationId).toBe(conv.id);

    const res2 = await POST(chatRequest(conv.id, 'একই অনুরোধ — দ্বিতীয় পাঠ'));
    expect(res2.status).toBe(200);
    const data2 = (await res2.json()) as { runId: string; conversationId: string };

    // Two DISTINCT runs now exist for the same conversation — the
    // pre-existing one plus the second submission. Nothing rejected
    // or deduplicated the request.
    expect(data2.runId).not.toBe(data1.runId);
    expect(data2.runId).not.toBe('run-active-1');

    const createCalls = fakeDb.__agentRunCreateCalls();
    expect(createCalls.length).toBe(2);
    expect(createCalls.every((c) => c.status === 'running')).toBe(true);
    expect(startAgentRunCalls.length).toBe(2);

    // Expected contract (future): the second submission should be
    // rejected with 409 while run-active-1 is still running. Until
    // then this documents the data-integrity risk.
  });

  test('REG-3b: rapid double-submit in the same tab is throttled only by the burst rate limiter (not by run state)', async () => {
    const conv = seedConversation('conv-burst');
    const first = await POST(chatRequest(conv.id, 'বার্তা'));
    expect(first.status).toBe(200);
    // immediate second message, same conversation, same client IP —
    // the per-IP sliding-window limiter may throttle for volume, but
    // there is no active-run check; if the limiter window is large
    // enough this still goes through. Both outcomes are recorded.
    const second = await POST(chatRequest(conv.id, 'আরেকটি বার্তা'));
    if (second.status === 200) {
      const data = (await second.json()) as { runId: string };
      const createCalls = fakeDb.__agentRunCreateCalls();
      expect(createCalls.length).toBe(2);
      expect(data.runId).toBeTruthy();
    } else {
      // rate-limited (429) — duplicate-run behavior unconstrained by it
      expect(second.status).toBe(429);
      expect(fakeDb.__agentRunCreateCalls().length).toBe(1);
    }
  });

  test('REG-3c: submission to a non-existent conversation is rejected 404 (input validation works independently of the gap)', async () => {
    const res = await POST(chatRequest('conv-does-not-exist', 'কোথায় এই কথোপকথন?'));
    expect(res.status).toBe(404);
    expect(fakeDb.__agentRunCreateCalls().length).toBe(0);
    expect(startAgentRunCalls.length).toBe(0);
  });
});
