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
// Current behavior (bug): the per-voice call is not wrapped in
// try/catch, so the first Edge 403 escapes the loop; additionally
// the loop cap attempts>=Math.min(2, voices.length) makes z-ai
// voices unreachable even when errors are caught.
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
});

describe('REG-1: Bengali TTS fallback when Edge returns 403', () => {
  test(
    'REG-1a [EXPECTED BEHAVIOR — currently FAILS: P0-BUG-01]: fallback chain engages z-ai voices after Edge 403',
    async () => {
      // Contract: the z-ai fallback voices (jam/douji) are documented
      // as the emergency fallback for Bengali. When every Edge voice
      // 403s, synthesizeVerifiedSpeech must continue down the chain
      // and return audio from a z-ai voice with an honest verdict.
      //
      // While P0-BUG-01 exists this call rejects with the raw Edge
      // 403 error (no try/catch around the per-voice call), so this
      // assertion fails — that failure IS the recorded regression.
      const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });

      // If the fallback worked, the result must come from a z-ai voice
      expect(['jam', 'douji']).toContain(result.voice as string);
      // and at least one z-ai synthesis must actually have happened
      expect(zaiCalls.length).toBeGreaterThan(0);
      // honest verdict for a non-Bengali-trained voice is 'warn', not 'pass'
      expect(result.verification.verdict).toBe('warn');
    },
    20_000
  );

  test(
    'REG-1b [CHARACTERIZATION of structural defect #2 — passes until P0-BUG-01 is fixed]: ' +
      'even with successful-but-failing-verification Edge audio, the loop cap stops at 2 attempts and z-ai is never tried',
    async () => {
      // Isolates defect #2 from the bug register: no throw happens —
      // every Edge voice *succeeds* but returns audio that FAILS
      // verification (0.2s, far below expected ~3.4s). The loop should
      // walk the whole profile chain (3 Edge fails → jam → douji) and
      // end with a warn-verdict z-ai result, but the cap
      // attempts >= Math.min(2, voices.length) stops after 2 Edge
      // voices. This test locks in the current (buggy) behavior as
      // evidence; when P0-BUG-01 is fixed it must be updated to the
      // expected contract (z-ai reached, warn verdict, attempts >= 4).
      edgeMode = 'shortWav';

      const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });

      // Current (buggy) behavior, locked in as evidence:
      expect(result.attempts).toBe(2); // loop cap Math.min(2, 5) = 2
      expect(result.verification.verdict).toBe('fail'); // both Edge attempts failed verification
      expect(edgeCalls.map((c) => c.voice)).toEqual([
        'bn-BD-NabanitaNeural',
        'bn-BD-PradeepNeural',
      ]);
      // z-ai fallback was never reached despite 3 voices remaining in the chain
      expect(zaiCalls.length).toBe(0);
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
});
