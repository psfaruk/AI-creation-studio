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
// CONTRACT-STRENGTHENING (LF-0, 2026-10-17 — latest-fix Phase 1):
//  - bn chain now ends with ONE more REAL Bengali provider: Google-Translate
//    TTS (bn-GOOG-Default) — live-verified in this environment (probe:
//    correct duration/RMS + ASR semantic round-trip; baseline-report §৩.৩).
//  - Edge-403 alone NO LONGER exhausts the bn chain: the honest fallback
//    now reaches Google. VOICE_UNAVAILABLE requires BOTH Edge AND Google
//    to be dead (the §4.2 message names both providers).
//  - Cross-engine silence is still absolute: a z-ai (Chinese-trained)
//    voice NEVER reads Bengali — the Google voice is bn-capability-tagged
//    and Bengali-speaking (live-proven), so it is NOT a language break.
//  - Fallback results stay capped at 'warn' (B-F05) and carry honest
//    engine-fallback notes; languageStatus = AUDIO_VALIDATION_ONLY (§1.4 —
//    no script-preserving Bengali ASR exists in this environment).
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
import { isGoogVoice, GOOGLE_TTS_VOICE } from '@/lib/agent/audio/google_tts';
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
const googCalls: MockCall[] = [];

/** Mock behavior switch for Edge voices (read at call time). */
let edgeMode: 'throw403' | 'shortWav' | 'okWav' | 'silentWav' = 'throw403';
/** Mock behavior switch for z-ai voices (read at call time). */
let zaiMode: 'ok' | 'throw' = 'ok';
/** LF-0: Google-Translate voice behavior switch (read at call time). */
let googMode: 'okWav' | 'shortWav' | 'silentWav' | 'throw' = 'okWav';
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
/** LF-0: 5.5s অ-নীরব টোন — Google-কণ্ঠের সুস্থ বাংলা-দৈর্ঘ্য ফিক্সচার
 *  (BN_SPEC ≈৪.৫ সে. প্রত্যাশা → উইন্ডো [১.৮, ১১.৭]) */
let googOkWav: Buffer;

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
      // LF-0: Google-Translate কণ্ঠ — bn-চেইনের সৎ ফলব্যাক ইঞ্জিন
      if (isGoogVoice(voice)) {
        googCalls.push({ voice, text });
        if (googMode === 'throw') {
          throw new Error('Google TTS ব্যর্থ — রেট-লিমিট (HTTP 429)');
        }
        if (googMode === 'shortWav') {
          return { buffer: shortWav, mimeType: 'audio/wav', ext: 'wav' };
        }
        if (googMode === 'silentWav') {
          return { buffer: edgeSilentWav, mimeType: 'audio/wav', ext: 'wav' };
        }
        return { buffer: googOkWav, mimeType: 'audio/wav', ext: 'wav' };
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
  googOkWav = toneWavOfSeconds(5.5);
  edgeCalls.length = 0;
  zaiCalls.length = 0;
  googCalls.length = 0;
  edgeMode = 'throw403';
  zaiMode = 'ok';
  googMode = 'okWav';
  asrMode = 'bnSample';
});

