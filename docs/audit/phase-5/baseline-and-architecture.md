# Phase 5 — Baseline & Architecture Audit

## 1. Baseline verification (§0)

| Check | Result |
|---|---|
| `git status --short` | clean (no staged/untracked) |
| `git branch --show-current` | `main` |
| `git rev-parse HEAD` | `d982a4d9b2ebba449f8b1447c9308116c6ff85b4` |
| `git ls-remote origin refs/heads/main` | `d982a4d9b2ebba449f8b1447c9308116c6ff85b4` |
| `git log -6 --oneline --decorate` | `d982a4d` (HEAD -> main, origin/main) worklog P4-3 · `92eb66d` P4-2 review fixes · `310c712` Phase-4 impl · `8ce272c` Phase-3 · `2b0ef3e` P2-R1 · `8c472fb` Phase-1 |

Expected baseline **matches exactly** — local HEAD = origin/main = `d982a4d…`.
Starting suite: **119/119** (inherited Phase 0–4), typecheck 0, lint 0, prisma validate 0.

## 2. Existing behavior (verified by reading the real code)

### 2.1 Music video (`src/lib/agent/production/pipelines/music_video.ts`, 852 lines)

Steps: `song_input → visual_plan → characters → generate_shots → timeline → final_qc`.

- `song_input`: uploaded song → `analyzeAudioEnergy()` (local ffmpeg: `beatsSec`,
  `sections`, `estimatedBpm`, `honestLabel`); no song → procedural instrumental
  (deterministic beats from `music_engine` meta); `musicSource:'none'` → silent timeline.
- `visual_plan`: shot count = `maxShots('music_video', quality, engine)` clamped by
  `ceil(targetDuration / segCap)` (segCap 10 AI / 6 local). Cut points: beat markers
  filtered to `(1, targetDuration-1)`, **equidistant selection** (`round(k·len/count)-1`),
  min-gap 1.2 s, else duration-grid fallback. Then **one LLM `chatJson` call** returns
  `visualStyle` + ≤1 artist character + per-segment shots (`description` EN, `label` BN,
  `shotType ∈ {performance, close_up, wide, establishing}`, `cameraMove` from the 5-value
  `CameraMove` enum). LLM failure → honest fallback descriptions (planning step can never
  die, incl. 429 windows).
- `characters`: Character-table portrait reuse (§7.2) or portrait generation; local
  procedural last-resort with honest labels.
- `generate_shots`: per shot → `generateAiShot()` (engine `ai_diffusion`) with
  `buildAiVideoPrompt(description, style, cameraMove, extra)` → provider; or storyboard
  frame + `kenBurnsClip` (engine `cinematic_motion`). Per-shot storyboard artifacts carry
  `cameraMove` in `metaJson`. Failed shots are dropped with a partial note (successful
  shots preserved). `requestKey = mv-{productionId}-shot-{n}` (§10 idempotency).
  First shot prewarmed during planning (overlap speed-up).
- `timeline`: trim clips to beat cuts, `concatClips` (xfade ≤6 shots), song muxed as
  master audio, optional lyric subtitles.
- `final_qc`: duration/A-V-sync/audio-quality checks; final artifact `metaJson` has
  `cutPoints`, `shotEngines`, `honestLabel`, `lipSync: false`.

### 2.2 Short film (`short_film.ts`, 1583 lines)

Steps: `script_breakdown → character_bible → acting_plan → speech → generate_shots →
sound_design → continuity (VLM) → final_mix`.

