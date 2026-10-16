# Recovery Phase 1–5 — Offline Media Backtest Results (Layer C) (R-DOC-3)

Layer C = offline media forensics on the **real, existing artifacts on disk** — zero provider
calls, zero spend. Executed by Recovery Audit E (2026-10-16, ffmpeg/ffprobe 7.1.5-0+deb13u1);
full tables, exact commands and JSON outputs in `findings/findings-e.md` §2–§3
(raw probe outputs preserved under `/tmp/r-e-probe/`). This file records the results, the
defects Layer C found, and how the fix wave answered them.

## 1. Inventory backtested — 14 real live-provider files (12 unique by content)

| # | File (short) | Origin | Key forensics |
|---|---|---|---|
| A1 | `storage/artifacts/mvbbyh49…` ≡ `mvbbynz7…` ≡ tts-cache `ec/45/…` — **`speech-bn-jam.wav`** (defect evidence) | LIVE z-ai TTS, voice `jam`, bn text 58 chars (after Edge 403) | pcm_s16le 24 kHz mono, 14.300 s; I=−25.2 LUFS, TP=−3.0; 8 silences 0.40–0.46 s — physically consistent with the DB transcript's meaningless syllable repetition |
| A2 | `storage/artifacts/mvbbz23v…` — **`speech-en-tongtong.wav`** (defect evidence) | LIVE z-ai TTS, `tongtong`, en-labeled text | 24 kHz mono, 10.380 s; I=−21.5 LUFS; ASR transcript = romanized-Bengali-like English, similarity 0.57 |
| A3 | `narration-a5.wav` (tts-cache `ba/c9/…`) | LIVE z-ai `jam`, bn narration 356 chars | 41.100 s; I=−24.2 LUFS; 14 pauses — **the file whose 87% got silently truncated in the final mix (E-F02)** |
| A4 | `dialogue-1-studio.wav` | LIVE z-ai `jam`, "কি খারাপ দিন।" | 3.620 s; I=−22.0 LUFS |
| A5 | `dialogue-2-studio.wav` | LIVE z-ai `douji`, "বৃষ্টি ভালোই লাগে।" | 10.600 s for 18 chars, **zero** pauses ≥0.4 s — continuous unnatural elongation; the pipeline's own verdict machinery correctly failed it (E-F11) |
| A6/A7 | two tts-cache-only WAVs | LIVE z-ai `jam` | 9.020 s / 11.460 s, same 24 kHz mono signature |
| V1–V3 | `storage/shot-cache/{e0/37, 67/c6, 1d/46}/…mp4` | **LIVE cogvideox-3 clips** (tasks 20261017025850…, …030618…, …031206…) | h264 yuv420p; V1 **1890×1080 @31 fps** 10.226 s (317 frames), V2/V3 **1080×1440 @31 fps** 10.290 s (319 frames); **no audio stream** (matches cache meta `hasAudio:false`) |
| V4 | `storage/artifacts/mvbcpfar…mp4` — final "দুঃখের বৃষ্টি" film (production `cmvbbv86c…`, status `partial`) | local encode (Lavf61.7.103/libx264) from V1–V3 + 5-layer mix + burned Bengali SRT | h264 1080×1920 @24 fps, 720 frames, 30.000 s + AAC 44.1 kHz stereo 30.000 s; **A/V skew 0.000 s** |
| I1–I3 | 3 `storage/artifacts/*.png` | LIVE z-ai image-gen | **JPEG (JFIF) bytes under `.png` names / `image/png` labels** (E-F03) — 1344×768, 864×1152, 864×1152 |

Synthetic media on disk (correctly excluded from live counts): 1 corrupt `garbage.wav`
fixture, 9 leftover `/tmp/reg18-fixture-*` procedural `song.wav`s, 1 phase-5 screenshot.
**Lip-sync media: none anywhere** — consistent with the honest-blocked module.

## 2. Audio forensics results (ebur128 / silencedetect / volumedetect, per unique WAV)

| File | dur s | I (LUFS) | TP (dBFS) | mean/max vol dB | silences ≥0.4 s |
|---|---|---|---|---|---|
| speech-bn-jam (A1) | 14.30 | −25.2 | −3.0 | −27.7 / −3.0 | 8 (0.40–0.46 s) |
| speech-en-tongtong (A2) | 10.38 | −21.5 | −2.7 | −22.2 / −3.0 | 2 (0.61–0.68 s) |
| narration-a5 (A3) | 41.10 | −24.2 | −2.6 | −25.9 / −3.0 | 14 (0.42–0.76 s) |
| dialogue-1 (A4) | 3.62 | −22.0 | −2.5 | −24.1 / −3.0 | 2 (0.41–0.53 s) |
| dialogue-2 (A5) | 10.60 | −17.6 | −3.0 | −18.0 / −3.0 | 0 |
| cache 4f73c4f3 (A6) | 9.02 | −22.1 | −3.0 | −23.7 / −3.0 | 1 (0.40 s) |
| cache a7a6488e (A7) | 11.46 | −23.1 | −3.0 | −26.6 / −3.0 | 4 (0.40–0.51 s) |

All provider TTS = 24 kHz mono PCM16 (consistent provider signature); no clipping anywhere
(max −2.5…−3.0 dBFS); no dead air ≥1 s. ASR transcripts cannot be re-derived offline (Layer
D) — the DB-stored transcripts are the evidence of record and are now **promoted to
`tests/fixtures/language/defect-a-transcripts.json`** (see §5).

## 3. Final-artifact forensics (the one real delivered film)

