# Phase-1 — Test Framework & Six Core Regression Tests (Tasks 2+3)

## 1. Framework decision

**Chosen: `bun:test`** — Bun's built-in test runner (Bun 1.3.14).

- **Zero new dependencies** — satisfies the "prefer existing infrastructure" constraint. Vitest was evaluated as a candidate but would add a dependency tree for no capability this suite needs.
- Jest-style API (`describe`/`test`/`expect`/`mock.module`), native TypeScript, native tsconfig path-alias (`@/*`) resolution.
- Failed assertions produce a **non-zero exit code** (verified: suite currently exits 1 because of the recorded application regression).
- React Testing Library was **not** added: no DOM interaction is asserted. The client-side refresh gap is proven via server-side contract tests + source evidence (cheaper, hermetic, and it is the *server* that defines what a refreshed client can recover).

### Reproducible commands

```bash
bun run test                                        # whole suite (37 tests, 7 files)
bun test tests/regression/t1-bengali-tts-fallback.test.ts    # single file
bun test tests/regression/t5-instrumental-audio.test.ts -t "REG-5a"  # single test
```

Full isolation contract (no real DB, no live providers, no storage writes, millisecond-scale waits): see [`tests/README.md`](../../../tests/README.md). A hand-written type shim (`tests/bun-test-shim.d.ts`) lets `tsc --noEmit` cover test files without altering global app types.

### CI

No CI workflow file exists in this repository (verified — no `.github/` directory), so no CI step was added. `bun run test` is CI-ready as-is (non-zero exit on failure) and is documented as the canonical command for whenever CI is introduced.

## 2. Six core regression tests — explicit results

### REG-1 — Bengali TTS fallback (Edge 403 → z-ai)

| Field | Value |
|---|---|
| Verdict | **FAIL (application regression — P0-BUG-01, recorded, not hidden)** |
| Expected behavior | With every Edge voice returning 403, `synthesizeVerifiedSpeech` walks the bn profile chain and returns audio from a z-ai fallback voice (`jam`/`douji`) with honest `warn` verdict |
| Actual behavior | The first Edge 403 **escapes the loop uncaught** (`language_controller.ts:401` — no try/catch around `cachedSynthesizeSpeech`), so the chain aborts before any fallback; the z-ai mock is never called |
| Files | `src/lib/agent/audio/language_controller.ts` (loop + cap), `src/lib/agent/tts-cache.ts` (engine routing), `src/lib/agent/audio/edge_tts.ts` (isEdgeVoice) |
| Test boundaries | Mocks: `@/lib/agent/tts-cache` (Edge→403 / z-ai→valid WAV; behavior switched via a call-time mode variable), `@/lib/agent/sdk-helpers` (transcribeBuffer→Bengali). Real: normalizer, edge_tts routing, `pcm.encodeWav`, **real ffmpeg** `audioQuality` on temp WAVs. No network. |
| Companion test | REG-1b (**PASS**) — characterization: even with successful-but-failing-verification Edge audio (no throw), the loop cap `attempts >= Math.min(2, voices.length)` stops after 2 Edge voices; z-ai unreachable (asserted `attempts===2`, `zaiCalls===0`). This locks in structural defect #2 of P0-BUG-01 separately from the uncaught-throw defect #1. |
| Failure evidence | Stack trace points at `language_controller.ts:401` via the test's mock — the exact production line from the bug register (production `yrz3ymb7`: "0/4 সংলাপ-লাইন সফল", Edge TTS 403) |
| Fix direction (Phase 2) | try/catch per voice + engine-aware skip to z-ai after Edge-engine failure; extend the cap; then REG-1a flips to PASS and REG-1b must be updated to the expected contract |

### REG-2 — Chat run refresh and reconnect (server side)

| Field | Value |
|---|---|
| Verdict | **PASS (server-side recovery)** — client-side re-attach gap documented as REG-2d (P0-BUG-03 client half) |
| Verified | REG-2a: fresh GET on a RUNNING run replays `run_started` + in-flight `tool_start` from DB, no terminal event. REG-2b: live `tool_end` flows to an attached connection mid-stream (bus + route). REG-2c: after completion, a brand-new ("refreshed") connection replays `tool_end` → `message` → exactly one `run_finished` and the stream closes server-side |
| Files | `src/app/api/runs/[id]/events/route.ts`, `src/lib/agent/events.ts`, `src/lib/agent/serialize.ts` |
| Boundaries | REAL route handler + REAL event bus; `@/lib/db` mocked in-memory; `@/lib/security` mocked ok. "Refresh" simulated as a brand-new request with the same runId — exactly what the server can recover for a reloaded client |
| Known gap (documented, not fixed) | `use-agent-run.ts` keeps `isRunActive`/runId in component memory only; on browser reload nothing re-attaches the EventSource, so duplicate runs become possible (see REG-3). The SSE route's DB replay is the ready-made server half of the fix |

### REG-3 — Duplicate submission

| Field | Value |
|---|---|
| Verdict | **PASS (documents current behavior + expected contract)** |
| Current behavior (asserted) | While run R1 is `running` in conversation C, a second POST `/api/chat` with the same logical request **returns 200 with a distinct runId**; `AgentRun.create` is called unconditionally (2 running rows for one conversation); `startAgentRun` fires twice. The only guard is the client's in-memory `isRunActive` (lost on refresh/second tab). Rapid same-tab double-submit is throttled only by the per-IP burst rate limiter, not run state. Unknown conversation → 404 with no run created |
| Expected idempotency contract (recorded) | While a run is `running` for the same conversation, a new submission should be rejected (409) or deduplicated until terminal state. **Not implemented in Phase 1** (constraint: no Phase-2 feature work) |
| Files | `src/app/api/chat/route.ts` (unconditional `agentRun.create`), `src/hooks/use-agent-run.ts` (memory-only guard) |
| Boundaries | REAL POST handler; mocks: `@/lib/db` (in-memory), `@/lib/security`, `@/lib/agent/orchestrator.startAgentRun` (recorded noop), `@/lib/agent/storage` (throws if reached — no attachments sent) |