- `script_breakdown`: **LLM call #1** → scenes (`location, timeOfDay, characters, action,
  actingNotes, cameraWork, ambientSound, musicCue, estimatedSec, dialogues`) +
  characters; honest three-chunk fallback. Then **LLM call #2** → shot split
  (`sceneIndex, description, label, cameraMove, durationSec, characters`); fallback =
  one shot per scene. Dialogue-language check/rewrite call when needed.
- `acting_plan`: **LLM call #3** → per-shot acting direction (`who, action, gaze,
  bodyHands, facialExpression, speaks, cameraMotion`).
- `speech`: per-line TTS with verification; measured line durations.
- `generate_shots`: same `generateAiShot` path; `assignLinesAndDurations()` fits shot
  durations to measured dialogue (cap 10 s/shot AI), 5/10 grid clamp, scene offsets.
- `sound_design`/`continuity`/`final_mix`: 5-layer mix, VLM continuity check, timeline +
  subtitles + final artifact.

### 2.3 Provider adapter (`src/lib/agent/video/ai_video.ts`)

- `submitVideoTask` body — **the complete, probe-verified provider contract**:
  `{prompt (≤2000), duration ∈ {5,10}, quality ∈ {'speed','quality'},
  watermark_enabled:false, image_url?, with_audio?, size?, request_id?}`.
  **There are NO native camera/movement/angle/lens parameters.** All camera language in
  this system is prompt text.
- Global in-flight gate: exactly one provider task at a time, post-completion cooldown
  150 s, 429 ladder (15→120 s, ≤8 min budget), `request_id` idempotency via
  `deriveRequestId(requestKey, prompt)`.
- `validateVideoBuffer`: ffprobe validation (≥3 s, ≥360 px, has video; audio expected
  only when `with_audio`).

### 2.4 Shot cache (`src/lib/agent/video/shot_cache.ts`)

- Fingerprint = canonical JSON `{v, model, prompt, durationSec, quality,
  imageUrlSha256, withAudio, size}` → sha256. **The prompt is part of the key**, so any
  plan-driven prompt change (framing/movement phrasing) automatically produces a fresh
  fingerprint — incompatible shots cannot silently reuse. `width/height/fps`
  deliberately excluded (local ffmpeg normalization, deterministically reapplied).
- Only completed+validated clips stored; lookup revalidates; in-flight dedupe; 512 MiB
  budget, oldest-first eviction.

### 2.5 Production lifecycle (Phases 2–4, preserved)

`createProduction` (shared path: propose_job tool / POST /api/productions / intent
fallback) → `awaiting_confirmation` → card (config panel schema, song selector, live
`POST /api/productions/validate`, plan preview, historical ETA) → `POST
/api/productions/[id]/confirm` (merge overrides + explicit-null clears + **validateSpec
rebuild** → `queued` → `startProduction` exactly-once, 409 on repeat) → runner
(`runStep`, cancellation incl. provider-poll checks, partialNotes, artifacts, SSE).

`validateSpec` (§15) **reconstructs the spec from a known-field whitelist** — any new
spec field must be explicitly parsed there to survive confirm.

### 2.6 Existing camera vocabulary

- `CameraMove = 'zoom_in'|'zoom_out'|'pan_left'|'pan_right'|'static'` — the only enum;
  KenBurns implements exactly these locally.
- `buildAiVideoPrompt` cam map: 5 English phrases appended to the prompt.
- `SHOT_TYPE_HINT`: 4 English phrases for the 4 music-video shot types.
- `Scene.cameraWork` + `ActingDirection.cameraMotion`: free-text, **never reach any
  prompt** (planning-only, but not labeled as such anywhere).

## 3. Confirmed defects / gaps (Phase-5 motivation)

- **D1 — whimsical shot structure.** Shot sizes/movements come from LLM mood or
  `MOVES[i % MOVES.length]` cycling. No establishing→performance→detail→closing arc, no
  repetition-avoidance rules, no narrative intent guarantee.
- **D2 — no plan visibility or editability.** Pre-confirmation the user sees only an
  estimated shot-count range. No ordered shot list, per-shot framing/movement/duration,
  music-cut strategy, or camera-honesty statement. The plan cannot be revised.
- **D3 — planning-only fields masquerading silently.** `Scene.cameraWork` /
  `acting.cameraMotion` are stored and shown but never influence generation, unlabeled.
- **D4 — no structured plan contract.** No typed/versioned shot plan; per-shot artifact
  metadata is thin (`cameraMove` only); no plan artifact; `resultJson` lacks the plan.
- **D5 — short-film double LLM round-trip.** Scene split (LLM#1) + shot split (LLM#2)
  although shot structure is deterministically derivable from scenes (violates the
  "no avoidable LLM round-trips" principle when deterministic planning suffices).
- **D6 — camera honesty gap.** Nothing states that movement is prompt-guided, not a
  guaranteed native parameter; nothing distinguishes local-motion (KenBurns) delivery
  from prompt-only delivery.

## 4. New behavior planned for Phase 5

See `cinematic-shot-plan-design.md`, `capability-and-provider-mapping.md`,
`pipeline-integration.md`. Summary:

1. New pure module `src/lib/agent/cinematic/` — versioned shot-plan contract,
   deterministic planners (music-video arc + short-film coverage), capability map with
   honest per-engine delivery verdicts, cinematic prompt builders, plan validation.
2. `CreativeJobSpec.cinematicOverrides` (music-video): user shot-level edits ride the
   spec through confirm §15 (explicitly parsed by `validateSpec`, sanitized).
3. Pipelines consume the plan: music-video `visual_plan` becomes deterministic-structure
   + LLM slot descriptions (same single LLM call); short-film **replaces LLM#2** with the
   deterministic planner (one LLM round-trip saved per run). Plan registered as a
   `shot-plan.json` artifact; per-shot prompts carry framing/angle/movement phrasing;
   per-shot artifact metadata + `resultJson.cinematicPlan` summary.
4. New `POST /api/productions/plan-preview` (owner auth + rate limit): deterministic
   pre-confirmation plan — music-video full shot list with **measured** beats when a
   song artifact exists (in-memory LRU analysis cache), honest beat-source labels;
   short-film structural skeleton (final scenes derive at runtime, honestly labeled).
5. Card UI: `ShotPlanPreview` section — ordered shots, per-shot size/movement editing
   (music-video), delivery badges (লোকাল-ক্যামেরা-মোশন / প্রম্পট-নির্দেশিত), totals,
   cut strategy, limitations. No simulated progress; historical ETA stays labeled.
6. Production metrics += cinematic plan fields (counts/enums only, redaction-safe).

## 5. Features that must wait for later phases

- Lip-sync / singing performance (explicitly out of scope; honest "no lip-sync" labels
  remain).
- True multi-character identity continuity beyond portrait-conditioned i2v (current
  best-effort already ships; not promised further).
- Beat-synchronized **visual events** inside a shot (cut points only in Phase 5).
- Motion-paths / lens emulation as native parameters (provider has none — Phase 6+
  would need a provider that exposes them).
- LLM-assisted plan refinement (deterministic planning suffices; keep as follow-up
  candidate behind the deterministic guard).
