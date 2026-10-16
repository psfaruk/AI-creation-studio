# Recovery Phase 1–5 — Automated Test Results (R-DOC-3)

All numbers below are recorded results from executed runs (log files preserved under
`/tmp/r-*.log`); nothing is projected. Environment: 2 CPU / 4.1 GB RAM / no GPU,
Bun 1.3.14, ffmpeg 7.1.5, dev server running, 2026-10-16 evening (recovery round).

## 1. Required verification commands (final tree, R-FIX completion gate)

| Command | Result | Evidence |
|---|---|---|
| `bun run test` (`bun test tests`) | **185 pass / 0 fail** — 1977 expect() calls, 22 files, **184.96 s**, exit 0 | `/tmp/r-g-full2.log` (22:19); worklog R-FIX |
| `bun run typecheck` (`tsc --noEmit`) | exit 0 — no errors | `/tmp/r-g-tc3.log` (22:16, command echo only) |
| `bun run lint` (`eslint .`) | exit 0 — no errors | `/tmp/r-g-lint.log` (22:10, command echo only) |
| `bunx prisma validate` | "The schema at prisma/schema.prisma is valid 🚀" — exit 0 | `/tmp/r-g-prisma.log` (22:10) |
| `git diff --check` | clean (no whitespace/conflict markers) | worklog R-FIX gate |
| `next build` | **NOT RUN** — sandbox rule (no production build in this environment; unchanged Phase-5 policy) | — |

The suite was **not** re-run by this documentation task (2-CPU box; the recorded final run
is the evidence of record, per the task brief).

## 2. Growth vs baselines

| Milestone | Tests | Expects | Files | Duration | Source |
|---|---|---|---|---|---|
| Phase-4 gate | 119 / 119 | 1177 | 16 | 30.06 s | worklog P4-3 |
| Phase-5 / recovery-start baseline | 157 / 157 | 1720 | 20 | 164.90 s (147.67 s on the quiet final tree) | worklog P5-7; findings-e §6 |
| **Recovery final (R-FIX)** | **185 / 185** | **1977** | **22** | **184.96 s** | `/tmp/r-g-full2.log` |

**+28 breakdown (157 → 185)** — verified from per-file declaration counts (sum = 185) and
the recovery diff; old counts from the Phase-5 gate:

| File | Δ | New tests |
|---|---|---|
| `t20-bengali-language-integrity.test.ts` | **+9** | NEW file: REG-20a…i (§4.5/§4.4 verification machinery, real-DB-transcript fixtures) |
| `t21-dialogue-timing-contract.test.ts` | **+2** | NEW file: REG-21a (P0 pipeline gate), REG-21b (overflow + timing contract) |
| `t1-bengali-tts-fallback.test.ts` | **+2** | REG-1h (bn success unit), REG-1i (fallback cap `warn`) — plus REG-1a/b/c/f/g rewritten |
| `t16-cinematic-plan.test.ts` | **+5** | REG-16r1/r2 (D-F04 two-character distribution), 16f3 (A2-F05 honest lighting placeholder), 16f4 (D-F04 OTS/reaction sentences + guard), 16r3 (D-F03 planner-half actionEn fallback) |
| `t12-intent-routing.test.ts` | **+3** | REG-12r-1/2/3 (C-F05/C-F06/O-3/O-4 UI honesty locks) |
| `t13-config-panel.test.ts` | **+3** | REG-13j-1/2/3 (A2-F02 schema-cache freshness + invalidation) |
| `t3-duplicate-submission.test.ts` | **+2** | REG-3f/3g (A1-F01 stale-run 409 window closed, boundary kept) |
| `t2-chat-run-refresh-reconnect.test.ts` | **+1** | REG-2e (A1-F02 runs-SSE max-lifetime cap) |
| `t18-plan-preview-route.test.ts` | **+1** | REG-18k (A2-F06 skeleton diversity) |
| `t8-motion-voiceover-fallback.test.ts` | 0 (7→7) | REG-8b/c/d/f/g **rewritten** to the fail-closed R-FIX-1 contract (bn = honest VOICE_UNAVAILABLE; en = legitimate fallback with true provenance) |

## 3. Per-suite table (final counts, working-tree-verified)

