# Findings A2 — Repository Auditor, Phases 4–5 (integration lead, second half)

Agent: R-A2 (recovery audit A2). Scope: deep audit of Phase 4 (intent-aware planning & settings) and
Phase 5 (cinematic director & shot planning) per master recovery prompt §1/§3/§5.1/§6.3/§7 Layer A/B.
Method: read-only code audit of HEAD = `c7927f7` (Phase 5) with per-phase commit attribution
(`310c712` + `92eb66d` = Phase 4), integration trace UI → routes → runner → pipelines → provider
adapters → artifacts, verification that prior review/fix claims still hold, plus one permitted test
file run (t16, 22/22 PASS, 324 expects, 2.88s) and one empirical spot-check of the real intent
classifier (12/12 cases as expected). No source files modified; no provider calls; no git mutations.

---

## Findings

### A2-F01 — P3 — Dead exported function `verdictLabelBn` (Phase 4)
- **file:line**: `src/lib/agent/intent/classifier.ts:485-498`
- **evidence**: `grep -rn verdictLabelBn src tests` → only the definition (classifier.ts:485); zero
  consumers in src and tests. Exported "CapabilityVerdict → Bengali label" helper never wired.
- **why-it-matters**: Same dead-code class that Phase-5 review (P5-4f) flagged and P5-5a removed for
  cinematic (`CAMERA_ANGLE_LABELS_BN`, `isPreview`, unused `quality` inputs) — the Phase-4 module
  escaped that cleanup. Dead exports inflate the trusted surface and mislead future maintainers
  into thinking a verdict-label path exists.
- **minimal fix**: delete the function (or, if a consumer was intended, wire it into the hint-note /
  run-note path). One-line change; no test depends on it.

### A2-F02 — P3 — `schemaCache` never invalidates → stale song options on an open awaiting card (Phase 4)
- **file:line**: `src/hooks/use-config-panel.ts:25,50-51,60` + `src/components/studio/production-card.tsx:648-651`
- **evidence**: module-level `const schemaCache = new Map(...)`; effect returns early
  (`if (schemaCache.has(cacheKey)) return;`) and nothing in the codebase clears or TTLs it (grep:
  no `schemaCache.clear/delete`). The card hint at production-card.tsx:650 says
  "চাইলে চ্যাটে গানের অডিও আপলোড করে **আবার খুলুন**" — but reopening the collapsible does not
  refetch (same cacheKey hit); only a full page reload repopulates `sourceOptions.songs`.
- **why-it-matters**: a user who uploads a song *after* the music-video card was created cannot
  select it in the awaiting card (auto-wire in `create.ts:74-84` ran at creation time only, and
  confirm-time re-validation does not re-run it). The result is an honest-but-confusing dead end
  and a slightly misleading hint. Functional impact bounded: after a page refresh the song appears
  and the flow works; plan-preview is unaffected.
- **minimal fix**: invalidate/tombstone the cache entry when a new `user_upload` audio artifact is
  registered (e.g. export `invalidateConfigPanelCache(type, conversationId)` called from the upload
  artifact path), or add a short TTL (e.g. 60s) to cached schemas. Adjust the hint text to "পৃষ্ঠা
  রিফ্রেশ করুন" in the meantime.

### A2-F03 — P3 — `sanitizeOverridesInput` 64-entry cap silently ignores valid entries beyond the cap (Phase 5)
- **file:line**: `src/lib/agent/cinematic/planner.ts:775` (`for (const entry of shotsRaw.slice(0, 64))`)
- **evidence**: entries past index 64 are never examined — neither applied nor counted in
  `droppedCount`. A crafted 100-entry array (all valid) yields `droppedCount: 0` while 36 entries
  vanish (empirically demonstrated by P5-4e; code unchanged at HEAD — re-verified by reading the
  loop; no early-exit or total-length accounting was added).
