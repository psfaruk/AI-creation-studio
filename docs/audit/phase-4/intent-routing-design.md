# Phase 4 — Intent Routing Design & Results (Workstream B)

## 1. What existed before

- LLM-driven routing only: the system prompt (`prompts.ts`) instructs the model to call `propose_job` for big work; reliability depended on prompt-following.
- `detectProductionIntent` (orchestrator.ts) — a 6-pattern regex used **only** as a rate-limit fallback (`tryIntentFallback`) when the chat LLM was 429-exhausted.

## 2. What Phase 4 added

### 2.1 New module: `src/lib/agent/intent/` (pure, DB-free, SDK-free)

- `types.ts` — `IntentCategory` (12 categories), `IntentConfidence`, `CapabilityVerdict`, `IntentClassification` (the normalized intent object: category, confidence, reason, extracted signals, input assets, proposed workflow with real tool names, missing fields, one concise clarification question, capability verdict, fast-path eligibility, engine suggestion).
- `classifier.ts` — `classifyIntent(message, ctx)` deterministic rule engine (Bengali + English + mixed), `specDraftFromIntent` (draft spec in real `CreativeJobSpec` vocabulary), `buildIntentHintNote` (the ONLY form in which classification reaches the LLM), `unsupportedAlternativeText`, `verdictLabelBn`.

### 2.2 Category set (mapped to real repository vocabulary)

| Category | Proposed workflow | Notes |
|---|---|---|
| `music_video` / `short_film` / `motion_video` | `productionType` → `createProduction` | fast-path eligible when high-confidence + request-shaped + no material gaps |
| `image_generate` | tools `generate_image` (production `image` for composite work) | small work — no fast path |
| `image_edit` | `edit_image`, `remove_background`, `restyle_image`, `enhance_image` | requires an image upload; without one → `requires_clarification` asking for the file |
| `image_search` | `search_images` | find-existing vs create distinction |
| `music_generate` (instrumental) | `generate_instrumental` / production `audio` | honest `supported_with_limitations` (procedural, not neural) |
| `speech_or_voiceover` | `speech_synthesis` / production `audio` | |
| `audio_generate` (processing) | `process_audio`, `mix_audio` | |
| `video_edit` | `process_video` | requires a video upload |
| `general_chat` | none | questions/greetings — NEVER a production (rule 0-к runs before all production rules) |
| `unsupported_or_ambiguous` | none | singing / lip-sync / stem separation → honest `unsupported` + real alternatives; unrecognized → one concise clarification |

### 2.3 Question-vs-request guard (safety property)

`isQuestionShaped`: FORCE_QUESTION markers (`জানতে চাই`, `শেখাও`, `explain`, `কীভাবে কাজ`…) always win; other question markers win unless the message ends without `?` AND carries a creation imperative. A question about music videos is `general_chat` even though it contains "মিউজিক ভিডিও". Failure direction is safe: a false `general_chat` merely loses the latency win — the normal LLM loop still sees the full message and may still call `propose_job`; a false production routing is impossible for questions.

### 2.4 Orchestrator wiring (`runAgentLoop`, inserted after attachment pre-steps; skipped in chat_only)

1. **Record** — one `AgentStep { kind: 'intent_classification' }` + `noteIntentClassification` metrics (enums/counts only, no message text). One call per run — the same classification is reused by fast path, hint, and (on rate-limit) the fallback.
2. **Fast path** (`fastPathEligible`) — `specDraftFromIntent` → the **existing shared** `createProduction` (validateSpec + upload auto-wire + `awaiting_confirmation`) → honest labeled final message ("নিয়ম-ভিত্তিক দ্রুত-পরিকল্পনা — AI-সহায়ক সেটিংস-বাছাই ছাড়াই; নিচের কার্ডে সবকিছু বদলানো যাবে") with the production card attached. **Zero LLM calls** on this path. Failure of the draft validation falls through to the hint path with an honest note — never a broken proposal.
3. **Hint path** (default) — one user-side context note (`buildIntentHintNote`): category, extracted typed signals ("put in spec fields, not prompt text"), missing fields, clarification question (ask first), upload hints, general-chat guidance, unsupported warnings. The LLM proposal remains a proposal: `validateToolCall` + `validateSpec` unchanged.
4. **Rate-limit fallback upgraded** — `tryIntentFallback` now classifies with the full category set; voiceover-audio gets its own honest label; on `unsupported` capabilities the S9 path finalizes with an honest unsupported answer instead of a misleading 429 message.

### 2.5 Latency properties (Workstream G)

- Classification: deterministic in-process rules — REG-15f measures 1000 classifications in single-digit milliseconds (no LLM).
- Fast path removes the entire LLM round-trip for clear requests (evidence: `steps: 1`, zero `llm_decision` steps, `planningMs` measured; `intent.fastPath: true` in the run-metrics line).
- Hint path adds exactly zero extra LLM calls (one classification, one context note).
- No invented numbers: `planningMs` is null on the hint path; no cost estimates anywhere (no pricing data exists — none displayed).

## 3. Honest limitations

- Rule-based classification is pattern matching, not AI understanding — every fast-path message says so; anything unclear goes to the LLM.
- Bengali verb forms are covered for common shapes (tested); exotic phrasings fall to `general_chat`/ambiguous → LLM path, which is the intended degradation.
- The classifier never executes anything; execution always goes through the existing validated paths.
