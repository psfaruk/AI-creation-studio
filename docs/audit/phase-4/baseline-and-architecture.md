# Phase 4 — Baseline & Architecture Audit (Workstream A)

**Phase**: Intent-Aware Creative Planning, Capability-Aware Configuration, Chat-Native Tools UI
**Baseline commit**: `8ce272c61f175ee8fe0e432e752f40ea6af366a9` — `feat: improve media quality and shot reuse`
(`= origin/main = remote HEAD`, worktree clean at audit start; verified via `git status`, `git rev-parse`, `git ls-remote`.)

## 1. Baseline & environment

- All four Phase-0..3 check suites were green at this baseline (75/75 tests, typecheck 0, lint 0, `prisma validate` 0 — re-verified during the Phase-3 pre-commit audit).
- Phase-3 features present and must be preserved: TTS voice fallback chain (`language_controller.ts` / `pipelines/voiceover.ts`), final-mix loudness normalization (`sound_design.ts` / `ffmpeg.ts`), shot cache (`video/shot_cache.ts`), stage metrics + redaction (`run-metrics.ts`), active-run re-attach (REG-2/4/7), duplicate-run 409 guard (REG-3).
- No provider budget spent in Phase 4; no live provider calls. No DB schema changes required (verified: `AgentStep.kind` is a free-form string, so new step kinds need no migration).

## 2. Chat flow & conversation state

| Concern | Location |
|---|---|
| Chat POST route | `src/app/api/chat/route.ts` — `POST { content, conversationId?, model?, mode?, attachments[] }` → `{ runId, conversationId, userMessage }`. Owner session (`requireOwner`), rate limit, 8000-char cap, ≤4 attachments (base64 → `saveArtifactFile` → `Artifact` rows, `origin:'user_upload'`, linked to the user message). |
| Duplicate-run guard (Phase 2, REG-3) | Same file, lines ~154–172: any `running` AgentRun in the conversation → **409 + `activeRunId`** *before* the user message is created. |
| Run launch | `startAgentRun(run.id)` fire-and-forget (`src/lib/agent/orchestrator.ts`). |
| AgentRun statuses | `running | completed | failed | interrupted` (`src/lib/types.ts:340`). |
| Run SSE | `GET /api/runs/[id]/events` — replay from DB + live bus (`src/lib/agent/events.ts` `emit`), ping, dedupe. |
| Client run state | `src/hooks/use-agent-run.ts` (584 lines) — SSE wiring, pending bubble, `text_delta` streaming, rate-limit banner; re-attach via `src/hooks/active-run-persistence.ts` (REG-7, React-free, localStorage). |
| Messages | Prisma `Message` (`role/content/attachmentsJson/productionId?`); `ChatMessage` view built by `buildMessageView` (`src/lib/agent/serialize.ts`, `productionId` at line 96). Assistant messages carrying `productionId` render an embedded `ProductionCard` (`src/components/chat/message-bubble.tsx:260`). |

## 3. LLM orchestration & intent routing (current state)

`src/lib/agent/orchestrator.ts` (1602 lines):

- Agent loop: `runAgentLoop` — max 12 steps, 10-minute time guard, history window 20, tool-call repeat guard, `[TOOL_RESULT]` protocol, malformed-JSON recovery, forced wrap-up. LLM responses parsed by `parseToolCall` (`src/lib/agent/llm.ts:401` — JSON candidates: trimmed / fenced / first-`{`…last-`}`).
- **Existing intent detection is a FALLBACK ONLY**: `detectProductionIntent(message)` (line 474) — regex patterns for 6 shapes (music_video, image, instrumental, sung-song→honest instrumental alternative, short_film, motion_video). Used **only** by `tryIntentFallback` (line 610) when the chat LLM is rate-limit-exhausted (429 windows past retry budget). Cloud-block awareness (`isChannelBlocked`) switches to `cinematic_motion`.
- `propose_job` success → `proposedProductionId` captured (line ~1225) → attached to the final assistant message by `finalizeRun` → in-chat card.
- Chat-only mode (`chat_only`) and diagnostic mode exist (`requestedMode`).
- Attachment pre-steps: image→`analyze_image`, audio→`transcribe_audio` before the loop (lines ~866–910).

**Gap (Phase 4 Workstream B)**: there is no first-class classification layer, no normalized intent object, no category set beyond the 6 fallback shapes, no clarification flow, no classification metrics, and routing quality depends entirely on LLM prompt-following (or on the LLM being dead).

## 4. Tool registry & schemas

