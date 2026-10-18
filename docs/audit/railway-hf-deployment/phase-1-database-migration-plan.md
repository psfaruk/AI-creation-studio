# Phase 1 — PostgreSQL & Persistent-Storage Migration PLAN (no implementation yet)

**Task ID:** 1-c · **Status:** PLAN ONLY — no schema change, no migration executed, no deploy
**Builds on:** `docs/audit/railway-hf-deployment/phase-0-audit-report.md` (§2 architecture, §4 env vars, §5 deployment files, §7 B-D2 blocker)
**Related parallel Phase 1 work (paths per main-agent task; verified absent in the repo at doc-writing time — "will exist by end of Phase 1"):** `src/lib/providers/` (adapter layer), `src/lib/agent/production/recovery.ts` (boot recovery + graceful shutdown), `src/instrumentation.ts`, `src/lib/env.ts` (`validateEnv()`), `security.ts` `STUDIO_SESSION_SECRET` support, tests `t27`–`t29`, `.github/workflows/ci.yml`.

> এই নথি কেবল পরিকল্পনা — কোনো স্কিমা/কোড পরিবর্তন এখন হয়নি। সব দাবি নিচের Evidence appendix-এর grep-ফলাফলের ভিত্তিতে।

---

## 1. Current state (code-verified)

| Item | Value | Evidence |
|---|---|---|
| ORM | Prisma `^6.11.1` (`@prisma/client` + `prisma`) | `package.json` |
| Datasource | `provider = "sqlite"`, `url = env("DATABASE_URL")` | `prisma/schema.prisma` §datasource |
| Default URL | `DATABASE_URL="file:./db/custom.db"` (relative, portable) | `.env.example` |
| Models | **10** (not 8): Conversation, Message, AgentRun, AgentStep, ToolCall, Artifact, Production, ProductionStep, Character, ModelEntry | `grep -c '^model ' prisma/schema.prisma` → `10` |
| JSON columns | All structured payloads stored as JSON strings in plain `String` columns (`attachmentsJson`, `payloadJson`, `argsJson`, `resultJson`, `specJson`, `metaJson`, `appearanceJson`, `continuityNotesJson`, `toolsJson`, `capabilitiesJson`, …) → map 1:1 to PostgreSQL `TEXT`. No native JSON/JSONB dependency. | schema read in full |
| Field types | Only `String`, `Int`, `DateTime`, `Boolean`-free — no SQLite-specific column types | schema read in full |
| Workflow | Push-based: `db:push`, `db:push:force`, `db:generate`; `db:migrate`/`db:reset` scripts exist but **no `prisma/migrations/` directory** (verified: `ls prisma/` → only `schema.prisma`) | `package.json` + FS check |
| Client init | `src/lib/db.ts` — plain `new PrismaClient({ log: ['warn','error'] })` with `globalThis` cache outside production. No datasource override, no engine option | file read |
| Data volume | Sandbox DB: `db/custom.db` ≈ 152 KB — personal-studio scale | `du -sh db/` |

⚠️ **Correction to Phase 0:** the Phase 0 report (§1, §3) says "8 models"; the actual count from `prisma/schema.prisma` is **10** (the two Creative-Studio-era models `Character` and `ModelEntry` were missed). No functional impact — all 10 port identically.

---

## 2. SQLite-specific usage audit (all greps run against `src/`)

