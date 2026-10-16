# Recovery Phase 1–5 — Acceptance Report (master §13 completion gate) (R-DOC-3)

Master §13 requires a per-phase status and a numbered overall-acceptance check. This report
fills that gate from the recovery round's recorded evidence (six read-only audits
R-A1/A2/B/C/D/E → fix wave R-FIX → user-authorized live backtest R-WAVE4 → this documentation
set). Nothing below is pre-written: every PASS/PARTIAL/FAIL points at executed evidence.

**Per-phase status (§13):**

| Phase | Status | Basis |
|---|---|---|
| Phase 1 (foundation/observability) | **PASS WITH DOCUMENTED LIMITATIONS** | findings-a1: every §3 item implemented, wired, test-locked; NOT-RUNs (next build, live latency, DOM tests) are environment constraints; P2 A1-F01 (zombie-run 409 window) **fixed in R-FIX** + locked REG-3f/3g |
| Phase 2 (TTS fallback / persistence / SSE) | **PASS WITH DOCUMENTED LIMITATIONS** | findings-a1: contracts real and locked (REG-1..7); DOM-reattach test gap documented (source-verified); A1-F02 runs-SSE MAX_LIVE_MS **fixed** + locked REG-2e |
| Phase 3 (cache / mix / media reliability) | **PASS WITH DOCUMENTED LIMITATIONS** | findings-a1 + Layer C: A1-F03 fingerprint byte-parity and A1-F04 tts-cache LRU **fixed**; the real recorded artifact now exists and was measured — loudness defect found (E-F01) and **fixed** (`loudnessSignal: delivered`), silent truncation found (E-F02) and **fixed** + locked REG-21b |
| Phase 4 (intent / settings / confirmation) | **PASS** | findings-a2: state machine, settings→payload, confirm-gating, §15 sanitization, server revalidation, honest-unsupported verified end-to-end; both P3s fixed (A2-F01 dead export removed; A2-F02 schema cache + REG-13j) |
| Phase 5 (cinematic director / shot planning) | **PASS WITH DOCUMENTED LIMITATIONS** | findings-a2/d: all §6 follow-ups confirmed in audit then **fixed with locks** (D-F03 lang-guard + REG-16r3/18k, D-F04 + REG-16r1/r2/f4, A2-F05 + REG-16f3, A2-F06 + REG-18k); live-provider acceptance honestly partial; commit `c7927f7` still unpushed (publish blocker, user credentials) |

## 1. Overall acceptance criteria (master §13 numbered list)

The master prompt's §13 enumerates the overall-acceptance items (1–14 as printed there);
each is answered below with evidence pointers.

