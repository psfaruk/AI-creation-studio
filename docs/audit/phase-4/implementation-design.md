# Phase 4 — Implementation Design (pre-implementation, Step 2)

Baseline: `8ce272c`. All contracts below extend existing mechanisms; no parallel architecture, no new dependencies, no DB migration, no provider calls.

## 1. New module: intent classification (Workstream B)

**File**: `src/lib/agent/intent/classifier.ts` (+ `src/lib/agent/intent/types.ts`).

```
IntentCategory:
  image_generate | image_edit | image_search | audio_generate | music_generate
  | music_video | motion_video | short_film | video_edit | speech_or_voiceover
  | general_chat | unsupported_or_ambiguous

IntentClassification {
  category: IntentCategory
  confidence: 'high' | 'medium' | 'low'          // heuristic, documented per rule
  reason: string                                  // human-readable routing rationale (bn)
  extracted: {                                    // request-shaped signals only
    durationSec?: number; aspect?: string; style?: string; mood?: string
    language?: 'bn'|'en'; fps?: number; resolution?: string
    wantsSungSong?: boolean; wantsLipSync?: boolean; mentionsSongUpload?: boolean
  }
  inputAssets: { hasImageUpload: boolean; hasAudioUpload: boolean; hasVideoUpload: boolean }  // from caller ctx
  proposedWorkflow: {
    productionType?: ProductionType               // for big work → createProduction
    directTools: string[]                         // registered tool names for small work
  }
  missingFields: string[]                         // materially-important gaps (bn labels)
  clarificationQuestion?: string                  // only when ambiguity materially changes routing
  capabilityStatus: 'supported' | 'supported_with_limitations' | 'unsupported'
                  | 'requires_clarification' | 'temporarily_unavailable'
  fastPathEligible: boolean                       // see §2
}

classifyIntent(message: string, ctx: { uploads?: {kind:'image'|'audio'|'video'}[]; cloudBlocked?: boolean }): IntentClassification
```

Rules (deterministic, Bengali + English + mixed; ordered by specificity):
1. **Blocked-capability requests** → `unsupported_or_ambiguous` (capabilityStatus `unsupported`): singing/sung vocals (`গাওয়া/ভোকাল/singing/vocal` as the *output*), lip-sync (`লিপ.?সিঙ্ক/lip.?sync`), stem separation (`স্টেম/stem`), 4K/60fps *demands* (→ honest limitation + nearest supported alternative text). Clarification question offered.
2. **music_video** (`মিউজিক ভিডিও|গানে?র? ভিডিও|music video|\bmv\b`) — highest-specificity video type. `wantsSungSong` sub-signal for honest note.
3. **short_film** (`শর্ট ফিল্ম|সিনেমা|চলচ্চিত্র|short film|movie`).
4. **motion_video** (`মোশন ভিডিও|motion video|ভিডিও বানাও|animate` — excluding edit verbs).
5. **video_edit** (`ভিডিও (কাট|ট্রিম|জোড়া)|trim|cut|merge video|process video` + video upload present).
6. **image_edit** (edit verbs + image upload present: `সম্পাদনা|এডিট|edit|পটভূমি সরাও|remove background|restyle`).
7. **image_search** (`ছবি (খোঁজো|খুঁজে দাও)|image search|ছবি দেখাও` — find-existing vs. create).
8. **image_generate** (`ছবি আঁকো|পোস্টার|illustration|logo|draw|image banao`).
9. **music_generate / instrumental** (`ইনস্ট্রুমেন্টাল|instrumental|সুর বানাও|beat|ব্যাকগ্রাউন্ড মিউজিক|lo-fi`).
10. **speech_or_voiceover** (`ভয়েসওভার|voiceover|পড়ে শোনাও|কণ্ঠে রূপান্তর|text to speech|বলে ফেলো` — spoken audio, not sung).
11. **audio_generate** (generic audio processing/creation not matching 9/10).
12. **general_chat** — questions (কিভাবে/কেন/কি/how/why/?-terminal without imperative), greetings, discussion of tools/products without creation verbs.
13. Anything else → `unsupported_or_ambiguous` (low confidence) with clarification.

Request-shape guard: creation imperatives (`বানাও|বানিয়ে দাও|করে দাও|চাই|তৈরি|create|make|generate`) vs. question markers — a question about music videos is `general_chat`, never a production.

**Fast path** (`fastPathEligible`) — all must hold: category ∈ {music_video, motion_video, short_film}; confidence `high`; request-shaped (imperative, not a question); no `wantsSungSong` demanding sung output; no `wantsLipSync`; no unresolved `missingFields` that materially change the workflow (e.g., mentionsSongUpload but no audio upload → NOT eligible; ask instead). Cloud-blocked → still eligible, engine `cinematic_motion` (existing honest fallback pattern).

## 2. Orchestrator wiring (B + G)