| Grep (ripgrep) | Result | Meaning |
|---|---|---|
| `\$queryRaw\|\$executeRaw` | **0 matches** | No raw SQL through Prisma anywhere |
| `PRAGMA` (case-insensitive) | **1 match** — `src/lib/agent/audio/edge_tts.ts:311` → `Pragma: 'no-cache'` HTTP header | **Not SQLite** — an HTTP cache-control header in the Edge-TTS client. Zero SQLite pragmas |
| `sqlite_\|better-sqlite\|sqlite3` | **0 matches** | No SQLite library/extension references |
| `provider = "sqlite"` in `src/` | **0 matches** (only `prisma/schema.prisma`) | Provider is declared solely in the schema |
| `SELECT…FROM\|INSERT INTO\|UPDATE…SET\|prisma\.$` (raw SQL shapes) | **0 matches** | Everything goes through the typed Prisma query API |
| `DATABASE_URL` in `src/`, `scripts/`, `tests/` | **0 matches** | URL consumed only by Prisma itself — scheme swap is invisible to app code |
| `updateMany` (guarded conditional writes) | **3 sites** — `orchestrator.ts:1736` (agent-run finalize), `production/runner.ts:795` (stale sweep), `runner.ts:827` (boot interrupt marking) | Provider-agnostic atomic writes (see §5) |
| `$transaction` | **2 sites** — `orchestrator.ts:1552, 1686` — both **batch (array) form**, no interactive callbacks | Portable across SQLite/PG |

**Conclusion:** the codebase has **zero SQLite-specific SQL and zero raw SQL**. The only provider dependency is the one line `provider = "sqlite"` in `prisma/schema.prisma`. A provider switch to `postgresql` requires no application-code changes (to be verified by the full test suite once run against PG in CI — Phase 2).

---

## 3. Migration strategy — dual-mode safety (SQLite for local dev, PG for production)

### 3.1 Environment variables (exact formats)

| Mode | `DATABASE_URL` format | Where set |
|---|---|---|
| Local dev (unchanged) | `file:./db/custom.db` | `.env` (default already in `.env.example`) |
| Production (Railway) | `postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require` | Railway service variable (planned Phase 2) |

Note: Railway's PostgreSQL plugin exposes its URL with a `postgres://` scheme; Prisma requires `postgresql://` — the normalizing step must be documented/done when the variable is set (plan: rewrite scheme when copying the value into the service variable, or in a future `validateEnv()` check — see parallel Phase 1 `src/lib/env.ts`).

### 3.2 The one real constraint (documented honestly)

Prisma binds **one provider per schema**, and the generated client (query engine) is provider-specific. "Scheme detection at runtime" is therefore **not** achievable with a single pre-built client. The workable dual-mode plan (to be implemented only in Phase 2, with owner approval):

1. **Schema selection at generate/build time, not runtime:**
   - Local dev: schema keeps `provider = "sqlite"` → `bun run db:generate` emits the SQLite client.
   - Production image: the Docker build flips the provider (e.g. a build step swapping `provider = "sqlite"` → `"postgresql"`, or a checked-in `prisma/schema.postgres.prisma` used via `--schema`) **before** `prisma generate`, so the production client is built for PG. Same source models, two generated engines.
2. **Initial migration baseline (no live PG needed):**
   - `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql` (run with the PG-variant schema) + `prisma/migrations/migration_lock.toml` with `provider = "postgresql"`.
   - Alternative: `prisma migrate dev --name init` against a scratch PG (local Docker or CI service container) to produce the same baseline.
   - Result: a `migrations/` directory the repo currently lacks; deploy with `prisma migrate deploy` (additive-only, see §7).
3. **Engine/`prisma generate` note:** run `prisma generate` inside the production image build *after* the provider flip; on Debian-based `node:22-slim` the default binary target matches (verify in the image build — "to be verified").
4. **CI validation (Phase 2 option, not now):** add a `services: postgres` container to `.github/workflows/ci.yml` (file itself is parallel Phase 1 work) that runs `prisma migrate deploy` + `bun test` against PG, so the PG path is exercised on every PR — the honest substitute for "verified in production".

### 3.3 What does NOT change

- All 10 models and every `String`-JSON column port as-is (Prisma maps `String` → `TEXT`).
- `db:push` stays available for local SQLite dev; production uses `migrate deploy` only.
- No application code reads `DATABASE_URL` (grep evidence §2), so nothing else moves.

---

## 4. Data migration path (SQLite → PostgreSQL), if the owner wants sandbox history carried over

**Recommended approach: a one-shot Node/Bun script using two Prisma clients** (why: volume is tiny (~152 KB), both schemas are identical, and the Prisma API handles type conversion — no SQL dialect to translate).

