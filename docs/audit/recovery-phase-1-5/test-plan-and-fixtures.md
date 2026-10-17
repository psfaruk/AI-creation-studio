# Recovery Phase 1–5 — Test Plan & Fixtures (R-DOC-3)

Test inventory, evidence-record format, mock boundaries, fixture-promotion decisions,
suite hardening and determinism notes for the recovery round (R-A1/A2/B/C/D/E → R-FIX → R-WAVE4).
Result-bearing documents: `automated-test-results.md` (Layer A/B), `offline-media-backtest-results.md`
(Layer C), `live-provider-test-requirements.md` (Layer D).

## 1. §8 Evidence-record format (master §8 / findings-e §5.1)

Every executable check in this audit round carries one evidence record in this shape.
No result is pre-written before running; BLOCKED requires a reason; NOT RUN requires a
trigger condition; every FAIL links to a finding ID.

```markdown
### EV-<suite>-<n> — <Test ID>
- **Test ID:** REG-xY / LAYER-x-n / LIVE-x-n
- **Requirement:** <master-prompt §, one sentence>
- **Input fixture:** <path or "self-synthesized: <generator>" or "LIVE: <provider>">
- **Expected:** <exact, machine-checkable contract>
- **Actual:** <measured value(s), verbatim where possible>
- **Command / harness:** <exact command line or script path>
- **Status:** PASS | FAIL | BLOCKED | NOT RUN
- **Evidence file:** <path to artifact/log/JSON — never a claim without a file>
- **Known limitations:** <what this does NOT prove — mandatory honesty field>
- **Layer:** A (deterministic/mocked) | B (budget-free integration) | C (offline media) | D (live provider)
- **Environment:** <date, machine class, ffmpeg version, CPU-load note if relevant>
```

Evidence-file convention used by this round:

| Layer | Evidence location | Examples |
|---|---|---|
| A/B (suite) | bun run output logs preserved under `/tmp/r-*.log` | `/tmp/r-g-full2.log` (final 185/185), `/tmp/r-t21d.log`, `/tmp/r-t20d.log`, `/tmp/r-t8b.log`, `/tmp/r-e1.log` |
| C (offline media) | findings-e §2/§3 tables + `/tmp/r-e-probe/*.json` | ffprobe/ebur128 outputs, sha256 inventory |
| D (live) | `/tmp/r-wave4/*` | `evidence-tts.json`, `evidence-vlm.json`, `en-sample.wav`, `frame-*.jpg` + the two scripts |

## 2. Test inventory (22 files, 185 tests — verified)

Counts below were re-verified from the working tree by enumerating `test(`/`it(`
declarations per file; the per-file counts sum to exactly **185**, matching the recorded
final-suite pass count (`/tmp/r-g-full2.log`: 185 pass / 0 fail, 1977 expects, 22 files, 184.96 s).

