# Recovery Audit — Phases 1–5 (সূচি / Index)

**Scope**: the recovery mandated by the master recovery prompt
(`upload/Pasted Content_1792178693713.txt`, §0–§15) — verify Phases 1–5 at
commit/code/test/artifact level, root-cause the three Critical Defects
(A: Bengali TTS language correctness, B: real lip-sync, C: natural acting /
visual realism), fix at root, and prove with tests + media evidence —
**without starting Phase 6, without unauthorized commit/push, without
unauthorized provider spend.**

**Result in one line**: 6 read-only audit agents → 62 findings
(3×P0, 8×P1) → severity-ordered fix wave (R-FIX) → final suite
**185 pass / 0 fail** (1977 `expect()` calls, 22 files, 184.96 s — baseline
157 + 28 new tests), typecheck 0 / lint 0 / `prisma validate` 0 /
`git diff --check` clean → minimal live Layer-D backtest (R-WAVE4).
**No commit, no push, Phase 6 not started.**

---

## 1. Mission — master prompt §0–§15 on one screen

| § | Demanded | Where it landed |
|---|---|---|
| §0 | নতুন phase বন্ধ — no Phase 6 until 1–5 proven from real commits/code/tests/artifacts; সুন্দর UI / passing unit test একা প্রমাণ নয় | Honored: Phase 6 not started; every claim below is commit- or artifact-backed |
| §1 | Repository baseline + নিরাপত্তা-নিয়ম (no destructive git, no unauthorized commit/push, no secrets, no paid spend, no test weakening, append-only worklog) | `repository-baseline.md` (this directory) |
| §2 | Multi-agent execution (A–E + coordination rules; findings with file:line + severity) | 6 audit agents ran (A split into A1/A2); raw registers in `findings/` |
| §3 | Mandatory audit scope — 12 questions × each of Phases 1–5 | `findings/findings-a1.md`, `findings/findings-a2.md`; roll-up in `phase-status-matrix.md` |
| §4 | **Critical Defect A** — Bengali TTS language correctness (voice registry, language rules, fallback chain, ASR verification, §4.5 regression cases) | `findings/findings-b.md` (14 findings, RC-1…RC-10) → fixes in `root-cause-register.md` |
| §5 | **Critical Defect B** — real lip-sync (capability truth, §5.2 audio-timing contract, §5.5 test matrix) | `findings/findings-c.md` — honestly BLOCKED everywhere; timing-contract half fixed |
| §6 | **Critical Defect C** — natural acting / visual realism (§6.1 dimensions, §6.2 romantic scenario, §6.3 continuity, §6.4 human review) | `findings/findings-d.md` — incl. the decisive real-run discovery; VLM spot-review in R-WAVE4 |
| §7 | 4-layer end-to-end backtesting architecture (A mocked → B budget-free integration → C offline forensics → D live) | `findings/findings-e.md` §3–§4; Layer C executed, Layer D minimal under user instruction |
| §8 | Test suite + acceptance matrix (per-group coverage, honest PASS/FAIL/BLOCKED/NOT RUN) | `findings/findings-e.md` §1; new locks t20/t21 |
| §9 | Honest UI / status contract (no unsupported claim shown as verified) | Verified per-surface by C (§4) and D (§4); 2 UI gaps found → fixed (C-F05/C-F06 class) |
| §10 | Performance / latency / resource honesty | Existing metrics lines re-verified by A1; no fabricated numbers anywhere in this set |
| §11 | Required commands + verification | Recorded per worklog entry (R-A1…R-WAVE4) and `automated-test-results.md` (set 2) |
| §12 | Fix priority + 12-step execution loop (audit → merge → smallest safe fix → tests → gates → honest blockers) | R-FIX worklog entry (severity-ordered, root-cause-driven) |
| §13 | Phase 1–5 completion gate (14 criteria) | Tracked in `phase-1-5-acceptance-report.md` (set 2); per-phase state in `phase-status-matrix.md` |
| §14 | These 14 documentation deliverables in `docs/audit/recovery-phase-1-5/` | Doc map in §4 below |
| §15 | Final report format (18 headings; verdict vocabulary PASS / PASS WITH DOCUMENTED LIMITATIONS / NOT READY / BLOCKED) | `phase-1-5-acceptance-report.md` (set 2) |

## 2. Methodology — যেভাবে রিকভারি চললো

