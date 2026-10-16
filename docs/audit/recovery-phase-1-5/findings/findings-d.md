# Recovery Audit D — Cinematic Acting / Visual Quality (Critical Defect C §6)

- Task ID: R-D · Agent: Recovery Audit D (acting/cinematic specialist)
- Baseline: HEAD `c7927f7` (phase-5), working tree clean (git-tracked); untracked runtime
  data in `storage/` + `db/custom.db` AUDITED READ-ONLY and turned out to be decisive
  evidence (see §5 — a real, undocumented end-to-end provider run exists).
- Scope: master recovery prompt §6 (all), §3 Phase-5 list, §7 Layers C/D boundaries.
- Method: full read of `cinematic/{planner,types,capability_map,prompt,validate}.ts`,
  `production/pipelines/{short_film,music_video}.ts`, `video/{ai_video,lip_sync_module}.ts`,
  `production-card.tsx` (ShotPlanPreview), test locks t9/t10/t16/t17/t19 (read, not run —
  2-CPU rule), DB read-only via `bun:sqlite` (readonly), local ffprobe/ffmpeg (Layer C,
  budget-free) on existing artifacts. NO source file modified; no provider/LLM calls; no
  browser; no git mutation.

---

## 1. §6.1 Acting dimensions — full table

Status vocabulary per §6.1: SUPPORTED (mechanism exists+verified) / PROMPT_GUIDED (requested
via prompt text only, no guarantee) / UNSUPPORTED / NOT_VERIFIED. One status per row is the
*mechanism* status; a blanket **output-level verdict applies to all 12 rows: NOT_VERIFIED**
— the single real generated film in the repo (§5) has never been through a §6.4 review
sheet, no face/mouth/flicker analysis exists anywhere, and no other real provider video
exists. "Upgrade path" = what it would take to move the row to SUPPORTED.

