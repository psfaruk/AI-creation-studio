'use client';

// ============================================================
// use-config-panel — Phase-4 C+D ক্লায়েন্ট-হুক।
//
// ১. useConfigPanel(type, conversationId) — সার্ভার-মালিকানাধীন প্যানেল-
//    স্কিমা (ক্ষেত্র/অপশন/সীমা/নিষ্ক্রিয়-কারণ) + মিউজিক-ভিডিওর গান-তালিকা।
//    স্কিমা প্রকারভেদে স্থির — একই (type, conversationId)-এ মডিউল-ক্যাশ।
//
// ২. useSpecValidation(spec) — সম্পাদিত spec-এর ডিবাউন্স-করা লাইভ সার্ভার-
//    যাচাই (POST /api/productions/validate): verdict + adjustments/notes/errors।
//    ক্লায়েন্ট-পক্ষের এই রায় কেবল প্রদর্শনের জন্য — চূড়ান্ত রায় confirm-এ
//    সার্ভার নিজেই পুনঃযাচাই করে (ক্লায়েন্ট-দাবি কখনো ওভাররাইড করে না)।
//
// (Lint-নীতি: effect-দেহে সরাসরি setState নয় — ক্যাশ-সিঙ্ক রেন্ডার-কালে,
//  fetch-ফল শুধু অ্যাসিঙ্ক কলব্যাকে।)
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { withStudioToken } from '@/components/auth/security-gate';
import type { ConfigPanelSchema } from '@/lib/agent/config-panel';
import type { CinematicPlan, CinematicPlanSummary } from '@/lib/agent/cinematic/types';
import type { CreativeJobSpec, ProductionType } from '@/lib/types';

const schemaCache = new Map<string, ConfigPanelSchema>();

interface PanelState {
  key: string;
  schema: ConfigPanelSchema | null;
  loading: boolean;
}

