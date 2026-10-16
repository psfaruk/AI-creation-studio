# Recovery Audit — Bengali TTS / Language Integrity (Critical Defect A)

- **Task ID:** R-DOC-2 (documentation consolidation) · Audit basis: **R-B** · Fix wave: **R-FIX** · Live proof: **R-WAVE4**
- **Defect (master prompt §4):** Bengali text must be read by a Bengali voice; an English/Chinese voice reading Bengali must never be reported as success; when no verified Bengali voice is reachable the system must say so (§4.2 `VOICE_UNAVAILABLE`).
- **Sources:** `findings/findings-b.md` (full audit at HEAD `c7927f7`), `worklog.md` R-B / R-FIX / R-WAVE4, `/tmp/r-wave4/evidence-tts.json` (live Layer-D evidence), `tests/regression/t1-bengali-tts-fallback.test.ts`, `t20-bengali-language-integrity.test.ts`, `t21-dialogue-timing-contract.test.ts`.
- **Citation convention:** *pre-fix* file:line = as audited in findings-b at HEAD `c7927f7`; *current* file:line = re-verified in the post-R-FIX working tree by this document. The R-FIX tree is uncommitted (no push without user authorization) and passed the full gate **185/185 (1977 expects, 22 files, 184.96 s), typecheck 0, lint 0, prisma validate 0**.

---

## 1. The evidence chain — what actually happened (all claims DB/artifact-proven, read-only)

1. **The z-ai SDK has no Bengali-capable voice.** `CreateAudioTTSBody` is `{model?, input, voice?: string, stream?, response_format?, speed?}` — no locale parameter, no voice catalog, no per-voice language documentation anywhere in the package (`node_modules/z-ai-web-dev-sdk/dist/index.d.ts:78–85`; README examples are Chinese). The app's own 2026-10-11 probe concluded "কোনো কণ্ঠই বাংলা-প্রশিক্ষিত নয়" (worklog:353). The 7-voice list was hand-copied from `skills/TTS/SKILL.md:185`, which documents **zero** language claims.
2. **The only bn-capable voices are 4 Microsoft Edge neural IDs** (`bn-BD-NabanitaNeural`, `bn-BD-PradeepNeural`, `bn-IN-TanishaaNeural`, `bn-IN-BashkarNeural` — genuine MS catalog names) reached through an **unofficial ReadAloud WSS endpoint** (reverse-engineered handshake, `edge_tts.ts:226–267`). No SLA, availability unstable (see §6).
3. **Edge 403 in the real run.** Production `cmvbbv86c000apzrc9mra61oi` (2026-10-16 18:55–19:18Z, user-initiated romantic short film): every speech artifact carries "Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403". The same endpoint had worked on 2026-10-13 (E2E, 17.9 s MP3).
4. **`speech-bn-jam` — Chinese garbage, similarity 0.** After the 403, the bn chain silently crossed engines into `jam` (not Bengali-trained). DB transcript: **"可真的，可真的，踢踢踢，忙的，踢踢踢，踢B T"** (Chinese character repetition), `similarity: 0`, yet `detectedLanguage: "en"` (the pre-fix detector saw only Bengali+Latin — CJK invisible; the two Latin letters "B T" sufficed), verdict **`warn`**, mixed into an artifact labeled `languageLabel: "বাংলা"`.
5. **`speech-en-tongtong` — romanized garbage, false pass.** Transcript **"Shubhoh bioya no tan bochar shukho, sumridhi ar shashti din niy asak."** (romanized Bengali), `similarity: 0.57` — above the unvalidated 0.5 threshold — verdict **`pass`**, "ইংরেজি কথা নিশিত", with a simultaneous engine-fallback note (Edge was dead).
6. **`dialogue-2-studio.wav` — verdict `fail`, still mixed.** 10.6 s of audio for the 5-word line "বৃষ্টি ভালোই লাগে।" (1 silence-gap ≥0.5 s at −40 dB — mostly continuous garbage/repetition), yet it was registered, placed on the A1 timeline, and mixed into the delivered 30.000 s film.
7. **Headline verdict "চমৎকার" + false provenance.** The film's top-line quality was computed from technical `problems` only (speech verification ignored), and every TTS artifact's metaJson named the *requested* Edge voice (e.g. `voice: "bn-BD-NabanitaNeural"`) while the actual voice was jam/douji.
8. **Registry-level:** of 15 selectable voices (findings-b §1 table), **zero** had in-repo, tracked evidence of Bengali synthesis + pronunciation correctness; no per-voice availability status, synthesis-test status, or last-verified timestamp existed as data.

