# Findings C — Lip-Sync / Speech-to-Video (Critical Defect B) — Capability-Truth Audit

- **Task ID:** R-C · Agent: Recovery Audit C — Lip-Sync / Speech-to-Video Specialist
- **Repo:** `/home/z/my-project` · branch `main` · HEAD `c7927f7` ("phase-5: cinematic director & camera shot planning + review fixes"), parent `d982a4d` (origin/main)
- **Scope:** master recovery prompt `upload/Pasted Content_1792178693713.txt` §5 (all), §3 Phase-5 list, §7 (Layer A–D framing), §8 (Lip-sync regression group), §9 (honest UI contract)
- **Method:** read-only source audit (src/, tests/, docs/, node_modules/z-ai-web-dev-sdk), one small test file executed live (`tests/regression/t12-intent-routing.test.ts` → **17/17 pass, 92 expects, 122 ms**, incl. REG-12k "lip-sync request → honestly unsupported with alternative"). No source files modified. No provider calls. No git mutations.
- **Note:** §5.5 enumerates **14** bullet cases (prompt lines 397–412), not 15 as stated in the audit brief; all 14 are mapped below and the count discrepancy is recorded.

---

## 1. Capability truth (§5.1) — VERDICT: CONFIRMED, no real lip-sync machinery exists

**Expected truth holds.** There is **no** lip-sync model, endpoint, adapter, face tracker, mouth-landmark processor, viseme/phoneme aligner, or per-frame speech-driven synthesis anywhere in the repo. The single lip-sync "module" is an **honest blocker** whose only executable function throws. `lipSync:false` is set on every final video artifact.

### 1.1 Mechanism search table (whole-repo: src/, tests/, docs/, node_modules SDK)

| Mechanism searched (case-insensitive) | Found? | What exists instead (evidence) |
|---|---|---|
| lip-sync adapter / module | **NO real machinery** — only an honest-blocker module | `src/lib/agent/video/lip_sync_module.ts:24-38` `LIP_SYNC_STATUS = { available: false, talkingStatus: 'unavailable', singingStatus: 'unavailable', … }`; `:146-152` `runLipSync()` **always throws** an honest 4-dimension blockage error (`Promise<never>` — it is structurally incapable of returning a result) |
| face detection / tracking | NO | Zero deps (package.json/bun.lock: no opencv / mediapipe / face-api / dlib / insightface — verified). Only cloud VLM `visionCompare` used for whole-image character-continuity guesses (`short_film.ts:1382-1385`) — not face/mouth detection, and its own output is hedged "VLM-অনুমান চূড়ান্ত সত্য নয়" (`:1392`) |
| mouth landmarks / mouth-region processing | NO | "মুখ" appears only in honest disclaimers ("মুখের নড়াচড়ার দাবি নয়" — `short_film.ts:24,1556`; `music_video.ts:816`; `planner.ts:885`) and in the *acting-prompt text* vocabulary (`facialExpression` — prompt guidance, not processing) |
| audio→viseme/phoneme timing | NO | grep `viseme|phoneme` → only prose in future-work notes (`lip_sync_module.ts:87` "syllable/phoneme অ্যালাইনমেন্ট" listed as *future singing requirement*; `lip_sync_module.ts:79` planned step 5 text). No implementation |
| per-frame synthesis / provider lip-sync endpoint | NO | SDK v0.0.18 `dist/index.d.ts:92-104` `CreateVideoGenerationBody` = `{model, prompt, image_url, quality, with_audio, watermark_enabled, size, fps, duration, request_id, user_id}` — **no audio input parameter of any kind**; 10 published methods (chat×2, tts, asr, image-gen×3, video-gen, async-result, functions×2) — none is lip-sync. grep `lip|viseme|talking|avatar|reenact` in the whole SDK dist → 0 matches |
| talking head / reenactment (Wav2Lip/SadTalker/MuseTalk/LivePortrait) | NO — names appear only as *candidates* in registry/docs | `model-registry-data.ts:613-623` key `wav2lip-sadtalker` status `planned`, `licenseStatus: needs_review`, `providerStatus: not_exposed_by_sdk`, `integrationStatus: not_integrated`; `hardware-gate.ts:204-210` `minVramGb: 4, gpuRequired: true` → verdict unavailable on this box |
| "prompt says perfect lip sync" (false implementation) | NO — the anti-pattern does not exist either | grep `perfect lip|lip sync|lipsync` in src → only Bengali honest disclaimers and identifiers; the acting-coach LLM prompt itself instructs the *opposite*: "তবে মুখের নড়াচড়ার নিখুঁত লিপ-সিঙ্ক নেই — সেটা দাবি কোরো না" (`short_film.ts:612`) |
| `lipSync:false` marker | YES — by design, on all 3 video pipelines | `short_film.ts:1556` ("§৫ — কথা-বলা শটে মুখের নড়াচড়ার দাবি নয়"), `music_video.ts:860`, `motion_video.ts:776` ("লিপ-সিঙ্ক মডেল নেই, দাবিও নেই") |