| # | Criterion (master §13) | Status | Evidence |
|---|---|---|---|
| 1 | Phase 1–5 source-level implementation audit complete | **PASS** | findings-a1 (Phases 1–3, 12 questions each), findings-a2 (Phases 4–5), findings-b/c/d/e (defects A/B/C) — 62 findings total; every phase verdict recorded above |
| 2 | No critical disconnected feature | **PASS** | A1: "NO disconnected/dead/mock-only code in Phase 1–3 scope"; A2 verified the Phase-4/5 UI→route→runner→pipeline→provider→artifact traces; the one parity gap found (A2-F04 runner artifact reads) **fixed as security hardening** in R-FIX (`security-and-diff-review.md` §4) |
| 3 | All existing automated regression tests pass | **PASS** | Final suite **185/185** (1977 expects, 22 files, 184.96 s) — includes the inherited 119 Phase-0–4 tests + 38 Phase-5 tests unchanged-and-green (`automated-test-results.md` §1–§3, `/tmp/r-g-full2.log`) |
| 4 | New Bengali TTS, fallback & language-integrity tests pass | **PASS** | t1 rewritten + REG-1h/1i; t8 rewritten (bn = honest VOICE_UNAVAILABLE, en = legitimate fallback); t20 NEW (9 tests on real-DB-transcript fixtures) — all green; §4.5's 9 previously-uncovered cases now locked offline (`test-plan-and-fixtures.md` §2–§3) |
| 5 | Lip-sync either really integrated or clearly BLOCKED/UNSUPPORTED | **PASS (as BLOCKED/UNSUPPORTED)** | Honest 4-dimensional blocked declaration (`lip_sync_module.ts`), `runLipSync` cannot fake success; 18/20 honest UI surfaces at audit → the 2 gaps (C-F05/C-F06) **fixed** + locked REG-12r-1/3; `lipSync:false` on artifacts; never mocked as success (findings-c; master §5.5 respected) |
| 6 | Cinematic shot plan applied in real provider requests | **PARTIAL** | Layer A/B: plan drives REAL prompt builders, provider body keys ⊆ probe contract (REG-17a, t19 — mocked provider boundary). Real-run evidence exists from the 2026-10-16 production `cmvbbv86c…` (plan→prompt→CogVideoX-3, Layer-C verified), but that run **predates the fixes**; a post-fix real-provider film generation is **NOT RUN** (Layer-D item D-b, awaiting authorization) |
| 7 | Mocked-integration & offline-media results documented | **PASS** | `automated-test-results.md` (Layers A/B) + `offline-media-backtest-results.md` (Layer C: 14 real files, ffprobe/ebur128, E-F01/E-F02 found & fixed) |
| 8 | Real-provider tests run ⇒ artifacts & evidence preserved | **PASS** (for the authorized subset) | R-WAVE4 (user-authorized "তুমি নিজেই জেনারেট করে backtest করবে"): `/tmp/r-wave4/evidence-tts.json` (Edge probe down; bn → typed VOICE_UNAVAILABLE live; en → real TTS 241,296 B + real ASR similarity 1.0, 8/8 coverage, pass), `evidence-vlm.json` + `frame-*.jpg` (3 real clips reviewed), `en-sample.wav` preserved (`live-provider-test-requirements.md` §1) |
| 9 | Real-provider tests not run ⇒ clearly NOT RUN + awaiting user approval | **PASS** | `live-provider-test-requirements.md` §2–§3: bn live success NOT RUN (environmental — Edge down); fixed-pipeline real-provider film NOT RUN; hosted lip-sync BLOCKED — NOT AUTHORIZED, costs UNKNOWN, never fabricated; authorization protocol per item |
| 10 | UI claims no unsupported feature as verified | **PASS** | Honest-status inventory (findings-c) now 20/20 after R-FIX: result notes rendered (C-F05), film-dialogue statusNote (C-F06), "রিয়েলিস্টিক" adjective removed (O-3), storyboard-fallback note (O-4), capability claims health-conditioned (B-F07/B-F12), failed-dialogue lines no longer under a "চমৎকার" headline (D-F05, locked REG-21a) |
| 11 | Full suite, typecheck, lint, Prisma validation & diff checks — actual results preserved | **PASS** | 185/185 / tsc exit 0 / eslint exit 0 / prisma "valid 🚀" / `git diff --check` clean — all recorded with log paths (`automated-test-results.md` §1) |
| 12 | No secret, unrelated change or unauthorized migration | **PASS** | `security-and-diff-review.md`: 19 token-ish diff matches all benign (no credentials; public Edge client constant is pre-existing context); `prisma/` diff empty; `package.json`/`bun.lock` untouched; every changed file maps to a numbered finding; worklog append-only (133+/0−) |
| 13 | No Phase 6 or new phase started | **PASS** | Recovery scope only; all fixes map to findings; no Phase-6 work exists in the diff |
| 14 | No commit / no push | **PASS** | HEAD remains `c7927f7`; the whole recovery diff (+2795/−475 over 39 tracked files + 5 untracked paths) is uncommitted, awaiting the user's decision |

## 2. Overall verdict

# PASS WITH DOCUMENTED LIMITATIONS

Code, tests and integration are complete, root-caused and regression-locked, and every
limitation is evidence-backed rather than hidden:

