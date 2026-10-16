# Phase 5 — Cinematic Shot-Plan Design

## 1. Data contract (typed, versioned, validated)

Module: `src/lib/agent/cinematic/types.ts` — `SHOT_PLAN_VERSION = 1`.
Runtime validation: `src/lib/agent/cinematic/validate.ts` (`parseAndValidateShotPlan`).
Adapted to existing conventions: plan lives inside the production (artifact + step
metadata + `resultJson`), shots carry the existing `CameraMove` fallback for KenBurns
paths, and the music-video shot list stays compatible with the timeline cut math.

### Enums

```ts
type ShotSize = 'establishing_wide' | 'wide' | 'medium' | 'close_up'
              | 'extreme_close_up' | 'over_the_shoulder' | 'insert' | 'reaction';
type CameraAngle = 'eye_level' | 'high_angle' | 'low_angle' | 'overhead';
type PlanMovement =
  | 'static' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'   // local-capable
  | 'dolly_tracking' | 'handheld' | 'orbit';                        // prompt-guided only
type ShotSubject = 'environment' | 'artist_performance' | 'scene' | 'detail' | 'reaction';
type MovementDelivery = 'local_motion' | 'prompt_guided' | 'downgraded_to_local';
```

Compat mapping with the Phase-≤4 vocabulary (`MvShotType`):
`establishing → establishing_wide`, `wide → wide`, `close_up → close_up`,
`performance → (subject:'artist_performance', size varies by arc slot)`.

### Plan shape

```ts
interface CinematicPlan {
  version: 1;
  type: 'music_video' | 'short_film';
  /** honest provenance of cut timing */
  beatSource: 'measured' | 'bpm_grid_estimate' | 'duration_fallback' | 'silent' | 'narrative';
  totalPlannedSec: number;
  visualStyle?: string;
  scenes: CinematicScene[];   // stable ids SC1..; purpose + narrative beat
  shots: CinematicShot[];     // stable ids S01..; order = array order
  adjustments: PlanAdjustment[]; // every downgrade/override, with reason
}
interface CinematicScene {
  sceneId: string; purpose: string; narrativeBeat: string;
  environment: string; lightingMood: string; transitionIntent?: string;
}
interface CinematicShot {
  shotId: string; sceneId: string; order: number;
  subject: ShotSubject; size: ShotSize; angle: CameraAngle; movement: PlanMovement;
  /** deterministic KenBurns-compatible move (also the AI-fallback frame move) */
  fallbackMove: CameraMove;
  delivery: MovementDelivery;      // capability verdict for the movement
  actionEn: string;                // visible action — generation-affecting
  compositionEn?: string;          // framing/subject placement — generation-affecting
  lightingMood?: string;           // generation-affecting
  labelBn: string;                 // human label (planning/UI)
  startSec?: number; endSec?: number; targetDurationSec: number; // music-video beats
  character?: string | null;       // artist/character reference when available
  continuityNote?: string;         // planning-only
  transitionIn?: string;           // planning-only
}
```

**Field discipline (§3 of the brief):** every field is either
(a) generation-affecting — `actionEn`, `size`, `angle`, `movement` always flow into the
provider prompt via the cinematic prompt builder; `lightingMood` is deterministically
populated per section energy (MV) / scene time-of-day (SF) and flows into the prompt;
`compositionEn` is an optional passthrough the prompt builder consumes when present
(planners do not populate it — the framing phrase already carries composition; it stays
as a future LLM/override channel) — or
(b) explicitly planning-only — `labelBn`, `continuityNote`, `transitionIn`,
`narrativeBeat`, `beatSource`, scene-level `environment`/`lightingMood` (scene prose for
artifact/UI provenance), shot `character` (artist-reference provenance in the plan
artifact). `fallbackMove` affects only local-motion paths (KenBurns) and the
storyboard-fallback frame. No field exists "for show".

## 2. Deterministic planners (`src/lib/agent/cinematic/planner.ts`)

