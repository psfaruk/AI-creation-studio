# Recovery Audit A1 — Repository Auditor, Phases 1–3 (integration lead, first half)

- **Task ID**: R-A1 · **Date**: 2026-10-16 · **Agent**: recovery audit A1
- **Scope**: Deep audit of Phase 1, Phase 2, Phase 3 per master prompt §3 (12 mandatory questions per phase), §7 Layer A/B, §8; read-only. One small test file executed for direct evidence (t11, permitted).
- **Method**: commit→code trace (`git show --stat`), full reads of every driving source file, API-route→runner→provider-adapter→artifact tracing, tests/README + test-file spot reads, worklog-tail cross-check. No source/test/doc modified. No provider calls, no browser, no git mutations, dev server untouched.
- **Phase→commit map audited** (all verified to exist and match claimed content):
  - Phase 1: `8c472fb` (regression suite 36/37-with-recorded-fail, run-metrics observability, tool inventory, 8 docs), `c0384d2` (real chat errors, GLM-only catalog, app-key system removal), `568c0a4` (proxy-aware auth, provider Base URL override, minimal /api/v1 restore)
  - Phase 2: `2b0ef3e` (P0-BUG-01 TTS fallback fix, chat 409 idempotency, client run re-attach), `acf147b` (event-bus replay-from-emit, tool lifecycle + live elapsed, SSE reconnect/dedupe, music intent split + WAV/MP3, loop guards, firstToken latency; worklog record `f5fe336`)
  - Phase 3: `8ce272c` (workstreams A–D: motion-voiceover fallback, −16 LUFS final-mix loudness, shot cache, stage metrics)

---

## Findings (ID / severity / evidence / why / minimal fix)

> Severity per master §12. No P0/P1 found in Phases 1–3 code. 1×P2, 6×P3.