1. **6 parallel read-only audit agents** (2026-10-16; each produced one findings
   file + one worklog append; zero provider spend; read-only git):
   - **R-A1** — Phases 1–3 integration audit (commit→code trace, UI→route→runner→
     adapter→artifact table, tautology grep, one permitted test file:
     `t11` → 4/4 PASS, 53 expects).
   - **R-A2** — Phases 4–5 integration audit (prior fix-claims re-verified holding;
     empirical classifier spot-check 12/12 Bengali cases; `t16` → 22/22 PASS).
   - **R-B** — Critical Defect A root-cause audit (SDK reality, voice registry,
     read-only DB pass over the real-run artifacts; `t1` → 7/7 PASS at pre-fix HEAD).
   - **R-C** — Critical Defect B capability-truth audit (whole-repo mechanism
     search, §5.5 matrix; `t12` → 17/17 PASS).
   - **R-D** — Critical Defect C acting/visual audit (§6.1 12-dimension table,
     §6.3 checklist, evidence-truth pass; **decisive discovery**: a real
     user-initiated romantic short-film run — Production
     `cmvbbv86c000apzrc9mra61oi`, 3 real CogVideoX-3 clips — existed on disk,
     100% unanalyzed).
   - **R-E** — QA/backtest architect (§8 coverage matrix, media inventory,
     **Layer-C forensics executed** on the real artifacts → E-F01/E-F02,
     Layer-D requirement sheets).
   - Outcome: **62 findings** consolidated by the lead (63 numbered register
     items — A2-F09 is an explicit no-action observation): **3×P0**
     (B-F01/B-F02/B-F03), **8×P1** (B-F04…07, D-F01…03, E-F02), remainder
     P2/P3 + positive records.
2. **Severity-ordered fix wave — R-FIX** (lead-executed): 4 parallel fix agents
   were launched; subagent infra broke twice (`context deadline exceeded`)
   leaving verified-partial server-side work (28 files, +2292/−285); the lead
   verified and completed it (no reset, nothing discarded). All three Critical
   Defects' root causes fixed in code + regression-locked (t1/t8 rewritten as
   documented **strengthenings** — the old REG-1a/8b–d locked the flawed
   jam-fallback contract; new t20 (9 tests, real DB-transcript fixtures),
   t21 (2 tests); suite 157 → **185/185**, four gates zero).
3. **4-layer backtest** (§7 architecture from R-E):
   - **Layer A** (mocked-deterministic): the 185-test suite, green.
   - **Layer B** (budget-free integration): real routes/pipelines at
     provider-boundary mocks (t2/t3/t4/t14/t17/t19/t21 …), green.
   - **Layer C** (offline media forensics): ffmpeg/ffprobe + the app's own
     `measureLoudness` on the real on-disk artifacts — this is what exposed
     E-F01 (−14.4 LUFS delivered vs −16.3 reported) and E-F02 (87% of the
     narration silently truncated, §5.2 violation); both now fixed + locked.
   - **Layer D** (live provider) — R-WAVE4, the **only** spend of the recovery,
     user-instructed and minimal: **1 SDK TTS (en) + 1 SDK ASR + 3 VLM frame
     reviews + free Edge probes**. Results: bn line → typed
     `VOICE_UNAVAILABLE` (pre-fix this exact situation produced Chinese-garbage
     audio); en control → real 241 KB WAV, ASR round-trip similarity **1.0**,
     word-recitation 8/8, verdict **pass**; VLM review of the 3 real CogVideoX-3
     clips: humans visible, natural postures, credible expressions, no
     distortions/artifacts — honest residuals noted ("হাত সামান্য শক্ত",
     one prompt-random slightly-open mouth consistent with the no-lip-sync
     declaration). Evidence: `/tmp/r-wave4/evidence-tts.json`,
     `evidence-vlm.json`, `bn-sample.wav`, `en-sample.wav`, `frame-1..3.jpg`.

## 3. `findings/` — কাঁচা এজেন্ট-রেজিস্টার (read-only, as filed)

`findings/findings-a1.md` (Phases 1–3, 7 findings) ·
`findings/findings-a2.md` (Phases 4–5, 9 findings) ·
`findings/findings-b.md` (Defect A, 14 findings + RC-1…10) ·
`findings/findings-c.md` (Defect B, 10 findings) ·
`findings/findings-d.md` (Defect C, 12 findings) ·
`findings/findings-e.md` (QA/backtest, 11 findings + coverage matrix).
Each carries file:line evidence, severity per master §12, and honest
BLOCKED / NOT RUN labels. They describe the **pre-fix** state at
HEAD `c7927f7`; the fix wave's deltas are consolidated in
`root-cause-register.md` and `phase-status-matrix.md`.

