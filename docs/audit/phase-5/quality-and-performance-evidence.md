# Phase 5 — Quality & Performance Evidence

All numbers below are **measured on the real modules** (scripts imported the actual
`src/lib/agent/cinematic/*`, `shot_cache.ts`, `ai_video.ts`-adjacent helpers via bun,
outside the repo in `/tmp`); nothing is estimated from reading code alone. Evidence
scripts were throwaway (not committed); every claim is regression-locked where a suite
can hold it.

## 1. Deterministic planner latency (E1)

Method: `performance.now()`, 50 warm-up + 2,000 measured iterations per case (async
preview: 1,000), 5 passes, `Bun.gc(true)` between cases, DCE-defeating sink. `mean` =
steady state (passes 4–5, post-JIT); `max` = worst single iteration across all samples.
Run on the shared dev sandbox (dev server + parallel agents active) — maxima include
GC/scheduler noise, marked ² where ms-scale (1–2 isolated samples per 10,000).

| Function | Inputs (real shapes) | Produced | mean | max |
|---|---|---|---|---|
| `selectCutSegments` | 60 beats, 40 s, shotCount 3 | 3 segments | **0.81 µs** | 51.0 µs |
| `selectCutSegments` | same, shotCount 8 | 8 segments | **1.16 µs** | 1.94 ms² |
| `planMusicVideo` | std/ai_diffusion, 40 s, limit 3, 66-beat BPM-100 grid, 3 sections, artist | 3 shots | **1.51 µs** | 4.22 ms² |
| `planMusicVideo` | std/cinematic_motion, 40 s, limit 14 | 7 shots | **2.72 µs** | 5.10 ms² |
| `planMusicVideo` | std/cinematic_motion, 90 s, limit 14 (full budget) | 14 shots | **4.80 µs** | 4.13 ms² |
| `planShortFilmShots` | std/ai, 60 s, limit 3, 3 scenes | 3 shots | **1.43 µs** | 10.54 ms² |
| `planShortFilmShots` | std/ai, 60 s, limit 3, 5 scenes | 3 shots (middle scenes honestly cut) | **1.88 µs** | 51.0 µs |
| `planShortFilmShots` | std/cinematic_motion, 60 s, limit 16, 5 scenes | 9 shots | **3.11 µs** | 17.56 ms² |
| `planShortFilmSkeleton` | std/ai, 60 s | 3 shots / 6 scenes | **0.47 µs** | 30.4 µs |
| `buildMusicVideoPlanPreview` (async, full preview entry) | MV spec, procedural BPM 100 | 3 shots, `bpm_grid_estimate` | **3.08 µs** | 75.5 µs |
| `buildMusicVideoPlanPreview` | musicSource none → silent | 3 shots / 2 scenes | **1.37 µs** | 41.8 µs |
| `buildShortFilmPlanPreview` | SF spec, 60 s | 3 shots / 6 scenes | **0.57 µs** | 29.2 µs |

**Bottom line:** the complete deterministic planning path — including the whole preview
entry (grid + plan + overrides + summary) — costs **0.4–4.9 µs per call** steady state
(≤ 0.005 ms). Against a pipeline where a single AI shot takes ~2–4 minutes of provider
diffusion, planning cost is ~0.000005% of a run. Shot-count sanity verified against live
`capabilities.maxShots` in the same run (MV std/ai=3, MV std/cm=14, SF std/ai=3,
SF std/cm=16 — all match).

## 2. LLM round-trip delta (E2, code-verified with line evidence)

