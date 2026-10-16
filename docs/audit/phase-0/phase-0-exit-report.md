# Phase 0 — Exit Report

## 1. Exit-criteria checklist (Work Package H)

| Criterion | Status | Where |
|---|---|---|
| Repository baseline recorded (branch, SHA, tree, runtimes, package manager, lockfile) | ✅ Met | environment-baseline.md §1-2 |
| Package scripts, deps, env names, Prisma schema & migrations inventoried | ✅ Met (note: push-based, no migrations dir) | repository-inventory.md §1-4 |
| Platform-specific / Windows-10 risks identified | ✅ Met (Hypothesis-labeled — Windows not tested) | environment-baseline.md §7 |
| Available static checks have **real results** (commands actually run, exit codes captured) | ✅ Met — lint 0 / tsc 0 / prisma valid 0 / ffmpeg+ffprobe present; build Not Run (disallowed), test suite nonexistent | environment-baseline.md §5; functional-test-results.md §1 |
| All important pipelines have a source-grounded capability matrix | ✅ Met — chat/agent, image, instrumental, sung-song, voiceover/dialogue, motion video, music video, short film, event plumbing, artifact handling (each: request → routing → provider → output → validation → failure → UI) | pipeline-capability-matrix.md |
| Each critical pipeline has a functional test result or an explicit blocker | ✅ Met — 7 passed w/ evidence, 2 failed w/ evidence, 1 blocked (singing model), 4 not-run w/ reasons (budget/fault-injection) | functional-test-results.md §2-3 |
| Available media artifacts have technical metadata (decodability, duration, codecs, resolution, FPS, audio, silence/clipping where practical) | ✅ Met — 8 artifacts profiled; loudness/silence/A-V-sync measured; technical vs perceptual validation kept separate | media-quality-baseline.md |
| Confirmed defects separated from hypotheses | ✅ Met — 15 Confirmed / 2 Hypothesis / 0 Unknown | bug-register.md |
| High/Critical issues have proposed next actions | ✅ Met | §3 below |
| Regression-test recommendations for Phase 1 documented | ✅ Met | functional-test-results.md §4 |

**Phase 0 exit criteria: MET. Phase 1 was not started (per instruction).**

## 2. What was actually inspected (summary)

- Full reads (this window, by the lead auditor): `api/chat/route.ts`, `agent/{llm,external-llm,retry}.ts`, `agent/events.ts`, `agent/production/{bus,runner,pipelines/index,pipelines/image,pipelines/audio}.ts`, `agent/capabilities.ts`, `media/ffmpeg.ts`, `agent/storage.ts`, `prisma/schema.prisma`, `package.json`.
- Full reads (this window, by trace subagents, reports cited with file:line): `production/pipelines/{motion_video,music_video,short_film}.ts`, `video/{ai_video,capability_router,lip_sync_module}.ts`, `film-helpers.ts`, `local-frames.ts`, `orchestrator.ts`, `audio/music_engine.ts`, `audio/{language_controller,edge_tts}.ts` (targeted), `production/create.ts`, all production/artifact/provider-key/v1 API routes, and the full UI surface (`use-agent-run`, `use-productions`, chat/studio components, `page.tsx`).
- Live inspection: dev.log (clean), read-only DB queries, ffprobe/ebur128/silencedetect on all 5 media artifacts, git state.
- Subagent traces are logged in `worklog.md` (Tasks P0-B1, P0-B2, P0-B3).

## 3. Highest-priority issues for Phase 1

1. **P0-BUG-01 (High) — Bengali TTS fallback is structurally unreachable.** Fix the try/catch + engine-aware fallback chain first: it gates every speech-bearing feature (voiceover, short-film dialogue) and is the difference between a talking film and a silent one whenever Edge TTS 403s. Small, well-isolated change with a clear regression test.
2. **P0-BUG-03 (Medium) — Chat-run refresh persistence.** The SSE route already supports pure-DB replay; only the client needs to persist `activeRunId` and re-attach. Prevents duplicate/parallel runs, a data-integrity risk.
3. **P0-BUG-13 (Medium-Hypothesis) — Concurrency vs single-task video gate.** Before any multi-production Phase 1 work, make the AI-video submission queue globally budget-aware (or cap ai_diffusion concurrency at 1); otherwise a second production silently burns its submit budget.
4. **P0-BUG-04 (Medium) — AI-shot reuse for re-runs.** Largest cost lever for video iteration; needs a design decision (persisted per-shot clips + prompt-hash keyed reuse) before Phase 1 feature work multiplies regeneration cost.
5. **P0-BUG-02 (Medium) — Film loudness target.** One-line-ish loudnorm addition; do after BUG-01 to measure with real dialogue.
6. **Test harness gap (process)** — the repo has no automated tests at all; Phase 1 should start with the 6 regression tests in functional-test-results.md §4 (mocked-4029 TTS chain, speech regression, chat-refresh, instrumental golden, SSE replay contract, 429 fault-injection flag) before new capabilities are added.

## 4. Limitations preventing fuller completion

- **No live generation authorization** → image/motion-video/music-video/voiceover were not exercised live in this window; their status rests on source tracing + recorded artifacts + historical E2E logs. A ~15-minute budgeted live pass (1 image, 1 voiceover, 1 motion video draft) would upgrade these from Code-confirmed to Confirmed.
- **No production build** (`next build` disallowed in this sandbox) — build/standalone health Not Tested.
- **No test framework exists** — nothing to run beyond lint/typecheck/prisma.
- **Fault injection absent** — 429/timeout paths could not be deterministically induced (only historical accidental evidence).
- **Windows 10 not available** — platform risk assessment is Hypothesis-only.
- **Perceptual quality** (singing realism — moot until a model exists; motion realism; character continuity) requires human evaluation, deliberately out of Phase 0 scope.
- **Singing capability is Blocked** on provider availability/licensing; the app's honest-refusal path is the implemented and verified behavior.

## 5. Artifacts produced by this audit

- `docs/audit/phase-0/README.md`
- `docs/audit/phase-0/environment-baseline.md`
- `docs/audit/phase-0/repository-inventory.md`
- `docs/audit/phase-0/pipeline-capability-matrix.md`
- `docs/audit/phase-0/functional-test-results.md`
- `docs/audit/phase-0/media-quality-baseline.md`
- `docs/audit/phase-0/bug-register.md`
- `docs/audit/phase-0/phase-0-exit-report.md` (this file)
- Worklog entries: P0-B1, P0-B2, P0-B3 (subagent traces) + P0 main entry.

No source code, configuration, or database state was modified by this audit (working tree's 3 pre-existing mode-only changes preserved; audit docs are new files).
