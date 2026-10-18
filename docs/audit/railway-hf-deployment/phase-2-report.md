# PHASE 2 — Railway Staging Preparation Report
## Scope: production Dockerfile · railway.json + health endpoint · PG baseline migration · setup guide — NO deploy, NO purchase, NO push, NO production settings touched

**Task ID:** P2-PREP · **Date:** 2026-10-18 · **Branch:** `main` @ `95c0640` (**local only — push awaits owner approval**; `origin/main` remains `02071ea`, CI green)

---

## 1. Files Changed (commit `95c0640`, 11 paths, +1122 lines — all additive)

| File | New/Mod | Purpose |
|---|---|---|
| `Dockerfile` | new | Multi-stage image: **builder** `node:22-slim` + bun 1.3.14 (CI-pinned) → `bun install --frozen-lockfile` → PG provider flip (documented dual-mode sed) → `prisma generate` → `next build` + `prepare-standalone`; **runtime** `node:22-slim` + Debian `ffmpeg` + `fonts-noto-core` + `ca-certificates`, standalone server, Prisma CLI+schema+migrations for `migrate deploy`, `/app/storage` + `/app/db` mount dirs, `prisma` global wrapper (no npx/network at deploy), `CMD node server.js` |
| `.dockerignore` | new | Secrets (`.env*`, `.z-ai-config*`), runtime data (`storage/`, `db/`, `upload/`), VCS, `docs/` (≈23 MB evidence), junk — excluded from image context |
| `railway.json` | new | `builder: DOCKERFILE` · `preDeployCommand: prisma migrate deploy` · `healthcheckPath: /api/health` · `healthcheckTimeout: 300` · `restartPolicyType: ON_FAILURE` ×10 — every field verified against the official `railway.app/railway.schema.json` (fetched live, 200 OK) |
| `prisma/migrations/0_init/migration.sql` | new | PostgreSQL baseline: 10 tables, 13 indexes, FK cascades — generated **offline** via `prisma migrate diff --from-empty --to-schema-datamodel <PG-flipped copy> --script` (exit 0, 258 lines + provenance header) |
| `prisma/migrations/migration_lock.toml` | new | `provider = "postgresql"` |
| `src/app/api/health/route.ts` | new | Unauthenticated health endpoint (thin wrapper, wires real deps) |
| `src/lib/health.ts` | new | Health core: db ping (3 s race-timeout; only 'error' → 503), storage writability probe, ffmpeg presence (60 s globalThis cache), env summary (**key names only**), `zAiConfigured()` shape-only detection; **two-layer URL-credential masking** (`postgres://u:SECRET@h` → `postgres://***@h`); fully dependency-injected (mock-free testable) |
| `src/instrumentation.ts` | mod | Startup checks extended: storage-writability probe logged at every server boot (`[startup] storage writable: …`) alongside Phase-1 env warnings |
| `tests/regression/t30-health-endpoint.test.ts` | new | 14 injection-based **mock-free** tests (ok/error/degraded classification, db timeout, secret masking, env key-names-only, storage-root contract) |
| `.env.example` | mod | Documents production `postgresql://…?sslmode=require` DATABASE_URL format (comment only) |
| `docs/audit/railway-hf-deployment/phase-2-railway-staging.md` | new | Owner setup guide: exact Railway steps, variables table, secrets generation, volume config, smoke checklist, cost, rollback, honest AI-provider status |

No existing behavior overwritten; the 306 pre-existing tests pass unmodified. Dev workflow (SQLite + `db:push`) untouched — the migrations directory is consumed only by `migrate deploy` on Railway.

---

## 2. Commands & Results (all exit codes recorded)

### 2.1 Local gates (dev-project dir, dev server untouched until the intentional restart in §2.4)
| Command | Exit | Result |
|---|---|---|
| `bun run typecheck` | 0 | 0 errors |
| `bun run lint` | 0 | 0 problems |
| `bunx prisma validate` (with new `prisma/migrations/` present) | 0 | "The schema at prisma/schema.prisma is valid" — local dev unaffected by the PG migrations dir |
| `bun run test` | 0 | **320/320 pass, 0 fail** (306 pre-existing + 14 new), 2761 expects, 32 files, 198 s |

