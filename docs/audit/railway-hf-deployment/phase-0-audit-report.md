# PHASE 0 — Repository & Deployment Audit Report
## Target: Railway (web + optional worker + DB/storage) + Hugging Face (inference)

**Task ID:** P0-DEPLOY-AUDIT · **Date:** 2026-10-18 · **Auditor:** Z.ai Code (main agent)
**Repo:** `github.com/psfaruk/AI-creation-studio` (public, `main` @ `49d9b29`)
**Local sandbox clone:** same repo, HEAD `b20174f` (1 commit **ahead**, unpushed), working tree clean.

> **Phase 0 compliance:** No source files modified. No deployment, no spend, no inference calls, no commits/pushes. Read-only inspection + public-docs verification. Only this report file + worklog entry were created.
>
> ⚠️ **SECURITY INCIDENT (owner action required):** An HF token was pasted in plaintext chat before this audit (`hf_QueX…` — not used, not stored, not reproduced anywhere). It must be considered **compromised → revoke it now** at huggingface.co/settings/tokens. A fresh fine-grained token must be created later and only ever entered as a Railway service secret (Phase 3). A GitHub token is also embedded in the local clone's `.git/config` remote URL (sandbox artifact — recommend credential-helper instead; it is not in Git history).

---

## 0. Executive Summary

**Verdict: PASS (audit complete). Production readiness: NOT READY — 2 CRITICAL + 2 HIGH blockers must be fixed first.**

The application is functionally strong (266/266 tests green, live-proven Bengali TTS + real AI video E2E, honest capability gating throughout), but it is currently a **sandbox-shaped monolith**: every AI call goes through `z-ai-web-dev-sdk` whose credentials exist **only inside this sandbox** — on Railway every generation path would fail at runtime. State (SQLite + `storage/` + session secret) lives on an **ephemeral filesystem**, and long jobs run **in-process in the web server**, so a Railway redeploy kills running video productions. Hugging Face **cannot host Bengali TTS, singing, or lip-sync via its serverless router** (verified against current docs) — those need either the already-working free fallbacks or budget-approved paid paths.

---

## 1. Repository & Runtime Facts (verified)

| Item | Value |
|---|---|
| Framework | Next.js **16.1.3** App Router, React 19, TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) + Lucide |
| Package manager | **Bun** (`bun.lock`, `bunfig.toml`); runtime = Node (standalone build) |
| Build | `next build && node scripts/prepare-standalone.mjs` → `output: "standalone"` (next.config.ts) |
| Start | `node .next/standalone/server.js` |
| Commands | `dev` (port 3000), `build`, `start`, `lint`, `typecheck` (tsc), `test` (bun test, 266 tests / 28 files), `db:push|generate|migrate|reset` |
| Database | Prisma 6 + **SQLite** (`file:./db/custom.db`), 8 models, no migrations folder (push-based) |
| API surface | ~27 route handlers (chat, agent runs SSE, productions CRUD/plan-preview/confirm/cancel/events/revise/validate/config-panel, artifacts+file download, auth setup/unlock/lock/status, provider-keys, platform-key, v1 OpenAI-compatible chat/models, benchmark, gallery, registry, hardware, availability, system, tools) |
| Media engine | System **FFmpeg/FFprobe** via `child_process` (timeouts, per-production kill-tracking, ffprobe validation everywhere) |
| Auth | **Single-owner passcode** (scrypt hash + HMAC-SHA256 30-day session, HttpOnly cookie + header), unlock rate-limit 5/15min/IP. `storage/security.json` persists session secret. **NextAuth installed but unused.** |
| Background jobs | **In-process** Production Runner: globalThis queue, `MAX_CONCURRENT=2`, stale-sweep 20 min (60 min AI-video), lifecycle `awaiting_confirmation → queued → running → validating → completed|failed|partial|cancelled` persisted in DB; **no crash-resume** (interrupted jobs stay "interrupted"/stale-marked) |
| Progress delivery | SSE (`/api/productions/[id]/events`, `/api/runs/[id]/events`) from an **in-memory** event bus with 200-event replay buffer (refresh-safe, same-process only) |
| Rate limiting | In-memory per-channel coordinator (chat/image/tts/video/search) + 429 backoff ladder + provider retry policy with jitter |
| Caches | Disk: TTS cache, LLM chat cache (12 h TTL), cross-run AI-shot cache (fingerprinted `{v,model,prompt,duration,quality,image,withAudio,size}`) — all under `storage/` |
| Deployment files | **NONE** — no Dockerfile, no railway.json/toml, no nixpacks, no CI workflows |
| Prior quality evidence | `docs/audit/phase-0…5`, `recovery-phase-1-5`, `latest-fix` (verdict: PASS WITH LIMITATIONS); live E2E music-video artifact (h264 1080p30 + AAC, ffprobe-verified) in `latest-fix/evidence/` |

