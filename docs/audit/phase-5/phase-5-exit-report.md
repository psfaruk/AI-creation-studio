# Phase 5 — Exit Report

**Verdict: Phase 5 COMPLETE — implementation delivered, independently reviewed, defects
fixed at root, 157/157 green, four checks exit 0, browser-verified at render level.**
Stopped per delivery rules: **no push performed, no Phase-6 work started, zero provider
budget spent.**

## 1. What shipped (objective → delivered)

Capability-aware cinematic planning that turns an accepted music-video / short-film
request into a structured, validated shot plan which drives the **real** prompts and
parameters — honestly:

1. **`src/lib/agent/cinematic/`** — versioned plan contract (`SHOT_PLAN_VERSION=1`),
   deterministic planners (MV arc + SF coverage + SF preview skeleton), camera-language
   capability map with per-engine delivery verdicts (`local_motion` /
   `prompt_guided` / `downgraded_to_local`), slice-safe cinematic prompt builders,
   runtime plan validation.
2. **Pipelines consume the plan**: MV `visual_plan` = deterministic structure + ONE LLM
   slot-description call (structure authority removed from the LLM); SF **replaced its
   shot-split LLM call** with the deterministic planner (**one LLM round-trip saved per
   short-film run**, E2-verified). `shot-plan.json` artifact, per-shot prompts via the
   cinematic builders, per-shot artifact metadata (`shotId/size/movement/delivery`),
   `resultJson.cinematicPlan` summary, `lipSync:false` retained.
3. **`POST /api/productions/plan-preview`** — owner auth, 20/min rate limit, ≤20 KB,
   zero LLM (local ffmpeg beat analysis for uploaded songs, bounded LRU ≤ 8), the same
   deterministic functions the pipeline runs, honest beat-source labels
   (`measured` / `bpm_grid_estimate (মাপা নয়)` / `silent` / `narrative`).
4. **Card UI `ShotPlanPreview`** — ordered shots with BN size/movement labels + delivery
   badges, totals, cut strategy + honesty, limitations, per-shot size/movement selects
   (MV only) riding `spec.cinematicOverrides` through confirm §15 sanitization (survival
   verified end-to-end — the critical REG-14l-class check).
5. **Metrics** — `{planMs, plannedShots, planAdjustments}` (counts/enums only) in the
   single `[production-metrics]` line; planner cost measured at **0.4–4.9 µs/call**.

## 2. Review round (independent, parallel) — defects found → fixed at root

Two P1 + seven P2 defects were found by three independent reviewers + one browser E2E
agent and **all fixed in the working tree with new regression locks** (worklog P5-5a/b/c):

- **P1** movement-repetition rule broken at fixed slots (MV last-slot `zoom_out`+
  penultimate; SF no-op repeat-fix) → real fix + REG-16a3b/16a3c.
- **P1** validate.ts guard set incomplete → beatSource/subject/totalPlannedSec/
  adjustment-shape guards + REG-16d extension.
- **P2** adjacent-size diversity rule unimplemented → reconciled rule implemented
  (energy-pair alternation, penultimate guard, honest exhaustion adjustment) + REG-16a4;
  design §3 updated with the exact reconciled rule.
- **P2** stale-response race in `useShotPlanPreview` (+ same class in Phase-4
  `useSpecValidation`) → cancelled-flag guards.
- **P2** tautological t18 assertion → replaced with real entry-shape/no-leak checks.
- **P2** stale shot header after override (browser-caught) → header derives from the
  CURRENT size; browser re-verified.