Planned steps (script to be written in Phase 2, only on owner request):
1. Export: open the SQLite client (schema as-is, `DATABASE_URL=file:…`) and read tables in dependency order: Conversation → Message, AgentRun → AgentStep/ToolCall/Artifact, Production → ProductionStep, Character, ModelEntry.
2. Import: open the PG client (PG-variant schema, `DATABASE_URL=postgresql://…`) and `createMany` per model, preserving `id`/`createdAt` values.
3. Referential note: relations use explicit FK columns; inserting parents before children preserves them. Cascades stay declarative.
4. Verify: compare `count()` per model on both sides; run the app's `/api/productions` and gallery pages against PG.
5. Alternatives rejected: `sqlite3 .dump` (SQL-dialect output → needs rewriting for PG; more error-prone than the typed client path) and manual CSV (no benefit at this volume).

If the owner prefers a **fresh start on Railway** (empty PG), this section can be skipped entirely — the baseline migration in §3.2 alone is enough.

---

## 5. Concurrency considerations (worker-split future)

- PG unlocks the Phase 0 §3 "worker split": a second Railway service executing the production runner while the web service serves UI/API — both sharing one database. SQLite (single-writer file) cannot serve that.
- **Why the existing guards are PG-safe:** the three `updateMany` sites (`runner.ts:795, 827`, `orchestrator.ts:1736`) are single-statement conditional updates — the `WHERE` clause (status + time window / id-set) is evaluated atomically by the database. On PG this is a single `UPDATE … WHERE …` statement, safe under concurrent writers; `res.count` tells the caller whether it won the race. No change needed.
- **Known unguarded transition (documented, not a bug today):** `src/app/api/productions/[id]/confirm/route.ts:82` uses a plain `update` to `awaiting_confirmation → queued` (no status precondition). Single-owner + single-process today ⇒ fine. If a worker service is added (Phase 2b), this and the `queued → running` claim should become guarded `updateMany`-style transitions or an interactive `prisma.$transaction(async …)` (e.g. `ReadCommitted` claim: update where status='queued', re-read to confirm ownership) so two processes can never double-start or double-confirm a production. The parallel Phase 1 `recovery.ts` re-queue logic must use the same guarded pattern when it lands.
- SSE progress delivery is still an **in-memory bus** (Phase 0 §1) — single-instance only. A worker split requires the DB-backed SSE fallback noted in `phase-1-remaining-railway-steps.md` §3.

---

## 6. Media / artifact storage (separate from the DB — different lifecycle, different plan)

### 6.1 Current layout (all under `<projectRoot>/storage/`, runtime-created, fully gitignored via `/storage/`; the directory is **absent in a fresh clone** — code `mkdir`s on demand)

| Path | Written by | Purpose |
|---|---|---|
| `storage/artifacts/` | `src/lib/agent/storage.ts` (`saveArtifactFile` / `readArtifactFile` / `artifactsDir`) | All generated + uploaded media; **H-8 path-containment contract is enforced and regression-tested** (paths escaping the dir are rejected) |
| `storage/tts-cache/<2>/<2>/<hash>.<ext>` | `src/lib/agent/tts-cache.ts:32` (env override `TTS_CACHE_DIR`) | TTS audio cache |
| `storage/llm-chat/` | `src/lib/agent/llm.ts:76` | 12-h LLM disk cache |
| `storage/shot-cache/` | `src/lib/agent/video/shot_cache.ts:97` | Cross-run AI-shot cache |
| `storage/productions/<id>/` | `src/lib/media/ffmpeg.ts` `makeWorkingDir()` | Per-production intermediates (cleaned up) |
| `storage/security.json` | `src/lib/security.ts:38` | Owner passcode hash + **session secret** (ephemeral-disk problem, Phase 0 B-D2) |
| `storage/provider-keys.json` | `src/lib/agent/provider-keys.ts:21` | UI-saved external provider keys (file → env precedence) |
| `storage/voice-verification.json` | `src/lib/agent/audio/edge_tts.ts:524` (env override `VOICE_VERIFICATION_FILE`) | Per-voice TTS verification records |