- `src/lib/agent/registry.ts` — `TOOLS` = 8 core (`web_search`, `read_web_page`, `generate_image`, `search_images`, `analyze_image`, `text_to_speech`, `transcribe_audio`, `search_conversations`) + domain tools. `validateToolCall` (line 464): unknown tool / zod failure → structured error, never a throw. `toolParityReport` guards TOOLS ↔ `TOOL_CATALOG` drift.
- Domain tools (`src/lib/agent/tools/`): image (11: `edit_image`, `inpaint_image`, `remove_background`, `remove_object`, `restyle_image`, `enhance_image`, `color_grade_image`, `transform_image`, `compose_text_image`, `export_image`, `inspect_image`), audio (10: `plan_music`, `speech_synthesis`, `analyze_audio`, `generate_instrumental`, `generate_singing` (honest-blocked), `separate_stems` (honest-blocked), `process_audio`, `mix_audio`, `validate_audio`, `inspect_media`), video (10: `plan_video`, `generate_video`, `animate_image`, `process_video`, `enhance_video`, `interpolate_video`, `generate_subtitles`, `validate_video`, `image_to_video`, `lip_sync` (honest-blocked)), production (`propose_job`, `create_character`).
- `propose_job` (`tools/production.ts:25`) → `createProduction(spec, conversationId)` (shared path) → returns `productionId, status:'awaiting_confirmation', summary, adjustments, notes, steps, instruction`.
- Tool execution: `executeToolCall` — ToolCall row + AgentStep + `tool_start/tool_end` events + timeout.

## 5. Capability registry & validation (current state)

- `src/lib/agent/capabilities.ts` — **the single authoritative validator**: `validateSpec(raw)` → `{ ok, validated?: { spec, adjustments, notes, plannedSteps }, errors, alternatives }`. Constants: `DURATION_LIMITS` (image 0 / audio 5–300 / motion 5–20 / music_video 15–180 / short_film 30–120), `SUPPORTED_FPS = [24,25,30]`, `SUPPORTED_RESOLUTIONS = ['720p','1080p']`, `SUPPORTED_ASPECTS`, `SUPPORTED_LANGUAGES = ['bn','en']`, `SUPPORTED_MOODS`, `maxShots(type, quality, engine)`, `plannedStepsFor(type)`, `summarizeSpec(spec)`. Honest notes (no lip-sync, procedural instrumental ≠ neural singing, 4K→1080p adjustment, 60fps→30).
- `src/lib/agent/production/create.ts` — `createProduction`: validateSpec → language propagation from last user message → auto-wire uploads (music_video song / image source / motion_video source image) → `Production` row `status:'awaiting_confirmation'`.
- `src/lib/agent/video/capability_router.ts`, `availability-matrix.ts`, `model-registry-data.ts`, `hardware-gate.ts`, `chat-models.ts` — provider/model inventories (availability matrix API `/api/availability`).

**Gap (Workstream D)**: `validateSpec` is spec-shaped, not *panel*-shaped — there is no category-specific configuration schema API (field definitions, options, limits, disabled-with-reason options) and no structured capability verdict (`supported | supported_with_limitations | requires_clarification | unsupported | temporarily_unavailable`) for a *proposed* configuration before a production row exists.

## 6. Production lifecycle, APIs, events

- Status machine (`types.ts:611`): `awaiting_confirmation → queued → running → validating → completed | failed | partial | cancelled` (+ `cancelling`).
- Routes (`src/app/api/productions/`): `GET` list (+stale sweep) / `POST` create (S9 direct create, shared path, quota+ratelimit) / `[id]` GET view / **`[id]/confirm`** POST (rate limit + daily quota + status must be `awaiting_confirmation` else 409 + merges spec overrides + **re-validates server-side (§15)** → 422 on failure → `queued` + `production_queued` event + `startProduction`) / **`[id]/cancel`** POST (awaiting/queued→cancelled; running/validating→cancelling, runner honors it) / **`[id]/revise`** POST (new `awaiting_confirmation` child with `parentProductionId`) / **`[id]/events`** GET SSE (DB replay → live bus → ping + DB diff-poll + provider status ticks; bounded 1h).
- Runner: `src/lib/agent/production/runner.ts` — `startProduction`, step model (`ProductionStep` rows), `emitProduction` bus, cancellation checks, stale sweep, Phase-3 stage metrics on success+fail paths.
- Pipelines: `pipelines/{image,audio,motion_video,music_video,short_film}.ts` + `index.ts` registry; `voiceover.ts` (Phase-3 A shared TTS chain).

## 7. Chat UI & configuration UI (current state)