**Unpushed work warning:** local commit `b20174f` (Google-TTS bn provider, cinematic narrative review, tests t0/t26, all `latest-fix` evidence docs) exists **only in this sandbox**. GitHub `main` is one commit behind. Pushing requires owner approval (not done in Phase 0).

---

## 2. Current Architecture Diagram

```
┌────────────────────────── CURRENT (single sandbox process) ───────────────────────────┐
│  Browser — Bengali-first studio UI (single route /) … chat, plan cards, config panel, │
│            production progress (SSE), gallery, registry, benchmark                     │
│      │ REST + SSE (same-origin)                                                        │
│  ┌───┴─────────────────────────────────────────────────────────────────────────────┐   │
│  │ NEXT.JS 16 (port 3000)                                                           │   │
│  │  /api/chat …orchestrator → intent classifier → creative plan (LLM JSON protocol) │   │
│  │  /api/productions/* …plan-preview → config-panel → CONFIRM GATE → durable job    │   │
│  │  /api/runs|productions/[id]/events … SSE (in-memory bus, 200-event replay)       │   │
│  │  /api/artifacts/[id]/file … authorized download                                   │   │
│  │  Production Runner (IN-PROCESS queue, concurrency 2, cancel-kill ffmpeg)         │   │
│  │    pipelines: image · audio · music_video · motion_video · short_film · voiceover │   │
│  │    cinematic planner → shots → AI video → timeline → mix/loudness → final QC      │   │
│  │  FFmpeg/FFprobe (system binaries) · security gate (passcode) · rate coordinator   │   │
│  └───┬──────────────────────────────┬───────────────────────────────────────────────┘   │
│      │ Prisma                       │ fs                                                        │
│   SQLite db/custom.db            storage/{artifacts, tts-cache, llm-chat, shot-cache,     │
│   (8 models, job state            security.json, provider-keys.json,                      │
│    persisted ✓)                   voice-verification.json}                                  │
│      │                                                                                    │
│   AI PROVIDERS:  z-ai-web-dev-sdk  ← SANDBOX-INTERNAL AUTH (NOT PORTABLE)                 │
│                  ├─ chat.completions (default LLM)      ✅ live-proven                    │
│                  ├─ images.generations (+edit, search)  ✅ live-proven                    │
│                  ├─ video.generations (CogVideoX-3)     ✅ live-proven (1-task, ~2min cd) │
│                  ├─ audio.tts (7 voices — en/zh ONLY; bn ❌)                             │
│                  └─ audio.asr (en/zh ✅; bn → Chinese translation ❌ script-preserving)   │
│                  External GLM (Z.ai API / BigModel, user keys, OpenAI SDK) — PORTABLE ✓  │
│                  Google-Translate bn TTS fallback — PORTABLE ✓ (unofficial, no SLA)      │
│                  Edge-TTS bn neural — 403 from sandbox network (may differ on Railway)   │
│                  Procedural instrumental engine (honest [PROCEDURAL_INSTRUMENTAL] label) │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

**Target (proposed — subject to owner approval):**

```
        RAILWAY                                       HUGGING FACE
