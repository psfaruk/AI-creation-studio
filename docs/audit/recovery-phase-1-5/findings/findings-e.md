# Recovery Audit E — QA / Backtesting / Media Forensics (Findings E-F01…)

- **Agent:** Recovery Audit E (QA / Backtesting / Media Forensics Architect)
- **Scope:** master recovery prompt §7 (4-layer backtesting architecture), §8 (test suite & acceptance matrix), §11 (commands), §4.5 (TTS regression cases), §5.5 (lip-sync test matrix)
- **Mode:** READ-ONLY on source/tests; ffmpeg/ffprobe forensics on existing files only; DB inspected via a **copy** (`cp db/custom.db /tmp/r-e-custom-copy.db`, bun:sqlite readonly); zero provider/API calls; no dev-server touch; full suite NOT re-run (2-CPU box shared with parallel agents — latest full-suite evidence taken from worklog.md:1863 §P5-7 gate: 157/157 PASS, 1720 expects, 20 files, 164.90s).
- **Temp artifacts produced:** `/tmp/r-e-probe/*.json`, `/tmp/r-e-storage-listing.txt`, `/tmp/r-e-custom-copy.db`, `/tmp/r-e-db-*.ts`, `/tmp/r-e-measure-loudness.ts` (all in /tmp, per rules).

---

## 1. §8 Coverage Matrix — test inventory vs master regression groups

**Inventory:** 20 test files = `tests/smoke.test.ts` (6 tests) + `tests/regression/t1…t19` (19 files, 151 tests) → 157 tests total, 1720 expects, all documented in `tests/README.md` (REG-1…REG-19 catalog). Verified by enumerating `test(`/`it(` and `describe(` per file.

### 1.1 Matrix

| §8 Group / item | Covered by (test IDs) | Gap status |
|---|---|---|
| **Foundation** | | |
| TypeScript/lint/Prisma validation | NOT in `bun run test` — separate scripts (`bun run typecheck`, `bun run lint`, `bunx prisma validate`); exit-0 evidence in worklog P5-7 gate | By design (out-of-suite gates); keep recording exit codes per run |
| Provider errors, bounded retry, timeout | REG-6a–j (429/401/Retry-After/cooldown/serialization/jitter), REG-1g (engines-dead honest reject), REG-8g (bounded chain), smoke (retry-wait accumulation) | Covered (mocked) |
| Metrics & redaction | REG-11a–d, REG-15a–f, smoke (single-line JSON) | Covered |
| **Active runs & production lifecycle** | | |
| Duplicate-run prevention | REG-3a–e (409 + activeRunId, guard clears, per-conversation, rapid double-submit) | Covered |
| Refresh/reconnect | REG-2a–d (DB replay), REG-4a–c (bus replay), REG-7a–f (client persistence helpers) | Covered server-side; **browser EventSource re-attach wiring NOT RUN** (documented limit, README) |
| Cancellation | REG-14k (awaiting→cancel→409), REG-17c (mid-run cancel stops next submit) | Covered |
| Partial results | REG-17b/17d (failed shot dropped + honest note + fallback label), REG-12j/k/n (honest unsupported) | Covered |
| SSE terminal state | REG-2c (final replay), REG-4c/4e (grace window, one terminal event) | Covered for **runs** route; **`/api/productions/[id]/events` has no direct route-level test** (E-F05) |
| Artifact registration | REG-17a (plan artifact + shotId/size/movement mapping), REG-19 (per-dialogue artifacts + final + cinematicPlan), REG-10 (shot cache integrity), REG-18 (preview route) | Covered (fake-db boundary) |
| **TTS** | | |
| Bengali locale correctness | REG-1c/d/e (chain order, resolveVoice upgrade, detectLanguage bn-script) — mocked | Mocked core covered; **live Bengali success = Layer D only** |
| Wrong-language rejection | REG-1e (script detect) only | **Gap — no test rejects wrong-language output for bn (E-F06)** |
| Edge 403 fallback | REG-1a/1b/1f/1g, REG-8b/8c (engine-aware skip) | Covered (mocked Edge 403) |
| Unsupported Bengali voice | REG-1g is engines-dead, not "no bn-capable voice" | **Gap — no VOICE_UNAVAILABLE-state test (E-F06)** |
| Line-level failure | REG-8d (per-chunk failure, others processed), REG-8e (optional truly optional) | Covered (motion_video path) |
| ASR/script/similarity verification | REG-1 chain; no transcript-plausibility units (CJK-script reject, empty/repeated/truncated transcript, 0%-similarity verdict path) | **Gap (E-F06) — §4.4's 6 checks have no automated tests** |
| English TTS regression | REG-8a (primary success + cursor timing) partially; no en-profile fallback test | **Partial gap (E-F06)** |
| **Lip-sync** | | |
| Audio/video timestamp mapping | REG-16l (plan→fingerprint), REG-17a (artifact mapping) — but **no dialogue-timestamp→video-segment mapping test** (§5.2 schema untested) | **Gap (E-F07)** |
| Face/source validation | — | **BLOCKED — no lip-sync model exists** (lip_sync_module.ts declares 4-dimensional honest-blocked) |
| Unsupported capability | REG-12k (lip-sync request → honestly unsupported + alternatives) | Covered |
| Model failure/timeout | — | BLOCKED (no model) |
| Artifact validation | REG-17a/17e, REG-19 (provider body keys ⊆ probe contract, artifacts validated) | Covered |
| Synchronization evaluation | REG-9b (A/V duration sync at mux level) | Phoneme/mouth-level = BLOCKED (no model) |
| **Cinematic planning** | | |
| Music-video shot plan | REG-16a/a2/a3/a3b/a4, REG-16p (grid parity) | Covered |
| Short-film shot plan | REG-16b/b2/b3, REG-19a | Covered |
| Camera capability validation | REG-16e, REG-14b (4K/60fps → honest adjustments) | Covered |
| Shot prompt mapping | REG-16f/f2, REG-17a (framing+movement phrases in submitted bodies), REG-19a (English visualEn in prompts) | Covered |
| Duration consistency | REG-16c/b2 (engine limits, budget cut) | Covered |
| Cache compatibility | REG-10a–j, REG-16l/p4 | Covered |
| Assembly continuity | REG-17a (final metaJson.cinematicPlan), REG-16p2 (preview=run parity), REG-9b | Covered |
| **Final media** | | |
| MP4/WAV validity | REG-5a/b (real ffmpeg gate on WAV), REG-9b (real mux MP4) | Covered |
| Output dimensions/FPS | REG-9b (fps/res preserved), REG-14b | Covered |
| Duration tolerance | REG-9b (±0.3s) | Covered at mux level; **pipeline-level mix-vs-video duration drift untested (E-F01/E-F02)** |
| A/V sync | REG-9b (both streams equal length) | Covered at mux level |
| Loudness normalization | REG-9a/c/d/e/f/g (two-pass loudnorm −16±1.0, mono, silent-skip, corrupt-throw, unsupported-layout, report truth) | Covered on synthetic fixtures; **real recorded artifact = NOT RUN (t9 header admits); new live artifact now exists → E-F01 shows contract violation on it** |
| Truthful success/failure | REG-9d/e/g, REG-17b/c/d, REG-12j/k/n, REG-18h/i/j | Covered |