**Chain (findings-b §10):** Edge 403 (environmental) → engine-aware-only skip lands on jam/douji (**RC-1**) → garbage output gets `warn` (CJK-blind verifier, **RC-3**) or `fail` (duration) → in both cases registered and mixed with no gate (**RC-2**) → film reports "চমৎকার" (**RC-9**) and artifacts name voices never used (**RC-5**). The en sibling fails in the opposite direction (romanized garbage certified `pass` at 0.57, **RC-4**).

---

## 2. Root-cause register RC-1..RC-10 (verbatim from findings-b §9; file:line at pre-fix `c7927f7`)

- **RC-1 (P0):** bn voice profile contains language-incompatible emergency-fallback voices and the engine-dead skip performs no locale-compatibility check — language_controller.ts:68, 400–429. *(B-F01; fix = capability-tagged profile + VOICE_UNAVAILABLE; locks §4.5 2/3/7/11.)*
- **RC-2 (P0):** verification verdict is never a gate — fail-verified audio is returned by the chain, registered as artifacts, mixed into the film, and the headline verdict ignores it — language_controller.ts:459–472; short_film.ts:810–846, 1239–1247, 1560–1564; tools/audio.ts:459–474. *(B-F02/B-F13; fix = chain rejects on verification-exhaustion + pipeline fail-path; locks 9/12/13.)*
- **RC-3 (P1):** output-language verification for bn is structurally blind — CJK-invisible script detector, similarity unused in the bn verdict, no repetition/empty checks — language_controller.ts:101–112, 198–202, 322–331. *(B-F04; fix = script classes + repetition + similarity-in-verdict; locks 4/5/6.)*
- **RC-4 (P1):** en verification threshold (0.5, trigram-inflated) has no validation evidence and live-false-positives on romanized garbage — language_controller.ts:311–314, 195; DB speech-en-tongtong (pass @ 0.57). *(B-F05; fix = token-overlap requirement + fallback-cap-to-warn; locks 5/10.)*
- **RC-5 (P1):** provenance recorded at the wrong layer — requested voice persisted instead of actual (film pipeline) — short_film.ts:757, 868, 887. *(B-F06 = E-F04 extended; fix = requestedVoice+actualVoice+engine; locks 14.)*
- **RC-6 (P1):** capability claims are static prose with no per-voice availability/verification records and no live-health conditioning — capabilities.ts:473–477; availability-matrix.ts:59–65; production-card.tsx:381–396; model-registry-data.ts:222. *(B-F07/B-F12; fix = persisted verification records + health-conditioned claims; locks 1/13/14.)*
- **RC-7 (P2):** a pre-controller raw TTS tool (`text_to_speech`, default tongtong) bypasses every language-integrity rule — registry.ts:263–314. *(B-F08; fix = route through controller or deprecate; locks 3.)*
- **RC-8 (P2):** locale dimension (bn-BD/bn-IN) does not exist in the spec/profiles, enabling silent cross-dialect voice substitution — types.ts:551; language_controller.ts:68, 146–157. *(B-F10; locks 11/14.)*
- **RC-9 (P2):** `warn` collapses into success at aggregation; film verdict is technical-only — language_controller.ts:459; short_film.ts:1560–1564. *(B-F09; locks 13.)*
- **RC-10 (P2):** the Edge adapter's own boundedness machinery is untested, so the "no infinite 403 retry" property rests on untested code — tests/ grep evidence. *(B-F11; locks 8.)*