| File | Tests | State in recovery | Change |
|---|---|---|---|
| `tests/smoke.test.ts` | 4 | unchanged | — |
| `t1-bengali-tts-fallback.test.ts` | **9** (was 7) | **rewritten + extended** | REG-1a/b/c/f/g **rewritten** (they previously locked the *flawed* jam-fallback contract — REG-1a asserted `voice=jam`); **REG-1h** (§4.5 case 1 unit: bn + healthy Edge-neural audio ⇒ verdict pass) and **REG-1i** (B-F05: en result after engine fallback capped at `warn`, never `pass`) NEW. Describe title now says "(R-FIX-1 contract)". |
| `t2-chat-run-refresh-reconnect.test.ts` | **5** (was 4) | extended | + REG-2e [A1-F02]: runs-SSE stream closes itself at the max-lifetime cap — no fake `run_finished`, run row untouched (parity with productions-SSE). |
| `t3-duplicate-submission.test.ts` | **7** (was 5) | extended | + REG-3f [A1-F01]: obviously-stale running row (past the 10-min sweep window) no longer 409-locks; + REG-3g [A1-F01 boundary]: a row still INSIDE the window keeps the honest 409. |
| `t4-sse-event-replay.test.ts` | 5 | unchanged | — |
| `t5-instrumental-audio.test.ts` | 6 | unchanged | — |
| `t6-http-429-retry.test.ts` | 10 | unchanged | — |
| `t7-client-run-reattach.test.ts` | 6 | unchanged | — |
| `t8-motion-voiceover-fallback.test.ts` | **7** (count unchanged) | **rewritten** | REG-8b/c/d/f/g **rewritten** to the R-FIX-1 contract: bn + Edge 403 ⇒ engine-aware skip and honest `VOICE_UNAVAILABLE` per chunk (no cross-language fallback); en 403 ⇒ *legitimate* fallback to the en-capable z-ai voice with true provenance (`actualVoice ≠ requested` recorded, attempts + fallback notes); bounded retry (exactly one real call per chunk). |
| `t9-final-mix-loudness.test.ts` | 7 | unchanged | — |
| `t10-shot-cache-reuse.test.ts` | 10 | unchanged | — |
| `t11-production-stage-metrics.test.ts` | 4 | unchanged | — |
| `t12-intent-routing.test.ts` | **20** (was 17) | extended | + REG-12r-1 [C-F05]: `parseResultSummary` surfaces `resultJson.notes` (legacy/dirty/corrupt inputs safe); + REG-12r-2 [O-3/O-4]: engine labels carry no unverified quality adjective ("রিয়েলিস্টিক" gone; CogVideoX-3 + honest cost labeled; ai_diffusion note admits storyboard fallback); + REG-12r-3 [C-F06]: film-dialogue mode card carries the "ঠোঁট-সিঙ্ক নয়" statusNote. |
| `t13-config-panel.test.ts` | **12** (was 9) | extended | + REG-13j-1/2/3 [A2-F02]: schema-cache freshness window (fresh served / stale refetch), `invalidateConfigPanelSchema` (per-type/per-conversation/full-clear), invalidation seeds the next mount refetch. |
| `t14-capability-confirm.test.ts` | 12 | unchanged | — |
| `t15-intent-metrics.test.ts` | 6 | unchanged | — |
| `t16-cinematic-plan.test.ts` | **27** (was 22) | extended | + REG-16r1/r2 [T-R1/T-R2, D-F04]: two-character romantic fixtures — 30 s structure + OTS→`characters[0]`/reaction→`characters[1]` distribution at 45/60 s; + REG-16f3 [A2-F05]: scene-level `lightingMood` honestly marker as planning placeholder; + REG-16f4 [D-F04]: character-named OTS/reaction sentences + character-validation guard; + REG-16r3 [T-R3, D-F03 planner-half]: Bengali source text → English `actionEn` fallback with honest adjustment. Existing validate-guard tests keep their Phase-5 extensions (beatSource/subject/totalPlannedSec/adjustment-shape). |
| `t17-cinematic-mv-integration.test.ts` | 5 | unchanged | — |
| `t18-plan-preview-route.test.ts` | **11** (was 10) | extended | + REG-18k [A2-F06, R-FIX-3]: skeleton diversity — route path yields no adjacent identical (size+movement) pair. |
| `t19-sf-cinematic-integration.test.ts` | 1 | unchanged | — |
| `t20-bengali-language-integrity.test.ts` | **9** | **NEW (R-FIX-1)** | §4.5/§4.4 verification-machinery locks — see §3. |
| `t21-dialogue-timing-contract.test.ts` | **2** | **NEW (R-FIX-2)** | SF pipeline P0 gate + overflow/timing contract — see §3. |

**+28 arithmetic (157 → 185, reconciles exactly):** t1 +2, t2 +1, t3 +2, t12 +3, t13 +3,
t16 +5, t18 +1 (old files, +17) + t20 +9 + t21 +2 = **+28**. Old per-file counts from the
Phase-5 gate (157/157) cross-checked against the recovery diff (`git diff -- tests/` added
test declarations) and the final run log.

## 3. New files — mock boundaries (documented per header, verified by read)

### 3.1 `t20-bengali-language-integrity.test.ts` (REG-20a…i)

- **Module under test (REAL):** `language_controller` — `verifySpeechBuffer` directly
  (the defense-in-depth layer that stays armed even though the bn chain no longer reaches
  z-ai voices) + `synthesizeVerifiedSpeech` for chain-level typed errors, `detectLanguage`,
  `detectTrivialRepetition`, `enTokenCoverage`, `speechErrorCode`.
- **Mocked:** `@/lib/agent/sdk-helpers` (`transcribeBuffer` → switchable transcript,
  including the two REAL DB transcripts; `synthesizeSpeech` throws if reached) and
  `@/lib/agent/tts-cache` (engine routing, Edge-403 mode switch). **REAL:** ffmpeg
  `audioQuality` on temp WAVs, bn-normalizer, `edge_tts` helpers. No network, no provider, no db.