### 1.2 Group-level gap summary (§8 groups with zero/partial coverage)

- **Zero-coverage groups:** none of the six §8 groups is fully uncovered — but two sub-domains are structurally near-zero: **lip-sync implementation matrix (§5.5: 14 of 15 cases BLOCKED — no model)** and **live TTS language-integrity specifics (§4.5: 9 of 14 cases have no automated test)**.
- Foundation / Active-runs / Cinematic-planning / Final-media: strong coverage with only the gaps itemized above (E-F01, E-F05, E-F06, E-F08).

### 1.3 Mock boundaries / tautology / snapshot audit

- **Mock boundaries documented per file: ✅** every file carries a header comment block stating REAL vs MOCKED (verified in t1, t5, t9, t16, t17, t19 read in full; t2–t4, t6–t8, t10–t15, t18 skimmed via header + `mock.module` inventory). Mocked module inventory per file recorded (e.g., t1: `tts-cache`+`sdk-helpers`; t17: `llm`+`sdk-helpers`+`local-frames`+`db`; t19 adds `tts-cache`; t16/t5/t6/t7/t15: **no mocks — pure modules**; smoke: none). README "Isolation contract" table additionally documents: real dev DB never touched (fake-db + `resetFakeDb()` per test), no provider calls, no `storage/` writes, real ffmpeg only in t1/t5 (+t9/t10/t17/t19 real ffmpeg confirmed in headers).
- **Tautological assertions: none found.** All 18 `toBeTruthy()` uses are existence pre-checks immediately followed by stronger assertions (spot-verified REG-10i, REG-17a, REG-9b). No `expect(x).toBe(x)`, no comparing a mock's echo to itself. REG-18c's original tautology was **replaced in the review round** with real entry-shape/no-leak assertions (documented in README).
- **Snapshots: none exist** (`toMatchSnapshot`/`toMatchInlineSnapshot` = 0 matches across the suite) → nothing to weaken. Expected-values are hand-written exact contracts (exact counters, exact attempt counts, byte-identical cached output).

---

## 2. Fixture / Media inventory (everything on disk)

**Method:** recursive listing of `storage/`, `db/`, `public/`, `tests/`, `/tmp` + Glob over project tree; every media file checksummed (sha256) and ffprobe'd. `public/` has no media (logo.svg, robots.txt only). `tests/fixtures/` **does not exist** — the suite generates synthetic fixtures at runtime in `os.tmpdir()`.

### 2.1 Master inventory table

**REAL (live-provider) media — 14 files / 12 unique by content:**

