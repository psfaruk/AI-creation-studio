# Phase 0 — Environment Baseline (Work Package A)

Recorded during the Phase 0 audit window. Secret values are never included — only names and shapes.

## 1. Repository state

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD commit | `f5fe33610a30bf3e3f4c35a24119e23eb6109057` (`f5fe336`) |
| Working tree | **Dirty — 3 files, mode-only changes** (`100644 → 100755`): `scripts/prepare-standalone.mjs`, `src/components/auth/security-gate.tsx`, `src/components/studio-home.tsx`. Zero content diffs (`git diff --stat` = 0 insertions, 0 deletions). Preserved untouched per safety constraints. |
| Last 5 commits | `f5fe336` worklog: deep-audit fix round (tasks 14/15/16) · `acf147b` deep-audit fix round (event-bus replay, tool lifecycle, SSE reconnect, music intent split, WAV+MP3, loop guards, firstToken, spec resolution, cross-platform scripts) · `568c0a4` chat-403 fix + provider Base URL override + minimal /api/v1 · `c0384d2` GLM-only catalog + app-key system removal · `1c5de44` audit-fix round push |
| Untracked | none relevant (docs/audit/phase-0/ created by this audit) |

## 2. Runtime and tool versions (captured live)

| Tool | Version |
|---|---|
| Node.js | v24.21.0 |
| Bun | 1.3.14 (package manager + lockfile: `bun.lock`) |
| TypeScript | 5.9.3 (`tsc --version`) |
| FFmpeg | 7.1.5-0+deb13u1 |
| ffprobe | 7.1.5-0+deb13u1 |
| Prisma CLI | 6.19.2 (`@prisma/client` package pinned `^6.11.1`) |
| Dev server | Next.js dev on port 3000 (`next dev -p 3000`), log at `dev.log` |

## 3. Environment-variable names (values not recorded)

- `DATABASE_URL` — only name listed in `.env.example`; SQLite file at `db/custom.db` (present).
- `STUDIO_OWNER_PASSCODE` — referenced from source (`src/lib/security.ts` path); **not listed in `.env.example`** (documentation gap, see bug-register P0-BUG-16).
- `NODE_ENV` — standard.
- No other `process.env.*` names exist in `src/` or `scripts/` (verified by grep).

Non-env persisted configuration (server filesystem, git-ignored):
- `storage/provider-keys.json` — per-provider API keys **and Base URL overrides** (shape `{key, baseURL?}`).
- `storage/platform-key.json` — app's own OpenAI-compatible key (`amai_sk_…`), mode 0600.
- `storage/security.json` — owner session/token state.
- `storage/llm-chat/` — LLM response disk cache (12 h TTL).
- `storage/artifacts/` — generated/uploaded media; `storage/productions/<id>/` — per-production working dirs (deleted after each run).

## 4. Database

- Engine: SQLite (`provider = "sqlite"`), file `db/custom.db`.
- **No `prisma/migrations/` directory** — the project uses `prisma db push` (`db:push` script). Schema changes are push-based; `db:push:force` (`--accept-data-loss`) exists as a separate script and was **not** run during this audit.
- Schema: 9 models — `Conversation`, `Message`, `AgentRun` (incl. `firstTokenMs`, `errorCategory`, `endReason`, `cacheStatus`, `requestedMode`), `AgentStep`, `ToolCall`, `Artifact`, `Production` (status lifecycle incl. `queued`/`cancelling`/`partial`), `ProductionStep`, `Character`, `ModelEntry`. Full model inventory in repository-inventory.md.
- Read-only inspection during this window found: 2 conversations, 6 messages, 3 completed agent runs (`final_answer`), 1 production (`short_film`, status `partial`, progress 100), 8 artifact rows.

## 5. Static checks actually run (exit codes captured)

| Command | Result |
|---|---|
| `bunx prisma validate --schema prisma/schema.prisma` | **Exit 0** — "The schema at prisma/schema.prisma is valid" |
| `bunx tsc --noEmit` | **Exit 0** — no diagnostics |
| `bun run lint` (`eslint .`) | **Exit 0** — no warnings/errors |
| `ffmpeg -version` / `ffprobe -version` | 7.1.5 present on PATH |
| `bun run build` | **Not run** — production build is disallowed in this environment (dev-only sandbox); build health therefore **Not Tested** in Phase 0 |
| Test suite | **Not available** — repository defines no test script and no test framework (no vitest/jest/playwright in `package.json`) |

## 6. Dev-server health (observed, not modified)

`dev.log` tail at audit time: all requests `200`, no compile errors, one expected long-lived SSE render (`/api/productions/.../events` 28.7 s = live stream held open), and the recorded completion line `[production] z3ymb7 finished: partial` matching the DB row inspected in this audit.

## 7. Platform-specific / Windows 10 compatibility risks (Hypothesis — Linux sandbox observed, Windows not tested)

1. **FFmpeg/ffprobe required on PATH** — not npm-provided (`spawn`/`execFile` of `ffmpeg`, `ffprobe` in `src/lib/media/ffmpeg.ts`). On Windows the user must install binaries; no bundled fallback exists. Media pipelines hard-fail without them.
2. **`process.cwd()`-based storage layout** (`storage/…`) — fine on Windows, but deployment docs must state it; the standalone build script (`scripts/prepare-standalone.mjs`) exists to copy assets.
3. **Edge TTS network dependency + clock skew** — Edge 403 handling includes clock-skew learning (`edge_tts.ts` learnClockSkewFromError); a Windows machine with wrong clock will hit 403 storms (see P0-BUG-01 for the observed fallout on Linux too).
4. **Mode-only git changes** (`100755`) — cosmetic on Windows (no exec bit); harmless.
5. **Caddy gateway (`Caddyfile`)** — Linux-side reverse proxy; the single exposed port + `XTransformPort` convention is sandbox-specific and must not be assumed on a Windows dev box.
6. Package scripts themselves are cross-platform (no shell-only syntax); the prior "portable scripts" commit (`acf147b`) already removed `--accept-data-loss` from the default push path.
