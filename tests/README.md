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