- **A/V sync: PASS.** Both streams 30.000 s, both start 0.000 → |vd−ad| = 0.000 s < 0.5
  (independently verified by CLI ffprobe; `avSyncOk:true` claim confirmed).
- **Loudness: FAIL at the time of audit (E-F01, P2).** Delivered file measures
  **−14.4 LUFS / TP −1.5 dBFS / LRA 4.4** (CLI ebur128 **and** the app's own
  `measureLoudness()` — run offline via `/tmp/r-e-measure-loudness.ts` — agree exactly),
  i.e. 0.4 LU outside the REG-9a contract band −16 ±1.0. The mix-stage metadata honestly
  recorded **−16.3 LUFS over the 65.8 s pre-mux mix**; `muxAudio`'s `-t 30` then truncated
  that mix, and no re-measurement happened post-truncation. **Fixed in R-FIX:** the SF
  pipeline now re-measures on the delivered (muxed) signal and labels it explicitly —
  `loudnessSignal: 'delivered' | 'pre-mix' | null` (`short_film.ts:1873–1892`, surfaced in
  the final artifact meta at :2026). TP −1.5 already matched (−1.51 recorded ≈ −1.5
  measured) — same content, different measurement window.
- **Silent content truncation (E-F02, P1 — §5.2 violation):** the 65.8 s audio timeline
  (A5 narration 41.1 s placed at 24.7 s) was silently cut to 30 s — **35.8 s = 87% of the
  narration discarded** with no note, no limits, no evidence. `avSyncOk` could not see it
  (both final streams exactly 30.000 s). **Fixed in R-FIX:** film-end overflow detection for
  both dialogue lines and the A5 narration — honest Bengali notes ("…চলচ্চিত্রের শেষ
  ছাড়িয়ে যায় — শেষ N সে. কাটা পড়ে (action: truncated, C-F03/D-F06)"), a
  machine-readable `metaJson.audioOverflows[]` record (`action:'truncated'`, line index),
  warn-level final verdict (no silent success), plus a belt-and-braces pre-mux total-vs-video
  duration check (`short_film.ts:288, 1516, 1679, 1898, 1955, 1980`). Locked by **REG-21b**.
- **Subtitle timing: PASS (positive evidence, E-F11).** The burned SRT cues — 09.75→13.37 s
  "আকাশ: কি খারাপ দিন।" and 13.62→24.22 s "প্রিয়া: বৃষ্টি ভালোই লাগে।" — **exactly match**
  the measured dialogue WAV durations (3.62 s / 10.60 s). The honest-verdict machinery also
  worked end-to-end on live data (dialogue-2 correctly verdicted `fail` for the abnormally
  long 10.6 s read; production stayed `partial`).
- **Image MIME (E-F03, P3):** all 3 AI images are JPEG bytes labeled `image/png` (DB +
  data-URLs). **Fixed in R-FIX:** byte-sniffing of the provider buffer before registration
  (worklog R-FIX "E-F03 MIME-স্নিফিং"), so declared MIME follows actual bytes.
- **Voice provenance (E-F04, P3):** dialogue artifacts recorded the *requested* Edge voice
  (`bn-BD-NabanitaNeural`/`bn-BD-PradeepNeural`) while the actual engine was z-ai
  `jam`/`douji`. **Fixed in R-FIX:** true provenance (`requestedVoice`/`actualVoice`/`engine`
  /`locale`) on verification and artifacts (RC-5), locked by REG-8f/REG-20g/20h/REG-21b.
- **Provider oddities (no fix required — handled):** clips arrive at **31 fps** (not 30/24)
  and shot 1 at **1890×1080** (non-standard width for a 9:16 request). Assembly normalized
  to 24 fps 1080×1920; the REG-9b-class mux invariants held on the real artifact.

## 4. What Layer C proved and what it cannot prove

- **Proved:** the delivered real film's structural invariants (A/V sync, SRT-vs-WAV timing,
  codec sanity), the loudness/truncation defects, the defect-A audio evidence (garbage
  transcripts physically consistent with the waveforms), the honest-verdict machinery firing
  on live data, and — after R-FIX — the delivered-signal loudness labeling and overflow
  honesty contracts at the pipeline level (REG-21b).
- **Cannot prove (Layer D / human, honestly):** Bengali pronunciation correctness (ASR
  cannot prove it — master §4.4), speaker identity, naturalness/acting quality beyond VLM
  advisory review, and anything about the post-fix pipeline on a *fresh* real run (the
  existing artifact predates the fixes; a real-provider re-run is a Layer-D item, not run —
  see `live-provider-test-requirements.md`).

## 5. Fixtures-promotion decision (E-F08)

- **Promoted (tracked, binary-free):** `tests/fixtures/language/defect-a-transcripts.json` —
  the two real DB transcripts with provenance, `dbSimilarity` (0 / 0.57) and expected
  verdicts (`fail` / never-`pass`), each expected reason tied to a finding (B-F04-ক/খ/গ,
  B-F05). Consumed by REG-20a/20b. The original en script was not recoverable from the DB —
  a representative script is used and the substitution is documented in the fixture's
  `scriptNote` (the behavior expectation is unchanged).
- **Not promoted (stay untracked):** all media binaries — the 7 WAVs (5 exist twice:
  tts-cache original + artifact copy), 3 clips, final MP4, 3 images — remain in gitignored
  `storage/` with full paths, sizes, sha256 prefixes and ffprobe summaries documented in
  findings-e §2.1. Rationale: no provider bytes under version control (existing policy),
  while the *behavioral* evidence (transcripts + measured values) is now regression-locked.