| # | Path | Size | Origin | ffprobe summary | Loudness (ebur128) | Silence (−45dB ≥0.4s) |
|---|---|---|---|---|---|---|
| A1 | `storage/tts-cache/ec/45/ec45b9d18e…e11c0a0.wav` ≡ `storage/artifacts/mvbbyh49-fc58ad64.wav` ≡ `storage/artifacts/mvbbynz7-c2d31674.wav` (sha `1143dc64…`) | 686,736 B | **LIVE z-ai TTS, voice `jam`, bn text 58 chars** (createdAt 2026-10-16T18:57:53Z). DB fileName: **`speech-bn-jam.wav`** (registered twice) | pcm_s16le 24 kHz mono 16-bit, 14.300 s | I=−25.2 LUFS, TP=−3.0 dBFS, LRA 12.9 | 8 ranges 0.40–0.46 s |
| A2 | `storage/tts-cache/d5/4f/d54f2057a…53a75dd2e9.wav` ≡ `storage/artifacts/mvbbz23v-b29896ab.wav` (sha `03fb0101…`) | 498,576 B | **LIVE z-ai TTS, voice `tongtong`, en-labeled text 72 chars** (18:58:20). DB fileName: **`speech-en-tongtong.wav`** | pcm_s16le 24 kHz mono, 10.380 s | I=−21.5 LUFS, TP=−2.7 dBFS, LRA 6.1 | 2 ranges 0.61–0.68 s |
| A3 | `storage/tts-cache/ba/c9/bac9562da…2a0bc44e.wav` ≡ `storage/artifacts/mvbbzx95-cc90953a.wav` (sha `93a24208…`) | 1,973,136 B | **LIVE z-ai TTS, `jam`, bn narration 356 chars** (18:59:02). DB fileName: `narration-a5.wav` | pcm_s16le 24 kHz mono, 41.100 s | I=−24.2 LUFS, TP=−2.6 dBFS, LRA 3.6 | 14 ranges 0.42–0.76 s |
| A4 | `storage/tts-cache/3e/4e/3e4efa2a…7206d3b.wav` ≡ `storage/artifacts/mvbc01kd-856daf4a.wav` (sha `16fca64c…`) | 174,096 B | **LIVE z-ai TTS, `jam`, bn dialogue 13 chars** ("কি খারাপ দিন।") (18:59:07). DB fileName: `dialogue-1-studio.wav` | pcm_s16le 24 kHz mono, 3.620 s | I=−22.0 LUFS, TP=−2.5 dBFS, LRA 0.7 | 2 ranges 0.41–0.53 s |
| A5 | `storage/tts-cache/53/55/53550f41…591ee78f.wav` ≡ `storage/artifacts/mvbc0d40-ccbc5f7c.wav` (sha `b66bd795…`) | 509,136 B | **LIVE z-ai TTS, `douji`, bn dialogue 18 chars** ("বৃষ্টি ভালোই লাগে।") (18:59:17). DB fileName: `dialogue-2-studio.wav` | pcm_s16le 24 kHz mono, 10.600 s | I=−17.6 LUFS, TP=−3.0 dBFS, LRA 2.4 | 0 ranges |
| A6 | `storage/tts-cache/4f/73/4f73c4f3…137c22f7.wav` (sha `3468bfc5…`) | 433,296 B | **LIVE z-ai TTS, `jam`, 72 chars** (18:58:16) — cache-only, no artifact copy | pcm_s16le 24 kHz mono, 9.020 s | I=−22.1 LUFS, TP=−3.0 dBFS, LRA 4.5 | 1 range 0.40 s |
| A7 | `storage/tts-cache/a7/a6/a7a6488e…3afd4158.wav` (sha `17b90a51…`) | 550,416 B | **LIVE z-ai TTS, `jam`, 18 chars** (18:59:14) — cache-only | pcm_s16le 24 kHz mono, 11.460 s | I=−23.1 LUFS, TP=−3.0 dBFS, LRA 5.8 | 4 ranges 0.40–0.51 s |
| V1 | `storage/shot-cache/e0/37/e0379c44…f308d76.mp4` (sha `f52e25b4…`) | 6,173,138 B | **LIVE cogvideox-3 clip** (task `202610170258505e4c6884ebaf49f2`, storedAt 19:04:45, hasAudio:false) | h264 yuv420p **1890×1080 @31 fps**, 10.226 s, 317 frames, NO audio stream | — | — |
| V2 | `storage/shot-cache/67/c6/67c63a5f…4d82c1c.mp4` (sha `4462b67d…`) | 7,110,724 B | **LIVE cogvideox-3 clip** (task `2026101703061804c2365421ab474e`, 19:10:33) | h264 **1080×1440 @31 fps**, 10.290 s, 319 frames, NO audio | — | — |
| V3 | `storage/shot-cache/1d/46/1d46cce8…1e1595cc.mp4` (sha `00170f63…`) | 9,530,743 B | **LIVE cogvideox-3 clip** (task `2026101703120628e07a371cb542c5`, 19:16:31) | h264 **1080×1440 @31 fps**, 10.290 s, 319 frames, NO audio | — | — |
| V4 | `storage/artifacts/mvbcpfar-18f2b53a.mp4` (sha `45d24b5a…`) | 17,420,327 B | **LIVE-RUN final artifact** — romantic short film "দুঃখের বৃষ্টি" (production `cmvbbv86c…`, status `partial`, 8/8 steps done), locally encoded (Lavf61.7.103 / libx264) from V1–V3 + 5-layer audio mix + burned Bengali SRT | h264 1080×1920 @24 fps 720 frames (30.000 s) + **AAC 44.1 kHz stereo 30.000 s**; both streams start 0.000, durations **exactly equal** → A/V sync OK | **I=−14.4 LUFS, TP=−1.5 dBFS, LRA 4.4** (see E-F01) | — |
| I1 | `storage/artifacts/mvb57892-17325449.png` (sha `a90ae0de…`) | 138,007 B | **LIVE z-ai image-gen** (run `cmvb558cc…`, 15:48) — **actually JPEG bytes** (see E-F03) | JPEG (JFIF), **1344×768**, 3 components | — | — |
| I2 | `storage/artifacts/mvbbyeek-cfce7f69.png` (sha `18825df1…`) | 70,530 B | **LIVE z-ai image-gen** character portrait (bible-studio.png, production run, 18:56) — JPEG bytes | JPEG, 864×1152 | — | — |
| I3 | `storage/artifacts/mvbbzl34-83f44b73.png` (sha `e7972c37…`) | 110,693 B | **LIVE z-ai image-gen** portrait #2 (18:58) — JPEG bytes | JPEG, 864×1152 | — | — |

