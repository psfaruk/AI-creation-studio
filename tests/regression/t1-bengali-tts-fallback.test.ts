// ============================================================
// REGRESSION TEST 1 — Bengali TTS fallback (Edge 403) — R-FIX-1 contract
// Documents P0-BUG-01 (Phase 2) → Critical Defect A (Recovery RC-1/RC-2).
//
// Boundaries (unchanged):
//  - Module under test: src/lib/agent/audio/language_controller.ts
//    (synthesizeVerifiedSpeech — the voice-fallback loop)
//  - Mocked: '@/lib/agent/tts-cache' (engine routing: Edge → 403
//    throw / too-short WAV / healthy WAV; z-ai → valid WAV or throw)
//    and '@/lib/agent/sdk-helpers' (transcribeBuffer → switchable
//    transcript; no live ASR). Mock behavior is switched through
//    mutable mode variables read at call time.
//  - REAL (no mock): bn-text-normalizer, edge_tts (pure routing
//    helpers; the best-effort voice-verification record is isolated
//    to a temp dir via the suite preload — D-1: tests can NEVER
//    mutate the real storage/voice-verification.json),
//    pcm.encodeWav, and ffmpeg audioQuality on real temp WAV files.
//  - No network calls of any kind.
//
// CONTRACT (R-FIX-1 — findings-b §10, the 2026-10-16 Defect-A fix):
//  - bn chain contains ONLY Bengali-trained Edge-neural voices
//    (jam/douji removed). In the real run, after Edge-403 the jam
//    voice read Bengali and produced Chinese garbage (DB:
//    speech-bn-jam, similarity 0) — silent cross-language fallback
//    is now structurally impossible (capability tags, fail-closed).
//  - Edge dead on a bn request ⇒ typed VOICE_UNAVAILABLE rejection
//    with §4.2's exact message — never a fake success (REG-1a/1f).
//  - All Edge candidates failing verification ⇒ typed
//    VERIFICATION_FAILED — failing audio is never returned (REG-1b).
//  - The en chain legitimately keeps z-ai fallbacks (en-capable
//    tags), but any result obtained after an engine fallback is
//    capped at 'warn' — never 'pass' (B-F05; the romanized-garbage
//    0.57-similarity false-positive is live-proven) (REG-1g/1i).
//
// The previous contract (Phase-2: bn→jam fallback) was defective per
// findings-b B-F01 — this rewrite is a STRENGTHENING (the flawed
// behavior-lock becomes a correct behavior-lock). History preserved
// in the phase-1/phase-2 commits.
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { encodeWav } from '@/lib/agent/audio/pcm';
import { isEdgeVoice } from '@/lib/agent/audio/edge_tts';
import { toneWavOfSeconds } from '../helpers/speech-wav';

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
let edgeMode: 'throw403' | 'shortWav' | 'okWav' | 'silentWav' = 'throw403';
/** Mock behavior switch for z-ai voices (read at call time). */
let zaiMode: 'ok' | 'throw' = 'ok';
/** ASR transcript switch (read at call time) — bn sample / en echo. */
let asrMode: 'bnSample' | 'enEcho' = 'bnSample';

/** 0.2s stereo silence — verifiable but far too short (verdict: fail) */
let shortWav: Buffer;
/** 1.6s non-silent tone (amp 0.3 → RMS ≈ −13.5dB) — z-ai duration-OK path (en scripts) */
let okWav: Buffer;
/** 2.0s non-silent tone — Edge healthy path (bn scripts: 4.0s expected → window [1.6, 10.4]).
 *  D-2: আগে এটি বিশুদ্ধ নীরবতা ছিল — নীরবতা-গেট নেই বলেই "pass" হতো;
 *  এখন অ-নীরব টোন (প্রকৃত কথা-সদৃশ শর্ত) এবং নীরবতা-প্রত্যাখ্যান REG-1j-এ লক। */
let edgeOkWav: Buffer;
/** 2.0s বিশুদ্ধ নীরবতা — D-2 নেতিবাচক ফিক্সচার (SILENCE_DETECTED) */
let edgeSilentWav: Buffer;

