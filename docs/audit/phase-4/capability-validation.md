# Phase 4 — Capability Validation (Workstream D)

## 1. Single authoritative path (no parallel capability lists)

The only capability source remains `src/lib/agent/capabilities.ts` (`validateSpec` + constants). Phase 4 adds **consumers** of it, never a second list:

- `config-panel.ts` imports the constants to build the panel schema (drift impossible: change `DURATION_LIMITS`/`SUPPORTED_FPS`/… once, panel + validation + pipelines all follow).
- `POST /api/productions/validate` runs the REAL `validateSpec` on the proposed spec.
- `POST /api/productions/[id]/confirm` re-runs the REAL `validateSpec` on merged overrides (pre-existing §15 behavior, unchanged).

## 2. `POST /api/productions/validate` contract

Request: `{ spec: CreativeJobSpec-shaped object }` (≤20 KB; owner-gated; 20/min per client key).
Response: `{ verdict, validation, providerStatus? }` where `validation` carries the full `SpecValidationResult` (`ok`, `errors`, `alternatives?`, and on success `adjustments`/`notes`/`plannedSteps`/normalized `spec`).

Verdict mapping (REG-14a–g lock each row):

| Condition | Verdict |
|---|---|
| missing `type` | `requires_clarification` |
| `validateSpec` fails | `unsupported` (errors listed) |
| video type + cloud provider busy or cooling down (>5 s) and engine ≠ `cinematic_motion` | `temporarily_unavailable` (still confirmable — honest wait, bounded by the provider gate's existing cooldown) |
| passes with adjustments and/or honest notes | `supported_with_limitations` |
| clean pass | `supported` |

`providerStatus` snapshot = booleans/counts only (`busy`, `inFlightSec?`, `cooldownRemainingMs`, `avgGenerationMs?`); **`lastError` text is stripped at this boundary** — no error text crosses to the client (REG-14e asserts with a canary).

## 3. Security properties (Workstream H)

- **Client capability claims can never override server validation** — only the `spec` fields `validateSpec` knows are read; junk like `isSupported: true`, `provider`, `cost`, `canDo4k` is ignored entirely (REG-14c: 4K still adjusts to 1080p).
- Live validation is advisory display only; `confirm` re-validates server-side regardless (pre-existing, REG-14h/i) and persists the **adjusted** spec — the client can never smuggle unsupported values into a run.
- Owner session + rate limits on both new endpoints; type whitelisted on the schema route; spec size clamped; songs listed as id/name only.
- The classifier's `capabilityStatus` is a *pre-verdict* for routing/messaging; the final word is always `validateSpec` (design doc §1, REG-12o).

## 4. Honest unsupported handling

- Bengali singing → never silently replaced: classification returns `unsupported` with the real alternatives (procedural instrumental ≠ singing, lyrics writing, upload your own song); the `generate_singing`/`lip_sync`/`separate_stems` tools remain hard-blocked.
- Lip-sync → `unsupported` before any confirmation; the panel states the limitation on every video plan.
- 4K/60fps → transparent adjustment to 1080p/30fps with reasons — visible in the panel BEFORE confirm (live validation) and applied at confirm (§15).
- Provider busy → honest `temporarily_unavailable` + wait note; bounded retries are the runner's existing policy (Phase-1 audit found no unbounded loops; unchanged).
- Missing credentials/provider keys are never exposed; availability is expressed only through the structured verdicts above.

## 5. What is NOT claimed

No cost estimates are produced anywhere (no provider pricing data exists in the repo — displaying invented costs would violate the honesty rules). Time estimates are labeled historical where shown. Real-provider distributions of `temporarily_unavailable` are NOT RUN (live budget) — the truthful instrumentation is in place.
