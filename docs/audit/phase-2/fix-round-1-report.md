# Phase-2 Round 1 — Fix Report (Git/Report Integrity + P0-BUG-01 + REG-3 Guard + P0-BUG-03)

Scope (user-approved, in order): (1) git/report integrity correction, (2) P0-BUG-01 Bengali TTS fallback fix with REG-1a/1b updated to the real expected behavior, (3) REG-3 idempotency guard, (4) P0-BUG-03 client run re-attach. No other Phase-2 feature was started. Nothing pushed.

## 1. Git / report integrity (task 1)

- **Phase-1 commit amended** (was `6f528cf`, bare-UUID message → now this branch's Phase-1 commit with a descriptive message; unpushed, so the amend is safe). Hash mapping documented in the worklog (`P1-verify` → `P2-1` entries).
- **Docs corrected inside that commit:** `phase-1-exit-report.md` §1/§2 (the false "no commit made — awaiting approval" git-state claim now documents the actual commit + amendment) and exit status line (PASS → **PASS WITH BLOCKER**, with the revision reason); `baseline-report.md` §2/§7 (4b628fa mischaracterized as "worklog-only" — actually the Phase-0 audit-docs commit + 3 mode-only permission changes).
- **Environment discovery (documented, not fought):** the sandbox has an auto-committer that periodically commits the dirty tree with UUID messages (reflog evidence: `a23370d "311b0d82-…"`). A non-destructive `git reset` (mixed, tree-preserving) + re-amend was used to undo an accidental interaction with it. The Phase-2 work is committed locally by the agent with a proper message before the next auto-commit could interfere.

## 2. P0-BUG-01 — Bengali TTS fallback (task 2)

**Root causes fixed (all three, per the bug register):**

| # | Defect | Fix |
|---|---|---|
| 1 | Per-voice `cachedSynthesizeSpeech` call un-caught — first Edge 403 escaped the loop and killed the whole chain | Wrapped in try/catch; engine failure marks the engine dead and the chain continues (`language_controller.ts`) |
| 2 | Loop cap `attempts >= Math.min(2, voices.length)` made z-ai voices structurally unreachable | Cap removed — the loop walks the whole bounded profile chain (bn: 5 voices, en: 7) |
| + | Engine-aware skip (the register's proposed fix b) | A hard engine failure (Edge 403) skips the remaining voices of that engine — no wasted calls — and jumps to the next engine (z-ai) |
| 3 | short_film dialogue lines 2+/narration + audio chunks 2+ called plain `cachedSynthesizeSpeech` (single-engine, no fallback) | All now route through `synthesizeVerifiedSpeech(..., { verify: false })` — same cost (no ASR), full fallback chain. short_film also tracks the **effective voice per character** so later lines reuse the voice the fallback actually established |

Honesty preserved: fallback results carry a note ("ইঞ্জিন-ফলব্যাক ব্যবহার হয়েছে — আগের ইঞ্জিন ব্যর্থ (…)"); total engine exhaustion rejects with an honest error naming both engine failures — never a fake success.

**Tests:** REG-1a rewritten to the real expected behavior (z-ai `jam` reached, engine-aware skip = exactly 1 Edge call, attempts=2, `warn` verdict, fallback note). REG-1b rewritten to the new chain contract (all 3 Edge voices tried on verification-failure, then `jam`, attempts=4). New REG-1f (verify:false path used by pipeline lines 2+). New REG-1g (both engines dead → honest reject, one call per engine). **7/7 pass.** Pre-fix evidence preserved in the phase-1 commit (git history).

## 3. REG-3 — duplicate-submission idempotency guard (task 3)

`/api/chat` now rejects a new submission with **409 + `activeRunId`** while a run is `running` for the same conversation. The guard runs **before user-message creation** (a rejected submission never pollutes the conversation), is strictly per-conversation, and clears on terminal state (`running` is the only active status). Tests: REG-3a (409 + activeRunId, no second run, no stray user message), REG-3b (rapid double-submit → at most one run), REG-3c (404 unchanged), REG-3d (guard clears on terminal), REG-3e (per-conversation). **5/5 pass.**

## 4. P0-BUG-03 — client run re-attach (task 4)

- **New React-free module** `src/hooks/active-run-persistence.ts`: save/read/clear run identity in localStorage with a 12-minute stale cutoff (server sweep interrupts runs at 10 min), two-tab-safe conditional clear, malformed-entry safety, no-storage degradation.
- **`use-agent-run.ts`:** persists the run on successful send; clears on `run_finished` (and on both polling-fallback terminal paths); re-attaches on mount/conversation-switch when a fresh persisted entry matches the current conversation (one attempt per run — loop-guarded); handles the new 409 by restoring the draft and attaching to the live run instead of surfacing an error.
- The server half (pure-DB SSE replay for any late connector — running *or* finished) was already green (REG-2/REG-4); the re-attach rides on it.
- Tests: new REG-7 (6 persistence units) + REG-2d updated to the post-fix precondition. The EventSource re-attach wiring itself is typechecked + source-verified (no RTL in the suite — deliberate, documented).

## 5. Verification (all commands re-run post-fix; exit codes verbatim)

| Check | Command | Exit | Result |
|---|---|---|---|
| Tests | `bun run test` | **0** | 47 tests / 8 files — **47 pass / 0 fail** (was 36/37 with REG-1a failing) |
| Typecheck | `bun run typecheck` | **0** | 0 errors (test shim extended with `rejects`/`toThrow` matchers) |
| Lint | `bun run lint` | **0** | 0 errors |
| Prisma | `bunx prisma validate` | **0** | schema valid (no destructive command run) |
| Build | — | — | **NOT RUN** (`next build` disallowed in this sandbox — no claim made) |
| Live providers (Edge-down window, real TTS fallback, browser E2E) | — | — | **BLOCKED** — no budget/browser-harness authorization this round; contracts are mock-verified (REG-1) + typechecked/source-verified (client wiring) |

## 6. Files changed this round

Production: `src/lib/agent/audio/language_controller.ts` (fallback loop), `src/lib/agent/production/pipelines/short_film.ts` (speech step), `src/lib/agent/production/pipelines/audio.ts` (synthesize step), `src/app/api/chat/route.ts` (guard), `src/hooks/use-agent-run.ts` (persist/clear/409/reattach), `src/hooks/active-run-persistence.ts` (new). Tests/docs: t1 (rewritten contracts), t2 (REG-2d), t3 (rewritten), t7 (new), `tests/helpers/fake-db.ts` (+`agentRun.findFirst`), `tests/bun-test-shim.d.ts` (+matchers), `tests/README.md`, `docs/audit/phase-0/bug-register.md` (status updates on BUG-01/03), this report. Docs-only corrections to the phase-1 audit set were amended into the phase-1 commit itself (§1).

## 7. Known limits / follow-ups

1. `motion_video.ts:645` still calls `cachedSynthesizeSpeech` directly (same single-engine pattern) — **not** in P0-BUG-01's path list, left untouched (scope discipline); recommend including it in the next round.
2. Live validation of the fallback in a real Edge-403 window (REG-1's regression plan, live half) — budget-gated.
3. Browser-level E2E of refresh→re-attach — needs a DOM harness or manual owner pass.
4. P0-BUG-02 (film loudnorm) and P0-BUG-04 (shot reuse) remain open, untouched this round.
