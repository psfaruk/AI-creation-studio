'use client';

// ============================================================
// প্রোডাকশন (Creative Job) স্টোর — zustand।
// - productions: id → ProductionView ম্যাপ
// - SSE সাবস্ক্রিপশন (/api/productions/{id}/events) + পোলিং fallback
// - confirm / cancel / revise অ্যাকশন
// কার্ড ও মনিটর উভয় ভিউ এটি ব্যবহার করে।
// ============================================================

import { create } from 'zustand';
import { toast } from '@/hooks/use-toast';
import type { ProductionEvent, ProductionView } from '@/lib/types';

export const GENERIC_ERROR = 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।';

const POLL_INTERVAL_MS = 2500;
const ACTIVE_STATUSES = new Set(['awaiting_confirmation', 'queued', 'running', 'validating', 'cancelling']);

interface ProductionStore {
  productions: Record<string, ProductionView>;
  /** চলমান সাবস্ক্রিপশন (id → cleanup) — শুধু মডিউল-ভেতরে ব্যবহৃত */
  ensureFetched: (id: string) => Promise<void>;
  subscribe: (id: string) => void;
  applyView: (view: ProductionView) => void;
  confirmProduction: (id: string, specOverrides?: Record<string, unknown>) => Promise<boolean>;
  cancelProduction: (id: string) => Promise<boolean>;
  reviseProduction: (id: string, specOverrides: Record<string, unknown>) => Promise<ProductionView | null>;
}

const g = globalThis as unknown as {
  __productionSubscriptions?: Map<string, () => void>;
};
const subscriptions: Map<string, () => void> = (g.__productionSubscriptions ??= new Map());

