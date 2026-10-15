# Phase 0 — AI Creative Studio Baseline Audit

**Repository:** `psfaruk/AI-creation-studio` (working tree at `/home/z/my-project`, default branch `main`)
**Audit HEAD:** `f5fe33610a30bf3e3f4c35a24119e23eb6109057` (`f5fe336` "worklog: deep-audit fix round (tasks 14/15/16)")
**Audit window:** single Phase 0 session. No live generation was executed during this window (no budget authorization); all dynamic evidence comes from artifacts and database rows produced by prior end-to-end sessions, plus safe static checks that were actually run and captured.

## Scope

Source-grounded, reproducible baseline of the existing application **before** implementing new media-generation capabilities (image, instrumental audio, singing/full-song, voiceover, motion video, music video, short film, chat progress, artifact handling).

**Nothing in this report claims a feature works because it exists in source or README.** Every claim is marked **Confirmed** (reproduced/captured in this window or present as recorded runtime evidence), **Hypothesis** (source-reasoned, not reproduced), or **Not Tested**.

## Method

1. **Repository baseline** — git state, runtime/tool versions, package inventory, environment-variable names (never values), Prisma schema. → [environment-baseline.md](environment-baseline.md), [repository-inventory.md](repository-inventory.md)
2. **Pipeline tracing** — full reads of the chat route, LLM adapters (SDK + external), event buses, production runner, all five pipelines, music engine, orchestrator, TTS/language controller, FFmpeg layer, and the UI/API surface (hooks, components, routes), with file:line references. → [pipeline-capability-matrix.md](pipeline-capability-matrix.md)
3. **Safe static checks** — ESLint, `tsc --noEmit`, `prisma validate`, FFmpeg/ffprobe availability. All actually executed with exit codes captured. → [functional-test-results.md](functional-test-results.md)
4. **Functional test matrix** — 14 defined tests; each marked Passed / Failed / Blocked / Not Run with evidence. → [functional-test-results.md](functional-test-results.md)
5. **Media baselines** — ffprobe + loudness/silence/A-V-sync measurement of every existing media artifact. → [media-quality-baseline.md](media-quality-baseline.md)
6. **Bug register** — unique IDs, severity, repro, expected vs actual, evidence, root-cause classification, proposed fix + regression plan. → [bug-register.md](bug-register.md)
7. **Exit report** — exit-criteria checklist, priorities for Phase 1, limitations. → [phase-0-exit-report.md](phase-0-exit-report.md)

## Safety constraints honored

- No working-tree reset or overwrite; the 3 modified files (mode-only `100644→100755`) are preserved untouched.
- No destructive database commands; no `--accept-data-loss`; all DB reads were via a **read-only** SQLite connection.
- No secrets, keys, tokens, `.env` values, or private logs reproduced in these documents.
- No live/expensive generation executed (budget not authorized); blocked tests are marked explicitly.
- No singing, lip-sync, or camera-pipeline changes implemented.
- Reported command successes are only for commands actually run in this window (see functional-test-results.md §1).

## Headline results

- **Static health:** ESLint 0 errors, `tsc --noEmit` 0 errors, Prisma schema valid, FFmpeg/ffprobe 7.1.5 present.
- **One production fully evidenced end-to-end:** a 3-scene Bengali short film (all 8 steps executed, 3 genuine CogVideoX-3 shots, 30.1 s, 1080×1920@30 fps H.264 + AAC, burned-in subtitles, A/V sync OK) — but finished `partial` because **all 4 Bengali dialogue lines failed TTS** (Edge TTS 403) and the z-ai fallback chain never engaged (root-caused, P0-BUG-01, High).
- **Chat progress is not refresh-safe** (production progress is); several Medium/Low defects catalogued with fixes.
- **No singing model exists** and the app says so honestly — sung-song requests hit an honest-refusal + alternatives path (Confirmed from source and prior E2E records; capability itself remains blocked pending a provider).

## Status

Phase 0 exit criteria: **met** (see phase-0-exit-report.md). Phase 1 was **not** started.