const EN_TEXT = 'This is a short English test line for synthesis.';

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
          // the exact failure observed in the real run (yrz3ymb7 / cmvbbv86c):
          throw new Error('Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403');
        }
        if (edgeMode === 'shortWav') {
          return { buffer: shortWav, mimeType: 'audio/wav', ext: 'wav' };
        }
        if (edgeMode === 'silentWav') {
          // D-2 নেতিবাচক ফিক্সচার: যুক্তিসংগত দৈর্ঘ্যের বিশুদ্ধ নীরবতা —
          // পুরনো যাচাইকারী এটিকে "pass" করত (গর্তটি REG-1j লক করে)
          return { buffer: edgeSilentWav, mimeType: 'audio/wav', ext: 'wav' };
        }
        return { buffer: edgeOkWav, mimeType: 'audio/wav', ext: 'wav' };
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
    // ASR back-check — only reached for en (bn+Edge skips the ASR call
    // by design; bn+z-ai can no longer occur in the chain).
    transcribeBuffer: async () => (asrMode === 'enEcho' ? EN_TEXT : 'হ্যালো এই একটি পরীক্ষা'),
    synthesizeSpeech: async () => {
      throw new Error('z-ai TTS should not be called directly in this test');
    },
    imageSearchSdkFirst: async () => ({ via: 'sdk', results: [] }),
  };
});

// module under test — imported AFTER the mocks above
const {
  synthesizeVerifiedSpeech,
  verifySpeechBuffer,
  resolveVoice,
  detectLanguage,
  LANGUAGE_PROFILES,
  voiceCapabilityOf,
  speechErrorCode,
} = await import('@/lib/agent/audio/language_controller');

const BN_SPEC = {
  task: 'speech' as const,
  language: 'bn' as const,
  script: 'আমি আজ একটি ছোট গল্প শুনিয়ে দিচ্ছি তোমাদের সবাইকে।',
  voiceId: 'bn-BD-NabanitaNeural',
  outputFormat: 'wav' as const,
  sampleRate: 24000 as const,
  speed: 1,
};

const EN_SPEC = {
  task: 'speech' as const,
  language: 'en' as const,
  script: EN_TEXT,
  voiceId: 'en-US-AriaNeural',
  outputFormat: 'wav' as const,
  sampleRate: 24000 as const,
  speed: 1,
};

beforeEach(() => {
  shortWav = wavOfSeconds(0.2);
  okWav = toneWavOfSeconds(1.6);
  edgeOkWav = toneWavOfSeconds(2.0);
  edgeSilentWav = wavOfSeconds(2.0);
  edgeCalls.length = 0;
  zaiCalls.length = 0;
  edgeMode = 'throw403';
  zaiMode = 'ok';
  asrMode = 'bnSample';
});

