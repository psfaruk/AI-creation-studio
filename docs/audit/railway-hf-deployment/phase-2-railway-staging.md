# Phase 2 — Railway Staging Deployment: Setup Guide & Configuration

**Status:** PREPARED, NOT DEPLOYED — every deploy/purchase step below is owner-gated. Nothing has been purchased, provisioned, deployed, or paid for while preparing this document.
**Companions:** `phase-1-remaining-railway-steps.md` (original checklist) · `phase-1-database-migration-plan.md` (PG plan — now implemented) · `phase-1-ffmpeg-runtime-requirements.md` (image spec — now implemented) · `phase-2-report.md` (what was built + evidence)
**Repo state when prepared:** `main` @ `02071ea` (origin/main, CI green) + Phase-2 changes as local commits (not pushed — push awaits owner approval).

> মালিকের জন্য ধাপে-ধাপে নির্দেশিকা। প্রতিটি খরচ-জড়িত ধাপ **গেটেড** — অনুমোদন ছাড়া কিছুই চালু হবে না। কোনো গোপন মান এই নথিতে নেই।

---

## 1. What was prepared in the repo (this phase)

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage production image: builder (node:22-slim + bun 1.3.14, PG provider flip, `prisma generate`, `next build` + standalone prep) → runtime (node:22-slim + Debian ffmpeg + `fonts-noto-core` incl. **Noto Sans Bengali** + ca-certificates). Runs as root — see §9 for why + hardening options. |
| `.dockerignore` | Keeps secrets (`.env*`, `.z-ai-config*`), runtime data (`storage/`, `db/`), VCS, docs/evidence, and junk out of the image. |
| `railway.json` | Service config-as-code: DOCKERFILE builder, `preDeployCommand: prisma migrate deploy`, `healthcheckPath: /api/health`, `healthcheckTimeout: 300`, restart ON_FAILURE ×10. (Fields verified against the official `railway.app/railway.schema.json`, fetched 2026-10-18.) |
| `prisma/migrations/0_init/migration.sql` + `migration_lock.toml` | PostgreSQL **baseline** (10 tables, 13 indexes, FKs) generated offline via `prisma migrate diff --from-empty --to-schema-datamodel <PG-flipped schema> --script` (exit 0). Local dev is **unaffected** — repo schema stays SQLite + `db:push`; this directory is only consumed by `prisma migrate deploy` on Railway. |
| `src/app/api/health/route.ts` + `src/lib/health.ts` | Unauthenticated health endpoint: DB ping (3 s timeout, 503 on failure), storage writability probe, ffmpeg presence (60 s-cached), env validation summary (key **names** only), sandbox-SDK detection (shape-only). URL-credentials in error strings are masked (`postgres://u:SECRET@h` → `postgres://***@h`) at two layers. |
| `src/instrumentation.ts` (extended) | Startup checks: env warnings (Phase 1) + new storage-writability probe logged at every server boot. |
| `tests/regression/t30-health-endpoint.test.ts` | 14 mock-free tests (injection-based) covering ok/error/degraded classification, db timeout, secret-masking, cwd-rooted storage contract. Suite: 306 → **320 tests**. |
| `.env.example` | Documents the production `postgresql://…?sslmode=require` DATABASE_URL format (comment only). |

**Nothing existing was overwritten or discarded** — all changes are additive; the 306 prior tests still pass unmodified (see `phase-2-report.md`).

---

## 2. Owner pre-requisites (do these first — blocking)

1. **Rotate the two exposed tokens** (security incidents S-1/S-2 from Phase 0/1):
   - HF token `hf_QueX…` pasted in chat → revoke at huggingface.co/settings/tokens.
   - GitHub PAT `ghp_…` pasted in chat → revoke at github.com/settings/tokens (a fresh one is only needed if you want the agent to push; providing it via a credential helper or env var — never chat — is the safe path).
2. **Railway account + plan.** Staging needs the **Hobby plan ($5/month, includes $5 of usage)** — the free/Trial plan has no volumes and won't fit this app. **This is a purchase: only do it when you approve the spend.**
3. **Decide the data question** (§5.2): fresh empty PostgreSQL (recommended) vs. carrying sandbox data over (optional script, Phase 2b).
4. **Confirm no auto-deploy surprises:** Railway only deploys what you connect. This repo currently has **no Railway app linked** — pushing Phase-2 commits to GitHub triggers **only GitHub Actions CI** (`.github/workflows/ci.yml`), never a deployment, until you create and connect a Railway service yourself.

