# Phase 5 — Capability & Provider Mapping

## 1. The only ground truth: the real provider request body

Probe-verified (2026-10-13, `ai_video.ts` header) CogVideoX-3 contract via
z-ai-web-dev-sdk:

```
{ prompt ≤2000, duration ∈ {5,10}, quality ∈ {speed,quality},
  watermark_enabled, image_url?, with_audio?, size?, request_id? }
```

**No camera/movement/angle/lens/motion-path parameter exists.** Anything camera-ish can
only ever be prompt guidance for this provider. This single fact drives the whole map.

Local capability: `kenBurnsClip` implements real 2D camera motion for exactly
`{static, zoom_in, zoom_out, pan_left, pan_right}` — used by the `cinematic_motion`
engine and by the storyboard-fallback frame on the AI engine.

## 2. Camera-language registry (`cinematic/capability_map.ts`)

| Plan movement | ai_diffusion (CogVideoX-3) | cinematic_motion (KenBurns) | fallbackMove (deterministic) |
|---|---|---|---|
| `static` | prompt-guided | **local_motion** | `static` |
| `zoom_in` | prompt-guided | **local_motion** | `zoom_in` |
| `zoom_out` | prompt-guided | **local_motion** | `zoom_out` |
| `pan_left` | prompt-guided | **local_motion** | `pan_left` |
| `pan_right` | prompt-guided | **local_motion** | `pan_right` |
| `dolly_tracking` | prompt-guided | **unsupported → downgraded_to_local** | `zoom_in` |
| `handheld` | prompt-guided | **unsupported → downgraded_to_local** | `static` |
| `orbit` | prompt-guided | **unsupported → downgraded_to_local** | `pan_right` |

| Plan field | ai_diffusion | cinematic_motion |
|---|---|---|
| `size` (framing) | prompt-guided | prompt-guided (image-gen prompt) |
| `angle` | prompt-guided | prompt-guided (image-gen prompt) |
| `compositionEn` | prompt-guided | prompt-guided |
| `durationSec` | provider grid 5/10 (native, clamped) + timeline trim | local, free |

Delivery verdicts per shot (`movementDelivery`):
- `local_motion` — real, deterministic camera motion executed locally (KenBurns). Only
  possible for the 5 local movements on `cinematic_motion`.
- `prompt_guided` — clear camera-language instructions in the provider/image prompt;
  **labeled as guidance, never as a guaranteed result**. Generation returning a video
  does **not** count as the movement having been achieved.
- `downgraded_to_local` — requested movement is not locally implementable; defensible
  nearest local alternative used + adjustment recorded (field, from, to, reason).

## 3. Prompt builders (`cinematic/prompt.ts`)

`buildCinematicVideoPrompt(shot, style?, extra?)` — composes, in a bounded, slice-safe
way (provider slices at 2000):

```
actionEn, size-framing phrase ("wide establishing shot, ..." | "medium shot ..." | …),
compositionEn?, angle phrase (omitted for eye_level), movement phrase
("slow camera push in", "smooth dolly tracking shot following the subject", …),
lightingMood?, "realistic motion, cinematic, natural lighting, high quality,
no text overlay", style?, extra?
```

- Movement phrases for prompt-guided delivery are natural camera language — never
  phrased as a guaranteed parameter.
- `buildCinematicImagePrompt(shot, style?)` — storyboard/fallback-frame prompt:
  `actionEn + framing phrase + composition + angle + CINEMATIC_SUFFIX + style` (extends
  the existing `imagePromptForShot`, which stays for non-cinematic paths).
- `motion_video` pipeline keeps the legacy `buildAiVideoPrompt` untouched (out of
  Phase-5 scope).

## 4. Native-parameter honesty rule (§5 of the brief)

- Native parameters are sent **only** when the adapter explicitly supports them — the
  provider adapter is the single choke point (`submitVideoTask`); the cinematic layer
  never invents request fields. Tests assert the submitted body's keys are a subset of
  the probe-verified contract (no `camera`, `motion`, `angle`, … keys can appear).
- Unsupported movement requests (e.g., `orbit` on `cinematic_motion`) are downgraded
  with a recorded adjustment, not silently accepted.
- No UI text anywhere claims true dolly/orbit/crane/lens control. Delivery badges:
  `লোকাল ক্যামেরা-মোশন` (real local motion) vs `প্রম্পট-নির্দেশিত` (prompt guidance).
- Singing / lip-sync stay honestly unsupported (inherited Phase-4 verdicts; music-video
  plans label performance shots as artist visuals without mouth-movement claims).

## 5. Cache interaction (§8 of the brief)

The shot-cache fingerprint already includes the **full provider request** — including
the prompt. Because every generation-affecting plan field (action, framing, angle,
movement phrase, composition, lighting) is part of the prompt, any plan change yields a
different fingerprint automatically:

- changed framing/size → different framing phrase → new key (miss);
- changed movement → different movement phrase → new key;
- same shot re-submitted (rerun/retry) → same key → hit / in-flight join.

`imageUrl` (i2v portrait) is hashed in the key (existing behavior) — a different source
image cannot reuse an incompatible shot. `width/height/fps` stay excluded (local
normalization is deterministic). No cache-code changes required; behavior locked by
REG-16l (+ REG-10b).
