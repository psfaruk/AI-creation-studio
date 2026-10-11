'use client';

// ============================================================
// use-benchmark — বাংলা TTS মান-যাচাই বেঞ্চমার্ক
// (নতুন পরিকল্পনা §৪ — তৃতীয় ধাপ)। /api/benchmark/tts।
//
// - GET  → { current: TtsBenchmarkReport | null; latest: … | null }
// - POST { scope: 'quick' | 'full' } → নতুন রান শুরু (৪০৯ = ইতিমধ্যে
//   চলছে — বাংলা বার্তা ফেরত দেওয়া হয়)
// - DELETE → চলমান রান বাতিল
//
// পোলিং: current?.status === 'running' হলেই প্রতি ২.৫ সেকেন্ডে
// নীরব রিফ্রেশ (loading-ফ্লিকার ছাড়া); শেষ হলে বন্ধ।
//
// নোট: সব টাইপ @/lib/types থেকে type-only import — types.ts স্পর্শ
// করা হয় না (shared contract)।
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import type { TtsBenchmarkReport } from '@/lib/types';

/** GET /api/benchmark/tts-এর প্রত্যুত্তর-আকৃতি */
interface BenchmarkState {
  current: TtsBenchmarkReport | null;
  latest: TtsBenchmarkReport | null;
}

export type BenchmarkScope = 'quick' | 'full';

export interface UseBenchmarkResult {
  /** চলমান/সবশেষ চালু-রান (null হলে কিছু চলছে না) */
  current: TtsBenchmarkReport | null;
  /** সর্বশেষ সম্পন্ন রানের রিপোর্ট */
  latest: TtsBenchmarkReport | null;
  /** POST (শুরু) চলছে কি না */
  starting: boolean;
  /** প্রাথমিক লোড চলছে কি না */
  loading: boolean;
  /** GET ব্যর্থ হলে বাংলা বার্তা (ভিউ-স্তরের ইনলাইন এররের জন্য) */
  error: string | null;
  /** বেঞ্চমার্ক শুরু — সফল হলে null, ব্যর্থ/৪০৯ হলে বাংলা বার্তা */
  start: (scope: BenchmarkScope) => Promise<string | null>;
  /** চলমান রান বাতিল */
  cancel: () => Promise<void>;
  /** GET পুনঃচেষ্টা */
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 2500;

/** POST-এর ব্যর্থ-বডি থেকে বার্তা বের করা (না থাকলে ডিফল্ট) */
async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
  } catch {
    // বডি JSON না হলে ডিফল্ট বার্তাই থাক
  }
  return fallback;
}

export function useBenchmark(): UseBenchmarkResult {
  const [state, setState] = useState<BenchmarkState>({ current: null, latest: null });
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const fetchState = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/benchmark/tts');
      if (!res.ok) throw new Error(`benchmark fetch failed (${res.status})`);
      const json = (await res.json()) as Partial<BenchmarkState> | null;
      if (!alive.current) return;
      setState({
        current: json?.current ?? null,
        latest: json?.latest ?? null,
      });
      setError(null);
    } catch {
      if (!silent && alive.current) {
        setError('বেঞ্চমার্ক-স্থিতি আনা যায়নি।');
      }
      // নীরব-পোল ব্যর্থ হলে পুরনো ডেটাই থাকে — পরের পোলে আবার চেষ্টা
    } finally {
      if (!silent && alive.current) setLoading(false);
    }
  }, []);

  // মাউন্টে প্রাথমিক লোড
  useEffect(() => {
    alive.current = true;
    void fetchState();
    return () => {
      alive.current = false;
    };
  }, [fetchState]);

  // চলমান রান থাকলেই ২.৫ সেকেন্ড পরপর নীরব পোল
  const running = state.current?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      void fetchState({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running, fetchState]);

  const start = useCallback(
    async (scope: BenchmarkScope): Promise<string | null> => {
      setStarting(true);
      try {
        const res = await fetch('/api/benchmark/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope }),
        });
        if (res.status === 409) {
          return await readErrorMessage(
            res,
            'ইতিমধ্যে একটি বেঞ্চমার্ক চলছে — শেষ হওয়া পর্যন্ত অপেক্ষা করুন বা বাতিল করুন।',
          );
        }
        if (!res.ok) {
          return await readErrorMessage(res, 'বেঞ্চমার্ক শুরু করা যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন।');
        }
        // শুরু সফল — সাথে সাথে লাইভ-স্থিতি টেনে আনা
        await fetchState();
        return null;
      } catch {
        return 'নেটওয়ার্ক-সমস্যায় বেঞ্চমার্ক শুরু করা যায়নি।';
      } finally {
        setStarting(false);
      }
    },
    [fetchState],
  );

  const cancel = useCallback(async () => {
    try {
      await fetch('/api/benchmark/tts', { method: 'DELETE' });
    } catch {
      // বাতিল-কল ব্যর্থ হলে পরের পোলেই প্রকৃত স্থিতি ধরা পড়বে
    } finally {
      await fetchState();
    }
  }, [fetchState]);

  const refresh = useCallback(async () => {
    await fetchState();
  }, [fetchState]);

  return { current: state.current, latest: state.latest, starting, loading, error, start, cancel, refresh };
}