### 6.2 Plan (Phase 2+, approval-gated)

1. **Interim:** Railway Volume mounted at `/app/storage` (Hobby plan cap **5 GB** — fine for caches + a personal artifact library; one 30-s music video ≈ 22 MB per Phase 0 §8). App code needs **no change** — every path above roots at `process.cwd()/storage`.
2. **Target:** S3-compatible object storage — **Cloudflare R2 recommended** (Phase 0 §2: ~$0.015/GB-mo, free egress) — behind a `STORAGE_DRIVER=local|s3` abstraction implemented *inside the existing `storage.ts` interface* (`saveArtifactFile` / `readArtifactFile`). Because every consumer already goes through that one module (path-containment contract included), the driver swap is contained; caches (`tts-cache`, `llm-chat`, `shot-cache`) can stay on the volume while only artifacts move to R2.
3. **What should move to env/DB instead of disk:** nothing mandatory in Phase 1. Two items are tracked: `provider-keys.json` (eventually env or DB-backed settings) and the **session secret** — Phase 1 parallel work already adds `STUDIO_SESSION_SECRET` env support to `security.ts`, removing the secret's dependency on ephemeral disk. The passcode-hash file can follow later.

---

## 7. Approval gates (blocking, per master-prompt rule)

1. **No destructive migration without explicit owner approval.** Additive-only by default (`prisma migrate deploy` of new migrations; never `db push --accept-data-loss` against PG).
2. **PG provisioning is Phase 2**, on the owner's Railway account (Hobby + usage-based PG, ~$5–10/mo estimate per Phase 0 §8). Nothing in Phase 1 provisions or pays for anything.
3. Volume/S3 choice and worker-split timing are owner decisions (Phase 0 §11).

## 8. Rollback plan

- **Before any migration:** snapshot/backup — Railway volume snapshot if the volume exists; `pg_dump` after PG provisioning; copy `db/custom.db` for the SQLite side.
- **Migrations are additive-only:** rolling back the app = redeploy previous build; old code ignores newer tables/columns it doesn't know.
- **DATABASE_URL rollback:** point the service variable back to the previous value (e.g. volume-backed SQLite interim) and redeploy — no data transformation is destructive in the additive plan.
- **Data-migration script (§4):** keep it idempotent (skip rows whose `id` already exists) so a re-run after partial failure is safe.

---

## Appendix — Evidence (commands + counts, run at doc-writing time)

```
grep -c '^model ' prisma/schema.prisma           → 10
ls prisma/                                        → schema.prisma   (no migrations/)
ls prisma/migrations                              → No such file or directory
rg '\$queryRaw|\$executeRaw'  src/                → 0 matches
rg -i 'PRAGMA|sqlite_|better-sqlite|sqlite3' src/ → 1 match (edge_tts.ts:311, HTTP header Pragma: no-cache — not SQLite)
rg 'provider = "sqlite"' src/                     → 0 matches
rg 'SELECT…FROM|INSERT INTO|UPDATE…SET' src/      → 0 matches (raw-SQL shapes)
rg 'DATABASE_URL' src/ scripts/ tests/            → 0 matches
rg -n 'updateMany' src/                           → 3 (orchestrator.ts:1736; runner.ts:795,827)
rg -n '\$transaction' src/                        → 2 (orchestrator.ts:1552,1686 — batch form)
du -sh db/                                        → 152K (sandbox SQLite)
```
Files read in full: `prisma/schema.prisma`, `src/lib/db.ts`, `src/lib/agent/storage.ts`, `src/lib/security.ts` (§1–120), `src/lib/agent/provider-keys.ts` (§1–50), `src/lib/agent/production/runner.ts` (§770–844), `src/app/api/productions/[id]/confirm/route.ts` (§65–102).

— END OF PHASE 1 DATABASE MIGRATION PLAN —