- **why-it-matters**: `droppedCount` is the honesty signal surfaced as the
  `cinematicOverrides` adjustment in `validateSpec` (`capabilities.ts:368-375`), so over-cap valid
  edits disappear *without* the honest note — the exact REG-14l-class silent-drop shape §15 guards
  against, just at a batch-size boundary no UI flow reaches today (UI writes ≤1 entry per shot;
  maxShots ≤ 16 < 64). Documented as exit-report §6.4 follow-up — **confirmed still open**.
- **minimal fix**: after the loop, `if (shotsRaw.length > 64) dropped += shotsRaw.length - 64;` (or
  add a separate `overCapCount` into the honest note). One line + extend REG-16i with a >64-entry case.

### A2-F04 — P3 — Preview/pipeline song-origin parity gap: run path resolves ANY artifact, preview requires `user_upload` + same conversation (Phase 5)
- **file:line**: preview gate `src/app/api/productions/plan-preview/route.ts:120-146`
  (`art.conversationId === conversationId && art.kind === 'audio' && art.origin === 'user_upload'`);
  run path `src/lib/agent/production/pipelines/music_video.ts:110-115` +
  `src/lib/agent/production/runner.ts:382-388` (`resolveArtifactFile` — no origin/conversation check);
  `validateSpec` (`capabilities.ts:450-451`) merely flips `musicSource` on presence of an id.
- **evidence**: a crafted same-owner confirm body with a non-`user_upload` (or cross-conversation)
  audio artifact id passes §15 validation, and `song_input` measures that file (`beatSource:
  'measured'`) while the previewed plan silently fell back to the procedural grid — preview shows a
  different plan than the one that runs.
- **why-it-matters**: violates the "preview = run" promise at the contract's edge and is an
  intra-owner artifact-isolation gap (owner-only via `requireOwner`; single-user deployment, UI never
  offers non-upload artifacts — severity bounded). Documented as exit-report §6.1 — **confirmed
  still open**.
- **minimal fix**: in `loadCtx`/`resolveArtifactFile` (or at MV `song_input`), require
  `artifact.conversationId === run.conversationId` and (for the beat-measured branch)
  `origin === 'user_upload'`; otherwise fall back to procedural with an honest partialNote.

### A2-F05 — P3 — SF scene-level `lightingMood` is a generic placeholder string (Phase 5, documented)
- **file:line**: `src/lib/agent/cinematic/planner.ts:532` (`lightingMood: 'scene-appropriate cinematic
  lighting'`) and skeleton `:714`
- **evidence**: scene objects carry the same constant for every scene; the generation-affecting
  path is the per-shot `lightingMood` from `TIME_OF_DAY_LIGHTING` (`:441-456`, applied `:657`),
  which IS deterministic and reaches prompts (REG-16f2 lock; verified `buildCinematicVideoPrompt`
  consumes `shot.lightingMood` at `prompt.ts:30`). Field is labeled "planning-only provenance" in
  `types.ts:133-134`.
- **why-it-matters**: no dishonest claim (types/comments say planning-only; shot-level is real), but
  the placeholder adds no information to `shot-plan.json` scene sections. Documented as exit-report
  §6.3 — **confirmed**.
- **minimal fix**: derive scene-level lighting from the same `timeOfDayLighting(scene.timeOfDay)` map
  (cheap, deterministic) or drop the field from the scene contract.

### A2-F06 — P3 — SF preview skeleton has no movement/size diversity guard, and this known gap is NOT in the exit-report §6 follow-up list (Phase 5)
- **file:line**: `src/lib/agent/cinematic/planner.ts:722-724` (skeleton size/movement selection)
- **evidence**: skeleton mid-scene slots deterministically produce `pan_right` at every scene-first
  shot and `wide` at every non-first `k===0` slot — e.g. shotCount=sceneCount=4 yields
  `zoom_in, pan_right, pan_right, zoom_out` + `establishing_wide, wide, wide, medium` (consecutive
  non-static movement repeat + adjacent same size). P5-4f flagged "skeleton lacks diversity rules"
  (P2); P5-5a fixed the MV/SF run-planner rules (planner.ts:293-315, 618-629) but the skeleton was
  left as-is, and exit-report §6 (six candidates) does not carry it.
