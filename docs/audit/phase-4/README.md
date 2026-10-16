# Phase 4 — Audit Documentation

**Phase**: Intent-Aware Creative Planning, Capability-Aware Configuration, and Chat-Native Tools UI
**Baseline**: `8ce272c61f175ee8fe0e432e752f40ea6af366a9` (`feat: improve media quality and shot reuse`) — worktree clean at start; all Phase 0–3 features preserved.
**Result**: PASS WITH DOCUMENTED NOT-RUNS (see `phase-4-exit-report.md`). Suite 118/118 (75 inherited unchanged + 43 new REG-12…15). No provider budget spent, no DB migration, no commit/push (awaiting approval).

## Documents

| File | Content |
|---|---|
| `baseline-and-architecture.md` | Workstream A audit: baseline, full architecture map with file:line references, what existed vs. what Phase 4 added, constraints. |
| `implementation-design.md` | Pre-implementation design (written before coding, per workflow Step 2): contracts, wiring plan, test matrix, rollback. |
| `intent-routing-design.md` | Workstream B: the deterministic classifier — categories, rules, normalized intent object, fast path, hint path, upgraded fallback. |
| `configuration-ui-design.md` | Workstream C: chat-native category-specific panels — schema-driven fields, song selector, field-level validation, plan preview, states. |
| `capability-validation.md` | Workstream D: the single authoritative validation path — schema endpoint, live validate endpoint, verdict mapping, security properties. |
| `execution-and-progress.md` | Workstream E+F: plan states, confirmation → real execution wiring, truthful progress, duplicate-run protections (all extending the existing architecture). |
| `test-results.md` | Workstream I: exact pass/fail counts per suite, boundaries of each test file, honest NOT-RUN/BLOCKED list. |
| `phase-4-exit-report.md` | Exit status, deliverables, acceptance criteria vs. evidence, remaining defects, follow-ups. |

## One-paragraph summary

The repository already had a production lifecycle with an in-chat confirmation card (`ProductionCard`), a shared validated creation path (`createProduction` → `validateSpec`), and SSE progress. Phase 4 added the missing intent layer: a deterministic, testable classifier (`src/lib/agent/intent/`) feeding (a) a labeled fast path that turns clear big-work requests into an editable settings card with **zero LLM round-trips**, (b) an LLM context hint that improves proposal quality and asks one concise clarification when needed, and (c) the upgraded rate-limit fallback; a server-owned configuration-schema contract (`config-panel.ts` + `GET /api/productions/config-panel`) derived 1:1 from `capabilities.ts` (no parallel capability list — drift impossible), a live validation endpoint (`POST /api/productions/validate`) returning structured verdicts (`supported` / `supported_with_limitations` / `unsupported` / `requires_clarification` / `temporarily_unavailable`); and panel upgrades: music-video song selector, disabled-with-reason options (60fps, 4K), field-level validation errors, plan preview (workflow steps, estimated shots, audio strategy, known limitations, historical ETA), and honest server-side revalidation at confirm. Ordinary questions never route into production; singing/lip-sync stay explicitly unsupported with real alternatives.
