// ============================================================
// Production event bus — প্রোডাকশনের লাইভ অগ্রগতি (SSE উৎস)।
// AgentRun-এর bus-এর আদলে, আলাদা namespace-এ (productionId-keyed)।
// ============================================================

import type { ProductionEvent } from '@/lib/types';

type Listener = (event: ProductionEvent) => void;

const g = globalThis as unknown as {
  __productionEventBus?: Map<string, Set<Listener>>;
  __productionReplayBuffers?: Map<string, ProductionEvent[]>;
  __productionFinished?: Set<string>;
};

const bus: Map<string, Set<Listener>> = (g.__productionEventBus ??= new Map());
const replayBuffers: Map<string, ProductionEvent[]> = (g.__productionReplayBuffers ??= new Map());
const finished: Set<string> = (g.__productionFinished ??= new Set());

const REPLAY_LIMIT = 200;
const GRACE_MS = 120_000;

function maybeCleanup(productionId: string): void {
  const listeners = bus.get(productionId);
  if (finished.has(productionId) && (!listeners || listeners.size === 0)) {
    bus.delete(productionId);
    replayBuffers.delete(productionId);
    finished.delete(productionId);
  }
}

/** প্রোডাকশনের সব লাইভ শ্রোতাকে ইভেন্ট পাঠাও + replay buffer-এ রাখো */
export function emitProduction(productionId: string, event: ProductionEvent): void {
  const listeners = bus.get(productionId);
  if (listeners && listeners.size > 0) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error('[production-events] listener error', err);
      }
    }
  }
  const buf = replayBuffers.get(productionId);
  if (buf) {
    buf.push(event);
    if (buf.length > REPLAY_LIMIT) buf.splice(0, buf.length - REPLAY_LIMIT);
  }
  if (event.type === 'production_finished') {
    finished.add(productionId);
    setTimeout(() => maybeCleanup(productionId), GRACE_MS);
  }
}

/** লাইভ ইভেন্টে সাবস্ক্রাইব — unsubscribe ফাংশন দেয় */
export function subscribeProduction(productionId: string, listener: Listener): () => void {
  let listeners = bus.get(productionId);
  if (!listeners) {
    listeners = new Set();
    bus.set(productionId, listeners);
    if (!replayBuffers.has(productionId)) replayBuffers.set(productionId, []);
  }
  listeners.add(listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
    if (listeners.size === 0) {
      bus.delete(productionId);
      maybeCleanup(productionId);
    }
  };
}

/** replay buffer-এর কপি (SSE রিপ্লে-এর জন্য) */
export function getProductionReplay(productionId: string): ProductionEvent[] {
  return [...(replayBuffers.get(productionId) ?? [])];
}