### 1.2 What the video provider actually supports (native image+audio→talking-video?)

**No.** `z-ai-web-dev-sdk@0.0.18` (`node_modules/z-ai-web-dev-sdk/dist/index.d.ts`):
- `video.generations.create(body: CreateVideoGenerationBody)` (lines 92–110) accepts **text prompt + optional image_url(s)** — there is **no audio input field**. `with_audio?: boolean` (line 97) only asks the generator to emit its own ambient/AAC audio track (probe-verified 16 kHz mono — `availability-matrix.ts:278-283`); it is not speech conditioning.
- Therefore **no provider call in this repo can ever receive dialogue audio**, making speech-driven mouth motion structurally impossible today — independent of any prompt wording.

### 1.3 Confirmations from the worklog (prior claims re-verified in source)

- `worklog.md:1649` (P5-3 browser session): plan-preview limitations show "লিপ-সিঙ্ক নেই…" to the user — re-verified in code at `planner.ts:885` and locked by `tests/regression/t18-plan-preview-route.test.ts:193-195`.
- `worklog.md:1715` (P5-4g): "final_qc metaJson.cinematicPlan + resultJson + lipSync:false (850, 879, 854)" — re-verified at `music_video.ts:860/884-886` (line drift from post-review edits, content intact).

---

## 2. What happens to dialogue audio + video today (§5.2 end-to-end trace)

**Two-line summary:** Dialogue TTS audio and video shots are generated **independently** (the video provider never sees the audio), then dialogue lines are placed on a measured timeline and **muxed over** the silent video with ffmpeg — the character's mouth **cannot** move in sync (AI shots may show arbitrary prompt-guidued motion; cinematic_motion shots are KenBurns pans/zooms over stills with zero mouth motion); the spoken words are also burned in as timed Bengali subtitles.

Exact assembly (short_film pipeline, `src/lib/agent/production/pipelines/short_film.ts`):

1. **speech step** (`:717-912`): every dialogue line → `synthesizeVerifiedSpeech` (first line per voice ASR-verified, rest verify:false, `:776-833`); each line written to `line-N.{wav|mp3}` + `measuredSec` from `mediaInfo` (`:844-846`); **each line registered as its own audio artifact** `dialogue-N-<character>.<ext>` with metaJson `{layer:'A1', kind:'dialogue', character, text(≤200 chars), emotion, voice, language, sceneIndex, verification}` (`:856-883`). Failed lines stay subtitle-only with an honest note (`:834-839`).
2. **Timeline math** `assignLinesAndDurations()` (`:915-979`): scene starts derived from shot boundaries (crossfade-aware, `:955-966`); lines placed sequentially per scene — `l.startSec = lc; l.endSec = lc + max(0.8, measuredSec); lc += measuredSec + 0.25` (`:967-977`, never overlapping). If a scene's dialogue exceeds its shot time, the scene's last shot is stretched up to the engine cap (AI 10 s / local 20 s, `:918-931`); if still short → honest partial note "কথা পরের দৃশ্যে গড়িয়ে যেতে পারে" (`:934-936`). AI-path shot durations clamped to the 5/10 s provider grid with notes (`:940-952`).
3. **generate_shots** (`:985-1226`): AI shots submitted via `generateAiShot` (from `motion_video.ts:171-198`) → `generateVideoClip` with `{prompt, durationSec, quality:'speed', imageUrl?, requestKey}` — **no `withAudio`, no audio** → provider-returned clips are silent video. cinematic_motion path = storyboard still + `kenBurnsClip` camera motion (`:1097-1217`) — mouth pixels never move.
4. **sound_design** (`:1233-1349`): A1 dialogue timeline rendered by `buildPositionedTrack` — ffmpeg `adelay` per line + `amix` + `apad=whole_dur=total` + **`atrim=0:total`** (`:1642-1665`); A2/A3 ambience+foley beds per scene, A4 procedural score, A5 narration after the last line; 5-layer `mixSoundLayers` with ducking+limiter → `final-mix.wav`.
5. **final_mix** (`:1413-1597`): `concatClips` (crossfade) → silent `assembled.mp4` → `muxAudio(video, mix, {durationSec: videoDur, fadeOutSec:1.2})` (`film-helpers.ts:368-385`: `apad=whole_dur` + **`-t durationSec`**, video stream copied) → `burnSubtitles` with timed cues from `timedLines` (`:1438-1442`) → final MP4 registered with `lipSync:false` (`:1556`), `avSyncOk` from post-mux ffprobe stream-duration diff < 0.5 s (`:1487-1497`).
6. **What the user hears/sees:** a film where the Bengali dialogue plays at measured positions over the visuals (music/ambience ducked under it), with the line text burned as subtitles at the same timestamps; characters' mouths are either static (KenBurns path) or moving only as generic prompt-guided AI motion with no relation to the audio.

