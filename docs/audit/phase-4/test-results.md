# Phase 4 — Test Results (Workstream I)

**Commands** (exact repository scripts): `bun run test` (`bun test tests`), `bun run typecheck` (`tsc --noEmit`), `bun run lint` (`eslint .`), `bunx prisma validate`.

## 1. Suite result

| Command | Result |
|---|---|
| `bun run test` | **Final review state: 119 pass / 0 fail** — 1177 expect() calls, 16 files, ~30.7 s, exit 0. Composition: 75 inherited Phase 0–3 tests **unchanged and green** + smoke + **44 Phase-4 tests** (REG-12: 17, REG-13: 9, REG-14: 12, REG-15: 6). |
| `bun run typecheck` | exit 0 |
| `bun run lint` | exit 0 |
| `bunx prisma validate` | exit 0 (schema unchanged — no migration this phase) |
| `next build` | **NOT RUN** (sandbox rule, unchanged since Phase 0) |

**Review-round correction (honesty note):** the Phase-4 implementation report claimed 118/118; the independent final review could **not reproduce** that state — the full suite deterministically failed REG-6j (`isRateLimitErrorText('Too Many Requests')` → false). Root cause: t12's `sdk-helpers` mock had replaced `isRateLimitErrorText` — a symbol `sdk-helpers` *re-exports* from `retry.ts` — and Bun's `mock.module` overwrites re-exported live bindings, so the later t6 file saw the mock's simplified regex instead of the real implementation (t1/t8's mocks deliberately omit that symbol). Fixed at root by removing the re-exported symbol from the t12 mock (its import graph never uses it); t12+t6 order-dependence verified gone, suite green.

No existing assertion was weakened or deleted; `tests/helpers/fake-db.ts` gained an additive `production` model + `artifact.findFirst` (needed by the new route-level tests; existing models untouched).

## 2. New suites (boundaries honestly stated)

### REG-12 — `t12-intent-routing.test.ts` (17/17 PASS)
Classifier (REAL, pure) + the composition seam. Engine-boundary mocks only for the createProduction integration (`tts-cache`/`sdk-helpers` stubs — t1/t8 pattern; `language_controller` + `capabilities` + `createProduction` real). Covers: BN/EN/mixed music-video fast-path with extracted signals; image generate/edit (no-upload → clarification); instrumental (honest limitation); short film; **questions never become productions**; ambiguous → one clarification; singing/lip-sync honestly unsupported; song-expected-but-missing blocks fast-path; cloud-blocked engine fallback; drafts pass REAL validateSpec; hint-note redaction (canary); shared-path creation lands `awaiting_confirmation`.

### REG-13 — `t13-config-panel.test.ts` (9/9 PASS)
`buildConfigPanel`/`validateFieldsAgainstSchema` (REAL) + REAL `GET /api/productions/config-panel` handler with fake db + ok-auth. Covers category-specific fields, duration options within limits for all types, disabled-with-reason options, defaults passing REAL validateSpec (all 5 types), field-validation matrix, route 200/400, songs as id/name only (no paths), rate-limit 429.

### REG-14 — `t14-capability-confirm.test.ts` (12/12 PASS)
REAL `validate`/`confirm`/`cancel` route handlers with fake db; `runner` mocked at its boundary (`startProduction` recorded noop — t3 pattern), `ai_video` mocked to a `videoProviderStatus` stub (keeps the SDK out of the graph; `validateSpec` + `capabilities` real). Covers every verdict row, client-claims-ignored, provider-busy (+`lastError` never crossing the boundary, canary-tested), local-engine unaffected, malformed/oversized bodies, confirm→queued+exactly-one-start, honest §15 adjustment of unsupported overrides, duplicate confirm 409, unknown 404, cancel-no-start + post-cancel 409, and (review-added 14l) **song-deselect via explicit `null` override clears the stored song — preview and actual run agree**.

### REG-15 — `t15-intent-metrics.test.ts` (6/6 PASS)
`run-metrics` Phase-4 additions (REAL, pure). Covers accumulator shape + additive contract, planningMs only-on-fast-path, metrics-line redaction (canary), backward-compat old call shape + honest null, clear semantics, deterministic-cheap classification (1000 calls, ms-scale).

## 3. Browser verification (render-level, budget-free) — agent-browser

After the suite went green, a live browser pass (page load → unlock → productions view → quick-create a music-video proposal → inspect the awaiting card → cancel it) verified the real UI. It **caught one crash the hermetic suite could not**: the new song selector used `<SelectItem value="">` — Radix Select forbids empty-string values, crashing the awaiting card (the earlier short_film/image cards in dev.log never rendered that selector). Fixed with a `__no_song__` sentinel value; re-verified: awaiting card renders all Phase-4 elements — amber banner with the **ঐতিহাসিক অনুমান** ETA label, plan preview (steps, ২–৪ CogVideoX-3 shots, honest audio strategy, output settings, limitations, historical disclaimer), song selector, live validation (`GET config-panel` + `POST validate` → 200 in the network log), confirm/cancel (cancel landed cleanly). Zero console errors after the fix. The test production was cancelled (no generation ever started, no provider budget spent).

**Final-review browser re-verification (post review-fixes):** the same budget-free path was re-run after the review fixes (song-deselect `null` contract + confirm/revise null-strip): Bengali request → fast path → awaiting music-video card rendered all Phase-4 elements (historical-ETA banner, plan preview, live validation verdict badge “সীমাসহ সমর্থিত”, song selector); network log showed `POST /api/chat` 200, `GET config-panel?type=music_video&conversationId=…` 200, production view + SSE 200, `POST /api/productions/validate` 200; the song selector opened/closed cleanly with the fixed code; cancel landed cleanly; **zero console/page errors**. Test production cancelled — zero budget spent.

## 4. NOT RUN / BLOCKED (honest list)

| Item | Status | Reason |
|---|---|---|
| Full browser E2E incl. chat message → panel → confirm → live production | **NOT RUN** | Confirm would start real generation (unauthorized budget). The budget-free render-level pass above DID verify the card end-to-end minus execution; execution itself is route-level tested (REG-14h). |
| Live end-to-end run through the real LLM + real pipelines | **NOT RUN** | Unauthorized provider budget; hermetic suite substitutes route-level + composition-level tests. |
| Real provider `temporarily_unavailable` distributions | **NOT RUN** | Requires live generation; the truthful verdict + snapshot instrumentation is in place and stub-tested. |
| Live Edge-403 window / real shot-cache hit on a real provider | **BLOCKED** | Carried from Phase 2/3 (budget). |
| `next build` | **NOT RUN** | Sandbox rule. |
