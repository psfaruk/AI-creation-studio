'use client';

// ============================================================
// use-hardware — GET /api/hardware থেকে Hardware-aware Model
// Manager (নতুন পরিকল্পনা §১০ — দশম ধাপ)। সহজ useState/useEffect
// প্যাটার্ন: মাউন্টে স্বয়ংক্রিয় লোড + ম্যানুয়াল refresh।
//
// এন্ডপয়েন্ট সাময়িকভাবে ব্যর্থ হলে error-স্টেট — ভিউ কখনো ক্র্যাশ
// করে না; UI-তে ছোট ইনলাইন এরর + "আবার" বাটন দেখানো হয়।
//
// নোট: সব টাইপ @/lib/types থেকে type-only import — types.ts
// স্পর্শ করা হয় না (shared contract)।
// ============================================================

import { useCallback, useEffect, useState } from 'react';

import type { HardwareManagerResponse } from '@/lib/types';

export interface UseHardwareResult {
  /** সর্বশেষ হার্ডওয়্যার-প্রোফাইল + মডেল-রায় (না লোড হলে null) */
  data: HardwareManagerResponse | null;
  /** প্রাথমিক/রিফ্রেশ-লোড চলছে কি না */
  loading: boolean;
  /** ব্যর্থ হলে বাংলা এরর-বার্তা, নয়তো null */
  error: string | null;
  /** ম্যানুয়াল পুনঃলোড */
  refresh: () => Promise<void>;
}

/** GET /api/hardware → HardwareManagerResponse */
export function useHardware(): UseHardwareResult {
  const [data, setData] = useState<HardwareManagerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isCancelled: () => boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/hardware');
      if (!res.ok) throw new Error(`hardware fetch failed (${res.status})`);
      const json = (await res.json()) as HardwareManagerResponse;
      // প্রতিরক্ষামূলক: প্রোফাইল/রায় অনুপস্থিত হলেও ভিউ যেন ভেঙে না পড়ে
      if (!json || typeof json !== 'object' || !json.profile) {
        throw new Error('hardware response shape mismatch');
      }
      if (!isCancelled()) setData(json);
    } catch {
      if (!isCancelled()) setError('হার্ডওয়্যার-প্রোফাইল ও মডেল-রায় আনা যায়নি।');
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }, []);

  // মাউন্টে স্বয়ংক্রিয় লোড (unmount-এ স্টেট-আপডেট বাতিল)
  useEffect(() => {
    let cancelled = false;
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    await load(() => false);
  }, [load]);

  return { data, loading, error, refresh };
}
