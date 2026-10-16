# Phase 0 — Media Quality Baseline (Work Package E)

All measurements taken in this window with ffprobe 7.1.5 / FFmpeg ebur128 on the artifacts present in `storage/artifacts/` (produced by the recorded short-film session; no new generation was run for this audit). Technical validation only — **perceptual quality (realistic singing, cinematic movement, character continuity) is not inferred from technical metadata** and is explicitly out of scope per the honesty policy.

## 1. Inventory (8 artifacts, DB-registered)

| File | Kind / origin | Producer | DB meta highlights |
|---|---|---|---|
| `mv91fm25-…txt` (4,964 B) | text / tool | `plan_music` | 5 sections, 90 BPM |
| `mv91hecp-…wav` (10,584,044 B) | audio / tool | procedural instrumental | joyful, 104 BPM, G major, 60 s, beat markers |
| `mv91hf5f-…mp3` (1,441,375 B) | audio / tool | MP3 co-registration of the above | 192 kbps |
| `mv91nlio-…txt` (4,719 B) | text / production | short_film `script_breakdown` | 3 scenes / 3 shots |
| `mv91p5t5-…png` (80,790 B) | image / production | character bible portrait | রাহুল, bn-BD-NabanitaNeural |
| `mv91quwk-…png` (105,539 B) | image / production | character bible portrait | অর্পিতা, bn-BD-PradeepNeural |
| `mv92hnu7-…srt` (372 B) | text / production | dialogue subtitles | 4 cues, Bengali |
| `mv92hnur-…mp4` (24,705,761 B) | video / production | short_film final mix | 3× CogVideoX-3 shots, subtitles burned |

## 2. Audio baseline

### `instrumental-joyful-104bpm.wav` (procedural music engine output)
- **Container/codec:** WAV, `pcm_s16le`, **44 100 Hz, 2 channels (stereo), 16-bit** — matches engine contract (SR 44100, encodeWav stereo PCM16).
- **Duration:** 60.000 s exactly (requested 60; engine 2-dp accuracy → PASS).
- **Loudness (ebur128):** integrated ≈ −21.8 LUFS region with **LRA 12.4 LU** (dynamic, not over-compressed); **Peak −1.5 dBFS** — matches the engine's normalization target 0.84 (≈ −1.5 dBFS); **0 silence ranges** at −45 dB / 1.2 s threshold.
- **Decodability:** clean ffprobe parse; no truncation; size = 60 s × 44 100 × 2 ch × 2 B + header (10,584,044 B ✓ exact).
- **Verdict:** technically valid; honest engine label attached ("প্রসিডিউরাল … নিউরাল মিউজিক-মডেল নয়"). Perceptual musicality: **not evaluated** (would need human listening).

### `instrumental-joyful-104bpm.mp3` (192 kbps co-registration)
- MP3, 44.1 kHz stereo, **60.029 s** (+29 ms vs WAV = normal MP3 encoder padding), 192 kbps CBR ✓.
- **Note:** MP3 path intentionally skips loudnorm (engine dynamics preserved) — documented in artifact meta `mastering`.

### Dialogue audio — **ABSENT (defect evidence)**
- The film's 4 Bengali dialogue lines produced **no audio** (Edge TTS 403 ×4 → subtitle-only). No clipping/silence analysis possible for dialogue. See P0-BUG-01.

## 3. Video baseline — `studio.mp4` (short film "অপেশার ছায়া")

- **Container:** mp4 (`mov,mp4,m4a,…`), 24,705,761 B, ~6.57 Mbps.
- **Video stream:** `h264`, **1080×1920** (9:16 1080p — matches spec aspect 9:16 + resolution), **30 fps exactly** (`30/1`, 903 frames → 30.1 s ✓), no frame-rate drift.
- **Audio stream:** `aac`, 44.1 kHz stereo, 30.100 s.
- **A/V sync:** video 30.100 s = audio 30.100 s → **delta 0 ms** (`avSyncOk: true` in DB technicalReport — independently re-verified by ffprobe).
- **Duration contract:** spec requested 30 s → 30.1 s (within ±4 s QC tolerance; the extra 0.1 s is the subtitle/fade tail).
- **Decodability:** full ffprobe stream parse; frame count consistent with fps × duration.
- **Technical report (from production resultJson, cross-checked):** loudness **−25.4 LUFS**, peak **−14.74 dB**, mix issues none, subtitles burned-in ✓.
  - ⚠ **Loudness gap:** −25.4 LUFS is ~9 LU below the voiceover master target (−16 LUFS). With dialogue absent, the mix is the low-level ambient/score bed only — audible but quiet. Tracked as P0-BUG-02.
- **Shot provenance:** `shotEngines` = 3× `ai_video` (CogVideoX-3) — **no silent storyboard substitution**; honest labels attached (`lipSync:false` — mouth motion is not claimed).
- **Perceptual caveats (not inferable from metadata):** realism of motion, scene continuity, and subtitle legibility after burn-in require human review — **not evaluated** in Phase 0.

## 4. Image baseline (portraits)

- Both PNGs: `mjpeg/png` streams, **864×1152** (4:5 gen-size map ✓), sizes 80–105 KB, decodable.
- Character meta links each portrait to name + assigned voice — the continuity chain the VLM `continuity` step consumes.

## 5. Text/SRT baseline

- SRT: 4 cues, valid `HH:MM:SS,mmm --> …` timestamps, Bengali text, cue gaps ≥250 ms — well-formed; registered as artifact and burned into the MP4.
- Song plan + screenplay text artifacts: UTF-8 Bengali, parseable, section/scene counts consistent with DB meta.

## 6. Baseline summary table

| Artifact | Duration | Codec/Res | SR/Ch | Loudness | Peak | Silence | A/V sync | Status |
|---|---|---|---|---|---|---|---|---|
| instrumental.wav | 60.000 s | pcm_s16le | 44.1k/2 | — | −1.5 dBFS | 0 ranges | n/a | ✅ Valid |
| instrumental.mp3 | 60.029 s | mp3 192k | 44.1k/2 | — | — | — | n/a | ✅ Valid (+29 ms padding, normal) |
| studio.mp4 | 30.100 s | h264 1080×1920@30 | aac 44.1k/2 | −25.4 LUFS ⚠ | −14.7 dB | — | ✅ 0 ms | ⚠ Valid but quiet; dialogue absent |

**No artifact exhibits an obvious output failure** (zero-duration, black-only, silent-only, undecodable) — with the two honest degradations noted: dialogue audio missing (P0-BUG-01) and low loudness (P0-BUG-02).
