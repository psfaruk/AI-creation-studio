# Phase 0 — Bug Register (Work Package G)

Every finding has a unique ID, affected paths, severity, reproduction, expected vs actual, evidence + test status, root-cause classification (**Confirmed** = reproduced or recorded as runtime evidence; **Hypothesis** = source-reasoned; **Unknown** = undetermined), proposed fix, and regression plan. No fix was implemented during Phase 0.

---

## P0-BUG-01 — Bengali dialogue/voiceover TTS totally fails when Edge TTS 403s; z-ai fallback never engages

- **Feature:** Voiceover + short-film dialogue
- **Paths:** `src/lib/agent/audio/language_controller.ts` (`synthesizeVerifiedSpeech`, ~:363-455; `LANGUAGE_PROFILES` :62-77) · `src/lib/agent/tts-cache.ts` (`synthRaw` :128-134) · `src/lib/agent/production/pipelines/short_film.ts` (speech step :682-848) · `src/lib/agent/production/pipelines/audio.ts` (:174-247)
- **Severity:** **High** — primary Bengali speech path degrades to silent film + subtitles whenever Edge TTS is unavailable (an external, rate/clock-sensitive free service).
- **Reproduction:** Run a Bengali short film (or voiceover) while Edge TTS returns 403 (observed window: 2026-10-15 04:2x–04:5x in production `yrz3ymb7`).
- **Expected:** Voice chain falls back to z-ai voices (`jam`/`douji`) as documented in the bn profile notes ("শুধু Edge-নিউরাল অচল থাকলে জরুরি-ফলব্যাক").
- **Actual:** All 4 dialogue lines failed — `ProductionStep speech` detail "**0/4 সংলাপ-লাইন সফল**"; 4 × partialNote "Edge TTS ব্যর্থ — Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403 — শুধু সাবটাইটেলে থাকবে". Final film has **zero spoken dialogue**; status `partial`.
- **Evidence / test status:** **Confirmed** (DB rows + artifacts this window; source read).
- **Root cause (Confirmed, two defects):**
  1. `synthesizeVerifiedSpeech`'s voice-fallback loop calls `cachedSynthesizeSpeech` **without try/catch** — the first Edge 403 throws out of the loop, so the chain aborts before trying any other voice (language_controller.ts ~:409).
  2. Even with a catch, the loop cap `attempts >= Math.min(2, profile.voices.length)` stops after 2 voices — bn profile order is `[Nabanita(Edge), Pradeep(Edge), Tanishaa(Edge), jam(z-ai), douji(z-ai)]`, so **z-ai voices are unreachable by construction**.
  3. Additionally, short_film dialogue lines 2+ call plain `cachedSynthesizeSpeech(text, usedVoice, 1)` with **no fallback at all** — a single engine failure kills every line.
- **Proposed fix:** (a) wrap each per-voice call in try/catch and continue; (b) on Edge-403/edgeTtsHealth failure, skip remaining Edge voices and jump straight to z-ai fallback voices (extend the attempt cap accordingly, or make it engine-aware); (c) for short-film lines, route through a minimal fallback wrapper (or `synthesizeVerifiedSpeech` with `verify:false`) so engine failure degrades to the fallback voice rather than subtitle-only. Keep the honest partialNotes when quality is expected to differ.
- **Regression plan:** unit test with mocked Edge failure asserting z-ai engagement; live bn dialogue test after fix; assert at least one audible line in a 2-line film when Edge is down.
- **Dependencies:** none external (z-ai TTS already integrated).

## P0-BUG-02 — Film audio loudness −25.4 LUFS (≈9 LU under the −16 LUFS target) when dialogue is absent