- **P2** three renderings of `downgraded_to_local` → unified "সৎ-বিকল্পে নামানো".
- **P2** unlabeled adjustments truncation → "… প্রথম ৮টি দেখানো হচ্ছে".
- **P2** dead/never-populated generation-affecting fields → `lightingMood` now
  deterministically populated (MV energy map / SF time-of-day map, reaches prompts,
  REG-16f2); `compositionEn` + scene fields honestly re-documented; MV `character`
  slot-fill; dead code removed (`isPreview`, ignored `quality` inputs,
  `CAMERA_ANGLE_LABELS_BN`); `static` prompt phrase fixed ("steady static camera,
  locked framing").
- **P2** route 422 leaked server temp paths → `sanitizeErrorMessage` (→ `[ফাইল]`) on
  both 422 paths + REG-18j; doc inaccuracies (9) fixed; tests/README REG-16..19 rows
  added.

## 3. Confirmed (verified, not assumed)

- Full suite **157/157** (1720 expects, 20 files, 147.67 s) — inherited 119 + Phase-5
  38; typecheck 0, lint 0, prisma validate 0, `git diff --check` clean.
- §15 cinematicOverrides survives: client selects → confirm merge → `validateSpec`
  whitelist (sanitized) → runner → `applyOverrides` after capability mapping → prompts.
  REG-16i/17e/18c lock every hop.
- Provider contract integrity: submitted bodies ⊆ `{prompt, duration, quality,
  watermark_enabled, image_url, with_audio, size, request_id}` — no native camera
  parameter can appear (t17:242–247, t19:301–304).
- Camera honesty: movement NEVER advertised as guaranteed native (badges "নিশ্চয়তা
  নয়" on prompt-guided); MV plans never claim singing/lip-sync; honest beat-source
  labels; honest downgrade adjustments.
- Cache: plan change (movement OR framing phrase) → new fingerprint; identical → same
  key (real-function sha256 demonstration, REG-16l/10b).
- Browser E2E (budget-free): full ShotPlanPreview interaction incl. overrides + preview
  refetch (200s), SF skeleton review-only, zero console/page errors, sticky footer
  desktop+mobile, all test productions cancelled, zero `/confirm`, zero budget.
- Determinism: planners byte-identical across repeat calls; no RNG/Date.now in
  `cinematic/**`.

## 4. NOT RUN (honest separation)

- `next build` — sandbox rule (no production builds here; `bun run dev` only).
- Live provider/LLM end-to-end generation with real budget — everything generation-
  related is hermetic (provider-level mocks) + render-level browser checks; no paid
  calls were made in Phase 5.
- Real uploaded-song **measured-beat** preview exercised in a browser (hermetic REG-18e
  covers ownership/kind/fallback/labels; browser sessions used the procedural path).
- Live LLM latency A/B for the SF round-trip saving — the delta is code-level and
  mock-enforced (t19), not live-timed.

## 5. Git state (IMPORTANT — needs the user's decision before any push)

- Phase-4 push (P4-3) put `d982a4d` (worklog-only commit) on `origin/main`.
- The Phase-5 implementation was then committed LOCALLY as `a60bcaf` **with a
  duplicated/misleading message** ("worklog: phase-4 push approval (task P4-3)") via
  two amends — local `main` is now `ahead 1, behind 1` (diverged; a plain push will be
  rejected). `a60bcaf`'s worklog change is byte-identical to `d982a4d`'s, so its diff
  vs the common parent is exactly "Phase-5 implementation + the same worklog +14".
- The review-round fixes, docs, and worklog records sit **uncommitted** in the working
  tree on top of `a60bcaf` (by design — no commit without approval).
- **Recommended resolution** (clean, no history rewrite on the remote):
  `git reset --soft origin/main` → stage everything → one properly-labeled commit
  (e.g. `phase-5: cinematic director & camera shot planning + review fixes`) → normal
  fast-forward push. Alternative: reword `a60bcaf` + commit fixes separately +
  `--force-with-lease` (rewrites an unpushed local commit only — also safe, but the
  first option produces the cleaner history).

## 6. Phase-6 follow-up candidates (recorded, not started)

1. Preview/pipeline origin parity hardening — preview requires `origin=user_upload`,
   the pipeline's `song_input` accepts any resolvable audio artifact (same-owner
   crafted spec could run a differently-derived plan; UI never offers this).
2. Integration test for MV `character` slot-fill (fixture energies yield no
   performance slots today — unit-verified only).
3. SF scene-level `lightingMood` is a generic planning-only placeholder (shot-level
   lighting is the generation-affecting path).
4. `sanitizeOverridesInput` 64-cap accounting — valid-but-over-cap entries are silently
   ignored rather than counted in `droppedCount`.
5. Adjustments >8 truncation label is implemented but not browser-exercised (test
   scenarios produce ≤2 adjustments).
6. LLM-assisted plan refinement behind the deterministic guard (design-doc candidate).

## 7. Budget & rules compliance

No paid provider calls, no z-ai-web-dev-sdk usage outside established server paths, no
new dependencies, **no schema migration** (plan rides artifacts/specJson/resultJson),
no commit/push in Phase-5 work (the pre-existing local commit is documented above for
the user's decision), Phase 6 not started.
