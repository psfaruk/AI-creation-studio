# Phase-1 Test Suite — AI Creation Studio

Deterministic regression tests for the Phase-1 engineering-foundation pass.
No live provider calls, no dev-database writes, no long real-time waits.

## Commands

```bash
bun run test        # whole suite (alias: bun test tests)
bun test tests/regression/t1-bengali-tts-fallback.test.ts   # one file
bun test tests/regression/t5-instrumental-audio.test.ts -t "REG-5a"  # one test
```

A failed assertion exits non-zero (bun:test guarantee) — CI-ready.

## Framework choice

`bun:test` — Bun's built-in runner (Bun 1.3.14). **Zero new dependencies**
(the Phase-1 constraint prefers existing infrastructure). It provides the
jest-style API (`describe/test/expect/mock.module`) with native TypeScript
and tsconfig path-alias (`@/*`) support. React Testing Library was not
needed: no DOM interaction is asserted (the client-side refresh gap is
documented via server-side contract tests + source evidence).

## Isolation contract

| Concern | Guarantee |
|---|---|
| Real dev SQLite database | **Never touched.** Every test that exercises DB-dependent code installs `mock.module('@/lib/db', …)` backed by `tests/helpers/fake-db.ts` (in-memory rows, `resetFakeDb()` per test). |
| Live AI providers (LLM/TTS/ASR/image/video/search) | **Never called.** Engine boundaries are mocked (`tts-cache`, `sdk-helpers`, `orchestrator.startAgentRun`) or the code under test is provider-free (event bus, retry, music engine, SSE route with fake DB). |
| Production artifacts/storage | **Never written.** No test writes to `storage/` (the storage mock throws if reached; `saveArtifactFile` is never invoked because no attachments are sent). |
| Timers | Real timers with millisecond-scale budgets (e.g. `baseMs: 2`, `cooldownBudgetMs: 40`) — total wall time of the suite is seconds. |
| Event bus / coordinator global state | Per-test reset (`resetFakeDb()`, coordinator map reset) or unique runIds. |
| ffmpeg | REAL (safe, local, no network) — used by t1 (duration verification on temp files) and t5 (quality gate on engine output). |

## The six core regression tests (+ REG-7, Phase 2)