### 2.2 Fresh-clone CI-equivalent (`/tmp/acs-p2-check` @ `95c0640`)
| Command | Exit | Result |
|---|---|---|
| `bun install --frozen-lockfile` | 0 | deterministic |
| `bun run db:generate` | 0 | SQLite client (CI parity) |
| `bunx prisma validate` | 0 | valid |
| `bun run typecheck` | 0 | 0 errors |
| `bun run lint` | 0 | 0 problems |
| `bun run test` | 0 | **320/320 pass, 0 fail**, 200.65 s |

### 2.3 Dockerfile builder-sequence simulation + **first PG-flipped production build**
| Command | Exit | Result |
|---|---|---|
| `sed` provider flip (exact Dockerfile line) + `bun run db:generate` | 0 | PostgreSQL client generated |
| `bun run build` (standalone) | 0 | next build + prepare-standalone complete; ~27 routes all dynamic (no build-time DB access) |
| **Standalone boot smoke** (`node server.js`, NODE_ENV=production, PORT=3999, dummy unreachable PG) | — | **Ready in 204 ms**; `/api/auth/status` → 200 `{"initialized":false,"authenticated":false}`; `/api/health` → **503 status:"error"** with `database.ok:false` (honest), `storage.ok:true`, `ffmpeg 7.1.5`, `env.missingRequired:["STUDIO_OWNER_PASSCODE"]`, `providers.zaiSdk:"configured"`; Phase-1 boot-sweep logged a DB error and **survived** (no crash); SIGTERM shutdown clean |
| Standalone content audit | — | `server.js` ✓ · `node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node` **traced into the bundle** ✓ · `.next/static` + `public` ✓ · `sharp` + `@img/sharp-libvips-linux-x64` native binaries ✓ · builder-side `prisma` CLI entry + `@prisma/engines/{libquery_engine,schema-engine}` present for the runtime copy ✓ |

### 2.4 Live verification (dev server, sandbox)
| Check | Result |
|---|---|
| `/api/health` on `:3000` | **200 `"status":"ok"`** — database latency 4 ms (real SQLite), storage writable, ffmpeg 7.1.5, env ok (dev), zaiSdk configured |
| `/api/auth/status` | 200, correct JSON |
| Startup log | `[startup] storage writable: /home/z/my-project/storage` — new check fires in dev too |
| Incident + recovery | My `instrumentation.ts` edit triggered a dev-server reload race (`EADDRINUSE`, one zombie `next-server`); cleaned up, single fresh instance restarted, all checks green after — root-caused, not papered over |
| agent-browser on `/` | Title "অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও" ✓, SecurityGate passcode form renders ✓, **zero console errors** ✓ (screenshot: `/tmp/p2-ui-check.png`) |

### 2.5 External evidence (fetched live, no auth)
| Source | Result |
|---|---|
| `railway.app/railway.schema.json` | 200 — confirmed `preDeployCommand`, `healthcheckPath`, `healthcheckTimeout`, `restartPolicyType` enum (`ON_FAILURE`), `restartPolicyMaxRetries` |
| `docs.railway.app/reference/volumes` | 200 — "**Docker images that run as a non-root UID by default will have permissions issues** when performing operations within an attached volume" → root-run image decision (documented) |
| Debian `fonts-noto-core` .deb (downloaded + `dpkg -c`) | contains `NotoSansBengali-{Regular,Bold}.ttf` + `NotoSerifBengali-*.ttf` — the exact font the subtitle-burn (`force_style FontName=Noto Sans Bengali`) and SVG paths assume |

---

