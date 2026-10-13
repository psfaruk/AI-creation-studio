// GET /api/runs/[id]/events → SSE stream of RunEvent
// প্রথমে DB থেকে replay, তারপর live event bus + ১.৫s DB diff-poll
// (HMR-এর সময়ও যাতে ইভেন্ট হারিয়ে না যায়)।
import { db } from '@/lib/db';
import { TOOL_CATALOG, type RunEvent, type RunStatus } from '@/lib/types';
import { subscribe } from '@/lib/agent/events';
import { buildMessageView, toRunStatus } from '@/lib/agent/serialize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const POLL_INTERVAL_MS = 1500;
const PING_INTERVAL_MS = 15_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run) {
    return Response.json({ error: 'রান খুঁজে পাওয়া যায়নি' }, { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let finished = false;
      const sentToolStart = new Set<string>();
      const sentToolEnd = new Set<string>();
      let runStartedSent = false;
      let messageSent = false;
      let runFinishedSent = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let pingTimer: ReturnType<typeof setInterval> | null = null;

      const send = (event: RunEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // ইভেন্ট dedupe করে পাঠাও
      const forward = (event: RunEvent) => {
        switch (event.type) {
          case 'ping':
            send(event);
            return;
          case 'run_started':
            if (!runStartedSent) {
              runStartedSent = true;
              send(event);
            }
            return;
          case 'tool_start':
            if (!sentToolStart.has(event.activityId)) {
              sentToolStart.add(event.activityId);
              send(event);
            }
            return;
          case 'tool_end':
            if (sentToolStart.has(event.activityId) && !sentToolEnd.has(event.activityId)) {
              sentToolEnd.add(event.activityId);
              send(event);
            }
            return;
          case 'message':
            if (!messageSent) {
              messageSent = true;
              send(event);
            }
            return;
          case 'text_delta':
            // লাইভ টোকেন-স্ট্রিম — সরাসরি পাঠানো (dedupe নেই; reset-সংকেতসহ)।
            // চূড়ান্ত 'message' ইভেন্টই কর্তৃত্বপূর্ণ টেক্সট — তাই হারালে ক্ষতি নেই।
            send(event);
            return;
          case 'run_note':
            // S9: রেট-লিমিট-অপেক্ষার মতো স্ট্যাটাস-নোট — সবসময় পাঠানো হয়
            send(event);
            return;
          case 'run_finished':
            if (!runFinishedSent) {
              runFinishedSent = true;
              send(event);
              finish();
            }
            return;
        }
      };

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        if (pingTimer) clearInterval(pingTimer);
        pollTimer = null;
        pingTimer = null;
        unsubscribe();
      };

      function finish() {
        if (finished) return;
        finished = true;
        cleanup();
        setTimeout(() => {
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        }, 50);
      }

      const abort = () => {
        finished = true;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // live ইভেন্ট সাথে সাথেই ফরোয়ার্ড — ১.৫s পোল-টিকের জমা নয়।
      // (টুল/মেসেজ/ফিনিশ ইভেন্টের dedupe নিচের forward()-এ বলি —
      // initial DB-replay-এর সাথে race-এও ডুপ্লিকেট যায় না;
      // text_delta/run_note কখনো DB-replay থেকে আসে না।)
      const unsubscribe = subscribe(runId, event => {
        if (!finished && !closed) forward(event);
      });
      req.signal.addEventListener('abort', abort);

      // DB থেকে বর্তমান অবস্থা sync (replay + poll — একই লজিক)
      const syncFromDb = async () => {
        try {
          const [r, toolCalls, finalMsg] = await Promise.all([
            db.agentRun.findUnique({ where: { id: runId } }),
            db.toolCall.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
            db.message.findFirst({ where: { runId } }),
          ]);
          if (!r) return;
          if (r.status === 'running') {
            forward({ type: 'run_started', runId, conversationId: r.conversationId });
          }
          for (const tc of toolCalls) {
            if (!sentToolStart.has(tc.id)) {
              const cat = TOOL_CATALOG.find(t => t.name === tc.tool);
              forward({
                type: 'tool_start',
                activityId: tc.id,
                tool: tc.tool,
                title: cat?.title ?? tc.tool,
                icon: cat?.icon ?? 'Wrench',
                input: tc.inputSummary,
              });
            }
            if (!sentToolEnd.has(tc.id) && tc.status !== 'running') {
              forward({
                type: 'tool_end',
                activityId: tc.id,
                status: tc.status === 'done' ? 'done' : 'failed',
                output: tc.outputSummary ?? undefined,
                error: tc.error ?? undefined,
                durationMs: tc.durationMs ?? undefined,
              });
            }
          }
          if (finalMsg && !messageSent) {
            const view = await buildMessageView(finalMsg);
            forward({ type: 'message', conversationId: r.conversationId, message: view });
          }
          if (r.status !== 'running' && !runFinishedSent) {
            forward({
              type: 'run_finished',
              runId,
              conversationId: r.conversationId,
              status: toRunStatus(r.status) as RunStatus,
              error: r.error ?? undefined,
            });
          }
        } catch (err) {
          console.error('[sse] DB sync error', err);
        }
      };

      // initial DB-replay → (প্রয়োজনে বন্ধ) → polling শুরু
      // (poll = HMR/ছিঁড়ে-যাওয়া সংযোগের নিরাপত্তা-জাল — সাধারণ পথে
      // লাইভ ইভেন্টই সাথে সাথে চলে যায়, আর দরকার হলে dedupe ছাঁকে)
      await syncFromDb();
      if (!finished) {
        pollTimer = setInterval(() => {
          if (finished || closed) return;
          void syncFromDb();
        }, POLL_INTERVAL_MS);
        pingTimer = setInterval(() => {
          if (!finished && !closed) send({ type: 'ping' });
        }, PING_INTERVAL_MS);
      }
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