describe('REG-1: Bengali TTS fallback when Edge returns 403 (R-FIX-1 contract)', () => {
  test(
    'REG-1a [LF-0 strengthening — Defect A stays fixed]: Edge 403 on bn ⇒ honest Google-Bengali fallback (capped warn, fallback notes, AUDIO_VALIDATION_ONLY)',
    async () => {
      // LF-0 (2026-10-17): bn-চেইনে এখন দ্বিতীয় প্রকৃত বাংলা প্রোভাইডার —
      // Google-Translate TTS (লাইভ-যাচাইকৃত)। Edge-403 একা আর চেইন শেষ
      // করে না: সৎ ফলব্যাক Google-কণ্ঠে পৌঁছায়। ভুল-ভাষা (z-ai) নীরব
      // ফলব্যাক তবুও অসম্ভব।
      edgeMode = 'throw403';
      googMode = 'okWav';
      const result = await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });
      // প্রকৃত কণ্ঠ = Google-বাংলা; Edge নয়, z-ai নয়
      expect(result.voice).toBe(GOOGLE_TTS_VOICE);
      expect(result.engine).toBe('goog');
      // engine-aware skip: the first 403 kills the engine — the other
      // three Edge voices are never wasted on the dead engine
      expect(edgeCalls.map((c) => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
      expect(googCalls.map((c) => c.voice)).toEqual([GOOGLE_TTS_VOICE]);
      // THE Defect-A lock: a z-ai (Chinese-trained) voice never reads Bengali
      expect(zaiCalls.length).toBe(0);
      // B-F05: ইঞ্জিন-ফলব্যাকের পরে রায় সর্বোচ্চ "warn" + সৎ ফলব্যাক-নোট
      expect(result.verification.verdict).toBe('warn');
      expect(result.verification.notes.join(' ')).toContain('ইঞ্জিন-ফলব্যাক');
      // §1.4: ভাষা-স্ট্যাটাস সৎ — script-preserving ASR নেই
      expect((result.verification as any).languageStatus).toBe('AUDIO_VALIDATION_ONLY');
      expect(result.attempts).toBe(2);
    },
    20_000
  );

  test(
    'REG-1a-2 [LF-0 — §4.2 exhaustion]: Edge 403 AND Google dead ⇒ typed VOICE_UNAVAILABLE naming both providers',
    async () => {
      // §4.2: "কোনো Bengali-capable voice বাস্তবে উপলব্ধ না হলে সৎভাবে
      // VOICE_UNAVAILABLE জানাতে হবে" — এখন দুই প্রকৃত প্রোভাইডারই অচল
      // হলে তবেই এই বার্তা; বার্তাটি উভয় প্রোভাইডারের নাম সততার সাথে বহন করে।
      edgeMode = 'throw403';
      googMode = 'throw';
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VOICE_UNAVAILABLE');
      // §4.2-এর হুবহু বার্তা-উপসর্গ
      expect(String(caught?.message)).toContain(
        'VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale'
      );
      // উভয় প্রোভাইডারের সৎ উল্লেখ
      expect(String(caught?.message)).toContain('Edge-নিউরাল');
      expect(String(caught?.message)).toContain('Google-Translate');
      expect(edgeCalls.map((c) => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
      expect(googCalls.map((c) => c.voice)).toEqual([GOOGLE_TTS_VOICE]);
      expect(zaiCalls.length).toBe(0);
      expect(caught?.attempts).toBe(2);
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
      googMode = 'shortWav'; // LF-0: Google-ও অসুস্থ অডিও দিলে তবেই ক্ষয়
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
      // LF-0: শেষ প্রার্থী Google-ও যাচাইে ব্যর্থ হয়েছে
      expect(googCalls.map((c) => c.voice)).toEqual([GOOGLE_TTS_VOICE]);
      // bn chain has no z-ai voices to fall into
      expect(zaiCalls.length).toBe(0);
      expect(caught?.attempts).toBe(5);
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
      GOOGLE_TTS_VOICE, // LF-0: শেষ প্রার্থী — লাইভ-যাচাইকৃত বাংলা ফলব্যাক
    ]);
    // Defect-A lock: the Chinese-trained voices are gone from the bn chain
    expect(voices).not.toContain('jam');
    expect(voices).not.toContain('douji');
    // every bn-chain voice is a REAL engine (Edge/Google) + bn-capability-tagged
    // (untagged = structurally ineligible — fail-closed)
    for (const v of voices) {
      expect(isEdgeVoice(v) || isGoogVoice(v)).toBe(true);
      const cap = voiceCapabilityOf(v);
      expect(cap?.languages).toContain('bn');
    }
  });

  test('REG-1d [supporting unit]: resolveVoice upgrades a non-Edge bn preference to the neural primary', () => {
    // Bengali + z-ai preference → well-meaning upgrade to Nabanita
    expect(resolveVoice('bn', 'jam')).toBe('bn-BD-NabanitaNeural');
    expect(resolveVoice('bn', undefined)).toBe('bn-BD-NabanitaNeural');
    // LF-0: Google-কণ্ঠ সচেতন পছন্দ — সদিচ্ছা-আপগ্রেডে উপেক্ষিত নয়
    expect(resolveVoice('bn', GOOGLE_TTS_VOICE)).toBe(GOOGLE_TTS_VOICE);
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
      // LF-0 ভাগ ১: Google সুস্থ হলে verify:false পথও প্রকৃত বাংলা
      // ফলব্যাক ফেরত দেয় (ভুল-ভাষা নয়) — সৎ quickNotes-সহ
      googMode = 'okWav';
      const quick = await synthesizeVerifiedSpeech(BN_SPEC, { verify: false });
      expect(quick.voice).toBe(GOOGLE_TTS_VOICE);
      expect((quick.verification as any).languageStatus).toBe('LANGUAGE_UNVERIFIED');
      expect(quick.verification.notes.join(' ')).toContain('ইঞ্জিন-ফলব্যাক');
      expect(zaiCalls.length).toBe(0);
      // অংশ ২-এর আগে কল-নথি রিসেট (দুই অংশের নথি আলাদা থাকুক)
      edgeCalls.length = 0;
      googCalls.length = 0;
      // LF-0 ভাগ ২: উভয় প্রোভাইডার অচল হলে সৎ VOICE_UNAVAILABLE
      googMode = 'throw';
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(BN_SPEC, { verify: false });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VOICE_UNAVAILABLE');
      expect(edgeCalls.map((c) => c.voice)).toEqual(['bn-BD-NabanitaNeural']);
      expect(googCalls.map((c) => c.voice)).toEqual([GOOGLE_TTS_VOICE]);
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
      googMode = 'silentWav'; // LF-0: Google-ও নীরব অডিও দিলে তবেই ক্ষয়
      let caught: any;
      try {
        await synthesizeVerifiedSpeech(BN_SPEC, { verify: true });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(speechErrorCode(caught)).toBe('VERIFICATION_FAILED');
      expect(String(caught?.message)).toContain('VERIFICATION_FAILED');
      // সবগুলো প্রার্থীই নীরবতায় ব্যর্থ — ৪টি Edge + ১টি Google কণ্ঠ হাঁটা হয়েছে
      expect(caught?.attempts).toBe(5);
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