---

## 3. Exact Railway setup steps (owner, in the Railway dashboard)

**All steps below happen after you approve. Nothing here is executed by the agent.**

### 3.1 Create the project + service
1. New Project → **Deploy from GitHub repo** → select `psfaruk/AI-creation-studio`, branch `main`.
   (Alternatively: create an empty service, then Settings → Source → connect the repo.)
2. Railway detects the `Dockerfile` (also forced by `railway.json` → `builder: DOCKERFILE`). The **first deploy will fail or restart-loop until the variables below are set** — that's expected; set variables **before** the first build finishes if possible (Variables tab is available immediately after service creation).

### 3.2 Add PostgreSQL
3. In the project: **+ New → Database → PostgreSQL**. Leave the defaults (a private DB on the Hobby plan; usage-billed, a few $/month at personal scale).
4. Open the Postgres service → **Variables** tab → copy the `DATABASE_URL`-style connection string (`postgres://…`).
   - In the **app service's** Variables, create `DATABASE_URL` with the value **normalized to**:
     ```
     postgresql://<user>:<password>@<host>:5432/<db>?sslmode=require
     ```
     i.e. change the leading `postgres://` → `postgresql://` and append `?sslmode=require` (Prisma requires the `postgresql` scheme; Railway's plugin exposes `postgres`). Use the **public** URL if you want the DB reachable from outside Railway's network too; the private one otherwise.

### 3.3 Set the app service variables (secrets)

| Variable | Required? | Value |
|---|---|---|
| `DATABASE_URL` | **Required** | normalized `postgresql://…?sslmode=require` (§3.2) |
| `STUDIO_OWNER_PASSCODE` | **Required on a public URL** | your owner passcode, **≥ 8 characters** (pre-seeds the security gate so no stranger can claim ownership on first visit) |
| `STUDIO_SESSION_SECRET` | **Recommended** | 64-hex random — generate with `openssl rand -hex 32`. Keeps logins alive across redeploys |
| `HF_TOKEN` | *Not yet* | Phase 3 only — leave unset; no code reads it today |
| `ZAI_API_KEY` / `GLM_API_KEY` | Optional | external GLM chat provider keys (see §7) |

Generate secrets on your machine (`openssl rand -hex 32` / a password manager) and paste them into the Railway **Variables** tab — never into files, chats, or the repo.

### 3.4 Add the storage volume
5. App service → **Settings → Volumes** → **New Volume**:
   - **Mount path: `/app/storage`** (must be exactly this — every runtime path roots at `process.cwd()/storage` = `/app/storage` in the image)
   - Size: default (Hobby cap 5 GB — caches + a personal artifact library fit; one 30-s music video ≈ 22 MB)
   - The image already creates the directory; the mount replaces it.
   ⚠️ **Volume permission note:** Railway volumes are root-owned; the image intentionally runs as root for this reason (docs.railway.app/reference/volumes: non-root images hit permission issues; `RAILWAY_RUN_UID=0` is their workaround). See §9 before considering non-root hardening.

### 3.5 First deploy + what happens automatically
6. Trigger a deploy (manual "Deploy" or push to `main` once Phase-2 commits are approved+pushed). Sequence per build:
   - Docker build (~3–6 min): `bun install` → PG-flip → `prisma generate` → `next build` → standalone packaging → runtime image with ffmpeg+fonts.
   - **preDeployCommand** `prisma migrate deploy` applies `0_init` to your PostgreSQL (additive-only; advisory-locked, idempotent — safe on every redeploy).
   - Container starts → Next standalone server on Railway's `PORT`.
   - Railway polls **`GET /api/health`** (up to 300 s) → healthy when it returns 200.
7. Generate a public domain: Settings → Networking → **Generate Domain** → this is your staging URL.

### 3.6 Post-deploy smoke checklist (all must pass before Phase 3)
- [ ] `GET /` → 200, Bengali studio UI renders, SecurityGate unlock with `STUDIO_OWNER_PASSCODE` works.
- [ ] `GET /api/health` → 200 with `"status":"ok"` (or `"degraded"` — read `checks`):
  - `checks.database.ok: true` (PG reachable)
  - `checks.storage.ok: true` (volume writable — survives redeploy, verify with a file)
  - `checks.ffmpeg.ok: true` + `version` (Debian 7.x expected)
  - `checks.env.missingRequired: []`
  - `checks.providers.zaiSdk: "not-configured"` (**expected on Railway** — see §7)
- [ ] `GET /api/hardware` (after unlock) → `ffmpegVersion`/`ffprobeVersion` non-null.
- [ ] One real production end-to-end (chat → plan → confirm → SSE progress → artifact download) — Phase 5 flow, recommended before calling staging "good".
- [ ] Container smoke (Railway shell or a failing healthcheck debug session):
  `ffmpeg -version` starts with `ffmpeg version 7.x` · `ffmpeg -encoders | grep -E 'libx264|aac|libmp3lame'` → 3 lines · `ffmpeg -hide_banner -filters | grep -E 'vidstab|subtitles|loudnorm'` → present · `fc-list :lang=bn` → Noto Sans Bengali listed.

---

## 4. Environment variables — complete reference (no values exposed)

| Key | Level | Format / notes |
|---|---|---|
| `DATABASE_URL` | required | `file:./db/custom.db` locally; `postgresql://user:pass@host:5432/db?sslmode=require` on Railway. Only Prisma reads it — zero app-code references (grep-verified in Phase 1). |
| `STUDIO_OWNER_PASSCODE` | required in production | 8–200 chars. Pre-seeds owner passcode; without it, the first visitor can claim ownership (B-D5). |
| `STUDIO_SESSION_SECRET` | recommended (production) | ≥ 32 chars, 64-hex recommended (`openssl rand -hex 32`). Survives redeploys; rotating it logs everyone out (fine — single owner). |
| `PORT` / `HOSTNAME` | set by Railway / image | standalone `server.js` reads `PORT` (Railway injects); image sets `HOSTNAME=0.0.0.0`. |
| `ZAI_API_KEY` | optional | external GLM chat provider (`{id}.{secret}`), server-side only. |
| `GLM_API_KEY` | optional | external GLM chat provider (open.bigmodel.cn free tier), server-side only. |
| `TTS_CACHE_DIR`, `VOICE_VERIFICATION_FILE` | optional | test-isolation overrides — do **not** set on Railway. |
| `HF_TOKEN` | reserved (Phase 3) | no code reads it yet; enter only as a Railway secret when Phase 3 is approved. |

---

## 5. Database & storage status

### 5.1 PostgreSQL (plan implemented, not yet applied anywhere)
- **Dual-mode:** repo schema stays `provider = "sqlite"` (local dev + tests untouched); the Docker builder flips it to `postgresql` at image-build time (one `sed`, documented in the Dockerfile) → generated client + `migrate deploy` are PG-native.
- **Baseline `0_init`**: 10 CREATE TABLE + 13 indexes + FKs, additive-only, generated offline (no DB was touched). Applied automatically by `preDeployCommand` before each deploy; idempotent + advisory-locked.
- **Never destructive:** no `db push --accept-data-loss` against PG anywhere; future schema changes = new checked-in migrations. Rollback = redeploy previous build (additive migrations are backward-compatible).
- **Not yet verified against a live PostgreSQL** — the first `migrate deploy` on your Railway project is the verification moment (expected: `1 migration found in prisma/migrations — Applying migration 0_init … success`).

### 5.2 Existing SQLite data (decision point)
- Sandbox DB is tiny (~152 KB, personal-studio history). **Recommended: fresh start on Railway** (empty PG; baseline only).
- If you want history carried over: a one-shot two-client script is the plan (`phase-1-database-migration-plan.md` §4 — dependency-ordered export → `createMany` with preserved ids → count verification). It would be written and run only on your explicit approval (owner-gated Phase 2b item).

### 5.3 Generated files, caches, artifacts (nothing silently lost)
- Everything the app writes lives under `process.cwd()/storage` = **`/app/storage`** = the volume: `artifacts/`, `tts-cache/`, `llm-chat/`, `shot-cache/`, `productions/`, `security.json`, `provider-keys.json`, `voice-verification.json`. The volume persists across redeploys and restarts.
- **Known ephemeral caveat (unchanged, honest):** SQLite `db/` would not survive without a volume — one more reason PostgreSQL is the production path. With PG, the database is fully durable.
- **Future:** object storage (Cloudflare R2, ~$0.015/GB-mo + free egress) behind the existing `storage.ts` interface for artifacts only, caches stay on the volume — Phase 2b+ decision, not needed for staging.

---

## 6. Build & runtime behavior on Railway

- **Build:** ~3–6 min (bun install ~1 min, next build ~25 s + image packaging). Needs network for `next/font/google` (Geist) — same dependency CI already proves on GitHub runners.
- **RAM:** Next standalone + in-process production runner (concurrency 2) + ffmpeg transcodes — fits comfortably in Railway's default 8 GB / shared vCPU.
- **Restart behavior:** `restartPolicyType: ON_FAILURE`, max 10 retries; SIGTERM graceful shutdown (Phase 1) marks in-flight jobs honestly failed; boot sweep re-queues queued-never-started jobs on the next start.
- **Single-instance constraints (unchanged, documented):** SSE event bus is in-memory (refresh-reconnect replays from a 200-event buffer, same instance); jobs do not survive a redeploy mid-run (marked failed + re-runnable — honest). Phase 2b worker-split is the future fix, not needed for staging.

---

## 7. AI-provider status on Railway — the honest picture

**The z-ai-web-dev-sdk credential is a sandbox-only secret** (B-D1, Phase 0/1). It does not exist on Railway, is gitignored, is excluded by `.dockerignore`, and no code claims otherwise. Expected on the staging URL:

| Capability | On Railway (before Phase 3) |
|---|---|
| Chat / planning (SDK default) | **PROVIDER_UNAVAILABLE** — honest preflight error; pipelines degrade to labeled fallbacks, never fake AI |
| Chat via **external GLM** (your `ZAI_API_KEY`/`GLM_API_KEY` or UI-saved key) | ✅ works — portable, key-based |
| Image generation/edit (SDK) | unavailable (honest) |
| Bengali TTS | **Google-Translate fallback works** (no key needed; retest from Railway egress is a Phase 4 item); Edge-TTS bn retest also Phase 4 |
| Instrumental music | ✅ procedural engine — works everywhere |
| ASR, AI video, image-search, VLM (SDK) | unavailable (honest) |
| Sung vocals / lip-sync | **unsupported** (unchanged — owner budget decision, Phase 4) |

`/api/health` reports `providers.zaiSdk: "not-configured"` to make this visible at all times. **Phase 3 (HF router wiring) is the fix — owner-gated, budget-capped, and explicitly out of scope for this staging deploy.**

---

## 8. Cost transparency (no charges without owner approval)

| Item | Cost |
|---|---|
| Railway Hobby plan | $5/month (includes $5 usage) |
| PostgreSQL (Hobby, usage-based) | a few $/month at personal scale |
| Volume | included in plan (5 GB cap) |
| GitHub Actions | free (public repo) |
| AI providers | $0 until Phase 3/4 probes are separately approved |

---

## 9. Security notes & hardening decisions (documented, deferred or applied)

1. **Image runs as root** — Railway volume-ownership constraint (their docs: non-root images hit permission issues; `RAILWAY_RUN_UID=0` is their escape hatch, which forces root anyway). Hardening path if wanted later: entrypoint `chown` + `setpriv --reuid=node` drop, verified on staging first. Deferred deliberately — first staging deploy favors a working volume over defense-in-depth the platform doesn't natively support.
2. **Health endpoint exposure** — `/api/health` leaks: uptime, DB latency, storage path, ffmpeg version, env **key names** (never values), SDK-configured boolean. Assessed acceptable for staging; can be gated behind a token later.
3. **Secrets** — only Railway variables; `.dockerignore` + `.gitignore` double-block `.env*`/`.z-ai-config*`; URL-credential masking in health errors; log-redaction patterns unchanged from Phase 1 audit.
4. **Migrations** — additive-only, checked in, reviewable (`prisma/migrations/0_init/migration.sql`); no destructive path exists in the deploy pipeline.

## 10. Rollback
- App: Railway → service → Deployments → **Redeploy previous build** (each deployment is retained).
- DB: baseline is the only migration; rollback = redeploy previous build (nothing to undo). Before any *future* migration: `pg_dump` snapshot first (documented in `phase-1-database-migration-plan.md` §8).
- Storage: Railway volume snapshots; nothing in Phase 2 writes destructively.

---

## 11. What this staging deploy does NOT include (next decisions)
1. **Phase 2b (optional):** data-carry script (§5.2), worker split for job-surviving redeploys, R2 object storage.
2. **Phase 3:** HF Inference Providers wiring (chat/image/video/STT only — **HF has no TTS/music/lipsync**, keep the working free paths).
3. **Phase 4:** capability probes from Railway egress (Google-bn TTS, Edge-TTS retest, capped video probe, Whisper-class bn ASR).
4. **Phase 5/6:** E2E validation + security acceptance on the staging URL.

— END OF PHASE 2 SETUP GUIDE —