### REG-4 — SSE event replay (disconnect → reconnect)

| Field | Value |
|---|---|
| Verdict | **PASS** |
| Verified | Bus: pre-subscribe events recoverable via replay buffer with order preserved (REG-4a); buffer capped at 100, oldest trimmed (REG-4b); after `run_finished` the buffer stays available for a late joiner (grace window, REG-4c). Route: duplicate `tool_start` (same activityId) and duplicate `run_finished` deduped on the wire, `text_delta` forwarded as-is (REG-4d); reconnect after a disconnect window replays durable events in order `tool_start → tool_end → message → run_finished`, exactly one terminal event, stream closes, and non-durable `text_delta` is correctly **absent** from DB replay (REG-4e) |
| Files | `src/lib/agent/events.ts`, `src/app/api/runs/[id]/events/route.ts` (forward-dedupe), `use-agent-run.ts` (client-side activity dedupe — source-verified) |
| Boundaries | Same harness as REG-2 (real route + bus, fake db/auth) |

### REG-5 — Instrumental audio (procedural engine)

| Field | Value |
|---|---|
| Verdict | **PASS** |
| Verified | REG-5a: nominal synthesis (joyful, 10 s, 104 BPM, seed 42) → structurally valid WAV (RIFF/WAVE, 44.1 kHz, 16-bit, data-chunk consistency), truthful metadata (duration ±1.5 s, exact BPM, keyLabel, beat markers, sections, **honest procedural label** "নিউরাল মিউজিক-মডেল নয়"). REG-5b: `validateInstrumental` passes on engine output via **real ffmpeg** (duration match, no clipping, no long silence; loudness/peak reported). REG-5c: same seed → byte-identical output (determinism). REG-5d: spec clamping to [8 s, 120 s] and mood tempo range. REG-5e: unknown mood fails loudly (current failure mode documented). REG-5f: mood detection/labels |
| Output registration | Pipeline-level (`ctx.registerArtifact`) is DB+fs dependent and stays out of the hermetic suite; Phase-1 evidence instead comes from the real dev-DB artifacts (`instrumental-joyful-104bpm.wav` + `.mp3` with `pipeline:'audio/instrumental'`, tempoBpm, honestLabel metadata — captured in [latency-baseline.md](latency-baseline.md) §5) |
| Files | `src/lib/agent/audio/music_engine.ts`, `src/lib/agent/audio/pcm.ts`, `src/lib/agent/production/pipelines/audio.ts` (registration path) |
| Boundaries | No mocks at all; local compute + real ffmpeg. No brittle byte-for-byte golden assertions (determinism is asserted seed-vs-seed instead) |

### REG-6 — HTTP 429 retry behavior

| Field | Value |
|---|---|
| Verdict | **PASS** |
| Verified | REG-6a: 429 exhausts exactly `attempts` (3) tries then throws `TemporarilyUnavailableError` ("সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট)") — bounded, never a false success. REG-6b: permanent 401 error is **not retried** (exactly 1 attempt, rethrown as-is, not wrapped). REG-6c: transient 429 then success → recovery without error. REG-6d: `onWait` fires per retry with ascending attempts, delays bounded by `maxDelayMs`. REG-6e: `Retry-After: 30` honored but capped by `maxDelayMs`. REG-6f: with the channel in real cooldown, the **total wait budget fast-fails** (~250 ms wall for a 40 ms budget) with an honest rate-limit error and **zero wasted provider calls**. REG-6g: same-channel calls serialized (no parallel 429 storm). REG-6h/i/j: `parseRetryAfterMs` (prop/header/message), `fullJitterDelayMs` bounds, `isRateLimitErrorText` classification (429 ≠ license problem) |
| Files | `src/lib/agent/retry.ts`, `src/lib/agent/rate-limit-coordinator.ts` |
| Boundaries | No mocks — failing "provider" is a local closure; all waits millisecond-scale (real timers, no fake-timer dependency); coordinator globalThis state reset per test |

### Smoke/invariant tests (bonus coverage)

Path-alias resolution; **registry↔catalog parity locked at 41/41** (guards against silent drift); run-metrics accumulator units (retry-wait accumulation, clear-on-terminal, single-line JSON format with `null` for unmeasured).

## 3. Suite totals (final state)

```
Ran 37 tests across 7 files: 36 pass / 1 fail (650 expect() calls, ~10 s wall)
Exit code: 1 (the 1 fail is the recorded P0-BUG-01 regression — REG-1a)
```

Determinism: three consecutive full runs produced identical pass/fail sets.

## 4. Known limitations / not covered by the suite

- The real orchestrator loop (LLM steps) is not unit-tested — it requires a live LLM; its seams (retry notes, tool timeouts, finalize paths) are covered by the retry tests + metrics units + typecheck.
- Browser `EventSource` reconnection behavior is source-verified only (no DOM test).
- Production artifact registration is evidenced from the dev DB, not re-executed.
- Fault-injection of *real* provider 429/403 (as opposed to mocked) remains future work once a budgeted live pass is approved.