export const useProductions = create<ProductionStore>()((set, get) => ({
  productions: {},

  applyView: view =>
    set(state => ({ productions: { ...state.productions, [view.id]: view } })),

  ensureFetched: async id => {
    if (get().productions[id]) return;
    try {
      const res = await fetch(`/api/productions/${id}`);
      if (!res.ok) return;
      const view = (await res.json()) as ProductionView;
      get().applyView(view);
    } catch {
      // নীরব — কার্ডে এরর-স্টেট দেখাবে
    }
  },

  subscribe: id => {
    if (subscriptions.has(id)) return;

    const store = get();
    const current = store.productions[id];
    if (current && !ACTIVE_STATUSES.has(current.status)) return;

    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let finished = false;

    const stopAll = () => {
      stopped = true;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      subscriptions.delete(id);
    };

    // --- লাইভ অগ্রগতি প্রয়োগ ---
    const applyEvent = (evt: ProductionEvent) => {
      if (!('productionId' in evt) || evt.productionId !== id) return;
      const s = useProductions.getState();
      const prev = s.productions[id];
      if (!prev) return;

      switch (evt.type) {
        case 'step_start': {
          const steps = [...prev.steps];
          const idx = steps.findIndex(st => st.id === evt.stepId);
          const stepView = {
            id: evt.stepId,
            seq: evt.seq,
            key: evt.key,
            title: evt.title,
            status: 'running' as const,
          };
          if (idx >= 0) steps[idx] = stepView;
          else steps.push(stepView);
          s.applyView({ ...prev, steps, status: 'running', currentStepKey: evt.key });
          return;
        }
        case 'step_end': {
          const steps = prev.steps.map(st =>
            st.id === evt.stepId
              ? {
                  ...st,
                  status: evt.status,
                  detail: evt.detail ?? st.detail,
                  error: evt.error ?? st.error,
                  durationMs: evt.durationMs ?? st.durationMs,
                }
              : st
          );
          s.applyView({ ...prev, steps });
          return;
        }
        case 'production_progress': {
          s.applyView({ ...prev, progress: evt.progress, currentStepKey: evt.currentStepKey ?? prev.currentStepKey });
          return;
        }
        case 'production_finished': {
          finished = true;
          // সার্ভার-সত্য দিয়ে চূড়ান্ত রিফ্রেশ
          void (async () => {
            try {
              const res = await fetch(`/api/productions/${id}`);
              if (res.ok) {
                const view = (await res.json()) as ProductionView;
                useProductions.getState().applyView(view);
              }
            } catch {
              // নীরব
            }
          })();
          stopAll();
          return;
        }
        default:
          return;
      }
    };

    // --- SSE ---
    try {
      const es = new EventSource(`/api/productions/${id}/events`);
      const cleanup = () => {
        es.close();
        stopAll();
      };
      subscriptions.set(id, cleanup);
      es.onmessage = e => {
        if (finished) return;
        try {
          applyEvent(JSON.parse(e.data) as ProductionEvent);
        } catch {
          // উপেক্ষা
        }
      };
      for (const name of ['production_started', 'step_start', 'step_end', 'production_progress', 'production_finished']) {
        es.addEventListener(name, (e) => {
          if (finished) return;
          try {
            applyEvent(JSON.parse((e as MessageEvent).data) as ProductionEvent);
          } catch {
            // উপেক্ষা
          }
        });
      }
      es.onerror = () => {
        if (finished) {
          cleanup();
          return;
        }
        // SSE ছিঁড়েছে → পোলিং fallback
        es.close();
        subscriptions.delete(id);
        if (pollTimer) return;
        pollTimer = setInterval(async () => {
          if (finished) {
            if (pollTimer) clearInterval(pollTimer);
            return;
          }
          try {
            const res = await fetch(`/api/productions/${id}`);
            if (!res.ok) return;
            const view = (await res.json()) as ProductionView;
            useProductions.getState().applyView(view);
            if (!ACTIVE_STATUSES.has(view.status)) {
              finished = true;
              if (pollTimer) clearInterval(pollTimer);
              subscriptions.delete(id);
            }
          } catch {
            // নীরব
          }
        }, POLL_INTERVAL_MS);
      };
    } catch {
      // EventSource অসমর্থিত → শুধু পোলিং
      pollTimer = setInterval(async () => {
        if (finished) {
          if (pollTimer) clearInterval(pollTimer);
          return;
        }
        try {
          const res = await fetch(`/api/productions/${id}`);
          if (!res.ok) return;
          const view = (await res.json()) as ProductionView;
          useProductions.getState().applyView(view);
          if (!ACTIVE_STATUSES.has(view.status)) {
            finished = true;
            if (pollTimer) clearInterval(pollTimer);
          }
        } catch {
          // নীরব
        }
      }, POLL_INTERVAL_MS);
    }
  },

  confirmProduction: async (id, specOverrides) => {
    try {
      const res = await fetch(`/api/productions/${id}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: specOverrides ?? {} }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string[] };
        toast({
          title: data.error ?? 'নিশ্চিত করা যায়নি',
          description: data.details?.join('; '),
          variant: 'destructive',
        });
        return false;
      }
      const view = (await res.json()) as ProductionView;
      get().applyView(view);
      get().subscribe(id);
      return true;
    } catch {
      toast({ title: GENERIC_ERROR, variant: 'destructive' });
      return false;
    }
  },

  cancelProduction: async id => {
    try {
      const res = await fetch(`/api/productions/${id}/cancel`, { method: 'POST' });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: data.error ?? 'বাতিল করা যায়নি', variant: 'destructive' });
        return false;
      }
      const data = await res.json();
      if (data && typeof data === 'object' && 'id' in data) {
        get().applyView(data as ProductionView);
      } else {
        // cancelling — পোলিং চালু রাখো
        get().subscribe(id);
      }
      return true;
    } catch {
      toast({ title: GENERIC_ERROR, variant: 'destructive' });
      return false;
    }
  },

  reviseProduction: async (id, specOverrides) => {
    try {
      const res = await fetch(`/api/productions/${id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spec: specOverrides }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast({ title: data.error ?? 'সংশোধন-প্রস্তাব তৈরি করা যায়নি', variant: 'destructive' });
        return null;
      }
      const view = (await res.json()) as ProductionView;
      get().applyView(view);
      return view;
    } catch {
      toast({ title: GENERIC_ERROR, variant: 'destructive' });
      return null;
    }
  },
}));
