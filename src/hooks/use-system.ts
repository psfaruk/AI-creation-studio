'use client';

// ============================================================
// use-system — GET /api/system থেকে হার্ডওয়্যার + টুল-স্বাস্থ্য
// (নতুন মাস্টার প্ল্যান §৯)। TanStack Query, staleTime ৫ মিনিট।
// POST /api/system = জোর-করে পুনঃচেক (রেট-লিমিটেড)।
//
// নোট: নিচের টাইপগুলো types.ts-এর বাইরে লোকালি সংজ্ঞায়িত
// (types.ts কে কেউ পরিবর্তন করবে না — shared contract)।
// ============================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface SystemHardware {
  cpuCores: number;
  cpuModel: string;
  totalMemGb: number;
  freeMemGb: number;
  diskTotalGb: number;
  diskFreeGb: number;
  gpu: { present: boolean; note: string };
  ffmpeg: string;
  ffprobe: string;
  nodeVersion: string;
  platform: string;
}

export type SystemToolStatus = 'ok' | 'degraded' | 'down' | 'unknown';

export interface SystemToolHealth {
  key: string;
  label: string;
  status: SystemToolStatus;
  latencyMs?: number;
  checkedAt?: string;
  note?: string;
}

/** S9: রেট-লিমিট-কোঅর্ডিনেটরের একটি চ্যানেলের সৎ-স্ট্যাটাস (chat/image/tts/asr/video/search) */
export interface RateLimitChannelStatus {
  channel: string;
  blocked: boolean;
  blockedRemainingSec: number;
  consecutive429: number;
  total429: number;
  last429AgoSec: number | null;
  inFlight: number;
}

/** S9: কোন চ্যানেল এখন ব্লকড (৪২৯-কুলডাউন) — সাময়িক, লাইসেন্স-সমস্যা নয় */
export interface RateLimitsStatus {
  anyBlocked: boolean;
  channels: RateLimitChannelStatus[];
}

export interface SystemInfo {
  hardware: SystemHardware;
  tools: SystemToolHealth[];
  /** S9: রেট-লিমিট-কোঅর্ডিনেটর স্ট্যাটাস (/api/system-এর নতুন ফিল্ড) */
  rateLimits?: RateLimitsStatus;
  checkedAt: string;
  note?: string;
}

/** পুনঃচেক-ব্যর্থতার ধরন — 429 হলে আলাদা বাংলা বার্তা */
export class RecheckError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'RecheckError';
    this.status = status;
  }
}

export const SYSTEM_QUERY_KEY = ['system-info'] as const;
export const SYSTEM_STALE_TIME_MS = 5 * 60 * 1000; // ৫ মিনিট

/** GET /api/system — ৫ মিনিট staleTime, ১টি retry */
export function useSystemInfo() {
  return useQuery<SystemInfo>({
    queryKey: SYSTEM_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/system');
      if (!res.ok) throw new Error('system fetch failed');
      return (await res.json()) as SystemInfo;
    },
    staleTime: SYSTEM_STALE_TIME_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}

/** POST /api/system — জোর-করে পুনঃচেক (429-সহ স্পষ্ট এরর) */
export function useRecheckSystem() {
  const queryClient = useQueryClient();

  return useMutation<SystemInfo, RecheckError, void>({
    mutationFn: async () => {
      const res = await fetch('/api/system', { method: 'POST' });
      if (res.status === 429) {
        throw new RecheckError('রেট-সীমা — একটু পরে আবার চেষ্টা করুন', 429);
      }
      if (!res.ok) {
        throw new RecheckError('পুনঃচেক ব্যর্থ হয়েছে', res.status);
      }
      return (await res.json()) as SystemInfo;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(SYSTEM_QUERY_KEY, data);
    },
  });
}