- **why-it-matters**: the skeleton is review-only (real SF plan is rebuilt from the script at run
  time via `planShortFilmShots`, which DOES enforce the rules), so no generation impact — but the
  preview can show a pattern the run-planner would never produce, and an audit-trail item known to
  reviewers is missing from the tracked follow-up list (process/documentation honesty).
- **minimal fix**: either add the §3 rule to the skeleton loop (alternate `pan_left/pan_right` and
  `wide/medium` by scene index) or add it as item 7 in exit-report §6 with the review-only rationale.

### A2-F07 — P3 — MV `character` slot-fill verified only at unit level; no integration lock (Phase 5, documented)
- **file:line**: fill `src/lib/agent/production/pipelines/music_video.ts:302-308`; noted missing in
  exit-report §6.2.
- **evidence**: t17's fixture energies produce no performance slots, so REG-17e and siblings never
  exercise the LLM-named-character → `shot.character` → `shot-plan.json` path; the code is present
  and reads correct (subject-gated, 60-char clamp).
- **why-it-matters**: a regression in the slot-fill (e.g. subject gate renamed) would pass the
  current suite silently. Coverage gap, not a code defect. **Confirmed still open** as documented.
- **minimal fix**: one t17 case with a fixture grid whose energies force an `artist_performance`
  slot and an LLM mock that names a character; assert `plan.shots[i].character` and the
  storyboard metaJson.

### A2-F08 — P3 — Process/publish: Phase-5 commit `c7927f7` is still unpushed; origin/main = `d982a4d` (Phase 5 completion gate)
- **file:line**: repo state — `git log --oneline -1 origin/main` → `d982a4d`; `git rev-list --count
  origin/main..HEAD` → `1`.
- **evidence**: P5-7 performed the §5 resolution (soft reset → single properly-labeled `c7927f7`
  on top of origin/main) but the push failed on expired/revoked credentials (worklog P5-7, honest
  record). Local history is clean and fast-forward-ready; remote has NOT received Phase 5.
- **why-it-matters**: master prompt §0/§3 requires verifying "GitHub-এর বাস্তব commit" — until a
  valid PAT lands and `git push origin main` succeeds, Phase 5 exists only locally; any sandbox
  loss would drop it. Not a code defect; a publish blocker awaiting user action.
- **minimal fix**: user provides a valid token (or fixes the embedded one) → plain `git push origin
  main` (fast-forward, no force). Then re-verify `git ls-remote origin refs/heads/main`.

### A2-F09 — P3 (observation, no action required) — `Math.round`-based `musicVideoShotCount`/skeleton scene-count edges are deterministic and honestly clamped
- **file:line**: `planner.ts:82-89, 689-691`
- **evidence**: shot-count formulas are clamped to `maxShots` budgets; E1 measurement (worklog
  P5-4a) cross-checked every reachable engine/limit combo. No defect found — recorded because §3
  asks for explicit verification that plan ↔ provider budget coupling holds.
- **minimal fix**: none.

---

## Verified claims that HOLD at HEAD (prior review/fix round — no regression)

