'use client';

// ============================================================
// use-availability — GET /api/availability থেকে Model & Tool
// Availability Matrix (নতুন মাস্টার প্ল্যান §১৫-এর প্রথম
// Deliverable)। use-system.ts-এর প্রতিষ্ঠিত প্যাটার্ন অনুসরণে
// TanStack Query (staleTime ৫ মিনিট, ১টি retry)।
//
// নোট: সব টাইপ @/lib/types থেকে type-only import — types.ts
// স্পর্শ করা হয় না (shared contract)।
// ============================================================

import { useQuery } from '@tanstack/react-query';

import type { AvailabilityMatrixResponse } from '@/lib/types';

export const AVAILABILITY_QUERY_KEY = ['availability-matrix'] as const;
export const AVAILABILITY_STALE_TIME_MS = 5 * 60 * 1000; // ৫ মিনিট

/**
 * GET /api/availability — ২৩টি ক্ষমতার চার-মাত্রিক
 * (লাইসেন্স/প্রোভাইডার/ইন্টিগ্রেশন/রানটাইম) সৎ রায় + usageMode +
 * legend। ফেরত দেয় { data, isLoading, error, refetch, … }।
 */
export function useAvailability() {
  return useQuery<AvailabilityMatrixResponse>({
    queryKey: AVAILABILITY_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/availability');
      if (!res.ok) throw new Error('availability fetch failed');
      return (await res.json()) as AvailabilityMatrixResponse;
    },
    staleTime: AVAILABILITY_STALE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
