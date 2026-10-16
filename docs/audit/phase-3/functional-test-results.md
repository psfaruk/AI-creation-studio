# Phase 3 — Functional Test Results

Suite: `bun run test` → **75 tests / 12 files / 901 expect() calls / 0 fail, exit 0**
(31.1s). Baseline was 47/47 (Phase-2 end state) — Phase 3 adds **28 tests**
(REG-8 ×7, REG-9 ×7, REG-10 ×10, REG-11 ×4). No existing assertion was weakened;
REG-1…REG-7 run unchanged and green.

## Per-file results (evidence class: unit-test / local-integration, real ffmpeg)

| File | Result | Notes |
|---|---|---|
| t1 (REG-1 Bengali TTS fallback) | 7/7 PASS | unchanged from Phase 2 |
| t2 (REG-2 refresh/reconnect) | 4/4 PASS | unchanged |
| t3 (REG-3 duplicate submission) | 5/5 PASS | unchanged |
| t4 (REG-4 SSE replay) | PASS | unchanged |
| t5 (REG-5 instrumental audio) | 6/6 PASS | unchanged |
| t6 (REG-6 429 retry) | PASS | unchanged |
| t7 (REG-7 client re-attach) | PASS | unchanged |
| smoke | PASS | unchanged (incl. tool parity) |
| **t8 (REG-8 motion voiceover fallback)** | **7/7 PASS** | new — Workstream A |
| **t9 (REG-9 final-mix loudness)** | **7/7 PASS** | new — Workstream B |
| **t10 (REG-10 shot cache reuse)** | **10/10 PASS** | new — Workstream C |
| **t11 (REG-11 stage metrics)** | **4/4 PASS** | new — Workstream D |

## REG-8 — motion-video voiceover fallback (Workstream A)

Mock boundary: `tts-cache` (t1 pattern) → the **real** `synthesizeVerifiedSpeech`
chain runs against controllable Edge/z-ai engines; real `encodeWav` buffers → real
ffprobe timing on temp files.

| ID | Class | Assertion | Result |
|---|---|---|---|
| REG-8a | primary success | requested voice, 1 attempt, no fallback note, cursor timing 0 → 1.8s (1.6s WAV + 0.2 gap), exact `voice-<i>.wav` files | PASS |
| REG-8b | fallback success | Edge 403 → chain reaches `jam`, attempts=2, honest `ইঞ্জিন-ফলব্যাক` note, chunk survives | PASS |
| REG-8c | engine-aware skip | dead Edge engine → Pradeep/Tanishaa never called (call-log proof: exactly 1 Edge + 1 z-ai call) | PASS |
| REG-8d | all engines dead | honest per-chunk failure notes (`সব TTS ইঞ্জিন অচল`), other chunks still processed | PASS |
| REG-8e | optional speech truly optional | total failure resolves (no throw) — ambient/silent path can continue | PASS |
| REG-8f | metadata truthfulness | actual voice/attempts/fallback-notes recorded; requested-vs-actual visible | PASS |
| REG-8g | bounded retry | per-chunk chain ≤ profile length; exact 2+2 engine calls for 2 chunks; loop terminates naturally | PASS |

## REG-9 — final-mix loudness (Workstream B)

Real ffmpeg/ebur128 on temp files; layers from the real procedural engines
(music_engine instrumental + sound_design bed) + honest synthetic PCM voice; real
`muxAudio` for the A-V integration. sdk-helpers mocked (t1 pattern) so the
film-helpers→llm→SDK chain never loads.

| ID | Class | Assertion | Result |
|---|---|---|---|
| REG-9a | nominal normalize | raw −24.3 LUFS → normalized −15.9 LUFS (target −16, ±1.0), TP −10.5 dBTP ≤ −1.2; independent ebur128 re-measurement agrees within 0.3 LU | PASS |
| REG-9b | preservation + mux | WAV duration in/out ±0.05s; stereo kept; real mux onto real testsrc2 h264: codec/res/fps (30±1.5)/duration (8±0.3) preserved, A/V stream agreement | PASS |
| REG-9c | mono passthrough | mono input stays mono (channels 1→1) | PASS |
| REG-9d | silent mix | helper: applied:false, reason:'silence', duration kept; report: honest issue, ok=false, no fake success | PASS |
| REG-9e | corrupt input | helper throws; **no output file is created** (non-zero ffmpeg exit never disguised) | PASS |
| REG-9f | unsupported layout | 6-channel input → explicit `অসমর্থিত চ্যানেল-বিন্যাস` error | PASS |
| REG-9g | report truthfulness | target/applied/measured fields consistent; normalizedLufs ≈ loudnessLufs (≤0.5); no deviation issue on success; applied:false + issue on silence | PASS |

