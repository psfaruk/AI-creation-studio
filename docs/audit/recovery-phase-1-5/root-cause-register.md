# Root-Cause Register — recovery fix wave status (RC-1…RC-10 + cross-audit causes)

Sources: `findings/findings-b.md` §9 (the numbered TTS register, quoted
pre-fix `file:line`), the R-FIX worklog entry (severity-ordered fix wave),
and the R-WAVE4 entry (minimal live Layer-D proof). **Pre-fix** line numbers
are the auditors', at HEAD `c7927f7`; **post-fix** citations were re-verified
in the working tree at documentation time (the recovery changes are
uncommitted on top of `c7927f7`). Every FIXED claim below is
regression-locked in the final **185/185** suite (t1/t8 rewrites =
documented strengthenings; t20 = 9 new tests; t21 = 2 new tests).

## 1. The TTS register (Critical Defect A) — RC-1…RC-10

| RC | Root cause (pre-fix evidence) | Status | Fix (R-FIX) | Regression lock |
|---|---|---|---|---|
| **RC-1 (P0)** | bn voice profile carried language-incompatible jam/douji emergency fallbacks; engine-dead skip performed no locale-compat check — `language_controller.ts:68, 400–429` (B-F01) | **FIXED** | `language_controller.ts` rewritten (895 lines): per-voice capability tags, fail-closed (`{engine, languages, locale}` map — z-ai voices honestly tagged `languages:['en']`, with the 2026-10-16 Chinese-garbage run cited in-code; chain filter requires `capability.languages.includes(spec.language)`); bn chain = 4 Edge bn-BD/bn-IN voices only → unreachable ⇒ typed `VOICE_UNAVAILABLE` with the exact §4.2 message. **Live-proven (Wave-4)**: bn + dead Edge → `VOICE_UNAVAILABLE`, attempts=1, no language-broken fallback | REG-1c (bn profile = Edge-neural only, capability-tagged); REG-8c/8d (bn + Edge 403 ⇒ honest failure, no cross-language audio); REG-20 chain-level typed errors; REG-1a/b/f/g rewritten to the honest contract |
| **RC-2 (P0)** | verification verdict never a gate — fail-verified audio returned, registered, mixed; headline verdict ignored it — `language_controller.ts:459–472`; `short_film.ts:810–846, 1239–1247, 1560–1564`; `tools/audio.ts:459–474` (B-F02/B-F13) | **FIXED** | verification-exhaustion rejects with typed `VERIFICATION_FAILED` (last voice + reason included); failed-verdict line = **subtitle-only** + honest note + separate count; final verdict factors language verification — "চমৎকার" impossible with a fail/warn line; `speech_synthesis` registration gate for verification-failed output (`reason:'language_verification_failed'`, `tools/audio.ts:463–475`) | **REG-21a (the P0 pipeline gate)**: fail-verified line NOT mixed, `artifactId:null` in the dialogue join, result loses "চমৎকার"; REG-20f (B-F13 tool-gate, controller level) |
| **RC-3 (P1)** | bn output-verification structurally blind — CJK-invisible script detector, similarity computed but unused, no repetition/empty checks — `language_controller.ts:101–112, 198–202, 322–331` (B-F04) | **FIXED** | other-script/CJK detection + trivial-repetition detection + bn similarity counted in the verdict (controller rewrite) | REG-20a-family with the **real DB transcript** `bn-jam-chinese-garbage` ("可真的，可真的…") promoted to `tests/fixtures/language/defect-a-transcripts.json` — the exact 2026-10-16 garbage now locked offline, zero API cost |
| **RC-4 (P1)** | en threshold (0.5, trigram-inflated) unvalidated; live false positive at similarity 0.57 on romanized garbage — `language_controller.ts:311–314, 195`; DB `speech-en-tongtong` (B-F05) | **FIXED** | en verdict requires word-recitation (token coverage); fallback-obtained results capped at `warn`, never `pass` | REG-20b (real `en-tongtong-romanized-garbage` fixture) + REG-1i (fallback cap). **Live-proven (Wave-4)**: en control → similarity **1.0**, word-recitation **8/8**, verdict pass — strictness is real, not only mocked |
| **RC-5 (P1)** | provenance recorded at the wrong layer — requested voice persisted instead of the actual fallback voice — `short_film.ts:757, 868, 887` (B-F06 = E-F04 extended) | **FIXED** | `requestedVoice` + `actualVoice` + engine (+ locale) persisted on every TTS artifact (`short_film.ts:908–924, 1067–1104`) | REG-8f (actual ≠ requested recorded honestly); REG-21b (`actualVoice` matches the real chain, `requestedVoice` present); REG-20g/h |
| **RC-6 (P1)** | capability claims were static absolutes; no per-voice availability/verification records; nothing conditioned on live health — `capabilities.ts:473–477`; `availability-matrix.ts:59–65`; `production-card.tsx:381–396`; `model-registry-data.ts:222` (B-F07/B-F12) | **FIXED** | health-conditioned honest wording (`capabilities.ts:473–480`: bn voices described as Bengali-trained **when Edge is reachable**; dead Edge ⇒ honest `VOICE_UNAVAILABLE` outcome); `microsoft-edge-neural` registry entry (`model-registry-data.ts:228`); per-voice verification records persisted via `recordVoiceVerification` → `storage/voice-verification.json` (`edge_tts.ts:424–504`) | REG-20g/h (verification records + locale/provider metadata consistency, §4.5 cases 13/14) |
| **RC-7 (P2)** | raw `text_to_speech` tool (default tongtong) bypassed the entire language-integrity layer — `registry.ts:263–314` (B-F08) | **FIXED** | tool routed through `synthesizeVerifiedSpeech` (`registry.ts:275–286`) — same controller path as everything else | REG-20 chain-level typed errors incl. the bypass path (§4.5 case 3) |
| **RC-8 (P2)** | no bn-BD/bn-IN locale dimension — silent cross-dialect substitution possible; per-line locale unrecorded — `types.ts:551`; `language_controller.ts:68, 146–157` (B-F10) | **FIXED** | locale dimension in the capability map (`locale:'bn-BD'/'bn-IN'…`), typed `UNSUPPORTED_LOCALE` error, locale persisted in provenance | REG-20f (locale cases, §4.5 case 11) |
| **RC-9 (P2)** | `warn` collapsed into success at every aggregation layer; film verdict technical-only — `language_controller.ts:459`; `short_film.ts:1560–1564` (B-F09) | **FIXED** | mixed-but-warn results get a visible "সতর্কতা" aggregate (`short_film.ts:285`); final verdict factors speech verification (`short_film.ts:1967–1983`) | REG-21a **and** REG-21b both assert the result no longer claims "চমৎকার" when a line failed/warned (§4.5 case 13) |
| **RC-10 (P2)** | Edge adapter's own boundedness machinery untested (3-attempt retry, clock-skew learning, segment split, health check) — tests grep evidence (B-F11) | **OPEN (honest)** | chain-level boundedness **is** now locked (REG-8g: bn + Edge 403 ⇒ exactly one real call per chunk, loop always terminates; REG-1a/1g rewritten), but the **adapter-level ws-mock test** of `edge_tts.ts` internals was not written — t20's header records it as "B-F11 partial — a documented follow-up". Not claimed done | REG-8g (chain level only); adapter-level units pending (§3) |

