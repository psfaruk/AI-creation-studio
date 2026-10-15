// ============================================================
// REGRESSION TEST 7 — Client run re-attach (P0-BUG-03 client half)
// Phase 2 fix verification.
//
// The fix has two halves:
//  (a) SERVER (REG-2/REG-4, already green): the SSE route replays
//      run identity, in-flight tools, final message and terminal
//      state from the DB for ANY late connector — the ready-made
//      recovery surface.
//  (b) CLIENT (this file): run identity must SURVIVE a page reload
//      and drive a re-attach on mount. The persistence helpers live
//      in src/hooks/active-run-persistence.ts — deliberately
//      React-free so they can be unit-tested here with a fake
//      localStorage. The EventSource wiring itself (use-agent-run)
//      is typechecked + source-verified; driving a real DOM is out
//      of scope for this suite (no RTL dependency — see
//      tests/README.md "Hermetic-ness caveats").
//
// Boundaries: no React import, no DOM, no network, no DB. The fake
// storage is installed on globalThis.window before importing the
// module (the helpers read window.localStorage at CALL time, guarded).
// ============================================================

import { describe, expect, test, beforeEach } from 'bun:test';

// ---- fake localStorage (installed before the module import) ----
const fakeStore = new Map<string, string>();
const fakeStorage: Storage = {
  get length() {
    return fakeStore.size;
  },
  clear: () => fakeStore.clear(),
  getItem: (k: string) => fakeStore.get(k) ?? null,
  key: (i: number) => [...fakeStore.keys()][i] ?? null,
  removeItem: (k: string) => {
    fakeStore.delete(k);
  },
  setItem: (k: string, v: string) => {
    fakeStore.set(k, v);
  },
};
(globalThis as unknown as { window: { localStorage: Storage } }).window = {
  localStorage: fakeStorage,
};

// module under test — React-free by design
const {
  saveActiveRun,
  readActiveRun,
  clearActiveRun,
  shouldReattach,
  ACTIVE_RUN_STALE_MS,
} = await import('@/hooks/active-run-persistence');

const NOW = 1_700_000_000_000;

function seedEntry(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-reattach-1',
    conversationId: 'conv-reattach',
    userMessageId: 'msg-user-1',
    savedAt: NOW,
    ...overrides,
  };
}

beforeEach(() => {
  fakeStore.clear();
});

describe('REG-7: client run re-attach (P0-BUG-03 client half)', () => {
  test('REG-7a: save → read round-trip preserves run identity', () => {
    saveActiveRun(seedEntry());
    const entry = readActiveRun(NOW + 1000);
    expect(entry).not.toBeNull();
    expect(entry!.runId).toBe('run-reattach-1');
    expect(entry!.conversationId).toBe('conv-reattach');
    expect(entry!.userMessageId).toBe('msg-user-1');
    expect(entry!.savedAt).toBe(NOW);
  });

  test('REG-7b: clearActiveRun(runId) removes only the matching entry — another run survives', () => {
    saveActiveRun(seedEntry());
    // a DIFFERENT runId must not clear the entry (two-tab safety)
    clearActiveRun('run-someone-elses');
    expect(readActiveRun(NOW + 1000)).not.toBeNull();
    // the matching runId clears it
    clearActiveRun('run-reattach-1');
    expect(readActiveRun(NOW + 1000)).toBeNull();
  });

  test('REG-7c: readActiveRun returns null for absent / malformed / incomplete / stale entries — never throws', () => {
    // absent
    expect(readActiveRun(NOW)).toBeNull();
    // malformed JSON
    fakeStorage.setItem('agentic-active-run', '{not json');
    expect(readActiveRun(NOW)).toBeNull();
    // incomplete entry (missing conversationId)
    fakeStorage.setItem(
      'agentic-active-run',
      JSON.stringify({ runId: 'r', savedAt: NOW })
    );
    expect(readActiveRun(NOW)).toBeNull();
    // missing savedAt → treated as stale/invalid
    fakeStorage.setItem(
      'agentic-active-run',
      JSON.stringify({ runId: 'r', conversationId: 'c' })
    );
    expect(readActiveRun(NOW)).toBeNull();
    // stale: older than the 12-minute cutoff (server sweep = 10 min)
    saveActiveRun(seedEntry());
    expect(readActiveRun(NOW + ACTIVE_RUN_STALE_MS + 1)).toBeNull();
    // still fresh just inside the cutoff
    expect(readActiveRun(NOW + ACTIVE_RUN_STALE_MS - 1)).not.toBeNull();
  });

  test('REG-7d: shouldReattach is true ONLY for a fresh entry of the CURRENT conversation', () => {
    const entry = seedEntry();
    // matching conversation + fresh
    expect(shouldReattach(entry, 'conv-reattach', NOW + 1000)).toBe(true);
    // null entry
    expect(shouldReattach(null, 'conv-reattach', NOW + 1000)).toBe(false);
    // different conversation (user switched)
    expect(shouldReattach(entry, 'conv-other', NOW + 1000)).toBe(false);
    // no conversation open
    expect(shouldReattach(entry, null, NOW + 1000)).toBe(false);
    expect(shouldReattach(entry, undefined, NOW + 1000)).toBe(false);
    // stale entry (survived the sweep window — server already interrupted it)
    expect(shouldReattach(entry, 'conv-reattach', NOW + ACTIVE_RUN_STALE_MS + 1)).toBe(false);
  });

  test('REG-7e: a missing localStorage degrades silently — no throw, null reads, no-op writes', () => {
    const g = globalThis as unknown as { window?: { localStorage: Storage } };
    const savedWindow = g.window;
    delete g.window; // simulate non-browser (or blocked storage)

    expect(readActiveRun(NOW)).toBeNull();
    expect(() => saveActiveRun(seedEntry())).not.toThrow();
    expect(() => clearActiveRun('run-reattach-1')).not.toThrow();
    expect(shouldReattach(seedEntry(), 'conv-reattach', NOW)).toBe(true); // pure logic still works

    g.window = savedWindow;
  });

  test('REG-7f: userMessageId degrades to "" when absent (older/partial entry shape)', () => {
    // the 409-reattach path in use-agent-run may persist without a
    // userMessageId; the reader must not choke and must default it
    fakeStorage.setItem(
      'agentic-active-run',
      JSON.stringify({ runId: 'r2', conversationId: 'conv-reattach', savedAt: NOW })
    );
    const entry = readActiveRun(NOW + 500);
    expect(entry).not.toBeNull();
    expect(entry!.userMessageId).toBe('');
    expect(entry!.runId).toBe('r2');
  });
});
