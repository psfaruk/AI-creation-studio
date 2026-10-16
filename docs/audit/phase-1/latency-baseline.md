# Phase-1 — Latency Baseline (Task 5)

**Honesty rules applied:** mock timings are never presented as provider latency; unmeasured metrics are listed as blockers; with n<30 samples no P90/P95 is claimed — individual observations and (where it helps reading order) the median are shown.

## 1. Real provider latency — LLM chat (GLM via z-ai SDK)

Source: dev-database `AgentRun` rows from prior real end-to-end sessions (**Historical** — real provider calls recorded by the app itself, not re-executed in this window).

| Run | durationMs | firstTokenMs | steps | toolCalls | cache |
|---|---|---|---|---|---|
| glmiwv (completed) | 49,096 | 3,201 | 2 | 1 | miss |
| of08fn (completed) | 25,529 | 1,196 | 2 | 1 | miss |
| gbta48 (completed) | 14,882 | 4,702 | 2 | 1 | miss |

- firstTokenMs: n=3 → **1.2 s / 3.2 s / 4.7 s** (median 3.2 s). No P90/P95 (n too small).
- run durationMs: n=3 → **14.9 s / 25.5 s / 49.1 s** (median 25.5 s). Each run included one tool call.

## 2. Real provider latency — production pipeline (short film, CogVideoX-3)

Source: production `yrz3ymb7` DB rows (**Historical**, fully evidenced in Phase 0; timings extracted read-only now).

| Phase | Duration |
|---|---|
| Queue wait (confirm → start) | 25.1 s |
| script_breakdown | 33.5 s |
| character_bible | 152.1 s |
| acting_plan | 4.5 s |
| speech (TTS; all 4 lines failed Edge-403 → P0-BUG-01) | 14.0 s |
| **generate_shots (3× CogVideoX-3)** | **1,079.7 s (~18 min)** |
| sound_design | 3.1 s |
| continuity | 19.4 s |
| final_mix (ffmpeg) | 129.9 s |
| **Total (started → finished)** | **1,436 s (~24 min)** |

→ The dominant bottleneck by ~7× is **AI video generation (~6 min per shot average)**. This matches the Phase-0 recorded expectation (CogVideoX-3 ≈ 2–7 min/shot under a single-task gate).

Tool-level real latencies (same historical sessions): `plan_music` 21.0 s (LLM-backed), `generate_instrumental` 4.9 s (local compute), `propose_job` 2 ms (DB-only).

## 3. Local compute latency (measured in this window)

Source: the Phase-1 test suite itself, three consecutive runs (**Confirmed** — measured now, on this sandbox's CPU).

| Operation | Observation (reproducible via `bun test tests/regression/t5-instrumental-audio.test.ts`) |
|---|---|
| `synthesizeInstrumental` 10 s audio (joyful, seeded) | ~0.65–0.70 s |
| `synthesizeInstrumental` 120 s audio (clamped max) | ~4.9 s (REG-5d total 5.86 s incl. two more synths) |
| `validateInstrumental` (real ffmpeg QC) | ~0.80 s |
| Whole 37-test suite (incl. 6 ffmpeg-dependent tests, SSE harness, retry loops) | 9.7–9.8 s wall |

## 4. Retry / backoff behavior latency (mocked provider, measured in this window)

Mock timings say **nothing** about provider speed — they measure the retry machinery only (**Confirmed**, from REG-6):

- Bounded retries with millisecond budgets: exact attempt counts honored; total suite cost of all 429 tests < 1 s.
- Channel-cooldown fast-fail: a 40 ms total budget aborts in ~250 ms wall with zero provider calls (vs. an 8–15 s real cooldown that would otherwise be slept through).
- Production-scale real retry waits (the ~10.5 min TTS wait observed historically in the Phase-0 window) are covered by the *budget* mechanism, now machine-verified in REG-6f.

## 5. Mocked provider latency

**Not applicable by design.** The suite's mocked TTS/LLM boundaries measure control flow, not latency; no number from them is reported as provider latency.

## 6. Unmeasured / blocked metrics

| Metric | Status |
|---|---|
| Real image-generation latency | **Unmeasured** — no live call authorized in this window; no completed image production exists in the DB (the one prior image production attempt predates current schema evidence) |
| Real voiceover/TTS-success latency (Edge or z-ai) | **Unmeasured now** — historical evidence is failure-side (Edge 403); no successful speech run in DB |
| Real music-video / motion-video pipeline latency | **Unmeasured** — no completed production of those types in DB |
| P50/P90/P95 for any provider metric | **Not claimed** — largest same-type sample is n=3 |

## 7. Next measurements needed (to find the biggest bottlenecks)

1. **AI-video shot latency distribution** (n ≥ 10 shots): per-shot submit→ready timing vs. poll interval — to size P0-BUG-04 (shot reuse) and P0-BUG-13 (gate contention) correctly.
2. **Successful Bengali TTS latency** (Edge healthy + z-ai fallback) once P0-BUG-01 is fixed — needed to validate the fallback UX budget.
3. **Queue-wait under concurrent productions** (2 simultaneous AI-video runs) — P0-BUG-13 hypothesis test.
4. **character_bible step** (152 s) breakdown — LLM call vs. image generation share; it is the second-largest non-video cost.
5. **final_mix / ffmpeg** scaling with film length (129.9 s for 30 s film — check ~4× realtime cost).
