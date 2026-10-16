# Phase 0 — Repository Inventory (Work Package A)

## 1. Package identity

- `name: nextjs_tailwind_shadcn_ts`, `version 0.2.1`, `private`.
- Framework: **Next.js ^16.1.1 (App Router)**, **React 19**, **TypeScript ^5** — matches the non-negotiable stack.
- Package manager: **Bun** (`bun.lock` present). No `package-lock.json`/`yarn.lock`.

## 2. Scripts (`package.json`)

| Script | Command | Notes |
|---|---|---|
| `dev` | `next dev -p 3000 2>&1 \| tee dev.log` | Port 3000 fixed; logs to `dev.log` |
| `build` | `next build && node scripts/prepare-standalone.mjs` | Not run in Phase 0 (dev-only sandbox) |
| `start` | `node .next/standalone/server.js` | Standalone server |
| `lint` | `eslint .` | Exit 0 at audit time |
| `typecheck` | `tsc --noEmit` | Exit 0 at audit time |
| `db:push` | `prisma db push` | Safe default (no data loss) |
| `db:push:force` | `prisma db push --accept-data-loss` | Destructive — exists but never run in this audit |
| `db:generate` / `db:migrate` / `db:reset` | prisma generate / migrate dev / migrate reset | `migrate`/`reset` unused (no migrations dir) |

**No test script, no test framework** — regression testing in Phase 1 must add one (recommendation in exit report).

## 3. Dependency inventory (key items; full list in `package.json`)

- **LLM/AI:** `z-ai-web-dev-sdk ^0.0.18` (SDK chat/video/image/TTS/ASR), `openai ^7.32.0` (external GLM providers via real OpenAI SDK).
- **DB:** `prisma ^6.11.1` + `@prisma/client ^6.11.1` (SQLite).
- **Media:** `sharp ^0.34.3` (image processing). FFmpeg is an **external binary**, not a package.
- **UI:** Radix UI suite (30+ `@radix-ui/react-*`), `lucide-react`, `framer-motion`, `sonner`, `react-markdown` + `remark-gfm` + `react-syntax-highlighter`, `embla-carousel-react`, `@dnd-kit/*`, `recharts`, `cmdk`, `vaul`.
- **State/data:** `zustand ^5`, `@tanstack/react-query ^5`, `@tanstack/react-table ^8`.
- **Forms/validation:** `react-hook-form`, `@hookform/resolvers`, `zod ^4`.
- **Auth:** `next-auth ^4.24.11` (present; the app actually uses its own owner-passcode gate — see §5).
- **Misc:** `next-intl`, `next-themes`, `date-fns`, `uuid`, `ws` + `@types/ws` (websocket examples only), `@mdxeditor/editor`.

## 4. Prisma models (`prisma/schema.prisma`)

| Model | Purpose / notable fields |
|---|---|
| `Conversation` | Chat thread; Bengali default title |
| `Message` | role/content, `runId?` (1:1 assistant↔run), `productionId?`, `attachmentsJson?` |
| `AgentRun` | status, `errorCategory` (13-value taxonomy), `endReason`, `cacheStatus`, `requestedMode`, `firstTokenMs`, `model`/`usedModel`, step/tool counts, timings |
| `AgentStep` | seq, kind (`llm_decision`/`tool_execution`/`final_answer` + internal kinds `repeat-blocked`, `max_elapsed`, `run_note`…), payloadJson |
| `ToolCall` | tool, argsJson, Bengali `inputSummary`/`outputSummary`, status, resultJson, durationMs |
| `Artifact` | kind (image/audio/video/text), origin (`tool`/`user_upload`/`production`), storagePath/sourceUrl, metaJson (media metadata) |
| `Production` | type (image/audio/motion_video/music_video/short_film), status lifecycle (awaiting_confirmation→queued→running→validating→completed/failed/partial/cancelled/cancelling), specJson, progress 0–100, revision chain via `parentProductionId` |
| `ProductionStep` | seq, key, Bengali title, status (pending/running/done/failed/skipped), detail, error, timings |
| `Character` | character bible: per-conversation unique name, appearance, voice, portraitArtifactId, continuityNotes |
| `ModelEntry` | model/license registry with 4 status dimensions + quality status |

SQLite constraint noted: all lists (e.g. `attachmentsJson`, `metaJson`, `specJson`) are stored as JSON strings — no primitive-list fields (complies with project rule).

## 5. Application surface (single user-visible route)