**SYNTHETIC / non-provider media:**

| Path | Size | Origin | Classification |
|---|---|---|---|
| `/tmp/p55c/garbage.wav` | 68 B | ASCII text `"this is definitely not an audio file - garbage bytes here 1234567890"` | Synthetic corrupt-input fixture (REG-9e class) |
| `/tmp/p5-shotplan.png` | ~? (1280×800 PNG) | Phase-5 agent-browser evidence screenshot | Test evidence image, not provider media |
| `/tmp/reg18-fixture-*/song.wav` (9 leftover dirs) | 57,678 B each | t18 runtime-generated procedural WAV (24 kHz mono PCM) | Synthetic; **leftovers of interrupted runs** (E-F09) |

**Non-media artifacts (context):** `storage/artifacts/mvbbwubt-f143b630.txt` (screenplay 4,044 B), `mvbbwubv-5fb547af.json` (shot-plan.json 3,946 B), `mvbcpf95-2b614655.srt` (Bengali dialogue SRT, 189 B — cues 09.75→13.37 "আকাশ: কি খারাপ দিন।" and 13.62→24.22 "প্রিয়া: বৃষ্টি ভালোই লাগে।" — **exactly matching** dialogue WAV durations 3.62 s / 10.60 s), `storage/security.json` (permissions, not inspected), `db/custom.db` (SQLite, 270,336 B, inspected read-only via copy), 14 `storage/llm-chat/*.json` LLM cache files.

### 2.2 The `speech-*.wav` defect-evidence hunt — **FOUND (not absent)**

- **`speech-bn-jam.wav`** — exists on disk as untracked live artifacts `storage/artifacts/mvbbyh49-fc58ad64.wav` **and** `mvbbynz7-c2d31674.wav` (byte-identical duplicates, sha `1143dc64…`; registered twice by run `cmvbby8gv…` at 18:57:54 / 18:58:03). Content = live z-ai `jam` voice reading the 58-char Bengali text "শুভ বিজয়া! নতুন বছর সুখ, সমৃদ্ধি আর সুস্থ দিন নিয়ে আসুক।" after Edge 403.
- **`speech-en-tongtong.wav`** — exists on disk as `storage/artifacts/mvbbz23v-b29896ab.wav` (sha `03fb0101…`, registered 18:58:21). Content = live z-ai `tongtong` voice, ASR transcript = romanized-Bengali-like English.
- They are **NOT in the tracked tree** (storage/ is gitignored, line 74 of .gitignore) — the master prompt's statement is accurate — but they **ARE on disk as untracked live artifacts** with hash filenames. The **transcript evidence lives in the DB** (`db/custom.db` Artifact.metaJson, extracted read-only):
  - speech-bn-jam.wav: transcript **"可真的，可真的，踢踢踢，忙的，踢踢踢，踢踢踢，踢B T"** (Chinese chars + meaningless repetition), `detectedLanguage:"en"`, **similarity 0**, durationSec 14.3 vs expectedSec 5.5, verdict **`warn`**, notes: z-ai voice not Bengali-trained + Edge-403 engine fallback.
  - speech-en-tongtong.wav: transcript **"Shubhoh bioya no tan bochar shukho, sumridhi ar shashti din niy asak."** (romanized Bengali read as English), similarity **0.57**, verdict **`pass`** (for the en label), duration 10.4 vs expected 4.4 s.
  - Corroborating worklog evidence: worklog.md:142 (ASR on Bengali audio emits "福利，他开"-class Chinese — external model limit), worklog.md:353 (TTS ভাষা-প্রোব of 7 voices; conclusion "no voice is Bengali-trained → bn verdict always warn + human preview").
- **Recovery recommendation:** promote both files (or trimmed copies) into version-controlled Layer-A/C fixtures with these DB-verified expected values, so the §4.5 cases "Chinese-script ASR output" and "0% similarity" can be regression-locked offline.

### 2.3 Counts

- **Real (live-provider) files on disk: 14** (7 unique TTS WAVs + 3 cogvideox-3 MP4 clips + 1 final assembled MP4 + 3 AI images). Of these, 5 WAVs exist twice (tts-cache original + artifact copy) → **12 unique real media by content**.
- **Synthetic media found: 11** (1 garbage.wav + 9 leftover reg18 song.wav + 1 p5 screenshot).
- **Lip-sync media: none** (consistent with the honest-blocked module — no fake lip-sync artifacts exist anywhere).

---

## 3. Layer C — offline media backtest (executed, budget-free)

All commands below were actually run (ffmpeg/ffprobe 7.1.5-0+deb13u1). Outputs condensed; full JSON kept in `/tmp/r-e-probe/`.

### 3.1 Audio forensics (per unique WAV)

```
ffprobe -v error -show_entries stream=codec_name,codec_type,sample_rate,channels,bits_per_sample,duration \
        -show_entries format=format_name,duration,size,bit_rate -of json <file>
ffmpeg -hide_banner -nostats -i <file> -filter_complex ebur128=peak=true -f null -      # loudness
ffmpeg -hide_banner -nostats -i <file> -af "silencedetect=noise=-45dB:d=0.4,volumedetect" -f null -
```