**Root causes refuted** (findings-b §9): "Edge 403 is a code bug" — refuted as root cause of Defect A (protocol worked 2026-10-13; handling is bounded and honest; the defect is what the chain does *after* 403 = RC-1/RC-2). "The SDK has a Bengali voice we fail to select" — refuted (§1 above). "ASR similarity is mis-tuned for bn" — not the root: for bn the similarity value was not even consulted in the verdict (RC-3); no machine check can validate Bengali pronunciation with this ASR, making honest failure the only correct option.

---

## 3. The fix set (R-FIX — landed in the working tree, current file:line verified)

| # | Fix (root cause) | What is now true | Current evidence | Regression lock |
|---|---|---|---|---|
| 1 | **bn chain Edge-only + capability tags, fail-closed** (RC-1) | `language_controller.ts` rewritten (895 lines): every profile voice carries verified language capabilities; a voice that cannot speak the request language is *skipped*, never tried. jam/douji removed from the bn chain — "z-ai কণ্ঠ (jam/douji) বাংলা-প্রশিক্ষিত নয় — ২০২৬-১০-১৬-এর রানে চীনা-আবর্জনা প্রমাণিত; তাই bn-চেইনে আর নেই" | language_controller.ts:161, 730–731 (`voiceCapabilityOf` + `!capability.languages.includes(spec.language)` skip) | REG-1c (t1:223) |
| 2 | **Typed `VOICE_UNAVAILABLE` with §4.2's exact message** (RC-1/B-F03) | When no bn-capable voice is reachable (Edge dead), the controller rejects with the §4.2 wording instead of falling to jam — the state that previously did not exist anywhere (0 grep matches pre-fix) | language_controller.ts:61–92 (`SpeechSynthesisError`, codes `LANGUAGE_MISMATCH`/`VOICE_UNAVAILABLE`/`VERIFICATION_FAILED`/`UNSUPPORTED_LOCALE`), :854–858 (`VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale. (…§৪.২)`) | REG-1a/1f (t1:164, 256); **live** (§5) |
| 3 | **`VERIFICATION_FAILED` chain-exhaustion rejection** (RC-2) | Chain exhaustion on verification now rejects like engine-exhaustion — failing audio is never returned to callers | language_controller.ts:875–877 ("চেইনের সব Nটি প্রার্থী কণ্ঠই ভাষা/প্রযুক্তি-যাচাইে ব্যর্থ — অডিও গ্রহণযোগ্য নয়"), lastVerification carried on the typed error (:70–78) | REG-1b (t1:193), REG-20i (t20:236) |
| 4 | **other-script/CJK + repetition + bn-similarity-in-verdict** (RC-3) | Script-class detector sees CJK/Devanagari/etc. (`otherScriptRatio ≥ 0.25` ⇒ `'other-script'` ⇒ verdict `fail` for bn); trivial-repetition detection (top-token density ≥0.4 ⇒ fail); bn similarity now participates in the verdict | language_controller.ts:192–229, 514–525 | REG-20a (t20:120, real DB transcript fixture) |
| 5 | **en token-coverage + fallback-cap-to-warn** (RC-4) | `pass` now requires **both** numeric similarity **and** ≥50% token coverage of the script's English words; any result obtained after an engine fallback is capped at `warn` | language_controller.ts:380, 552–557 ("ASR রাউন্ড-ট্রিপ সাদৃশ্য ও শব্দ-আবৃত্তি দুটোই যথেষ্ট"), REG-1i comment (t1:27–32) | REG-20b (t20:134), REG-1i (t1:320); **live** (§5) |
| 6 | **`requestedVoice`/`actualVoice` provenance** (RC-5) | Every TTS artifact and verification record carries requested + actual voice, engine, locale | REG-20g/h (t20:212, 227); pipeline: short_film.ts:908–928 (narration), :967+ (dialogue) | REG-20g/h, REG-21b |
| 7 | **Health-conditioned capability claims + per-voice verification records** (RC-6) | Capability notes are conditional ("Edge সক্রিয় কালে দেশীয় উচ্চারণ; Edge অচল হলে সৎ ফলাফল VOICE_UNAVAILABLE…"); per-voice verification records persisted to `storage/voice-verification.json`; model registry gained an honest `microsoft-edge-neural` entry | capabilities.ts:477; edge_tts.ts:424–520 (`recordVoiceVerification`), language_controller.ts:636–638 | §4.5 cases 1/13/14 units |
| 8 | **`text_to_speech` routed through the controller** (RC-7) | The legacy tool no longer calls the SDK directly: language auto-detect (bn/en), bn→Edge-neural with honest `VOICE_UNAVAILABLE` when Edge is dead, controller notes attached; usage text points new usage to `speech_synthesis` | registry.ts:265–281 | §4.5 case 3 |
| 9 | **Fail-artifact gating** (RC-2/B-F13) | `speech_synthesis` no longer registers fail-verified output as an ordinary artifact — `VERIFICATION_FAILED` ⇒ registration skipped/marked with `reason: 'language_verification_failed'` | tools/audio.ts:466–475 | controller reject locked (REG-20i); tool-gate unit = documented follow-up (t20 header) |
| 10 | **Locale dimension bn-BD/bn-IN** (RC-8) | `SpeechLocale` exists; unsupported/inconsistent locale ⇒ typed `UNSUPPORTED_LOCALE`, never silent substitution | language_controller.ts:679–680 | REG-20f (t20:187) |
| 11 | **Verdict honesty at aggregation** (RC-9) | Fail-verified lines are subtitle-only with honest notes and counted separately ("Nটি লাইন TTS-ফেরত" — never "N/N সফল" with a fail inside); the film headline verdict factors speech verification ("কার্যকর, তবে সতর্কতা: …") | short_film.ts:1124–1129, 1979–1984 | REG-21a (t21:284) |
| 12 | **Test wave** (E-F06 refined) | t1 REG-1a/b/c/f/g **rewritten as a strengthening** (the old REG-1a had enshrined the flawed bn→jam fallback contract) + new REG-1h/1i; t8 REG-8b/c/d/f/g rewritten (bn = honest failure, en = legitimate fallback); **new t20** (9 tests — §4.5 cases with the two REAL DB transcripts promoted to a tracked fixture `tests/fixtures/language/defect-a-transcripts.json`); **new t21** (2 tests — P0 pipeline gate + overflow/timing contract). Final gate 185/185 | t1/t8/t20/t21 headers | full suite |

