# Phase-1 — Structured Observability (Task 4)

## 1. Design

**Goal:** one correlated, safe, low-volume summary per run and per production so that 403/429/timeout/refresh/retry/artifact failures can be debugged from a single log line + DB rows, without new infrastructure.

**Decision:** the project already has rich per-entity observability (see §2). The missing piece was a *joined* end-of-run/end-of-production summary. Phase 1 adds a **minimal instrumentation layer** (`src/lib/agent/run-metrics.ts`, dependency-free) that emits exactly one structured JSON console line per terminal state:

```
[run-metrics] {"runId":"…","conversationId":"…","outcome":"completed","endReason":"final_answer","errorCategory":null,"requestedMode":null,"usedModel":"…","cacheStatus":"miss","steps":3,"toolCalls":2,"durationMs":42300,"firstTokenMs":1850,"retryWaitMs":4200,"retryCount":1,"toolNames":["web_search","plan_music"],"ts":"…"}
[production-metrics] {"productionId":"…","type":"short_film","outcome":"partial","queueWaitMs":1200,"durationMs":615000,"stepsDone":7,"stepsFailed":1,"artifacts":5,"errorCategoryHint":null,"ts":"…"}
```

Wiring (all additive, typechecked, suite-green):
- `orchestrator.ts` — `chatCompleteWithNotes` counts every LLM-channel retry/cooldown wait into a run-scoped accumulator (`noteRetryWait`); `executeToolCall` appends the tool name; `finalizeRun`/`failRun` read the final DB row + accumulator and emit `[run-metrics]` then clean up.
- `production/runner.ts` — at production end (normal path + `failProduction`) emits `[production-metrics]` with queue wait (`startedAt−createdAt`), duration, step tallies, artifact count (best-effort; failures degrade to `null`, never block the production).

## 2. Field matrix — requested vs status

| Requested field | Status | Where it comes from |
|---|---|---|
| Run/job identifiers | ✅ Implemented | Every metrics line + every `logStep` + DB PKs |
| Category and provider/model | ✅ Implemented | `production-metrics.type`; `run-metrics.usedModel` + `ChatCallMeta{provider,providerLabel,model}` per LLM call (stored in `AgentStep.payloadJson`) |
| Intent/planning duration | ⚠️ Partial | Per-LLM-call `latencyMs` is recorded in `AgentStep` payloads; a phase-level "planning" timer is **not measured** (null) — needs pipeline-phase timestamps in Phase 2 |
| Queue wait | ✅ Implemented (productions) | `production-metrics.queueWaitMs = startedAt − createdAt`; chat runs start immediately (n/a → null) |
| Provider submission and runtime | ⚠️ Partial | Tool-level: `ToolCall.durationMs` (all tools). Intra-provider phases (e.g. CogVideoX submit vs poll) are **not broken out** → null |
| Retry count and retry wait | ✅ Implemented (LLM channel) | `run-metrics.retryWaitMs` + `retryCount` (accumulated from `withRetry` waits in `chatCompleteWithNotes`). Tool-internal retry waits (e.g. TTS inside pipelines) not yet accumulated — documented gap |
| Download and media assembly | ⚠️ Partial | Per-step `ProductionStep.startedAt/finishedAt` covers assembly phases (e.g. `final_mix` 129.9 s in the baseline production); explicit download timings **not measured** → null |
| Quality-control duration | ⚠️ Derivable | QC runs inside pipeline steps (validate/verify); duration derivable from step rows, not a separate field → null in the summary line |
| Total duration | ✅ Implemented | `run-metrics.durationMs`, `production-metrics.durationMs` |
| First progress event / first artifact | ⚠️ Partial | Chat: `firstTokenMs` ✅. Productions: first-artifact timing derivable (`artifact.createdAt − startedAt`) but **not in the summary line** |
| Final outcome (succeeded/partial/failed/cancelled) | ✅ Implemented | `outcome` field (runs: completed/failed/interrupted; productions: completed/partial/failed/cancelled) |
| Safe error classification & provider failure type | ✅ Implemented | `errorCategory` (13-way, incl. `rate_limited`, `timeout`, `ffmpeg_error`, `storage_error`…) + `endReason`; metrics never contain raw error text |

**Honesty rule:** anything not measured is logged as `null` — never fabricated.

## 3. Safety & volume

- **Redaction:** metrics lines contain only ids, enums, counts, durations, model names, tool names (capped at 24). No user content, no raw error strings (category only — full errors stay in DB), no keys/tokens/URLs.
- **Volume:** +1 console line per run end, +1 per production end. No per-event additions. Existing `logStep` volume unchanged.
- **Overhead:** the production-end path performs 3 small indexed reads (production row, artifact count, step statuses) once per production — negligible vs multi-minute pipelines. Run-end path performs 0 extra queries (reuses the already-fetched `finalRun` row).
- **No new dependency;** no new middleware; HMR-safe globalThis state (same pattern as the event bus).

## 4. Verification status

- ✅ Unit-tested: accumulator behavior, clear-on-terminal, exact single-line JSON format with nulls (in `tests/smoke.test.ts`).
- ✅ Direct-invocation smoke: both line formats captured (see `baseline-report` window log).
- ✅ Typechecked + suite-green with wiring in place.
- ⚠️ **Not yet captured live:** an end-to-end `[run-metrics]` line from a real owner chat run — blocked by the active owner-security gate (passcode not available to this agent; no live-LLM budget approved). Expected to appear in `dev.log` on the first owner-driven run after Phase 1.

## 5. What Phase 2 should add (recommendations, not implemented)

1. Tool-internal retry-wait accumulation (pipe `withRetry` onWait through tools → same accumulator).
2. Production phase timers (plan/queue/submit/assemble/QC) as explicit fields.
3. First-artifact latency for productions in the summary line.
4. Persist metrics lines (or a metrics table) if console grep proves insufficient.
