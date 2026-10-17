# Phase Status Matrix — Phases 1–5 after the recovery fix wave

Verdict vocabulary per master prompt §15.17: **PASS / PASS WITH DOCUMENTED
LIMITATIONS / NOT READY / BLOCKED / NOT VERIFIED** (NOT VERIFIED marks an
evidence state, never silently treated as success). "A1/A2" = repository
auditors; "fix wave" = R-FIX (worklog, severity-ordered); baseline verdicts
are the auditors' pre-fix assessments at HEAD `c7927f7`, updated with the
fix-wave deltas. Post-fix state is proven by the final gate:
**185 pass / 0 fail** (1977 expects, 22 files, 184.96 s; baseline 157 + 28
new tests), typecheck 0 / lint 0 / `prisma validate` 0 / `git diff --check`
clean — **uncommitted** on top of `c7927f7`, no push, Phase 6 not started.

## Summary

| Phase | Verdict (post-fix) | Auditor (baseline) | Blocking defects open |
|---|---|---|---|
| 1 — Foundation, tests & metrics | **PASS WITH DOCUMENTED LIMITATIONS** | A1 (same) | none |
| 2 — TTS fallback, active-run persistence | **PASS WITH DOCUMENTED LIMITATIONS** | A1 (contracts passed; Defect-A cluster later proven in this phase's fallback chain — now fixed) | none code-level; Edge availability environmental |
| 3 — Shot cache, audio mix, media reliability | **PASS WITH DOCUMENTED LIMITATIONS** | A1 (same) + E's Layer-C findings (now fixed) | none; live-provider cache-hit NOT RUN |
| 4 — Intent-aware planning & settings | **PASS** | A2 (PASS) | none |
| 5 — Cinematic director & shot planning | **PASS WITH DOCUMENTED LIMITATIONS** | A2 (same; 6 follow-ups → 3 now fixed) | publish blocker (push credentials) only |

---

## Phase 1 — Foundation, tests & metrics → PASS WITH DOCUMENTED LIMITATIONS

| Row | Evidence |
|---|---|
| Implementation commits | `8c472fb` → `c0384d2` → `568c0a4` (content verified by A1) |
| Tests | REG-1…REG-7 + smoke at phase time (shipped honestly 36/37 — REG-1a failing = P0-BUG-01 machine evidence, A1-F07); surviving locks: REG-6 (bounded retry), REG-15 (metrics/redaction) — green in the 185/185 suite; REG-11 directly re-run by A1 (t11 → 4/4) |
| Live evidence | real-GLM firstToken/duration samples n=3 with honest no-P95 disclaimers (`docs/audit/phase-1/latency-baseline.md`); `/api/v1` curl E2E (`568c0a4`) |
| Open items | A1-F05 **FIXED** (hardcoded "চেষ্টা n/৬" → shared `llm.ts:29` constant rendered at `orchestrator.ts:437`); A1-F07 record-only. Documented NOT-RUNs are environment constraints, not code gaps: `next build` (sandbox), live-provider latency for image/voiceover/MV, browser-DOM EventSource tests |
| Rationale | every §3 Phase-1 checklist item implemented, wired, test-locked; no disconnected/dead/mock-only code in scope (A1 integration table); provider adapters call the real SDK; redaction canary-locked |

## Phase 2 — TTS fallback, active-run persistence → PASS WITH DOCUMENTED LIMITATIONS

| Row | Evidence |
|---|---|
| Implementation commits | `2b0ef3e` → `acf147b` (worklog `f5fe336`) |
| Tests | REG-1 (rewritten REG-1a/b/c/f/g + **new** REG-1h/1i — strengthening, see repository-baseline §5), REG-2 (+ new 2e), REG-3 (+ new 3f/3g), REG-4, REG-5, REG-6, REG-7, REG-8 (rewritten 8b/c/d/f/g), REG-20 (new t20: 9 tests incl. the two real DB-transcript fixtures) |
| Live evidence | Edge-TTS protocol discovery 2026-10-13 (`edge_tts.ts` header); browser E2E refresh-mid-run/cancel/mobile at `acf147b`; **Wave-4 live**: bn line → typed `VOICE_UNAVAILABLE` (attempts=1, exact §4.2 message — pre-fix this situation produced Chinese-garbage audio), en control → real SDK TTS + ASR round-trip, similarity 1.0, word-recitation 8/8, verdict pass |
| Open items | FIXED in the wave: A1-F01 zombie-run 409 lockout (chat-route staleness sweep, `chat/route.ts:163-180`, locked REG-3f/3g), A1-F02 runs-SSE unbounded lifetime (`MAX_LIVE_MS`, runs events route, locked REG-2e), and the Defect-A root causes that lived in this phase's fallback chain — RC-1…RC-9 (bn chain purged of jam/douji, capability-tagged fail-closed, verdict gate, provenance). Still open: B-F11 adapter-level Edge ws-mock units (RC-10), browser-DOM re-attach harness (documented gap), §4.5 case 1 (bn live success) unverified while Edge is unreachable (environmental) |
| Rationale | resilience contracts (409/replay/reattach/cancel/partial) all real and locked; the recovery proved the Phase-2-era bn fallback design carried Defect A — post-fix the chain fails **honestly** instead of silently degrading, which is the state this verdict now describes |

## Phase 3 — Shot cache, audio mix, media reliability → PASS WITH DOCUMENTED LIMITATIONS

| Row | Evidence |
|---|---|
| Implementation commits | `8ce272c` (workstreams A–D) |
| Tests | REG-8…REG-11 (t8–t11; A1 re-ran t11 → 4/4), REG-9a loudness band, REG-10 fingerprint sensitivity (every-field a≠b/a≠c/a=d); recovery additions: REG-21b (film-end overflow detection + per-line timing contract) |
| Live evidence | phase-time live NOT RUN (documented in phase-3 exit report); post-recovery Layer-C forensics on the one real recorded artifact (E): exact 30.000 s A/V streams, SRT cues matching measured WAV durations, verdict machinery working on real bytes — and the two contract violations it exposed (E-F01 loudness drift −14.4 vs −16.3 reported; E-F02 silent 87% narration truncation) are now **fixed and regression-locked** |
| Open items | FIXED: A1-F03 fingerprint byte-exactness (`ai_video.ts:555-556` — `.trim()` removed so key = exact submit body), A1-F04 tts-cache unbounded (256 MiB budget + oldest-first sweep, `tts-cache.ts:119,129-133`), E-F01 (loudness now measured on the **delivered** final + honest deviation note, `short_film.ts:1870-1890`), E-F02 (overflow detected + honest `action:'truncated'` records, `short_film.ts:1509-1526, 1673-1683`), E-F03 (JPEG bytes never labeled `image/png` — magic-byte sniffing, `short_film.ts:640-643, 1324-1330`). Open: E-F08 media fixtures only partially promoted (DB transcripts ✓ in `tests/fixtures/language/`; real WAV/MP4 copies still untracked), live-provider cache-hit + real before/after loudness artifact remain NOT RUN |
| Rationale | cache fingerprint/reuse/isolation, two-pass loudnorm, A/V sync and partial-status contracts all code-verified and green; the real-artifact forensics loop (Layer C) is now bootstrapped and already paid for itself twice |

## Phase 4 — Intent-aware planning & settings → PASS

| Row | Evidence |
|---|---|
| Implementation commits | `310c712` (+3707/−23) + `92eb66d` (P4-2 review fixes; UUID messages — traceability via the phase→commit map, A1-F06, no rewrite) |
| Tests | REG-12 (intent routing incl. REG-12k honest lip-sync-unsupported), REG-13 (config panel + **new** 13j schema-cache health), REG-14 (capability-confirm state machine, §15 sanitization, REG-14l), REG-15 (intent metrics + redaction) |
| Live evidence | browser E2E P5-3 (671/671 requests 200, 0 console errors); A2's empirical classifier spot-check on the real module: **12/12** Bengali cases routed as expected incl. honest `requires_clarification` |
| Open items | both A2 P3s fixed in the wave: A2-F01 dead export `verdictLabelBn` removed, A2-F02 `schemaCache` now TTL-aware + invalidable (locked REG-13j). Remaining is inherent-and-honest: rule-based classifier has lexical limits with a verified clarification fallback; config panel is a display contract (server re-validates) |
| Rationale | state machine (`awaiting_confirmation` → 409-guard → validateSpec → queued → runner re-validate), settings→payload→prompt flow, §15 whitelist survival and honest-unsupported all verified end-to-end with zero P0/P1/P2 |

## Phase 5 — Cinematic director & shot planning → PASS WITH DOCUMENTED LIMITATIONS

| Row | Evidence |
|---|---|
| Implementation commits | `c7927f7` (32 files, +6100/−204) — **unpushed** (A2-F08 publish blocker: push credentials) |
| Tests | REG-16 (plan contract + wave additions 16f4/16r1/r2/r3 + 16i extension), REG-17 (MV incl. override→pipeline REG-17e), REG-18 (preview route + new 18k skeleton diversity), REG-19 (SF hermetic full-run), REG-21 (new: REG-21a the P0 pipeline gate — fail-verified line not mixed, headline verdict loses "চমৎকার"; REG-21b timing contract + overflow) |
| Live evidence | browser E2E P5-3 (overrides re-render, plan-preview refetch 200×2, 0 errors, zero `/confirm`); the real user-initiated romantic short-film run (D: Production `cmvbbv86c000apzrc9mra61oi` — 3 real CogVideoX-3 clips, 2 portraits, 2 dialogue lines) now analyzed and its defect chain fixed; Wave-4 VLM review of the 3 real clips' mid-frames: humans visible, natural postures, credible expressions, no distortions — honest residuals ("হাত সামান্য শক্ত"; one prompt-random slightly-open mouth consistent with the no-lip-sync declaration). Human acting review (§6.4 sheet): **NOT REVIEWED** |
| Open items | of the six phase-5-exit §6 follow-ups, **3 now fixed**: §6.1 origin parity (A2-F04 — `resolveArtifactFile` conversation-scoped + `requireUserUpload` for song inputs, `runner.ts:383-400`), §6.3 scene lighting placeholder (A2-F05 — `lightingProvenance: 'planning_only_generic'` honest marker, `planner.ts:576-580, 819-823`), §6.4 64-cap silent drop (A2-F03 — over-cap entries counted in `droppedCount`, `planner.ts:952-954`, REG-16i). Also fixed this wave: A2-F01/F02 (Phase-4 items above), A2-F06 skeleton diversity guard (`planner.ts:492,809,835`, REG-18k), D-F02 speaker→shot-window alignment (`short_film.ts:212-223` + speaks→prompt), D-F03 prompt-language guard (`cinematic/lang-guard.ts` + `short_film.ts:849-854, 1284-1287`, REG-16r3), D-F04 two-character OTS/reaction distribution (`planner.ts:725-745`, REG-16r1/r2/f4). Still open: §6.2 MV character slot-fill integration lock (A2-F07), §6.5 >8-adjustments truncation label browser-unexercised, §6.6 LLM plan refinement (by design, not implemented), A2-F08 unpushed commit |
| Rationale | deterministic planners, capability-honest camera verdicts, plan→prompt→provider-body integrity and cache coupling all re-verified holding at HEAD by A2 with zero contradictions vs worklog; the real run's defects (fail-dialogue mixed, misaligned speakers, Bengali prompts, overflow) are fixed + locked; limitations that remain are coverage/publish/environment items, honestly listed |

---

## Cross-phase state

- **Suite**: 185 pass / 0 fail (1977 expects, 22 files, 184.96 s) — baseline
  157 + 28 new; four static gates zero; `git diff --check` clean.
- **Uncommitted**: all recovery changes sit in the working tree on top of
  `c7927f7` (`git status --porcelain | wc -l` = 44) — awaiting the user's
  commit/push decision; **no commit/push was made, Phase 6 not started**.
- **Budget**: zero provider spend except the documented minimal Wave-4 calls
  (1 SDK TTS en + 1 SDK ASR + 3 VLM frame reviews; Edge probes free).
- Overall §15 verdict: consolidated in `phase-1-5-acceptance-report.md`
  (documentation set 2); nothing in this matrix downgrades a documented
  NOT RUN / NOT VERIFIED into a pass.