| File (short) | dur s | rate/ch | I LUFS | TP dBFS | mean/max vol | silences ≥0.4s |
|---|---|---|---|---|---|---|
| speech-bn-jam (A1) | 14.30 | 24k/mono | −25.2 | −3.0 | −27.7 / −3.0 dB | 8 (0.40–0.46 s) |
| speech-en-tongtong (A2) | 10.38 | 24k/mono | −21.5 | −2.7 | −22.2 / −3.0 dB | 2 (0.61–0.68 s) |
| narration-a5 (A3) | 41.10 | 24k/mono | −24.2 | −2.6 | −25.9 / −3.0 dB | 14 (0.42–0.76 s) |
| dialogue-1 (A4) | 3.62 | 24k/mono | −22.0 | −2.5 | −24.1 / −3.0 dB | 2 (0.41–0.53 s) |
| dialogue-2 (A5) | 10.60 | 24k/mono | −17.6 | −3.0 | −18.0 / −3.0 dB | 0 |
| cache 4f73c4f3 (A6) | 9.02 | 24k/mono | −22.1 | −3.0 | −23.7 / −3.0 dB | 1 (0.40 s) |
| cache a7a6488e (A7) | 11.46 | 24k/mono | −23.1 | −3.0 | −26.6 / −3.0 dB | 4 (0.40–0.51 s) |

