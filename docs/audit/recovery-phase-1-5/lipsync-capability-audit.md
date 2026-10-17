# Recovery Audit — Lip-Sync / Speech-to-Video Capability Truth (Critical Defect B)

- **Task ID:** R-DOC-2 (documentation consolidation) · Audit basis: **R-C** · Fix wave: **R-FIX** (timing-contract + UI-honesty halves) · Live proof: **R-WAVE4** (VLM review only — no lip-sync provider exists to test)
- **Defect (master prompt §5):** the product must never imply real lip-sync; dialogue video must be honestly represented; a per-line audio↔video timing contract must exist; unsupported capability must surface an honest status.
- **Sources:** `findings/findings-c.md` (capability-truth audit at HEAD `c7927f7`), `worklog.md` R-C / R-FIX / R-WAVE4, `tests/regression/t21-dialogue-timing-contract.test.ts`, `findings/findings-d.md` §5 (real-run trace).
- **Citation convention:** *pre-fix* file:line = as audited in findings-c at `c7927f7`; *current* file:line = re-verified in the post-R-FIX working tree (full gate 185/185, 1977 expects, 22 files).

---

## 1. Capability truth — VERDICT: CONFIRMED, no lip-sync machinery exists (unchanged by the fix wave)

**The expected truth holds and still holds.** There is no lip-sync model, endpoint, adapter, face tracker, mouth-landmark processor, viseme/phoneme aligner, or per-frame speech-driven synthesis anywhere in the repo (mechanism search over src/, tests/, docs/, node_modules SDK — findings-c §1.1). Concretely:

- The single lip-sync "module" is an **honest blocker**: `src/lib/agent/video/lip_sync_module.ts:24–38` `LIP_SYNC_STATUS = { available: false, talkingStatus: 'unavailable', singingStatus: 'unavailable', … }` with a 4-dimension blockage declaration (license `needs_review` / provider `not_exposed_by_sdk` / hardware `unavailable_hardware` / integration `not_integrated` / benchmark `not_done`); `runLipSync()` (`:146–152`) is typed `Promise<never>` — **structurally incapable of returning a result**. Re-verified in the current tree (`:25`, `:146–149`) — R-FIX deliberately did not touch it.
- **The SDK has no audio→video conditioning.** `z-ai-web-dev-sdk@0.0.18` `CreateVideoGenerationBody` (`dist/index.d.ts:92–104`) = `{model, prompt, image_url, quality, with_audio, watermark_enabled, size, fps, duration, request_id, user_id}` — **no audio input field of any kind**; `with_audio` only asks the generator to emit its own ambient AAC track, it is not speech conditioning. Whole-SDK grep `lip|viseme|talking|avatar|reenact` → 0 matches. Therefore **no provider call in this repo can ever receive dialogue audio** — mouth-sync is structurally impossible today, independent of prompt wording.
- **No face/CV foundation:** no opencv/mediapipe/face-api/dlib/insightface dependency exists. Wav2Lip/SadTalker/MuseTalk appear only as registry candidates (`model-registry-data.ts:613–623`, status `planned`, `licenseStatus: needs_review`) behind a hardware gate (`hardware-gate.ts:204–210`: `minVramGb: 4, gpuRequired: true`).
- **No false "perfect lip sync" prompt-claims exist either** — the anti-pattern was searched for and is absent; the acting-coach LLM prompt itself instructs the opposite: "মুখের নড়াচড়ার নিখুঁত লিপ-সিঙ্ক নেই — সেটা দাবি কোরো না" (short_film.ts:612).
- `lipSync:false` is set on every final video artifact — **retained post-fix** (short_film, music_video `:860`, motion_video `:776`; locked by t19:319 `expect(finalMeta.lipSync).toBe(false)`).

---

## 2. What happens to dialogue audio today (§5.2 end-to-end trace — pre-fix mechanics, still accurate)

