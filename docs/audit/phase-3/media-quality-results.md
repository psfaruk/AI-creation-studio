# Phase 3 — Media Quality Results (Workstream B: final-mix loudness)

Fix under test: `mixSoundLayers` (`sound_design.ts`) now applies two-pass
`loudnorm` **after** the §8 layer merge (dialogue+ambience+foley+music+narration),
targeting **−16 LUFS integrated / −1.5 dBTP** (`DEFAULT_MIX_RULES.targetLufs`),
with honest skip on silent mixes and explicit errors for unsupported layouts.
Helpers: `measureLoudness` / `normalizeLoudnessTwoPass` (`src/lib/media/ffmpeg.ts`).

All measurements below are **real ffmpeg 7.1.1–class tooling on real files**
(ebur128 with `peak=true`; loudnorm analysis JSON; ffprobe) — evidence class
**local-integration**. The measurement tooling itself is asserted non-circularly in
REG-9a (independent ebur128 re-run agrees with the reported value within 0.3 LU).

## 1. Fixture before/after (8s three-layer mix — real procedural engines)

Fixture: A1 dialogue = honest synthetic PCM voice (tone bursts, test-declared);
A2 ambience = real `renderSoundscapeBed(planSoundscape('রাতের বৃষ্টিতে বাজারের ভিড়'))`;
A4 music = real `synthesizeInstrumental({mood:'joyful', seed:42})`; gains set to
reproduce the quiet-mix signature of the recorded bug.

| Metric | Before (raw mix, old behavior) | After (Phase-3 mix) | Target / tolerance |
|---|---|---|---|
| Integrated loudness | **−24.3 LUFS** (REG-9a) / −24.8 LUFS (cost-run) | **−15.9 LUFS** | −16 ±1.0 ✅ |
| True peak | (unmanaged, sample-peak −18.9 dB) | **−10.5 dBTP** (REG-9a) / −10.7 dBTP (cost-run) | ≤ −1.5 +0.3 ✅ |
| Duration | 8.0 s | 8.0 s (±0.05 s asserted) | preserved ✅ |
| Channel layout | stereo | stereo (mono verified separately: 1→1) | preserved ✅ |
| Report fields | loudness only, no target | targetLufs / loudnessApplied / normalizedLufs / truePeakDbtp | truthful ✅ |

Context: the recorded production `yrz3ymb7` measured **−25.4 LUFS** (Phase-0,
P0-BUG-02) with the old code — the fixture's −24.3/−24.8 LUFS reproduces that
signature class, and the fix lands it at −15.9 LUFS.

## 2. Edge cases (all real-codec, all asserted in REG-9)

| Case | Behavior | Result |
|---|---|---|
| Silent mix (digital zeros) | loudnorm analysis returns `input_i:"-inf"` → no normalization attempted; byte-copy + `applied:false, reason:'silence'`; report raises honest issue, `ok:false` | PASS |
| Corrupt input (garbage bytes) | helper **throws**; no output file created — non-zero ffmpeg exit is never disguised as success | PASS |
| >2-channel layout (6ch) | explicit `অসমর্থিত চ্যানেল-বিন্যাস` error — no silent downmix | PASS |
| Mono input | mono in → mono out (no mono→stereo assumption) | PASS |
| Normalization ffmpeg failure (catch path) | raw mix kept + honest issue `লাউডনেস-সাম্য প্রয়োগ ব্যর্থ…` (code-inspected 3-line branch; the throw itself is REG-9e-proven) | code-inspected |

## 3. Full-path integration (normalized mix → real mux)

REG-9b: normalized 8s mix muxed (real `muxAudio`, `-c:v copy`) onto a real
`testsrc2` h264 320×240@30 video → output asserts: h264 ✅, 320×240 ✅,
fps 30±1.5 ✅, duration 8±0.3 s ✅, audio stream present ✅. Video stream is
copied (never re-encoded by the mix step), so fps/resolution/duration of the video
are structurally preserved; audio fade/pad behavior unchanged from the existing
`muxAudio` contract.

## 4. NOT RUN / BLOCKED (honest record)

| Item | Status | Reason |
|---|---|---|
| Before/after on the **real recorded** short-film MP4 (`yrz3ymb7`, −25.4 LUFS) | **NOT RUN** | The artifact existed only in the previous sandbox instance's runtime storage; this instance (snapshot-restored) has no recorded media, and regenerating one requires live provider calls (unauthorized budget in this phase). The fixture evidence above (real engines → real mix path → real ebur128) is the strongest available without budget. |
| Live end-to-end film render with the new mix | **NOT RUN** | same budget reason |

## 5. Tooling notes (ffmpeg 7.1.5 specifics, discovered and handled)

1. ebur128's summary prints the true-peak **under the `True peak:` heading with a
   dBFS unit label** — `measureLoudness` parses that section (with the live `TPK:`
   line as fallback) rather than trusting a `dBTP` suffix.
2. Digital silence makes loudnorm's analysis emit `input_i:"-inf"`; passing that on
   as `measured_I` is a filter error ("Numerical result out of range") — the helper
   treats ≤ −69.5 LUFS / `-inf` as silence and skips honestly.
3. `loudnorm … linear=true` applies a static gain within dynamic-range limits
   (timing untouched); the TP target is enforced by the filter itself.
