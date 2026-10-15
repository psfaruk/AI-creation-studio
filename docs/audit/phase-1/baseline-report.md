# Phase-1 — Baseline Report (Task 1)

All items below were captured **before any modification** (read-only inspection, 2026-10-15).

## 1. Repository state

| Item | Value |
|---|---|
| Branch | `main` (up to date with `origin/main` at start) |
| HEAD | `4b628fa5e38971e87268fcb3074625c72104fe63` |
| Working tree | **Clean** — 0 modified, 0 staged, 0 untracked |
| Pre-existing user changes to preserve | **None** (tree clean; nothing to preserve) |
| Remote | `github.com/psfaruk/AI-creation-studio.git` |

## 2. Phase-0 baseline comparison (per instruction, verified rather than assumed)

- Phase-0 audit HEAD was `f5fe336` ("worklog: deep-audit fix round (tasks 14/15/16)").
- The actual current HEAD is **`4b628fa`** — one commit after Phase 0 (commit `4b628fa` "6233b4db-…": the Phase-0 audit-document commit — 8 docs under `docs/audit/phase-0/` + worklog (+97) + 3 mode-only permission changes (644→755), pushed after the Phase-0 window). The Phase-0 documents' claims about file paths and behavior were **re-verified against current source, not assumed** — every bug-register item that Phase 1 tests touches was re-checked by reading the current code:
  - P0-BUG-01 — still present at `src/lib/agent/audio/language_controller.ts` (un-caught per-voice call + `Math.min(2, …)` loop cap). **Re-confirmed and now machine-verified** by regression test REG-1a/REG-1b.
  - P0-BUG-03 (server side / client memory-only state) — still present (`use-agent-run.ts` keeps state in Zustand memory; `/api/chat` creates runs unconditionally). **Re-confirmed** by REG-2/REG-3.
- Dev-database state differs from Phase-0's described window only in ways consistent with the same data (3 runs, 1 production, 8 artifacts, 3 toolCalls — matches the Phase-0 media-baseline inventory).

## 3. Environment & toolchain

| Component | Version / status |
|---|---|
| Bun | 1.3.14 (package manager + test runner) |
| Node | v24.21.0 |
| ffmpeg / ffprobe | 7.1.5-0+deb13u1 (present on PATH) |
| Dev server | Running on port 3000 (verified via `dev.log` tail + `/api/tools` → 401 auth-gated, as designed) |
| Database | SQLite via Prisma; **push-based** (no migrations dir) |
| Lockfile | `bun.lock` present and consistent |

## 4. Commands available at start (package.json)

| Command | Purpose |
|---|---|
| `bun run dev` | Next dev server on :3000 (already running; not restarted) |
| `bun run lint` | ESLint 9 + eslint-config-next |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run db:push` / `db:generate` / `db:migrate` / `db:reset` | Prisma (destructive ones NOT used in Phase 1) |
| `bun run build` | **Disallowed in this sandbox** — never run, reported as Not Run |
| — | **No test command existed at start** (Phase-1 deliverable; now `bun run test`) |

## 5. Existing infrastructure inspected

- **Logging/events:** in-process event bus (`src/lib/agent/events.ts`, replay buffer 100, grace 60 s), `logStep()` per tool call, SSE routes with DB replay + dedupe, `ChatCallMeta` (cache/provider/model/latency per LLM call), `AgentRun` timing columns (`firstTokenMs`, `durationMs`, `errorCategory`, `endReason`, `cacheStatus`, `usedModel`), `ProductionStep.startedAt/finishedAt`, `technicalReport` in production results, rate-limit coordinator status API. Detailed matrix: [observability.md](observability.md).
- **Agent tool registry & orchestrator:** `src/lib/agent/registry.ts` + `tools/{image,audio,video,production}.ts` → **41 executable tools**, registry↔catalog parity OK (runtime-verified via `toolParityReport`). Orchestrator: 12-step max loop, per-tool `withTimeout`, stale-run sweep at 10 min.
- **Test setup at start:** none (no test framework, no tests) — confirmed by `package.json` + repo search.
- **Phase-0 audit docs:** all 8 files present under `docs/audit/phase-0/` — preserved untouched; Phase-1 docs are new files in a sibling folder.

## 6. Environment limitations (honest)

1. `next build` cannot run (sandbox constraint) — build health remains **Not Run**.
2. Live provider calls (image/audio/video generation) not authorized in this window — provider latency relies on historical DB/recorded evidence only.
3. The app's owner-security gate is **active** (401 on API without a session token); the passcode is not available to this agent, so a live owner-session chat run could not be driven to capture a `[run-metrics]` line end-to-end. The metrics path is covered by unit tests + direct invocation instead.
4. Windows platform claims remain Hypothesis-only (unchanged from Phase 0).

## 7. Discrepancies vs Phase-0 documents

| Phase-0 said | Current reality | Impact |
|---|---|---|
| Audit window HEAD `f5fe336` | HEAD `4b628fa` (one later commit: Phase-0 audit docs + worklog + 3 mode-only permission changes) | None on source claims; re-verified anyway |
| "42 tools" (user briefing expectation) | **41 executable tools** (8 core + 11 image + 10 audio + 10 video + 2 production), catalog 41, parity OK | Documented in [tool-inventory.md](tool-inventory.md); no tool was removed in Phase 1 |
| Bug-register items unverified by tests | REG-1a/1b/2/3 now machine-verify three of them | Upgrade: source-reasoned → Confirmed-by-test |