### A1-F01 — P2 — Zombie-run 409 lockout window after server death (recovery depends on conversations-GET only)
- **file:line**: `src/app/api/chat/route.ts:159-172` (409 guard on any `running` run) · `src/lib/agent/orchestrator.ts:38,1730-1748` (`STALE_RUN_MS=10min`; `sweepStaleRuns` exported) · `src/app/api/conversations/route.ts:14` + `src/app/api/conversations/[id]/route.ts:18` (**only** call sites of the sweep) · `src/hooks/use-agent-run.ts:455-479` (409 → auto-attach to the active run)
- **Evidence**: if the Node process dies mid-run (crash/OOM/kill), the DB row stays `status:'running'`. Every new chat POST for that conversation then 409s and the client *attaches to the dead run*; `/api/runs/[id]/events` DB-poll (`syncFromDb`, runs events route `:143-191`) only sends `run_finished` once status leaves `running`. The only thing that flips the status is `sweepStaleRuns()` — invoked solely by GET conversations routes. In a single open chat tab with no navigation, the sweep is not guaranteed to fire (no periodic timer, unlike productions' 60s `__staleSweepTimer`, runner.ts:711-721), so the user can be locked out with a pending bubble for up to ~10 minutes.
- **Why it matters**: Phase-2's own goal was refresh/reconnect resilience; the crash-recovery corner contradicts it in the worst window (server restart mid-run). Dev-server OOM death is a *documented recurring event* in this sandbox (worklog P5-6: "dev server একবার OOM-এ মৃত").
- **Mitigations already present** (why only P2, not P1): boot-sweep for *productions* is honest (runner.ts:680-703) but has **no chat-run equivalent**; any conversation list re-render (sidebar/mount) triggers the sweep and resolves within 1.5s; worklog P5-6 shows dev-server restarts are recovered in practice.
- **Minimal fix**: (a) call `sweepStaleRuns()` in the chat route 409 path before deciding (one line), and/or (b) add a periodic `setInterval(sweepStaleRuns, 60s)` mirroring the production stale-sweep, and/or (c) in runs-SSE `syncFromDb`, treat `running` rows older than `STALE_RUN_MS` as interrupted.

### A1-F02 — P3 — Runs-SSE stream has no maximum lifetime (productions route does)
- **file:line**: `src/app/api/runs/[id]/events/route.ts:13-14,201-209` (poll/ping timers, no cap) vs `src/app/api/productions/[id]/events/route.ts:15,169` (`MAX_LIVE_MS = 60min` enforced)
- **Evidence**: run-event SSE streams ping every 15s and DB-poll every 1.5s indefinitely while the run row says `running`; combined with A1-F01 a zombie run holds a stream + poll open forever. The productions SSE route caps itself at 1h.
- **Why**: resource hygiene + symmetry; compounds A1-F01.
- **Fix**: mirror `MAX_LIVE_MS` (e.g. 30–60min) in the runs events route and close cleanly.

### A1-F03 — P3 — Shot-cache fingerprint prompt is trimmed; submitted prompt is not (byte-exactness deviation from stated principle)
- **file:line**: `src/lib/agent/video/ai_video.ts:562` (`prompt: req.prompt.slice(0, 2000).trim()` — fingerprint input) vs `ai_video.ts:346` (`prompt: req.prompt.slice(0, 2000)` — actual provider body, no trim)
- **Evidence**: shot_cache.ts header declares "ক্যাশ-কী = প্রোভাইডার-অনুরোধের সম্পূর্ণ ফিঙ্গারপ্রিন্ট" and `generateVideoClip` comments "ফিঙ্গারপ্রিন্ট = ঠিক যা প্রোভাইডারে যায় (স্লাইস-পরের প্রম্পট…)" — but the fingerprint `.trim()`s while the submit body does not. Two requests differing only in leading/trailing whitespace inside the slice window share one cache key yet are distinct provider bodies.
- **Why it matters**: harmless today (all prompts come from deterministic builders with stable whitespace, and the effect only makes the cache *slightly* more aggressive), but it is a documented-principle deviation; REG-10b's "every fingerprint field matters" lock doesn't cover whitespace-only deltas.
- **Fix**: drop `.trim()` from the fingerprint input (one-word change) or add `.trim()` to the submit body; bump `SHOT_CACHE_SCHEMA_VERSION` if the key semantics change.

### A1-F04 — P3 — TTS disk cache has no size budget or eviction (unbounded growth)
- **file:line**: `src/lib/agent/tts-cache.ts:27` (`storage/tts-cache`, plain sharded writes) — contrast `src/lib/agent/video/shot_cache.ts:33,329-347` (512 MiB budget + oldest-first eviction + counters)
- **Evidence**: every `(voice, speed, text)` triple is cached forever; a long-lived studio accumulates speech segments (typically 24kHz/48kbps MP3 or WAV) without bound. Phase-3 gave the *video* cache a budget; the TTS cache (older, §11) never got one.
- **Why**: disk exhaustion on a 4.1GB-RAM box eventually degrades everything (ffmpeg tmp writes fail first).
- **Fix**: port the shot-cache budget/evict pattern or add a simple `storedAt`-ordered sweep; expose a counter like `ttsCacheStats()`.

### A1-F05 — P3 — Hardcoded retry-total in user-facing 429 note duplicates llm.ts attempt count
- **file:line**: `src/lib/agent/orchestrator.ts:435` (`পুনঃচেষ্টা ${bnNum(info.attempt)}/${bnNum(6)}`) vs `src/lib/agent/llm.ts:340` (`withRetry(..., 6, ...)`)
- **Evidence**: the SSE note "চেষ্টা n/৬" is correct only because both places say 6. `RetryWaitInfo` (retry.ts:103-113) carries `attempt` but not `totalAttempts`.
- **Fix**: add `totalAttempts` to the wait-info payloads and render from it (tiny, removes the coupling).

### A1-F06 — P3 — UUID-named commits on origin/main carry Phase-4 implementation/review content (history hygiene)
- **file:line**: `git log origin/main`: `92eb66d` "33de41a1-…", `310c712` "fb810f07-…" (Phase-4 review fixes + implementation); also `d982a4d` message says "phase-4 push approval (task P4-3)" but is the worklog-record commit
- **Evidence**: phase→commit traceability for Phase 4 relies on worklog text rather than commit messages; the Phase-5 analog defect (a60bcaf wrong message) was *resolved* by the P5-7 soft-reset + proper `c7927f7` — the Phase-4 UUID commits cannot be fixed without history rewrite (which the master prompt forbids).
- **Why**: audit/traceability friction only; content itself verified fine by the Phase-4 review round.
- **Fix (mitigation only)**: keep mapping in `docs/audit/recovery-phase-1-5/phase-status-matrix.md` (this file records it); do NOT rewrite pushed history.

### A1-F07 — P3 — Phase-1 suite shipped 36/37 with REG-1a intentionally failing (honest, fixed one phase later)
- **file:line**: commit `8c472fb` message ("suite state at this commit: 36/37 pass — REG-1a intentionally failing (P0-BUG-01 machine-verified evidence); exit: PASS WITH BLOCKER"); fix landed in `2b0ef3e` (language_controller.ts rewrite)
- **Evidence**: verified in history and in current code — the current suite state is 157/157 per worklog P5-6/P5-7 gates; t11 re-run by this audit passed 4/4 (53 expects, 2.28s).
- **Why**: not a defect — recorded to show the P0-BUG-01 evidence chain is genuine (failing test first, fix second), not retrofitted.
- **Fix**: none needed.

### Non-findings explicitly checked and cleared
- **Disconnected/dead code in Phase 1–3 scope**: none found — every audited feature traces end-to-end (see trace table below). `scripts/phase1-inventory.ts` is a read-only evidence script (intentional, not dead).
- **Mock-only implementations**: none — provider adapters call the real SDK (`zai.chat.completions.create` llm.ts:327; `zai.video.generations.create` ai_video.ts:355; OpenAI SDK external-llm.ts:172; Edge WSS edge_tts.ts:264). Mocks exist only at test boundaries.
- **Tautologies in t1–t11**: grep for `=> true)` / `expect(true).toBe(true)` patterns across `tests/regression/` → **0 matches** (the one tautology, t18:105, was Phase-5 scope and already replaced in the P5-5c round).
- **Secrets**: `provider-keys.ts` stores keys in gitignored `storage/provider-keys.json` (header lines 5-10), returns only `maskKey()` previews (`:193,221,233`); run/production metrics lines log enums/counts/durations only with unmeasured→null (run-metrics.ts:6-16, REG-11b canary-locked, re-verified green by this audit's t11 run).

---

## Phase 1 status: **PASS WITH DOCUMENTED LIMITATIONS**

Foundation, tests & metrics (commits `8c472fb` → `c0384d2` → `568c0a4`).

1. **Requirement**: test framework + regression suite; provider error handling/retry/timeout; run metrics & latency; capability registry; truthful unsupported responses; key/error redaction; TS/lint/Prisma gates (master §3 Phase-1 list).
2. **Implementing commits**: `8c472fb` (suite+observability+inventory), `c0384d2` (chat error truthfulness, GLM-only catalog, app-key product removal), `568c0a4` (proxy-aware auth, Base URL override, `/api/v1` restore).
3. **Driving source files**: `src/lib/agent/retry.ts` (bounded retry), `rate-limit-coordinator.ts`, `run-metrics.ts`, `orchestrator.ts` (loop guards, firstToken, metrics wiring :1602-1619/:1708-1725), `production/runner.ts` (metrics :538-577/:602-642), `capabilities.ts` (registry), `availability-matrix.ts`, `video/lip_sync_module.ts` (honest unavailable), `external-llm.ts`, `security.ts`, `provider-keys.ts`, `chat-models.ts`, `sdk-helpers.ts`, `tests/**`, `scripts/phase1-inventory.ts`.
4. **UI reachable?** Yes — chat send/errors (ChatView), model selector, provider-key dialog with Base URL, studio tools view; `/api/v1` is a user-requested API surface (curl-verified in 568c0a4 E2E; not UI).
5. **Server→pipeline reachable?** Yes — `/api/chat` → `startAgentRun` → orchestrator loop → tools registry → pipelines; observability lines emitted at both run end states.
6. **Provider adapter realness?** Real: z-ai SDK chat (streaming), OpenAI SDK for keyed GLM providers with per-provider Base URL override (external-llm.ts:57-73), image/video/TTS/ASR via sdk-helpers with `withRetry` + explicit timeouts (e.g. ASR 15s/120s, image-search 150s); 429 → `TemporarilyUnavailableError`, 401/403/402/404 fatal-no-retry (external-llm.ts:184-221).
7. **Success validation/registration?** Runs: DB terminal state + `[run-metrics]` line; capability verdicts via `validateSpec` (adjustments+alternatives+notes); unsupported tasks return truthful statuses (`singing_lipsync` = `unavailable_here` with 4-dimension reasons, availability-matrix.ts:307-317; lip-sync module reports `unavailable`, lip_sync_module.ts:26-48).
8. **Automated tests?** REG-1…REG-7 + smoke (37 tests at Phase-1 time; REG-6 locks bounded retry exactly, REG-15c locks redaction canary); smoke asserts 41-tool registry↔catalog parity.
9. **Integration tests actually run?** At phase time: full suite (36/37, recorded failure); E2E verified for chat/GLM-only/key-dialog per commit messages. This audit re-ran t11 (Phase-3 file) only — green.
10. **Live media evidence?** Not for Phase-1 scope itself (none required beyond latency baselines); historical real-GLM firstToken/duration samples documented in `docs/audit/phase-1/latency-baseline.md` with n=3 and honest no-P95 disclaimers.
11. **Incomplete/unsupported?** Documented NOT-RUNs: `next build` (sandbox), live-provider latency for image/voiceover/MV, browser-EventSource DOM tests (README:62-75). REG-1a failing at this commit was the recorded P0-BUG-01 evidence (A1-F07).
12. **Blocking defects?** None open. A1-F01/F02 (zombie-run window) are Phase-2 lifecycle hardening, listed under Phase 2.

**Verdict rationale**: every checklist item is implemented, wired, and test-locked with honest NOT-RUN documentation; limitations are process-environment constraints, not code gaps.

---

## Phase 2 status: **PASS WITH DOCUMENTED LIMITATIONS**

TTS fallback + active-run persistence (commits `2b0ef3e`, `acf147b`, worklog `f5fe336`).

1. **Requirement**: per-voice/per-line TTS fallback; Edge-403 behavior; refresh reattach; duplicate-run prevention; server replay + client state; cancellation + terminal-state persistence (master §3 Phase-2 list).
2. **Implementing commits**: `2b0ef3e` (fallback chain fix + 409 guard + reattach), `acf147b` (replay-from-emit, SSE reconnect/dedupe, loop guards, firstToken, music intent split WAV+MP3, resolution persistence, tool lifecycle).
3. **Driving source files**: `audio/language_controller.ts` (chain :384-473), `audio/edge_tts.ts`, `tts-cache.ts`, `hooks/active-run-persistence.ts`, `hooks/use-agent-run.ts`, `hooks/use-productions.ts`, `events.ts` + `production/bus.ts`, `app/api/chat/route.ts`, `app/api/runs/[id]/events/route.ts`, `app/api/productions/[id]/events/route.ts`, `orchestrator.ts` (guards :36-41,1128-1341), `production/runner.ts` (cancel/partial/terminal), `tools/audio.ts`.
4. **UI reachable?** Yes — chat composer (send/409-reattach/pending bubble), activity cards (queued/waiting/retrying/cancelled/live elapsed), studio quick-create (instrumental/sung-song/image intents), cancel buttons on production cards.
5. **Server→pipeline reachable?** Yes — POST /api/chat guard before user-message creation (chat/route.ts:154-172); confirm → `startProduction` (queue MAX_CONCURRENT=2, exactly-once guard runner.ts:153-173); SSE routes replay-from-DB → live bus → diff-poll.
6. **Provider adapter realness?** Real Edge-TTS WSS protocol (Sec-MS-GEC DRM token, clock-skew learning) + z-ai SDK fallback; per-voice `try/catch`, engine-death set (`deadEngines`), full-profile walk (bn 5 / en 7 voices), honest exhaustion rejection (language_controller.ts:393-471).
7. **Success validation/registration?** Speech verification verdict pass/warn/fail with duration/ASR/clipping checks; per-line failures become honest `failures[]`/partialNotes, never silent drops; run/production terminal states persisted in DB + `production_finished` emitted; partial output = status `partial` + `partialNotes` in resultJson (runner.ts:450-476).
8. **Automated tests?** REG-1a/1b/1f/1g (fixed fallback contract), REG-2 (DB replay), REG-3a-e (409 guard), REG-4 (replay/dedupe), REG-5 (instrumental), REG-6, REG-7 (persistence helpers), REG-8 (motion voiceover — landed with Phase-3 file). All green per worklog gates (47/47 at 2b0ef3e; 157/157 now).
9. **Integration tests actually run?** Suite runs at each commit (documented); browser E2E for refresh-mid-run/cancel/mobile performed at acf147b time (commit message; cannot re-verify under current no-browser rule). t2/t3/t4 exercise real route handlers with fake DB + stubbed startAgentRun (documented boundary).
10. **Live media evidence?** Edge-TTS live probing evidence from 2026-10-13 documented in edge_tts.ts header (protocol discovery); no live Bengali-pronunciation acceptance in Phase-2 scope (falls to Agent B's audit).
11. **Incomplete/unsupported?** Documented: browser-DOM re-attach harness never added (tests/README.md:72-75 — typechecked + source-verified only); REG-2d asserts post-fix *precondition*, the DOM half rests on REG-7 units + E2E notes. New finding A1-F01: crash-recovery 409 window (P2).
12. **Blocking defects?** None blocking acceptance; A1-F01 (P2) should be fixed in a hardening round — it does not break the normal path but contradicts the resilience goal in the crash corner.

**Checklist specifics verified in code**:
- **Edge 403 bounded**: 3 attempts/segment with 800ms/2.5s waits + 30s WS timeout (edge_tts.ts:205,266,359-378), then engine marked dead and remaining Edge voices skipped without wasted calls (language_controller.ts:401,420-428) — no infinite retry anywhere.
- **Reattach after refresh**: `saveActiveRun`/`readActiveRun`/`shouldReattach` (12-min stale cutoff aligned to the 10-min server sweep) + mount-effect reattach + 409-attach with draft restoration (use-agent-run.ts:401-411,455-486).
- **Duplicate prevention**: chat 409 per-conversation pre-creation; production confirm 409 (REG-14j) + in-memory exactly-once.
- **Server replay**: replay buffer created on first emit (events.ts:46-54; bus.ts:44-52 — the acf147b fix), 100/200-event caps, 60s/120s grace, DB-replay on SSE connect + client-side activityId/message dedupe (use-agent-run.ts:210-211,250-258).
- **Cancellation/terminal**: `checkCancelled`/`isCancelled` per-step + 2s-tick provider waits + ffmpeg child kill + 5s cancel-watch (runner.ts:205-226,430-486); terminal status written transactionally with resultJson (:498-513); stale sweeps (20/60min) + boot sweep for interrupted productions (:651-703).

---

## Phase 3 status: **PASS WITH DOCUMENTED LIMITATIONS**

Media quality, cost & latency (commit `8ce272c`, workstreams A–D).

1. **Requirement**: SHA-256 request-fingerprint correctness; stale-shot reuse prevention; successful-shot reuse; failed-shot isolation; final-mix loudness normalization; A/V duration & sync integrity; artifact registration + partial-output status (master §3 Phase-3 list).
2. **Implementing commit**: `8ce272c` (25 files, +3276/−27).
3. **Driving source files**: `video/shot_cache.ts` (new, 418 lines), `video/ai_video.ts` (cache wiring + stage metrics), `media/ffmpeg.ts` (`measureLoudness`, `normalizeLoudnessTwoPass`, tracked ffmpeg), `audio/sound_design.ts` (post-merge two-pass norm), `production/pipelines/voiceover.ts` (new), `motion_video.ts`, `run-metrics.ts` (production accumulator), `runner.ts` (metrics wiring), tests t8–t11.
4. **UI reachable?** Yes — motion-video voiceover flows through quick-create/chat; final artifacts + partial badges + artifact list on production cards (production-card.tsx:102,1491,1711-1736); cache savings visible via honest labels (`ক্যাশ-হিট` status notes, ai_video.ts:575) and metrics lines.
5. **Server→pipeline reachable?** Yes — all three video pipelines call `generateVideoClip` (single gate function) which wraps cache lookup → in-flight join → real generation → validation → store.
6. **Provider adapter realness?** Real — submit body `{prompt≤2000, duration 5|10, quality, watermark_enabled:false, image_url?, with_audio?, size?, request_id}` to `zai.video.generations.create` (ai_video.ts:345-355); download + ffprobe validation; probe-verified limits (single in-flight task, cooldowns, 429 ladder) encoded in `AI_VIDEO_LIMITS` (:74-88).
7. **Success validation/registration?** Only completed+validated clips cached (store after `validateVideoBuffer` ok, :646-658); re-validation on every hit (:571-573); strict sidecar shape check + size match + hex-only paths (shot_cache.ts:160-250); registration via `ctx.registerArtifact` with rich metaJson (music_video.ts:828-862 incl. `avSyncOk`, `lipSync:false`, honest engine labels).
8. **Automated tests?** REG-8 (7/7), REG-9 (7/7), REG-10 (10/10), REG-11 (4/4) — mock boundaries documented per file (t10 header: llm/fetch mocked, cache-root overridden, real ffmpeg validation).
9. **Integration tests actually run?** Full suite 75/75 at commit time; **this audit re-ran t11 → 4/4 pass, 53 expects, 2.28s** (direct evidence, REG-11a–d incl. redaction canary).
10. **Live media evidence?** NOT RUN (documented): real provider cache hit, live stage-latency distributions, real before/after loudness artifact (lost in sandbox snapshot-restore — exit report §3/§4). Local-integration evidence is strong (real ffmpeg two-pass loudnorm measurements −24.3→−15.9 LUFS / −10.5 dBTP, n=3).
11. **Incomplete/unsupported?** Documented NOT-RUNs above; A1-F03 (fingerprint trim mismatch, P3) and A1-F04 (tts-cache unbounded, P3) are new minor findings; width/height/fps deliberately excluded from the key (documented + correct: deterministic local re-normalization on hit).
12. **Blocking defects?** None.

**Checklist specifics verified in code**:
- **Fingerprint correctness**: sha256 over fixed-order canonical JSON `{v, model, prompt, durationSec, quality, imageUrlSha256, withAudio, size}` (shot_cache.ts:141-153); imageUrl hashed (never raw); schema version guards stale entries; REG-10b locks every-field sensitivity (a≠b movement, a≠c size, a=d identical — independently re-verified by P5-4d with the real functions).
- **Stale reuse prevention**: any prompt/duration/quality/image/audio/size change ⇒ different sha ⇒ clean miss; corrupt/mismatched entries evicted + counted `invalid` (never returned).
- **Successful-shot reuse**: disk hit returns validated bytes with honest `fromCache:true` + `ক্যাশ-হিট` note; in-flight dedupe joins concurrent identical shots; prewarm cache resolves without second submit (REG-10i).
- **Failed-shot isolation**: per-shot try/catch → `valid[]` + honest per-shot partialNote, throw only if *all* shots failed (music_video.ts:647,664-667); failed production with ≥1 artifact becomes `partial` with `partialNotes` (runner.ts:470-475).
- **Loudness**: two-pass EBU R128 loudnorm to −16 LUFS / −1.5 dBTP *after* all layers merge (sound_design.ts:648-688), honest issue reporting on deviation/silence/corrupt/unsupported layouts; audio pipeline master step uses loudnorm −16/−1.5 (audio.ts:60-64).
- **A/V sync**: final_qc checks video-duration vs song-used-portion (>1.5s → trim, still off → honest note), stream-duration delta <0.5s (music_video.ts:741-807); duration/layout/fps preserved through real mux (REG-9b).
- **Partial status**: `statusOverride:'partial'` + `partialNotes` surface in resultJson → UI badge "আংশিক সফল" + notes list (production-card.tsx:102,1711-1719).

---

## Integration trace summary (UI → route → runner → adapter → artifact)

| Feature | UI | API route | Runner/Orchestrator | Provider adapter | Final artifact |
|---|---|---|---|---|---|
| Chat run + metrics + 409 | ChatView/use-agent-run | `/api/chat` (chat/route.ts) | `startAgentRun` loop (orchestrator.ts) | z-ai SDK / OpenAI SDK w/ baseURL (llm.ts:308-348) | assistant message + `[run-metrics]` |
| TTS speech | chat audio tool + pipelines | (server-side only) | language_controller chain | Edge WSS / z-ai TTS | WAV/MP3 artifact + verification verdict |
| Run reattach | pending bubble (use-agent-run.ts:372-411) | `/api/runs/[id]/events` | events bus + DB replay | — | run_finished → clearActiveRun |
| Production lifecycle | production-card | `/api/productions/*` (confirm/cancel/events) | runner.ts queue/steps | — | artifacts + resultJson + `[production-metrics]` |
| MV/SF/motion video | quick-create + config panel | confirm route → `startProduction` | pipelines/{music_video,short_film,motion_video} | ai_video.ts → z-ai CogVideoX-3 | MP4 + srt + storyboard + metaJson |
| Shot cache | (transparent; honest status notes) | — | generateVideoClip gate | submit/poll/download/validate | cached clip reuse + counters |
| Provider keys/Base URL | provider-key-dialog | `/api/provider-keys` | — | external-llm getClient | masked previews only |

No disconnected or dead code found in Phase 1–3 scope. The only intentionally non-production modules are evidence scripts (`scripts/phase1-inventory.ts`) and honest-gate stubs that *report* unavailability rather than fake it (`lip_sync_module.ts` — the anti-mock).

## Test realness (t1–t11)

- **Mock boundaries documented**: yes — per-file headers (t1: engine mocks enumerated + "REAL: bn-text-normalizer, edge_tts routing, pcm, ffmpeg audioQuality on real temp WAVs"; t10: llm/fetch mocked, cache-root override, real ffmpeg) + `tests/README.md` isolation-contract table + hermetic-ness caveats (README:62-75) stating exactly what is NOT verified (live latency, browser EventSource DOM, artifact registration in Phase-1-era files).
- **Tautologies**: none found (grep clean; the t18:105 tautology was Phase-5 scope, already replaced).
- **Real-vs-mocked balance**: ffmpeg is genuinely executed in t1/t5/t8/t9/t10; provider boundaries mocked; DB faked in-memory; SSE route tests drive real route handlers. This matches Layer A (deterministic, mocked providers) + a meaningful slice of Layer B (budget-free integration: real routes, real pipelines in t17/t19 — Phase-5 files) and Layer C (offline media: real ffprobe/loudness on synthetic fixtures, honestly labeled synthetic).
- **Direct re-evidence this audit**: `bun test tests/regression/t11-production-stage-metrics.test.ts` → **4 pass / 0 fail, 53 expects, 2.28s**.

## Worklog-claim vs code contradictions

- **None material.** Spot-checked claims all hold: "replay-from-emit" (events.ts:46-54 ✓), "409 + activeRunId before user-message creation" (chat/route.ts:154-172 ✓), "Math.min(2,..) cap removed / engine-aware skip" (language_controller.ts:384-473 ✓), "WAV+MP3 registered alongside" (tools/audio.ts + audio.ts:52-70 ✓), "spec.resolution persisted" (capabilities.ts:399-402 ✓), "firstTokenMs recording" (orchestrator.ts:102-113,292 ✓), "same-tool repeat guard + 10-min max-elapsed" (orchestrator.ts:36-41,1312-1341 ✓), "sha256 request fingerprint / validated store / in-flight dedupe / FIFO eviction" (shot_cache.ts ✓), "two-pass loudnorm ~−16 LUFS/−1.5 dBTP only after all layers merge" (sound_design.ts:648-688 ✓).
- Commit messages are accurate for Phase 1–3 (8c472fb honestly recorded its 36/37 state; 8ce272c's four-workstream claims match the code; 2b0ef3e/acf147b match). History-hygiene issue is limited to Phase-4-era UUID commits (A1-F06) and was already self-reported in the worklog.

## Verdict roll-up

| Phase | Verdict | Open items |
|---|---|---|
| 1 | **PASS WITH DOCUMENTED LIMITATIONS** | A1-F05 (P3), A1-F07 (record, no action) |
| 2 | **PASS WITH DOCUMENTED LIMITATIONS** | **A1-F01 (P2 — recommend hardening fix)**, A1-F02 (P3), DOM-reattach test gap (documented) |
| 3 | **PASS WITH DOCUMENTED LIMITATIONS** | A1-F03 (P3), A1-F04 (P3), live-provider evidence NOT RUN (documented) |

Counts: **P0: 0 · P1: 0 · P2: 1 · P3: 6** (A1-F01…F07; F07 is a record, not a defect).