| Claim | Where verified |
|---|---|
| MV movement-repetition rule (penultimate never `zoom_out`, quiet→`static`) | planner.ts:317-331; REG-16a3b green in t16 run |
| SF real repeat-fix map (`zoom_out` never an alternative) | planner.ts:618-629; REG-16a3c green |
| MV adjacent-size variety + honest exhaustion adjustment | planner.ts:124-147, 293-315; REG-16a4 green |
| validate.ts guards: beatSource/subject enums, totalPlannedSec finite, adjustments shape, ≤180s with in-code justification | validate.ts:39-41, 85-87, 98-99, 110-115, 119-143; REG-16d green |
| Stale-response guards in BOTH hooks (`useSpecValidation`, `useShotPlanPreview`) | use-config-panel.ts:109/119/136/147 and 201/213/220/225 |
| 422 path sanitize (`sanitizeErrorMessage` → `[ফাইল]`, ≤200 chars) on both 422 paths | plan-preview/route.ts:44-59, 106, 165 (REG-18j) |
| Copy unification "সৎ-বিকল্পে নামানো" across badge/counts/adjustments-header/result-summary + shared map | production-card.tsx (6 occurrences; zero legacy `ডাউনগ্রেড`/`সহায়ক বিকল্পে` in card), types.ts:253 |
| Shot header derives from CURRENT size (override-proof) | production-card.tsx:1264-1267 |
| Honest truncation label for >8 adjustments | production-card.tsx:1164-1165, 1344, 1350-1355 |
| §15 `cinematicOverrides` survival chain (card → confirm merge → validateSpec sanitize → specJson → runner re-validate → applyOverrides → prompts) | production-card.tsx:1191-1203; confirm/route.ts:64-74; capabilities.ts:358-376; runner.ts:185-188; music_video.ts:211-226; prompt.ts:21-35 |
| P4-2 null-clear song deselect (REG-14l) | production-card.tsx:624-634 (`{songArtifactId: null, musicSource:'procedural', sound: null}`) + confirm/route.ts:70-72 null-strip; REG-14l test present (t14:290) |
| Determinism: no RNG/Date in `cinematic/**` | grep clean at HEAD |
| Provider body ⊆ `{prompt, duration, quality, watermark_enabled, image_url, with_audio, size, request_id}` (no native camera params) | ai_video.ts:345-355; locked t17:242-247 / t19:301-304 |
| Zero-LLM plan-preview (deterministic planners + local ffmpeg only) | route.ts imports preview.ts only; preview.ts imports planner/music_engine/ffmpeg; no chatJson anywhere in the chain |
| SF shot-split LLM removed (3→2 chatJson per run), dialogue-rewrite call still conditional | short_film.ts:378-392 (planner), 606-627 (acting), 330-344 (conditional rewrite); t19 `expect(chatJsonCalls).toBe(2)` |
| Plan↔cache coupling: plan change → new fingerprint (prompt is the key input) | ai_video.ts:555-568 (`shotCacheFingerprint` on prompt+duration+quality+imageUrl+withAudio+size); REG-16l/10b locks |
| Honest unsupported status (lip-sync / sung song / stem separation) | classifier.ts:224-263 (checked first, `capabilityStatus:'unsupported'` + clarification); empirical spot-check 12/12 |
| No generation before confirmation | create.ts:107 (`awaiting_confirmation`), confirm/route.ts:53-54 (409 otherwise), runner loadCtx only accepts queued/running (runner.ts:177); browser E2E saw zero `/confirm` during preview edits |
| Server-side capability revalidation at confirm AND at run start | confirm/route.ts:74-80 (422 on failure), runner.ts:185-188 (throw on failure) |

**Contradictions vs worklog claims: none found.** Every checkable claim from P4-2, P5-4a–e,
P5-5a/b/c, P5-6/P5-7 that this audit re-verified holds in code at `c7927f7`. The six §6 follow-up
candidates are all confirmed open (F03/F04/F05/F07 map to §6.4/§6.1/§6.3/§6.2; §6.5 is the
browser-unexercised truncation label — present in code, noted under F-table claims above; §6.6 is a
design candidate, correctly not implemented). The only documentation gap found is F06 (skeleton
diversity guard missing from the §6 list). Live-provider acceptance remains honestly NOT RUN
(exit-report §4) — Phase 4/5 quality claims are code/test/browser-evidence based only.

---

## Phase 4 status

**Verdict: PASS** (no P0/P1/P2 findings; 2×P3 — F01 dead code, F02 stale song options; all core
§3-Phase-4 checklist items verified in code).

The 12 mandatory questions:
1. **মূল requirement**: বাংলা intent classification, category-specific settings panel, settings→
   payload, confirm-before-generate, server capability revalidation, honest unsupported, plan
   preview→pipeline connection.
