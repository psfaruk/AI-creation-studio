# Phase-1 — Quality Checks & Reproducibility (Task 7)

All commands below were actually run in this window (2026-10-15); exit codes are quoted verbatim. Nothing is reported as passed that was not run.

## 1. Commands and exit codes

| # | Command | Exit code | Result |
|---|---|---|---|
| 1 | `bun run test` | **1** | 37 tests / 7 files: **36 pass, 1 fail** — the single failure is REG-1a, the *recorded application regression* (P0-BUG-01: Bengali TTS fallback unreachable on Edge 403). Suite is deterministic (3 consecutive runs → identical results). Exit 1 is the honest expected state until the Phase-2 fix lands |
| 2 | `bun run typecheck` (`tsc --noEmit`) | **0** | 0 errors (now covers the test files via `tests/bun-test-shim.d.ts` — no global type changes) |
| 3 | `bun run lint` (`eslint .`) | **0** | 0 errors, 0 warnings |
| 4 | `bunx prisma validate` | **0** | "The schema at prisma/schema.prisma is valid" |
| 5 | `bun run build` | **NOT RUN** | `next build` is disallowed in this sandbox (existing project constraint). Build health remains **Not Run — no claim made** |

## 2. Safety confirmations

- **Tests do not call live providers** — verified by construction and by run time: the whole suite (including every regression test) completes in ~10 s wall; no network-bound path exists in it. Engine boundaries are mocked (`tts-cache`, `sdk-helpers`, `orchestrator.startAgentRun`) or provider-free (event bus, retry, music engine, SSE route with fake DB, ffmpeg-local QC).
- **Database-dependent tests use isolated fixtures** — every DB-touching test installs `mock.module('@/lib/db')` backed by the in-memory fake (`tests/helpers/fake-db.ts`); `resetFakeDb()` per test. **The real SQLite dev database was never opened by the test suite.**
- **No development database reset** — no `db:push`, `db:reset`, `--accept-data-loss`, or destructive Prisma command was run in Phase 1. All DB access for evidence was read-only queries.
- **No test pollution of persistent state** — `git status -- storage/ db/` after the suite: empty (no writes to artifact storage or DB files).
- **CI integration** — no CI workflow exists in the repository (verified: no `.github/`), so no CI step was added; `bun run test` is documented as the canonical command and exits non-zero on failure (CI-ready).

## 3. Reproducibility notes

- Test environment: Bun 1.3.14, Linux sandbox, ffmpeg 7.1.5 on PATH, Node v24.21.0.
- Tests rely on: tsconfig path alias `@/*`, real ffmpeg for REG-1b/REG-5 (audio QC), real timers with ms-scale budgets (REG-6).
- Determinism: three consecutive full-suite runs produced identical pass/fail sets (36/1).
