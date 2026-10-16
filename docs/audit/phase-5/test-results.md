# Phase 5 — Test Results

Every required verification command, exact outcomes, and per-suite evidence. All runs
executed on the final post-review-fix tree (working tree = a60bcaf + fix round;
see `phase-5-exit-report.md` §Git state).

## 1. Required verification commands (final tree)

| Command | Result |
|---|---|
| `bun run test` | **157 pass / 0 fail** — 1720 expect() calls, 20 files, 147.67 s, exit 0 |
| `bun run typecheck` (`tsc --noEmit`) | exit 0 — no errors |
| `bun run lint` (`eslint .`) | exit 0 — no errors |
| `bunx prisma validate` | "The schema at prisma/schema.prisma is valid" — exit 0 |
| `git diff --check` | clean (no whitespace/conflict markers) |
| `next build` | **NOT RUN** — sandbox rule (no production build in this environment) |

History within the phase (honest):

- Implementation landed → **149/149** (1607 expects, ~105 s) — 119 inherited Phase 0–4 +
  30 new Phase-5 tests.
- Review round (3 independent reviewers) found defects → fix round A/B/C landed 8 new
  regression locks → **final 157/157** (1720 expects, 147.67 s).

## 2. Phase-5 suites (final counts)

| Suite | Tests | Expects | Duration | Covers |
|---|---|---|---|---|
| `t16-cinematic-plan.test.ts` | **22** (18 + 4 review-round) | 324 | ~2.9 s | Plan contract: version/shape, arc rules, movement-repetition (incl. penultimate-never-zoom_out + SF real repeat-fix), adjacent-size variation + exhaustion adjustment, capability table, honest fallbacks, prompt 2000-bound + lighting-phrase-in-prompt, overrides (whitelist/index/downgrade-after-mapping/sanitize), validate guards (12 + 5 new: beatSource/subject/totalPlannedSec/adjustment-shape), determinism, preview/run parity, LRU ≤ 8, fingerprint sensitivity, plan metrics |
| `t17-cinematic-mv-integration.test.ts` | **5** (4 + 1 review-round) | 94 | ~98 s | MV plan → real pipeline: provider-level mock boundary (P4-2 retry re-exports preserved), plan drives real generateAiShot prompts, provider body keys ⊆ probe contract, fallbackMove wired, artifacts carry shotId/size/movement/delivery, resultJson.cinematicPlan, honest degradation, cancel propagation; REG-17e: cinematicOverrides=[orbit] through the real pipeline on cinematic_motion → downgraded_to_local + pan_right KenBurns proof + deliveryCounts + zero provider submits |
| `t18-plan-preview-route.test.ts` | **10** (7 + 3 review-round) | 77 | ~0.35 s | Route: 401 owner, 400 limits (>20 KB, wrong type), §15 invalid-override server-strip (tautology replaced with real entry-shape/no-leak assertions), procedural honest BPM-grid label, uploaded-song ownership + kind + honest fallback + measured label, SF skeleton + runtime-derivation label, 429 rate limit; REG-18h origin ≠ user_upload → honest fallback; REG-18i song-read failure → song=null honest fallback; REG-18j both 422 paths server-path-free ('[ফাইল]' placeholder, honest what-failed retained) |
| `t19-sf-cinematic-integration.test.ts` | **1** (unchanged) | 45 | ~28 s | SF full-run: shot-split LLM call GONE (exactly 2 chatJson, mock throws on a third), plan→prompt chain (English visualEn in prompts), body keys ⊆ contract, plan artifact + dialogue artifacts + final cinematicPlan + lipSync:false, step keys unchanged |

Inherited suites (REG-1…15 + smoke): **119/119 unchanged and green** — Phase 0–4
non-negotiables intact (409 exactly-once, §15 revalidation, song-deselect null-clear
REG-14l, SSE replay/dedupe, TTS fallback, loudness normalization, shot cache, intent
fast path, config panel).

## 3. Review round (independent verification, 9 parallel agents)

- **Browser E2E (P5-3)**: auth → awaiting MV card → ShotPlanPreview renders all
  elements (ordered shots S01–S03, delivery badges, per-shot selects, honest
  beat-source "BPM-গ্রিড অনুমান (মাপা নয়)", limitations, no-lip-sync) → S02
  movement override (ডলি-ট্র্যাকিং→অরবিট) + S03 framing override (ওয়াইড→ক্লোজ-আপ)
  applied with honest adjustment trail → plan-preview re-fetch 200 × N → SF skeleton
  review-only with honest runtime-derivation label, zero per-shot selects → all test
  productions cancelled, **zero `/confirm` POSTs, zero provider budget** → 0 page
  errors, 0 console errors, 671/671 requests 200 → footer sticky desktop (800/800) and
  mobile (844/844).
- **Evidence runs (P5-4a…e)**: see `quality-and-performance-evidence.md`.
- **Independent reviews (P5-4f/g/h)**: cinematic core, pipeline/route integration,
  UI/tests/docs. Verdict: architecture genuinely connected (§15 cinematicOverrides
  survives end-to-end — the critical REG-14l-class check PASS); found 2 P1 + several
  P2/P3 defects → all P1/P2 fixed at root in the fix round with new regression locks
  (see worklog P5-5a/b/c); P3 hardening candidates documented as Phase-6 follow-ups.
- **Post-fix browser spot-check**: shot header now derives from the CURRENT size
  (override → "শট ৩ — ক্লোজ-আপ" immediately), canonical "সৎ-বিকল্পে নামানো" copy at
  all sites, adjustment trail honest, plan-preview re-fetch 200 × 2, 0 console errors,
  test production cancelled (zero budget).

## 4. Hermetic boundaries (unchanged policy)

- Route tests run real route handlers with fake `db`/auth and provider-level mocks —
  no real LLM/provider/network calls anywhere in the suite.
- t17/t19 mock boundaries sit at the SDK provider layer; cinematic planner, capability
  map, prompt builders, gates and cache run REAL code (the P4-2 mock-leak defense —
  re-exported real retry symbols — is preserved and documented in both files).
- `next build` and live provider generation were NOT exercised (sandbox + budget
  rules) — see exit report NOT-RUN list.