**Two-line summary (findings-c §2):** dialogue TTS audio and video shots are generated **independently** (the video provider never sees the audio), then dialogue lines are placed on a measured timeline and **muxed over** the silent video with ffmpeg — the character's mouth **cannot** move in sync (AI shots may show arbitrary prompt-guided motion; cinematic_motion shots are KenBurns pans/zooms over stills with zero mouth motion); the spoken words are also burned in as timed Bengali subtitles.

Assembly (short_film pipeline, pre-fix file:line from findings-c):

1. **speech** (`:717–912`): per-line verified TTS → `line-N.{wav|mp3}` + `measuredSec`; each line its own `dialogue-N-<character>` artifact with metaJson `{layer:'A1', kind:'dialogue', character, text, emotion, voice, language, sceneIndex, verification}`.
2. **Timeline math** `assignLinesAndDurations()` (`:915–979`): scene starts from shot boundaries; lines placed by a sequential per-scene cursor (`l.startSec = lc; lc += measuredSec + 0.25`); bounded last-shot stretch (AI 10 s / local 20 s caps) + honest note "কথা পরের দৃশ্যে গড়িয়ে যেতে পারে" when a scene still overflows; 5/10 s provider-grid clamps.
3. **generate_shots** (`:985–1226`): AI shots submitted via `generateAiShot` with `{prompt, durationSec, quality, imageUrl?, requestKey}` — **no `withAudio`, no audio** → provider clips are silent video; cinematic_motion path = storyboard still + KenBurns.
4. **sound_design** (`:1233–1349`): A1 dialogue timeline via `buildPositionedTrack` (ffmpeg `adelay`/`amix`/`apad`/`atrim`); A2 ambience + A3 foley per scene; A4 procedural score; A5 narration; 5-layer `mixSoundLayers` with ducking+limiter.
5. **final_mix** (`:1413–1597`): crossfade concat → silent `assembled.mp4` → `muxAudio` (`apad` + `-t durationSec`, video stream copied) → `burnSubtitles` at measured cue times → final MP4 registered with `lipSync:false`, `avSyncOk` from post-mux stream-duration diff < 0.5 s.
6. **User experience:** Bengali dialogue plays at measured positions over the visuals (music/ambience ducked under it), line text burned as subtitles at the same timestamps; mouths are static (KenBurns) or moving as generic prompt-random AI motion with no relation to the audio.

Music-video path: song is master audio; shots cut to beat marks; `final_qc` trims video to song-used duration with an honest note; mouth-sync explicitly disclaimed (`music_video.ts:816`).

---

## 3. §5.2 audio-timing contract — gap table OLD → NEW

OLD = findings-c §3 at `c7927f7`. NEW = post-R-FIX tree (C-F03/C-F04/C-F07/C-F08 fixed; locked by **REG-21b**, t21:324).

| §5.2 required field | OLD status | NEW status | Current evidence |
|---|---|---|---|
| exact text | **PARTIAL** — `metaJson.text` sliced to 200 chars (short_film.ts:866 pre-fix) | **EXISTS — full text** (C-F07) | full line text persisted; REG-21b asserts it |
| language / voice locale | EXISTS | EXISTS (+ locale recorded) | metaJson `language` + locale in provenance |
| audio artifact ID join | **PARTIAL** — nothing referenced the dialogue-artifact IDs | **EXISTS — dialogue join on the final video** | final-video metaJson `dialogue: [{artifactId, character, startSec, endSec, verdict, shotId}]` (short_film.ts:1943–1944) |
| sample rate & duration | **PARTIAL** — `measuredSec` in-memory only; sample rate never recorded | **EXISTS** | per-line `measuredSec` + `sampleRate` persisted (short_film.ts:149–159, 174–177) |
| line start/end timestamp | **MISSING (persisted)** | **EXISTS** | `startSec`/`endSec` on every timed line and in the final-video dialogue join |
| scene/shot/character mapping | **PARTIAL** — character + sceneIndex only, **no shotId** | **EXISTS** | `shotId` per line + speaker-shot matching (`placeLineInSpeakerShot`, short_film.ts:210–223, with `matchedSpeakerShot` flag — also the D-F02 fix) |
| speech verification status | EXISTS | EXISTS | per-line `verification` verdict/similarity/detectedLanguage |
| lip-sync processing status | **MISSING** | **Still lipSync:false only — by design** (no lip-sync stage exists to report; §1) |
| final video segment mapping | **MISSING** | **EXISTS (via the dialogue join)** | startSec/endSec on the final timeline = the machine-readable segment map |

