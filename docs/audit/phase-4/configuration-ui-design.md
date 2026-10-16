# Phase 4 — Configuration UI Design & Results (Workstream C)

## 1. What existed before

`ProductionCard` (embedded in chat via `message.productionId` → `message-bubble.tsx:260`) already rendered an awaiting-confirmation card with an editable `SpecEditor` (quality/language/engine/filmMode/mood/aspect/duration/voice + advanced fps/resolution/tempo/genre/style/format/overlayText/subtitles), confirm with busy-state guard, cancel, revise, and server revalidation at confirm. Gaps: option lists hand-mirrored server constants (drift risk), no field-level validation display, no capability-constraint display, no source-audio picker, no plan preview.

## 2. What Phase 4 added

### 2.1 Server-owned panel schema (single source of truth)

`src/lib/agent/config-panel.ts` — `buildConfigPanel(type, spec?)` derives every option/limit/label **directly from `capabilities.ts` constants** (`DURATION_LIMITS`, `SUPPORTED_FPS`, `SUPPORTED_ASPECTS`, `SUPPORTED_LANGUAGES`, `SUPPORTED_MOODS`, `maxShots`, `plannedStepsFor`): field list per category (not every field for every type), options with disabled+reason, min/max, hints, required/optional, advanced grouping, honest `limitations` per type, planned steps, and engine-aware `estimatedShots`. Pure module — the client imports it type-safely (no DB/SDK in the graph).

`GET /api/productions/config-panel?type=&conversationId=` (owner-gated, 30/min rate limit): returns the schema; for music_video also `sourceOptions.songs` — the conversation's uploaded audio as **id + fileName only** (no URLs/paths/secrets).

### 2.2 Panel upgrades in `production-card.tsx` (extend, not rewrite)

- **Song selector (C1)** — music_video "গানের উৎস": procedural instrumental (honest note) or any uploaded song → writes `songArtifactId` + `musicSource` + `sound` consistently. Empty-state honestly tells the user to upload a song in chat.
- **Disabled-with-reason options (C6/D)** — FPS list now includes "৬০ — অসমর্থিত" (disabled, title explains: pipeline renders 24/25/30); resolution includes "৪K — অসমর্থিত" (max 1080p). Unsupported modes are visible and explained, never silently promised or hidden.
- **Field-level validation (C6)** — `useConfigPanel` fetches the schema (cached per type+conversation); `validateFieldsAgainstSchema` gives instant client-side checks (required missing, disabled option selected, out-of-range duration, unknown values; in-range custom durations like 45s are valid); errors render as a labeled summary in the editor plus inline under the song selector. The debounced (700 ms) **live server validation** (`useSpecValidation` → `POST /api/productions/validate`) surfaces a verdict badge + adjustments + notes; confirm is disabled when the verdict is `unsupported` (the server would 422/adjust anyway — the panel just says it earlier).
- **Plan preview (C1/Workstream E)** — collapsible block on the awaiting card: what will be made, the real pipeline steps ("নিশ্চিত করলে এই ধাপগুলোই চলবে"), estimated shot count with engine honesty (2–4 AI shots, each ~2–4 min; or storyboard engine), audio strategy (uploaded song name / procedural score / dialogue+subtitles+sound design / TTS+ASR), output settings, known limitations (no lip-sync, procedural ≠ neural singing, bn-BD voices), and the ETA now explicitly labeled "ঐতিহাসিক অনুমান — প্রকৃত সময় ভিন্ন হতে পারে". No cost estimates (no pricing data exists — none shown).
- **Category-specific panels (C1–C5)** — music_video: song source + mood + engine + aspect + duration + language + advanced fps/resolution/style; short_film: filmMode + subtitles + engine + aspect + duration + language + sound; image: aspect + format + overlayText; audio: operation (voiceover/instrumental) + language + duration + mood/tempo/text; motion_video: engine + aspect + duration + language + sound + advanced. Small requests never see a full-screen form — the card stays inline in chat, mobile-friendly (grid `grid-cols-2 sm:grid-cols-3`, ≥44px touch targets on confirm/cancel).
- **Shared panel behavior (C6)** — settings preserved while editing (local `editedSpec`), required vs optional distinguished (required get explicit "আবশ্যক" errors; optional shown as "স্বয়ংক্রিয়"/placeholders), duplicate submission guarded (`isConfirming` busy-state + server 409), conversation identity preserved (production row stays linked), all existing shadcn/ui components (Select/Switch/Input/Textarea/Collapsible/Badge/Button/Progress), a11y labels on every control, honest amber notes for engine/procedural score retained.

### 2.3 What is intentionally NOT in the panel

Lip-sync preference (model doesn't exist — stated as a limitation instead), singing mode (blocked tool — honest unsupported at classification/validation), 60fps/4K (disabled with reasons), arbitrary durations (range-checked), output-format beyond the pipeline's real outputs. Number of outputs for image production is not offered (the pipeline produces one final image — no multi-output capability exists to promise).

## 3. Verification status

- Schema/validation/panel logic: fully covered by hermetic tests (REG-13/14) — schema fields, defaults passing the REAL validateSpec, disabled options, field errors, route contracts, duplicate protection.
- Component rendering itself: typechecked + lint-clean; **browser E2E NOT RUN** (no DOM harness in this suite — same honest limitation as Phase 1–3, recorded in `test-results.md`).