export function useConfigPanel(type: ProductionType, conversationId?: string): {
  schema: ConfigPanelSchema | null;
  loading: boolean;
} {
  const cacheKey = `${type}:${conversationId ?? ''}`;
  const [state, setState] = useState<PanelState>(() => ({
    key: cacheKey,
    schema: schemaCache.get(cacheKey) ?? null,
    loading: !schemaCache.has(cacheKey),
  }));

  // cacheKey বদলালে রেন্ডার-কালেই নতুন ক্যাশ-স্টেটে সমন্বয় (effect নয়)
  if (state.key !== cacheKey) {
    const cached = schemaCache.get(cacheKey) ?? null;
    setState({ key: cacheKey, schema: cached, loading: !cached });
  }

  useEffect(() => {
    if (schemaCache.has(cacheKey)) return;
    let cancelled = false;
    const params = new URLSearchParams({ type: cacheKey.split(':')[0] });
    const convId = cacheKey.slice(cacheKey.indexOf(':') + 1);
    if (convId) params.set('conversationId', convId);
    fetch(withStudioToken(`/api/productions/config-panel?${params.toString()}`))
      .then(r => (r.ok ? r.json() : null))
      .then((data: ConfigPanelSchema | null) => {
        if (cancelled || !data) return;
        schemaCache.set(cacheKey, data);
        // কলব্যাকে setState — কেবল তখনই যখন এখনো এই key-ই সক্রিয়
        setState(prev =>
          prev.key === cacheKey ? { key: cacheKey, schema: data, loading: false } : prev
        );
      })
      .catch(() => {
        // নেটওয়ার্ক-ব্যর্থতা — নীরব; প্যানেল ফলব্যাক-অপশনেই কাজ করে
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey]);

  return { schema: state.schema, loading: state.loading };
}

// ------------------------------------------------------------
// লাইভ স্পেক-যাচাই (ডিবাউন্স)
// ------------------------------------------------------------

export interface SpecValidationLive {
  verdict:
    | 'supported'
    | 'supported_with_limitations'
    | 'unsupported'
    | 'requires_clarification'
    | 'temporarily_unavailable';
  errors: string[];
  adjustments: { field: string; from: string; to: string; reason: string }[];
  notes: string[];
  alternatives: string[];
}

const DEBOUNCE_MS = 700;

export function useSpecValidation(spec: CreativeJobSpec | null): {
  live: SpecValidationLive | null;
  validating: boolean;
} {
  const specJson = useMemo(() => (spec ? JSON.stringify(spec) : ''), [spec]);
  const [liveState, setLiveState] = useState<SpecValidationLive | null>(null);
  const [validatingState, setValidatingState] = useState(false);

  useEffect(() => {
    if (!specJson) return;
    // পুরনন্ত-উত্তর রেস-প্রহার: spec বদলে গেলে আগের অনুরোধের দেরি-করা উত্তর
    // নতুন ফলাফলের উপরে setState করতে দেওয়া যাবে না — useConfigPanel-এর
    // cancelled-প্যাটার্নেই প্রহার (P5-5b)
    let cancelled = false;
    // অবস্থা স্থির করে ডিবাউন্স — দ্রুত টাইপিং/নির্বাচনে বারবার কল নয়
    const t = setTimeout(async () => {
      setValidatingState(true);
      try {
        const res = await fetch(withStudioToken('/api/productions/validate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec: JSON.parse(specJson) }),
        });
        if (cancelled) return;
        if (!res.ok) {
          // রেট-লিমিট/নেটওয়ার্ক-ব্যর্থতায় প্যানেল অবরুদ্ধ হবে না —
          // নীরব-স্কিপ (confirm-এ সার্ভার-পুনঃযাচাই তো আছেই)
          setValidatingState(false);
          return;
        }
        const data = (await res.json()) as {
          verdict: SpecValidationLive['verdict'];
          validation: {
            ok?: boolean;
            errors?: string[];
            alternatives?: string[];
            adjustments?: { field: string; from: string; to: string; reason: string }[];
            notes?: string[];
          };
        };
        if (cancelled) return;
        setLiveState({
          verdict: data.verdict,
          errors: data.validation?.errors ?? [],
          adjustments: data.validation?.adjustments ?? [],
          notes: data.validation?.notes ?? [],
          alternatives: data.validation?.alternatives ?? [],
        });
        setValidatingState(false);
      } catch {
        // নেটওয়ার্ক — নীরব; আগের ফলাফলই থাকে
        if (cancelled) return;
        setValidatingState(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [specJson]);

  // spec না থাকলে (অপেক্ষমাণ নয়) ফলাফল সরবরাহই হয় না —
  // অভ্যন্তরীণ পুরোনো state মুছে ফেলার effect-দরকার নেই
  return {
    live: spec ? liveState : null,
    validating: spec ? validatingState : false,
  };
}

// ------------------------------------------------------------
// Phase-5 §7: নিশ্চিতকরণ-পূর্ব সিনেম্যাটিক শট-পরিকল্পনার প্রিভিউ
// (ডিবাউন্সড, শূন্য-ব্যয়)। সার্ভারই পুরো পরিকল্পনা বানায় —
// ক্লায়েন্ট কেবল প্রদর্শন করে; ব্যবহারকারীর সম্পাদনা spec-
// cinematicOverrides হয়ে যায়, তারপর সার্ভারে পুনঃপরিকল্পনা + পুনঃযাচাই।
// ------------------------------------------------------------

export interface ShotPlanPreviewLive {
  plan: CinematicPlan;
  summary: CinematicPlanSummary;
  /** কাট-টাইমিং-উৎসের সৎ বাংলা লেবেল */
  beatSourceLabel: string;
  /** অডিও-বিশ্লেষণের সৎ নোট (আপলোড গানে থাকে) */
  analysisLabel?: string;
}

const PLAN_PREVIEW_TYPES = ['music_video', 'short_film'] as const;

export function useShotPlanPreview(
  spec: CreativeJobSpec | null,
  conversationId?: string
): {
  shotPlan: ShotPlanPreviewLive | null;
  loadingPlan: boolean;
} {
  const specJson = useMemo(() => (spec ? JSON.stringify(spec) : ''), [spec]);
  const [state, setState] = useState<ShotPlanPreviewLive | null>(null);
  const [loading, setLoading] = useState(false);
  const applicable =
    !!spec && (PLAN_PREVIEW_TYPES as readonly string[]).includes(spec.type);

  useEffect(() => {
    if (!applicable || !specJson) return;
    // পুরনন্ত-উত্তর রেস-প্রহার: ওভাররাইড/সেটিংস-সম্পাদনায় spec দ্রুত বদলায় —
    // আগের অনুরোধের দেরি-করা উত্তর নতুন পরিকল্পনার উপরে setState করতে
    // দেওয়া যাবে না (useConfigPanel-এর cancelled-প্যাটার্ন; P5-5b)
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(withStudioToken('/api/productions/plan-preview'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spec: JSON.parse(specJson),
            ...(conversationId ? { conversationId } : {}),
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          // রেট-লিমিট/যাচাই-ব্যর্থতা — নীরব-স্কিপ; সেকশন লুকানো থাকে
          setLoading(false);
          return;
        }
        const data = (await res.json()) as ShotPlanPreviewLive;
        if (cancelled) return;
        setState(data);
        setLoading(false);
      } catch {
        // নেটওয়ার্ক — নীরব; আগের ফলাফলই থাকে
        if (cancelled) return;
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [specJson, applicable, conversationId]);

  return {
    shotPlan: applicable ? state : null,
    loadingPlan: applicable ? loading : false,
  };
}