**Forensic observations:**
- All provider TTS = 24 kHz mono PCM16 — consistent provider signature; no clipping (max −2.5…−3.0 dBFS on every file); silences are short natural pauses, no dead air ≥1 s anywhere.
- speech-bn-jam: 14.3 s for a 5.5 s-expected line + 8 evenly-spaced ~0.44 s pauses — physically consistent with the DB transcript's meaningless repetition ("踢踢踢" ×many): the voice is re-iterating garbage syllables. Layer-C confirmation of defect A evidence.
- dialogue-2 (douji): 10.60 s for an 18-char line (0.59 s/char vs jam's 0.28 s/char) with **zero** pauses ≥0.4 s — continuous unnatural elongation → confirms the pipeline's own "অডিওর দৈর্ঘ্য অস্বাভাবিক দীর্ঘ" fail-verdict note. The honest verdict machinery fired correctly on live data.
- ASR transcripts themselves cannot be re-derived offline without an API call (Layer D); the DB-stored transcripts (§2.2) are the evidence of record.

### 3.2 Video forensics (A/V stream comparison)

```
ffprobe -v error -show_entries stream=index,codec_name,codec_type,sample_rate,channels,width,height,pix_fmt,r_frame_rate,avg_frame_rate,duration,nb_frames \
        -show_entries format=format_name,duration,size,bit_rate -of json <file>
# final mp4 additionally:
ffprobe -show_entries stream=start_time,start_pts,time_base,duration_ts,duration -of json storage/artifacts/mvbcpfar-18f2b53a.mp4
ffmpeg -hide_banner -nostats -i <mp4> -map 0:a:0 -af ebur128=peak=true -f null -     # final-mix loudness
ffmpeg -ss <t> -t 2.5 -i <mp4> -map 0:a:0 -af astats=… -f null -                    # segment RMS spot-checks
```

| File | Video stream | Audio stream | A/V sync |
|---|---|---|---|
| e0379c44 (shot 1) | h264 1890×1080 @31fps 10.226 s | **absent** (matches cache meta hasAudio:false) | n/a (silent clip) |
| 67c63a5f (shot 2) | h264 1080×1440 @31fps 10.290 s | absent | n/a |
| 1d46cce8 (shot 3) | h264 1080×1440 @31fps 10.290 s | absent | n/a |
| **studio.mp4 (final)** | h264 1080×1920 @24fps 30.000 s (720 frames), start 0.000 | AAC 44.1 kHz stereo 30.000 s, start 0.000 | **exact** — |vd−ad| = 0.000 s < 0.5 → avSyncOk true (independently verified) |

- Provider oddities worth a fix-wave look: clips arrive at **31 fps** (not 30/24) and shot 1 at **1890×1080** (non-standard width). Assembly normalized to 24 fps 1080×1920 — the REG-9b-class invariants held at the mux level.
- Final-mix loudness (independent + app's own tool cross-check):
  - CLI: `I=−14.4 LUFS, TP=−1.5 dBFS, LRA 4.4`
  - App's real `measureLoudness()` run offline on the same file: `{"integratedLufs":-14.4,"truePeakDbtp":-1.5,"lra":4.4}` → **tooling agrees; the measurement is trustworthy.** (script `/tmp/r-e-measure-loudness.ts`, imports `src/lib/media/ffmpeg`, no provider calls)
  - DB-recorded mix metadata: `loudnessLufs: −16.3, peakDb: −1.51` over a **65.8 s** mix (ProductionStep `sound_design` detail: "মিক্স সম্পন্ন — 65.8 সে., লাউডনেস -16.3 LUFS (লক্ষ্য -16, সাম্য প্রয়োগকৃত, TP -1.5 dBTP)").
  - **→ E-F01/E-F02** (below): the delivered 30 s artifact measures −14.4 LUFS (0.4 LU outside the REG-9a band −16±1.0) because `muxAudio`'s `-t 30` truncated the 65.8 s normalized mix; peak matches (−1.51 ≈ −1.5) so the audio is the same content, just measured over a different window — 35.8 s (87%) of the A5 narration silently discarded.
- Segment RMS spot-checks on the final MP4 (dialogue window 10.5–13.0 s: peak −1.47 dB / RMS −17.6 dB; ambience window 2–4.5 s: −5.8/−17.9; narration window 25.5–28 s: −6.8/−20.1) — all layers audibly present in the mix; dialogue window is the loudest (consistent with A1 ducking rules). Speaker identity/pronunciation verification remains human/Layer-D (limitation).

### 3.3 Layer-C classification

- **Synthetic vs live:** all 7 TTS WAVs, 3 shot MP4s, 3 images, and the final MP4 are **live-run artifacts** (provider or provider-derived). The only synthetic media are the corrupt-fixture `garbage.wav`, t18's procedural `song.wav` leftovers, and the p5 screenshot. No test suite fixture directory exists (`tests/fixtures/` absent) — **the suite is 100% self-synthesizing; zero real-provider bytes are under version control.**

---

## 4. Layer D — real-provider acceptance test requirements (doc-only; NOT RUN)

Per master §7 Layer D: to be executed by the LEAD only after user-authorization review. No cost figures exist anywhere in the repo/docs (Phase-4 decision: "no pricing data exists — none shown") — every usage estimate below is therefore **UNKNOWN** (no fabricated numbers). All four candidates: **status BLOCKED — LIVE PROVIDER NOT AUTHORIZED.**

| # | Candidate | Provider & adapter | Input | Est. usage / cost | Outputs | Acceptance criteria | Failure handling |
|---|---|---|---|---|---|---|---|
| D1 | **Bengali TTS voice validation** (defect-A closure) | z-ai SDK TTS (`zai.audio.tts.create`, voices `jam`/`douji`; Edge bn-BD neural currently 403-blocked) via `src/lib/agent/audio/language_controller.ts` | 3 fixed Bengali sentences (10–60 chars) × 2 voices + 1 English control sentence | **UNKNOWN** (≈4–7 TTS calls; pricing data does not exist in repo) | WAV files + verification report (verdict/similarity/transcript/duration) | (a) ffprobe-valid WAV 24 kHz mono; (b) duration plausibility ≤0.45 s/char; (c) ASR transcript has NO CJK chars for bn input; (d) similarity > 0 only counts if transcript is Bengali-script; (e) verdict must be `warn` or better with honest notes; (f) **human-listening gate stays mandatory** (ASR cannot prove Bengali pronunciation — master §4.4) | 403/429 → bounded retry per REG-6 policy, then honest `TemporarilyUnavailableError`; persistent failure → record BLOCKED, do NOT register audio artifact as verified |
| D2 | **ASR round-trip** (bn + en) | z-ai SDK ASR (`zai.audio.asr.create` via `transcribeBuffer`, 28 s chunking) | the two promoted fixtures `speech-bn-jam.wav`, `speech-en-tongtong.wav` + D1's fresh outputs | **UNKNOWN** (≈3–5 ASR calls) | transcripts + similarity/detected-language report | (a) bn input transcript must NOT be Chinese/repeated-garbage (regression vs the recorded 可真的… evidence); (b) en control similarity ≥0.5 (matches recorded 0.57 class); (c) empty/whitespace transcript → fail, not pass | TranscriptVerification failure → verdict `fail`/`warn` per controller; never silently drop the line (master §4.3) |
| D3 | **One-shot video generation** (CogVideoX-3) | z-ai SDK video (`zai.video.generations.create` + `zai.async.result.query`, model `cogvideox-3`, `src/lib/agent/video/ai_video.ts`) | 1 fixed 5 s t2v prompt (Bengali scene description), `request_id` set for idempotency | **UNKNOWN** (1 video task; historically 138 s for a 5 s clip; 429 backoff 60 s ×6 built in) | MP4 + validation report | (a) ffprobe: h264, decodable, duration 5 s ±1, fps sane (record actual — provider has delivered 31 fps); (b) file registered with honest engine label; (c) no audio expected unless `with_audio:true` (then verify stream) | 429 → 60 s backoff ≤6; timeout → honest failure, no fake artifact; cancel honored |
| D4 | **VLM frame analysis** (acting/continuity evidence) | z-ai SDK vision (`zai.chat.completions.createVision` via `visionCompare`, `src/lib/agent/film-helpers.ts`) | portrait (I2/I3) + 1 frame extracted from V1–V3, Bengali comparison prompt | **UNKNOWN** (1–3 vision calls) | text verdict per frame | (a) verdict is non-empty, in Bengali, answers same-person question; (b) treated as ADVISORY only (master §6.4: automation cannot prove acting quality — human review remains) | rate-limit → single honest skip note (existing continuity behavior), non-blocking |

**Pre-flight requirements for the LEAD:** announce provider, inputs, shot counts, UNKNOWN-cost disclaimer, outputs, acceptance criteria, and failure handling to the user; get explicit authorization; record every artifact + evidence record (§5) under `docs/audit/recovery-phase-1-5/`; never mark quality-passed on mocked or partial evidence.

---

## 5. Evidence-record format + acceptance-matrix skeleton (§8 template)

### 5.1 Standard evidence record (one per test/executable check)

```markdown
### EV-<suite>-<n> — <Test ID>
- **Test ID:** REG-xY / LAYER-x-n / LIVE-x-n
- **Requirement:** <master-prompt §, one sentence>
- **Input fixture:** <path or "self-synthesized: <generator>" or "LIVE: <provider>">
- **Expected:** <exact, machine-checkable contract>
- **Actual:** <measured value(s), verbatim where possible>
- **Command / harness:** <exact command line or script path>
- **Status:** PASS | FAIL | BLOCKED | NOT RUN
- **Evidence file:** <path to artifact/log/JSON (never a claim without a file>
- **Known limitations:** <what this does NOT prove — mandatory honesty field>
- **Layer:** A (deterministic/mocked) | B (budget-free integration) | C (offline media) | D (live provider)
- **Environment:** <date, machine class, ffmpeg version, CPU load note if relevant>
```

### 5.2 Acceptance-matrix skeleton (for `docs/audit/recovery-phase-1-5/`)

| Req-ID | Requirement (master §) | Layer(s) | Evidence records | Status | Blocking finding(s) |
|---|---|---|---|---|---|
| R-4.5-01 | Bengali voice success (live) | D | EV-LIVE-… | NOT RUN (awaiting auth) | — |
| R-4.5-02 | Chinese-script ASR output rejected | A/C | EV-REG-… | <fill from fix wave> | E-F06 |
| R-4.5-… | (…remaining §4.5 cases) | | | | |
| R-5.5-01…15 | (lip-sync matrix cases) | A/B/D | — | BLOCKED (no model) | E-F07 |
| R-8-FIN-01 | Final MP4 loudness −16±1.0 LUFS on delivered artifact | C | EV-C-01 (studio.mp4 = −14.4 LUFS) | **FAIL on live artifact** | E-F01 |
| R-8-FIN-02 | A/V sync < 0.5 s on delivered artifact | C | EV-C-02 (0.000 s) | PASS | — |
| … | (Foundation / Active-runs / TTS / Lip-sync / Cinematic / Final-media rows per §1.1 matrix) | | | | |

Rules for filling it (master §8): no pre-writing results before running; BLOCKED requires a reason and an owner decision; NOT RUN requires a trigger condition; every FAIL links to a finding E-Fnn and a fix-wave task.

---

## 6. Suite-health notes (no full run performed)

- **Latest full-suite evidence (worklog.md:1855, P5-7 gate):** 157/157 PASS, 1720 expects, 20 files, 164.90 s, exit 0; static gates typecheck/lint/prisma/`git diff --check` all clean.
- **Order-dependence / shared state:** designed-out and re-verified — per-test `resetFakeDb()`, unique runIds, per-test `mkdtemp` + `afterAll rm`, coordinator/event-bus resets, and `globalThis` overrides (`__shotCacheRootOverride`, `__aiVideoGate` in t10/t17/t19) always set in `beforeEach` and cleared in `afterAll`. No cross-file mock leakage observed (bun isolates `mock.module` per file); repeated full-suite runs have been green across many executions per worklog.
- **REG-9g ffmpeg timeout characteristic:** bun's default per-test timeout is **5000 ms**; REG-9g (report-truthfulness on a real two-pass loudnorm + mux) measured **2802 ms isolated (44% headroom)** but hit the 5 s ceiling once when two gate agents ran the suite concurrently on the 2-CPU box (worklog.md:1855) — environmental contention, not a regression; isolated t9 re-run 7/7 and a quiet-machine full suite 157/157.
- **Doc-only hardening recommendation for the fix wave:** give every ffmpeg-heavy test an explicit timeout via the already-declared third `test()` arg (`tests/bun-test-shim.d.ts:60` — `function test(name, fn, timeout?)`): t5, t9 (all 7), t10, t17, t19 → e.g. `timeout: 30_000`; alternatively/additionally set `--timeout 30000` in the `bun run test` script. This removes the whole class of 2-CPU-contention flakes without weakening any assertion.
- **Hygiene:** 9 leftover `/tmp/reg18-fixture-*` dirs (64 KB each, synthetic song.wav) prove some t18 runs ended without `afterAll` (timeout/kill). Harmless but recommend an idempotent pre-suite sweep or stale-prefix cleanup in the fix wave (E-F09).
- **Production-vs-test DB safety confirmed:** suite never touches `db/custom.db` (README isolation contract); this audit read it only via a `/tmp` copy.

---

## 7. Findings register (E-Fnn)

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **E-F01** | **P2** | **Final-artifact loudness drift:** delivered `studio.mp4` measures **−14.4 LUFS** (both CLI ebur128 and the app's own `measureLoudness` agree) vs the REG-9a contract band −16 ±1.0 → 0.4 LU outside, +2.4 LU off target. Recorded mix metadata honestly says −16.3 LUFS but that was measured over the **65.8 s** pre-mux mix; `muxAudio`'s `-t 30` then truncated it. No re-measurement/re-normalization happens post-truncation, and the artifact meta carries the mix-stage number. §8 "loudness normalization" acceptance is therefore **not met on the one real recorded artifact**. Fix: clamp A5/mix timeline to film duration OR re-normalize post-truncation; re-measure on the muxed file; add a pipeline-level regression (mix duration ≠ video duration case) — REG-9 tests `mixSoundLayers` and `muxAudio` separately, never this interaction. | §3.2; ProductionStep sound_design detail (65.8 s / −16.3 LUFS); film-helpers.ts:368-385 (`apad`/`-t`) |
| **E-F02** | **P1** (master-§5.2 contract violation) | **Silent audio-content truncation:** the A5 narration (41.1 s, placed at 24.7 s) makes the audio timeline 65.8 s vs the 30 s film; `muxAudio` silently truncates **35.8 s = 87% of the narration** with no partialNote, no correction limits, no evidence record — exactly what master §5.2 forbids ("নীরবে stretch বা truncate করবে না… correction-এর limits ও evidence সংরক্ষণ"). `avSyncOk:true` passes because both final streams are 30.000 s — the check cannot see content loss. | §3.2; short_film.ts A5 placement (§6 step code around line 1325); muxAudio `-t` |
| **E-F03** | P3 | **AI images labeled `image/png` but contain JPEG bytes**: all 3 on-disk AI images (`mvb57892…`, `mvbbyeek…`, `mvbbzl34…`) are JFIF JPEG with `.png` names, `mimeType: image/png` in DB and `data:image/png` data URLs (`short_film.ts:518-526`; default `mimeType ?? 'image/png'` at `tools/image.ts:123`). Browsers sniff so previews work, but any strict consumer breaks and metadata is untruthful. Fix: sniff bytes or honor provider format; regression: assert magic bytes vs declared mime. | §2.1 I1–I3; `file` output |
| **E-F04** | P3 | **Artifact meta records requested voice, not actual fallback voice** for short-film dialogues: meta says `voice: bn-BD-NabanitaNeural`/`bn-BD-PradeepNeural` while tts-cache meta proves the actual engine/voice was z-ai `jam`/`douji` (Edge was 403-dead). The fallback note mentions the engine failure, but the actual-voice field contradicts reality (REG-8f established the actual-voice-truthfulness contract for motion_video; short_film artifacts don't carry it). | DB Artifact.metaJson vs tts-cache meta.json (§2.1 A4/A5) |
| **E-F05** | P3 | `/api/productions/[id]/events` SSE route (used by `use-productions`) has **no direct route-level regression test**; t2/t4 cover only the runs events route (shared bus, different route code). | `src/app/api/productions/[id]/events` exists; tests grep = no import |
| **E-F06** | P2 (coverage gap) | **§4.5 TTS language-integrity specifics uncovered:** 9 of 14 cases have no automated test — Chinese-script ASR output rejection, 0%-similarity verdict path, partial/empty transcript, unsupported locale, wrong-language artifact registration, UI status/user-facing error, provider metadata/locale consistency, VOICE_UNAVAILABLE (no bn voice) state, English-voice-for-Bengali rejection. (Covered: Edge-403→fallback, bounded attempts, multi-line mid-failure, engines-dead honesty, Bengali script detect, chain order.) The DB-stored `speech-*` transcripts (§2.2) make most of these lockable offline **today** with zero API spend. | §1.1 matrix; §2.2 |
| **E-F07** | P2 (BLOCKED-class coverage gap) | **§5.5 lip-sync matrix: 14 of 15 cases untestable — no lip-sync model/endpoint exists** (honest 4-dimensional blocked declaration in `lip_sync_module.ts:14-31`); only the honest-unsupported UI case (REG-12k) is covered. Additionally §5.2's audio-timing schema (line start/end, artifact mapping, per-line status) has **no automated schema test** — live evidence (SRT cues exactly matching dialogue durations) exists in the DB but nothing locks it. All model-dependent cases must stay BLOCKED (master §5.5) — never mocked as success. | §1.1; lip_sync_module.ts |
| **E-F08** | P3 | **No real-provider bytes under version control / no real-artifact final-media test:** `tests/fixtures/` does not exist; t9's header honestly admits "real recorded artifact before/after = NOT RUN" (the Phase-0 MP4 was lost with the snapshot). A real recorded final artifact NOW exists (`storage/artifacts/mvbcpfar-18f2b53a.mp4`, untracked) — promote a copy (plus `speech-*.wav` fixtures) into tracked fixtures with recorded expected values so Layer-C becomes repeatable in CI. (E-F01 was only discoverable because this artifact exists.) | §2.1, §2.3; t9 header |
| **E-F09** | P3 (hygiene) | 9 leftover `/tmp/reg18-fixture-*` dirs from runs that ended without `afterAll` (contention kills) — recommend stale-prefix sweep on suite start. | §2.1 synthetic table |
| **E-F10** | P3 (flakeness) | REG-9g class ffmpeg tests rely on bun's default **5000 ms** per-test timeout (2802 ms typical, once hit 5 s under parallel-agent load). Recommend explicit `timeout` on ffmpeg-heavy tests (shim already supports the 3rd arg) or `--timeout 30000` in the test script — hardening only, no assertion weakening. | worklog.md:1855; §6 |
| **E-F11** | info | **Honest-handling positive evidence from live data:** dialogue-2's live douji audio (10.6 s for 18 chars, 0 pauses) was correctly verdicted **fail** with an "abnormally long" note, production status stayed **partial** with honest notes, SRT cue durations exactly match the measured WAV durations (3.62 s / 10.60 s), and the final A/V streams are exactly equal (0.000 s skew). The truthfulness machinery works end-to-end on real artifacts; the failure is the silent truncation/loudness drift above, not the verdict system. | §3.1, §3.2, §2.1 SRT |

---

## 8. Verdict & handoff for the LEAD

- **Suite health:** green and well-isolated; coverage is strong for Foundation / Active-runs / Cinematic-planning / Final-media at Layers A/B, with the honest exceptions catalogued above.
- **Layer C (offline forensics) is now bootstrapped and already produced one P1 + one P2** (E-F02/E-F01) plus two P3 metadata defects (E-F03/E-F04) — all from existing artifacts, zero spend.
- **Zero-coverage areas needing decisions:** §5.5 lip-sync matrix (BLOCKED — model selection + authorization required; do NOT mock), §4.5 live Bengali success (Layer D — D1/D2 sheets ready), real-artifact final-media fixtures (E-F08 — promote existing files).
- **Immediate fix-wave candidates (smallest safe fixes):** (1) A5/mix-duration clamp or post-truncation re-normalization + pipeline regression; (2) promote `speech-*.wav` + `studio.mp4` to tracked Layer-C fixtures and lock §4.5 offline cases; (3) image mime sniffing; (4) per-test timeouts.
- No source/test files were modified by this audit; only this findings file (plus a worklog entry) was created.