| Suite | Tests | Notes (recovery-relevant contract) |
|---|---|---|
| smoke | 4 | framework sanity, registry↔catalog parity (41/41), retry-wait accumulator, single-line metrics JSON |
| t1 Bengali TTS fallback | **9** | **R-FIX-1 contract**: bn profile Edge-neural-only + capability-tagged (fail-closed); typed `VERIFICATION_FAILED` on chain-verification exhaustion; **REG-1h** bn success unit; **REG-1i** fallback cap |
| t2 chat refresh/reconnect | **5** | + REG-2e max-lifetime cap (A1-F02) |
| t3 duplicate submission | **7** | + REG-3f/3g stale-run window (A1-F01) — guard never weakened (boundary test) |
| t4 SSE replay | 5 | unchanged green |
| t5 instrumental audio | 6 | unchanged green |
| t6 429 retry | 10 | unchanged green |
| t7 client re-attach | 6 | unchanged green |
| t8 motion voiceover fallback | **7** | rewritten: bn + Edge 403 ⇒ honest per-chunk VOICE_UNAVAILABLE, no silent wrong-language audio; en fallback legitimate; actual-voice provenance; bounded retry |
| t9 final-mix loudness | 7 | unchanged green (real two-pass loudnorm ±1.0 LUFS band, real mux) |
| t10 shot cache | 10 | unchanged green |
| t11 stage metrics | 4 | unchanged green |
| t12 intent routing | **20** | + REG-12r UI honesty locks (notes surfaced, no unverified adjectives, ঠোঁট-সিঙ্ক-নয় statusNote) |
| t13 config panel | **12** | + REG-13j schema-cache health (A2-F02) |
| t14 capability confirm | 12 | unchanged green |
| t15 intent metrics | 6 | unchanged green |
| t16 cinematic plan | **27** | + r1/r2/f3/f4/r3 (D-F04/A2-F05/D-F03 planner honesty + two-character romantic structure) |
| t17 MV integration | 5 | unchanged green (~92 s of real ffmpeg; REG-17e 39.3 s slowest) |
| t18 plan-preview route | **11** | + REG-18k skeleton diversity (A2-F06) |
| t19 SF integration | 1 | unchanged green (18.1 s in the final run) |
| **t20 language integrity** | **9** | NEW — real-DB-transcript fixtures: Chinese-garbage ⇒ fail; romanized-garbage never pass; empty/partial; LANGUAGE_MISMATCH; UNSUPPORTED_LOCALE; provenance; bn exhaustion ⇒ VOICE_UNAVAILABLE |
| **t21 dialogue timing** | **2** | NEW — P0: verification-failing line never mixed + verdict loses "চমৎকার"; overflow honestly noted + per-line timing contract + audioOverflows |

## 4. History within the phase (honest — the transition was messy by design)

The source rewrite (R-FIX-1 language_controller) landed **before** the test rewrite, so the
old t1/t8 contracts correctly failed — they asserted the *flawed* jam-fallback behavior
(REG-1a asserted `voice=jam`). Those failures are the **proof the fix worked**, and the
subsequent test rewrites **strengthened** the contracts (typed-error assertions, provenance,
fail-closed chain) rather than weakening them to pass.

| Time | Run | Result | Meaning |
|---|---|---|---|
| 21:22 | `tsc --noEmit` | 5 errors (SpeechLocale duplicate, dead case, 2 flow-narrowing, TimedLine.text) | mid-rewrite source state (`/tmp/r-typecheck.log`) |
| 21:27 | fast subset, 8 files | **76 pass / 10 fail / 1 error** (86 ran, 5.93 s) — fails = REG-1a/1b/1c/1f/1g + REG-8b/8c/8d/8g (old-contract failures) | source fix landed, old tests still asserting the flawed contract (`/tmp/r-tests-fast.log`) |
| 21:35 | t1+t8 | 12 pass / 4 fail (16 ran, 1.77 s) | t1 rewritten first, t8 still old (`/tmp/r-t1t8.log`) |
| 21:36 | t8 alone | **7/7 pass** (376 ms) | t8 rewrite complete (`/tmp/r-t8b.log`) |
| 21:46–21:49 | t20 iterations | 6 pass/3 fail → 6/3 → **9/9 pass** (1.19 s) | fixture-driven verification locks converged (`/tmp/r-t20b–d.log`) |
| 21:50 | t9+t10(+t19) multi-file | 7 pass / 2 fail / 2 errors | **t9-mock-leak ordering discovery** (one bun process; see test-plan §6) — led to the re-export pattern, not to any test weakening (`/tmp/r-e2.log`, `/tmp/r-heavy1.log`) |
| 21:53–21:56 | targeted re-runs | 10/10 (6.64 s); 18/18 (36.80 s) | clean subsets (`/tmp/r-e1.log`, `/tmp/r-e3.log`) |
| 22:01–22:08 | t21 iterations | 1 pass/1 fail ×3 → **2/2 pass** (38.85 s) | REG-21b timing-contract assertions tightened to green (`/tmp/r-t21–d.log`) |
| 22:14 | full suite | **155 ran / 153 pass / 2 fail / 2 errors** (187.04 s) | t12/t13 import-time crash on t7's leaked fake `window` (security-gate) → fixed with an order-independent guard (`/tmp/r-g-full.log`) |
| **22:19** | **full suite** | **185 pass / 0 fail, 1977 expects, 22 files, 184.96 s** | **final gate green** (`/tmp/r-g-full2.log`); typecheck/lint/prisma/diff-check all clean (22:10–22:16) |

No assertion was weakened anywhere in this history: every red→green transition is either a
source fix, a stronger contract, or an environment guard (see the diff review in
`security-and-diff-review.md`).

## 5. Coverage statement after the round

- The §8-group gaps recorded by findings-e §1 (E-F06: 9 of 14 §4.5 cases untested; E-F07:
  §5.2 timing contract untested; E-F05) are closed for everything testable without a live
  provider or a lip-sync model: §4.5 now has automated locks for the garbage-transcript,
  empty/partial, wrong-script, locale, provenance, UI-status and bounded-attempt cases
  (t1/t8/t12/t20), with the adapter-level ws-mock and the tool-gate unit remaining
  documented follow-ups (B-F11/B-F13 unit half).
- Structurally BLOCKED remains: §5.5 lip-sync matrix (14 of 15 cases — no model exists; the
  honest-unsupported case is locked by REG-12k/12r-3), live bn TTS success (§4.5 case 1 —
  Edge environmental), and real-provider final-media re-verification (Layer D —
  `live-provider-test-requirements.md`).
