// ============================================================
// In-process event bus for live run progress (SSE-এর উৎস)।
// Map<runId, Set<listener>> + ছোট replay buffer (শেষ ১০০টি ইভেন্ট)।
// HMR-এর কারণে নতুন module instance হলেও globalThis-এ অবস্থান টিকে থাকে।
// ============================================================

import type { RunEvent } from '@/lib/types';

type Listener = (event: RunEvent) => void;

const g = globalThis as unknown as {
  __agentEventBus?: Map<string, Set<Listener>>;
  __agentReplayBuffers?: Map<string, RunEvent[]>;
  __agentFinishedRuns?: Set<string>;
};

const bus: Map<string, Set<Listener>> = (g.__agentEventBus ??= new Map());
const replayBuffers: Map<string, RunEvent[]> = (g.__agentReplayBuffers ??= new Map());
const finishedRuns: Set<string> = (g.__agentFinishedRuns ??= new Set());

const REPLAY_LIMIT = 100;
/** রান শেষ হওয়ার পর কতক্ষণ পর্যন্ত buffer রাখা হবে (late-subscriber drain) */
const FINISHED_GRACE_MS = 60_000;

function maybeCleanup(runId: string): void {
  const listeners = bus.get(runId);
  if (finishedRuns.has(runId) && (!listeners || listeners.size === 0)) {
    bus.delete(runId);
    replayBuffers.delete(runId);
    finishedRuns.delete(runId);
  }
}

/** Emit an event to all live listeners of a run + append to the replay buffer. */
export function emit(runId: string, event: RunEvent): void {
  const listeners = bus.get(runId);
  if (listeners && listeners.size > 0) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error('[agent-events] listener error', err);
      }
    }
  }
  const buf = replayBuffers.get(runId);
  if (buf) {
    buf.push(event);
    if (buf.length > REPLAY_LIMIT) buf.splice(0, buf.length - REPLAY_LIMIT);
  }
  if (event.type === 'run_finished') {
    finishedRuns.add(runId);
    // সাবস্ক্রাইবাররা drain করার সুযোগ পায়, তারপর পরিষ্কার করা হয়
    setTimeout(() => maybeCleanup(runId), FINISHED_GRACE_MS);
  }
}

/** Subscribe to live events of a run. Returns an unsubscribe function. */
export function subscribe(runId: string, listener: Listener): () => void {
  let listeners = bus.get(runId);
  if (!listeners) {
    listeners = new Set();
    bus.set(runId, listeners);
    if (!replayBuffers.has(runId)) replayBuffers.set(runId, []);
  }
  listeners.add(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
    if (listeners.size === 0) {
      bus.delete(runId);
      maybeCleanup(runId);
    }
  };
}

/** Copy of the replay buffer (last 100 events) — for diagnostics / late join. */
export function getReplay(runId: string): RunEvent[] {
  return [...(replayBuffers.get(runId) ?? [])];
}
