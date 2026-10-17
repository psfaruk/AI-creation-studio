# Repository Baseline — recovery start & end state (§1 / §15.1)

Everything below was verified with **read-only git only** — the recovery
performed **zero git mutations** (no commit, no push, no reset, no amend,
no history rewrite).

## 1. Git state at recovery start (2026-10-16, master §1 commands)

| Item | Value | Verified by |
|---|---|---|
| Local `HEAD` | `c7927f7` — `c7927f742f7cdefb5c21e6951fd57190442d60e8` — "phase-5: cinematic director & camera shot planning + review fixes" (32 files, +6100/−204) | R-A1, R-A2 (both record it; re-verified now) |
| `origin/main` | `d982a4d` — `d982a4d9b2ebba449f8b1447c9308116c6ff85b4` — "worklog: phase-4 push approval (task P4-3)" | `git rev-parse origin/main` |
| Divergence | **ahead 1, behind 0** (`git rev-list --count origin/main..HEAD` = 1) — fast-forward-ready, no force needed | R-A2 (A2-F08) |
| Working tree | **clean (0 dirty)** at recovery start — all Phase-5 work was inside `c7927f7` | R-A1/R-A2 worklog entries |
| Unpushed? | **Yes** — the P5-7 push failed on credentials (see §3); Phase 5 existed only locally | worklog P5-7, A2-F08 |

So the recovery's true baseline = commit `c7927f7` + clean tree; everything
the recovery changed afterwards sits **uncommitted** on top (see §4).

## 2. Phase → commit map (verified via `git show --stat` + full source reads)

| Phase | Commit(s) | Content (as verified by the audits) |
|---|---|---|
| Phase 1 — foundation, tests & metrics | `8c472fb` → `c0384d2` → `568c0a4` | regression suite (shipped honestly 36/37 — REG-1a failing as P0-BUG-01 evidence, A1-F07), run-metrics observability, tool inventory + 8 docs; real chat errors, GLM-only catalog, app-key removal; proxy-aware auth, provider Base URL override, minimal `/api/v1` |
| Phase 2 — TTS fallback, active-run persistence | `2b0ef3e` → `acf147b` (worklog record `f5fe336`) | P0-BUG-01 fallback fix, chat 409 idempotency, client re-attach; event-bus replay-from-emit, SSE reconnect/dedupe, loop guards, firstToken latency, music intent split WAV+MP3 |
| Phase 3 — shot cache, audio mix, media reliability | `8ce272c` (25 files, +3276/−27) | workstreams A–D: motion-voiceover fallback, −16 LUFS two-pass final-mix loudness, SHA-256 shot cache, stage metrics |
| Phase 4 — intent-aware planning & settings | `310c712` (25 files, +3707/−23) + `92eb66d` (P4-2 review fixes) | Bengali intent classifier + 3-way orchestrator wiring, category config panel, awaiting_confirmation state machine, §15 `cinematicOverrides` whitelist; REG-14l null-clear fix |
| Phase 5 — cinematic director & shot planning | `c7927f7` (32 files, +6100/−204) | `cinematic/{types,planner,capability_map,prompt,validate,preview}`, plan-consuming pipelines, zero-LLM plan-preview route, ShotPlanPreview UI, plan metrics |

History-hygiene note (A1-F06, mitigation only — **no history rewrite**): the
Phase-4 implementation/review commits `310c712`/`92eb66d` carry UUID messages
on `origin/main`; phase→commit traceability for Phase 4 therefore rests on
this table + the worklog. Pushed history must not be rewritten (master §1).

Baseline suite at `c7927f7`: **157/157 PASS** (1720 expects, 20 files,
164.90 s — P5-7 gate), typecheck 0 / lint 0 / `prisma validate` 0 /
`git diff --check` clean.

## 3. Divergence history — the `a60bcaf` amend accident (why HEAD ≠ origin)

1. Phase-5 implementation was first committed **locally** as `a60bcaf` with a
   **duplicated/misleading message** ("worklog: phase-4 push approval (task
   P4-3)") created via two amends, alongside `96f7a0b` (UUID message) —
   local `main` became ahead-1/behind-1 (diverged; plain push would be
   rejected). Recorded honestly in worklog P5-7 and
   `docs/audit/phase-5/phase-5-exit-report.md` §5.
2. **P5-7 resolution (user-approved, pre-recovery)**:
   `git reset --soft origin/main` → one properly-labeled commit
   **`c7927f7`** sitting directly on `d982a4d` (ahead 1, behind 0). The
   accidentally-amended local commits never reached the remote; they survive
   only in the local reflog. Remote history stayed clean and linear
   (`… 92eb66d → d982a4d`, phase-5 pending).
