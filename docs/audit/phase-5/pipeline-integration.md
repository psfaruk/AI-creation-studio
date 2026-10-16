# Phase 5 — Pipeline Integration

Required flow (brief §1), mapped to the real architecture — **no parallel runner, no
bypass of confirm/§15**:

```
user request
 → Phase-4 intent classification (fast path — untouched)
 → Phase-4 card: settings + Phase-5 ShotPlanPreview (deterministic, budget-free)
 → user edits settings/plan (spec + cinematicOverrides) — live validate + plan-preview
 → POST /confirm (§15 merge + validateSpec rebuild incl. override sanitization)
 → queued → startProduction (exactly-once, 409 dupes — untouched)
 → pipeline planning step builds the validated plan (deterministic + LLM slot text)
 → plan validation against capabilities (per-shot delivery verdicts + downgrades)
 → per-shot generation through the existing generateAiShot/gate/cache path
 → existing timeline/assembly/audio-mix/artifact registration (untouched contracts)
 → truthful final report (resultJson.cinematicPlan + honest labels)
```

## 1. Spec wire contract (§15-safe)

`CreativeJobSpec.cinematicOverrides?: { shots: { index: number; size?: ShotSize;
movement?: PlanMovement }[] }` — music-video only. `validateSpec` parses and sanitizes
it explicitly (it rebuilds specs from a known-field whitelist — without this the
overrides would be silently dropped at confirm, exactly the REG-14l class of bug):
invalid enum values / out-of-range indices / oversized arrays are dropped; a dropped
entry produces an honest adjustment note. Client claims never bypass server validation.

## 2. Music-video pipeline (`visual_plan` step — restructured, same step key)

1. `selectCutSegments` (shared function, algorithm identical to Phase-4) from the
   **measured** beats of `song_input`.
2. `planMusicVideo(...)` → deterministic structure (sizes/subjects/movements/arc).
3. `applyOverrides(spec.cinematicOverrides)` (server-sanitized).
4. Capability mapping per shot (delivery verdicts; `cinematic_motion` downgrades for
   prompt-only movements, recorded as plan adjustments + partialNotes).
5. **The existing single LLM `chatJson` call** now fills slot descriptions: fixed slot
   count with per-slot size/subject/movement hints; LLM returns per-slot `description`
   (EN) / `label` (BN) + `visualStyle` + artist character. Same call count as Phase 4
   (no new round-trip). Failure/429 → deterministic per-slot fallback descriptions
   (planning step still can never die).
6. Plan persisted: `shot-plan.json` **text artifact** (`application/json`,
   `metaJson {pipeline, kind:'cinematic_plan', version, shots}`) — existing
   artifact conventions, **no DB migration**.
7. Per-shot generation: `generateAiShot({ prompt: buildCinematicVideoPrompt(shot, …),
   fallbackImagePrompt: buildCinematicImagePrompt(shot, …), fallbackMove:
   shot.fallbackMove, requestKey: 'mv-{id}-shot-{n}' … })` — the real adapter path;
   cache fingerprint = full request (prompt included) — plan changes ⇒ new keys.
8. Storyboard/fallback artifacts: `metaJson` gains `shotId`, `size`, `movement`,
   `delivery` (+ existing fields).
9. `final_qc`: final artifact `metaJson.cinematicPlan` + `resultJson.cinematicPlan`
   summary via `summarizePlan` — `{version, type, shotCount, totalPlannedSec, beatSource,
   deliveryCounts, limitations}` (counts/enums only — redaction-safer than a full shot
   array; the per-shot detail lives in the `shot-plan.json` artifact and per-shot
   artifacts). Honest engine labels unchanged; `lipSync: false` retained.

Timeline/beat-cut math, characters step, prewarm overlap, xfade rules, cancellation
checks, partial-shot handling: **unchanged**.

## 3. Short-film pipeline (`script_breakdown` step)

1. LLM #1 (scenes + characters) — kept as-is (it authors the story).
2. **LLM #2 (shot split) replaced** by `planShortFilmShots(scenes, …)` — deterministic
   coverage per scene purpose (establishing / action / dialogue OTS+reaction / detail /
   closing). One LLM round-trip saved per run (evidence in
   `quality-and-performance-evidence.md`).
3. `acting_plan` LLM #3 kept (acting text is slot content, not structure);
   `acting.cameraMotion` is now **explicitly planning-only** (documented; the plan's
   movement wins in prompts — the silent-defect D3 fix).
4. Per-shot prompts via `buildCinematicVideoPrompt` (acting text as `extra`); plan
   artifact + metadata identical to music-video.
5. `assignLinesAndDurations` dialogue fitting: untouched (measured TTS durations drive
   final durations; planner's targets feed it).

## 4. Pre-confirmation plan preview

`POST /api/productions/plan-preview` (owner auth; rate limit 20/min; body `{spec,
conversationId?}`; spec JSON ≤ 20 KB):

- `music_video`: resolves `songArtifactId` → artifact file → `mediaInfo` +
  `analyzeAudioEnergy` (local ffmpeg, budget-free) → **the real deterministic plan**
  (same `selectCutSegments`/`planMusicVideo` the pipeline runs). Analysis cached in a
  bounded in-memory LRU (artifactId + storedAt keyed; ≤ 8 entries) so repeated previews
  don't re-probe. Procedural → `bpm_grid_estimate` (beats estimated from tempo grid,
  honestly labeled); `none` → `silent`.
- `short_film`: deterministic structural skeleton + honest label (final scenes derive
  at runtime from the screenplay LLM).
- Response: `{plan, summary {shotCount, totalPlannedSec, beatSource,
  deliveryCounts, limitations[]}}`. No secrets, no provider calls, no generation.

## 5. UI (§7 of the brief)

`production-card.tsx` awaiting card gains `ShotPlanPreview` (inside the existing
PlanPreview area, collapsible — concise, expandable, not a huge form):

- ordered shot list: id, BN size label, movement label + delivery badge
  (`লোকাল ক্যামেরা-মোশন` / `প্রম্পট-নির্দেশিত`), target duration, cut-at (beat) info;
- totals, music-cut strategy + beat-source honesty (measured vs estimated vs fallback);
- actual output resolution/FPS/aspect (from the validated spec);
- provider limitations + fallbacks (incl. camera honesty, no singing/lip-sync);
- **music-video: per-shot size + movement selects** (whitelisted options) →
  `spec.cinematicOverrides` → live revalidation (existing validate route) + preview
  refresh; short-film: review-only skeleton (honest label why);
- historical timing only via the existing labeled ETA block; after confirm, real
  progress via the existing step list/SSE — no simulated percentages.

## 6. Metrics

`ProductionMetricsAcc` += `{planMs, plannedShots, planAdjustments}` (counts/enums only —
redaction policy intact); logged in the single `[production-metrics]` end line.
Planner duration is real-measured (`Date.now()` around the pure planner call —
microseconds-to-ms scale, no LLM inside).

## 7. Safety review of the integration

- No new shell execution, no new dependencies, **no schema migration** (plan rides
  artifacts + specJson + resultJson, all existing columns).
- Owner auth + rate limits on the new route; provider snapshot boundary rules respected
  (no error text crossing).
- Client plan edits are preferences only — the server recomputes structure, re-validates
  enums/indices, and re-maps capabilities at confirm and again inside the pipeline.
- Cancellation/retry/queue/concurrency/shot-cache/rate-limit ladder: untouched code
  paths (verified by inherited REG-2/3/4/7/10/11 staying green + new REG-18 cases).
