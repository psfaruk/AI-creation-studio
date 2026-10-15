// ============================================================
// REGRESSION TEST 3 — Duplicate submission (idempotency guard)
// P0-BUG-03 duplicate-run half — FIXED in Phase 2.
//
// Boundaries:
//  - Module under test: the REAL POST handler of /api/chat
//    (src/app/api/chat/route.ts) — active-run guard, conversation
//    resolution, user-message creation, and AgentRun creation.
//  - Mocked:
//      '@/lib/db'            → in-memory fake (no dev DB writes)
//      '@/lib/security'      → owner auth ok
//      '@/lib/agent/orchestrator' → startAgentRun recorded noop
//      '@/lib/agent/storage' → saveArtifactFile throws (no attachments
//                              are sent, so it must not be called)
//  - No network, no LLM, no tool execution.
//
// Enforced contract (Phase 2): while a run for the same conversation
// is still `running`, a new submission is rejected with 409 and the
// activeRunId in the body (so the client can re-attach to the live
// run instead of creating a duplicate concurrent one). The guard
// runs BEFORE user-message creation (a rejected submission never
// pollutes the conversation), clears on terminal state, and is
// strictly per-conversation.
//
// Pre-fix evidence (phase-1 commit): both submissions returned 200
// with distinct runIds — two concurrent 'running' rows per
// conversation (asserted by the pre-fix REG-3a, preserved in git
// history).
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
  test('REG-3a [ENFORCED CONTRACT — P0-BUG-03 fixed in Phase 2]: an active run rejects a new submission with 409 + activeRunId — no second run, no stray user message', async () => {
    const conv = seedConversation('conv-dup');
    // an active run already exists (e.g. the user refreshed and the
    // client lost isRunActive — the pre-fix P0-BUG-03 scenario)
    seedAgentRun(conv.id, { id: 'run-active-1', status: 'running' });

    const userMsgCountBefore = await fakeDb.message.count({
      where: { conversationId: conv.id, role: 'user' },
    });

    const res = await POST(chatRequest(conv.id, 'একই অনুরোধ — দ্বিতীয় পাঠ'));
    expect(res.status).toBe(409);

    const body = (await res.json()) as { error?: unknown; activeRunId?: unknown; conversationId?: unknown };
    // the body hands back the LIVE run so the client can re-attach
    expect(body.activeRunId).toBe('run-active-1');
    expect(body.conversationId).toBe(conv.id);
    expect(typeof body.error).toBe('string');

    // no second run was created and the orchestrator never started
    expect(fakeDb.__agentRunCreateCalls().length).toBe(0);
    expect(startAgentRunCalls.length).toBe(0);
    // the rejected submission did not pollute the conversation
    expect(await fakeDb.message.count({ where: { conversationId: conv.id, role: 'user' } })).toBe(
      userMsgCountBefore
    );
  });

  test('REG-3b: rapid double-submit in the same tab creates at most ONE run (409 guard or 429 burst limiter — never a second run)', async () => {
    const conv = seedConversation('conv-burst');
    const first = await POST(chatRequest(conv.id, 'বার্তা'));
    expect(first.status).toBe(200);
    expect(fakeDb.__agentRunCreateCalls().length).toBe(1);
    expect(startAgentRunCalls.length).toBe(1);

    // immediate second submission, same conversation, same client IP —
    // whichever guard fires first (per-IP burst limiter vs active-run
    // guard), the invariant is the same: no second run
    const second = await POST(chatRequest(conv.id, 'আরেকটি বার্তা'));
    if (second.status === 409) {
      const body = (await second.json()) as { activeRunId?: unknown };
      expect(typeof body.activeRunId).toBe('string');
      expect(fakeDb.__agentRunCreateCalls().length).toBe(1);
    } else {
      expect(second.status).toBe(429);
      expect(fakeDb.__agentRunCreateCalls().length).toBe(1);
    }
    expect(startAgentRunCalls.length).toBe(1);
  });

  test('REG-3c: submission to a non-existent conversation is rejected 404 (input validation works independently of the guard)', async () => {
    const res = await POST(chatRequest('conv-does-not-exist', 'কোথায় এই কথোপকথন?'));
    expect(res.status).toBe(404);
    expect(fakeDb.__agentRunCreateCalls().length).toBe(0);
    expect(startAgentRunCalls.length).toBe(0);
  });

  test('REG-3d: the guard CLEARS on terminal state — after the run completes, a new submission is accepted (200 + new runId)', async () => {
    const conv = seedConversation('conv-terminal');
    const run = seedAgentRun(conv.id, { id: 'run-now-done', status: 'running' });

    // the run reaches a terminal state
    await fakeDb.agentRun.update({ where: { id: run.id }, data: { status: 'completed' } });

    const res = await POST(chatRequest(conv.id, 'নতুন বার্তা — রান শেষ হওয়ার পরে'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { runId: string; conversationId: string };
    expect(data.conversationId).toBe(conv.id);
    expect(data.runId).not.toBe('run-now-done');
    expect(fakeDb.__agentRunCreateCalls().length).toBe(1);
    expect(startAgentRunCalls.length).toBe(1);
  });

  test('REG-3e: the guard is per-conversation — another conversation has a running run, but this conversation can still submit', async () => {
    const convA = seedConversation('conv-with-active-run');
    const convB = seedConversation('conv-free');
    seedAgentRun(convA.id, { id: 'run-elsewhere', status: 'running' });

    const res = await POST(chatRequest(convB.id, 'অন্য কথোপকথনের বার্তা'));
    expect(res.status).toBe(200);
    const data = (await res.json()) as { runId: string; conversationId: string };
    expect(data.conversationId).toBe(convB.id);
    expect(data.runId).not.toBe('run-elsewhere');
    expect(fakeDb.__agentRunCreateCalls().length).toBe(1);
  });
});