Pure, synchronous, no DB/SDK — testable in isolation. Same input ⇒ same plan (stable
ordering, no randomness, no seeds needed).

### 2.1 Cut points — single shared truth

`selectCutSegments(beatsSec, targetDurationSec, shotCount, energyAt)` extracts the **existing**
music-video algorithm 1:1 (usable beats in `(1, target-1)`, equidistant selection
`round(k·n/count)-1`, min-gap 1.2 s, duration-grid fallback, `round2`). The pipeline and
the pre-confirmation preview call the same function — the preview cannot drift from the
run.

### 2.2 Music-video arc (`planMusicVideo`)

Input: `{spec (validated), engine, targetDurationSec, beatsSec, sections, bpm,
hasArtist, visualStyle?, lightingMoodEn?}` (`limit` = `maxShots('music_video', quality, engine)` resolved by the caller; `beatsSec`/`sections` come from measured analysis or the procedural grid). Shot count and cut points reuse the existing formulas exactly —
no count-behavior change vs Phase 4.

Shot progression (deterministic):

- **Shot 1**: `establishing_wide`, subject `environment` (matches today's first-shot
  establishing behavior).
- **Last shot** (N ≥ 2): `wide`, subject `scene`, movement `zoom_out` (closing
  pull-back) — the "ending beat appropriate to the track".
- **Middle slots** by segment energy (from measured sections):
  - `loud` → `artist_performance` slots alternating `medium` / `close_up`;
  - `medium` → alternate `wide` / `medium`, subject `scene`;
  - `quiet` → `wide` / `establishing_wide`, subject `environment` (breathing space).
- **Detail/insert**: when N ≥ 5, slot ⌈N/2⌉-1 becomes `insert`, subject `detail`.
- **Reaction**: when N ≥ 6 and an artist character exists, one mid-plan slot becomes
  `reaction` (its own `reaction` size — a dedicated size enum value).
- Movement assignment: energy-aligned pools (loud → `dolly_tracking`/`zoom_in`; medium →
  `pan_left`/`zoom_in`/`pan_right`; quiet → `static`/`zoom_out`) with the repetition rule:
  never the same non-static movement twice consecutively; `static` may repeat (a scene
  that needs a stable camera keeps it — no forced variation). **Reconciled boundary rule
  (review round): the last slot is always `zoom_out` (§2.2 arc); the penultimate slot is
  therefore never `zoom_out`** — if its pool candidate is `zoom_out` it takes the pool's
  other option (quiet → `static`). Short film uses a real repeat-fix map
  (`pan_left↔pan_right`, `zoom_out→zoom_in`, `zoom_in→static`);
  `zoom_out` is never a repeat-fix alternative, protecting the fixed closing move.
- Durations: from cut points (`startSec/endSec`, `targetDurationSec` = segment length —
  the timeline trim target; the AI clip grid 5/10 s is handled by the existing
  `aiClipDurationSec` + trim, unchanged).
- **Honesty**: when there is no singer model claim — the plan's summary/limitations
  state that performance shots are artist-visuals only, **no singing/lip-sync**. Beat
  data is used only when measured (`measured`) or BPM-grid-estimated (`bpm_grid_estimate`,
  procedural case, clearly labeled); otherwise `duration_fallback` / `silent`.

### 2.3 Short-film coverage (`planShortFilmShots`)

Input: the scene list produced by `script_breakdown` (LLM #1 — kept; it writes the
story, not the shot structure), `{spec, engine, maxShotCount, segCap}`. **Replaces LLM
call #2** (deterministic derivation; one LLM round-trip saved per short-film run).

Per scene, by narrative purpose:

- Scene 1 → `establishing_wide` (geography) + a `wide`/`medium` action shot when budget
  allows.
- Dialogue scenes → conversation coverage: `medium` + `over_the_shoulder` pair, one
  `reaction` (its own `reaction` size) when the scene has ≥ 2 dialogue lines.
