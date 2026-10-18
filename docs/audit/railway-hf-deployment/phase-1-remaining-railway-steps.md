# Phase 1 — Remaining Railway Steps (Phase 2+ owner-gated checklist)

**Task ID:** 1-c · **Companions:** `phase-0-audit-report.md` (blockers B-D1…D8, cost §8, sequence §9) · `phase-1-database-migration-plan.md` (PG plan) · `phase-1-ffmpeg-runtime-requirements.md` (image spec)
**Rule:** every numbered step that spends money or changes the public surface needs **explicit owner approval first**. Nothing here has been deployed or verified on Railway — every "verified" below refers to code/public-docs evidence only.

> ধাপে-ধাপে চেকলিস্ট — প্রতিটি ফেজ মালিকের অনুমোদন-গেটেড। কিছুই ডিপ্লয় হয়নি।

---

## 1. Owner pre-requisites (blocking — do/decide these first)

1. **Rotate the exposed HF token** (`hf_QueX…` pasted in chat — Phase 0 security incident). Revoke at huggingface.co/settings/tokens; a *fresh fine-grained* token is only ever entered later as a Railway secret (Phase 3). *(Also: GitHub token embedded in the sandbox clone's `.git/config` remote URL — move to a credential helper.)*
2. **Decide the push of local commits `b20174f` + `b97ab4d`** (ahead of `origin/main` @ `49d9b29`; verified at doc time: HEAD `b97ab4d`, tree clean). Latest fixes (Google-bn TTS, narrative review, evidence docs + all Phase 1 work landing on top) exist **only** in the sandbox until pushed. Recommended: push after Phase 1 gates are green.
3. **Railway account + Hobby plan** ($5/mo incl. credits — Phase 0 §8).
4. Database/storage/worker decisions (Phase 0 §11): PostgreSQL (recommended) · Volume interim → R2 (recommended) · single web service first (recommended).
5. **Budget caps for every paid probe** (Phase 4) — set *before* any token touches a billable endpoint. HF PRO ($9/mo, optional Phase 3) only if router credits are wanted.

## 2. Phase 2 — Railway web service (first deploy)

1. **Dockerfile** (repo has none — verified): multi-stage — bun install → `prisma generate` → `next build` + `node scripts/prepare-standalone.mjs` (standalone output confirmed in `next.config.ts` and the copy script exists) → runtime `node:22-slim` + `apt-get install -y --no-install-recommends ffmpeg fonts-noto-core` (full spec: `phase-1-ffmpeg-runtime-requirements.md` §4). Non-root user. **Note: `next build` has never run anywhere (B-D4) — expect the first CI/Docker build to be the real test.**
2. **`.dockerignore`** — `storage/`, `db/`, `.next/`, `node_modules/`, `dev.log`, `docs/audit/**/evidence/` (both `storage/` and `db/*.db` already gitignored — verified).
3. **`railway.json`** — health check `GET /api/auth/status` (route exists, unauthenticated, cheap — verified `src/app/api/auth/status/route.ts`); restart policy; later a worker service block.
4. **Secrets to set** (service variables): `DATABASE_URL` (PG URL, `postgresql://…` — see migration-plan §3.1 note on the `postgres://` scheme), `STUDIO_OWNER_PASSCODE` (≥8 chars — mandatory on a public URL, B-D5), `STUDIO_SESSION_SECRET` (env support added in Phase 1 — parallel `security.ts` work; keeps 30-day sessions alive across redeploys). Optional: `HF_*` only in Phase 3.
5. **Railway PostgreSQL provisioning** — create plugin, copy/normalize `DATABASE_URL`, apply the **baseline migration** (`prisma migrate deploy` with the initial `0_init` from migration-plan §3.2) — additive-only, owner approval gate for anything destructive. Optional §4 data-carry script if sandbox history is wanted.
6. **Volume mount at `/app/storage`** (interim, ≤5 GB Hobby cap) — code needs zero changes (every path roots at `process.cwd()/storage` — migration-plan §6.1).
7. **First deploy + smoke checks** (all must pass before Phase 3):
   - `GET /` → 200 (Bengali studio UI renders);
   - `GET /api/auth/status` → 200 JSON (health check wired);
   - ffmpeg presence: `/api/hardware` response has non-null `ffmpegVersion`/`ffprobeVersion` (checklist `phase-1-ffmpeg-runtime-requirements.md` §6, incl. smoke-encode exit 0);
   - storage write: create any small production (or upload) → file appears under the mounted volume, survives a redeploy;
   - SSE: open `/api/productions/[id]/events` on a running job → events flow; **refresh-reconnect** replays from the 200-event buffer (same-instance only — in-memory bus);
   - unlock/lock auth round-trip with the env passcode; artifact download authorized only with session.

## 3. Phase 2b — optional worker split (decision, not default)

- **When:** if multi-minute video productions (motion_video/music_video/short_film ≈ 2–30+ min each) must **survive redeploys** without being marked failed.
- **What:** second Railway service (worker entry script, no HTTP) polling PG for `queued` productions and executing the shared pipelines (`src/lib/agent/production/*`); both services share PG + the volume (or S3 from then on). PG is the prerequisite (SQLite cannot be shared — migration-plan §5).
- **Known constraints (honest):** the SSE event bus is **in-memory, single-instance** (Phase 0 §1) — a worker split requires the DB-backed SSE fallback for progress visibility; the confirm→queued route and the claim transition need guarded `updateMany`/`$transaction` before two processes race (migration-plan §5). Phase 1's `recovery.ts` (boot sweep + graceful SIGTERM marking) makes restarts *honest* (failed + re-runnable) but **only a worker prevents interruption**.
- Without 2b, adopt deploy-window discipline (redeploy between jobs) — acceptable for single-owner use.

## 4. Phase 3 — Hugging Face wiring (paid paths only after budget caps)

1. Fresh **fine-grained `HF_TOKEN`** as a Railway secret — least-privilege, server-side only, never logged (B-D7 hygiene).
2. HF **Inference Providers router** (router.huggingface.co) for **chat / text-to-image / text-to-video / speech-to-text ONLY** — these four are the verified-available capability classes (Phase 0 §6, checked against current HF docs). **Explicitly NOT available via the router: TTS, music, lipsync** — keep the working free paths (Google-Translate bn TTS fallback, procedural instrumental engine, honest-disabled lipsync).
3. New HF adapters slot into the **Phase 1 provider registry** `src/lib/providers/` (`types.ts` capability interfaces, `registry.ts` capability reports + preflight, `errors.ts` `ProviderUnavailableError` — parallel Phase 1 paths; guards already wired into `sdk-helpers.ts` / `llm.ts` / `video/ai_video.ts`), so unconfigured capabilities fail honestly at preflight instead of at runtime (B-D1).
4. Per-capability model routing env (`HF_CHAT_MODEL`, `HF_IMAGE_MODEL`, `HF_VIDEO_MODEL`, `HF_ASR_MODEL` — Phase 0 §4) and **billing limits set on the HF account before any probe**. Video per-second pricing is unverified — cap it.
5. Bengali-ASR upgrade path: router Whisper-class STT may raise bn validation from `AUDIO_VALIDATION_ONLY` → `ASR_VERIFIED` (live probe required, Phase 4).

## 5. Phase 4 — capability verification probes (each individually budget-approved, each producing evidence files)

1. **bn TTS from the Railway network:** Google-Translate fallback live-test (works in sandbox; confirm from Railway egress) + **Edge-TTS retest** (sandbox = 403; Railway network may differ — could unlock bn-BD/bn-IN neural voices for free).
2. **Video via HF router** with a hard cost cap: one 5-s t2v probe → ffprobe validation → record cost/unit before enabling in the UI.
3. **Whisper-class bn ASR** probe (router) — if script-preserving, upgrade the language-honesty labels.
4. Optional (only with explicit budget approval + live Bengali verification + human review): **ACE-Step 1.5 singing** probe (~$0.02/run, MIT, per repo research); **hosted lip-sync** probe (~$0.05–0.14/run). Both remain honestly disabled until then (Phase 0 §6).
5. Free/already-proven paths need no probe: procedural instrumentals, external GLM (user keys), image gen via router (pennies — still cap).

## 6. Phase 5 — E2E production-flow validation on the Railway URL

Full owner-driven flow, not mocks: **chat → creative plan card → config panel → confirm → SSE progress → artifact download** (the "বাংলা একটি গান দিয়ে মিউজিক ভিডিও বানিয়ে দাও" path of Phase 0 §9). Include: refresh-reconnect mid-run (SSE replay), cancellation mid-ffmpeg (kill-tracking), a revise chain (revision card), and gallery + registry pages. Evidence: screenshots + artifact files + `/api/hardware` output.

## 7. Phase 6 — security & acceptance (final gate)

1. **Secrets scan** of repo + full git history (the exposed HF token must appear nowhere).
2. **Log-redaction audit** — no keys/tokens/passcodes in server logs; error paths already truncate (verified pattern in `ffmpeg.ts`/`ai_video.ts` wrappers).
3. Rate-limit review (unlock 5/15 min/IP verified in `security.ts`; per-channel coordinator in-memory — fine single-instance).
4. **Rollback rehearsal** (below) + failure drills (kill the container mid-job → boot-recovery honesty verified via Phase 1 `recovery.ts` + `instrumentation.ts`).
5. Final verdict report (PASS / PASS-WITH-BLOCKERS / FAIL) appended to this folder.

## 8. Rollback plan summary

- **App:** Railway "redeploy previous build" per service; pin the last-known-good build before each phase.
- **DB:** migrations additive-only (never destructive without owner approval); volume snapshot / `pg_dump` before each migration; `DATABASE_URL` can be repointed to the previous store and redeployed.
- **Storage:** volume snapshots before any migration touching `/app/storage`; S3 keeps old objects (additive bucket layout).
- **Secrets:** rotation runbook — HF token (rotate + update one Railway variable), owner passcode, `STUDIO_SESSION_SECRET` (rotation invalidates sessions — acceptable single-owner).
- **Triggers:** failed health check, failed post-deploy smoke (§2.7), provider-spend anomaly (HF billing alerts before any paid probe).

---

## Appendix — Evidence base for the claims above

- Repo state: HEAD `b97ab4d`, 2 commits ahead of `origin/main` @ `49d9b29` (`git log --oneline -3`); working tree clean; **no Dockerfile / railway.json / CI workflow exist** (existence check per path — Phase 0 §1 confirmed, re-verified).
- `GET /api/auth/status` handler exists (`src/app/api/auth/status/route.ts:13`), unauthenticated; `next.config.ts` `output: "standalone"`; `scripts/prepare-standalone.mjs` copies `.next/static` + `public` into the standalone dir.
- `security.ts`: env-passcode pre-seed + unlock rate-limit (5/15 min) verified in code; `STUDIO_SESSION_SECRET` = parallel Phase 1 work (absent at doc time — honest).
- Phase 1 parallel paths referenced as specified by the main agent's task context (`src/lib/providers/`, `production/recovery.ts`, `src/instrumentation.ts`, `src/lib/env.ts`, tests t27–t29, `.github/workflows/ci.yml`) — **verified absent at doc-writing time; expected by end of Phase 1** — re-verify before executing Phase 2.
- HF router capability classes and pricing assumptions: Phase 0 §6/§8 (public-docs verified 2026-10-18); singing/lipsync research: `docs/audit/latest-fix/{singing,lipsync}-provider-research.md`.
- Storage/volume/S3 and migration specifics: `phase-1-database-migration-plan.md`; image/ffmpeg specifics: `phase-1-ffmpeg-runtime-requirements.md`.

— END OF PHASE 1 REMAINING RAILWAY STEPS —
