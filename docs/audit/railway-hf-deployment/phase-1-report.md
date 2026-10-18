# PHASE 1 — Implementation Report (Railway + Hugging Face preparation)
## Scope: provider-adapter layer · job recovery · CI · security hardening · migration plans — NO deploy, NO spend, NO live probes, NO commits

**Task ID:** P1-IMPL · **Date:** 2026-10-18 · **Branch:** `main` @ `b97ab4d` (2 ahead of origin — b20174f + b97ab4d from before/Phase 0; **Phase 1 changes are uncommitted working-tree changes awaiting owner approval**)

---

## 1. Files Changed and Reasons

### New files (12 paths)
| File | Reason |
|---|---|
| `src/lib/providers/types.ts` | Capability interfaces (chat/image/ASR/bn-TTS/instrumental/sung/video/lip-sync) + status types (`available`/`unavailable`/`unsupported` — three distinct truths). Phase 3 HF adapters slot into these contracts. |
| `src/lib/providers/sandbox-detect.ts` | **B-D1 core**: detects z-ai-web-dev-sdk auth (`.z-ai-config` at cwd/`~`//etc — verified from SDK source `dist/index.js loadConfig`). Pure fs-shape check — never reads/logs secret contents. Also `assertZaiConfiguredOrThrow` + `classifyZaiCreateError` (pure, mock-free testable). |
| `src/lib/providers/errors.ts` | `ProviderUnavailableError extends TemporarilyUnavailableError` — deliberate inheritance so pipelines' honest fallback paths (labeled local/procedural outputs) apply unchanged; both `instanceof` and text-detection work. |
| `src/lib/providers/registry.ts` | Single code-level truth for capability status; `getCapabilityReports({sandboxConfigured})` injection for mock-free tests; honest `PROVIDER_UNAVAILABLE` vs `UNSUPPORTED` preflight errors. |
| `src/lib/agent/production/recovery.ts` | **B-D3 core**: boot recovery (queued-never-started → safe re-queue; dead-process running/validating/cancelling → honest `failed`) + SIGTERM shutdown marking. Testable without runner's heavy import graph. |
| `src/instrumentation.ts` | Next.js `register()` — eager-boots the production runner at server start (recovery sweep becomes deterministic, not first-API-call-dependent) + env-validation warnings. Nodejs runtime only. |
| `src/lib/env.ts` | `validateEnv()` — structured env report (required/recommended/optional; never exposes values). HF_TOKEN is a reserved Phase-3 slot. |
| `tests/regression/t27-provider-registry.test.ts` | 19 tests — detection (explicit paths), registry injection, guard + error classification, getZAI real path. **Mock-free** (module mocks are process-hazardous in this suite — see §5). |
| `tests/regression/t28-job-recovery.test.ts` | 8 tests — requeue/fail/active-exclusion/defensive/shutdown contracts via fake-db. |
| `tests/regression/t29-env-and-session-secret.test.ts` | 11 tests — env validation both modes + `resolveSessionSecret` precedence. Snapshot-based env restore (no leaks). |
| `.github/workflows/ci.yml` | CI (see §5). Created by Task 1-b subagent; validated (YAML parse exit 0). |
| `docs/audit/railway-hf-deployment/phase-1-*.md` (3 docs) | Migration plan + FFmpeg/runtime + remaining steps (Task 1-c subagent; see §4/§6/§7). |

### Modified files (7 tracked, +203/−26 excluding worklog)
| File | Change | Reason |
|---|---|---|
| `src/lib/agent/llm.ts` | `getZAI()` now preflights via `assertZaiConfiguredOrThrow` and wraps `ZAI.create()` config errors via `classifyZaiCreateError` | **Single auth choke-point** — every SDK call site (chat default, image gen/edit, TTS, ASR, VLM, image-search, CogVideoX-3 video) flows through `getZAI`. Outside the sandbox → honest `PROVIDER_UNAVAILABLE` on first use instead of cryptic failures. Cache hits and external-GLM models (user keys) work without sandbox auth — verified honest degradation. |
| `src/lib/agent/production/runner.ts` | ① `startProduction` queue-dedupe guard ② boot sweep delegates to `recovery.ts` (behavior change: queued+never-started jobs re-queue instead of fail) ③ SIGTERM graceful-shutdown hook (production Node server only — guarded against dev + bun-test processes) | B-D3. Stage transitions were already fully persisted (ProductionStep rows) — unchanged. |
| `src/lib/security.ts` | `STUDIO_SESSION_SECRET` env support (pure `resolveSessionSecret()` helper, env > file-secret precedence, both call sites wired) | B-D5 remediation: sessions survive redeploys; file secret becomes silent fallback. |
| `tests/helpers/fake-db.ts` | `matches()` gains Prisma-compatible `{in:[...]}`; `production.updateMany` added | Additive test-harness support for recovery tests; existing callers' exact-match behavior unchanged. |
| `package.json` | `"test": "bun test tests --isolate"` | Root-cause fix for cross-file mock pollution (see §5). |
| `.env.example` | Documents `STUDIO_SESSION_SECRET` + reserved `HF_TOKEN` (placeholders only) | Security + Phase 3 readiness. |
| `worklog.md` | Append-only coordination log (per protocol) | — |

### Preserved
All 266 pre-existing tests pass unmodified (except the two additive fake-db helpers). No features removed, no mock substituted for AI, no behavior change in-sandbox (guard passes when config exists). Unpushed commits `b20174f`+`b97ab4d` untouched.

---

## 2. Provider-Adapter Architecture & Capability Matrix

**Architecture (interfaces in `providers/types.ts`; enforcement at `getZAI()`; status in `registry.ts`):**
```
pipelines/tools (UNCHANGED call sites: sdk-helpers, llm, ai_video, google_tts, edge_tts, music_engine)
   └─ getZAI() ── preflight ──► providers/sandbox-detect (zAiConfigured: .z-ai-config @ cwd|~|/etc)
        │ config present (sandbox)        │ config absent (Railway/anywhere)
        ▼                                ▼
   ZAI.create() + real calls      ProviderUnavailableError (honest, fallback-eligible)
                                        ▼
                          pipelines' existing honest fallbacks (labeled, never fake AI)

providers/registry.ts — capability matrix (data + preflight)  ← Phase 3 HF adapters register here
providers/types.ts    — Chat/Image/Asr/BengaliTts/Instrumental/Sung/Video/LipSync adapter contracts
```

**Capability matrix (code-enforced, `getCapabilityReports()`; statuses below are for sandbox-configured envs):**
| Capability | Provider today | Status | Portable | Sandbox-only | Phase 3 path |
|---|---|---|---|---|---|
| Chat + planning | z-ai SDK / **external GLM (user key)** | available (SDK) / available-with-key (GLM) | GLM ✓ | SDK yes | HF router chat |
| Image generation/edit | z-ai SDK | available | ✗ | yes | HF router text-to-image |
| Bengali TTS (speech) | Edge-neural → **Google-Translate fallback** | available (degraded: single voice, no SLA) | ✓ | no | retest Edge from Railway; HF has NO TTS |
| ASR | z-ai SDK | available (bn weak — honest) | ✗ | yes | HF router speech-to-text (Whisper-class — can lift bn validation ceiling) |
| Instrumental music | procedural engine v2 | available (honest `[PROCEDURAL_INSTRUMENTAL]`) | ✓ | no | — (works everywhere) |
| AI video (t2v/i2v) | z-ai CogVideoX-3 | available | ✗ | yes | HF router text-to-video (cost-capped probe first) |
| Image search | z-ai SDK + CLI | available | ✗ | yes | separate web-search provider (non-HF) |
| Vision analysis (VLM) | z-ai SDK | available | ✗ | yes | HF router chat-completion (VLM) |
| **Sung vocals / full song** | none | **unsupported** (BLOCKED) | — | — | owner-approved ACE-Step probe (~$0.02/run) + mandatory Bengali live verification |
| **Lip-sync** | none | **unsupported** (BLOCKED) | — | — | owner-approved hosted API (~$0.05–0.14/run) or GPU |

No HF capability is claimed anywhere — HF adapters arrive in Phase 3 only after budget-approved live probes (master-prompt rule honored).

---

## 3. Job Recovery Design & Test Evidence

**Design (B-D3, single-instance architecture per Phase 0 recommendation):**
1. **Stage transitions**: already durably persisted (ProductionStep rows: status/startedAt/finishedAt/error) — verified, unchanged.
2. **Boot recovery** (`recovery.ts`, eager-loaded via `instrumentation.ts`, 3 s delay, globalThis-guarded):
   - `status='queued' AND startedAt IS NULL` → **safe re-queue** (never-started contract: `runProduction` writes `startedAt` in the same update that sets `running`, so no generation call ever happened → duplicate billing impossible).
   - dead-process `running`/`validating`/`cancelling` → honest `failed` with actionable message (never "completed").
   - active in-memory ids excluded (dev-HMR safety, preserved from prior behavior).
3. **Queue dedupe**: `startProduction` rejects double-enqueue (requeue + confirm race).
4. **Graceful shutdown (SIGTERM)**: production Node-server only — marks in-flight jobs honestly failed + kills tracked ffmpeg children within Railway's ~30 s grace; boot sweep is the defense-in-depth backstop (guarded off in dev + bun-test processes after a real incident during verification — see §5).
5. **Worker split**: intentionally NOT done (Phase 2b option, needs owner decision + claim-transactions) — documented in `phase-1-remaining-railway-steps.md`.

**Test evidence (t28, 8 tests, all pass):** requeue-doesn't-touch-DB-status · dead-running→failed+message+finishedAt · validating/cancelling→failed · active-exclusion (both sets) · defensive queued+startedAt→failed · terminal/pre-confirm statuses untouched (old error preserved) · shutdown touches only running/validating + honest count · empty-list zero-DB-calls.

---

## 4. Database Migration Plan (documented, not executed)

`docs/audit/railway-hf-deployment/phase-1-database-migration-plan.md` (Task 1-c, evidence-based):
- **SQLite-usage audit: CLEAN** — `$queryRaw`/`$executeRaw`: **0** · `sqlite_*`: **0** · raw SQL: **0** · the only `PRAGMA` match is an HTTP header in `edge_tts.ts` (not SQLite). Provider swap = 1 schema line + client regeneration.
- **Correction to Phase 0**: schema has **10 models** (not 8 — Character + ModelEntry were missed); migration doc notes this explicitly.
- Dual-mode strategy (SQLite dev / PostgreSQL prod via `DATABASE_URL` scheme), `prisma migrate diff` baseline, small-volume data-carry script, additive-only rule, concurrency notes (guarded `updateMany` transitions are PG-safe; `confirm` route's unguarded `update` listed as worker-split precondition), storage plan (Volume → R2 behind the existing `storage.ts` interface), approval gates, rollback. **No schema/config changed in Phase 1** — local dev and tests run exactly as before.

---

## 5. CI Configuration & Test Results (commands actually run, exit codes recorded)

**`.github/workflows/ci.yml`** (push/PR/manual · concurrency-cancel · ubuntu-latest · 20 min timeout): checkout → setup-bun → **ffmpeg/ffprobe presence check** → `bun install --frozen-lockfile` → `bun run db:generate` → `bunx prisma validate` → `bun run typecheck` → `bun run lint` → `bun run test` → **`bun run build` (first-ever production build — runs LAST)** → upload standalone artifact. `scripts/prepare-standalone.mjs` audited: no sandbox assumptions (root from `import.meta.url`). YAML validated: `python3 yaml.safe_load` → **exit 0**.

**Test-infrastructure incident found & fixed (important):** bun runs several test files per process and `mock.module` leaks across files sharing a worker. The pre-existing suite (~20 files mock `llm`/`sdk-helpers`/`tts-cache`/`storage`/`db`) was green only under a lucky file order; adding any file reshuffled it → real failures (t0 received t19's tts-cache mock → `audio/wav` instead of `audio/mpeg`; t27 received an `llm` mock; t24 received `storage` mocks) and one timeout hang (SIGTERM-handler async work in a test process). **Root fix:** `bun test --isolate` (native flag — fresh globals per file, no cross-file leakage) wired into `"test"`. All my new test files are additionally mock-free or snapshot-restoring.

**Local verification (this sandbox):**
| Command | Exit | Result |
|---|---|---|
| `bun run typecheck` | **0** | 0 errors |
| `bun run lint` | **0** | 0 problems |
| `bun run test` (= `bun test tests --isolate`) | **0** | **306/306 pass, 0 fail** (266 pre-existing + 40 new), 2711 expects, 31 files, 196 s |
| `bunx prisma validate` | **0** | valid |
| `bun run build` | **NOT RUN** | Sandbox-forbidden (env rule) — **production build remains UNVERIFIED until CI runs on GitHub** (needs push approval). Known risk: `next/font/google` (Geist) downloads at build time — GitHub runners normally reach it; local-font fallback documented as Phase 2 option. |
| Browser check (agent-browser) | **PASS** | `/` renders (title ✓, security gate ✓), zero console errors, `/api/auth/status` → `{"initialized":false,"authenticated":false}` correct; dev server healthy in `dev.log`. |

---

## 6. FFmpeg & Runtime Requirements (documented)

`docs/audit/railway-hf-deployment/phase-1-ffmpeg-runtime-requirements.md` (Task 1-c):
- Full inventory from code: **libx264** (crf 20/21, yuv420p — 20 sites), **aac** (11), **libmp3lame 192k** (5), **pcm_s16le** (11); concat/segment/s16le/null muxers; **libass subtitles+force_style** (single burn site, film-helpers — drawtext: 0 uses); **vidstabdetect/vidstabtransform** (→ Debian ffmpeg build required, Alpine's would break `enhance_video stabilize`); loudnorm 2-pass/ebur128/astats/silencedetect/amix/adelay/afade/apad/alimiter/sidechaincompress et al.; lavfi sources; PNG/JPEG image2 input.
- Runtime image: `node:22-slim` + `apt-get install -y --no-install-recommends ffmpeg fonts-noto-core` (~51 MB) — **Noto Sans Bengali is missing even in this sandbox** (`fc-list :lang=bn` → FreeSans fallback): deployed image must add it and Phase 5 must include a human subtitle-rendering review.
- Reference versions (sandbox, tested-against): ffmpeg/ffprobe **7.1.5-0+deb13u1** (Debian 13), 27/27 required filters present. Smoke encode (testsrc+sine → libx264+aac mp4) → **exit 0**.

---

## 7. Remaining Railway Deployment Steps (Phase 2+, owner-gated)

`docs/audit/railway-hf-deployment/phase-1-remaining-railway-steps.md`: owner pre-requisites (rotate exposed HF token; decide push of 3 local commits; Railway Hobby) → Phase 2 (Dockerfile, railway.json + health check `/api/auth/status`, secrets `DATABASE_URL`/`STUDIO_OWNER_PASSCODE`/`STUDIO_SESSION_SECRET`, PostgreSQL provision + baseline migration, Volume at `/app/storage`, smoke checklist) → Phase 2b optional worker split (trigger: multi-minute jobs surviving redeploys; needs claim transactions + DB-backed SSE fallback) → Phase 3 HF wiring (fine-grained `HF_TOKEN` secret; router for chat/image/video/STT only; billing caps before probes) → Phase 4 capability probes → Phase 5 E2E on Railway URL → Phase 6 security acceptance + rollback rehearsal.

---

## 8. Security Findings & Remediation Status

| # | Finding | Status |
|---|---|---|
| S-1 | HF token pasted in chat (Phase 0) | ⛔ **OPEN — owner must rotate** (not used/stored by us) |
| S-2 | GitHub token embedded in local `.git/config` remote URL | Noted (sandbox artifact; not in Git history; recommend credential helper) |
| S-3 | Session secret only on ephemeral disk → sessions die on redeploy; owner-takeover risk if passcode unset | ✅ **MITIGATED**: `STUDIO_SESSION_SECRET` env support (env > file precedence); `STUDIO_OWNER_PASSCODE` documented as production-required in `env.ts` (startup warnings in prod) |
| S-4 | Sandbox SDK credential isolation | ✅ Verified: `/etc/.z-ai-config` is git-ignored, absent from GitHub repo, never read/logged by the new detection code (shape-only check) |
| S-5 | Hardcoded credentials in Phase 1 changes | ✅ None — `.env.example` placeholders only; tests use fake paths/values |
| S-6 | Cross-process test pollution class (mock.module leakage) | ✅ Fixed via `--isolate` (test-infra integrity is a security-adjacent guarantee: failures can't be masked by another file's mocks) |

---

## 9. Git Summary

- **Branch:** `main` @ `b97ab4d` — **ahead 2** of `origin/main` (`49d9b29`): unpushed `b20174f` (pre-Phase-1 work) + `b97ab4d` (Phase 0 report). **No commits made in Phase 1** (constraint honored).
- **Working tree:** 7 modified tracked files (+203/−26 excl. worklog) + 12 untracked paths (see §1). `git diff --check` clean (no whitespace errors).
- **Nothing pushed, merged, deployed, or paid.**

---

## 10. Verdict

## **PASS WITH BLOCKERS**

**Phase 1 scope: fully delivered and verified** — provider-adapter layer isolating sandbox auth (B-D1 mitigated at code level), job recovery + graceful shutdown (B-D3 substantially mitigated within the single-service architecture), CI with all gates + first-build path (B-D4 remediation ready), security hardening (B-D5), migration plans (B-D2 documented for Phase 2 approval), 40 new tests, suite 306/306 green, typecheck/lint/prisma-validate clean, live app browser-verified.

**Remaining blockers (by design, outside Phase 1's no-approval scope):**
1. **Production build still never executed** — sandbox-forbidden; first run happens in CI only after the owner approves a push.
2. **B-D2 (PostgreSQL + durable storage) awaits Phase 2 owner approval** (Railway account, DB provisioning, destructive-migration gate).
3. **Sung vocals + lip-sync remain unsupported** (unchanged, honestly gated) — owner budget decision.
4. **S-1: exposed HF token must be rotated by the owner.**

**Owner decisions requested:** ① commit + push Phase 1 (triggers first CI build), ② Phase 2 go-ahead (PostgreSQL + Dockerfile + deploy to staging), ③ budget caps for Phase 3/4 probes, ④ rotate the exposed HF token.

— END OF PHASE 1 REPORT —