- Non-dialogue scenes → action coverage (`wide`/`medium`) + an `insert` detail shot
  when budget allows.
- Final scene → closing `medium`/`wide` + ending beat.
- Shot count: existing formula (`limit` clamp, `ceil(duration/segCap)`, ≥ 1 per
  scene) — unchanged. Dialogue-duration fitting stays in the existing
  `assignLinesAndDurations()` (measured TTS durations), which the planner's
  `targetDurationSec` values feed.
- Movements: same energy-free narrative mapping (establishing → slow `zoom_in` or
  `static`; dialogue → `static`/`pan`; detail → `zoom_in`) with the same repetition rule
  and the real repeat-fix map (`pan_left↔pan_right`, `zoom_out→zoom_in`,
  `zoom_in→static` — never `zoom_out` as a fix alternative).
- **No multi-character identity promise**: character references only via the existing
  portrait-conditioned i2v (best-effort, unchanged, labeled).

### 2.4 Pre-confirmation skeleton (`planShortFilmSkeleton`)

Short-film scenes don't exist until the runtime script step. The preview therefore
shows the **deterministic structural pattern** (scene-count estimate from duration,
per-scene purpose → shot-size pattern) with the honest label: "চূড়ান্ত দৃশ্য ও
শট-তালিকা জেনারেশন-সময়ে চিত্রনাট্য থেকে তৈরি হবে" — reviewable, settings-driven,
not per-shot editable (music-video is, because its plan is fully determined by
spec + measured audio pre-confirmation).

### 2.5 Overrides

`applyOverrides(plan, overrides)` — user edits (music-video): per-shot `size` /
`movement` (whitelisted enums, index-bounded). Applied **after** capability mapping, so
a user-selected `orbit` on `cinematic_motion` still gets the honest
`downgraded_to_local` verdict + adjustment record. `sanitizeOverridesInput` strips
garbage (used by `validateSpec` — server-side; client claims are never trusted).

## 3. Diversity & repetition rules (§4 of the brief)

- No immediate repetition of a non-static movement (except explicit override).
- `static` exempt (stable-camera scenes are legitimate).
- Size variation (reconciled in the review round — MV middle slots 1..N-2): the chosen
  size avoids repeating the previous shot's size via the energy-pair alternate
  (loud `[medium, close_up]`, medium `[wide, medium]`, quiet `[wide, establishing_wide]`);
  the penultimate slot additionally treats `wide` as a clash (the final slot is fixed
  `wide`). Exempt (unrecorded): the fixed arc slots i=0 / i=N-1, and `medium` runs of ≤ 2
  inside loud sections. When the energy-pair cannot avoid a repeat (pair exhaustion,
  e.g. an all-quiet 3-slot plan), the energy-correct size is kept and exactly one honest
  `adjustments` entry records the unavoidable adjacent repeat.
- Short-film sizes deliberately allow cross-scene boundary repeats (each scene
  re-establishes coverage — intentional structure, not a rule violation); the movement
  repetition rule above applies fully.
- All rules are deterministic functions of (energy pattern, N, overrides) — no RNG, no
  seeds, fully testable; every deviation caused by an override or by pair exhaustion is
  recorded in `adjustments` with a reason.

## 4. Plan validation (`validate.ts`)

`parseAndValidateShotPlan(input)` — runtime guards for reading a plan back (artifact,
tests, future consumers): version match, enum checks, `order` contiguity 0..n-1, unique
`shotId`/`sceneId`, `sceneId` referential integrity, `beatSource`/`subject` enum membership,
`totalPlannedSec` presence + finiteness + consistency, duration bounds
(≥ 0.5 s, ≤ 180 s — `targetDurationSec` is the timeline-trim target whose run-domain
maximum is the 180 s silent-music-video clamp, not the provider's 5/10 s clip grid),
and adjustment entry shape (non-empty `field` + `reason`, optional string `from`/`to`).
Returns `{ok, plan?, errors[]}`.