---

## 4. §4.5 coverage table — OLD → NEW (14 cases)

OLD column = findings-b §8 at `c7927f7`. NEW = post-R-FIX tree + Wave-4 live evidence.

| # | §4.5 case | OLD | NEW | Lock / note |
|---|---|---|---|---|
| 1 | Bengali voice success | MISSING (unit) / BLOCKED (live) | **EXISTS (unit) / BLOCKED-live today** | REG-1h (t1:301): bn + Edge-neural healthy audio ⇒ verdict `pass` (Bengali-trained voice). Live: Edge WSS down at Wave-4 — bn success not catchable today (§5, §6) |
| 2 | Bengali voice unavailable | MISSING | **EXISTS (+ live)** | REG-1a/1f (typed `VOICE_UNAVAILABLE`); live Wave-4 rejection (§5) |
| 3 | English voice requested for Bengali | PARTIAL | **EXISTS** | REG-20e (mixed-script ⇒ `LANGUAGE_MISMATCH`, never silently read) + REG-1d (preference upgrade) + `text_to_speech` now controller-routed (fix #8) |
| 4 | Chinese-script ASR output | MISSING | **EXISTS** | REG-20a — the REAL `speech-bn-jam` transcript fixture ⇒ other-script + repetition + similarity-0 ⇒ `fail` |
| 5 | 0% similarity | MISSING | **EXISTS** | REG-20a/b (bn similarity-0 ⇒ fail; en 0.57-class garbage can never reach `pass`) |
| 6 | Partial/empty transcript | MISSING | **EXISTS** | REG-20c (empty ⇒ fail "no clear speech"), REG-20d (partial ⇒ loud fragmentation note) |
| 7 | Edge 403 → compatible fallback | **EXISTS — but locked the flaw** (REG-1a asserted fallback to jam) | **EXISTS (correct contract)** | REG-1a rewritten: Edge 403 on bn ⇒ typed `VOICE_UNAVAILABLE`, no cross-language fallback; en path keeps legitimate fallback (REG-8b) capped at `warn` (REG-1i) |
| 8 | Persistent 403 → bounded attempts | PARTIAL | **PARTIAL — B-F11 still open** | Controller level locked (REG-1a/1g; REG-8g "exactly one real call per chunk, loop always terminates"); **adapter-level ws-mock units (3-attempt retry, clock-skew learning, segment split, health cache) remain a documented follow-up** (t20 header) |
| 9 | Multi-line speech, one line fails | PARTIAL | **EXISTS** | REG-21a (pipeline P0 gate: fail line subtitle-only, honestly counted, verdict loses "চমৎকার") + t19 |
| 10 | English TTS regression | PARTIAL | **EXISTS (+ live)** | REG-1i + REG-20b; Wave-4 live en control: pass at similarity 1.0 / token coverage 8/8 (§5) |
| 11 | Unsupported locale | MISSING | **EXISTS** | REG-20f (`UNSUPPORTED_LOCALE`, no silent bn-IN↔bn-BD substitution) |
| 12 | Wrong-language output artifact registration | MISSING | **EXISTS at controller / PARTIAL at tool** | Chain rejection locked (REG-20i, REG-1b); tool-level fail-artifact marking implemented (tools/audio.ts:466–475) — its dedicated unit test is the documented follow-up |
| 13 | UI status & user-facing error | PARTIAL | **PARTIAL (strengthened)** | Verdict wording locked end-to-end (REG-21a), health-conditioned claims, `ParsedResult.notes` rendering; DOM-level UI tests still absent (suite-wide no-DOM limitation, tests/README.md:62–75) |
| 14 | Provider metadata & locale consistency | MISSING | **EXISTS** | REG-20g/h (requestedVoice/actualVoice/engine/locale on verification) + REG-21b (pipeline-persisted provenance) |

**Tally:** OLD — 0 full EXISTS (case 7 existed but locked the flawed contract), 5 PARTIAL, 8 MISSING. NEW — **10 EXISTS** (2, 3, 4, 5, 6, 7, 9, 10, 11, 14; case 1 at unit level), **3 PARTIAL** (8, 12, 13), case 1 live-half still blocked by Edge availability today. Every remaining gap is explicitly documented in test headers rather than hidden.

---

## 5. Live Wave-4 proof (Layer D — user-authorized minimal backtest, 2026-10-16T22:21:40Z)

Source: `/tmp/r-wave4/evidence-tts.json` (+ bn-sample.wav / en-sample.wav). Executed through the **real controller** (`synthesizeVerifiedSpeech`), not mocks.

- **Edge health probe:** WSS connection failed — "Edge TTS সংযোগ-ত্রুটি: WebSocket connection to 'wss://speech.platform.bing.com/consumer/speech/synthesiz…'" — Edge down again today.
- **bn line → rejected, honestly.** Outcome `rejected`, `SpeechSynthesisError[VOICE_UNAVAILABLE]`, `attempts: 1`, message = §4.2's exact wording: "VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale. (বাংলা-প্রশিক্ষিত কণ্ঠগুলো — Microsoft Edge-নিউরাল bn-BD/bn-IN — এই মুহূর্তে পৌঁছানো যাচ্ছে না: …; z-ai কণ্ঠ বাংলা পড়তে পারে না বলে ভুল-ভাষার নীরব ফলব্যাক নিষিদ্ধ — §৪.২)". **This exact situation produced Chinese garbage in the 2026-10-16 real run; it now produces one typed rejection with zero wrong-language synthesis.**
- **en control (tongtong) → verified pass.** Real SDK TTS (241,296-byte WAV) + real ASR round-trip: transcript exactly "The rain today feels quite good and soothing.", `similarity: 1`, tokenCoverage **8/8**, verdict `pass`, note "ASR রাউন্ড-ট্রিপ সাদৃশ্য ও শব্দ-আবৃত্তি দুটোই যথেষ্ট — ইংরেজি কথা নিশিত।" — live proof that the B-F05 hardening (token coverage + dual condition) still passes genuine English.
- **Cost ledger (worklog R-WAVE4):** Edge probe free (Microsoft); z-ai — 1×TTS(en) + 1×ASR. Minimal, documented.

---

## 6. Honest remaining limits

1. **Bengali pronunciation ultimately needs human review.** ASR cannot transcribe Bengali (no bn support — `zai.audio.asr.create` takes `file_base64` only, no language param), so no machine check can *validate* Bengali pronunciation. The bn+Edge path's verdict is duration-based with the standing advisory "বাংলা কণ্ঠ-যাচাই: ASR বাংলা বোঝে না — রায় 'সতর্কতা'; প্রিভিউ শুনে নিশিচত করুন (§২)" (short_film.ts:1116–1119). The gate is now honest and fail-closed — it is not, and cannot be, a pronunciation validator.
2. **Edge availability is environmental, not code.** Worked 2026-10-13 (E2E 17.9 s MP3) → persistent 403 in the real run (2026-10-16 18:55–19:18Z) → WSS-down at the Wave-4 probe (2026-10-16 22:21Z). Unofficial endpoint, no SLA; the code's handling is bounded (3 attempts/segment, 30 s timeout, engine-death marking) and the raw error is surfaced verbatim.
3. **§4.5 case 1 (live bn success) could not be captured today** because Edge is unreachable — recorded as an honest limit, not papered over (worklog R-WAVE4). Capturing it requires Edge reachable + user authorization for a live voice-validation run (Layer-D sheet, Audit E).
4. **B-F11 open:** adapter-level `ws`-mock units for the Edge 3-attempt retry budget, clock-skew learning, binary-frame split, and health-cache — the "no infinite 403 retry" property is locked at controller level only.
5. **en Edge voices have never been synthesis-verified live** (the real run's en round-trips fell through to z-ai).

---

## 7. Verdict

**Critical Defect A is fixed at root, regression-locked, and live-proven on both halves that were provable today.** Pre-fix, the bn path was honest at the *note* level and dishonest at every *decision* level (silent cross-language fallback RC-1, no verdict gate RC-2, blind verifier RC-3/RC-4, false provenance RC-5, static claims RC-6, tool bypass RC-7, no locale RC-8, warn≡success RC-9). Post-fix: the bn chain is Edge-only and capability-tagged fail-closed; `VOICE_UNAVAILABLE` exists with §4.2's exact message and fired live today; verification exhaustion rejects (`VERIFICATION_FAILED`); the verifier sees other scripts, repetition and bn similarity; en requires token coverage and caps fallback results at `warn` (live 1.0/8-8 pass); provenance records requested + actual voice; claims are health-conditioned with persisted per-voice verification records; the legacy tool goes through the controller; fail output is gated from artifact registration; the locale dimension exists. What remains is **environmental** (Edge availability) and **human** (Bengali pronunciation review) — neither closable by code, both now stated openly instead of silently degraded.

*No git mutations; no source/test modifications in this documentation task; evidence files cited read-only.*