**Music-video path** (no dialogue TTS at all): user song (or procedural instrumental) is the master audio; shots cut to beat marks; `final_qc` trims video to the song-used duration with an honest note when unmatchable (`music_video.ts:741-768`) — mouth-sync explicitly disclaimed (`:816`).

---

## 3. Audio timing contract (§5.2) — field-by-field gap table

Where per-line data lives today: dialogue artifact metaJson (`short_film.ts:861-882`), in-memory `TimedLine` (`:136-142`), SRT cues (`:1438-1442`), `shot-plan.json` plan artifact (`:456-469`, via `cinematic/planner.ts` — shots only, **no dialogue fields in `CinematicPlan`**).

| §5.2 required field | Status | Evidence / detail |
|---|---|---|
| exact text | **PARTIAL** | `metaJson.text` sliced to 200 chars (`short_film.ts:866`) — full text only in screenplay.txt (`:440`) + SRT; provenance truncated for long lines |
| language / voice locale | **EXISTS** | `metaJson.voice` + `language` (`:868-869`) |
| audio artifact ID | **PARTIAL** | each line *is* its own artifact, but nothing references the IDs: shot-plan.json, SRT artifact (`:1511-1519`, metaJson = `{lines: count}` only) and final-video metaJson carry **no dialogue-artifact-ID join**; `speechVerification` summaries also lack artifact IDs (`:884-893`) |
| sample rate & duration | **PARTIAL** | `durationSec`/`expectedSec` recorded **only inside verification** = first line per voice (`:877-878`); every line's `measuredSec` (`:846`) is **not persisted**; sample rate (24 kHz requested `:805`, 44.1 kHz post-mix `:1651`) never recorded |
| line start/end timestamp | **MISSING (persisted)** | `startSec/endSec` computed (`:972-973`) and used for SRT + foley timing (`:1266`) but appear in **no artifact** — not in dialogue metaJson, not in shot-plan.json; no machine-readable timeline artifact |
| scene/shot/character mapping | **PARTIAL** | `character` + `sceneIndex` in metaJson (`:865,870`); **no shotId mapping** — dialogue↔shot association does not exist anywhere (plan shots have `shotId`/`sceneId` but no dialogue link) |
| speech verification status | **EXISTS** | per-line `metaJson.verification` verdict/similarity/detectedLanguage (`:871-881`); later lines carry a pointer note ("এই কণ্ঠের প্রথম লাইনের যাচাই-রায় দেখুন") |
| lip-sync processing status | **MISSING** | no per-line or per-shot field anywhere; only final-video `lipSync:false` (`:1556`) |
| final video segment mapping | **MISSING** | no dialogue→final-segment map; SRT cue times are the only proxy, and they are pre-burn estimates |

### How would timestamp conflicts / duration mismatches be detected today?

