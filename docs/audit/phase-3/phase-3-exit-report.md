# Phase 3 — Exit Report

**Phase**: Media Quality, Cost & Latency Optimization (Workstreams A→B→C→D)
**Baseline**: `2b0ef3e` (= `origin/main`; restored losslessly after a sandbox
snapshot-restore incident — README §1). **No commits, no pushes made in Phase 3**
(per workflow Step 6); all changes are in the working tree awaiting approval.

## 1. Exit status: **PASS WITH DOCUMENTED NOT-RUNS**

All four workstreams implemented, each landing with targeted regression tests; the
full suite is green: **75/75 tests, exit 0** (47 inherited unchanged + 28 new).
Typecheck / lint / prisma-validate all exit 0. Every acceptance criterion that can
be evidenced without live provider budget is evidenced; the rest are explicitly
NOT RUN with reasons (§4).

## 2. Deliverables

| Workstream | Code | Tests | Docs |
|---|---|---|---|
| **A** — motion-video TTS fallback (last P0-BUG-01 call site) | new `pipelines/voiceover.ts` (`synthesizeVoiceoverChunks`, shared-chain reuse, honest metadata); `motion_video.ts` narration block rewired + voiceover label/meta | REG-8 (7/7) | functional-test-results §REG-8 |
| **B** — final-mix loudness −16 LUFS / −1.5 dBTP | `ffmpeg.ts` `measureLoudness` + `normalizeLoudnessTwoPass` (two-pass, channel-aware, silence/corrupt/6ch handling); `sound_design.ts` `mixSoundLayers` post-merge normalization + truthful report fields; `short_film.ts` detail message; raw-mix call moved to tracked `runFfmpeg` | REG-9 (7/7) | media-quality-results |
| **C** — shot cache reuse (P0-BUG-04) | new `video/shot_cache.ts` (sha256 request-fingerprint, validated store/lookup, in-flight dedupe, eviction, counters); `ai_video.ts` `generateVideoClip` cache wiring + `fromCache`; honest `ক্যাশ-হিট` labels in all 3 pipelines | REG-10 (10/10) | cache-reuse-results |
| **D** — stage metrics + retry/cancellation audit | `run-metrics.ts` production accumulator + `video.*` metrics fields; `ai_video.ts` submit/poll/download/validate timing + outcome notes; `ffmpeg.ts` `currentTrackedProductionId()`; `runner.ts` wiring (success + fail paths) | REG-11 (4/4) | latency-results |

Files: 10 modified (`+618/−27`, all 27 deletions verified intentional), 2 new
source modules, 4 new test files, 8 audit docs (incl. pre-implementation design).
No new dependencies. No schema changes (`prisma validate` exit 0).

## 3. Acceptance criteria vs evidence

| Criterion (from the approved prompt) | Evidence | Verdict |
|---|---|---|
| motion-video TTS fallback works end-to-end; failures produce correct errors | REG-8a–g (real chain, controlled engines, real ffprobe timing) | **PASS** (unit/local-integration) |
| Final mix loudness / true-peak / A-V sync measured | −24.3 → **−15.9 LUFS**, TP **−10.5 dBTP**, duration/layout/fps/sync asserted (REG-9a/9b) | **PASS** (local-integration) |
| Real recorded artifact before/after | artifact lost with the snapshot-restored sandbox; regen needs live budget | **NOT RUN** (documented) |
| Same input → validated hit; changed input → miss | REG-10a/10b (submit-count + counter proof) | **PASS** |
| Duplicate submissions don't increase provider calls + real provider-call metrics | REG-10a/10e/10i (one submit across repeats/concurrency/prewarm) + `shotCacheStats`/`video.*` counters wired for real runs | **PASS** (no real-world savings claimed yet) |
| Latency before/after with sample size | local: loudnorm cost ≈789ms per 8s mix (n=3, medians); provider-side | **PASS (local) / NOT RUN (provider)** |
| Old + new suites green, no weakened assertions | 75/75; REG-1…7 untouched | **PASS** |
| No commit / no push; user changes intact | git status shows only Phase-3 changes; no force/reset/amend; worklog append-only (incl. reconstructed P2-1-push record) | **PASS** |

## 4. NOT RUN / BLOCKED (carried honestly)

1. `next build` — sandbox rule (unchanged since Phase 0).
2. Live provider verification (Edge-403 window, real shot cache hit on a real
   provider, real stage-latency distributions) — unauthorized budget; the
   instrumentation to measure all of this truthfully is now in place.
3. Real recorded media before/after (see §3).
4. Browser-E2E re-attach DOM harness — carried from Phase 2.

## 5. Risks & rollback (from implementation-design §6, unchanged)

A: revert the narration block hunk. B: unwrap the normalization call (helpers stay,
unused). C: remove the 2 wiring hunks in `generateVideoClip` (disk cache left
inert). D: revert wiring; accumulator inert. All changes are additive-first; the
27 deleted lines are the intentionally replaced implementations.

## 6. Stopped here

Per the mandatory workflow: **no commit, no push, no Phase 4, no extra budget
spent.** Awaiting user approval (and commit/push authorization) — executive
summary, changed-file list, measurements and remaining defects are in this report
and its siblings.