| Pipeline | Phase-4 planning LLM calls | Phase-5 | Δ |
|---|---|---|---|
| music_video | 1 — `visual_plan` (LLM chose structure + descriptions) | 1 — `visual_plan` (LLM writes per-slot descriptions ONLY; structure is the deterministic planner's) | 0 (role narrowed, count identical) |
| short_film | 3 — script L203 + shot-split L366 + acting_plan L593 | 2 — script L213 + acting_plan L607 | **−1 per run** |
| plan-preview route | — | **0** (grep `chatJson` = 0; purely deterministic + local ffmpeg) | — |

- The removed short-film shot-split call is replaced by `planShortFilmShots`
  (short_film.ts:378–393) with an honest run-note; `acting_plan` kept (slot content, not
  structure); the conditional dialogue-language rewrite stays conditional (0–1/run,
  not a planning call) — per-run chatJson totals: SF **3–4 → 2–3**.
- music_video fallback: the single chatJson failing/429 → deterministic
  `fallbackActionEn` per slot (planner pre-fills every slot) → the planning step can
  never die. Test-locked by t19 (`expect(chatJsonCalls).toBe(2)` + mock throws on any
  third call) and t17/t16 fallback cases.

## 3. Prompt-mapping coverage (E3)

- Marker test (real `buildCinematicVideoPrompt`): actionEn / compositionEn /
  lightingMood markers all present; exact phrases verified — framing
  `over_the_shoulder` → "over-the-shoulder shot, looking past a subject toward the
  scene"; angle `low_angle` → "low-angle camera looking up"; movement
  `dolly_tracking` → "smooth dolly tracking shot following the subject".
  `fallbackMove`'s phrase does **not** leak into the prompt (local-KenBurns-only field).
- Image prompt: action + composition + framing + angle + lighting + style + the
  `CINEMATIC_SUFFIX` ("cinematic film still, professional lighting, 35mm, high detail,
  no text, no watermark").
- Bounded length under pathological inputs (5000/5000/2000/500/500-char fields):
  video prompt **1800 chars ≤ 2000** (per-field slices 800/200/120/150/300 bound it;
  the provider-side `slice(0,2000)` is a defensive no-op), image prompt 1607.
- Exhaustive enum sweep: all 8 ShotSize + 8 PlanMovement + 4 CameraAngle values emit
  their phrase, 0 misses; `eye_level` → `''` by design (no angle language for the
  natural default).
- Honesty: movement phrases are directorial guidance ("slow camera push in", "gentle
  orbiting camera movement around the subject") — regex sweep for
  guaranteed/parameter/`camera_` across all phrases: 0 hits.
- Provider body keys ⊆ probe contract — locked by t17:242–247 and t19:301–304
  (`ALLOWED_BODY_KEYS = {prompt, duration, quality, watermark_enabled, image_url,
  with_audio, size, request_id}` + duration ∈ {5,10}).

## 4. Shot-cache fingerprint sensitivity (E4)

Fingerprint = canonical JSON (fixed construction order, not key-sorting) over
`{v, model, prompt, durationSec, quality, imageUrlSha256, withAudio, size}` → sha256.
`width/height/fps` are structurally absent (deliberate — local normalization is
deterministic). The hashed prompt is byte-identical to what the provider receives.

Real-function demonstration (prompts from the real cinematic builder, minimal shot
"a lone violinist on a rain-soaked street", model cogvideox-3, 10 s, 1920×1080):

| Variant | Prompt delta | sha256 (first 16 hex) |
|---|---|---|
| a — `zoom_in` + `medium` | "…medium shot, subject framed from the waist up, **slow camera push in**…" | `428a616a4e5b421c` |
| b — movement → `dolly_tracking` | "**smooth dolly tracking shot following the subject**" | `95a60c82fa8c5d65` |
| c — framing → `close_up` | "**intimate close-up shot, expressive face detail**" | `54a49a7fc6bb20f0` |
| d — identical re-run of a | none (byte-identical canonical JSON) | `428a616a4e5b421c` |

**a≠b (movement), a≠c (framing), a=d (identical)** → any plan-driven prompt change
produces a fresh cache key; incompatible shots cannot silently reuse; identical
re-submission hits/in-flight-joins. Locked by REG-16l (plan-change → new key via the
real fingerprint + builder) and REG-10b (every fingerprint field matters).

## 5. Plan validation, determinism, overrides (E5 — 27/27 checks)

- **Validation**: real `planMusicVideo` output → `parseAndValidateShotPlan` ok:true,
  errors:[]. Corruptions each fail with specific Bengali errors — order gap:
  "শট S03-এর order অনুক্রমহীন (2 ≠ 1)"; invalid enum: "শট S01-এর size অবৈধ: mega_wide";
  total mismatch: "totalPlannedSec (45) শট-দৈর্ঘ্যের যোগফলের (40) সাথে মেলে না". The
  review round added beatSource/subject/totalPlannedSec-finiteness/adjustment-shape
  guards (each locked in REG-16d).
- **Determinism**: `planMusicVideo` 3× identical → byte-identical plans
  (sha256[:12] `e739764b2f0e` ×3); `planShortFilmShots` 3× → identical
  (`e27abc600ace` ×3). No Date.now/Math.random anywhere in `cinematic/**` (grep).
- **Overrides + honest downgrade**: `applyOverrides(plan, {shots:[{index:1,
  movement:'orbit'}]}, 'cinematic_motion')` → movement `orbit`, delivery
  **`downgraded_to_local`**, fallbackMove **`pan_right`** (= the capability map's
  documented alternative), TWO adjustments recorded — user selection
  ("ব্যবহারকারীর নির্বাচন (নিশ্চয়তার পূর্ব সম্পাদনা)") + engine downgrade
  ("cinematic_motion ইঞ্জিনে "orbit" প্রকৃতভাবে বাস্তায়নযোগ্য নয় — নিকটতম লোকাল
  ক্যামেরা-মোশন "pan_right" ব্যবহৃত"). Overridden plan re-validates ok:true.
- **Sanitize** (`sanitizeOverridesInput`): garbage entries (invalid enum, index 99)
  → all dropped with `droppedCount`; a 500-entry array → per-index merge, 64-cap
  enforced (valid-but-over-cap entries silently ignored beyond it — honest accounting
  note recorded in the worklog as a Phase-6 polish candidate); junk inputs
  (`'x'`, `42`) → no overrides key, no crash.
- **Override repetition exemption**: a user override creating consecutive identical
  non-static movements is allowed and recorded as a user-selection adjustment (the
  no-repeat rule applies at planning time only) — matches design §3 "except explicit
  override".

## 6. Browser-verified quality (render level)

- ShotPlanPreview renders the full honest contract (see test-results.md §3); per-shot
  overrides round-trip through `spec.cinematicOverrides` → server recomputation →
  re-validated preview (network-verified 200s); delivery badges honest
  ("প্রম্পট-নির্দেশিত (নিশ্চয়তা নয়)" on AI-diffusion; "লোকাল ক্যামেরা-মোশন
  (নিশ্চিত)" only for real KenBurns delivery); shot header derives from the current
  (possibly overridden) size after the review-round fix.
- Zero page/console errors across two full browser sessions; 671/671 network requests
  200 in the E2E session.

## Honest measurement caveats

- Latency maxima at ms-scale are 1–2 isolated samples per 10,000 on a shared box
  (GC/scheduler), not algorithmic cost; steady per-pass max ≤ 65 µs everywhere.
- Cold-JIT first pass runs 2–5× steady state; reported means are post-warm-up.
- LLM round-trip delta is code-level (call-site counts + mock-enforced in tests), not
  a live-timed A/B — live provider latency was intentionally not spent (budget rule).