## 3. Build & Health-Check Evidence
- **Production build:** first-ever **PG-flipped** build exit 0 (§2.3) — the exact Dockerfile builder sequence, run end-to-end in a fresh clone. (The sandbox cannot run `docker build` — no Docker daemon — so the image itself will first build on Railway's builder; every step inside the Dockerfile has been individually executed and verified here.)
- **Health check:** exercised in both directions — honest 503 with an unreachable DB, and 200 `ok` against a live DB. Startup checks (env + storage) verified in dev and production-mode boots.

## 4. Required Railway Environment Variables (full table in `phase-2-railway-staging.md` §4)
`DATABASE_URL` (normalized `postgresql://…?sslmode=require`) — **required** · `STUDIO_OWNER_PASSCODE` (≥8 chars) — **required on a public URL** · `STUDIO_SESSION_SECRET` (64-hex, `openssl rand -hex 32`) — recommended · `ZAI_API_KEY`/`GLM_API_KEY` — optional · `HF_TOKEN` — **Phase 3 only**. All values enter as Railway service variables, never files/chats/repo.

## 5. Database & Storage Status
- **PostgreSQL:** baseline `0_init` checked in; applied automatically by `preDeployCommand` before each deploy (idempotent, advisory-locked, additive-only). Repo schema remains SQLite for dev — dual-mode verified by actually building both variants. **Not yet applied to any live database** (none exists — owner provisions it).
- **SQLite data:** untouched; carry-over is an owner decision (fresh start recommended; optional script documented, Phase 2b).
- **Artifacts/caches:** all under `/app/storage` = Railway volume (persists redeploys); PG makes the database durable; R2 migration is a later optimization.

## 6. Remaining AI-Provider Blockers (unchanged, honest)
1. **z-ai-web-dev-sdk is sandbox-only** — on Railway all SDK-backed capabilities (chat default, image, ASR, video, VLM, image-search) will report `PROVIDER_UNAVAILABLE` honestly via the Phase-1 registry/`getZAI` guard. Portable today: external GLM (user keys), Google-Translate bn TTS fallback, procedural instrumentals. `/api/health.providers.zaiSdk` makes this visible at all times. **Fix = Phase 3 HF wiring (owner-gated, budget-capped).**
2. Sung vocals + lip-sync remain **unsupported** (owner budget decision, Phase 4).
3. Edge-TTS bn + Google-bn TTS need re-testing from Railway egress (Phase 4 probe).

## 7. Staging URL
**None — no deployment has occurred** (owner-gated by design). No Railway account was touched, no plan purchased, no charges incurred. URL appears here only after a genuinely successful owner-approved deploy.

## 8. Git Status
- `main` @ `95c0640` — **local commit only**; `origin/main` = `02071ea` (unchanged). **Nothing pushed** per the Phase-2 constraint (push, deploy, purchase all await explicit owner approval).
- Working tree after this report + worklog append: second local docs commit (this file + worklog).

## 9. Verdict

## **PASS WITH BLOCKERS**

Everything preparable and verifiable **without** owner assets is done and evidence-backed: production Dockerfile (runtime spec .deb/schema-verified), Railway config-as-code, additive PG baseline, health endpoint + startup checks (dual-direction tested), 320/320 suite green, first PG-flipped standalone build exit 0, standalone bundle audited, live dev server verified incl. browser check. **The blockers are, by the task's own rules, owner-gated actions:**
1. Rotate the two exposed tokens (HF `hf_QueX…` S-1; GitHub PAT `ghp_…`) — still open from Phase 0/1.
2. Railway account + Hobby plan approval (purchase) + PostgreSQL provision.
3. Set the three service variables + attach the volume at `/app/storage` (exact steps: `phase-2-railway-staging.md` §3).
4. Approve push of the two local commits (triggers GitHub CI only — no Railway connection exists, so no accidental deploy).
5. Approve the first staging deploy; then the §3.6 smoke checklist gates Phase 3.

**Stopping here and awaiting owner approval, as instructed.**

— END OF PHASE 2 REPORT —