| ID | File | Verdict (after Phase-2 fix round 1) | Notes |
|---|---|---|---|
| REG-1 | `regression/t1-bengali-tts-fallback.test.ts` | **PASS (7/7 — P0-BUG-01 fixed)** | REG-1a asserts the fixed fallback contract (Edge 403 → z-ai, engine-aware skip, warn verdict, honest fallback notes). REG-1b asserts the new whole-chain contract (3 Edge verification-fails → jam, attempts=4). REG-1f covers the verify:false path used by pipeline lines 2+ (fix #3). REG-1g locks exhaustion honesty (both engines dead → honest reject, no fake success). Pre-fix evidence preserved in the phase-1 commit. |
| REG-2 | `regression/t2-chat-run-refresh-reconnect.test.ts` | PASS (server-side) | DB replay recovers run identity, in-flight tools, and terminal state on a fresh connection. REG-2d now asserts the post-fix precondition — the client half (persistence + re-attach) is fixed and unit-locked by REG-7. |
| REG-3 | `regression/t3-duplicate-submission.test.ts` | **PASS (guard ENFORCED — P0-BUG-03 duplicate-run half fixed)** | Active run → 409 + activeRunId (no second run, no stray user message); guard clears on terminal state; per-conversation; rapid double-submit creates at most one run. |
| REG-4 | `regression/t4-sse-event-replay.test.ts` | PASS | Bus replay ordering + 100-event cap + grace window; route-level dedupe (tool_start ×2 → 1) and reconnect replay order (start→end→message→finished), text_delta correctly not replayed. |
| REG-5 | `regression/t5-instrumental-audio.test.ts` | PASS | Valid WAV, truthful metadata, real-ffmpeg quality gate, determinism with seed, spec clamping; unknown-mood failure mode documented. |
| REG-6 | `regression/t6-http-429-retry.test.ts` | PASS | Bounded retries (exact attempt counts), 429 → TemporarilyUnavailableError (never false success), 401 not retried, Retry-After honored+capped, channel budget fast-fail, serialization. |
| REG-7 | `regression/t7-client-run-reattach.test.ts` | **PASS (P0-BUG-03 client half fixed)** | Run-identity persistence (save/read/clear round-trip, two-tab-safe conditional clear, stale cutoff vs the 10-min server sweep, malformed-entry safety, no-storage degradation, userMessageId default) — the React-free helpers the use-agent-run re-attach path is built on. |
| REG-8 | `regression/t8-motion-voiceover-fallback.test.ts` | **PASS (7/7 — Phase-3 A: last P0-BUG-01 call site fixed)** | motion_video voiceover chunks now go through the shared `synthesizeVerifiedSpeech` chain (`pipelines/voiceover.ts`): primary success + cursor timing (8a), Edge-403 → z-ai fallback with honest note (8b), engine-aware skip proven by call-log (8c), all-engines-dead honesty (8d), optional-speech-truly-optional (8e), actual-voice/attempts metadata (8f), bounded chain (8g). |
| REG-9 | `regression/t9-final-mix-loudness.test.ts` | **PASS (7/7 — Phase-3 B: P0-BUG-02 fixed)** | Quiet 3-layer mix (−24.3 LUFS) → two-pass loudnorm → **−15.9 LUFS / −10.5 dBTP** with independent ebur128 re-measurement (9a); duration/layout/fps/A-V sync preserved through a real mux (9b); mono stays mono (9c); silent mix → honest skip + issue (9d); corrupt input throws with no fake output (9e); 6-channel → explicit unsupported error (9f); report fields truthful (9g). |
| REG-10 | `regression/t10-shot-cache-reuse.test.ts` | **PASS (10/10 — Phase-3 C: P0-BUG-04 fixed)** | Same input → validated disk hit, no second submit (10a); every fingerprint field matters (10b); cached bytes identical (10c); corrupt entry evicted + invalid counter (10d); concurrent identical calls → one submit via in-flight join (10e); bypass counted, nothing stored (10f); budget eviction oldest-first (10g); hex-only paths (10h); prewarm resolves from cache (10i); exact counter snapshot (10j). |
| REG-11 | `regression/t11-production-stage-metrics.test.ts` | **PASS (4/4 — Phase-3 D: stage metrics)** | Tracked production scope records submit/poll/download/validate + outcomes; unscoped calls create no accumulator (11a); canary prompt/URL cannot appear in accumulator or metrics line (11b); lifecycle + 200-accumulator safety valve (11c); requested = cache + joined + provider + bypassed over a 5-call scenario (11d). |
| REG-12 | `regression/t12-intent-routing.test.ts` | **PASS (17/17 — Phase-4 B: intent-aware routing)** | Bengali/English/mixed music-video requests → `music_video` high-confidence fast-path with extracted aspect/mood/duration (12a–c); image generate/edit (edit without upload → honest `requires_clarification`, 12d–e); instrumental with honest procedural limitation (12f); short film (12g); ordinary questions NEVER route to production (12h); ambiguous → one concise clarification (12i); singing/lip-sync → honestly `unsupported` with real alternatives, never a fake capability (12j–k); song-expected-but-not-uploaded blocks fast-path and asks (12l); cloud-blocked → cinematic_motion suggestion (12m); sung-song inside MV stays MV with `wantsSungSong` (12n); spec drafts pass the REAL validateSpec (12o); hint note carries enums, never raw message text (12p); classification→draft→createProduction composition lands `awaiting_confirmation` via the real shared path (12q). |
| REG-13 | `regression/t13-config-panel.test.ts` | **PASS (9/9 — Phase-4 C+D: chat-native config panel schema)** | Category-specific fields per type incl. music-video song selector (13a–b); duration options within DURATION_LIMITS for every type (13c); unsupported options (60fps, 4K) disabled WITH reasons — never silently promised (13d); schema defaults pass the REAL validateSpec for all 5 types (13e); field validation: required-missing, disabled-option, out-of-range, in-range-custom, optional-omitted (13f); GET route 200/400 (13g); songs listed as id/name only — no paths/URLs (13h); rate limit 429 (13i). |
| REG-14 | `regression/t14-capability-confirm.test.ts` | **PASS (12/12 — Phase-4 D+E: capability validation & confirmation)** | Structured verdicts: clean image → supported, video → supported_with_limitations with honest notes (14a); 4K/60fps → transparent adjustments to real maxima (14b); client capability claims (isSupported/provider/cost) NEVER override server validation (14c); missing/unknown type → requires_clarification/unsupported (14d); provider busy/cooldown → temporarily_unavailable, snapshot crosses the boundary WITHOUT error text (14e); cinematic_motion unaffected by cloud state (14f); malformed/oversized body → 400 (14g); confirm: awaiting → queued + startProduction exactly once (14h); unsupported overrides → honest §15 server-side adjustment persisted (14i); repeated confirm → 409, unknown → 404 (14j); cancel → no start, post-cancel confirm → 409 (14k); **song deselect (explicit null override) clears the stored song — preview/actual agree, edit never silently reverted (14l — review-fix regression lock)**. |
| REG-15 | `regression/t15-intent-metrics.test.ts` | **PASS (6/6 — Phase-4 B+G: intent metrics & redaction)** | Classification recorded with enums/counts only + pre-existing fields intact (15a); planningMs only on fast path, silent no-op without classification (15b); metrics line carries intent, redaction canary never appears (15c); backward-compat — old logRunMetrics call shape still works, null → honest null (15d); clearRunMetrics drops intent (15e); classification deterministic & cheap — 1000 calls well under LLM-scale time (15f). |

Plus `smoke.test.ts`: framework sanity + registry↔catalog parity invariant (41/41) + run-metrics accumulator units.

## Hermetic-ness caveats (honest limits)

- Route-level tests (REG-2/3/4) exercise the **real route handlers** with a
  fake `db`, fake auth and a stubbed `startAgentRun`. They do not run the
  real orchestrator loop, real LLM, or the production runner.
- t1's verification path runs the **real** `audioQuality` (ffmpeg) on real
  temp WAV files — the strongest local substitute for a live provider.
- The suite intentionally does **not** verify: live provider latency,
  browser EventSource reconnection (client JS), or production artifact
  registration (covered by DB evidence in the Phase-1 report).
- REG-7 covers the React-free persistence helpers of the P0-BUG-03 fix;
  the EventSource re-attach wiring in `use-agent-run.ts` itself is
  typechecked + source-verified (driving a real DOM would need RTL —
  not added, same decision as Phase 1).