**Timestamp-conflict / duration-mismatch detection — OLD → NEW:**

- Scene-level over-stuffing: detected + bounded stretch + honest note — **pre-existing, retained** (`:927–937` pre-fix; `:1161` current).
- **End-of-film overflow: OLD silently truncated (`atrim` + `-t`) → NEW detected + honest note + recorded evidence (C-F03).** Current: lines crossing `totalSec` are recorded as `{line, overflowSec, action: 'truncated'}` with the honest partial note "…চলচ্চিত্রের শেষ ছাড়িয়ে যায় … শেষ N সে. কাটা পড়ে (action: truncated, C-F03)" (short_film.ts:1511–1526); the same treatment now covers **A5 narration overflow** (D-F06, `:1683–1687` — the real run's 87%-narration-loss class). No silent stretch/truncate remains.
- **Pre-mux assert (C-F08): OLD near-tautological post-mux `avSyncOk` → NEW pre-mux audio-total check.** Current: `preMuxAudioTotalSec` compared against video duration *before* mux with an honest note when larger (`:1895–1900`), and persisted in `technicalReport` (`:2031–2032`) so an E-F02-class silent trim is provable from metadata.
- Overlap conflicts: impossible by construction (sequential cursor) — retained.
- `lipSync:false` retained on the final artifact — the §5 honest-status marker is untouched by all of the above.

---

## 4. Honest-status inventory — 20 user-facing mouth/acting surfaces

Findings-c §4 audited all 20 surfaces: **18 HONEST** at `c7927f7` (universal pre-confirmation note capabilities.ts:461–471; plan limitation planner.ts:885; studio-view tool cards 291–319/345–385; guide-view 141/200–204/293; production-card 325; health panel system-info.ts:309–313; tool registry types.ts:311–318; availability-matrix 285–318; lip_sync tool throw tools/video.ts:1077–1102; intent classifier 224–232/473–477 — live-tested REG-12k; music_video result note :816; acting-coach anti-overclaim prompt short_film.ts:612; descriptive pipeline-stage mentions). **The 2 former gaps are now fixed:**

- **C-F05 (completed-card gap) — FIXED.** `ParsedResult` now has `notes?: string[]` rendered under the result summary (production-card.tsx:180–213, defensive against old results) — MV's "লিপ-সিঙ্ক নেই" result note now reaches the completed card, and the SF result pushes an equivalent user-visible note.
- **C-F06 (film-dialogue mode card gap) — FIXED.** The most dialogue-heavy mode card now carries the sibling statusNote: "সংলাপ-কণ্ঠ ও সাবটাইটেল — ঠোঁট-সিঙ্ক নয়" (studio-view.tsx:373; film-short's equivalent at :354).

**Net post-fix: 20/20 honest.** Every place a user could infer mouth-sync carries an honest disclaimer, and the one place mouth-sync would be *executed* still throws.

---

## 5. Integration options (environmental truth — unchanged, nothing fabricated)

- **Local models infeasible on this box** (2 CPU / 4.1 GB RAM / no GPU): Wav2Lip ≈4 GB VRAM, SadTalker ≈6–8 GB, MuseTalk ≈8–12 GB (near-real-time), LivePortrait GPU-oriented — all `gpuRequired: true` in the hardware gate. CPU-only Wav2Lip would take minutes-to-tens-of-minutes per line and starve the sandbox (precedent: Demucs deliberately not installed for exactly this reason — hardware-gate.ts:199–202). Licenses: Wav2Lip weights academic/non-commercial conditioned; all `needs_review`. **No forced local inference** (master §10 rule).
- **Hosted-API options — categories listed, costs deliberately NOT fabricated** (pricing/rate limits/terms must be verified from vendor docs before any budget request):
  1. Commercial talking-head platforms (photo/avatar + audio → talking video): D-ID, HeyGen, Synthesia, Hedra — per-minute credit models.
  2. Model-hosting platforms running open lip-sync models (Wav2Lip / SadTalker / LivePortrait / MuseTalk ports): Replicate, fal.ai, RunWare — per-second compute billing; underlying weights' license still applies.
  3. Dedicated lip-sync/retargeting APIs (mouth motion onto existing video): Sync Labs (sync.so) and similar — matches the shot-clip-driven flow.
  4. z-ai-web-dev-sdk: **not an option today** — no lip-sync endpoint (§1).
- All of the above remain **BLOCKED — LIVE PROVIDER NOT AUTHORIZED** until the user approves provider, usage scale, and cost (unknown costs reported as unknown, never estimated).

---

## 6. Future integration contract (design only — from findings-c §6.3)

**Input schema per job:**

```
LipSyncJob {
  dialogueAudio: { artifactId, sha256, language, voice, durationSec, sampleRate,
                   verificationVerdict }              // §5.2 fields — prerequisite NOW EXISTS (§3)
  sourceFace: { kind: 'portrait_image' | 'shot_clip', artifactId, characterId,
                shotId?, sceneId?, consent: 'ai_fictional' }   // CONSENT_RULES apply
  timing: { timelineStartSec, timelineEndSec }        // placement on final timeline
  mode: 'talking' | 'singing'                         // singing needs a separate benchmark
}
```

**Provider adapter interface** (mirrors `ai_video.ts` submit/poll/validate): `submit(job) → taskId`, `poll(taskId) → buffer`, `validate(buffer, job) → {ok, evidence}` — per-provider timeout, bounded retry, error classification (same phase rules as TTS/video adapters).

**Validation gates — all must pass before any `lipSync:true`:**

1. **Duration match** — |generated video − dialogue audio| ≤ 0.3 s; any correction logged with limits + evidence (no silent stretch/truncate — the C-F03 class of defect is now structurally guarded at the existing stage too).
2. **Face coverage** — face (and mouth region) detected in ≥ agreed share of frames; failure ⇒ honest `FACE_NOT_FOUND`, never a silent static-face pass.
3. **Mouth-motion ↔ speech alignment** — motion-energy vs audio-envelope correlation as a *heuristic screen* + cloud-VLM spot-check, both documented as NOT proof (§5.4: "কোনো metric একা perfect lip-sync প্রমাণ করে না"); human review fields stay NOT REVIEWED until reviewed.
4. **Identity preservation** — existing `visionCompare` continuity pattern against the character-bible portrait.
5. **Artifact registration** — output clip with `lipSync:true`, gate evidence, and the dialogue-artifact ID join (the join now exists — §3).

**Honest failure states:** `LIP_SYNC_UNAVAILABLE` (today's status), `LIP_SYNC_PROVIDER_TIMEOUT`, `LIP_SYNC_PROVIDER_FAILED`, `FACE_NOT_FOUND`, `DURATION_MISMATCH`, `ALIGNMENT_LOW` — surfaced as §9-style statuses; the UI copy pattern already exists (`studio-view.tsx:296` `status:'unavailable'`).

---

## 7. §5.5 test-matrix status (14 enumerated cases; the brief's "15" was a count error, recorded by findings-c)

| # | §5.5 case | Status (post-R-FIX) | Evidence |
|---|---|---|---|
| 1 | One Bengali spoken line | **BLOCKED (model)** | speech half covered (t1/t20 bn contracts); lip-sync half impossible |
| 2 | Multiple Bengali lines | **BLOCKED** | adjacent: t19 asserts ≥2 per-dialogue artifacts, no mouth claim (t19:307–311) |
| 3 | Different-length lines | **BLOCKED** | adjacent: measuredSec per line + bounded scene stretch exercised in t19 |
| 4 | Two speakers alternating | **BLOCKED** | per-character voice map + (new) speaker→shot matching exist; no speaker→face mapping possible |
| 5 | Silent shot | **BLOCKED (no lip-sync stage to skip)** | adjacent: dialogue-less scenes handled + tested (t16/t17/t19) |
| 6 | Mouth-not-visible shot | **BLOCKED (no face detection — C-F10)** | — |
| 7 | Face-detection failure | **BLOCKED (no face detection)** | — |
| 8 | Unsupported input format | **BLOCKED (no adapter)** — arg-schema on the gated tool (tools/video.ts:1084–1089) still untested (C-F09-adjacent) | TESTABLE-NOW, not yet implemented |
| 9 | Mismatched audio/video duration | **EXISTS — strengthened by t21** | OLD: t9 REG-9b real-ffmpeg A-V sync + MV trim-with-note, gap = dialogue overflow. NEW: **REG-21b** locks film-end overflow detection + honest note + the timing-contract persistence (§3) |
| 10 | Lip-sync provider timeout | **BLOCKED (no provider)** | gated tool `timeoutMs: 10_000` untested |
| 11 | Lip-sync provider failure | **BLOCKED as provider test — TESTABLE-NOW as honest-gate test, STILL OPEN (C-F09)** | `runLipSync` throws the honest 4-dimension error (re-verified current tree `:146–149`) — **no unit test pins the throw yet**; a regression could soften it unnoticed |
| 12 | Successful-output artifact registration | **BLOCKED (no lip-sync output can exist)** | honest analogue pinned: t19 `lipSync:false` + final artifact (t19:314–319) |
| 13 | Rerun & cancellation | **BLOCKED for the lip-sync stage** | general cancellation locked elsewhere (t17 cancel propagation; t3/t7) |
| 14 | Unsupported capability honest UI status | **EXISTS (strongest coverage)** | t12 REG-12k (classifier honest text, re-run live by R-C: 17/17), t13:69–70, t18:193–195, t16:473–476, t17:272–274, t19:319 — plus the now-rendered result notes (C-F05 fix) |

**Tally:** EXISTS ≈ 2 fully (14; 9 now much stronger — its TESTABLE-NOW gap realized by **t21 REG-21b**) · TESTABLE-NOW remaining ≈ 2 (8 arg-schema, 11 honest-gate — both C-F09-class, unimplemented) · **BLOCKED = 10** (all requiring a real model/provider or face-detection foundation). §8 regression-group mapping unchanged: timestamp mapping now EXISTS (C-F04 closed); face/source validation BLOCKED; unsupported capability EXISTS ×4 files; model failure/timeout BLOCKED + untested honest gate; artifact validation EXISTS for honest non-lipsync output; synchronization EXISTS at container level (t9 + new pre-mux assert), mouth-level BLOCKED.

---

## 8. Defect B verdict

**Lip-sync stays honestly BLOCKED — nothing fakes success.** The repo contains zero lip-sync machinery; the only executable lip-sync path is an always-throwing honest gate; the SDK offers no audio-conditioned video; disclaimers span the intent classifier, spec validation, plan preview, mode cards, capability matrix, health panel, tool registry, guide, result notes, and artifact metadata — now 20/20 honest after the C-F05/C-F06 fixes. The recovery round closed the *solvable* halves of Defect B without touching the blocker: the §5.2 timing contract is now persisted per line (text, timing, sample rate, shot/artifact joins), film-end overflow is detected and honestly reported for dialogue and narration alike, a pre-mux audio-total assert replaced a near-tautological check, and the future LipSyncJob contract's data prerequisite exists. Real lip-sync remains implementable **only** through the §6 provider contract after the user authorizes a hosted provider and accepts its (unknown, to-be-verified) cost — never via local GPU models on this 2-CPU/4.1 GB/no-GPU box, and never by softening the honest gate. The one remaining model-free debt is C-F09: pin the honest gate's throw with a unit test so it can never silently degrade into a fake success.

*No git mutations; no source/test modifications in this documentation task; `lip_sync_module.ts` verified unchanged (still throws).*
