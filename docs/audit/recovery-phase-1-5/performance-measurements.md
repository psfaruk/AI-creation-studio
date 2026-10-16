# Recovery Phase 1–5 — Performance Measurements (R-DOC-3)

Measured numbers only, each with its sample size and environment. Per master §10:
**no P95/P99 or percentile claims from single samples**; historical, synthetic and
live-provider measurements are kept separate and labeled.

**Environment (all measurements):** 2 CPU cores, 4.1 GB RAM, **no GPU**; Bun 1.3.14;
ffmpeg 7.1.5-0+deb13u1; the dev server was running during suite measurements; the box is
shared (other agents/dev processes), which is noted wherever it matters.

## 1. Full-suite wall time

| Measurement | Value | Sample size | Notes |
|---|---|---|---|
| Recovery final full suite (`bun test tests`) | **184.96 s** — 185 tests / 22 files / 1977 expects, 185 pass / 0 fail | **n = 1** (`/tmp/r-g-full2.log`, 2026-10-16 22:19) | Single recorded run on the 2-CPU box with the dev server running; not a stable mean — the intermediate full run at 22:14 took 187.04 s with 30 fewer tests executing (contention + errors) |
| Recovery-start baseline (Phase-5 gate) | 164.90 s — 157 tests / 20 files | n = 1 (worklog P5-7) | Same box class |
| Quiet-tree Phase-5 final | 147.67 s — 157 tests | n = 1 (phase-5 test-results.md) | Included for fairness; conditions differ |

No per-test percentile is claimed from any of these single runs.

## 2. Per-suite / per-test durations (recorded runs only)

| Suite / test | Duration | Source & sample |
|---|---|---|
| t16 cinematic plan | ~2.9 s (22 tests, 324 expects — recovery-start count 22/22 in 2.88 s); now 27 tests, in-suite share small (slowest REG-16p4 1.33 s, REG-16p 0.80 s in the final run) | R-A2 single run (22/22) + `/tmp/r-g-full2.log` |
| t17 MV integration (real ffmpeg) | ~98 s (Phase-5 record); **~92.5 s summed** in the recovery final run (REG-17e 39.34 s, 17d 31.61 s, 17a 12.85 s, 17b 6.30 s, 17c 2.38 s) | phase-5 test-results.md; `/tmp/r-g-full2.log` |
| t19 SF integration | ~28 s (Phase-5 record); **18.09 s** (REG-19a) in the recovery final run — same test, different contention | phase-5 test-results.md; `/tmp/r-g-full2.log` |
| **t21 (new)** | **38.85 s for 2 tests** isolated (`/tmp/r-t21d.log`, n = 1); in-suite REG-21a 19.10 s + REG-21b 18.56 s (≈37.7 s) — two full SF pipeline runs with real ffmpeg | `/tmp/r-t21d.log`; `/tmp/r-g-full2.log` |
| t20 (new) | 1.19 s for 9 tests isolated (n = 1, `/tmp/r-t20d.log`); in-suite the 4 ffmpeg-verifying tests run ~266–279 ms each, the pure units <2 ms | `/tmp/r-t20d.log`; `/tmp/r-g-full2.log` |
| Slowest single tests in the final run | REG-17e 39.34 s, REG-17d 31.61 s, REG-21a 19.10 s, REG-21b 18.56 s, REG-19a 18.09 s, REG-17a 12.85 s, REG-9b 3.41 s, REG-9a 2.63 s, REG-9g 2.61 s, REG-17c 2.38 s | `/tmp/r-g-full2.log` (n = 1) |
| t8 rewritten (isolated) | 376 ms for 7 tests | `/tmp/r-t8b.log` (n = 1) |

## 3. Deterministic-planner latency (historical Phase-5 measurement — not re-measured in the recovery round)

- **Steady-state means 0.4–4.9 µs/call** across every planner entry point
  (`selectCutSegments` 0.81–1.16 µs; `planMusicVideo` 1.51–4.80 µs; `planShortFilmShots`
  1.43–3.11 µs; `planShortFilmSkeleton` 0.47–1.13 µs; full preview builders 0.57–3.08 µs),
  n = 10,000 iterations/case after 50-warmup, on this same 2-CPU box.
- Honest outliers recorded then: ms-scale maxima (1.94–17.56 ms) were 1–2 isolated samples
  per 10,000 attributed to shared-box GC/scheduler pauses, steady-state per-pass max
  ≤ 65 µs; cold-JIT first-pass means 2–5× steady state.
- Source: worklog P5-4 lines ("planner 0.4–4.9µs"; steady-state means 0.44–4.86 µs/call) and
  `docs/audit/phase-5/quality-and-performance-evidence.md`. The recovery round added planner
  code (D-F03 actionEn fallback, D-F04 two-character distribution, A2-F06 diversity guard) —
  the µs-scale class claim is expected to hold but was **not re-benchmarked** (recorded as
  such, no new numbers invented).

## 4. Wave-4 live-provider latencies (2026-10-16, n = 1 each, no percentiles)

- **Edge health probe:** fails fast with the honest WSS connection-error note (no hang, no
  retry storm) — the probe's bounded behavior is the only latency claim; exact ms not recorded.
- **en synthesis + ASR round-trip (real z-ai SDK):** completed within the script run —
  `evidence-tts.json` written at 22:21:40.8Z with the full chain (probe → bn rejection → en
  synthesis 241,296 B → real ASR transcript/similarity/token-coverage) already recorded.
  Per-call latency (TTS vs ASR) was **not separately instrumented** — stated as a limitation,
  not estimated.
- **VLM frame review (3 clips):** script completed at 22:23:33.9Z — the three vision calls
  finished inside the ~113 s window after the TTS script; per-call latency not recorded.
- No retries were needed on any Wave-4 call (attempts=1 on both synthesis chains).

## 5. Other recorded timings (from prior phases, kept separate — not re-measured)

- Historical real GLM timings (Phase-1, n = 3): firstToken 1.2/3.2/4.7 s; duration
  14.9/25.5/49.1 s — worklog Phase-1 latency baseline.
- Historical production `yrz3ymb7` breakdown (Phase-1, n = 1): 24 min total;
  generate_shots 18 min dominant; final_mix 130 s.
- Historical CogVideoX-3 (Phase-4 probes, n = few): ~138 s for a 5 s clip;
  post-completion cooldown ~2.2–2.5 min; in-flight 429 gating built into the scheduler.
- Local compute (Phase-1): instrumental generation 0.7–4.9 s; ffmpeg QC ~0.8 s.

## 6. What was NOT measured (honest list)

- Production E2E wall time of the **fixed** pipeline on a real provider run (no such run —
  Layer-D item D-b).
- TTS/ASR/VLM per-call latency distributions (single samples only; no percentiles claimed
  per master §10).
- Any GPU-dependent workload (no GPU exists; local lip-sync inference explicitly not forced).
- Client-side/browser timings in the recovery round (Phase-5 browser E2E numbers stand;
  no new browser run was needed or performed).