- Chat: `message-bubble.tsx` (markdown + attachments + activities + artifacts + `message.productionId` → **`ProductionCard` embedded in chat**), `composer.tsx` (mode/model selector, uploads), `activity-card.tsx` (tool lifecycle), `artifact-view.tsx`.
- `ProductionCard` (`src/components/studio/production-card.tsx`, 1200 lines): status badges, **awaiting_confirmation amber banner with editable `SpecEditor` + "✓ চালু করুন"/cancel** (confirm sends `editedSpec` overrides; `isConfirming` busy-state guards double-clicks; server re-validates), running view (steps + progress + provider status row), done view (honest engine badges, artifacts, revise/re-run). `SpecEditor` is already category-aware (quality/language/engine/filmMode/mood/aspect/duration/voice + advanced: fps/resolution/tempo/genre/style/format/overlayText/subtitles) with option lists mirroring `capabilities.ts` by hand.
- Studio: `quick-create.tsx` (S9 direct create → same card), `productions-view.tsx`, `registry-view.tsx`, `availability-badges.tsx`.
- Client store: `src/hooks/use-productions.ts` (zustand; `confirmProduction/cancelProduction/reviseProduction`; SSE subscribe with reconnect backoff; polling fallback).
- shadcn/ui components available: badge, button, collapsible, input, label, progress, select, switch, textarea, dialog, etc.

**Gaps (Workstream C)**: option lists in `SpecEditor` are hand-mirrored (drift risk vs `capabilities.ts`); no field-level validation errors in-panel; no capability-constraint display per field; no source-audio selection UI (song auto-wire is invisible); no plan-preview section (workflow/steps/audio strategy/limitations/shot estimate) on the awaiting card; no server schema contract for the panel.

## 8. Tests & conventions

- `bun test tests` (`package.json` `"test"`); 75 tests across 12 files (t1–t11), all hermetic: `mock.module('@/lib/db', …)` with `tests/helpers/fake-db.ts`, real route handlers imported after mocks (`t3` pattern), React-free client-logic tests with fake localStorage (`t7` pattern), no DOM harness → browser E2E consistently reported NOT RUN/BLOCKED.
- Required commands: `bun run test`, `bun run typecheck`, `bun run lint`, `bunx prisma validate`, `git diff --check`.

## 9. What exists vs. what Phase 4 adds

**Exists (extend, do not duplicate):** confirmation lifecycle + in-chat card + editable spec + server revalidation + cancel/revise; `validateSpec` single source of truth; production SSE + replay + reconnection; duplicate-run 409; auto-wire uploads; honest engine/limitation labels; stage metrics + redaction; shot cache; rate-limit fallback intent detection.

**Phase 4 adds:**
1. **Workstream B** — first-class deterministic intent classifier (12 categories incl. image_edit/image_search/video_edit/speech_or_voiceover/unsupported_or_ambiguous), normalized intent object (category, confidence, requested output/input assets, constraints, missing fields, proposed workflow, capability verdict), used (a) as a fast path for clear big-work requests (no LLM round-trip, honestly labeled), (b) as an LLM context hint + clarification guidance, (c) as the upgraded rate-limit fallback, (d) as an AgentStep + metrics for observability. Classification strictly separate from execution; execution still only via the existing `createProduction` → confirm → runner path.
2. **Workstream C/D** — server-owned configuration-schema contract (`GET /api/productions/config-panel`) derived from `capabilities.ts` (single source of truth) + live validation endpoint (`POST /api/productions/validate`) returning a structured capability verdict; panel upgraded to consume the schema (field options, limits, disabled-with-reason, source-audio picker from conversation uploads, field-level validation errors), plan-preview section on the awaiting card.
3. **Workstream E/F** — plan states surfaced on the card (plan generated → awaiting → cancelled → queued → running → completed/partial/failed — statuses already exist; add plan summary + estimated shots + audio strategy + historical ETA labeling); execution wiring unchanged (real runner, real artifacts, no duplicate runs).

## 10. Known constraints & unresolved questions

- No DOM test harness exists → component-level browser verification will be NOT RUN (consistent with prior phases); panel logic extracted into pure modules for hermetic tests.
- No structured-output/JSON mode in the chat LLM integration beyond the existing JSON tool-call protocol → the classifier stays deterministic (model-assisted classification is out of scope; the LLM's `propose_job` remains a *proposal* validated by `validateSpec`).
- `voice`/`fps`/`resolution` option lists in the card are hand-mirrored; the new schema endpoint removes the drift by importing server constants.
- Historical latency evidence for ETA labeling: Phase-1 measured generate_shots 1,079.7s of 1,436s total; loudnorm ≈0.8s/mix (Phase-3). ETAs shown as historical estimates only.
- Bengali singing / lip-sync / stem separation remain honestly unsupported (`generate_singing`, `lip_sync`, `separate_stems` are hard-blocked tools) — the classifier must route these to `unsupported_or_ambiguous` with the honest alternative, never to a production that fakes them.