- **Fixture-driven:** `tests/fixtures/language/defect-a-transcripts.json` (§5).
- **Coverage:** REG-20a real Chinese-garbage transcript ⇒ other-script + repetition +
  similarity-0 ⇒ `fail`; 20b real romanized-garbage can never `pass` (token-coverage gate);
  20c empty transcript ⇒ `fail`; 20d partial transcript ⇒ loud fragmentation note; 20e
  mixed-script/en-script-for-bn ⇒ `LANGUAGE_MISMATCH` before any synthesis call; 20f
  inconsistent/fabricated locale ⇒ `UNSUPPORTED_LOCALE`; 20g/20h provenance
  (requestedVoice/actualVoice/engine/locale recorded; good-faith upgrade `jam → bn-BD-NabanitaNeural`
  honestly noted); 20i bn chain exhaustion ⇒ typed `VOICE_UNAVAILABLE` with `attempts:1`.
- §4.5 case map (header, lines 22–30): case 1 unit = REG-1h (t1); case 2/7 = REG-1a/1f (t1);
  case 3 = REG-20e; case 4 = REG-20a; case 5 = REG-20a/b; case 6 = REG-20c; case 8 =
  controller-level REG-1a/1g (adapter-level ws-mock = documented follow-up, B-F11 partial);
  case 9 = t19 (pipeline-level); case 10 = REG-1i + REG-20b; case 11 = REG-20f; case 12 =
  B-F13 tool-gate (controller reject locked here, unit follow-up); case 13 = UI label units
  (t12) + pipeline tests; case 14 = REG-20g/h.

### 3.2 `t21-dialogue-timing-contract.test.ts` (REG-21a/21b)

- **Module under test (REAL):** the whole SF pipeline (`shortFilmPipeline`) with the REAL
  cinematic planner, prompt builders, pipeline logic, shot cache and ffmpeg assembly.
- **Mocked (t19-pattern, provider level):** `@/lib/agent/llm` (`getZAI` → video create/query
  mocks; `chatJson` returns fixture payloads and throws on any unexpected third call),
  `@/lib/agent/sdk-helpers` (**re-exports the REAL retry symbols** — withRetry,
  parseRetryAfterMs, fullJitterDelayMs, isRateLimitErrorText, TemporarilyUnavailableError —
  the P4-2 mock-leak defense), `@/lib/agent/tts-cache` (engine boundary; the REAL
  language-controller verification chain runs over the mock WAVs with REAL ffmpeg
  audioQuality), `@/lib/db` (characters), `globalThis.fetch` (fixture MP4 download).
  `AI_VIDEO_LIMITS.pollIntervalMs` shortened; `__shotCacheRootOverride` per-test; restored in `afterAll`.
- **REG-21a [P0 — B-F02/D-F05/D-F09]:** a dialogue line whose whole voice-chain FAILS
  verification is NOT mixed into the film — subtitle-only + honest `TTS ব্যর্থ (VERIFICATION_FAILED)`
  note + counted separately; final video's `dialogue` join carries both lines (failed one
  `artifactId:null`); headline verdict loses "চমৎকার".
- **REG-21b [C-F03/C-F04/C-F07/B-F06]:** film-end audio overflow detected + honestly noted
  (no silent truncation), per-line timing contract persisted (`startSec/endSec/measuredSec/sampleRate`
  + artifact-ID join on the final video + FULL text + true voice provenance);
  `metaJson.audioOverflows` recorded with `action:'truncated'`.

### 3.3 Rewritten files (t1, t8)

Same t1-pattern engine-boundary mocks as before (`tts-cache` + `sdk-helpers` mocked; ffmpeg,
normalizer real). The **contracts changed direction**: the old REG-1a/b asserted the
jam-fallback behavior that produced the 2026-10-16 Chinese-garbage audio; the rewrite asserts
the fail-closed R-FIX-1 behavior (bn profile = Edge-neural only, capability-tagged; typed
errors; no cross-language fallback). This is a **strengthening** — see
`automated-test-results.md` §4 for the transition history.

## 4. Fixture promotion (E-F08 / findings-e §2.2 / findings-b §10-7)

| Asset | Decision | Where |
|---|---|---|
| speech-bn-jam DB transcript ("可真的，可真的，踢踢踢…", similarity 0) | **PROMOTED to tracked fixture** (binary-free: transcript string + behavior expectation only) | `tests/fixtures/language/defect-a-transcripts.json` case `bn-jam-chinese-garbage` |
| speech-en-tongtong DB transcript ("Shubhoh bioya no tan bochar shukho…", similarity 0.57) | **PROMOTED to tracked fixture** (original en script not recoverable from the DB note — representative script used, documented in `scriptNote`; the behavior expectation is unchanged: such output can never reach `pass`) | same file, case `en-tongtong-romanized-garbage` |
| The 14 real media **binaries** (7 WAVs, 3 clips, 1 final MP4, 3 images) | **NOT promoted** — stay untracked in `storage/` (gitignored) with full paths, sizes, sha256 prefixes and ffprobe summaries documented | `findings-e.md` §2.1 master inventory |

