// ============================================================
// REGRESSION TEST 1 — Bengali TTS fallback (Edge 403 → z-ai)
// Documents P0-BUG-01 from the Phase-0 bug register.
//
// Boundaries:
//  - Module under test: src/lib/agent/audio/language_controller.ts
//    (synthesizeVerifiedSpeech — the voice-fallback loop)
//  - Mocked: '@/lib/agent/tts-cache' (engine routing: Edge → 403
//    throw or too-short audio, z-ai → valid WAV) and
//    '@/lib/agent/sdk-helpers' (transcribeBuffer → Bengali
//    transcript; no live ASR). Mock behavior is switched through a
//    mutable mode variable read at call time (module bindings of
//    the already-imported module under test cannot be swapped).
//  - REAL (no mock): bn-text-normalizer, edge_tts (pure routing
//    helpers), pcm.encodeWav, and ffmpeg audioQuality on real
//    temp WAV files (validates actual duration logic).
//  - No network calls of any kind.
//
// Expected behavior (contract): when Edge TTS returns 403 for the
// primary Bengali voices, the fallback chain must reach the z-ai
// voices (jam/douji) and produce audio with an honest 'warn'
// verdict — the bn profile documents them as the emergency
// fallback ("শুধু Edge-নিউরাল অচল থাকলে জরুরি-ফলব্যাক").
//
// Post-fix contract (Phase 2 — P0-BUG-01 FIXED): the per-voice call
// is wrapped in try/catch, a hard engine failure (Edge 403) marks
// that engine dead and skips its remaining voices, the loop walks
// the whole profile chain, and total engine exhaustion rejects
// honestly. The pre-fix state (uncaught throw + Math.min(2,…) cap)
// is preserved in git history (the phase-1 commit) as evidence.
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { encodeWav } from '@/lib/agent/audio/pcm';
import { isEdgeVoice } from '@/lib/agent/audio/edge_tts';

// ------------------------------------------------------------
// Mock engine routing — installed BEFORE importing the module
// under test (language_controller imports cachedSynthesizeSpeech
// from '@/lib/agent/tts-cache' and transcribeBuffer from
// '@/lib/agent/sdk-helpers').
// ------------------------------------------------------------

interface MockCall {
  voice: string;
  text: string;
}

const edgeCalls: MockCall[] = [];
const zaiCalls: MockCall[] = [];

/** Mock behavior switch for Edge voices (read at call time). */
let edgeMode: 'throw403' | 'shortWav' = 'throw403';
/** Mock behavior switch for z-ai voices (read at call time) — REG-1g. */
let zaiMode: 'ok' | 'throw' = 'ok';

/** 0.2s stereo silence — verifiable but far too short (verdict: fail) */
let shortWav: Buffer;
/** 1.6s stereo silence — duration-OK (verdict: warn for bn+z-ai) */
let okWav: Buffer;

function wavOfSeconds(sec: number): Buffer {
  const sr = 24000;
  const n = Math.round(sec * sr);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  return encodeWav(L, R, sr);
}

mock.module('@/lib/agent/tts-cache', () => {
  return {
    // route by voice name, exactly like the real engine selector:
    // Edge-neural names → Edge TTS; everything else → z-ai SDK
    cachedSynthesizeSpeech: async (text: string, voice: string, _speed: number) => {
      if (isEdgeVoice(voice)) {
        edgeCalls.push({ voice, text });
        if (edgeMode === 'throw403') {
          // the exact failure observed in production yrz3ymb7:
          throw new Error('Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403');
        }
        return { buffer: shortWav, mimeType: 'audio/wav', ext: 'wav' };
      }
      zaiCalls.push({ voice, text });
      if (zaiMode === 'throw') {
        throw new Error('z-ai TTS ব্যর্থ: সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট)');
      }
      return { buffer: okWav, mimeType: 'audio/wav', ext: 'wav' };
    },
    ttsCacheStats: () => ({ hits: 0, misses: 0, inFlight: 0 }),
  };
});

mock.module('@/lib/agent/sdk-helpers', () => {
  return {
    // ASR back-check for bn + z-ai voice (asrUseful=true there);
    // returns Bengali characters — the "ভালো লক্ষণ" path.
    transcribeBuffer: async () => 'হ্যালো এই একটি পরীক্ষা',
    synthesizeSpeech: async () => {
      throw new Error('z-ai TTS should not be called directly in this test');
    },
    imageSearchSdkFirst: async () => ({ via: 'sdk', results: [] }),
  };
});

// module under test — imported AFTER the mocks above
const { synthesizeVerifiedSpeech, resolveVoice, detectLanguage, LANGUAGE_PROFILES } = await import(
  '@/lib/agent/audio/language_controller'
);

const BN_SPEC = {
  task: 'speech' as const,
  language: 'bn' as const,
  script: 'আমি আজ একটি ছোট গল্প শুনিয়ে দিচ্ছি তোমাদের সবাইকে।',
  voiceId: 'bn-BD-NabanitaNeural',
  outputFormat: 'wav' as const,
  sampleRate: 24000 as const,
  speed: 1,
};

beforeEach(() => {
  shortWav = wavOfSeconds(0.2);
  okWav = wavOfSeconds(1.6);
  edgeCalls.length = 0;
  zaiCalls.length = 0;
  edgeMode = 'throw403';
  zaiMode = 'ok';
});