`orchestrator.ts` `runAgentLoop`, inserted after trigger-message load, before the loop (skipped in `chat_only`):

1. `classifyIntent(trigger.content, { uploads, cloudBlocked })` — one call per run (~0 cost, deterministic). Recorded: `AgentStep { kind:'intent_classification', name:'intent', payloadJson:{category, confidence, reason, fastPath, missingFields, capabilityStatus, durationMs} }` + `getRunMetrics(runId).intent = { category, confidence, fastPath, durationMs }` (new additive accumulator field; redaction-safe — message text never stored there).
2. **Fast path** (`fastPathEligible`): build the spec via a new exported `specFromIntent(classification, message)` (moved logic of `detectProductionIntent`'s spec building, unified), call the **existing shared** `createProduction`, emit honest `run_note` ("নিয়ম-ভিত্তিক দ্রুত-পরিকল্পনা — LLM রাউন্ড-ট্রিপ ছাড়াই"), `finalizeRun` with the honest template + `productionId`. Zero LLM calls → first-token latency eliminated for clear requests.
3. **Hint path** (default): push one `user`-side context note with the classification (category, extracted fields, missingFields, clarificationQuestion if any, and "production intents must go through propose_job") — improves first-shot spec quality and makes the LLM ask *one* concise question when classification says clarification is needed. LLM proposal remains a proposal; `validateToolCall`/`validateSpec` unchanged.
4. **Rate-limit fallback**: `tryIntentFallback` upgraded to use `classifyIntent` (full category set incl. honest unsupported messaging for singing/lip-sync) instead of the 6-pattern `detectProductionIntent` (kept exported for backward compat of existing behavior/tests; internally re-usable). No behavior regression for its current callers.

## 3. Configuration schema & live validation (Workstream C+D)

**File**: `src/lib/agent/config-panel.ts` (server-only, imports `capabilities.ts` constants — single source of truth).

```
ConfigPanelSchema {
  type: ProductionType
  titleBn: string
  fields: ConfigField[]        // ordered, category-specific (not every field for every type)
  limitations: string[]        // honest notes (no lip-sync, procedural instrumental, AI shot time…)
  sourceOptions?: { songs: {id,fileName,durationLabel}[] }   // conversation audio uploads (music_video)
}
ConfigField = {
  key: string                  // CreativeJobSpec field name
  labelBn: string; kind: 'select'|'number'|'text'|'toggle'|'textarea'|'song-select'
  required: boolean
  defaultValue?: unknown; value?: unknown
  options?: { value: string; labelBn: string; disabled?: boolean; disabledReasonBn?: string }[]
  min?: number; max?: number   // durationSec from DURATION_LIMITS
  hintBn?: string              // capability constraint display
  advanced?: boolean
}
buildConfigPanel(type, opts?: { spec?: CreativeJobSpec; conversationId?: string }): Promise<ConfigPanelSchema>
```

Derived 1:1 from server constants: duration options within `DURATION_LIMITS[type]`; fps `[24,25,30]` (60 listed **disabled with reason**); resolution `['720p','1080p']` (4K disabled with reason); aspects from `SUPPORTED_ASPECTS`; voices from the Edge/z-ai registry labels; moods `SUPPORTED_MOODS`; `maxShots` surfaced as a per-type hint; lip-sync/singing absent (limitation strings). Source-audio options come from DB audio uploads of the conversation (ids only, no URLs).

**API**:
- `GET /api/productions/config-panel?type=&conversationId=` — owner-gated, rate-limited; returns `ConfigPanelSchema` (fields pre-merged with the production's current spec when `productionId` given).
- `POST /api/productions/validate` — owner-gated, rate-limited; body `{ spec, conversationId? }`; runs the REAL `validateSpec` + provider availability snapshot → `{ verdict: 'supported'|'supported_with_limitations'|'unsupported'|'requires_clarification'|'temporarily_unavailable', validation: SpecValidationResult, providerStatus? }`. Client capability claims in the body are ignored (only `spec` fields validated server-side; confirm re-validates again — unchanged).

Verdict mapping: `!ok` → `unsupported` (or `requires_clarification` when type missing); `ok && (adjustments.length || notes.length)` → `supported_with_limitations`; `ok` clean → `supported`; video types with cloud provider cooling down/busy → `temporarily_unavailable` (from `videoProviderStatus()`), still confirmable (honest wait note).

## 4. Panel & plan preview UI (Workstream C+E)

`production-card.tsx` (extend; no new architecture):
- `SpecEditor` consumes `useConfigPanel(type, conversationId, spec)` (new hook `src/hooks/use-config-panel.ts`): field options/limits/disabled reasons from the server schema (drift removed); **field-level validation errors** (client-side range/enum checks from the schema + debounce 600ms `POST /api/productions/validate` → adjustments/notes/errors surfaced inline); required-field markers; capability constraint hints under fields; duplicate-submit guard kept (`isConfirming` + server 409).
- music_video: **source-audio selector** (none=procedural w/ honest note | uploaded songs from `sourceOptions.songs`) writing `songArtifactId`+`musicSource`.
- Awaiting card gains a **plan preview section** (collapsible): requested output (`whatWillBeMade`), selected workflow+engine, planned steps (`plannedStepsFor` via schema `plannedSteps`), estimated shots (`maxShots(type, quality, engine)` with honest engine note), audio strategy (musicSource/sound/voice), output settings (aspect/resolution/fps/format), known limitations (schema `limitations` + validation notes), historical ETA clearly labeled "ঐতিহাসিক অনুমান — প্রকৃত সময় ভিন্ন হতে পারে". No cost estimates (no pricing data → none shown, honest).
- Plan state chips already exist via status badges; awaiting banner text updated to the 8-state vocabulary (plan generated → awaiting confirmation → cancelled/rejected → submitted(queued) → running → validating → completed/partial/failed).

## 5. Progress, artifacts, duplicates (Workstream F — wiring unchanged)

Confirm → existing `[id]/confirm` (server revalidation, 409 on non-awaiting) → `startProduction` → real pipeline → steps/artifacts via existing registration; SSE replay/reconnect preserved; refresh → card re-fetch + re-subscribe (no second run: 409 guard + status machine). No changes to runner/pipelines beyond reading schema constants.

## 6. Metrics & redaction (Workstream G)

`run-metrics.ts`: additive `intent?: { category, confidence, fastPath, durationMs }` + `planningMs?` (fast-path createProduction duration). Included in the existing one-line `logRunMetrics` output (server log only). No message text, no secrets. Latency claims in docs: only measured numbers (intent classification is in-process regex — measured in tests as µs-scale; fast path saves the LLM round-trip entirely — evidenced by zero LLM AgentSteps on that path in tests).

## 7. Security review (Workstream H)

New endpoints: `requireOwner` + rate limits (config-panel 30/min, validate 20/min per client key) + input clamps (type whitelist, spec object size). No secrets in schema/verdict (provider status = busy/cooldown booleans only). Client-supplied capability/provider/cost fields never trusted (validate ignores them; confirm re-validates). Spec strings clamped by `validateSpec` as today. No shell, no arbitrary code paths added.

## 8. Test matrix (Workstream I) — hermetic, `bun:test`, t12–t15

- **t12 intent-routing**: BN MV request → music_video high + fastPath; EN MV; mixed ("একটা romantic music video বানাও, vertical Shorts format" → music_video + extracted aspect 9:16); image_generate; image_edit (with image upload ctx); instrumental; short_film; general question → general_chat (no production); ambiguous → clarification; singing request → unsupported + honest alternative; lip-sync → unsupported; question about MVs ("মিউজিক ভিডিও কীভাবে কাজ করে?") → general_chat not production; fast-path ineligible when song mentioned but absent; orchestrator fast path: LLM modules mocked-unused, `createProduction` called with validated spec, finalize attaches productionId, exactly 0 `llm_decision` steps.
- **t13 config-panel schema**: correct category fields per type; defaults pass `validateSpec`; disabled options present w/ reasons (60fps, 4K); duration options within limits; panel validate endpoint: unsupported resolution/fps/duration → structured errors; optional fields omittable; required errors; editing updates validated config; duplicate confirm → 409 (existing route, asserted); client claims (`isSupported:true`) cannot flip verdicts.
- **t14 capability-validation & confirmation flow**: supported → verdict supported; partial (4K→1080p) → supported_with_limitations + adjustment; singing spec → honest unsupported messaging (generate_singing stays blocked); lip-sync; provider busy → temporarily_unavailable verdict (mocked status) yet confirmable; plan display does not start production (awaiting card → no startProduction call); confirm invokes correct workflow (status→queued + startProduction called); cancel → no start; stale/cancelled confirm → 409; repeated confirm → 409; server revalidation on confirm override with bad fps → 422.
- **t15 metrics & regression guards**: intent step recorded with category+confidence; metrics accumulator redaction (no message text); fast-path metrics (planningMs present, no invented cost fields); existing run-metrics fields unchanged (backward-compat snapshot); worklog/append conventions untouched.

All tests mock `@/lib/db` (fake-db), security, and any SDK module; real route handlers / real classifier / real validateSpec; no network, no provider calls, no DB writes. UI component rendering: browser E2E **NOT RUN** (no DOM harness — consistent with t7 precedent); panel logic covered via the pure schema/validation modules + endpoint tests.

## 9. Rollback

Each piece is additive and isolated: classifier module (inert if unwired), orchestrator insertion (one guarded block + fallback swap), config-panel module + 2 routes (additive), card/hook changes (UI-only), metrics fields (additive). Revert per-file; no schema/data migrations.