2. **Commits**: `310c712` (implementation, 25 files +3707/−23) + `92eb66d` (P4-2 review fixes:
   REG-14l null-clear, t12 mock-leak fix; commit content also carries mode-only doc changes).
3. **Driving source files**: `intent/classifier.ts` + `intent/types.ts`; `orchestrator.ts:1016-1118`
   (classify once/run → AgentStep + metrics + fast-path + LLM hint-note) and `:620-721`
   (rate-limit fallback); `config-panel.ts` (schema builder); routes `config-panel/`, `validate/`;
   `use-config-panel.ts`; `production-card.tsx` (SpecEditor/PlanPreview/ValidationLiveBlock/confirm);
   `production/create.ts`; `[id]/confirm/route.ts`; `capabilities.ts` (§15 whitelist block);
   `run-metrics.ts` (intent metrics).
4. **UI থেকে ব্যবহারযোগ্য**: হ্যাঁ — awaiting card renders per-type SpecEditor fields, song-select
   (MV), live validation block, plan preview; browser-verified (P5-3: 671/671 requests 200, 0
   console errors). Limitation: F02 stale song list until page reload.
5. **Server handler → আসল pipeline**: confirm → validateSpec(merged) → `queued` → `startProduction`
   → runner `loadCtx` re-validates → `PIPELINES[type]` real pipelines (music_video/short_film/
   motion_video/image/audio). No mock path in production routes.
6. **Provider adapter প্রকৃত input ব্যবহার করে**: settings flow end-to-end — e.g. `durationSec` →
   `targetDuration` → shot count/cut grid; `style` → prompt suffix; `videoEngine` → engine branch;
   `cinematicOverrides` → plan → `buildCinematicVideoPrompt` → `submitVideoTask` body (ai_video.ts:
   345-355). Verified by REG-17e (override reaches provider/clip path).
7. **সফল ফলাফল validate ও register**: `validateSpec` adjustments/notes persisted into specJson at
   confirm; runner registers artifacts with metaJson; final_qc validates duration/A-V/resolution
   and writes resultJson.
8. **Automated tests**: t12 (intent routing), t13 (config panel), t14 (capability-confirm incl.
   REG-14l song-deselect), t15 (intent metrics & redaction) — plus suite 157/157 (worklog-verified).
9. **Integration tests চালানো হয়েছে**: hermetic t14 (confirm-state machine, §15), t17/t19 carry the
   Phase-4 confirm contract into real pipeline runs; browser E2E sessions (P5-3). This audit re-ran
   t16 only (per CPU rules) — 22/22.
10. **Live media evidence**: নেই (zero-budget policy) — code/test/browser evidence only; honestly
    declared NOT RUN in phase docs.
11. **অসম্পূর্ণ/unsupported**: F01 (dead code), F02 (stale song options), rule-based classifier has
    inherent lexical limits (honest clarification fallback verified 12/12), config-panel is a
    display contract (validateFieldsAgainstSchema is pre-validation only — server re-validates).
12. **কোন defect পরবর্তী acceptance আটকাবে**: কোনোটিই না — state machine, §15 sanitization,
    revalidation and honesty labeling all hold; F01/F02 are hygiene/UX.

## Phase 5 status

**Verdict: PASS WITH DOCUMENTED LIMITATIONS** (no P0/P1/P2 code findings; 7×P3 — F03–F08 map to the
six exit-report §6 follow-ups (all confirmed open) + F06 doc gap + F08 publish blocker; the §6.5
truncation-label and §6.6 LLM-refinement items verified as documented; live-provider acceptance
honestly NOT RUN).

The 12 mandatory questions:
1. **মূল requirement**: cinematic director — deterministic scene/shot planning, capability-based
   camera validation, plan→prompt delivery, MV/SF separation, artifact linkage, cache correctness,
   honest realism claims.
2. **Commit**: `c7927f7` (current HEAD, 32 files +6100/−204; replaces accidentally-amended local
   history per exit-report §5) — **unpushed** (F08).
