// ============================================================
// REGRESSION TEST 5 — Instrumental audio (procedural engine)
//
// Boundaries:
//  - Module under test: REAL src/lib/agent/audio/music_engine.ts
//    (synthesizeInstrumental + validateInstrumental + helpers).
//    No mocks, no network — the engine is deterministic when a
//    seed is provided. REAL ffmpeg (audioQuality) runs on real
//    temp files to validate output integrity.
//  - Output registration (DB artifact rows) is pipeline-level and
//    DB-dependent; Phase-1 evidence for it comes from the existing
//    dev-database artifacts (see the Phase-1 report §5) — the test
//    suite stays hermetic.
//
// Contract:
//  - output is a structurally valid WAV (RIFF/WAVE, 44.1kHz, 16-bit)
//  - metadata is truthful: duration ≈ requested (clamped 8–120s),
//    tempoBpm honored (clamped to mood range), keyLabel, beat
//    markers, sections, honest procedural label (no neural claim)
//  - validateInstrumental passes on engine output (real ffmpeg)
//  - same seed → identical bytes (determinism)
//  - invalid specs are clamped, not crashed (except unknown mood —
//    current failure mode documented)
// ============================================================

import { describe, expect, test } from 'bun:test';

const { synthesizeInstrumental, validateInstrumental, detectMoodFromText, moodLabel } = await import(
  '@/lib/agent/audio/music_engine'
);

describe('REG-5: instrumental audio generation (procedural, deterministic)', () => {
  test(
    'REG-5a: nominal synthesis produces a valid WAV with truthful metadata',
    async () => {
      const res = await synthesizeInstrumental({
        mood: 'joyful',
        durationSec: 10,
        tempoBpm: 104,
        seed: 42,
      });

      // --- WAV structure (real bytes, not byte-for-byte golden) ---
      expect(res.buffer.length).toBeGreaterThan(44);
      expect(res.buffer.slice(0, 4).toString('ascii')).toBe('RIFF');
      expect(res.buffer.slice(8, 12).toString('ascii')).toBe('WAVE');
      // PCM header fields: sample rate @24, bits per sample @34 (LE)
      const sampleRate = res.buffer.readUInt32LE(24);
      expect([44100, 48000]).toContain(sampleRate);
      expect(res.buffer.readUInt16LE(34)).toBe(16);
      // data chunk size consistency (buffer long enough for the duration)
      const dataLen = res.buffer.readUInt32LE(40);
      expect(dataLen).toBeGreaterThanOrEqual(Math.floor(8 * sampleRate) * 4);

      // --- truthful metadata ---
      expect(Math.abs(res.meta.durationSec - 10)).toBeLessThanOrEqual(1.5);
      expect(res.meta.tempoBpm).toBe(104);
      expect(typeof res.meta.keyLabel).toBe('string');
      expect(res.meta.keyLabel.length).toBeGreaterThan(0);
      expect(res.meta.beatsSec.length).toBeGreaterThanOrEqual(2);
      expect(res.meta.sections.length).toBeGreaterThanOrEqual(1);
      // honest labeling: procedural synthesis, explicitly NOT a neural model
      expect(res.meta.honestLabel).toContain('প্রসিডিউরাল');
      expect(res.meta.honestLabel).toContain('নিউরাল মিউজিক-মডেল নয়');
    },
    30_000
  );

  test(
    'REG-5b: validateInstrumental accepts engine output (real ffmpeg quality gate)',
    async () => {
      const res = await synthesizeInstrumental({
        mood: 'peaceful',
        durationSec: 10,
        tempoBpm: 90,
        seed: 7,
      });
      const v = await validateInstrumental(res.buffer, res.meta);
      // engine output must pass its own quality gate: duration matches,
      // no clipping, no long silence
      expect(v.issues).toEqual([]);
      expect(v.ok).toBe(true);
      expect(Math.abs(v.durationSec - res.meta.durationSec)).toBeLessThanOrEqual(2);
      expect(v.durationSec).toBeGreaterThan(8);
      // loudness/peak reported for the observability trail
      expect(typeof v.peakDb).toBe('number');
    },
    30_000
  );

  test(
    'REG-5c: determinism — same seed synthesizes identical bytes',
    async () => {
      const a = await synthesizeInstrumental({ mood: 'joyful', durationSec: 8, tempoBpm: 100, seed: 7 });
      const b = await synthesizeInstrumental({ mood: 'joyful', durationSec: 8, tempoBpm: 100, seed: 7 });
      expect(a.buffer.equals(b.buffer)).toBe(true);
      expect(a.meta.beatsSec).toEqual(b.meta.beatsSec);
    },
    30_000
  );

  test(
    'REG-5d: spec clamping — durationSec is clamped to [8, 120], tempo to the mood range',
    async () => {
      const tooShort = await synthesizeInstrumental({ mood: 'sad', durationSec: 0, seed: 1 });
      expect(tooShort.meta.durationSec).toBeGreaterThanOrEqual(8);

      const tooLong = await synthesizeInstrumental({ mood: 'sad', durationSec: 500, seed: 2 });
      expect(tooLong.meta.durationSec).toBeLessThanOrEqual(120);

      // tempo clamped into the mood's allowed range (sad ≠ 200bpm)
      const wildTempo = await synthesizeInstrumental({ mood: 'sad', durationSec: 8, tempoBpm: 200, seed: 3 });
      expect(wildTempo.meta.tempoBpm).toBeLessThan(200);
      expect(wildTempo.meta.tempoBpm).toBeGreaterThanOrEqual(40);
    },
    30_000
  );

  test(
    'REG-5e [failure handling — current mode documented]: an unknown mood is a hard failure (no graceful error yet)',
    async () => {
      // MOOD_CONFIGS[spec.mood] is undefined → TypeError on bpmRange.
      // Recorded as-is; a graceful zod-style error would be better.
      let err: unknown = null;
      try {
        await synthesizeInstrumental({
          mood: 'nonexistent' as never,
          durationSec: 8,
          seed: 1,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
    },
    10_000
  );

  test('REG-5f [supporting units]: mood detection + labels', () => {
    expect(detectMoodFromText('বিদায়ের কষ্ট আর কান্না')).toBe('sad');
    expect(detectMoodFromText('উৎসবের আনন্দ আর হাসি')).toBe('joyful');
    expect(detectMoodFromText('নিস্পৃত অর্থহীন শব্দ')).toBeNull();
    expect(moodLabel('peaceful')).toBe('শান্ত');
    expect(moodLabel('action')).toBe('অ্যাকশন');
  });
});