Fixture file shape: `version:1`, per-case `provenance` (DB artifact + storage path), requested
language, actual voice/engine, script, transcript, `dbSimilarity`, `expectedVerdict`,
`expectedReasons` (each tied to a finding ID: B-F04-ক/খ/গ, B-F05). No provider bytes enter
version control; the suite remains binary-free and self-synthesizing except this
transcript-level evidence.

## 5. Suite hardening (E-F10 / findings-e §6)

- **Explicit timeouts on ffmpeg-heavy tests** (bun's default is 5000 ms/test;
  `tests/bun-test-shim.d.ts:60` already declares the 3rd `test()` arg):
  - **t20:** all 9 tests carry `20_000` ms.
  - **t21:** both tests carry `420_000` ms (420 s) — these run two full SF pipelines
    (3 provider-shot downloads + verification chains + ffmpeg assembly each; observed
    38.85 s isolated on the quiet box — the 420 s budget is for 2-CPU contention).
- **REG-9g-class CPU-contention lesson:** REG-9g measured 2802 ms isolated (44% headroom
  under the 5 s default) but hit the ceiling once when two agents ran the suite concurrently
  on the 2-CPU box (worklog P5-7, E-F10) — environmental contention, not a regression.
  t9's tests keep the default (they pass at 2.6 s in the final run); the *new* heavy files
  get explicit budgets so the whole flake class is designed out without weakening assertions.
- **E-F09 hygiene (open follow-up):** 9 leftover `/tmp/reg18-fixture-*` dirs prove some
  interrupted runs skip `afterAll`. The recommended idempotent pre-suite sweep was NOT
  implemented in this round (documented, harmless — synthetic 57 KB WAVs only).

## 6. Determinism & order notes (one-bun-process discoveries)

Isolation contract (per `tests/README.md`, re-verified by findings-e §1.3): per-test
`resetFakeDb()`, unique runIds, per-test `mkdtemp` + `afterAll rm`, coordinator/event-bus
resets, `globalThis` overrides (`__shotCacheRootOverride`, `__aiVideoGate`) set in
`beforeEach` and cleared in `afterAll`; no snapshots anywhere (0 `toMatchSnapshot` across
the suite); no tautological assertions.

Recovery-round additions to that knowledge (both discovered live, both fixed
order-independently):

1. **t9-mock-leak ordering discovery — file order matters in one bun process.**
   Running `bun test t9… t10…` (t9 first) in a single process crashes t10/t19 at module
   load: t9's *minimal* `sdk-helpers` mock (`chatJson`/`transcribeBuffer`/`synthesizeSpeech`
   only) leaks to later-loaded files, and their `import { TemporarilyUnavailableError } from
   '@/lib/agent/sdk-helpers'` fails with `SyntaxError: Export named 'TemporarilyUnavailableError'
   not found`. Evidence: `/tmp/r-e2.log` (t9→t10: 7 pass / 1 fail / 1 error, 11.23 s) and
   `/tmp/r-heavy1.log` (t9→t10,t19: 2 errors). The suite's default **alphabetical load order
   is safe** (t9 loads after t10/t19, and the full-suite runs are green — findings-e §6
   "bun isolates mock.module per file" holds for the default order). The defensive pattern is
   now documented in-code: t12's header explains why `isRateLimitErrorText` must not be
   mocked (sdk-helpers re-exports it from retry.ts), and t20/t21 mocks **re-export the real
   retry symbols**. Rule for future multi-file runs: respect alphabetical order or use the
   re-export pattern.
2. **Import-time `window` guard (security-gate).** In one process, t7's fake
   `globalThis.window` (localStorage stub, no `fetch`) leaked into t12/t13's module-scope
   imports of `security-gate.tsx`, whose import-time `installStudioFetchWrapper()` crashed on
   `window.fetch.bind` — 2 unhandled errors in the 22:14 intermediate full run
   (`/tmp/r-g-full.log`: 155 ran / 153 pass / 2 fail / 2 errors). Fixed with an
   order-independent defensive guard (`typeof window === 'undefined' || typeof window.fetch
   !== 'function' → return`, source comment "R-FIX (suite-robustness)") — no test was
   weakened and no file reordering was needed.
3. **t9 header note (intra-file ordering):** type-only imports are runtime-erased and so
   cannot disturb `mock.module`→`await import` ordering (t9 lines 26–27).

Repeated full-suite runs across the round ended green; the single final run of record is
`/tmp/r-g-full2.log` (185/185, 184.96 s). No test-order flake remains open.