describe('REG-1: Bengali TTS fallback when Edge returns 403 (R-FIX-1 contract)', () => {
  test(
    'REG-1a [R-FIX-1 — Defect A fixed]: Edge 403 on bn ⇒ typed VOICE_UNAVAILABLE — no silent cross-language fallback',
    async () => {
      // §4.2: "কোনো Bengali-capable voice বাস্তবে উপলব্ধ না হলে সৎভাবে
      // VOICE_UNAVAILABLE জানাতে হবে" — the exact observed catastrophe
      // (jam reading Bengali as Chinese garbage) is now structurally
      // impossible: bn has NO cross-engine fallback anymore.
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VOICE_UNAVAILABLE');
      // §4.2-এর হুবহু বার্তা
      expect(String(caught?.message)).toContain(
        'VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale'
      );
      // engine-aware skip: the first 403 kills the engine — the other
      // three Edge voices are never wasted on the dead engine
      expect(edgeCalls.map((c) => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
      // THE Defect-A lock: a z-ai (Chinese-trained) voice never reads Bengali
      expect(zaiCalls.length).toBe(0);
      expect(caught?.attempts).toBe(1);
    },
    20_000
  );

  test(
    'REG-1b [R-FIX-1 — RC-2]: all Edge candidates fail verification ⇒ typed VERIFICATION_FAILED — failing audio is never returned',
    async () => {
      // Every Edge voice *succeeds* but returns audio that FAILS
      // verification (0.2s, far below expected ~4.0s). The chain walks
      // the whole (Edge-only) bn profile, then rejects with the typed
      // verification-exhaustion error instead of returning garbage.
      edgeMode = 'shortWav';
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VERIFICATION_FAILED');
      expect(String(caught?.message)).toContain('VERIFICATION_FAILED');
      // the whole Edge section was walked, in chain order (no cap)
      expect(edgeCalls.map((c) => c.voice)).toEqual([
        'bn-BD-NabanitaNeural',
        'bn-BD-PradeepNeural',
        'bn-IN-TanishaaNeural',
        'bn-IN-BashkarNeural',
      ]);
      // bn chain has no z-ai voices to fall into
      expect(zaiCalls.length).toBe(0);
      expect(caught?.attempts).toBe(4);
    },
    20_000
  );

  test('REG-1c [R-FIX-1 — B-F01]: bn profile = Edge-neural ONLY, capability-tagged (fail-closed)', () => {
    const voices = LANGUAGE_PROFILES.bn.voices as string[];
    expect(voices).toEqual([
      'bn-BD-NabanitaNeural',
      'bn-BD-PradeepNeural',
      'bn-IN-TanishaaNeural',
      'bn-IN-BashkarNeural',
    ]);
    // Defect-A lock: the Chinese-trained voices are gone from the bn chain
    expect(voices).not.toContain('jam');
    expect(voices).not.toContain('douji');
    // every bn-chain voice is Edge + bn-capability-tagged
    // (untagged = structurally ineligible — fail-closed)
    for (const v of voices) {
      expect(isEdgeVoice(v)).toBe(true);
      const cap = voiceCapabilityOf(v);
      expect(cap?.languages).toContain('bn');
    }
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
    'REG-1f [R-FIX-1]: verify:false (pipeline lines 2+) also refuses cross-language fallback — VOICE_UNAVAILABLE',
    async () => {
      // short_film dialogue lines 2+ / voiceover chunks synthesize with
      // verify:false for cost control — that path must ALSO refuse the
      // cross-language fallback rather than emit wrong-language audio.
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(BN_SPEC, { verify: false });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VOICE_UNAVAILABLE');
      expect(edgeCalls.map((c) => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
      expect(zaiCalls.length).toBe(0);
    },
    20_000
  );

  test(
    'REG-1g [exhaustion honesty — en path]: both engines dead ⇒ honest typed rejection, no retry storm',
    async () => {
      // The old exhaustion contract, exercised on the en profile where
      // a z-ai fallback legitimately exists: Edge 403 kills the edge
      // engine, the z-ai throw kills that engine, and with no engine
      // left the call rejects honestly instead of fabricating a result.
      zaiMode = 'throw';
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(EN_SPEC, { verify: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VOICE_UNAVAILABLE');
      // সৎ বার্তা: সব TTS ইঞ্জিন অচল — ভান-সাফল্য নয়
      expect(String(caught?.message)).toContain('সব TTS ইঞ্জিন অচল');
      // exactly one call per engine — no retry storm on dead engines
      expect(edgeCalls.length).toBe(1);
      expect(zaiCalls.length).toBe(1);
    },
    20_000
  );

  test(
    'REG-1h [NEW — §4.5 case 1 (unit)]: bn + Edge-neural healthy audio ⇒ verdict pass (Bengali-trained voice)',
    async () => {
      // The happy path that must stay reachable: a Bengali-trained
      // neural voice producing duration-healthy audio is verified
      // 'pass' (duration check only — bn+Edge skips the ASR call by
      // design because ASR cannot validate Bengali pronunciation).
      edgeMode = 'okWav';
      const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });

      expect(result.voice).toBe('bn-BD-NabanitaNeural');
      expect(result.attempts).toBe(1);
      expect(result.verification.verdict).toBe('pass');
      expect(result.verification.notes.some((n) => n.includes('বাংলা-প্রশিক্ষিত নিউরাল কণ্ঠ'))).toBe(true);
      expect(zaiCalls.length).toBe(0);
    },
    20_000
  );

  test(
    "REG-1i [NEW — B-F05]: an en result obtained after an engine fallback is capped at 'warn' — never 'pass'",
    async () => {
      // Even a PERFECT ASR round-trip (similarity 1.0, token coverage
      // 1.0) on a z-ai fallback voice cannot claim 'pass' — the
      // real-run false positive (romanized garbage at 0.57 similarity
      // certified 'pass') is the lesson: fallback results stay at warn.
      edgeMode = 'throw403';
      asrMode = 'enEcho';
      const result = await synthesizeVerifiedSpeech(EN_SPEC, { verify: true });

      // the en chain legitimately reaches the z-ai fallback
      expect(result.voice).toBe('jam');
      expect(result.attempts).toBe(2);
      // …but the verdict is capped
      expect(result.verification.verdict).toBe('warn');
      expect(result.verification.notes.some((n) => n.includes('ইঞ্জিন-ফলব্যাক'))).toBe(true);
      expect(result.verification.notes.some((n) => n.includes('সর্বোচ্চ'))).toBe(true);
    },
    20_000
  );

  test(
    'REG-1j [NEW — D-2/B2]: plausible-duration SILENT audio can NEVER pass — every chain candidate fails SILENCE_DETECTED ⇒ typed VERIFICATION_FAILED',
    async () => {
      // পুরনো গর্ত (D-2): 2.0s বিশুদ্ধ-নীরবতা বাংলা+Edge পথে "pass" হতো —
      // দৈর্ঘ্যই যথেষ্ট ছিল, নীরবতা-গেট ছিল না। এখন নীরবতা-গেট প্রতিটি
      // প্রার্থীকে fail করে (SILENCE_DETECTED) এবং চেইন-ক্ষয় typed
      // VERIFICATION_FAILED-এ শেষ হয় — lastVerification-এ কাঠামোবদ্ধ কারণসহ।
      edgeMode = 'silentWav';
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VERIFICATION_FAILED');
      expect(String(caught?.message)).toContain('VERIFICATION_FAILED');
      // সবগুলো প্রার্থীই নীরবতায় ব্যর্থ — ৪টি Edge কণ্ঠ হাঁটা হয়েছে
      expect(caught?.attempts).toBe(4);
      // কাঠামোবদ্ধ ব্যর্থতার কারণ (B2: "not just 'false'")
      expect(caught?.lastVerification?.failureCode).toBe('SILENCE_DETECTED');
      expect(String(caught?.lastVerification?.notes?.[0] ?? '')).toContain('SILENCE_DETECTED');
      expect(caught?.lastVerification?.silenceCoverage).toBeGreaterThanOrEqual(0.9);
      expect(zaiCalls.length).toBe(0); // ভাষা-ভাঙা ফলব্যাক নয়
    },
    20_000
  );

  test(
    'REG-1k [NEW — D-2/B2-স্তর ১]: corrupt/unparseable audio ⇒ fail with typed INVALID_AUDIO (not a misleading duration note)',
    async () => {
      // করাপ্ট বাইট-গাদা — ffprobe/astats নিজেই ব্যর্থ → quality=null →
      // আগে এটি ব্যাখ্যাহীন "দৈর্ঘ্য-কম" ফেল হতো; এখন টাইপড INVALID_AUDIO
      const corrupt = Buffer.from('এটি কোনো অডিও ফাইল নয় — শুধু টেক্সট-বাইট।'.repeat(20));
      const v = await verifySpeechBuffer(corrupt, 'wav', BN_SPEC, 'bn-BD-NabanitaNeural');
      expect(v.verdict).toBe('fail');
      expect(v.failureCode).toBe('INVALID_AUDIO');
      expect(v.notes.some((n) => n.includes('পার্স/ডিকোড'))).toBe(true);
      expect(v.silenceCoverage).toBe(1); // durationSec=0 → সংজ্ঞাগত সম্পূর্ণ-নীরব
    },
    20_000
  );

  test(
    'REG-1l [NEW — D-2/B2-ক্যালিব্রেশন]: quiet-but-valid speech (RMS −৪০dB-এর কাছে) is NOT rejected — honest warn only',
    async () => {
      // "Do not reject legitimate quiet speech solely because it is
      // quiet" — শান্ত টোন (amp 0.015 → RMS ≈ −৩৯.৫dB, নীরবতা-সীমা −৫০dB-এর
      // উপরে) প্রত্যাখ্যাত নয়; রায় সৎ "সতর্কতা" + খুব-শান্ত নোট।
      const quiet = toneWavOfSeconds(2.0, { amplitude: 0.015 });
      const v = await verifySpeechBuffer(quiet, 'wav', BN_SPEC, 'bn-BD-NabanitaNeural');
      expect(v.verdict).toBe('warn');
      expect(v.failureCode).toBeUndefined(); // প্রত্যাখ্যাত নয়
      expect(v.notes.some((n) => n.includes('খুব শান্ত'))).toBe(true);
      expect(v.rmsDb).toBeLessThan(-38);
      expect(v.rmsDb).toBeGreaterThan(-50);
    },
    20_000
  );
});
