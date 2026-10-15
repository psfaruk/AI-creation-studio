// ============================================================
// Phase-1 test helper — SSE stream reader for route-level tests.
// Drives the real GET handler of /api/runs/[id]/events against a
// fake Request (with AbortController) and decodes `data:` frames.
// ============================================================

export interface SseFrame {
  type: string;
  [key: string]: unknown;
}

export interface SseCollectResult {
  frames: SseFrame[];
  done: boolean;
}

/**
 * Call the route's GET handler and collect SSE frames until either
 * `until(frames)` returns true, the stream closes, or timeoutMs hits.
 * Always aborts the request at the end (cleans up route timers).
 */
export async function collectSse(
  handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
  runId: string,
  opts: {
    until: (frames: SseFrame[]) => boolean;
    timeoutMs?: number;
  }
): Promise<SseCollectResult> {
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const controller = new AbortController();
  const req = new Request(`http://localhost/api/runs/${runId}/events`, {
    signal: controller.signal,
  });
  const res = await handler(req, { params: Promise.resolve({ id: runId }) });
  if (!res.ok || !res.body) {
    controller.abort();
    throw new Error(`SSE route did not return a stream (status ${res.status})`);
  }

  const frames: SseFrame[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const parsed = (block: string) => {
    for (const line of block.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try {
        frames.push(JSON.parse(raw) as SseFrame);
      } catch {
        // malformed frame — ignore (matches client behavior)
      }
    }
  };

  try {
    for (;;) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) {
        done = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        parsed(block);
      }
      if (opts.until(frames)) break;
    }
  } catch {
    // stream aborted or errored — what we collected so far is the result
  } finally {
    clearTimeout(timeout);
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // already cancelled
    }
  }
  return { frames, done };
}

/** Filter helper: frames of a given type. */
export function framesOf(frames: SseFrame[], type: string): SseFrame[] {
  return frames.filter((f) => f.type === type);
}