- **Scene-level over-stuffing:** detected + corrected (bounded last-shot stretch) + honest note if uncorrectable (`:927-937`) — good.
- **End-of-film overflow:** **NOT detected — silently truncated.** `buildPositionedTrack`'s `apad/atrim` (`:1658-1659`) and `muxAudio`'s `apad + -t` (`film-helpers.ts:379-382`) cut any line crossing `totalSec` with no note, violating §5.2's "নীরবে stretch/truncate নয়" rule. (Music-video path *does* handle its one aggregate mismatch honestly — trim with note, `music_video.ts:745-768`.)
- **Overlap conflicts:** impossible by construction (sequential cursor, `:967-977`) — safe, but not asserted by any test.
- **Final `avSyncOk`** (`:1487-1497`) is near-tautological: it probes the *post-mux* file where `-t durationSec` already forced both streams to the same length — it can catch mux corruption, not dialogue overflow.

---

## 4. Honest status inventory (§9) — every user-facing mouth/acting claim with verdict

| # | Surface (file:line) | Claim (BN) | Verdict |
|---|---|---|---|
| 1 | `src/lib/agent/capabilities.ts:461-471` (validateSpec — every motion_video/music_video/short_film spec, pre-confirmation) | "লিপ-সিঙ্ক মডেল নেই — চরিত্রের মুখের নড়াচড়ার দাবি করা হয় না (§৫ সৎ-অবস্থা)।" | **HONEST** (universal note) |
| 2 | `cinematic/planner.ts:885` (plan summary limitations — shown in ShotPlanPreview pre-confirmation) | "লিপ-সিঙ্ক নেই — গায়কের মুখ নড়াচড়া বা গাওয়ার দাবি করা হয় না।" | **HONEST** (locked t16:476, t18:195) |
| 3 | `components/studio/studio-view.tsx:291-304` (video-lipsync tool card) | "অডিওর সাথে ঠোঁট মেলানো — … এই পরিবেশে চালু নয়।" `status:'unavailable'` | **HONEST** |
| 4 | `studio-view.tsx:306-319` (singing lipsync card) | "গানের সাথে গায়কের ঠোঁট মেলানো — … দুই-ই এখানে চালু নয়।" | **HONEST** |
| 5 | `studio-view.tsx:345-359` (film-short mode) | statusNote: "সংলাপ-অডিও ও AI-দৃশ্য থাকে — ঠোঁট-সিঙ্ক নয়" | **HONEST** |
| 6 | `studio-view.tsx:362-376` (film-dialogue mode) | description: "সংলাপ-TTS মাপা-দৈর্ঘ্য টাইমলাইনে বসে" — **no ঠোঁট-সিঙ্ক disclaimer** (unlike #5) | **GAP (minor)** — the most dialogue-heavy mode lacks the explicit no-mouth-sync note → finding C-F06 |
| 7 | `studio-view.tsx:378-385` (film-music-video mode) | statusNote: "গায়কের মুখ নড়ে না (লিপ-সিঙ্ক নেই) — সৎভাবে ঘোষিত" | **HONEST** |
| 8 | `components/studio/guide-view.tsx:141` (talking-portrait capability) | "…লিপ-সিঙ্ক ছাড়া কখনো 'ঠোঁট নড়ছে' দাবি করা হয় না" | **HONEST** |
| 9 | `guide-view.tsx:200-204` (capability router table row) | lip_sync → "লিপ-সিঙ্ক মডেল নেই (এই পরিবেশে স্থাপিত নয়)" status `unavailable` | **HONEST** (mirrors `capability_router.ts:55-62`) |
| 10 | `guide-view.tsx:293` (honesty principle) | "ফটোরিয়ালিস্টিক অভিনয়/নিখুঁত চরিত্র-ধারাবাহিকতার নিশ্চয়তা নেই…" | **HONEST** (acting claim hedged) |
| 11 | `components/studio/production-card.tsx:325` (cinematic_motion note) | "…ডিফিউশন ভিডিও-মডেল নয়; ফটোরিয়ালিস্টিক অভিনয়ের নিশ্চয়তা নেই।" | **HONEST** |
| 12 | `src/lib/system-info.ts:309-313` (health panel) | lip-sync মডেল: `status:'down'` — "৪-মাত্রিক বাধা: SDK-তে API নেই · GPU নেই · অ্যাডাপ্টার নেই · বাংলা বেঞ্চমার্ক হয়নি" | **HONEST** |
| 13 | `src/lib/types.ts:311-318` (tool registry) | "লিপ-সিঙ্ক (ভবিষ্যৎ)" + 4-dimension blockage description | **HONEST** (future-marked) |
| 14 | `availability-matrix.ts:285-318` (cap-talking-portrait / cap-singing-lipsync) | `overall:'unavailable_here'`; honestNote "ছবিতে জুম করে 'লিপ-সিঙ্ক সফল' দেখানো নিষিদ্ধ"; fallback text "মুখের নড়াচড়ার দাবি থাকে না" | **HONEST** |
| 15 | `tools/video.ts:1077-1102` (lip_sync tool) | usage "[অবরুদ্ধ — §৫]…"; execute **throws** honest report, never fakes success | **HONEST** (behavior untested → C-F09) |
| 16 | `intent/classifier.ts:224-232, 473-477` (Bengali "ঠোঁট মিলিয়ে কথা বলাও" request) | `capabilityStatus:'unsupported'` + "লিপ-সিঙ্ক মডেল নেই — চরিত্রের মুখের নড়াচড়ার দাবি করা হয় না। বিকল্প: সংলাপ-অডিও + সাবটাইটেল।" | **HONEST** (live-tested today: t12 REG-12k PASS) |
| 17 | `music_video.ts:816,886` (MV result notes) | "লিপ-সিঙ্ক নেই — 'গায়কের মুখ নড়ছে' দাবি করা হয় না (§৫ সৎ-অবস্থা)।" → `result.notes` | **HONEST content, NOT RENDERED** — production-card `ParsedResult` (`production-card.tsx:174-191`) has no `notes` field; completed card shows badges/quality/plan-counts/partialNotes only → C-F05 |
| 18 | `short_film.ts:1560-1563` (SF final verdict text) | "চমৎকার — Nটি শট… বাংলা সাবটাইটেল-সহ। (honestLabel)" — honestLabel covers engine truth only; **no lip-sync mention in SF result-level user text** (only artifact `lipSync:false` at `:1556`) | **GAP (minor)** → C-F05 |
| 19 | `short_film.ts:612` (acting-coach LLM prompt) | "সংলাপ-শটে speaks=true হবে (তবে মুখের নড়াচড়ার নিখুঁত লিপ-সিঙ্ক নেই — সেটা দাবি কোরো না)" | **HONEST** (anti-overclaim instruction inside the prompt itself) |
| 20 | "অভিনয়" claims generally (studio-view:349, guide-view:153/284 pipeline descriptions) | "অভিনয়-পরিকল্পনা" listed as a pipeline *stage* (descriptive) + #10/#11 disclaim guarantees | **HONEST** — acting is prompt-guided only; no surface claims *verified* acting |

**Net:** every place a user could infer mouth-sync carries an honest disclaimer, **except** (a) the completed-result card (MV note unrendered / SF note absent) and (b) the film-dialogue mode card — both minor (pre-confirmation + mode-level disclosures already cover the same user journey).

---

## 5. Findings register

| ID | Severity | Location | Finding (evidence → why) | Minimal fix |
|---|---|---|---|---|
| **C-F01** | **BLOCKER (declared)** | `lip_sync_module.ts:24-38,146-152`; SDK `index.d.ts:92-104` | No lip-sync capability exists: SDK has no audio→video conditioning; `runLipSync` always throws. This is Critical Defect B itself — **honestly declared everywhere, not hidden** (see §4) | Keep blocked; implement only via future provider contract (§6) after user authorization |
| **C-F02** | P2 (documentation-of-fact) | `short_film.ts:1011-1053` + `motion_video.ts:188-198` | AI dialogue shots are submitted with no `withAudio` and no audio (structurally none exists) — any mouth motion in AI shots is prompt-random, unrelated to the spoken track | Document in phase docs; when a lip-sync provider lands, route dialogue shots through it instead of plain `generateAiShot` |
| **C-F03** | **P2** | `short_film.ts:1658-1659` (atrim), `film-helpers.ts:379-382` (apad+`-t`) | Dialogue longer than the film is **silently truncated** at timeline end — violates §5.2 "নীরবে stretch/truncate করবে না"; scene-level stretch+note exists (`:927-937`) but film-end overflow has no detection/evidence | After final offsets, check `l.endSec > totalSec + 0.1` → honest partial note + record `{line, overflowSec, action:'truncated'}`; add regression test (synthetic line files + tiny ffmpeg fixtures, no provider) |
| **C-F04** | **P2** | `short_film.ts:861-882` vs §5.2 schema | Per-line timing contract fields not persisted (startSec/endSec/measuredSec/shotId/sampleRate/artifact-ID joins absent from all artifacts) — future lip-sync input contract + conflict detection have no data foundation | Extend dialogue artifact metaJson `{startSec, endSec, measuredSec, sampleRate, sceneId, shotId?}`; add `dialogue: [{artifactId, character, startSec, endSec}]` to final-video metaJson; testable now |
| **C-F05** | P3 | `production-card.tsx:174-191`; `music_video.ts:886` vs `short_film.ts` (no result note) | Completed-card honesty gap: MV's "লিপ-সিঙ্ক নেই" note is in resultJson but the card type has no `notes` field (unrendered); SF result carries no equivalent user-visible note | Add `notes?: string[]` to ParsedResult + render under the result summary; push the same note in short_film result |
| **C-F06** | P3 | `studio-view.tsx:362-376` | film-dialogue mode card (most likely to imply talking mouths) lacks the "ঠোঁট-সিঙ্ক নয়" statusNote that film-short (`:352`) and film-music-video (`:385`) carry | Add `statusNote: 'সংলাপ-কণ্ঠ ও সাবটাইটেল — ঠোঁট-সিঙ্ক নয়'` |
| **C-F07** | P3 | `short_film.ts:866` | Dialogue artifact `text` sliced to 200 chars — provenance truncated for long lines | Store full text (lines are already budget-capped ~`durationSec*2.5` chars at `:190`) |
| **C-F08** | P3 | `short_film.ts:1487-1497` | Post-mux `avSyncOk` is near-tautological (`-t` forced both streams to the same length); cannot detect the real risk (C-F03) | Assert A1-timeline duration ≤ totalSec *before* mux (see C-F03) and report pre-mux audio total in technicalReport |
| **C-F09** | P3 | no test references `runLipSync`/`lipSyncCapabilityReport`/lip_sync tool | The honest-failure gate itself is untested — a regression could soften the throw into a fake success unnoticed | Add unit test: tool call throws with 4-dimension message; `LIP_SYNC_STATUS.available === false`; capability router row `unavailable` (testable now, zero providers) |
| **C-F10** | P2 (future-blocker) | package.json (no face deps); `lip_sync_module.ts:73-92` | Zero face-detection/mouth-analysis foundation exists — §5.3 validation gates (face coverage, mouth-motion alignment) have no tooling path even if a model lands | Document as explicit BLOCKED dependency in the integration contract (§6); do not vendor heavy CV deps into the 4.1 GB sandbox |

No P0 found: **nothing claims lip-sync success falsely** — the opposite (honest, multi-surface disclosure) is systematic and test-locked.

---

## 6. Integration options + future contract design (§5.1 end — doc-only, no code)

### 6.1 Runtime reality (2 CPU / 4.1 GB RAM / no GPU)

- **Local models infeasible.** `hardware-gate.ts:204-210` records Wav2Lip/SadTalker/MuseTalk at `minVramGb: 4, gpuRequired: true`, "≈৪–১২GB VRAM (প্রকল্পভেদে); GPU না থাকলে অসম্ভব-সধীর" — matching upstream requirements (Wav2Lip ≈4 GB VRAM; SadTalker ≈6–8 GB; MuseTalk ≈8–12 GB for near-real-time; LivePortrait GPU-oriented). CPU-only Wav2Lip exists in principle but would take minutes-to-tens-of-minutes per line and starve this 4.1 GB sandbox (precedent: Demucs deliberately not installed for exactly this reason — `hardware-gate.ts:199-202`). **No forced local inference** (§10 rule).
- **License dimension:** Wav2Lip weights are academic/non-commercial-research conditioned; SadTalker/MuseTalk differ per project — all currently `needs_review` (`lip_sync_module.ts:5-6,42-43`; `model-registry-data.ts:617-621`). Any dependency adoption must clear the project's license gate first.

### 6.2 Hosted-API options (categories; **cost model unknown → deliberately not fabricated**)

Audio-driven talking-head services exist in these classes; pricing/rate limits/terms must be verified from vendor docs before any budget request:
1. **Commercial talking-head platforms** (photo/avatar + audio → talking video): D-ID, HeyGen, Synthesia, Hedra — polished, closed, per-minute credit models.
2. **Model-hosting platforms running open lip-sync models** (Wav2Lip / SadTalker / LivePortrait / MuseTalk ports): Replicate, fal.ai, RunWare — keeps model choice open; per-second compute billing; license of the *underlying weights* still applies.
3. **Dedicated lip-sync APIs** (retarget mouth motion onto existing video): Sync Labs (sync.so) and similar; matches our shot-clip-driven flow.
4. **z-ai-web-dev-sdk:** **not an option today** — no lip-sync endpoint (§1.2); would require the SDK to grow one or a new external provider adapter.

Per master-prompt §7 Layer-D rules: any of the above = **BLOCKED — LIVE PROVIDER NOT AUTHORIZED** until the user approves provider, usage scale, and cost (unknown costs must be reported as unknown, never estimated).

### 6.3 Future integration contract (design, no code)

**Input schema (per lip-sync job):**
```
LipSyncJob {
  dialogueAudio: { artifactId, sha256, language, voice, durationSec, sampleRate,
                   verificationVerdict }              // §5.2 fields (C-F04 prerequisite)
  sourceFace: { kind: 'portrait_image' | 'shot_clip', artifactId, characterId,
                shotId?, sceneId?, consent: 'ai_fictional' }   // CONSENT_RULES apply
  timing: { timelineStartSec, timelineEndSec }        // placement on final timeline
  mode: 'talking' | 'singing'                         // singing needs separate benchmark
}
```
**Provider adapter interface** (mirrors existing `ai_video.ts` submit/poll/validate shape): `submit(job) → taskId`, `poll(taskId) → buffer`, `validate(buffer, job) → {ok, evidence}` with per-provider timeout + bounded retry + error classification (same §1-phase rules as TTS/video adapters).

**Validation gates (all must pass before any `lipSync:true`):**
1. **Duration match** — |generated video − dialogue audio| ≤ 0.3 s; mismatch → reject or re-submit; any correction logged with limits + evidence (no silent stretch/truncate — fixes C-F03-class issues at the new stage too).
2. **Face coverage** — face (and mouth region) detected in ≥ agreed share of frames via a lightweight detector; failure → honest `FACE_NOT_FOUND`, never a silent static-face pass.
3. **Mouth-motion ↔ speech alignment** — mouth-region motion energy vs audio envelope correlation as a *heuristic screen* + cloud-VLM spot-check, both documented as NOT proof (per §5.4 "কোনো metric একা perfect lip-sync প্রমাণ করে না"); human review sheet fields marked NOT REVIEWED until reviewed.
4. **Identity preservation** — existing `visionCompare` continuity pattern against the character bible portrait.
5. **Artifact registration** — output clip artifact with `lipSync:true`, gate evidence, and dialogue-artifact ID join (§3 gaps closed first).

**Honest failure states:** `LIP_SYNC_UNAVAILABLE` (today's status), `LIP_SYNC_PROVIDER_TIMEOUT`, `LIP_SYNC_PROVIDER_FAILED`, `FACE_NOT_FOUND`, `DURATION_MISMATCH`, `ALIGNMENT_LOW` — surfaced as §9-style statuses; UI copy pattern already exists (`studio-view.tsx:296` `status:'unavailable'`). Until the contract is implemented and authorized, `runLipSync`'s throw stays the single truth.

---

## 7. §5.5 test-matrix status (14 enumerated cases; brief said 15 — count discrepancy noted)

| # | §5.5 case | Status | Evidence / what exists |
|---|---|---|---|
| 1 | One Bengali spoken line | **BLOCKED** (model) | Speech-side covered (t1/t8 Bengali TTS), lip-sync half impossible |
| 2 | Multiple Bengali lines | **BLOCKED** | Adjacent: t19 asserts 2 per-dialogue artifacts registered, no mouth claim (`t19:307-311`) |
| 3 | Different-length lines | **BLOCKED** | Adjacent: measuredSec per line + bounded scene stretch exercised in t19 run; no lip-sync assertion possible |
| 4 | Two speakers alternating | **BLOCKED** | Per-character voice map exists (`short_film.ts:787-788`); no speaker→face mapping (C-F04) |
| 5 | Silent shot | **BLOCKED** (no lip-sync stage to skip) | Adjacent: dialogue-less scenes handled (`:277` fallback `dialogues: []`, `:441` "(সংলাপহীন দৃশ্য)" label); t16/t17/t19 runs include dialogue-less shots |
| 6 | Mouth-not-visible shot | **BLOCKED** (no face detection — C-F10) | — |
| 7 | Face-detection failure | **BLOCKED** (no face detection) | — |
| 8 | Unsupported input format | **BLOCKED** (no adapter) | zod schema exists on the gated tool (`tools/video.ts:1084-1089`) but untested (C-F09) |
| 9 | Mismatched audio/video duration | **TESTABLE-NOW — partially EXISTS** | t9 REG-9b real-ffmpeg A-V sync on muxAudio (`t9:132-168`); MV final_qc trim+note (`music_video.ts:745-768`); **gap**: dialogue-overflow detection absent (C-F03) and SF `avSyncOk` unpinned |
| 10 | Lip-sync provider timeout | **BLOCKED** (no provider) | Gated tool `timeoutMs: 10_000` (`tools/video.ts:1090`) untested |
| 11 | Lip-sync provider failure | **BLOCKED as provider test — TESTABLE-NOW as honest-gate test** | `runLipSync` throws honest error (`lip_sync_module.ts:146-152`) — no test pins it (C-F09) |
| 12 | Successful-output artifact registration | **BLOCKED** (no lip-sync output can exist) | Non-lipsync analogue pinned: t19 `lipSync:false` + final artifact (`t19:314-319`) |
| 13 | Rerun & cancellation | **BLOCKED** for the lip-sync stage | General cancellation locked elsewhere (t17 cancel propagation; t3/t7) |
| 14 | Unsupported capability honest UI status | **EXISTS (strongest coverage)** | t12 REG-12k (classifier honest text — **re-run today: PASS**), t13:69-70 (config-panel limitations), t18:193-195 (plan-preview limitations), t16:473-476 (summarizePlan limitations), t17:272-274 (MV result note), t19:319 (`lipSync:false`) |

**Tally:** EXISTS ≈ 2 of 14 fully (14, and 9 partially) · TESTABLE-NOW additions available ≈ 3 (9-overflow detection, 11 honest-gate, 8 arg-schema) · BLOCKED = 10 (all requiring a real model/provider or face-detection foundation).

§8 Lip-sync regression-group mapping: timestamp mapping (no test — data not persisted, C-F04), face/source validation (BLOCKED), unsupported capability (EXISTS ×4 files), model failure/timeout (BLOCKED + untested honest gate), artifact validation (EXISTS for honest non-lipsync output), synchronization evaluation (EXISTS at container level t9; mouth-level BLOCKED).

---

## 8. Defect B verdict

**Lip-sync absence is honestly represented almost everywhere, and the absence itself is correctly declared as a blocker rather than faked.** The repo contains zero lip-sync machinery; the only executable lip-sync code path is an always-throwing honest gate (`lip_sync_module.ts:146-152`), the SDK offers no audio-conditioned video (no audio input exists in `CreateVideoGenerationBody`), and disclaimers span the intent classifier, spec validation, plan preview, mode cards, capability matrix, health panel, tool registry, guide, and artifact metadata — most of them test-locked. Two minor honest-status gaps remain on the completed-result card (MV note unrendered, SF note absent — C-F05) and the film-dialogue mode card (C-F06); the §5.2 timing contract is the real debt: per-line timing/shot/artifact-ID joins are not persisted (C-F04) and end-of-film dialogue overflow is silently truncated (C-F03).

**Honest path forward:** (1) keep lip-sync BLOCKED with the existing 4-dimension declaration; (2) close the timing-contract gaps (C-F03/C-F04) — all testable now without any model; (3) add the honest-gate regression test (C-F09) and the two UI disclaimers (C-F05/C-F06); (4) implement real lip-sync only through the §6.3 provider contract after the user authorizes a hosted provider and accepts its (yet unknown, to-be-verified) cost — never via local GPU models on this 2-CPU/4.1 GB/no-GPU box, and never by softening the honest gate.

*Audit executed read-only; only this findings file + one worklog append were created. One small test file (t12) executed live: 17/17 pass. No provider calls, no git mutations, no secrets touched.*
