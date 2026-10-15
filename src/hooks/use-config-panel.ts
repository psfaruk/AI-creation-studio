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
    // অবস্থা স্থির করে ডিবাউন্স — দ্রুত টাইপিং/নির্বাচনে বারবার কল নয়
    const t = setTimeout(async () => {
      setValidatingState(true);
      try {
        const res = await fetch(withStudioToken('/api/productions/validate'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec: JSON.parse(specJson) }),
        });
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
        setValidatingState(false);
      }
    }, DEBOUNCE_MS);
    return () => {
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