## 4. Doc map — the 14 §14 deliverables

Statuses reflect the directory at this index's last update; the parallel
documentation wave (set 2) was still completing the final five files.

| # | Doc | One line | Status |
|---|---|---|---|
| 1 | `README.md` | This index: mission, methodology, findings pointer, doc map, verdict pointer | ✅ written (set 1) |
| 2 | `repository-baseline.md` | §1 baseline: git state at recovery start/end, phase→commit map, divergence history, rules honored | ✅ written (set 1) |
| 3 | `phase-status-matrix.md` | Per-phase verdicts (PASS / PASS WITH DOCUMENTED LIMITATIONS) with commits, REG files, live evidence, open items | ✅ written (set 1) |
| 4 | `tts-language-audit.md` | Critical Defect A synthesis: registry, RC-1…10, fix wave, Wave-4 live proof | ✅ written (set 2 — R-DOC-2) |
| 5 | `lipsync-capability-audit.md` | Critical Defect B synthesis: honest BLOCKED status, timing-contract fixes, future provider contract | ✅ written (set 2 — R-DOC-2) |
| 6 | `acting-and-cinematic-quality-audit.md` | Critical Defect C synthesis: 12 dimensions, real-run forensics, VLM spot-review, D-F02/03/04 fixes | ✅ written (set 2 — R-DOC-2) |
| 7 | `root-cause-register.md` | RC-1…RC-10 + non-TTS root causes, each with fix + regression lock; honestly-unfixed list | ✅ written (set 1) |
| 8 | `test-plan-and-fixtures.md` | §4.5/§5.5 case coverage after the wave; t20/t21 design; `defect-a-transcripts.json` fixture | ✅ written (set 2 — R-DOC-2) |
| 9 | `automated-test-results.md` | Final-suite evidence: 185/185, 1977 expects, 22 files, 184.96 s + four static gates | ✅ written (set 2 — R-DOC-3) |
| 10 | `offline-media-backtest-results.md` | Layer-C forensics: per-artifact ffprobe/ebur128/silence tables, E-F01/E-F02 chain | in progress (set 2) |
| 11 | `live-provider-test-requirements.md` | Layer-D sheets + the executed minimal Wave-4 calls and their evidence files | in progress (set 2) |
| 12 | `performance-measurements.md` | Existing measured timings (planner µs/call, stage metrics, latency baselines) with sample sizes; no invented numbers | in progress (set 2) |
| 13 | `security-and-diff-review.md` | Review of the uncommitted +2795/−475 recovery diff: no secrets, no migrations, no unrelated changes | in progress (set 2) |
| 14 | `phase-1-5-acceptance-report.md` | §13/§15 final verdict + remaining blockers + explicit no-commit/no-push/no-Phase-6 confirmation | in progress (set 2) |

## 5. Final verdict pointer

Per-phase verdicts live in **`phase-status-matrix.md`**
(Phase 1 PASS WITH DOCUMENTED LIMITATIONS · Phase 2 PASS WITH DOCUMENTED
LIMITATIONS · Phase 3 PASS WITH DOCUMENTED LIMITATIONS · Phase 4 PASS ·
Phase 5 PASS WITH DOCUMENTED LIMITATIONS). The overall §15 verdict and the
§13 completion-gate table are consolidated in
**`phase-1-5-acceptance-report.md`** (set 2). The fact base they must carry,
recorded here so it survives independently:

- Final suite **185 pass / 0 fail** — 1977 `expect()` calls, 22 files,
  184.96 s (baseline 157 + 28 new); typecheck 0 / lint 0 /
  `prisma validate` 0 / `git diff --check` clean (worklog R-FIX).
- Baseline HEAD `c7927f7` "phase-5: cinematic director & camera shot
  planning + review fixes" is **unpushed** (origin/main = `d982a4d`); all
  recovery changes are **uncommitted working-tree changes** on top
  (`git status --porcelain | wc -l` = 44).
- **No commit, no push, no Phase 6** — recovery stopped per delivery rules,
  awaiting user acceptance review.
- **Zero provider budget** except the documented minimal Wave-4 calls
  (1 SDK TTS en + 1 SDK ASR + 3 VLM frame reviews; Edge probes free).
- Honest residuals: Edge bn voices unreachable today (environmental — live
  §4.5 case 1 unverified), B-F11 adapter-level ws-mock test open, E-F05
  route-level SSE test gap, A2-F07 slot-fill integration lock, A2-F08
  publish blocker (push credentials). Full list: `root-cause-register.md` §3.