3. **Driving source files**: `cinematic/{types,planner,capability_map,prompt,validate,preview}.ts`;
   pipelines `music_video.ts` (visual_plan/generate/timeline/final_qc) + `short_film.ts`
   (script/plan/acting/speech/sound/final_mix); `runner.ts` (plan metrics); `run-metrics.ts`
   (`notePlanMetrics`); `capabilities.ts` (cinematicOverrides whitelist); route
   `plan-preview/route.ts`; UI `production-card.tsx` ShotPlanPreview + `use-config-panel.ts`
   `useShotPlanPreview`.
4. **UI থেকে ব্যবহারযোগ্য**: হ্যাঁ — ShotPlanPreview on awaiting MV/SF cards (MV: per-shot
   framing/movement selects → `spec.cinematicOverrides`; SF: review-only skeleton with honest
   runtime-derivation labels); browser-verified (P5-3: overrides re-render + server recompute, 0
   errors, zero `/confirm`).
5. **Server handler → আসল pipeline**: plan-preview calls the SAME deterministic functions the
   pipelines call (`planMusicVideo`/`planShortFilmSkeleton` + `applyOverrides` + shared
   `proceduralSongGrid`/`resolveInstrumentalMood`/`barRoleEnergy` grid) — preview/run parity is
   structural; only the F04 origin edge diverges (crafted spec only, UI never offers it).
6. **Provider adapter প্রকৃত input ব্যবহার করে**: every generation-affecting plan field reaches the
   prompt (E3 marker-proven; `prompt.ts:21-35` composes actionEn/compositionEn/angle/movement/
   lightingMood/size-phrase, bounded ≤~1800 chars); provider body carries prompt only — no native
   camera parameters ever (t17/t19 locks).
7. **সফল ফলাফল validate ও register**: `parseAndValidateShotPlan` (12+ error classes) guards the
   plan; `shot-plan.json` (full validated plan), per-shot storyboard metaJson
   (`shotId/size/movement/delivery/cameraMove`), final artifact metaJson +
   `resultJson.cinematicPlan` (`summarizePlan`), `lipSync:false` retained.
8. **Automated tests**: t16 (22 — plan contract incl. review-fix locks), t17 (5 — MV incl. REG-17e
   override→pipeline), t18 (10 — route incl. REG-18h/i/j), t19 (1 — SF hermetic full-run, 2 chatJson
   exactly). This audit re-ran t16: 22/22 PASS.
9. **Integration tests চালানো হয়েছে**: t17/t19 run the REAL pipelines at provider-boundary mocks
   (P4-2-class isolation verified by P5-4h; preserved at HEAD); browser E2E P5-3. Full suite
   157/157 recorded pre-push (P5-7) — not re-run here (2-CPU rule).
10. **Live media evidence**: নেই — no paid calls; visual-quality acceptance explicitly NOT RUN
    (exit-report §4). No cinematic-realism claim is made anywhere without visual evidence: badges
    say "প্রম্পট-নির্দেশিত (নিশ্চয়তা নয়)", limitations list lip-sync absence, movement honesty is
    prompt-guidance (capability_map.ts:99-121 phrases carry no parameter/guarantee syntax).
11. **অসম্পূর্ণ/unsupported**: F03 (64-cap accounting), F04 (origin parity), F05 (scene lighting
    placeholder), F06 (skeleton diversity, untracked), F07 (character slot-fill integration gap),
    F08 (unpushed commit); §6.5 truncation label browser-unexercised; §6.6 LLM refinement not
    implemented (by design). Camera control is prompt-guided on CogVideoX-3 and local KenBurns on
    cinematic_motion — honestly labeled everywhere.
12. **কোন defect পরবর্তী acceptance আটকাবে**: কোনোটিই না এই ধাপে — all P3 items are hardening/
    coverage/documentation; the only true gate before declaring Phases 1–5 "published" is F08
    (push credentials), and live-provider acceptance (Layer D) remains a separate, user-authorized
    gate per master prompt §7.