describe('REG-1: Bengali TTS fallback when Edge returns 403', () => {
  test(
    'REG-1a [EXPECTED BEHAVIOR — P0-BUG-01 fixed in Phase 2]: fallback chain engages z-ai voices after Edge 403',
    async () => {
      // Contract: when every Edge voice 403s, the chain must reach the
      // z-ai fallback voices (jam/douji) and return audio with an honest
      // 'warn' verdict. Engine-aware skip: the remaining Edge voices
      // (Pradeep, Tanishaa) are never wasted on the dead engine.
      const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });

      // the result comes from the first z-ai fallback voice
      expect(result.voice).toBe('jam');
      // exactly ONE Edge attempt (the 403 that killed the engine) — the
      // other two Edge voices were skipped engine-aware, not retried
      expect(edgeCalls.map((c) => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
      // exactly one z-ai synthesis actually happened
      expect(zaiCalls.map((c) => c.voice)).toEqual(['jam']);
      // attempts counts real synthesis tries only (skipped voices excluded)
      expect(result.attempts).toBe(2);
      // honest verdict for a non-Bengali-trained voice is 'warn', not 'pass'
      expect(result.verification.verdict).toBe('warn');
      // the result honestly notes that an engine fallback occurred
      expect(result.verification.notes.some((n) => n.includes('ইঞ্জিন-ফলব্যাক'))).toBe(true);
    },
    20_000
  );

  test(
    'REG-1b [NEW CONTRACT after the P0-BUG-01 fix]: verification-failing Edge audio walks the WHOLE chain — all 3 Edge voices tried, then z-ai returns with a warn verdict',
    async () => {
      // Isolates the former defect #2: no throw happens — every Edge
      // voice *succeeds* but returns audio that FAILS verification
      // (0.2s, far below expected ~4.5s). The fixed contract walks the
      // whole profile chain (3 Edge fails → jam) and ends with a
      // warn-verdict z-ai result. (The old Math.min(2, 5)=2 cap stopped
      // after 2 Edge voices and z-ai was structurally unreachable —
      // locked in as evidence by the pre-fix version of this test,
      // preserved in the phase-1 commit.)
      edgeMode = 'shortWav';

      const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });

      // the whole Edge section was tried, in chain order
      expect(edgeCalls.map((c) => c.voice)).toEqual([
        'bn-BD-NabanitaNeural',
        'bn-BD-PradeepNeural',
        'bn-IN-TanishaaNeural',
      ]);
      // z-ai fallback reached and accepted
      expect(zaiCalls.map((c) => c.voice)).toEqual(['jam']);
      expect(result.voice).toBe('jam');
      // 3 Edge attempts + 1 z-ai attempt — the cap no longer truncates
      expect(result.attempts).toBe(4);
      expect(result.verification.verdict).toBe('warn');
    },
    20_000
  );

  test('REG-1c [supporting unit]: the bn profile lists z-ai voices after all Edge voices (chain order is correct)', () => {
    const voices = LANGUAGE_PROFILES.bn.voices as string[];
    expect(voices[0]).toBe('bn-BD-NabanitaNeural');
    // z-ai fallbacks exist and come after all Edge voices
    expect(voices).toContain('jam');
    expect(voices).toContain('douji');
    const firstZai = voices.findIndex((v) => v === 'jam');
    const lastEdge = voices.map((v) => isEdgeVoice(v)).lastIndexOf(true);
    expect(firstZai).toBeGreaterThan(lastEdge);
  });

  test('REG-1d [supporting unit]: resolveVoice upgrades a non-Edge bn preference to the neural primary', () => {
    // Bengali + z-ai preference → well-meaning upgrade to Nabanita
    expect(resolveVoice('bn', 'jam')).toBe('bn-BD-NabanitaNeural');
    expect(resolveVoice('bn', undefined)).toBe('bn-BD-NabanitaNeural');
  });

  test('REG-1e [supporting unit]: detectLanguage classifies Bengali script', () => {
    const det = detectLanguage(BN_SPEC.script);
    expect(det.language).toBe('bn');
    expect(det.bnRatio).toBeGreaterThanOrEqual(0.7);
  });

  test(
    'REG-1f [unverified path — used by pipeline lines 2+ (P0-BUG-01 fix #3)]: verify:false also gets the fallback chain',
    async () => {
      // short_film dialogue lines 2+/audio chunks 2+ synthesize with
      // verify:false for cost control — that path must ALSO survive an
      // Edge 403 (z-ai fallback) instead of losing the line outright.
      const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: false });

      expect(result.voice).toBe('jam');
      // engine-aware skip applies on the unverified path too
      expect(edgeCalls.map((c) => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
      expect(zaiCalls.map((c) => c.voice)).toEqual(['jam']);
      expect(result.attempts).toBe(2);
      expect(result.verification.verdict).toBe('warn');
      // honest unverified-note + honest fallback note
      expect(result.verification.notes.some((n) => n.includes('যাচাই বন্ধ ছিল'))).toBe(true);
      expect(result.verification.notes.some((n) => n.includes('ইঞ্জিন-ফলব্যাক'))).toBe(true);
    },
    20_000
  );

  test(
    'REG-1g [exhaustion honesty]: when BOTH engines fail, the call rejects with an honest error — never a fake success',
    async () => {
      // Each engine is tried once and marked dead; with no engine left
      // the function must reject (documenting both engine failures)
      // rather than fabricate a result.
      zaiMode = 'throw';

      await expect(synthesizeVerifiedSpeech(BN_SPEC, { verify: true })).rejects.toThrow(
        /সব TTS ইঞ্জিন অচল/
      );
      // exactly one call per engine — no retry storm on dead engines
      expect(edgeCalls.length).toBe(1);
      expect(zaiCalls.length).toBe(1);
    },
    20_000
  );
});