3. **Push failed (authentication)**: the GitHub token embedded in the remote
   URL was rejected ("Invalid username or token"; API check 401) — the same
   token had worked at P4-3, i.e. it expired/was revoked since. All
   alternative paths empty (no credential helper, `~/.git-credentials`,
   `.netrc`, `~/.ssh`, `gh` CLI, env token). Consequence: **Phase 5 is
   unpushed** — publish blocker A2-F08, waiting on a valid PAT; then a plain
   `git push origin main` fast-forwards (no force).

## 4. Working tree at recovery end (uncommitted recovery changes)

- `git status --porcelain | wc -l` → **44**
  (= 39 tracked files modified, **+2795/−475** per `git diff --stat`,
  + 5 untracked paths).

| Bucket | Count | Detail |
|---|---|---|
| Modified source (`src/**`) | 30 | `language_controller.ts` (rewritten, 895 lines), `short_film.ts` (+651-class fix wave), `planner.ts`, `runner.ts`, `registry.ts`, `tools/audio.ts`, `tts-cache.ts`, `ai_video.ts`, `capabilities.ts`, `availability-matrix.ts`, `model-registry-data.ts`, `edge_tts.ts`, `orchestrator.ts`, `llm.ts`, `classifier.ts`, `cinematic/{types,planner,capability_map,prompt,validate}.ts`, pipelines `{audio,motion_video,music_video,voiceover}.ts`, chat route, runs-events route, `use-config-panel.ts`, `production-card.tsx`, `studio-view.tsx`, `security-gate.tsx`, `src/lib/types.ts` |
| Modified tests | 8 | `t1`, `t2`, `t3`, `t8`, `t12`, `t13`, `t16`, `t18` (rewrites = strengthenings, see §5; additions for new contracts) |
| New untracked code | 2 paths | `src/lib/agent/cinematic/lang-guard.ts` (lead-authored shared D-F03 contract), `tests/fixtures/` (`language/defect-a-transcripts.json` — the two real DB transcripts promoted to a tracked fixture) |
| New untracked tests | 2 | `t20-bengali-language-integrity.test.ts` (9 tests), `t21-dialogue-timing-contract.test.ts` (2 tests) |
| Docs | 1 path | `docs/audit/recovery-phase-1-5/` (this set + `findings/`) |
| Worklog | 1 | `worklog.md` (+133 lines — append-only R-A1…R-WAVE4 entries) |

These changes are **complete and gated** (185/185 + four zero-gates) but
**deliberately uncommitted**: master §1 forbids unauthorized commit/push, so
the decision — commit the recovery on top of `c7927f7` (or fold into a
combined Phase-5+recovery commit) and then push once credentials exist —
belongs to the user.

## 5. Rules honored (master §1) — with receipts

- **No destructive git / no history rewrite**: the recovery itself ran only
  read-only git (`status`, `rev-parse`, `log`, `show --stat`, `diff --check`,
  porcelain). The single `reset --soft` of the whole saga was P5-7 —
  pre-recovery, user-approved, unpushed-commits-only (documented §3).
- **Append-only worklog**: R-A1, R-A2, R-C, R-D, R-E, R-B, R-FIX, R-WAVE4
  were appended in execution/completion order; no prior entry was edited.
  (Environment incidents were logged honestly by the audits, not hidden.)
- **No test weakening — the t1/t8 rewrites are documented STRENGTHENINGS**:
  the pre-recovery REG-1a/1b/f/g and REG-8b/c/d asserted the *flawed*
  jam-fallback contract (B's finding: they locked "voice=jam" as success for
  Bengali). The rewrites assert the honest contract — bn + dead Edge ⇒ typed
  `VOICE_UNAVAILABLE` failure with **no** cross-language fallback (REG-8c/d),
  en fallback valid but capped at `warn` (REG-1i), actual-vs-requested voice
  recorded (REG-8f), bounded retry terminates (REG-8g). Net-new locks:
  REG-1h/1i, REG-2e, REG-3f/g, REG-13j, REG-16f4/16r1–r3, REG-18k, and the
  new files t20 (REG-20a…h) + t21 (REG-21a/b). Suite count went **up**
  157 → 185; no test was deleted.
- **No secrets**: findings cite masked keys/taskIds only; provider keys live
  in gitignored `storage/` (re-verified by A1's non-findings pass).
- **No unauthorized spend**: zero provider calls in the 6 audits + fix wave;
  the only spend is the documented minimal Wave-4 set (1 SDK TTS en +
  1 SDK ASR + 3 VLM frame reviews; Edge probes free).
- **No migration**: the recovery changed no Prisma schema (verified: no
  `schema.prisma` in the 44-path change set; `prisma validate` exit 0).
