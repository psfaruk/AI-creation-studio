# Phase 0 — Pipeline Capability Matrix (Work Package B)

Source-grounded trace of every production/chat feature. "Evidence" states: **Confirmed** = reproduced in this window or recorded as runtime evidence (DB rows / artifacts / dev.log); **Code-confirmed** = verified by full source read with references (no live run in this window); **Historical** = recorded in `worklog.md` from prior E2E sessions (not re-run here); **Blocked/Not Tested** = no evidence.

Providers: **Z.ai SDK** (`z-ai-web-dev-sdk` — chat GLM, image gen/edit, TTS, ASR, web search, **CogVideoX-3 video**) and **external GLM** (user's own key, Z.ai API / BigModel via real OpenAI SDK, optional Base URL override). No other LLM providers remain (GLM-only policy, commit `c0384d2`).

---

## 0. Chat + agent loop (all creative features' entry point)

| Aspect | Detail | Evidence |
|---|---|---|
| User request | Chat message (+ ≤4 attachments: image ≤~7 MB, audio ≤~7 MB, video ≤~25 MB base64 caps) with optional model (GLM catalog, unknown id → 400) and mode (normal/chat_only/diagnostic) | `src/app/api/chat/route.ts:22-141` — Code-confirmed |
| Routing path | `POST /api/chat` → `requireOwner` → rate limit (IP-keyed) → conversation resolve/create → user `Message` + `AgentRun` rows → `startAgentRun(runId)` fire-and-forget → SSE `GET /api/runs/[id]/events` | route.ts:60-219; orchestrator.ts:361-373 — Code-confirmed; dev.log shows POST 200s |
| Provider | Model id `''` → Z.ai SDK (streaming, 6 retries, channel-cooldown, 12 h disk cache); external GLM ids → OpenAI SDK with user key + Base URL override (429: 2 retries 3 s→6 s w/ jitter + visible wait notes; all other 4xx fatal, honest messages) | llm.ts:256-354; external-llm.ts:115-237 — Code-confirmed; chat send/reply Confirmed (dev.log + 3 completed runs in DB) |
| Loop | MAX_STEPS 12, history window 20 msgs, [TOOL_RESULT] JSON protocol with echo-guard, repeat-guard (canonical signature), 10-min elapsed watchdog, firstTokenMs recorder, 42 zod-validated tools | orchestrator.ts:27-32, 211-232, 718-812, 1003-1026, 1181-1214 — Code-confirmed; 3 runs `completed/final_answer` in DB (Confirmed) |
| Failure handling | 13-category error taxonomy → Bengali failure message + retry chip ("আবার চেষ্টা"); 429 → intent-fallback (rule-based planner) when 0 steps done; one-time model fallback with honest note | orchestrator.ts:120-208, 1449-1529; message-bubble.tsx:108-162 — Code-confirmed; historical E2E for fallbacks |
| UI progress | Optimistic user bubble + pending assistant → SSE text_delta typewriter drain → activity cards (7 statuses, live elapsed) → run stats incl. firstTokenMs; manual reconnect 2→30 s ×5 then 2 s polling (180 s guard) | use-agent-run.ts:31-137, 179-345; activity-card.tsx:36-83 — Code-confirmed; streaming Confirmed (dev.log) |
| **Gap** | Chat run state is memory-only — browser refresh mid-run loses the pending bubble and allows a parallel run (see P0-BUG-03) | Confirmed (source) |

## 1. Image generation

| Aspect | Detail | Evidence |
|---|---|---|
| User request | Chat tools (`generate_image`, `edit_image`, `search_images`, +10 more) or `Production(type=image)` with instructions/style/sourceArtifactId/aspect/format/overlayText | tools/image.ts; pipelines/image.ts:53-114 — Code-confirmed |
| Routing | Pipeline steps: `prepare` (VLM context if quality=high, Bengali→English prompt planning via chatComplete) → `generate` (SDK `generateImageBuffer`/`editImageBuffer`, aspect→size map 1024²/864×1152/1344×768/768×1344) → optional `overlay` (shared Bengali typography) → `validate` (sharp dims/format check + jpeg/webp/png export q92) | pipelines/image.ts:35-229 — Code-confirmed |
| Output | PNG/JPEG/WebP artifact(s) + pre-overlay base variant when overlaid | runner.ts registerArtifact — Code-confirmed |
| Validation | Dimension/format sanity via sharp; ≤0-size or unreadable dims → step fails | image.ts:161-168 — Code-confirmed |
| Failure handling | Step failure → production failed (or partial if artifacts exist); prepare needs instructions **or** source image else explicit error | runner.ts:444-485 — Code-confirmed |
| UI progress | ProductionCard step list + progress; chat tools → activity card + artifact chip | production-card.tsx — Code-confirmed |
| Runtime evidence | 2 AI portraits (864×1152 PNG, character_bible step of the short-film run) — decodable, correct dims | **Confirmed** (ffprobe + DB meta) |

## 2. Instrumental audio (30 s target class)

| Aspect | Detail | Evidence |
|---|---|---|
| User request | Chat "instrumental/সুর/বিট/লো-ফাই" intent, `generate_instrumental` tool, quick-create "ইন্সট্রুমেন্টাল মিউজিক", or `Production(audio, audioOperation=instrumental)` | orchestrator.ts:520-539; quick-create.tsx — Code-confirmed |
| Routing | `audioPipeline` → `runInstrumental`: `prepare` (mood detect from text, 8–120 s clamp, tempo/genre passthrough) → `synthesize` (**procedural local engine**: Karplus-Strong arpeggio, pad/bass/ melody motifs, drums, Freeverb; 6 moods; honest label "পরীক্ষামূলক — নিউরাল মিউজিক-মডেল নয়") → `verify` (engine validation: duration±2 s, ≥5 s, peak ≤−0.5 dB, silence ≤2.5 s) → `master` (MP3 192k encode, engine normalization preserved) → `validate` (WAV+MP3 artifacts with beats/sections meta) | pipelines/audio.ts:332-439; music_engine.ts:780-1064 — Code-confirmed |
| Provider | **None (local CPU)** — zero network in synthesis path | music_engine.ts (verified no fetch/SDK) — Code-confirmed |
| Output | WAV 44.1 kHz stereo PCM16 + MP3 192k artifacts with honest engine label | **Confirmed** (artifacts `instrumental-joyful-104bpm.{wav,mp3}`) |
| Validation | Engine checks + ffprobe audioQuality on registered master | **Confirmed** (meta in DB matches measurement, see media-quality-baseline.md) |
| Failure handling | Verification issues → partialNotes (non-fatal); synthesis errors → step fail | audio.ts:365-372 — Code-confirmed |

## 3. Full song with singing vocals

| Aspect | Detail | Evidence |
|---|---|---|
| Capability | **Does not exist.** No singing/vocal-synthesis model is integrated (music engine is instrumental-only; TTS-read lyrics are never passed off as singing — engine header declares this) | music_engine.ts:4-27 — Code-confirmed |
| Honest refusal | Chat intent `sungSong:true` → honest disclosure "গান গাওয়ার (singing) মডেল এখন চালু নেই — ভুয়া বা নকল গান বানানো হবে না" + 3 alternatives (honest-labeled instrumental / lyrics when chat recovers / upload own song → music video) | orchestrator.ts:542-560, 651-662 — Code-confirmed; **Historical** E2E (Bengali sung-song request → plan_music + honest card) |
| Music plan path | `plan_music` tool / `audio/music_plan` op → LLM song-structure document (sections/lyrics/tempo/key) as **text artifact** — honestly a plan, not audio | pipelines/audio.ts:445-489 — Code-confirmed (**Confirmed** artifact `song-plan.txt` in DB, 5 sections, 90 BPM) |
| Status | **Blocked** pending a licensed singing model (e.g. YuE/MusicGen-class) — deliberate honesty policy, not a defect | — |

## 4. Voiceover and dialogue

| Aspect | Detail | Evidence |
|---|---|---|
| User request | `Production(audio, op=voiceover)` with text (+language/voice); short-film dialogue lines | pipelines/audio.ts:133-326; short_film.ts:682-848 — Code-confirmed |
| Routing | `runVoiceover`: `prepare` (chunk ≤950 chars, script-language detection overrides mismatched selection with explanation, voice profile resolution) → `synthesize` (chunk 0 through `synthesizeVerifiedSpeech` with ASR back-check; chunks 1+ 3-way parallel cached TTS) → `verify` (verdict/similarity report) → `master` (concat + loudnorm −16 LUFS + MP3 192k) → `validate` (duration>0, peak ≤−0.1 dB, sample-rate check; WAV+MP3) | pipelines/audio.ts:133-326 — Code-confirmed |
| Provider | bn: Edge bn-BD neural (Nabanita/Pradeep/Tanishaa) primary, z-ai (jam/douji) fallback; en: Edge Aria/Guy/Sonia primary | language_controller.ts:62-77 — Code-confirmed |
| Failure handling | Chunk failure → partialNote; zero chunks → honest step error; verification fail → partialNote "প্রিভিউ শুনে নিশ্চিত করুন" | audio.ts:229-242 — Code-confirmed |
| Runtime evidence | **Voiceover path: Not Tested in this window** (no voiceover artifact in DB). **Dialogue path: Confirmed FAILED** — short-film run: 0/4 Bengali dialogue lines synthesized; all 4 failed with "Edge TTS ব্যর্থ — সংযোগ-ত্রুটি: 403"; **z-ai fallback never engaged** (root cause P0-BUG-01) | DB partialNotes + ProductionStep `speech` "0/4 সংলাপ-লাইন সফল" — **Confirmed** |

## 5. Motion video

| Aspect | Detail | Evidence |
|---|---|---|
| User request | `Production(motion_video)` — duration 5–20 s, aspect, optional source image (i2v), engine choice | capabilities.ts:74 — Code-confirmed |
| Routing | Steps `plan` (LLM shot plan, deterministic fallback) → `generate_shots` → `assemble` (narration/ambient mix with ducking + soundscape bed) → `validate`. Engine `ai_diffusion` (default): **CogVideoX-3** via Z.ai SDK, 5/10 s clips, shots = min(limit, duration/10), limit 2–3; `cinematic_motion`: storyboard image + Ken Burns (local FFmpeg) | motion_video.ts:133-296, 314-409 — Code-confirmed |
| AI shot fallback ladder | AI video fail → cloud storyboard frame (edit/gen image) → local procedural frame → Ken Burns clip; engine recorded per shot with honest labels | motion_video.ts:217-296 — Code-confirmed |
| Output | MP4 (h264, forced res/fps normalize) artifact with per-shot engine labels, `lipSync:false` | motion_video.ts:195-205, 716-738 — Code-confirmed |
| Validation | ffprobe: hasVideo, codec h264, duration ±2 s, resolution = outputDims(aspect, resolution), audio presence when sound ≠ none; QC problems → partial, never silently fatal | motion_video.ts:686-756 — Code-confirmed |
| Runtime evidence | **Not Tested live in this window** (AI-video budget not authorized) | — |

## 6. Music video

| Aspect | Detail | Evidence |
|---|---|---|
| User request | `Production(music_video)` — song upload or procedural music, 15–180 s, default 9:16 | capabilities.ts:75 — Code-confirmed |
| Routing | `song_input` (uploaded song: energy/beat analysis via FFmpeg; else procedural instrumental, honest note) → `visual_plan` (section-based shots, LLM w/ fallback) → `characters` (1 artist; portrait reuse from Character table; AI portrait → local fallback, honest) → `generate_shots` (AI: artist-portrait i2v CogVideoX-3; cinematic: storyboard+Ken Burns) → `timeline` (beat-marker cut points, xfade ≤6 shots, song mux fade-out 2 s, optional burned subtitles) → `final_qc` (duration auto-trim to song, resolution, clipping, silence >3 s, A/V sync <0.5 s non-blocking) | music_video.ts:118-833 (trace report) — Code-confirmed |
| Output | MP4 + SRT artifacts with cutPoints, song meta, `avSyncOk`, `lipSync:false` | — Code-confirmed |
| Runtime evidence | **Not Tested live in this window.** Historical E2E: advanced-settings confirm → live steps + 42 % progress + reload recovery + cancel→cancelled (worklog tasks 14/15/16) | Historical |

## 7. Short film

| Aspect | Detail | Evidence |
|---|---|---|
| User request | `Production(short_film)` — idea/story, 30–120 s, filmMode, 24 fps default, subtitles default on | capabilities.ts:76 — Code-confirmed |
| Routing | 8 steps: `script_breakdown` (LLM 8-layer §7 breakdown) → `character_bible` (portraits, reused across productions) → `acting_plan` → `speech` (dialogue TTS: first line per voice ASR-verified, rest cached; failure → subtitle-only note) → `generate_shots` (CogVideoX-3 i2v with portrait + acting direction; cinematic branch Ken Burns; prewarm overlap) → `sound_design` (A1 positioned dialogue + A2/A3 soundscape + A4 procedural score + A5 narration, ducking mix) → `continuity` (VLM portrait↔frame compare, ≤3 shots, rate-limit tolerant) → `final_mix` (timeline, SRT burn, ffprobe QC) | short_film.ts:145-1448 (trace report) — Code-confirmed |
| Output | MP4 + SRT + portraits + dialogue-line artifacts; resultJson technicalReport | **Confirmed** (full run in DB) |
| Validation | hasVideo, duration ±4 s, resolution, fps ±1.5, audio presence, A/V sync <0.5 s; problems → verdict + partial | short_film.ts:1364-1394 — **Confirmed** exercised (technicalReport present, `avSyncOk:true`) |
| Runtime evidence | **Confirmed end-to-end** — production `yrz3ymb7`: 3 scenes/3 shots, all CogVideoX-3 (`aiShots:3`), 30.1 s 1080×1920@30, subtitles burned, all 8 steps done, final status `partial` (TTS 403 ×4 + scene-compression notes) | DB + artifacts + dev.log |

## 8. Event/progress plumbing (both buses)

| Aspect | Detail | Evidence |
|---|---|---|
| Run bus | In-process `Map<runId, listeners>` on globalThis (HMR-safe), replay buffer **from first emit** (limit 100), 60 s finished grace | events.ts:35-60 — Code-confirmed |
| Production bus | Same design keyed by productionId (replay limit 200, 120 s grace); `production_queued` emitted by confirm **before** `startProduction` (race-free second tab) | bus.ts:33-57; confirm/route.ts:83-85 — Code-confirmed |
| SSE routes | Runs: DB replay + live + 1.5 s diff-poll, server-side dedupe; Productions: DB replay → live bus + replay flush → 2.5 s diff-poll + 15 s ping, 1 h cap, **single unnamed message format** (no double-send) | runs/[id]/events; productions/[id]/events — Code-confirmed |
| Sweeps | Stale: 20 min (image/audio) / 60 min (AI-video) → honest failed; boot sweep marks restart-interrupted productions failed (never fake "running"); 60 s periodic timer | runner.ts:534-614 — Code-confirmed |
| Cancellation | Cooperative `cancelling` + 5 s kill-watch + ffmpeg SIGKILL registry + VideoAbortedError named `CancelledError` → status `cancelled` (not failed) | runner.ts:70-72, 429-485; ffmpeg.ts:77-94 — Code-confirmed; Historical E2E cancel test |

## 9. Artifact handling

| Aspect | Detail | Evidence |
|---|---|---|
| Registration | `saveArtifactFile` (timestamped-uuid name) + DB row with origin/kind/mime/metaJson; productions register into their own conversation; user uploads linked to the user message | storage.ts; runner.ts:364-380; chat/route.ts:171-199 — Code-confirmed; **Confirmed** 8 rows in DB |
| Serving | `/api/artifacts/[id]/file` — owner-gated (`?st=` token for media tags), immutable cache header, 302 for external sourceUrls, `?download=1` with UTF-8 filename | artifacts/[id]/file/route.ts — Code-confirmed; dev.log shows 200s |
| Cleanup | Working dirs removed after every run (success or fail) | runner.ts:511 — Code-confirmed (also blocks shot reuse — P0-BUG-04) |

## 10. Dormant / documentation-only components

- `video/capability_router.ts` — static 8-entry routing table, **zero importers** (dead code, P0-BUG-05).
- `video/lip_sync_module.ts` — only consumer is the `lip_sync` tool which **always throws an honest 4-dimension blockage report**; pipelines hard-write `lipSync:false`.
- `agent/audio/bn-benchmark-suite.ts`, `tts-benchmark-runner.ts` — benchmark surfaces (via `/api/benchmark/tts`), not in production paths.
