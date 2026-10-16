# Phase-1 — Exit Report (Task 8)

## 1. Starting and ending state

| | Start | End |
|---|---|---|
| Branch / commit | `main` @ `4b628fa5e38971e87268fcb3074625c72104fe63` | `main` @ the Phase-1 commit — **the work in §2–§3 was committed** (originally created 2026-10-15 09:15:01 with a bare-UUID message; message and this report's git-state rows amended for traceability in the Phase-2 integrity pass). Unpushed at report finalization |
| Working tree | **Clean** (0 modified / 0 untracked) | Clean — the 3 modified files + new paths listed in §3 form the Phase-1 commit's content (see §2) |
| Dev server | Running :3000, healthy | Running :3000, healthy (HMR picked up all changes; no runtime errors in dev.log) |
| Dev database | 3 runs / 1 production / 8 artifacts / 3 toolCalls | **Unchanged** (read-only access only; no resets, no test writes) |

## 2. Initial vs final working-tree status

- Initial: clean (verified before any modification; nothing to preserve).
- Final (committed as the Phase-1 commit — 25 files, +2,651/−0; unpushed, reviewable via `git show`):
  - Modified: `package.json` (+1 script line), `src/lib/agent/orchestrator.ts` (+50 lines), `src/lib/agent/production/runner.ts` (+56 lines) — **107 insertions, 0 deletions** across production code.
  - New: `tests/` (13 test/helper/doc files), `src/lib/agent/run-metrics.ts`, `scripts/phase1-inventory.ts`, `docs/audit/phase-1/` (this document set).
- Reporting-integrity correction (Phase-2 pass): an earlier revision of this section claimed "no commit made — awaiting approval"; that was inconsistent with the actual repository state (the commit existed). This section now documents the commit. The original commit was made after the report text was drafted but before it was published; neither the worklog nor this report recorded it at the time — corrected here.

## 3. Files changed and reasons

| File | Reason |
|---|---|
| `package.json` | Add `"test": "bun test tests"` (Task 2 deliverable: documented test command) |
| `src/lib/agent/run-metrics.ts` (new) | Minimal observability layer: run-scoped retry accumulator + `[run-metrics]`/`[production-metrics]` JSON lines, redaction-safe, HMR-safe (Task 4) |
| `src/lib/agent/orchestrator.ts` | Wire retry waits (`noteRetryWait` in `chatCompleteWithNotes`), tool names (`executeToolCall`), and the end-of-run metrics line in `finalizeRun`/`failRun` (Task 4). Additive only; all existing behavior unchanged |
| `src/lib/agent/production/runner.ts` | End-of-production metrics line (normal + fail paths) with queue wait/duration/step/artifact tallies (Task 4). Additive only |
| `tests/**` (new) | Regression suite (Tasks 2+3): 6 regression files + smoke/invariants + in-memory fake DB + SSE harness + type shim + README |
| `scripts/phase1-inventory.ts` (new) | Read-only runtime dump of the tool registry used as evidence for Task 6 (no side effects) |
| `docs/audit/phase-1/**` (new) | This document set (Phase-0 docs untouched) |

## 4. Test framework and reproducible commands

`bun:test` (zero new dependencies). Commands: `bun run test` (full suite), `bun test <file>`, `-t <name>` filtering. Full isolation contract in `tests/README.md`.

## 5. Six core regression tests — verdicts

| ID | Verdict | One-line summary |
|---|---|---|
| REG-1 Bengali TTS fallback | **FAIL — application regression (P0-BUG-01), recorded** | Edge 403 escapes the fallback loop uncaught; even caught, the 2-attempt cap makes z-ai voices structurally unreachable (REG-1b characterizes this passing) |
| REG-2 Chat refresh/reconnect | **PASS** (server side) | DB replay recovers run identity, in-flight tools, terminal state; client re-attach gap documented as P0-BUG-03 client half |
| REG-3 Duplicate submission | **PASS** (documents the gap) | Duplicate active runs CAN be created; expected idempotency contract recorded, not enforced |
| REG-4 SSE replay | **PASS** | Bus replay ordering/cap/grace + route dedupe + reconnect replay order + text_delta correctly not replayed |
| REG-5 Instrumental audio | **PASS** | Valid WAV, truthful metadata, real-ffmpeg QC gate, seed determinism, clamping |
| REG-6 HTTP 429 retry | **PASS** | Bounded retries, honest TemporarilyUnavailableError, 401 never retried, Retry-After honored, budget fast-fail, channel serialization |

Suite: **37 tests — 36 pass / 1 fail (the recorded regression), exit code 1**, deterministic across 3 runs. Details: [test-suite.md](test-suite.md).

## 6. Typecheck / lint / build / DB validation

| Check | Command | Exit | Status |
|---|---|---|---|
| Tests | `bun run test` | 1 | 36/37 pass; 1 recorded regression failure |
| Typecheck | `bun run typecheck` | 0 | 0 errors |
| Lint | `bun run lint` | 0 | 0 errors |
| Prisma | `bunx prisma validate` | 0 | schema valid |
| Build | `bun run build` | — | **Not Run** (sandbox disallows `next build`) — no claim made |

## 7. Observability — implemented vs not measured

Implemented: run/production identifiers, outcome + endReason + errorCategory (safe classification), usedModel + cacheStatus, steps/toolCalls, durationMs, firstTokenMs (chat), retryWaitMs + retryCount (LLM channel), toolNames, queue wait + step/artifact tallies (productions). Not measured (logged/`null` or derivable only): phase-level planning duration, intra-provider submit-vs-poll split, tool-internal retry waits, explicit download timing, QC-phase timing, first-artifact latency for productions. Full matrix: [observability.md](observability.md).

## 8. Latency baseline (summary)

- Real LLM (GLM SDK, historical, n=3): firstToken 1.2/3.2/4.7 s; run duration 14.9/25.5/49.1 s.
- Real short-film pipeline (historical): 24 min total; **AI shots ≈ 18 min (3× CogVideoX-3) — dominant bottleneck by ~7×**; queue 25 s; final_mix 130 s; character_bible 152 s.
- Local compute (measured now): instrumental synth ≈ 0.7 s (10 s audio) / 4.9 s (120 s); ffmpeg QC ≈ 0.8 s.
- Mocked provider latency: not reported as provider latency by design. Image/voiceover/music-video live latency: **blocked** (no budget) — unmeasured.
- No P90/P95 claimed anywhere (max same-type sample n=3). Details: [latency-baseline.md](latency-baseline.md).

## 9. Tool inventory (summary)

41 executable tools (not 42 as briefing expected — verified at runtime, parity locked by test). Classification: **KEEP 36 · INVESTIGATE 5** (`text_to_speech`, `inspect_image`, `inspect_media`, `animate_image` — overlaps/unknown usage) **· CANDIDATE ADD 1** (`search_productions`, full proposal in the inventory) **· REMOVE 0**. No tool removed, disabled, or added. Details: [tool-inventory.md](tool-inventory.md).

## 10. Confirmed bugs vs hypotheses (Phase-1 additions)

**Confirmed (now machine-verified by tests — upgraded from source-reasoned):**
1. P0-BUG-01 defect #1 — Edge 403 uncaught in `synthesizeVerifiedSpeech` (REG-1a).
2. P0-BUG-01 defect #2 — loop cap blocks z-ai fallback (REG-1b).
3. P0-BUG-03 server half — duplicate active runs possible; chat POST has no active-run guard (REG-3a).
4. SSE replay/dedupe/reconnect contract works as designed (REG-2/4 — positive confirmations).
5. Retry machinery bounds/cooldown budget/serialization work as designed (REG-6 — positive confirmations).
6. Instrumental engine honesty + determinism + clamping (REG-5 — positive confirmations).

**Hypotheses still open (unchanged, tested only by source this phase):** P0-BUG-08 impact, P0-BUG-13 (two concurrent AI-video productions) — both need live fault-injection/multi-production passes. **New hypothesis:** none.

**Known limitation documented:** `synthesizeInstrumental` with an unknown mood throws a raw TypeError (REG-5e) — graceful input validation recommended in Phase 2.

## 11. Known limitations and blocked tests

1. Live owner-session chat run → `[run-metrics]` line capture — **blocked** by the active owner-security gate (passcode not available) + no live-LLM budget. Covered by unit tests + direct invocation instead.
2. Real provider latency (image/TTS-success/video) — blocked by budget authorization; historical evidence only.
3. Browser EventSource reconnection — source-verified only (no DOM test added; RTL not justified).
4. Production build — disallowed by sandbox.
5. Windows behavior — Hypothesis-only (unchanged).

## 12. Risks and prerequisites for Phase 2

1. **Fix P0-BUG-01 first** (small, isolated, now test-guarded): try/catch per voice + engine-aware skip + cap extension. REG-1a flips to PASS; REG-1b must be updated to assert the fixed contract.
2. **P0-BUG-03**: persist `activeRunId` client-side and re-attach on mount (server replay is proven ready by REG-2); consider the 409/dedupe server guard per the recorded idempotency contract (REG-3).
3. Latency work should target the **AI-shot pipeline** (≈75% of a short film's wall time) — P0-BUG-04 (shot reuse) is the largest cost lever; measure per-shot submit/poll before redesigning.
4. Observability next steps (§5 of observability.md): tool-internal retry waits, production phase timers, first-artifact latency.
5. The one-fail suite state must be treated as the burn-down tracker: exit code returns to 0 exactly when REG-1a's contract is met.

## 13. Phase-1 exit gate

| Acceptance criterion | Status |
|---|---|
| Current baseline + existing user changes documented | ✅ (baseline-report.md — tree was clean) |
| Reproducible test command exists | ✅ `bun run test` (37 tests, deterministic) |
| Six regression tests have explicit, honest results | ✅ 5 PASS + 1 recorded FAIL (application regression, not hidden) |
| Test failures visible and traceable | ✅ exit code 1; stack trace points at the exact production line |
| Basic observability implemented or gaps documented | ✅ both (layer implemented; matrix documents every not-measured field) |
| Latency baseline recorded where measurable | ✅ (real n=3 LLM + full production breakdown + local compute; blocked metrics listed) |
| Current agent tools inventoried | ✅ 41 tools, evidence classes, overlap analysis |
| Add/remove recommendations evidence-based, no production-tool changes | ✅ KEEP 36 / INVESTIGATE 5 / ADD-candidate 1 / REMOVE 0; zero tools touched |
| Typecheck/lint/DB validation re-run | ✅ all exit 0 |
| Build status accurately reported | ✅ Not Run (disallowed) — no claim |
| All intentional changes documented | ✅ §3 |
| Final working-tree state reported | ✅ §2 |

**Phase-1 exit status: PASS WITH BLOCKER** *(revised in the final verification pass — the original "PASS" understated two open items: the REG-1a application regression keeps `bun run test` at exit 1, and this report's original git-state claim was corrected above; see the verification worklog entry `P1-verify`)*. The single recorded application regression REG-1a intentionally fails as machine-verified evidence for Phase 2.

**Phase 1 stops here. No Phase-2 work was started. Awaiting approval.**