Two ffmpeg-7.1.5-specific discoveries are covered by these tests: the ebur128
summary prints true-peak under a `True peak:` heading labeled **dBFS** (not dBTP —
REG-9a parses the section, with live-TPK fallback), and digital silence makes
loudnorm's analysis report `input_i: "-inf"` (REG-9d — the helper treats this as
silence, never passes `-inf` to the filter).

## REG-10 — shot cache reuse (Workstream C)

Mock boundary: `llm` (`getZAI` → fake SDK; `chatComplete`/`parseToolCall` stubs for
the sdk-helpers re-export) + global `fetch` (download) — zero real SDK/network;
real ≥50KB audio-bearing MP4 fixture through the real `validateVideoBuffer`;
cache root overridden to temp dirs (storage/ never touched); ms-scale poll/cooldown.

| ID | Class | Assertion | Result |
|---|---|---|---|
| REG-10a | same input → validated hit | 2nd identical call: **no second submit** (call-log), fromCache, taskId/model preserved, byte-identical buffer; stats hits=1/misses=1/stores=1 | PASS |
| REG-10b | changed input → miss | prompt / duration 5→10 / withAudio / +imageUrl each → new key → miss (5 misses, 0 hits, 0 invalid — clean misses never count as invalid) | PASS |
| REG-10c | hit equivalence | cached bytes identical to provider output; mimeType/nativeAudio equal (local w/h/fps normalization is deterministic — code-inspected note) | PASS |
| REG-10d | invalid entry | corrupted media → lookup evicts + invalid=1 + null; next call regenerates (submit #2) and stores again | PASS |
| REG-10e | in-flight join | two concurrent identical calls → **ONE submit**, both resolve, joiner marked fromCache; joined=1/misses=1/stores=1 | PASS |
| REG-10f | bypass | bypassCache → provider called, nothing stored, bypass counted (not as miss) | PASS |
| REG-10g | eviction honesty | 1.6-entry budget → oldest evicted (evictions=1, entries=1), survivor is the newer entry | PASS |
| REG-10h | path safety | fingerprint = 64-hex; non-hex fingerprints → silent miss/no-store; on-disk names match `^[0-9a-f]{64}\.(mp4|meta.json)$` only | PASS |
| REG-10i | prewarm interplay | prewarm of a cached request resolves from cache (consumePrewarmedClip proof) — no submit | PASS |
| REG-10j | counter honesty | exact final snapshot over a scripted scenario: hits=1, joined=0, misses=2, bypass=1, invalid=0, stores=2, evictions=0, bytesStored=2×fixture, entries=2 | PASS |

A real defect was found **by these tests** and fixed during development: the first
lookup implementation counted a plain miss (no entry on disk) as `invalid`; the
fixed version distinguishes clean-miss (ENOENT) from corrupt-entry (invalid).

## REG-11 — production stage metrics (Workstream D)

Same mock pattern as t10; real `runWithFfmpegTracking` scope.

| ID | Class | Assertion | Result |
|---|---|---|---|
| REG-11a | stage fields present | tracked scope records submit/poll/download/validate durations + outcome; unscoped (chat-path) calls create **no** accumulator (map inspected) | PASS |
| REG-11b | redaction | canary prompt/URL absent from accumulator JSON and from the `[production-metrics]` console line; every video.* value is a number (structural redaction) | PASS |
| REG-11c | lifecycle/bounds | clearProductionMetrics resets; safety valve caps the map at 200 accumulators | PASS |
| REG-11d | counter coherence | over a 5-call scenario: requested(5) = fromCache(1) + joined(1) + providerSubmits(2) + bypassed(1); cacheStores=2 | PASS |

## Isolation proof (this phase, this sandbox)

- `db/custom.db` md5 **identical before/after the full suite**
  (`3cc4e8e58a3436c299f95f3661a03b58`) — dev DB untouched.
- storage/: after `rm -rf storage`, each test file (all 12, run in groups) leaves
  `storage/` **non-existent** — no test writes there. (A `storage/security.json`
  observed once during the phase was traced to live browser traffic through the
  running dev server's security gate — app runtime state, gitignored, unrelated to
  tests; verified by the per-file runs above.)
- No test imports `z-ai-web-dev-sdk` (llm/sdk-helpers/tts-cache boundaries mocked);
  no live provider calls; no new dependencies.
- `bun run typecheck` exit 0 · `bun run lint` exit 0 · `bunx prisma validate` exit 0.
- `next build` **NOT RUN** (sandbox rule — unchanged from Phases 0–2).