- **Feature:** Short-film final mix
- **Paths:** `src/lib/agent/production/pipelines/short_film.ts` (sound_design/final_mix) · mix rules in `src/lib/agent/film-helpers.ts`
- **Severity:** Medium (quality, not correctness).
- **Reproduction:** Inspect `resultJson.technicalReport` of production `yrz3ymb7` (or measure the MP4).
- **Expected:** Mastered audio near −16 LUFS (the voiceover path's loudnorm target).
- **Actual:** `loudnessLufs: −25.4`, `peakDb: −14.74` — ambient/score bed only (consequence of P0-BUG-01 removing dialogue) mixed at bed level; final film mix applies no loudnorm.
- **Evidence / status:** **Confirmed** (DB technicalReport + ebur128 measurement).
- **Root cause:** Confirmed — film `final_mix` muxes the layered mix without a mastering stage; loudnorm exists only in the audio pipeline's `buildMaster`.
- **Proposed fix:** add loudnorm (I=−16) to the film/music-video final mux, or scale the bed when the dialogue layer is empty. Re-measure after P0-BUG-01 fix (dialogue presence may raise loudness naturally).
- **Regression plan:** assert film output 14–18 LUFS in the short-film E2E.

## P0-BUG-03 — Chat run progress is lost on browser refresh; parallel run becomes possible

- **Feature:** Chat progress persistence
- **Paths:** `src/hooks/use-agent-run.ts` (memory-only run state) · `src/hooks/use-conversations.ts` · `src/app/api/runs/[id]/events/route.ts` (already supports pure-DB replay)
- **Severity:** Medium.
- **Reproduction:** Send a chat message; reload the tab while the agent loop is running.
- **Expected:** Pending assistant bubble/progress restored (or at least the run marked active).
- **Actual:** No assistant row exists yet (created at run end); after refresh there is no pending bubble, `isRunActive=false`, composer enabled — the user can start a **second concurrent run** in the same conversation while the first still executes server-side.
- **Evidence / status:** **Confirmed** (source trace; contrast: production cards are refresh-safe via DB replay).
- **Root cause:** Confirmed — runId/pending state is component memory only; no persistence key.
- **Proposed fix:** persist `activeRunId` per conversation (localStorage/DB) and re-attach `EventSource` on mount while the run's status is `running`; disable composer accordingly. The server side already supports replay.
- **Regression plan:** E2E — send, reload, assert re-attach and composer disabled until `run_finished`.

## P0-BUG-04 — No reuse of successful AI shots when re-running a failed/partial video production

- **Feature:** Motion video / music video / short film re-runs
- **Paths:** `src/lib/agent/production/runner.ts` (`loadCtx` :174-190 accepts only `queued|running`; working-dir `cleanupWorkingDir` :511) · `src/app/api/productions/[id]/confirm/route.ts` (409 unless awaiting_confirmation)
- **Severity:** Medium (cost/UX — each retry regenerates every shot; CogVideoX-3 ≈ 2–7 min per shot under a single-task gate).
- **Reproduction:** Fail a 3-shot film on shot 3; revise/re-run; observe shots 1–2 regenerate from scratch.
- **Expected (ideal):** Successful shots reused; only failed ones regenerate.
- **Actual:** Working dir is deleted every run; `request_id` idempotency key embeds `productionId` (new id per revision) so provider-side dedupe never helps across runs; confirmed intentional deferral in prior worklog ("সচেতন-সীমা").
- **Evidence / status:** **Confirmed** (source); mitigation exists (failed shots dropped → `partial`), but retry cost remains.
- **Proposed fix:** persist per-shot clips (e.g. `storage/productions/<parentId>/aishot-N.mp4` retained on failure; revision spec carries a `reuseFrom` map keyed by shot index + prompt hash).
- **Regression plan:** fail shot 2 of 3 via fault-injection; re-run; assert shots 1,3 regenerate and shot 2 reuses cache hit.

## P0-BUG-05 — `capability_router.ts` is dead code

- **Feature:** Video capability routing (documentation-as-code)
- **Paths:** `src/lib/agent/video/capability_router.ts` — `routeVideoRequest`/`CAPABILITY_ROUTES` have **zero importers** in `src/`.
- **Severity:** Low.
- **Expected:** Routing table consulted by tool selection or prompts; **Actual:** never imported (grep-verified).
- **Evidence / status:** **Confirmed** (static).
- **Fix:** either wire it into prompt/tool-choice or fold its truth table into the registry docs; do not let it drift from reality. **Regression:** import-graph CI check or unit test asserting referential integrity of exported "router" modules.

## P0-BUG-06 — Polling fallback for chat runs has no failure affordance

- **Feature:** Chat SSE resilience
- **Paths:** `src/hooks/use-agent-run.ts` (:86-137) — after 5 reconnect failures, 2 s polling with a 180 s guard ends with a generic toast; no failure chip / retry button in that path (unlike the SSE path's `RunFailureChip`).
- **Severity:** Low. **Status:** Confirmed (source). **Fix:** surface the same failure chip on polling-exhaustion; offer reload of the conversation.

## P0-BUG-07 — Production SSE DB diff-poll does not re-emit `production_progress`

- **Paths:** `src/app/api/productions/[id]/events/route.ts` (:132-172 re-emits steps/terminal only).
- **Severity:** Low (client 2.5 s poll compensates via `applyView`).
- **Status:** Confirmed (source). **Fix:** include progress in the diff-poll payload; regression: kill live bus mid-run, assert % keeps advancing over SSE alone.

## P0-BUG-08 — Each awaiting-confirmation production holds an open SSE stream (up to 1 h)

- **Paths:** `use-productions.ts` subscribe guard includes `awaiting_confirmation`; events route `MAX_LIVE_MS` = 1 h.
- **Severity:** Low (resource concern; intentional for cross-tab `production_queued`).
- **Status:** Hypothesis (by-design trade-off; N cards = N streams). **Fix idea:** subscribe only when a confirm is clicked, or use a single shared "queue channel".

## P0-BUG-09 — Quick-create productions never appear in the current chat thread

- **Paths:** `src/components/studio/quick-create.tsx` (:171 — always creates a **new** conversation).
- **Severity:** Low (UX coherence: studio-created proposals are orphaned from the chat context the user is in).
- **Status:** Confirmed (source). **Fix:** accept optional `conversationId` prop from StudioHome's active conversation.

## P0-BUG-10 — Duplicated STATUS_META / ACTIVE_STATUSES constants (drift risk)

- **Paths:** `production-card.tsx:75-85` vs `productions-view.tsx:54-64` (and `activity-card.tsx` for tool statuses).
- **Severity:** Low. **Status:** Confirmed (source; both currently 9/9 complete). **Fix:** export one shared module.

## P0-BUG-11 — Artifact file route sets `Cache-Control: public` on a token-gated asset

- **Paths:** `src/app/api/artifacts/[id]/file/route.ts:37-41`.
- **Severity:** Low (token is in the query string of the cached URL; a shared cache could serve the URL to anyone holding it — practically limited, but the header overstates shareability).
- **Status:** Confirmed (source). **Fix:** `private, max-age=…` when `?st=` present.

## P0-BUG-12 — `genre` spec field is cosmetic in the music engine

- **Paths:** `music_engine.ts` (:49 comment "label-only"; verified unused in synthesis).
- **Severity:** Info. **Status:** Confirmed (source). **Fix:** wire to timbre/instrument selection or relabel in UI as descriptive only.

## P0-BUG-13 — Second concurrent AI-video production can burn its whole 8-minute submit budget waiting on the single-task gate

- **Paths:** `runner.ts` `MAX_CONCURRENT = 2` (:27) vs `ai_video.ts` single-inflight gate + per-submit 8-min budget (:54-67, :273-353).
- **Severity:** Medium-High under multi-production use; single-user typical flow unaffected.
- **Status:** **Hypothesis** (source-reasoned; not reproduced — would need two simultaneous AI-video runs).
- **Fix:** make the gate wait budget-aware across productions (e.g. queue AI-shot submissions globally rather than per-production waits), or reduce MAX_CONCURRENT for ai_diffusion type to 1.
- **Regression:** launch two AI-video productions; assert the second either queues cheaply or fails fast with an honest "provider busy" note.

## P0-BUG-14 — Scene compression when dialogue exceeds the 10 s AI-clip cap

- **Paths:** `short_film.ts` (:874-893 — "দৃশ্য সংকুচিত" notes; observed twice in the recorded run).
- **Severity:** Info (honest limitation, correctly disclosed in partialNotes).
- **Status:** Confirmed (DB evidence). No fix required for Phase 0; consider multi-clip scenes in Phase 1 design.

## P0-BUG-15 — Stale-run sweep (`interrupted`) does not emit SSE events

- **Paths:** `orchestrator.ts` `sweepStaleRuns` (:1532-1552) — DB-only status change; clients discover via the 1.5 s diff-poll, so a live viewer sees a delayed, less-informative transition.
- **Severity:** Info. **Status:** Confirmed (source). **Fix:** emit `run_finished` for swept runs (mirroring the production boot-sweep which does emit).

## P0-BUG-16 — `.env.example` does not list `STUDIO_OWNER_PASSCODE`

- **Paths:** `.env.example` (only `DATABASE_URL`).
- **Severity:** Low (onboarding). **Status:** Confirmed. **Fix:** add the name (never a value) + one-line description.

## P0-BUG-17 — Comment date typo "২০২৬-১৩-১০" (invalid month)

- **Paths:** `motion_video.ts:170`.
- **Severity:** Info. **Status:** Confirmed. **Fix:** correct to the intended date when next editing the file.

---

## Severity roll-up

| Severity | IDs |
|---|---|
| High | P0-BUG-01 |
| Medium | P0-BUG-02, P0-BUG-03, P0-BUG-04, P0-BUG-13(H) |
| Low | P0-BUG-05, 06, 07, 08, 09, 10, 11, 16 |
| Info | P0-BUG-12, 14, 15, 17 |

Confirmed vs Hypothesis: **Confirmed = 15** (01, 02, 03, 04, 05, 06, 07, 09, 10, 11, 12, 14, 15, 16, 17; 08 is design-confirmed but impact is Hypothesis) · **Hypothesis = 2** (08 impact, 13) · **Unknown = 0**.