**Defect A verdict recap** (findings-b §10): CONFIRMED and fully explained by
RC-1 + RC-2 (+RC-3/4/5 amplifiers) — Edge 403 (environmental, bounded
handling) → silent fallback into non-Bengali jam/douji → CJK-blind
warn/pass → no gate: garbage registered, mixed, film "চমৎকার", artifacts
naming voices never used. Post-fix, the same live situation produces a typed
honest failure (Wave-4 proof). Refuted root causes stay refuted: the 403 is
not a code bug; the SDK has no hidden Bengali voice; ASR tuning was not the
root (no machine check can validate Bengali pronunciation with this ASR —
hence VOICE_UNAVAILABLE is the only honest degraded state).

## 2. Root causes beyond the TTS register (cross-audit)

| Cause | Root cause (pre-fix evidence) | Status | Fix (R-FIX) | Regression lock |
|---|---|---|---|---|
| **D-F02 (P1)** — speaker misalignment | dialogue lines placed by a scene-sequential cursor — could play over non-speaking/wrong-character shots; `acting.speaks` never reached prompts — `short_film.ts:967–977, 998–1007, :648`; real-run SRT vs shot windows | **FIXED** | lines matched to the speaking character's shot window — `placeDialogueLine` returns `{startSec, endSec, shotId, matchedSpeakerShot}` (`short_film.ts:212–223`); speaks→prompt wiring added | REG-21b (per-line timing contract + final-video dialogue join carry the shot/artifact joins) |
| **D-F03 (P1)** — prompt-language breach | Bengali `actionEn` reached CogVideoX-3 in the real run (script LLM ignored the English-visualEn instruction; planner fallback mixed Bengali) — `short_film.ts:240`; `planner.ts:414–417/652–655` | **FIXED** | planner half: Bengali source → English `actionEn` fallback + honest adjustment; run-path half: lead-authored shared guard `cinematic/lang-guard.ts` + defensive checks on prewarm and per-shot submitted prompts → honest note, never silent (`short_film.ts:849–854, 1284–1287`) | REG-16r3 (planner half; adjustment reason cites D-F03); run-path guard exercised via the t21 pipeline runs |
| **C-F03 (P2)** — silent film-end truncation | dialogue/narration longer than the film was silently cut by `atrim`/`apad+-t` — §5.2 "নীরবে stretch/truncate করবে না" violation — `short_film.ts:1658–1659`; `film-helpers.ts:379–382` (= the mechanism behind E-F02's 87% narration loss) | **FIXED** | overflow detected + honest partial note + machine record `{line, overflowSec, action:'truncated'}` — dialogue (`short_film.ts:1509–1526`) and A5 narration (`:1673–1683`) | REG-21b (asserts the honest note and `metaJson.audioOverflows[0].action === 'truncated'`) |
| **C-F04 (P2)** — timing contract unpersisted | per-line `startSec/endSec/measuredSec/shotId/sampleRate` + artifact joins absent from all artifacts — future lip-sync input contract had no data foundation — `short_film.ts:861–882` vs §5.2 schema | **FIXED** | full per-line timing contract persisted (+ full text, C-F07; + true provenance, B-F06) and a machine-readable `dialogue` join on the final video (`{artifactId, character, startSec, endSec}`) | REG-21b (asserts every field on both artifact levels) |
| **B-F06 (P1)** — provenance | = RC-5's finding ID (requested-vs-actual voice) | **FIXED** | see RC-5 | REG-8f / REG-21b / REG-20g-h |
| **B-F07 (P1)** — claims | = RC-6's finding ID (static "Bengali neural voices active" absolutes) | **FIXED** | see RC-6 | REG-20g/h |
| **B-F08 (P2)** — tool bypass | = RC-7's finding ID (`text_to_speech` pre-controller) | **FIXED** | see RC-7 | REG-20 (chain level) |
| **A1-F01 (P2)** — zombie-run 409 lockout | server death left DB `running` up to ~10 min; sweep only fired on conversations-GET; single open tab could stay locked out — `chat/route.ts:159–172`; `orchestrator.ts:38, 1730–1748` | **FIXED** | chat 409 path now applies the same staleness limit (`STALE_RUN_MS` from the real orchestrator) and honestly marks dead runs `interrupted`, opening the path for the new run (`chat/route.ts:163–180`); sibling A1-F02 (runs-SSE unbounded lifetime) got `MAX_LIVE_MS` mirroring the productions route | REG-3f/3g (t3); REG-2e (t2, A1-F02) |

Related hardening landed in the same wave (not root causes of the Critical
Defects, locked or code-verified): A1-F03 fingerprint byte-exactness
(`ai_video.ts:555–556`), A1-F04 tts-cache 256 MiB budget
(`tts-cache.ts:119, 129–133`), A1-F05 shared retry constant (`llm.ts:29` +
`orchestrator.ts:437`), A2-F01 dead export removed, A2-F02 schema-cache
TTL + invalidation (REG-13j), A2-F03 64-cap accounting (`planner.ts:952–954`,
REG-16i extension), A2-F04 song-origin parity (`runner.ts:383–400`),
A2-F05 scene-lighting honest marker (`lightingProvenance`,
`planner.ts:576–580, 819–823`), A2-F06 skeleton diversity guard
(`planner.ts:492, 809, 835`, REG-18k), D-F04 two-character OTS/reaction
distribution (`planner.ts:725–745`, REG-16r1/r2/f4), E-F01 delivered-final
loudness truth (`loudnessSignal`, `short_film.ts:1870–1890`), E-F03
magic-byte MIME sniffing (`short_film.ts:640–643, 1324–1330`), D-F07/D-F09
verdict/count honesty (with REG-21a), C-F05/C-F06 UI honesty notes
(ParsedResult notes rendered; film-dialogue statusNote).

## 3. Honestly unfixed (end state — no silence, no spin)

1. **Edge bn-voice availability — environmental, not code.** The only
   Bengali-capable voices (4 Edge bn-BD/bn-IN) ride an unofficial, unstable
   endpoint; it is dead today (Wave-4 WSS probe failed). The code now fails
   honestly (`VOICE_UNAVAILABLE`); live Bengali success returns only when
   Edge does. BLOCKED on environment.
2. **§4.5 case 1 (bn live success) — live-unverified today.** Wave-4 could
   not capture it for the same reason; the healthy-path contract is locked
   at unit level (REG-1h) and the Layer-D sheet is ready for the day Edge
   recovers (user-authorized).
3. **B-F11 adapter-level ws-mock test — OPEN** (RC-10): `edge_tts.ts`
   internals (bounded 3-attempt retry, clock-skew learning, segment split,
   health check) still have no direct unit coverage; only chain-level
   boundedness is locked (REG-8g).
4. **E-F05 route-level events-test gap — OPEN**: `/api/productions/[id]/events`
   SSE route has no direct route-level regression (t2/t4 cover the runs
   events route only — shared bus, different route code).
5. Lower-priority, recorded for the acceptance report: A2-F07 (MV character
   slot-fill integration lock), §6.5 (>8-adjustments truncation label
   browser-unexercised), A2-F08 (publish blocker — `c7927f7` + this
   recovery are unpushed/uncommitted awaiting credentials and the user's
   commit decision), E-F08 (real WAV/MP4 media fixtures not yet promoted —
   only the DB transcripts were), `tests/README.md` REG-20/21 catalog rows
   still to be added (the design is documented in
   `test-plan-and-fixtures.md`), and D-F01's §6.4 human acting-review sheet
   remains **NOT REVIEWED** — the Wave-4 VLM frame review is the only
   visual-quality evidence to date.

All of the above are limitations and follow-ups, **not** silent failures:
the suite (185/185), the four static gates, and the live Wave-4 proofs
stand as recorded, and nothing in this register upgrades a NOT RUN /
NOT VERIFIED into a pass.