- **Live-provider acceptance is partially evidenced:** bn honest-failure is **live-proven**
  (typed VOICE_UNAVAILABLE, attempts=1, exact §4.2 message); the en path is **live-proven
  end-to-end** (real TTS + real ASR, similarity 1.0 / 8-of-8); acting quality is
  **VLM-reviewed, not human-reviewed**; bn **success** remains live-unverified today (Edge
  environmentally down — the fixed code refuses to fake it, which is the required behavior);
  hosted lip-sync is honestly **BLOCKED** (no model, no authorization, costs unknown).
- Per master §13's own rule, a bare "PASS" cannot be declared where actual live media is
  required for quality proof — hence the documented-limitations verdict.

**Final decision marker (master §15):** **READY FOR USER ACCEPTANCE REVIEW** — all mandatory
§13 criteria are satisfied (blocked/unsupported items satisfy their criteria *as*
BLOCKED/UNSUPPORTED, and not-run live items are explicitly NOT RUN with authorization
protocols attached); no critical requirement failed. The user's review should cover the
blockers below and the commit/push decision.

## 3. Explicit confirmations

- **No commit, no push** — all recovery changes are uncommitted in the working tree
  (HEAD `c7927f7` unchanged), awaiting user approval.
- **No paid-provider spend beyond the documented minimal Wave-4 calls** — 1× z-ai TTS (en) +
  1× ASR + 3× VLM + a free Edge probe; total cost UNKNOWN (no pricing data in repo; nothing
  estimated or fabricated).
- **No Phase 6** started; no new phase; no features beyond the finding-derived fix set.
- **No secrets** in the diff; remote token confined to `.git/config`.
- **No unauthorized migration** — Prisma schema untouched; no new dependencies.
- **No assertion weakened, no snapshot added** — the two test rewrites (t1/t8) replaced
  contracts that locked the *flaw*; every red→green transition is documented
  (`automated-test-results.md` §4).

## 4. Remaining blockers (priority & dependency)

| # | Blocker | Priority | Depends on |
|---|---|---|---|
| 1 | **Live bn TTS success unverified** (§4.5 case 1) — Edge bn-BD/bn-IN unreachable (probe down); z-ai has no bn-capable voice | High (defect-A closure) | Edge environment recovery; then a re-run + **human listening** (§4.4) |
| 2 | **Lip-sync integration BLOCKED** — no model/endpoint in the SDK; hosted inference NOT AUTHORIZED, costs UNKNOWN; local inference infeasible (2 CPU / 4.1 GB / no GPU) | High (defect B) | User decision: provider selection + cost review + authorization |
| 3 | **Post-fix real-provider film generation NOT RUN** (Layer-D D-b) — the existing real artifact predates the fixes | Medium | User authorization (protocol in `live-provider-test-requirements.md` §3) |
| 4 | **Human review NOT RUN** — pronunciation (bn/en) and acting quality have VLM/advisory evidence only | Medium | User time (samples preserved in `/tmp/r-wave4/`) |
| 5 | **Unpushed / uncommitted state** — `c7927f7` (Phase 5) unpushed (earlier push failed on credentials) and the recovery diff uncommitted | Medium (publish) | User commit/push approval + valid credentials |
| 6 | Minor follow-ups (non-blocking): B-F11 adapter-level Edge ws-mock test; B-F13 tool-gate unit test; E-F09 `/tmp/reg18-fixture-*` pre-suite sweep; `next build` NOT RUN (sandbox rule) | Low | Next fix wave / CI environment |

— Recovery documentation set (this file, test-plan-and-fixtures, automated-test-results,
offline-media-backtest-results, live-provider-test-requirements, performance-measurements,
security-and-diff-review) lives in `docs/audit/recovery-phase-1-5/`; findings in
`docs/audit/recovery-phase-1-5/findings/`; append-only worklog entries R-A1…R-WAVE4 in
`worklog.md`. No further action is taken without the user's next authorization.