| # | Dimension | Status | Evidence (file:line) | What it would take to upgrade |
|---|-----------|--------|----------------------|-------------------------------|
| 1 | Facial expression & scene emotion | PROMPT_GUIDED | SF: acting_plan LLM produces `facialExpression` (short_film.ts:610–613, stored :647) → `actingText` "facial expression …" (short_film.ts:1003) → prompt `extra` (short_film.ts:1014–1015, prompt.ts:33). MV: no facial channel — only generic `fallbackActionEn` ("Intimate close-up of the artist emoting…", planner.ts:167) + prompt suffix "realistic motion, cinematic, natural lighting" (prompt.ts:31). No output verification exists. | VLM frame review vs. plan emotion (budget-free on stored frames) → regression fixture; human review sheet on the real film |
| 2 | Eye gaze & attention direction | PROMPT_GUIDED | SF: acting `gaze` (short_film.ts:645) → "gaze …" in actingText (short_film.ts:1001). No plan-level gaze field (types.ts:139–175 has none); MV: none. Real-run shot-plan carries gaze info only inside free `actionEn` text. | Gaze as plan field (e.g. `looksAt: character/environment`) + prompt phrase + output check |
| 3 | Mouth movement with dialogue | UNSUPPORTED (honestly disclaimed) | No lip-sync: `lipSync:false` (short_film.ts:1556, music_video.ts:860), limitation "লিপ-সিঙ্ক নেই…" (planner.ts:885), lip_sync_module.ts:24–38 (blocked: license/provider/hardware/integration/benchmark). Dialogue is a separately mixed A1 audio layer (short_film.ts:1238–1250) with NO mouth-motion claim. | Provider lip-sync API (none in SDK v0.0.18) or local model (no GPU) — currently a hard blocker, correctly declared |
| 4 | Head movement & body gesture | PROMPT_GUIDED | SF: acting `action`/`bodyHands` (short_film.ts:644,646) → "Acting: … / body language …" (short_film.ts:1000,1002). MV: none beyond actionEn. Note: KenBurns `fallbackMove` is CAMERA motion, not body motion (capability_map.ts:23–27). | Output motion-plausibility check (e.g. VLM per-shot body review) |
| 5 | Action continuity | PROMPT_GUIDED (weak, incidental) | No dedicated mechanism. Side-benefit: all shots of a scene share the same `actionEn` (scene.visualEn, planner.ts:652–655) + same deterministic `lightingMood` (planner.ts:657, 441–456); 0.4s crossfade (short_film.ts:177, 1419). No continuity constraints between shots, no output check (continuity step checks identity only, ≤3 shots — short_film.ts:1351–1408). | Per-shot continuity deltas in the plan contract + VLM adjacency check |
| 6 | Subject identity / appearance consistency | **SUPPORTED (single character per shot, with a hard two-character gap)** | Real mechanism: character portraits (short_film.ts:475–598) → i2v `imageUrl` reaches the provider body (short_film.ts:1040, music_video.ts:502; ai_video.ts:351, key `image_url`); cinematic_motion path: `editImageBuffer("Same person (identical face, hair, outfit) now in: …")` (short_film.ts:1105–1112, music_video.ts:556–563); VLM continuity check portrait-vs-frame (short_film.ts:1382–1394). Verified in the real run: 2/2 checked frames matched ("একই ব্যক্তির মুখ, ছোট চুল এবং সাদা পোশাক", Production cmvbbv86c… resultJson.continuityWarnings). GAP: only `scene.characters[0]` ever populates a shot (planner.ts:660–662) → the second character of a two-character scene is NEVER i2v-conditioned — identity for character B is UNSUPPORTED. | Multi-character conditioning (provider takes one image_url) or per-shot character-A/B composition; widen VLM check beyond 3 shots |
| 7 | Camera framing & subject position | PROMPT_GUIDED | `sizeFramingPhrase` (capability_map.ts:64–83) → prompt (prompt.ts:24); delivery verdict `prompt_guided` on ai_diffusion (capability_map.ts:55–56); honest limitation "শট-ফ্রেমিং ও অ্যাঙ্গেল প্রম্পট-নির্দেশিত — ফলাফলের নিশ্চিত রূপ নয়" (planner.ts:884). Real run: provider ignored the 9:16 size for 1 of 3 clips (returned 1890×1080; see §5) — framing genuinely not guaranteed. | Provider-native framing params (none) or post-gen framing VLM check |
| 8 | Scene-to-scene visual continuity | PROMPT_GUIDED | Deterministic per-scene lighting map (planner.ts:441–456, REG-16f2) + scene-consistent actionEn/lighting in every shot of a scene; scene purposes/transitionIntent are planning-only (types.ts:129–136, planner.ts:520–534). No output verification beyond identity VLM (≤3 shots). | Cross-scene VLM comparison + review sheet |
| 9 | Speaker reaction & conversational turn-taking | UNSUPPORTED (structural gap, proven by real run) | Coverage *sizes* exist: SF dialogue scenes get medium→OTS→reaction slots (planner.ts:558–571, reaction only at k=2 when dialogueCount≥2); MV `reactionSlot` only when N≥6 && hasArtist (planner.ts:236–246). BUT dialogue lines are never attached to shots: audio placed sequentially from scene start (short_film.ts:967–977), `acting.speaks` is collected (short_film.ts:648) but NEVER reaches the prompt (actingText :998–1007 omits it); cameraMotion already documented-only (:649–651). Real-run proof: আকাশ's line played 9.75–13.37s (tail of the *establishing* shot, spilling into scene 2) and প্রিয়া's 10.6s line ran 13.62–24.22s across the dialogue shot AND the closing shot in which the story says she has left (SRT artifact + shot-plan windows). | Plan-level line→shot assignment (speaker field on shots, `speaks` into prompt, cue timing locked to the speaker's shot) |
| 10 | Unnatural body motion / face deformation / temporal flicker | UNSUPPORTED | No detection mechanism anywhere (no face tracking, no flicker/frame-diff analysis; continuity step is identity-only VLM, short_film.ts:1382–1394). No claims are made either — but nothing can even detect a violation. | Add Layer-C offline checks (frame-diff flicker heuristic) + VLM artifact review on stored frames |
| 11 | Repetitive identical shots | PROMPT_GUIDED mitigation + deliberate reuse residual risk | Plan-level variety rules: no consecutive same non-static movement (planner.ts:202–208 MV, :618–629 SF; REG-16a3b/c), adjacent-size energy-pair alternation (planner.ts:287–315; REG-16a4). Prompt differentiation ⇒ distinct cache keys (movement/framing phrases in fingerprint, shot_cache.ts:141–153; REG-16l t16:625–642). RESIDUAL: identical prompts (e.g. user overrides two shots to the same size+movement+action) intentionally reuse the SAME cached clip (REG-10a "same input → validated hit") — duplicated footage inside one film is possible and undetected. | Plan-level duplicate-prompt detector (hash prompts, flag identical shots) + output-level dedup |
| 12 | Unexplained position/costume changes | PROMPT_GUIDED (identity path only) | Mitigations: i2v portrait conditioning (single character, see #6); "identical face, hair, outfit" edit text (short_film.ts:1109); VLM checks মুখ/চুল/পোশাক for ≤3 character shots (short_film.ts:1385). Position changes unchecked; second character unchecked; >3 character shots unchecked. | Extend VLM continuity to all character shots + position-consistency question |

**Counts (mechanism-level): SUPPORTED 1 · PROMPT_GUIDED 8 · UNSUPPORTED 3 · NOT_VERIFIED 0.**
Output-level: **all 12 NOT_VERIFIED** — no §6.4 review of the one real film (§5), no
automated acting-quality measurement exists in the repo.

---

## 2. §6.3 Camera & shot continuity — checklist results

1. **Shot plan → provider prompt/params: VERIFIED (locked).** MV prompt built from the plan
   shot (music_video.ts:495 `buildCinematicVideoPrompt(shot.cinematic, …)`), SF same
   (short_film.ts:1014–1015 with acting text as `extra`); all generation-affecting fields
   flow through prompt.ts:21–35 (E3 marker-proven, worklog P5-4c). Locked by REG-17a
   (t17:236–240 — submitted provider prompts CONTAIN `sizeFramingPhrase('establishing_wide')`
   + `movementPhrase('zoom_in')`) and t19:293–294 for SF. Provider body keys are exactly
   `{prompt, duration, quality, watermark_enabled, image_url, with_audio, size, request_id}`
   (ai_video.ts:345–354) — **no native camera parameter can reach the provider**; body-key
   subset locks at t17:247–251 and t19:301–304.
2. **Wide/medium/close-up variation: VERIFIED at plan level.** MV adjacent-size energy-pair
   alternation with penultimate-wide guard + honest exhaustion adjustment
   (planner.ts:287–315, REG-16a4); arc slots exempt by design. SF: per-scene slot pattern
   medium→OTS→reaction (dialogue) / wide→medium→insert (action) (planner.ts:547–592);
   cross-scene size repeats are intentional coverage (design §3, P5-5a reconciled). Real
   run: establishing_wide→medium→wide — varied.
3. **Camera movement prompt-only vs native: VERIFIED honest.** `classifyMovement`
   (capability_map.ts:43–57): ai_diffusion → always `prompt_guided` ("CogVideoX-3-এ কোনো
   নেটিভ ক্যামেরা-প্যারামিটার নেই"); cinematic_motion → 5 local KenBurns moves
   `local_motion`, dolly/handheld/orbit → `downgraded_to_local` with deterministic
   fallback + honest reason (DOWNGRADE_MOVE, capability_map.ts:17–21). UI badges carry the
   same verdicts (types.ts:248–254, production-card.tsx:1139–1159).
4. **Scene order preserved: VERIFIED.** Shots pushed in scene order (planner.ts:539–666),
   validator enforces `order === i` + unique ids + scene references (validate.ts:64–75),
   timeline concatenates in `shots` order (short_film.ts:1416–1420, music_video.ts:700–702).
   Real run: S01→S02→S03 order intact in the 30s film.
5. **Shot-cache incompatible-reuse risk: CLOSED (REG-16l + E4), one documented-by-design
   exclusion + one residual.** Fingerprint = full provider request incl. the plan-built
   prompt (ai_video.ts:555–568 → shot_cache.ts:141–153); movement change → new key,
   framing change → new key, identical resubmit → same key (measured sha256 a≠b/a≠c/a=d,
   worklog P5-4d; REG-16l t16:625–642; REG-10b every-field miss). Residuals: (a) w/h/fps
   deliberately excluded from the key — local deterministic normalization is re-applied on
   hit; the real run shows why this is load-bearing (provider returned 31fps 1080×1440 and
   1890×1080 clips for a 1080×1920@24 request — all locally normalized; see D-F11);
   (b) identical prompts intentionally share footage (dimension #11) — correct per-shot
   caching semantics, but a same-film duplication risk.
6. **Final duration & audio mix: VERIFIED in tests + real run, with two real-run defects.**
   Duration/A-V: music_video final_qc trims to the song's used length ±1.5s
   (music_video.ts:741–769) and A/V stream-delta <0.5s check (:791–807, short_film.ts:1487–1502);
   REG-9b/t9 locks duration/layout/A-V sync; loudness −16 LUFS target, TP ≤ −1.2 dBTP
   (REG-9a, sound_design DEFAULT_MIX_RULES). Real run independently re-verified (Layer C):
   final exactly 30.000s, video/audio streams both 30.000s, true peak −1.5 dBFS, mix
   issues []. **Defects found in the real run:** A5 narration truncation (D-F06) and
   loudness-field/signal mismatch (D-F07).

---

## 3. §6.2 Romantic short-film scenario feasibility (current pipeline)

### 3.1 What the deterministic planner CAN produce (structure — verified in code + real run)

- Opening environment+distance: first-scene first slot `establishing_wide` + `environment`
  subject (planner.ts:553–556) — real run S01 exactly this.
- Scene purposes matching §6.2 beats: "পরিচিতি ও ভৌগোলিক স্থাপন" / "সংলাপ-কভারেজ" /
  "অ্যাকশন-কভারেজ" / "সমাপনি" (planner.ts:520–534; real-run shot-plan.json SC1–SC3).
- Interaction framing vocabulary: OTS + reaction sizes exist in the dialogue slot pattern
  (planner.ts:558–571) — when ≥3 shots are allocated to the dialogue scene.
- Emotional beat via dialogue: script LLM writes dialogues (≤5/scene, ≤300 chars,
  short_film.ts:310–317), Bengali enforced + one rewrite attempt on language mismatch
  (:320–368); per-voice verified TTS (:776–833); per-line artifacts with verdicts
  (:856–883); subtitles burned with measured timings (:1433–1470).
- Two character portraits in the bible (both আকাশ and প্রিয়া got portraits in the real
  run — short_film.ts:477–479 builds `needed` from scene.characters), Character-table
  reuse across runs (:485–502).
- Ending beat: last covered scene's final shot = `zoom_out` + `transitionIn: 'সমাপনি-বিট'`
  (planner.ts:603–606, 663) — real run S03.
- Honest labels throughout: delivery badges, beat-source, limitations, `lipSync:false`.

### 3.2 What it CANNOT produce (gaps — each proven in the real run where marked)

1. **Two named characters in one shot / per-shot character attribution** — plan contract
   has a single `character?` slot and the planner fills it with `scene.characters[0]` only
   (planner.ts:660–662). Real run: প্রিয়া never appears as any shot's character → her
   portrait never conditioned a shot; "the OTHER character reacts" is inexpressible.
2. **Gaze/eye-contact as structure** — only free text (acting `gaze` / visualEn); no plan
   field, no verification (dimension #2).
3. **Dialogue-to-shot speaker alignment** — lines float across shot boundaries
   (short_film.ts:967–977); `speaks` never reaches prompts. Real run: both lines misaligned
   (dimension #9). Turn-taking (A speaks→B reacts coverage) cannot be directed.
4. **Reaction close-up at 30s** — `shortFilmShotCount` = ceil(30/10)=3 for ai_diffusion
   (planner.ts:432–436) → 1 shot/scene → the dialogue scene got a single medium/static
   shot; OTS and reaction slots require ≥2/≥3 shots in that scene (planner.ts:558–571).
   Real run: no OTS, no reaction shot in the whole film.
5. **Mouth movement with dialogue** — lip-sync blocked (dimension #3), correctly disclaimed.
6. **Prompt-language contract enforcement** — the real run shipped **Bengali `actionEn`**
   into CogVideoX-3 prompts (shot-plan.json S01–S03 actionEn all Bengali; script LLM
   returned Bengali visualEn despite the English instruction short_film.ts:240, and the
   planner's fallback deliberately mixes Bengali location/action — planner.ts:414–417,
   652–655). t19 only locks the mocked-English path (t19:296–297). No runtime script check
   exists on the generation path (D-F03).

**Feasibility verdict: PARTIALLY EXPRESSIBLE.** The §6.2 skeleton (environment → dialogue
scene → ending, subtitles, honest labels, single-character identity) is expressible and
was in fact produced end-to-end once; two-character interaction, gaze, reaction coverage
at short durations, speaker alignment, and mouth movement are NOT expressible today.

### 3.3 Budget-free, fixture-based test-plan skeleton (for the fix wave)

All cases hermetic (Layer A/B): deterministic planner + prompt builders + fake pipeline
handle (t19 harness pattern); no provider/LLM/TTS calls.

- **T-R1 plan structure:** `planShortFilmShots` on a 2-character romantic fixture (3
  scenes: [আকাশ, প্রিয়া], dialogueCount 2/1/0, 30s, ai_diffusion, limit 3) → assert
  scene purposes (পরিচিতি…/সংলাপ-কভারেজ/সমাপনি), S01 establishing_wide/environment, last
  shot zoom_out + transitionIn, character slot = characters[0] (documents today's limit).
- **T-R2 shot-budget geometry:** same fixture at 45s/60s → assert dialogue scene gains
  OTS (k=1) and reaction (k=2, dialogueCount≥2) slots; at 30s assert they cannot appear
  (budget proof for D-F04/3.2#4).
- **T-R3 prompt-language guard (post-fix):** fixture with Bengali visualEn/actionEn →
  post-fix behavior (detect + honest note or English rewrite) asserted; today's test would
  FAIL — that's the point (D-F03).
- **T-R4 speaker alignment (post-fix):** timedLines placed inside the speaker's shot
  window; assert no line crosses a shot boundary unless its measured length exceeds the
  scene (then the existing honest note fires). Today: SRT-style assertion of the real-run
  misalignment reproduces the bug (D-F02).
- **T-R5 two-character conditioning (post-fix):** shot with characters [A,B] → both
  portraits considered (or honest single-ref note); assert `image_url` uses the RIGHT
  portrait for reaction/OTS shots.
- **T-R6 acting-text reach:** acting fixture {gaze, bodyHands, facialExpression} →
  `buildCinematicVideoPrompt(shot, style, actingText)` contains each phrase; `speaks`
  documented-only today (assert absent) — flips post-fix.
- **T-R7 prompt-distinctness (dimension #11):** plan with two same-scene shots → prompts
  differ (sizeFramingPhrase/movementPhrase); force two identical shots via overrides →
  duplicate-prompt detector (post-fix) flags or honest note; assert cache keys equal only
  for identical prompts.
- **T-R8 narration budget (post-fix, D-F06):** fixture narration 41.1s + film 30s →
  assert honest overflow note OR duration extension; today the mix silently truncates.
- **T-R9 verdict honesty (post-fix, D-F05):** speechVerification containing a `fail` →
  `result.quality` no longer "চমৎকার" (or problems include it); step detail counts
  fail-verdict lines separately from successful ones.
- **T-R10 Layer-C forensics on the REAL artifact (§5):** ffprobe/ebur128/silence asserts
  against the existing files (durations 30.000/30.000, TP −1.5, dialogue-2 10.6s with ≤1
  silence gap) — locks the evidence and any re-measurement; plus a §6.4 review-sheet
  template (human "NOT REVIEWED" defaults) checked into docs.

---

## 4. Evidence-truth audit — claims vs delivery (§6 intro, §3-Phase-5 last bullet)

Greps run: `অভিনয়|acting|realistic|বাস্তবসম্মত|natural|emotion|আবেগ` over
`src/components/`, `cinematic/types.ts`, `docs/audit/phase-5/`. UI copy is largely honest
(explicit disclaimers at production-card.tsx:325 "ফটোরিয়ালিস্টিক অভিনয়ের নিশ্চয়তা নেই",
studio-view.tsx:278, guide-view.tsx:293; badges "প্রম্পট-নির্দেশিত (নিশ্চয়তা নয়)" /
"সৎ-বিকল্পে নামানো" types.ts:248–254, production-card.tsx:1139–1159; limitations block
planner.ts:878–885 rendered at production-card.tsx:1358–1367). Overstated / stale claims
found:

| # | Location | Current text (gist) | Honest alternative |
|---|----------|--------------------|--------------------|
| O-1 | short_film.ts:1560–1563 (result.quality, real run) | "চমৎকার — …" while a dialogue line had verification verdict **fail** (10.6s for a 5-word line) — verdict is computed from technical `problems` only | Weigh speechVerification fails into the verdict wording (e.g. "কার্যকর, তবে সতর্কতা: সংলাপ-যাচাই ব্যর্থ") |
| O-2 | docs/audit/phase-5/phase-5-exit-report.md §4 | "Live provider/LLM end-to-end generation with real budget — NOT RUN … no paid calls were made in Phase 5" | Agent-work claim is true, but the repo now contains a real user-initiated E2E run (18:55–19:18Z, 3 CogVideoX-3 clips — §5) finished 29s before the phase-5 commit; record it as existing-but-unreviewed evidence |
| O-3 | production-card.tsx:356 | ai_diffusion label "…রিয়েলিস্টিক, ধীর…" — "realistic" is an unverified quality adjective (real run: one clip came back 1890×1080 landscape for a 9:16 film; content unreviewed) | "প্রকৃত AI ডিফিউশন ভিডিও (CogVideoX-3) — ধীর…" (drop the quality adjective) |
| O-4 | production-card.tsx:322–323 | ai_diffusion note "প্রতিটি শট … প্রকৃতভাবে তৈরি হয়" without mentioning the storyboard+KenBurns fallback path | Add "রেট-সীমা/ব্যর্থতায় কিছু শট স্টোরিবোর্ড+ক্যামেরা-মোশনে নামতে পারে (ফলাফল-লেবেলে দেখা যাবে)" |
| O-5 | short_film.ts:911 (step detail) | "2/2 সংলাপ-লাইন সফল" — counts a fail-verdict line as সফল | "২/২ লাইন TTS-ফেরত; ১টির যাচাই-রায় ব্যর্থ" |
| O-6 | short_film.ts:1549–1551 (technicalReport.loudnessLufs) | −16.3 LUFS measured on the 65.8s pre-trim mix; the delivered 30s MP4 measures **−14.4 LUFS** (independent ebur128, §5) | Measure/report loudness on the delivered (post-trim) signal or label the field's signal explicitly |

Overstated-claims count: **6** (1 user-facing verdict wording P2-class; 1 stale doc; 4
copy/labeling minors). No fabricated-capability claims found — the honesty architecture
(badges/limitations/honestLabel) is real and consistent.

---

## 5. Visual-evidence inventory (§7 Layer C input)

Untracked runtime state (git-ignored: `/storage/`, `db/*.db`) — never covered by any
git-based phase audit:

- **REAL end-to-end short-film run — the exact §6.2 romantic scenario** —
  Production `cmvbbv86c000apzrc9mra61oi` (status **partial**; spec: 30s romantic short
  film, 9:16, bn, ai_diffusion, filmMode short_film, sound narration; title is
  user-imperative phrasing "🎬 ৩০ সেকেন্ডের রোমান্টিক শর্টফিল্ম বানাও"). Started
  2026-10-16T18:55:23Z, finished 19:18:52Z — **29 seconds before the phase-5 commit
  c7927f7 (19:19:21Z)**; the master recovery prompt file was pasted at 19:18:13Z,
  i.e. this run is almost certainly the user's own pre-recovery-prompt test. Undocumented
  in worklog/docs.
  - `storage/artifacts/`: screenplay.txt ("দুঃখের বৃষ্টি", 3 scenes, আকাশ+প্রিয়া),
    shot-plan.json (3 shots; **Bengali actionEn** — D-F03), 2 character portraits
    (both `fileName: "bible-studio.png"` — duplicate artifact filename, cosmetic),
    narration-a5.wav (41.1s), dialogue-1 (warn: Edge 403 → z-ai fallback, similarity 0),
    dialogue-2 (**fail**: 10.6s for "বৃষ্টি ভালোই লাগে।", 1 silence-gap ≥0.5s at −40dB —
    mostly continuous garbage/repetition), dialogue SRT, final `studio.mp4` 17.4MB.
  - `storage/shot-cache/`: 3 REAL CogVideoX-3 clips (meta.json model `cogvideox-3`, taskIds
    20261017025850…/030618…/031206…, hasAudio:false): 10.29s 1080×1440@31fps,
    10.29s 1080×1440@31fps, 10.23s **1890×1080@31fps** (landscape for a 9:16 request —
    provider ignores size; local normalization re-applies w/h/fps, exactly why the
    fingerprint excludes them).
  - Final MP4 (Layer-C re-verification, local ffprobe/ebur128): 30.000s, 1080×1920@24,
    h264+aac, video/audio streams both 30.000s (avSyncOk true — report claim confirmed),
    true peak −1.5 dBFS, integrated loudness **−14.4 LUFS** (report said −16.3 on the
    pre-trim 65.8s mix — O-6), subtitles burned, loudness range LRA 4.4.
  - resultJson: aiShots 3/3 ("সব 3টি শট প্রকৃত AI (cogvideox-3)"), 4 audio layers, VLM
    continuity 2/2 same-person OK, cinematicPlan summary (3 prompt_guided, honest
    limitations), 6 partialNotes (incl. the fail verdict + dialogue-longer-than-scene note
    **pushed twice** — D-F10).
  - **Acting quality of this artifact: NEVER reviewed.** No §6.4 review sheet, no
    frame-level analysis, no face/mouth/flicker measurement anywhere in the repo. This is
    the single most valuable recovery input and it is sitting unanalyzed.
- Older artifacts: 1 PNG 15:48 (prior session), `storage/tts-cache/` 14 entries,
  `storage/llm-chat/` cache — no other provider video.
- **What quality claims would require:** Layer-D live runs (BLOCKED — not authorized) or
  Layer-C forensics + human review of the existing real artifact (budget-free, available
  NOW — T-R10).

---

## 6. Findings register (D-Fnn)

| ID | Severity | Finding | Evidence |
|----|----------|---------|----------|
| D-F01 | P1 | Real E2E provider evidence exists (user-initiated romantic short film, 3 real CogVideoX-3 clips + final 30s film) but is undocumented and 100% unanalyzed for acting quality; every §6.1 output-level verdict is NOT_VERIFIED because of this gap | §5; storage/artifacts + shot-cache + db Production cmvbbv86c…; exit-report §4 stale |
| D-F02 | P1 | No dialogue→shot speaker alignment: audio lines placed by scene-sequential cursor, can play over non-speaking/wrong-character shots; `acting.speaks` never reaches prompts | short_film.ts:967–977, :998–1007, :648; real-run SRT 9.75–13.37 / 13.62–24.22 vs shot windows |
| D-F03 | P1 | Prompt-language contract unenforced on the generation path: Bengali `actionEn` reached CogVideoX-3 in the real run (script LLM ignored the English-visualEn instruction; planner fallback deliberately mixes Bengali) | shot-plan.json S01–S03 (all Bengali actionEn); short_film.ts:240, planner.ts:414–417/652–655; t19:296 locks only the mocked-English path |
| D-F04 | P2 | Single-character slot per shot: `scene.characters[0]` only → two-character romantic interaction (B reacts, B referenced) inexpressible; second portrait never conditions a shot | planner.ts:660–662; short_film.ts:996 (`find(Boolean)` first match); real run: প্রিয়া never a shot character |
| D-F05 | P2 | Fail-verified dialogue audio still mixed in AND the top-line verdict stays "চমৎকার" (verdict ignores speechVerification); status=partial is the only honest signal | short_film.ts:904–909 (notes only), :1560–1563 (verdict from technical problems), :911; real run resultJson |
| D-F06 | P2 | A5 narration overflow: 41.1s narration scheduled from 24.7s inside a 30.0s film → ~36s silently truncated by the mux trim; no warning raised | short_film.ts:1325–1331, :1425–1431 (muxAudio to video duration); real-run layers "A5 বর্ণনা (24.7 সে. থেকে)" + sound_design detail "মিক্স 65.8 সে." |
| D-F07 | P3 | `technicalReport.loudnessLufs` (−16.3) describes the pre-trim 65.8s mix; delivered 30s MP4 measures −14.4 LUFS independently | short_film.ts:1549–1551/1592; §5 ebur128 measurement |
| D-F08 | P3 | "রিয়েলিস্টিক" quality adjective on the ai_diffusion engine label — unverified | production-card.tsx:356; real-run 1890×1080 clip |
| D-F09 | P3 | Speech step detail counts fail-verdict lines as "সফল" | short_film.ts:911; real run "2/2 সংলাপ-লাইন সফল" with one fail |
| D-F10 | P3 | Duplicate partialNote: dialogue-length note pushed twice (assignLinesAndDurations runs in generate_shots AND sound_design) | short_film.ts:934–937 called via :991 and :1234; real-run partialNotes |
| D-F11 | P3 | Provider framing non-compliance (9:16 requested → 1890×1080 + 1080×1440@31fps clips): handled by local normalization, but confirms framing/size are weakly honored; w/h/fps fingerprint exclusion is load-bearing, not just an optimization | §5 shot-cache ffprobe; ai_video.ts:555–568 comment |
| D-F12 | P3 | Duplicate artifact fileName ("bible-studio.png" ×2 for different characters) — cosmetic naming bug in artifact registration | db Artifact rows (bible-studio.png / আকাশ and প্রিয়া) |

**Totals: 12 findings — 3×P1, 3×P2, 6×P3.** No fabricated-capability dishonesty found;
the honest-label architecture is genuine and consistently applied (positive finding).
§6.3's six checklist items are all VERIFIED/locked with the noted residuals.

---

## 7. Constraints compliance

Read-only audit: no source file modified; only this findings file created (+ worklog
append). DB opened read-only (`bun:sqlite` readonly); ffmpeg/ffprobe local only (Layer C);
no provider/LLM/SDK calls; no browser; no git mutation; no test-suite run (test locks
verified by reading t9/t10/t16/t17/t19); no secrets printed (taskIds/artifact ids only).
