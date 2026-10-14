// GET /api/productions/[id]/events — SSE লাইভ অগ্রগতি
// (রিপ্লে → লাইভ bus → DB diff-poll fallback, run-events-এর আদলে)
import { db } from '@/lib/db';
import { requireOwner } from '@/lib/security';
import { subscribeProduction, getProductionReplay } from '@/lib/agent/production/bus';
import { toProductionView } from '@/lib/agent/production/serialize';
import { videoProviderStatus } from '@/lib/agent/video/ai_video';
import type { ProductionEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PING_MS = 15_000;
const POLL_MS = 2_500;
const MAX_LIVE_MS = 60 * 60 * 1000; // ১ ঘণ্টা

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // SSE (EventSource) — কুকি ছাড়া ?st= টোকেনও চলে
  const auth = await requireOwner(req, { allowQueryToken: true });
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const production = await db.production.findUnique({ where: { id } });
  if (!production) {
    return new Response('not found', { status: 404 });
  }
  // §2-B: ভিডিও-ধর্মী প্রোডাকশনে ক্লাউড-প্রোভাইডারের সৎ স্ট্যাটাস টিকে টিকে যায়
  const isVideoProviderType = ['motion_video', 'music_video', 'short_film'].includes(production.type);

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let lastEventAt = Date.now();
  const sentStepIds = new Set<string>();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let tickCount = 0;
      const send = (event: ProductionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          lastEventAt = Date.now();
        } catch {
          closed = true;
        }
      };
      const sendNamed = (event: ProductionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
          );
          lastEventAt = Date.now();
        } catch {
          closed = true;
        }
      };

      // ---- ১. DB থেকে রিপ্লে (আজ পর্যন্ত ঘটে যাওয়া ইভেন্ট) ----
      const replayFromDb = async () => {
        const fresh = await db.production.findUnique({
          where: { id },
          include: { steps: { orderBy: { seq: 'asc' } }, artifacts: true },
        });
        if (!fresh) return;
        send({ type: 'production_started', productionId: id });
        for (const step of fresh.steps) {
          if (step.status === 'pending') continue;
          send({
            type: 'step_start',
            productionId: id,
            stepId: step.id,
            seq: step.seq,
            key: step.key,
            title: step.title,
          });
          sentStepIds.add(step.id);
          if (step.status !== 'running') {
            send({
              type: 'step_end',
              productionId: id,
              stepId: step.id,
              key: step.key,
              status: step.status === 'done' ? 'done' : step.status === 'skipped' ? 'skipped' : 'failed',
              detail: step.detail ?? undefined,
              error: step.error ?? undefined,
            });
          }
        }
        send({ type: 'production_progress', productionId: id, progress: fresh.progress, currentStepKey: fresh.currentStepKey ?? undefined });
      };
      await replayFromDb();

      const current = await db.production.findUnique({ where: { id } });
      const isTerminal = (s: string) => ['completed', 'failed', 'partial', 'cancelled'].includes(s);

      if (current && isTerminal(current.status)) {
        send({
          type: 'production_finished',
          productionId: id,
          status: current.status as any,
          error: current.error ?? undefined,
        });
        closed = true;
        try {
          controller.close();
        } catch {
          // ইতিমধ্যে বন্ধ
        }
        return;
      }

      // ---- ২. লাইভ bus ----
      const unsubscribe = subscribeProduction(id, event => {
        send(event);
        sendNamed(event);
        if (event.type === 'production_finished') {
          closed = true;
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // উপেক্ষা
            }
          }, 100);
        }
      });

      // রিপ্লে-buffer-এ থাকা ইভেন্ট যেগুলো DB-রিপ্লেতে যায়নি
      for (const evt of getProductionReplay(id)) {
        if (evt.type === 'step_start' && sentStepIds.has(evt.stepId)) continue;
        send(evt);
      }

      // ---- ৩. ping + DB diff-poll (SSE ছিঁড়লে ক্লায়েন্ট পুনঃসংযোগ করবে) ----
      const pingTimer = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastEventAt > PING_MS - 1) send({ type: 'ping' });
      }, PING_MS);

      const pollTimer = setInterval(async () => {
        if (closed) return;
        // §2-B: প্রোভাইডার-স্ট্যাটাস টিক (~৫ সে. অন্তর) — ব্যস্ত/কুলডাউন/মুক্ত
        if (isVideoProviderType && tickCount++ % 2 === 0) {
          send({ type: 'provider_status', productionId: id, provider: videoProviderStatus() });
        }
        try {
          const fresh = await db.production.findUnique({
            where: { id },
            include: { steps: { orderBy: { seq: 'asc' } } },
          });
          if (!fresh) return;
          // নতুন/বদলে-যাওয়া ধাপ
          for (const step of fresh.steps) {
            if (step.status === 'pending') continue;
            if (!sentStepIds.has(step.id)) {
              sentStepIds.add(step.id);
              send({ type: 'step_start', productionId: id, stepId: step.id, seq: step.seq, key: step.key, title: step.title });
              if (step.status !== 'running') {
                send({
                  type: 'step_end',
                  productionId: id,
                  stepId: step.id,
                  key: step.key,
                  status: step.status === 'done' ? 'done' : step.status === 'skipped' ? 'skipped' : 'failed',
                  detail: step.detail ?? undefined,
                  error: step.error ?? undefined,
                });
              }
            }
          }
          if (isTerminal(fresh.status)) {
            send({ type: 'production_finished', productionId: id, status: fresh.status as any, error: fresh.error ?? undefined });
          }
        } catch {
          // উপেক্ষা
        }
        if (Date.now() - startedAt > MAX_LIVE_MS) {
          cleanup();
        }
      }, POLL_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(pingTimer);
        clearInterval(pollTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // উপেক্ষা
        }
      };

      req.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
