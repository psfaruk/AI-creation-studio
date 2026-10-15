# Phase-1 — Agent Tool Inventory & Add/Remove Recommendations (Task 6)

**Count verified at runtime (not assumed from the older audit's "42"):** `TOOLS` = **41 executable tools** (8 core + 11 image + 10 audio + 10 video + 2 production); `TOOL_CATALOG` = 41; parity OK (`missingInCatalog: []`, `missingInRegistry: []`, duplicates: `[]`). Locked as a regression invariant by `tests/smoke.test.ts`.

## 1. How tools are reached (routing facts, verified)

- **LLM-facing:** the system prompt is built registry-driven from all 41 `usage` lines (`prompts.ts`); the orchestrator parses the LLM's JSON tool call → `validateToolCall` (zod) → `executeToolCall` (withTimeout per tool) → structured error back to the LLM on failure (never uncaught).
- **Pipelines do NOT execute tool specs** — they import the shared *helper functions* that live in the same `tools/*.ts` modules (e.g. `planMusicContent`, `chunkScriptForTts`, `measureLoudnessPrecise`, `composeTypography`). So "no ToolCall row" ≠ "unused code".
- **Dead routing code:** `video/capability_router.ts` has zero importers (P0-BUG-05, unchanged). Not a tool; documented here because it is tool-adjacent.
- **No dynamic tool dispatch** beyond the registry (grep-verified this window).

## 2. Evidence classes used

- **A — direct runtime evidence:** `ToolCall` row(s) in the dev DB (this or a prior real session).
- **B — pipeline-sibling evidence:** the tool's underlying capability ran inside a production step (production `yrz3ymb7` steps + artifacts in DB).
- **C — source-verified wiring:** registry/prompt/orchestrator wiring read; no runtime execution yet.
- **D — gated-by-design:** the tool's contract is an honest refusal (verified in source).

## 3. Inventory (all 41) with classification

Timeout/error handling is uniform for all: zod validation → per-tool `withTimeout(spec.timeoutMs)` → orchestrator catch → structured error to the LLM + `tool_end` SSE with failure status + DB row. Side-effect classes: **API** (external provider call), **LOCAL** (ffmpeg/sharp/CPU/storage), **DB** (rows only).

### Core (8)

| Tool | Purpose | Side effects | Evidence | Overlap | Class |
|---|---|---|---|---|---|
| web_search | Web search via SDK | API | C | — | **KEEP** |
| read_web_page | Web page extraction | API | C | — | **KEEP** |
| generate_image | AI image generation | API+LOCAL (artifact) | C | pipeline image path is a sibling | **KEEP** |
| search_images | Real web images (SDK→CLI fallback) | API+DB | C | — | **KEEP** |
| analyze_image | VLM image QA/description | API | C | vs `inspect_image`: complementary (semantic vs technical) | **KEEP** |
| text_to_speech | Simple TTS (3 voices, mp3/wav fallback) | API+LOCAL | C | **overlaps `speech_synthesis`** (see §4.1) | **INVESTIGATE** |
| transcribe_audio | ASR (chunked, >30 s capable) | API | C | vs `analyze_audio`: complementary (ASR vs energy/metadata) | **KEEP** |
| search_conversations | Memory search over messages/titles | DB | C | — | **KEEP** |

### Image studio (11) — all LOCAL (sharp/ffmpeg) + artifact DB rows

`edit_image`, `inpaint_image`, `remove_background`, `remove_object`, `restyle_image`, `enhance_image`, `color_grade_image`, `transform_image`, `compose_text_image`, `export_image`, `inspect_image`.

- Evidence: **C** for all (no direct ToolCall rows); `compose_text_image`'s helper `composeTypography` is pipeline-sibling (**B** — bible images in production `yrz3ymb7` used the typography path via `local-frames`/`film-helpers`).
- Overlap: `inspect_image` (image QC) vs `analyze_image` (VLM) vs `inspect_media` (generic probe) — three "look at a file" tools with different lenses; acceptable but worth a usage audit once real traffic exists.
- **Class: KEEP** (11) — each wraps a distinct sharp/ffmpeg capability, all honest-labeled; `inspect_image` **INVESTIGATE** (overlap with `analyze_image`/`inspect_media` usage in practice).

### Audio studio (10)

| Tool | Purpose | Side effects | Evidence | Class |
|---|---|---|---|---|
| plan_music | Music plan document (LLM) | API | **A** (1 call, 21.0 s, done) | **KEEP** |
| generate_instrumental | Procedural instrumental (honest label) | LOCAL | **A** (1 call, 4.9 s, done) + **B** (production artifacts `instrumental-joyful-104bpm.wav/.mp3` with full metadata) + unit-tested (REG-5) | **KEEP** |
| generate_singing | Sung-song | none | **D** honest refusal (GATE_SINGING) | **KEEP** (capability signaling; see §4.2) |
| separate_stems | Stem separation | none | **D** honest refusal (GATE_STEMS) | **KEEP** (same) |
| speech_synthesis | Language-verified speech (controller) | API (TTS+ASR) | **B** (voiceover/short-film speech step uses the same `synthesizeVerifiedSpeech`; known P0-BUG-01 lives here) | **KEEP** (fix bug in Phase 2) |
| analyze_audio | Energy/metadata analysis | LOCAL | C | **KEEP** |
| process_audio | FFmpeg edit ops | LOCAL | C | **KEEP** |
| mix_audio | Multi-track mixing | LOCAL | **B**-adjacent (short-film sound_design uses same mixing helpers) | **KEEP** |
| validate_audio | Audio QC gate | LOCAL | **B** (validate step in audio pipeline uses same `audioQuality`) | **KEEP** |
| inspect_media | Generic media probe | LOCAL | C | **INVESTIGATE** (generic overlap with inspect_image/analyze_audio/validate_*) |

### Video studio (10)

| Tool | Purpose | Side effects | Evidence | Class |
|---|---|---|---|---|
| plan_video | Scene planning (LLM) | API | **B**-adjacent (script_breakdown/acting_plan steps) | **KEEP** |
| generate_video | Text→AI video (CogVideoX-3) | API | **B** (generate_shots step: 3 real shots, ~18 min, production `yrz3ymb7`) | **KEEP** |
| image_to_video | Image→AI video (same engine) | API | **B** (same engine path) | **KEEP** |
| animate_image | Local procedural animation (honest label) | LOCAL | C | **INVESTIGATE** (engine-ladder overlap with the two AI tools — intentional ladder, but usage unknown) |
| process_video | FFmpeg edit | LOCAL | C | **KEEP** |
| enhance_video | Video enhancement | LOCAL | C | **KEEP** |
| interpolate_video | Frame interpolation | LOCAL | C | **KEEP** |
| generate_subtitles | Subtitle generation | LOCAL | **B** (dialogue `.srt` artifact in production `yrz3ymb7`) | **KEEP** |
| validate_video | Video QC gate | LOCAL | **B** (technicalReport in production resultJson) | **KEEP** |
| lip_sync | Lip-sync | none | **D** honest capability report | **KEEP** (same rationale as singing) |

### Production (2)

| Tool | Purpose | Side effects | Evidence | Class |
|---|---|---|---|---|
| propose_job | Create production proposal card | DB | **A** (1 call, 2 ms, done) + full production lifecycle in DB | **KEEP** |
| create_character | Character bible entry | DB | **B** (Character rows power short-film continuity) | **KEEP** |

## 4. Investigation notes & recommendations

### 4.1 `text_to_speech` vs `speech_synthesis` (real overlap)

Two LLM-facing TTS paths: the simple 3-voice one (registry core) and the language-controller one (verified, engine-aware, profile-backed). Both are exposed to the LLM. **Recommendation (Phase 2 decision, not executed):** keep both but bias the prompt to `speech_synthesis` for user-facing narration (it is the path with fallbacks + verification), or fold the simple one into it. No removal in Phase 1.

### 4.2 Gated tools (`generate_singing`, `separate_stems`, `lip_sync`)

These are **honest-refusal by design** — they throw explanatory, alternative-suggesting errors (verified in source; Phase 0 confirmed the sung-song refusal path end-to-end). They serve as capability signaling to the LLM so it can route users to real alternatives. **Recommendation: KEEP** as long as the refusal copy stays truthful; revisit when providers change.

### 4.3 Removals

**None recommended.** No tool has negative evidence; every one is registry-wired, prompt-exposed, and either has runtime evidence (A/B), shared-helper usage by pipelines, or a distinct documented capability (C/D). Constraint honored: no tool deleted or disabled in Phase 1.

### 4.4 Candidate ADD — one concrete, evidence-backed capability gap

**`search_productions`** — the agent cannot see production state. Evidence: productions are DB-first; when a user asks "আগের ভিডিওটা কেমন হলো?" the LLM has no tool to fetch production status/artifacts (`search_conversations` searches *messages* only; production results reach the chat only as message cards at creation/finalize time, and are lost to later turns). This gap appeared concretely in Phase-0 functional testing (production progress is refresh-safe via DB, but invisible to the agent loop).

Proposed (Phase 2 decision — **not implemented** in Phase 1):
- **Schema:** `{ query?: string (≤200), status?: 'awaiting_confirmation'|'queued'|'running'|'validating'|'completed'|'partial'|'failed'|'cancelled', limit?: 3–10 (default 5) }` → `ToolOutput` with summary + resultJson of `{productionId, type, title, status, progress, artifactUrls[], createdAt, finishedAt}`.
- **Permissions:** owner-session (same guard as every route the tools' artifacts ride on); no secrets.
- **Failure behavior:** structured error (e.g. invalid status enum → zod rejection), empty result ≠ error ("কোনো প্রোডাকশন পাওয়া যায়নি").
- **Timeout:** 15 s (indexed DB reads only). **Side effects:** DB-read only.
- **Tests:** unit test with in-memory fake DB (search by status, by title contains, limit honored, empty result).

No other adds proposed — every other capability gap surfaced so far (shot reuse, film loudnorm, chat refresh persistence) is a **pipeline/client feature**, not a tool-boundary gap, and adding tools for them would be count-inflation.

## 5. Roll-up

| Classification | Count | Tools |
|---|---|---|
| KEEP | 36 | all core except text_to_speech; all image except inspect_image; all audio except inspect_media; all video except animate_image; both production tools |
| INVESTIGATE | 5 | text_to_speech (overlap w/ speech_synthesis), inspect_image, inspect_media (inspection trio overlap), animate_image (engine-ladder usage unknown) |
| CANDIDATE FOR ADD | 1 | search_productions (proposed schema above; Phase-2 decision) |
| CANDIDATE FOR REMOVE | 0 | — |
