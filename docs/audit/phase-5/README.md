# Phase 5 — Cinematic Director & Camera Shot Planning

**Objective**: capability-aware cinematic planning that turns an accepted music-video /
short-film request into a structured, validated shot plan, and makes that plan drive the
**real** prompts and parameters sent to the video-generation pipeline — honestly.

## Documents

| File | Content |
|---|---|
| `baseline-and-architecture.md` | §0 baseline verification + audit of existing scene/shot derivation, provider capability facts, defects found |
| `cinematic-shot-plan-design.md` | Shot-plan data contract (typed, versioned, validated), deterministic planner rules (music-video + short-film), diversity rules |
| `capability-and-provider-mapping.md` | Camera-language capability map: native vs prompt-guided vs downgraded; per-engine delivery verdicts; honesty labels |
| `pipeline-integration.md` | How the plan reaches the real pipeline: spec overrides, confirm §15 revalidation, per-shot prompts, plan artifact, per-shot metadata, cache interaction |
| `test-results.md` | Exact results of every required verification command + per-suite outcomes |
| `quality-and-performance-evidence.md` | Measured planner timings, LLM round-trip delta, cache behavior, prompt-mapping coverage |
| `phase-5-exit-report.md` | Final verdict, confirmed vs NOT-RUN separation, limitations, Phase-6 follow-ups |

## Non-negotiables preserved from earlier phases

- Phase-4: intent classification (fast path), config panel + live validation, confirm §15
  revalidation + 409 exactly-once, song deselect null-clear contract (REG-14l).
- Phase-3: shot cache (fingerprint = full provider request), video stage metrics.
- Phase-2: SSE replay/dedupe, run re-attach, chat 409 idempotency.
- Phase-0/1: loudness normalization (REG-9), TTS fallback (REG-1), observability.

## Hard rules

- No commit, no push, no Phase 6, no paid provider spend in Phase 5 work.
- Camera movement is **never** advertised as a guaranteed native provider feature.
- Music-video plans never claim singing or lip-sync support.
- Every generation-affecting plan field reaches the provider prompt; planning-only fields
  are explicitly labeled.
