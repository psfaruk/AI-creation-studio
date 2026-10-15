# Phase 3 — Latency Results (Workstream D: queue / retry / latency)

Honesty rules (inherited from Phase 1): no mock timing is presented as provider
latency; unmeasured metrics are listed as NOT RUN; no percentiles claimed on small
samples; improvement claims only with comparable before/after + sample size.

## 1. What was implemented (evidence class: unit-test + code-inspected)

### 1.1 Stage-level video metrics (REDACTION-safe, LOW VOLUME kept)

`src/lib/agent/run-metrics.ts` gains a **production-scoped accumulator**;
`generateVideoClip` records per-shot stage durations
(`submit` / `poll` / `download` / `validate`) and per-call outcomes
(`cacheHit` / `joined` / `generated` / `bypass`) + cache events
(`store` / `invalid`). The production identity comes from the **same
AsyncLocalStorage scope** the ffmpeg tracker uses (`currentTrackedProductionId()`,
`ffmpeg.ts`) — no pipeline signatures changed, and chat-path calls (no scope)
create no accumulator (REG-11a, map-inspected).

The existing one-line-per-production `[production-metrics]` log now carries a
`video.*` block (counts + ms totals only — structurally redacted; REG-11b proves a
canary prompt/URL cannot appear in it). Both the success and `failProduction` paths
emit it, then drop the accumulator (REG-11c lifecycle + 200-accumulator safety
valve). This directly addresses the Phase-1 §7 ask: next real runs will have
stage-split shot latency (queue-wait was already wired as `queueWaitMs`).

### 1.2 Retry / cancellation / concurrency audit (verify-and-document; no gaps found)

| Path | Existing bound (re-verified this phase, code-inspected) | Verdict |
|---|---|---|
| ai_video submit | 429 ladder [15,30,60,90,120]s bounded by the 8-min submit budget; non-429 submit errors rethrow immediately (permanent ≠ retried) | keep — REG-6-locked |
| ai_video poll | adaptive 10→45s interval, 15-min timeout, 429 tolerated in-poll | keep |
| TTS | shared profile-chain fallback ≤5 (bn) / ≤7 (en) voices; engine-aware skip; honest exhaustion (Phase-2 REG-1 + new REG-8) | keep |
| LLM chat | `withRetry` bounded attempts + ms budgets + cooldown fast-fail | keep — REG-6-locked |
| ffmpeg | no retry (local, deterministic) — but `mixSoundLayers`' raw mix was previously untracked by the cancel-kill system: now switched to `runFfmpeg` (same exit-code contract, plus cancellation kill) | small D fix |
| Cancellation | `checkCancelled` at every step start + per-shot; `isCancelled` 2s ticks inside provider polls; 5s ffmpeg kill-watch; `CancelledError` name-contract | keep — t2/t7 lock parts |
| Concurrency | `MAX_CONCURRENT=2` productions; single-task video gate + 150s cooldown | **unchanged invariant** — Phase 3 introduces no unbounded parallelism anywhere (cache lookup/store are local fs; in-flight dedupe *reduces* submits) |

No unbounded retry or parallelism gap was found; the audit table stands as the
deliverable together with the metrics wiring.

## 2. Local, measurable now (real ffmpeg, n=3, medians)

**Loudnorm cost added to final mix** (the Workstream-B trade, measured on the
REG-9 fixture: 8s, 3 layers, real engines):

| Path | Median wall time (n=3) | Loudness result |
|---|---|---|
| Raw mix only (old behavior) | **608 ms** | −24.8 LUFS (quiet — the bug) |
| Mix + two-pass loudnorm (new) | **1,397 ms** | **−15.9 LUFS / −10.7 dBTP** |
| **Added cost** | **≈ 789 ms per 8s mix** | quality fix delivered at ~0.8s/8s-mix |

For scale: the recorded `yrz3ymb7` final_mix step took 129.9s for a 30s film —
the added normalization cost is sub-1% of that step's existing wall time.

**Cache-hit serving vs generation**: with the mocked provider both are ~instant in
tests; real provider serve times are ~2–7 min/shot (Phase-1 historical) — a real
hit avoids that entire span. **No real savings number is claimed** (see §3).

## 3. NOT RUN / blocked (no live budget in this phase)

| Metric | Status |
|---|---|
| Real provider-side stage timings (submit/poll/download/validate distributions, n≥10) | **NOT RUN** — instrumentation is in place; first live productions will emit it |
| Before/after total-production latency with cache hits | **NOT RUN** — needs live runs; `video.shotsFromCache`/`providerSubmits` counters will make the comparison factual |
| Queue-wait under concurrent AI-video productions (Phase-1 §7.3) | **NOT RUN** — `queueWaitMs` is already emitted for future evidence |
| P50/P90/P95 | **not claimed** — largest same-type sample remains n=1 production (historical) |

## 4. Invariants preserved (checked, not assumed)

- One metrics line per production end (per-shot data only aggregates into it).
- Unmeasured → `null`/absent; accumulator absent (chat path) → no `video` block.
- `MAX_CONCURRENT` and the single-task gate untouched; no new timers beyond the
  existing ones; stage timing uses `Date.now()` deltas only.