- `/` (`src/app/page.tsx`) → `SecurityGate` (owner passcode, installs global fetch wrapper adding `x-studio-token`) → `StudioHome` with six client-side views (chat / studio / gallery / productions / registry / guide) switched by zustand state — no URL routing.
- **API routes** (all `requireOwner`-gated except auth/setup):
  - Chat: `POST /api/chat`; run SSE `GET /api/runs/[id]/events` (DB replay + 1.5 s diff-poll + live bus, deduped).
  - Conversations: `/api/conversations`, `/api/conversations/[id]`.
  - Productions: `POST/GET /api/productions`; `[id]`, `[id]/confirm` (409 unless awaiting; 422 on invalid merged spec; emits `production_queued` before start), `[id]/cancel` (immediate or cooperative `cancelling`), `[id]/events` (SSE, 3-phase: DB replay → live bus → 2.5 s diff-poll, 1 h cap), `[id]/revise` (new row, never auto-start).
  - Artifacts: `/api/artifacts/[id]` (meta) and `/api/artifacts/[id]/file` (stream, `?st=` token for media tags, 302 for external URLs).
  - Config: `/api/provider-keys` (key + Base URL overrides; 20 writes/h), `/api/platform-key` (app's own `amai_sk_` key CRUD), `/api/models` (+ verify), `/api/tools`, `/api/availability`, `/api/system`, `/api/hardware`, `/api/benchmark/tts`.
  - OpenAI-compatible: `GET /api/v1/models`, `POST /api/v1/chat/completions` (stream + non-stream; Bearer = platform key or owner session).
  - Auth: `/api/auth/{setup,status,lock,unlock}`.

## 6. Core library map (`src/lib/`)

| Path | Role |
|---|---|
| `agent/orchestrator.ts` (1552 L) | Agent loop: MAX_STEPS 12, 10-min watchdog, repeat-guard, [TOOL_RESULT] protocol + echo guard, intent fallback, firstToken recorder, error taxonomy |
| `agent/llm.ts` | chatComplete: disk cache (12 h), SDK streaming, external routing, tolerant JSON tool parser |
| `agent/external-llm.ts` | GLM-only external providers via real OpenAI SDK; Base URL override; 429 retry (3 s→6 s ×2, jitter, onWait); fatal 4xx mapping |
| `agent/retry.ts` + `rate-limit-coordinator.ts` | Full-jitter backoff, channel cooldown, total wait budget, Retry-After parsing |
| `agent/registry.ts` + `tools/{image,audio,video,production}.ts` | 42 tools with zod validation + Bengali summaries |
| `agent/production/{create,runner,bus,serialize,pipelines/*}.ts` | Production lifecycle: concurrency 2, step timeouts (fail-soft), cancellation (ffmpeg SIGKILL registry), stale sweeps (20 min std / 60 min AI-video), boot sweep |
| `agent/audio/music_engine.ts` (1252 L) | Procedural instrumental engine (Karplus-Strong, motif melody, Freeverb, 44.1 kHz stereo PCM16) — purely local, no network |
| `agent/audio/{language_controller,edge_tts}.ts` | bn/en voice profiles (Edge bn-BD neural primary, z-ai fallback), ASR back-check verification |
| `agent/video/ai_video.ts` | CogVideoX-3 single-task gate: 429 ladder [15,30,60,90,120] s, 150 s cooldown, 10→45 s adaptive poll, 15-min poll timeout, 8-min submit budget, request-id idempotency, prewarm |
| `agent/video/{capability_router, lip_sync_module}.ts` | Dormant router (zero importers); lip-sync = honest-failure tool only |
| `media/ffmpeg.ts` | runFfmpeg (tracked/killed on cancel), ffprobe JSON, audioQuality (astats/silencedetect/ebur128), SRT builder |
| `security.ts` | Owner gate: header-token path (proxy-safe) + cookie path with Origin/XFH CSRF check; rate limits |

## 7. Front-end map (`src/hooks`, `src/components`)

- Hooks: `use-agent-run` (chat SSE + manual reconnect 2→30 s ×5, typewriter drain, polling fallback w/ 180 s guard), `use-productions` (production SSE + 2.5 s poll + retry backoff), `use-chat-store`, `use-conversations`, `use-availability`, `use-tools`, `use-system`, `use-hardware`, `use-benchmark`, `use-ui-view`.
- Chat components: `message-bubble` (activities, artifacts, run stats incl. firstTokenMs, failure chip w/ retry), `activity-card` (7 statuses + defensive fallback + live elapsed), `composer` (attachments ≤4, mode/model selectors), `model-selector`, `provider-key-dialog` (API key + Base URL + platform key UI).
- Studio components: `production-card` (SpecEditor incl. resolution/tempo/genre/style + advanced-settings collapsible, cancel/revise, elapsed on failure), `quick-create` (4 paths), `productions-view`, `gallery-view`, `registry-view`, `guide-view`, `studio-view`, `availability-badges`.

## 8. Observability & ops artifacts

- `worklog.md` — running multi-agent work journal (this audit appended as Task P0-…).
- `dev.log` — dev-server request log (clean at audit time).
- In-app: run stats line (steps/tools/duration/firstTokenMs), provider status row for video productions, cache hit/miss counters (`llmCacheStats`), ai-video gate stats (`submits/completions/failures/generationMsSamples`).
