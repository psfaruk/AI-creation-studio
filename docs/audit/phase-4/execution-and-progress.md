# Phase 4 — Execution & Progress (Workstreams E+F)

## 1. Plan → execution states (all pre-existing machinery, now fully surfaced)

Production status machine (unchanged): `awaiting_confirmation → queued → running → validating → completed | failed | partial | cancelled` (+ `cancelling`). Phase 4 maps the prompt's plan states onto it and makes each visible in chat:

| Prompt state | Where it lives | UI |
|---|---|---|
| Plan generated | `createProduction` result → assistant message + `message.productionId` | card with settings summary + plan preview |
| Plan awaiting user confirmation | `awaiting_confirmation` | amber banner, editable panel, confirm/cancel |
| Plan rejected / cancelled | `cancelled` (via cancel route) | honest "বাতিল" view + "আবার চালান" (revise) |
| Production submitted | `queued` + `production_queued` event emitted **before** effective start (race-free for late SSE joiners) | status badge |
| Running / validating | `running`/`validating` | real step list + progress + provider status row |
| Completed / partially completed / failed | `completed`/`partial`/`failed` | honest engine badges, artifacts, revise chain |

Plan generation is never treated as completion: zero generation work starts before confirm (the panel fetch/validation are lightweight, non-billable reads; `createProduction` writes only an `awaiting_confirmation` row).

## 2. Confirmation → real execution (no parallel path)

Confirm button → existing `POST /api/productions/[id]/confirm` → owner + rate limit + daily quota → status must be `awaiting_confirmation` (else **409**) → merge overrides → **REAL `validateSpec` revalidation** (§15 — adjusted values persisted, e.g. 60fps→30, 999s→clamp) → `queued` → `production_queued` event → existing `startProduction` → the real registered pipelines (`pipelines/{image,audio,motion_video,music_video,short_film}.ts`) → real step rows → artifacts registered through the existing `saveArtifactFile`/`Artifact` mechanisms → SSE events with DB replay.

## 3. Truthful progress

- Progress = real server events (step rows + bus), never a fake timer; percentages come from the runner's real step accounting; where a reliable percentage doesn't exist the card shows stage-based progress (step list), per the existing design.
- The plan preview lists exactly the steps the pipeline will run (`plannedStepsFor`); "do not emit a stage that is not running" is inherited from the runner's honest step model (Phase-0/1 audited).
- Events stay run-correlated (`productionId` on every event; SSE route replays by id).
- Phase-2 active-run reconnection + Phase-3 stage metrics/shot-cache preserved untouched (REG-2/4/7/10/11 still green).

## 4. Duplicate-run & refresh protections (criteria G+H)

1. Chat-level: one `running` AgentRun per conversation → 409 + `activeRunId` (REG-3, unchanged).
2. Production-level: confirm only from `awaiting_confirmation` → second click/refresh-retry gets 409; `startProduction` called exactly once (REG-14h/j).
3. Client-level: `isConfirming` busy-state disables the button; after refresh the card re-fetches (`ensureFetched`) + re-subscribes (SSE) — no second submission path exists.
4. Cancel: awaiting/queued → `cancelled` immediately; running/validating → `cancelling` honored by the runner between steps (pre-existing).

## 5. Errors

Failures surface truthfully: step-level errors in the step list; run-level errors with honest category labels; the rate-limit fallback now also gives an honest **unsupported** final answer (instead of a misleading 429 message) when the request itself asks for a blocked capability. No fake success anywhere; partial productions display as `partial` with per-shot honesty (Phase-0–3 behavior, preserved).

## 6. Verification status

Confirm/cancel/validate flows are route-level tested with the real handlers (REG-14h–k). The full orchestrator loop with a live LLM and a live production run is NOT RUN (budget) — the loop itself was never directly tested in prior phases either (documented in tests/README caveats); its new fast-path block is covered at the composition seam (REG-12q: classification → draft → real `createProduction` → `awaiting_confirmation`) and the fallback path preserves its existing tested behavior surface.