┌───────────────────────┐   ┌──────────────────────┐   ┌───────────────────────────────┐
│ WEB SERVICE            │   │ WORKER SERVICE (opt.) │   │ Inference Providers (router)   │
│ Next.js standalone     │   │ production runner,    │   │ router.huggingface.co          │
│ Docker + ffmpeg        │   │ pipelines, ffmpeg     │   │ chat · text-to-image ·         │
│ UI, API, SSE, auth     │◄──┤ executes durable jobs │──►│ text-to-video · speech-to-text │
│ submits jobs, status   │   │ (shares DB + storage) │   │ (NO TTS / music / lipsync)     │
└──────────┬─────────────┘   └──────────┬───────────┘   ├───────────────────────────────┤
           │                            │                │ Dedicated Endpoints (optional, │
   ┌───────┴────────────────────────────┴───────┐        │ GPU/hr — only if owner approves │
   │ PostgreSQL (+ additive migrations)          │        │ bn-TTS / music / lipsync models)│
   │ S3-compatible object storage for media      │        │ Spaces: prototyping only, not   │
   │ (R2) or Railway Volume interim (≤5 GB)      │        │ production API (sleep/cold)     │
   └─────────────────────────────────────────────┘        └───────────────────────────────┘
```

---

## 3. Service Placement Matrix

| Module (repo path) | Today | Railway Web | Railway Worker | DB/Storage | HF role |
|---|---|---|---|---|---|
| UI + chat (`src/app/page.tsx`, `components/chat|studio`) | web | ✅ | — | — | — |
| Short API handlers (all `/api/*` except SSE) | web | ✅ | — | — | — |
| SSE routes (`runs/[id]/events`, `productions/[id]/events`) | web (in-memory bus) | ✅ **needs DB-polling fallback if worker split** | — | — | — |
| Production Runner + 6 pipelines (`agent/production/*`) | web process | submit/status only | ✅ executes | job state in PG | provider calls |
| Cinematic planner/narrative (`agent/cinematic/*`) | web | ✅ | ✅ (shot planning) | — | LLM via router |
| FFmpeg/FFprobe assembly (`lib/media/ffmpeg.ts`) | web | — | ✅ (runtime image needs ffmpeg) | — | — |
| z-ai SDK call sites (`llm.ts`, `sdk-helpers.ts`, `ai_video.ts`, …) | web | ❌ **replace with provider adapters** | ❌ same | — | HF router replaces chat/image/video; TTS/ASR per below |
| External GLM (`external-llm.ts`, OpenAI SDK) | web | ✅ portable as-is (user keys) | ✅ | — | alternative to HF chat |
| Google-TTS bn fallback (`audio/google_tts.ts`) | web | ✅ portable | ✅ | — | — |
| Edge-TTS bn neural (`audio/edge_tts.ts`) | web (403 sandbox) | ✅ code ready — **must live-test from Railway network** | ✅ | — | — |
| Procedural instrumental (`audio/music_engine.ts`) | web | ✅ portable (honest label) | ✅ | — | — |
| TTS/LLM/shot caches (`tts-cache.ts`, `llm.ts`, `shot_cache.ts`) | local disk | shared | shared | move to volume/S3 | — |
| Security gate (`lib/security.ts`) | web | ✅ **env passcode mandatory in prod** | — | session secret must leave ephemeral disk | — |
| Prisma models (8) | SQLite | PG client | PG client | PostgreSQL | — |
| Artifacts (media files) | `storage/artifacts` | serve via authorized route | write | **S3/R2 (recommended)** or Volume interim | — |
| Tests (266, bun) | local | CI (GitHub Actions, new) | CI | — | — |

**Worker split recommendation:** Start Phase 2 with **a single web service** (cheapest, matches single-owner usage) **plus** (a) graceful-shutdown handling, (b) interrupted-job recovery on boot, (c) deploy-window discipline. Extract the worker as a second Railway service in the same phase *if* the owner wants multi-minute video jobs to survive redeploys — the runner is already module-separated (`production/runner.ts`), so a worker entry script + DB-poll loop is a contained change; the SSE bus then needs the DB-backed fallback. Documented either way per master-prompt rule.

---

## 4. Exact Environment-Variable List (no secret values)

### Currently consumed (code-verified)
| Variable | Required | Consumer | Notes |
|---|---|---|---|
| `DATABASE_URL` | **yes** | `prisma/schema.prisma` | SQLite file URL today (`file:./db/custom.db`); becomes PostgreSQL URL in Phase 2 |
| `STUDIO_OWNER_PASSCODE` | prod: **yes** | `src/lib/security.ts` | ≥8 chars; pre-seeds owner passcode, blocks first-visitor takeover; **must be set on Railway** |
| `ZAI_API_KEY` | no | `external-llm.ts` via `provider-keys.ts` | External Z.ai GLM chat; format `{id}.{secret}` |
| `GLM_API_KEY` | no | `external-llm.ts` | BigModel GLM chat (glm-4-flash free tier) |
| `TTS_CACHE_DIR` | no | `tts-cache.ts` | cache path override (test isolation) |
| `VOICE_VERIFICATION_FILE` | no | `edge_tts.ts` | verification cache path |
| `NODE_ENV`, `PORT` | auto | Next.js | standard |

### File-based config (not env — must be migrated off ephemeral disk)
- `storage/provider-keys.json` — UI-saved provider keys (precedence: file → env)
- `storage/security.json` — owner passcode hash + **session secret** (ephemeral ⇒ sessions break each redeploy; takeover risk if passcode unset)

### New variables required by the target architecture (not yet in code)
| Variable | Phase | Purpose |
|---|---|---|
| `HF_TOKEN` | 3 | Hugging Face Inference Providers auth — **fine-grained, least-privilege, server-side only, never logged** |
| `HF_PROVIDER_*` (per-capability model routing) | 3 | adapter layer model selection (e.g. `HF_CHAT_MODEL`, `HF_IMAGE_MODEL`, `HF_VIDEO_MODEL`, `HF_ASR_MODEL`) |
| `S3_*` / `STORAGE_DRIVER` | 2b | object storage for artifacts (if R2 chosen) |
| `DATABASE_URL` (PostgreSQL) | 2 | replaces SQLite URL — additive migration, owner approval first |

**Precedence rule to preserve:** UI-saved keys (file) override env today; keep that contract in the adapter layer.

---

## 5. Required Deployment Files & Changes (all Phase 1+ — nothing created now)

1. **`Dockerfile`** (recommended over Nixpacks for ffmpeg control): multi-stage — bun install + `prisma generate` + `next build` → runtime `node:22-slim` + `apt-get install -y ffmpeg` (ffprobe included); copy standalone output; non-root user; `HEALTHCHECK` hitting `/api/auth/status` (cheap, unauthenticated, exists).
2. **`railway.json`** — health-check path + restart policy + (later) worker service with different start command.
3. **`.dockerignore`** — `storage/`, `db/`, `.next`, `node_modules`, `dev.log`, evidence media.
4. **Prisma PostgreSQL migration** — `provider = "postgresql"` + `prisma migrate` (additive; schema is JSON-in-TEXT so it ports cleanly; **approval gate** before touching data).
5. **Storage adapter** — `STORAGE_DRIVER=local|s3` behind the existing `storage.ts` interface (path-containment contract already tested); artifacts → S3/R2, caches → volume.
6. **Session-secret durability** — derive from env (`STUDIO_SESSION_SECRET`) or DB; stop writing the secret to ephemeral disk.
7. **Provider adapter layer** (`src/lib/providers/` proposed) — the master prompt's Service-3 contract: provider/model id, capability flags, auth, request/response validation, timeout/retry, rate-limit mapping, health status, honest unsupported-capability errors. Existing `external-llm.ts` + `chat-models.ts` + `provider-keys.ts` are the seed pattern to generalize.
8. **Worker entry (if split)** — `scripts/worker.ts` polling PG for `queued` productions; shares pipeline code; no HTTP.
9. **`.env.example` update** — placeholders only for the new vars.
10. **CI (GitHub Actions)** — `typecheck + lint + bun test + next build` — **critical because `bun run build` has never executed anywhere** (sandbox-forbidden); the first real build must happen in CI/Railway before any deploy is trusted.
11. **Interrupted-job recovery** — on boot, mark `running`→`interrupted` (exists) **and** re-queue eligible `queued` jobs; required before any Railway deploy.

---

## 6. Provider / Capability Compatibility Matrix

### Verified today (live-proven in sandbox, evidence in `docs/audit/latest-fix/`)
| Capability | Provider | Status | Notes |
|---|---|---|---|
| Chat LLM (Bengali planning) | z-ai SDK / external GLM | ✅ / ✅ (user key) | JSON tool-call protocol, rate-coordinated |
| Image gen + edit | z-ai images | ✅ | storyboards, portraits, shot fallback |
| AI video t2v/i2v | z-ai CogVideoX-3 | ✅ | 5/10 s shots; single in-flight task + ~2.2 min cooldown; request_id idempotency |
| Bengali TTS (speech) | **Google-Translate fallback** | ✅ | single voice, unofficial endpoint, no SLA, ~180-char chunks |
| Edge-neural bn voices (bn-BD/bn-IN) | Edge-TTS | ⛔ 403 (sandbox network) | code correct; **must retest from Railway network** |
| z-ai TTS | 7 voices | ✅ en/zh · ❌ bn | banned from bn chain by language guard |
| Bengali ASR validation | z-ai ASR | ❌ bn → Chinese | bn audio capped at `AUDIO_VALIDATION_ONLY` (honest) |
| Instrumental music | procedural engine v2 | ✅ honest `[PROCEDURAL_INSTRUMENTAL]` | not neural — labeled everywhere |
| Sung vocals / full song | — | ⛔ no provider | all vocal-capable APIs are key+payment; no HF serverless lyrics-to-song |
| Lip-sync | — | ⛔ 4-axis blocked | license partially improved (MuseTalk 1.5 MIT) but provider/hardware/integration blocked |
| FFmpeg/FFprobe | system binaries | ✅ | version-documented validation |

### Production options via Hugging Face (verified against current HF docs, 2026-10-18)
| Capability | HF Inference Providers (router) | HF Dedicated Endpoints | HF Spaces | Recommendation |
|---|---|---|---|---|
| Chat LLM | ✅ OpenAI-compatible `/v1/chat/completions`, many partner models | ✅ (overkill) | — | **router** (or keep external GLM keys — already portable) |
| Text-to-image | ✅ (fal, Replicate, Together, …) | ✅ | — | **router** — replaces zai.images (pennies/image) |
| Text-to-video | ✅ (fal, HF Inference, Novita, Replicate, WaveSpeedAI, …) | ✅ | — | **router** — replaces zai CogVideoX-3; **per-second pricing must be verified with a budget-approved probe before enabling** |
| Speech-to-text (ASR) | ✅ (Together, Z.ai, …) | ✅ | — | **router Whisper-class** — can finally upgrade bn validation from `AUDIO_VALIDATION_ONLY` → `ASR_VERIFIED` (live probe required) |
| **Text-to-speech** | ❌ **not in partner matrix** (no TTS capability) | ✅ any TTS model on GPU/hr | ⚠️ not prod API | Keep **Google fallback** + **retest Edge-TTS from Railway** (both free); dedicated endpoint only if owner approves GPU cost — and the chosen bn model must pass live verification first |
| Music gen (instrumental) | ❌ not served | ✅ (MusicGen etc.) | ⚠️ | Keep **procedural engine** (free, honest label); optional paid probe later |
| Sung vocals / full song | ❌ not served | ✅ ACE-Step 1.5 (MIT) GPU/hr (~4.7 GB+) | ⚠️ | **BLOCKED pending owner budget** (~$0.02/run via fal/Replicate per repo research) **+ mandatory live Bengali-singing verification + human review** |
| Lip-sync | ❌ not served | ✅ MuseTalk 1.5 (MIT) / SadTalker (Apache-2.0) GPU/hr | ⚠️ | **BLOCKED pending owner budget** (~$0.05–0.14/run hosted, per repo research) — Wav2Lip remains academic-only (never for this product) |

**Billing reality (HF):** router usage is pay-as-you-go through HF credits (PRO subscription) or direct partner billing; the legacy free serverless API is deprecated. **Every paid path requires explicit owner approval per the master prompt.**

---

## 7. Current Production Blockers (ranked, deployment-specific)

| # | Severity | Blocker | Impact if deployed today | Unblocks when |
|---|---|---|---|---|
| B-D1 | **CRITICAL** | `z-ai-web-dev-sdk` auth exists only in this sandbox — 6 call sites (chat default, image, video, TTS, ASR, image-search) | All generation fails at runtime on Railway; app boots but is brain-dead | Phase 1 provider-adapter layer + Phase 3 HF wiring |
| B-D2 | **CRITICAL** | Ephemeral filesystem: SQLite db, `storage/` (artifacts/caches/keys), `security.json` session secret | Total data loss on every redeploy; sessions invalidate; saved provider keys vanish | Phase 2 PostgreSQL + volume/S3 + env session secret |
| B-D3 | **HIGH** | Jobs run in-process; in-memory queue + SSE bus; no crash-resume | Multi-minute video productions killed by any redeploy/restart/crash; SSE needs same instance | Phase 2 recovery + (optional) worker split with DB-backed SSE fallback |
| B-D4 | **HIGH** | No deployment files; `next build` never executed anywhere; ffmpeg missing from any default runtime image | First deploy = unverified build; ffmpeg ENOENT kills all pipelines | Phase 2 Dockerfile + CI build gate |
| B-D5 | **MEDIUM** | Owner-passcode takeover risk if `STUDIO_OWNER_PASSCODE` unset on a public URL; session secret ephemeral | First visitor could claim ownership of a public deployment | Phase 2 mandatory env passcode + durable secret |
| B-D6 | **MEDIUM** | HF router has no TTS/music/lipsync; all real options are paid | Bengali TTS degrades to Google fallback (works, no SLA); singing/lipsync stay honestly disabled | Owner budget approval + live verification (Phase 4) |
| B-D7 | **MEDIUM** | Credential hygiene: HF token exposed in chat (rotate!); GitHub token embedded in local remote URL | Account compromise risk | Owner rotates both; fresh HF token only as Railway secret |
| B-D8 | **LOW** | Single-owner passcode auth (not multi-user); Wikimedia 429 (test-asset source only); `bun run build` untested (dup of B-D4) | Acceptable for personal studio — document; no product impact | Documented; CI gate |

**Carried over unchanged from `latest-fix` (environment-blocked, not deployment-blocked):** B-1 sung vocals ⛔ · B-2 lip-sync ⛔ · B-3 Edge-neural bn voices (retest from Railway — may unblock!) · B-4 script-preserving bn ASR (HF router Whisper may unblock!) · B-5 human media review ⏳ pending owner listening session · B-6 production build NOT RUN (= B-D4).

---

## 8. Estimated Infrastructure Costs (assumptions documented)

| Item | Est. cost | Assumptions |
|---|---|---|
| Railway Hobby (web) | **$5/mo** (incl. $5 usage credits) | single small service, ~0.5–1 vCPU / 1–2 GB RAM, 99.9% target; verified from railway.com/pricing today |
| Railway worker (if split) | ~$2–5/mo from credits | only while jobs run; idle-cheap |
| Railway PostgreSQL | ~$5–10/mo light usage | usage-based from credits |
| Railway Volume (interim) | within Hobby 5 GB cap | fine for SQLite+caches; **not** for growing video artifacts |
| S3-compatible (Cloudflare R2) | ~$0.015/GB-mo + free egress | chosen when artifact library > a few GB (one 30 s music video ≈ 22 MB) |
| Hugging Face PRO | $9/mo | includes monthly router credits |
| HF router usage | pay-as-you-go | image ≈ pennies; **video per-second price unverified — probe with hard cap before enabling**; ASR cheap |
| Dedicated HF endpoint (optional bn-TTS/music/lipsync) | ~$0.60–3+/hr GPU while up | on-demand only; never 24/7 |
| ACE-Step song run (if approved) | ~$0.02/run | repo research 2026-10-17 (fal/Replicate-hosted) |
| Lip-sync run (if approved) | ~$0.05–0.14/run | repo research 2026-10-17 |

**Realistic baseline: ~$10–20/mo** (Hobby + PG + HF PRO) **+ per-generation costs**, all of which are $0 until the owner explicitly approves paid inference. No purchases made in Phase 0.

---

## 9. Step-by-Step Deployment Sequence (proposed; each phase gated by owner approval)

1. **Owner decisions (now):** rotate exposed HF token ✔ decide DB path (PG recommended) ✔ worker split now vs later (single-service first recommended) ✔ storage (Volume interim → R2 recommended) ✔ budget caps for probes ✔ whether to push local commit `b20174f` first (recommended — latest fixes are local-only).
2. **Phase 1 — correctness & portability (no deploy):** provider-adapter layer with capability gates; env-driven provider selection; session-secret durability; interrupted-job recovery; CI workflow (typecheck+lint+test+**first-ever `next build`**). All 266 tests stay green in sandbox.
3. **Phase 2 — Railway web:** Dockerfile (+ffmpeg), railway.json, PostgreSQL additive migration (approval gate), Volume mounts, secrets (`DATABASE_URL`, `STUDIO_OWNER_PASSCODE`, later `HF_TOKEN`), staging deploy, deployment smoke suite (env/DB/storage/ffmpeg/health), SSE reconnect drill, artifact download auth check. Worker split here if chosen.
4. **Phase 3 — Hugging Face wiring:** fresh fine-grained `HF_TOKEN` as Railway secret; router adapters for chat + image (+ video behind cost cap); honest-disable of anything unproven; redacted logging.
5. **Phase 4 — independent capability verification (budget-gated):** bn TTS (Google fallback live-test + Edge-TTS from Railway + optional HF endpoint probe) · instrumental (procedural, free) · singing (ACE-Step only with approval + bn live verification + human review) · video (capped probe, ffprobe validation, cost/unit recorded) · lip-sync (only with approval) · bn ASR upgrade via Whisper-class (raises validation ceiling).
6. **Phase 5 — E2E on production URL:** full chat→plan→config→confirm→progress→artifact flow ("বাংলা একটি গান দিয়ে মিউজিক ভিডিও বানিয়ে দাও" path), refresh-reconnect, cancellation, revise chain.
7. **Phase 6 — acceptance:** security audit (secrets scan of repo+history, log redaction, rate limits, request-size limits), failure/restart drills, rollback rehearsal, final report with PASS/PASS-WITH-BLOCKERS/FAIL verdict.

---

## 10. Test & Rollback Plan

**Quality gates (existing):** `bun run typecheck` (0 errors) · `bun run lint` (0) · `bun test` (266/266, incl. SSE replay/reconnect t2/t4/t7, duplicate-submission t3, cache-reuse t10, capability-confirm t14, lipsync-download t22, bn-integrity t20) · `prisma validate`. Documented 2026-10-17; **not re-run in Phase 0** (read-only phase).

**New tests required (Phases 1–2):** env-validation startup test · PG connectivity + concurrent-job-update test · worker queue pickup + idempotency (no double-billing) · interrupted-job recovery on boot · storage-driver abstraction (local/S3) · deployment smoke script · adapter unit tests with recorded fixtures (mock ≠ proof — live probes are the only proof of real models, master-prompt rule).

**Live probes (each individually budget-approved, each producing evidence files):** HF router chat/image/video/ASR · Google-TTS from Railway network · Edge-TTS from Railway network · (optional) ACE-Step bn singing · (optional) hosted lip-sync.

**Rollback:** Railway per-service "redeploy previous build" (pin last-known-good) · DB migrations additive-only (destructive = explicit approval) · volume snapshot before migrations · secrets-rotation runbook (HF token, GitHub token, owner passcode) · rollback triggers: failed health check, failed post-deploy smoke, provider-spend anomaly (set HF billing limits before any paid probe).

---

## 11. Decision Requests for the Owner (blocking Phase 1)

1. **Rotate the exposed HF token now** (and confirm a fresh one will be supplied as a Railway secret in Phase 3).
2. Approve **Phase 1 scope** (adapter layer + recovery + CI — code changes, still no deploy).
3. **Database:** PostgreSQL on Railway (recommended) vs Volume-backed SQLite interim.
4. **Worker:** single web service first (recommended) vs immediate worker split.
5. **Storage:** Railway Volume interim → R2 when needed (recommended) vs immediate S3.
6. **Push local commit `b20174f`?** (latest fixes exist only in the sandbox).
7. **Budget caps** for live probes (image/ASR pennies; video per-second TBD; singing ~$0.02/run; lipsync ~$0.05–0.14/run).

— END OF PHASE 0 REPORT —
