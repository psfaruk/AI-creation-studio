# Recovery Audit B — Bengali TTS / Language Integrity (Critical Defect A)

- **Task ID:** R-B (relaunch; first attempt died on infrastructure error, produced nothing)
- **Agent:** Recovery Audit B — Bengali TTS / Language Integrity Specialist
- **Baseline:** HEAD `c7927f7`, clean tree. Read-only audit; the only writes are this file + the worklog append.
- **Master prompt:** `/home/z/my-project/upload/Pasted Content_1792178693713.txt` §4 (all), §7, §8 TTS group.
- **Method:** full reads of `src/lib/agent/audio/{language_controller,edge_tts,bn-text-normalizer,bn-pronunciation-dictionary}.ts`, `src/lib/agent/{sdk-helpers,tts-cache,registry,capabilities,availability-matrix,model-registry-data}.ts`, `src/lib/agent/tools/audio.ts`, `src/lib/agent/production/pipelines/{audio,short_film,motion_video,voiceover}.ts`, `node_modules/z-ai-web-dev-sdk/{dist/index.d.ts,README.md}`, `skills/TTS/SKILL.md`, `skills/podcast-generate/readme.md`, `tests/regression/t1*,t8*`, `tests/README.md`, worklog (incident lines + R-A1/A2/C/D/E entries). Plus one read-only DB pass (`bun:sqlite`, readonly) over `Artifact` rows for `speech-*`, `dialogue-*`, `narration-*`, and one permitted test run: `bun test tests/regression/t1-bengali-tts-fallback.test.ts` → **7/7 PASS (29 expects, 1.38s)**.
- **Built on (not redone):** Audit E's artifact forensics (mvbbyh49/mvbbynz7 = speech-bn-jam, mvbbz23v = speech-en-tongtong, transcripts + similarity), E-F04 (dishonest dialogue metaJson voice), E-F06 (§4.5 coverage gap), Audit D's real-run trace (cmvbbv86c000apzrc9mra61oi: fail-verdict dialogue line still mixed). All re-verified from code + DB in this audit; deltas noted.

---

## 1. §4.1 Voice Registry — every voice the app can select

Selection surfaces: `LANGUAGE_PROFILES` (language_controller.ts:62–87) → `resolveVoice` (:130–140) → `assignCharacterVoices` (:146–157) → UI `VOICE_OPTIONS` (production-card.tsx:381–396) → `text_to_speech` tool enum (registry.ts:267).

| # | Voice ID | Provider / adapter | Declared locale | Claimed languages (where) | Evidence source for the language claim | Availability status | Ever synthesis-verified? | Pronunciation validated? | Last verified |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `tongtong` | z-ai SDK `zai.audio.tts.create` via `synthesizeSpeech` (sdk-helpers.ts:127–178) / tts-cache dispatcher (tts-cache.ts:128–135) | none in SDK (`voice?: string`, index.d.ts:78–85) | en profile member (language_controller.ts:79); UI label "tongtong (z-ai)" (production-card.tsx:391); **default voice of `text_to_speech` tool (registry.ts:267) and of `cachedSynthesizeSpeech` (tts-cache.ts:145)** | **None in SDK/skill docs.** skills/TTS/SKILL.md:185 lists 7 voices with no languages; SDK README examples are Chinese ("你好，世界！", README.md:174); podcast skill persona 温暖亲切 (readme.md:144). App's own 2026‑10‑11 probe (worklog:353): tongtong "reads" Bengali in 2.4–2.7 s = **cannot read Bengali** | SDK live/healthy | Yes (en round-trip works; bn probe says NO) | en: yes via ASR; bn: no | 2026-10-11 probe (worklog only; no fixture) |
| 2 | `chuichui` | same | none | en profile member (:79) | None documented; Chinese persona 活泼可爱 (podcast readme.md:143); bn probe: forbidden (2.4–2.7 s garbage) | live | bn probe only (negative) | no | 2026-10-11 |
| 3 | `xiaochen` | same | none | en profile member (:79) | None documented; Chinese-named persona; bn probe: forbidden | live | bn probe only (negative) | no | 2026-10-11 |
| 4 | `jam` | same | none | **bn emergency fallback (language_controller.ts:68, note :73)** + en fallback (:79); UI "jam — ইংরেজি (z-ai)" (production-card.tsx:389) | None in SDK. App probe: "English (British)" (:13), bn "possible" 10.1 s but ASR can't verify (worklog:353). **DB proof it is NOT Bengali-capable:** speech-bn-jam transcripts are Chinese character repetition ("可真的，可真的，踢踢踢…", similarity 0) | live | Yes — and the verification **proved wrong-language output** yet verdict was `warn` (see B-F04) | no (structurally impossible — ASR has no bn) | 2026-10-11 probe + real-run 2026-10-16 (DB) |
| 5 | `kazi` | same | none | en profile member (:79) | None documented; Chinese persona 清晰标准 (podcast readme.md:146) | live | no | no | — |
| 6 | `douji` | same | none | **bn emergency fallback (language_controller.ts:68)** + en member (:79) | None documented; Chinese persona 自然流畅 (podcast readme.md:147); bn probe 35 s file (ASR 30 s limit — unmeasurable) | live | no | no | 2026-10-11 (inconclusive) |
| 7 | `luodo` | same | none | en profile member (:79) | None documented; Chinese persona 富有感染力 (podcast readme.md:148); bn probe: forbidden | live | no | no | 2026-10-11 |
| 8 | `bn-BD-NabanitaNeural` | Microsoft Edge neural (unofficial ReadAloud WSS) via `synthesizeEdgeSpeech` (edge_tts.ts:343–389) + tts-cache dispatcher | bn-BD (edge_tts.ts:53–59) | bn primary (language_controller.ts:68; availability-matrix.ts:65; capabilities.ts:475) | **In-repo: only the code's own assertion** ("সত্যিই বাংলা-প্রশিক্ষিত", edge_tts.ts:7–8) + one 2026‑10‑13 E2E (worklog:1010: 17.9 s MP3, verdict যাচাইকৃত) — DB/worklog only, **no tracked fixture, no transcript evidence**; the voice IDs themselves are genuine Microsoft bn-BD catalog names | **Unstable:** worked 2026‑10‑13; **persistent 403 in the real production run** (DB fallback notes: "Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403" on every speech artifact of cmvbbv86c…) | Once (2026-10-13, E2E) | **Never** — bn+Edge path skips ASR by design (language_controller.ts:280, 302–307); verdict `pass` on duration alone | 2026-10-13 (unpersisted) |
| 9 | `bn-BD-PradeepNeural` | same | bn-BD (:60–67) | bn #2 (:68) | same as #8; zero probe evidence in repo | same (403 same run) | never | never | — |
| 10 | `bn-IN-TanishaaNeural` | same | bn-IN (:68–75) | bn #3 (:68) | same | same | never | never | — |
| 11 | `bn-IN-BashkarNeural` | same | bn-IN (:76–83) | NOT in bn profile chain; only `assignCharacterVoices` (language_controller.ts:148) | same | same | never | never | — |
| 12–15 | `en-US-AriaNeural`, `en-US-GuyNeural`, `en-GB-SoniaNeural`, `en-GB-RyanNeural` | same | en-US/en-GB (:84–115) | en profile heads (:79) | Genuine MS voice IDs; no in-repo probe | same 403 instability | never (en round-trips in the real run fell through to z-ai) | never | — |

**Registry-level verdict:** of 15 selectable voices, **zero have in-repo, tracked evidence of Bengali synthesis + pronunciation correctness**. The only bn-capable candidates (4 Edge voices) are (a) reached through an unofficial, unstable endpoint and (b) never pronunciation-validated even when reachable (ASR skip by design). No per-voice availability status, synthesis-test status, or last-verified timestamp is persisted anywhere (§4.1's required record fields do not exist as data — only as prose in comments/worklog).

## 2. SDK reality (node_modules/z-ai-web-dev-sdk)

- `dist/index.d.ts:78–85` — `CreateAudioTTSBody { model?, input, voice?: string, stream?, response_format?, speed? }`. **No locale/language parameter, no voice enum, no voice catalog endpoint.** `audio.tts.create` (:190–193) returns `any`.
- README.md:163–210 — the only TTS documentation; example input is Chinese; no per-voice language table anywhere in the package.
- The 7-voice list the app uses is hand-copied from `skills/TTS/SKILL.md:185` ("Available voices: tongtong, chuichui, xiaochen, jam, kazi, douji, luodo") — sdk-helpers.ts:116–117 says "সম্পূর্ণ কণ্ঠ-তালিকা (TTS স্কিল-ডকুমেন্ট থেকে যাচাইকৃত)" but the skill doc contains **zero language claims to verify against**.
- The app adapter passes: `input` (normalized Bengali text for z-ai voices — bn-text-normalizer with `phoneticEnglish:true`, language_controller.ts:407–411), `voice` id, `speed`, `response_format:'wav'` first (mp3 fallback on 400/1214, sdk-helpers.ts:160–170). No language hint is possible — the SDK has none.
- **Answer to "is there ANY Bengali-capable voice in the SDK": NO.** No SDK voice is documented or probed as Bengali-capable; the app's own probe (worklog:353) concluded "কোনো কণ্ঠই বাংলা-প্রশিক্ষিত নয়", and the real-run DB evidence shows jam producing Chinese character garbage for Bengali input.
- ASR (`zai.audio.asr.create`, index.d.ts:86–91,194–196): `file_base64` only, no language param — consistent with "ASR বাংলা বোঝে না" (language_controller.ts:8–9,15).

## 3. Edge TTS adapter (src/lib/agent/audio/edge_tts.ts)

- **Auth mechanism (reverse-engineered, :226–267):** WSS `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1` with query `TrustedClientToken` (hardcoded public constant, :29), `Sec-MS-GEC` = SHA256(5-min-floored Windows-epoch ticks + token) (:138–144, with learned clock skew :136,146–159), `Sec-MS-GEC-Version`, plus headers Origin `chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold`, Chrome/Edge UA, `Cookie: muid=<hex>` (:235–248). Binary frames split on `"\r\nPath:audio\r\n"` (:302–307).
- **Voice list source:** hardcoded 8-entry registry (:51–116). It does NOT fetch Microsoft's voice list; bn-BD-PradeepNeural / bn-BD-NabanitaNeural / bn-IN-* are all present in code and reachable in the sense that `synthesizeEdgeSpeech` will attempt them — the 403 happens at the WSS handshake, before any voice-specific processing.
- **Why 403:** the server rejects the handshake. The code's only theory is clock skew (learned from the 403's Date header, :146–159,311). Persistent 403 (real run: every Edge attempt across the whole production) means the rejection is environmental (datacenter IP block / DRM scheme change), not clock — the code cannot distinguish, and honestly reports the raw message. It worked on 2026‑10‑13 and 403'd in the real run ⇒ availability is **unstable/undocumented**, an unofficial endpoint with no SLA.
- **403 classification & boundedness:** `synthesizeSegment` failures → per-segment retry loop of exactly **3 attempts** with 800 ms/2 500 ms waits (:359–370), 30 s WS timeout (:205,266), then a throw carrying "অংশ i/n ব্যর্থ" (:371–378). In `language_controller` the throw marks the whole `edge` engine dead (deadEngines, :420–428) and remaining Edge voices are skipped (:400–401). **No infinite retry — confirmed.** (Internals untested — B-F11.)
- **Health check:** `edgeTtsHealth` (:398–415) does a live 1-word synthesis with Nabanita, caches 5 min, and is surfaced **only** at owner-gated `GET /api/system` (route.ts:25–34). It gates nothing.

## 4. §4.2 Language selection rules — where they live, what holds, what breaks

| Rule (§4.2) | Where | Status |
|---|---|---|
| bn text → Bengali-capable voice | LANGUAGE_PROFILES bn (language_controller.ts:62–75) + resolveVoice (:130–140) | **Holds only while Edge is alive.** When Edge 403s, the chain silently crosses into jam/douji — NOT Bengali-capable — with no locale-compat check (B-F01). |
| bn-IN must not silently become bn-BD | n/a at request level: `SpeechLanguage = 'bn' \| 'en'` only (types.ts:551; tools/audio.ts:419) | No locale input exists. But the bn profile silently mixes bn-BD + bn-IN voices in one chain (:68) and `assignCharacterVoices` hands out bn-IN-Bashkar without locale preference (:148) — a silent cross-dialect fallback with no record of which locale was used (B-F10). |
| English voice must not read Bengali as "success" | synthesizeVerifiedSpeech warn-verdict branch (:322–331) | verdict is honest `warn` at line level, **but warn is treated as success** everywhere downstream (:459; short_film mix :1239; voiceover.ts:94–100) — B-F01/B-F09. Worse, the raw `text_to_speech` tool has no language logic at all (registry.ts:263–314, B-F08). |
| Chinese/other-script output ⇒ Bengali validation fail | detectLanguage (:101–112) counts only Bengali (0980–09FF) + Latin letters | **Broken.** CJK is invisible: the Chinese garbage transcript "可真的，…踢B T" classified as `detectedLanguage: "en"` (DB, speech-bn-jam) and the verdict stayed `warn` (B-F04). |
| Romanized Bengali ≠ acceptable output | — | No check exists. Live false positive: speech-en-tongtong got verdict `pass` ("ইংরেজি কথা নিশিত") on similarity 0.57 with a romanized-Bengali transcript (DB; B-F05). Note: bn-text-normalizer never romanizes Bengali (safety valve bn-chars >40% lost → revert, bn-text-normalizer.ts:24, and `phoneticEnglish` only respells *English* words INTO Bengali) — this rule is safe on the input side. |
| VOICE_UNAVAILABLE if no verified Bengali voice | grep: zero matches for VOICE_UNAVAILABLE anywhere in src/ | **Does not exist.** All-engines-dead rejection exists (:464–471) but covers only hard throws; "no bn-capable voice reachable" is not a state (B-F03). |
| Script/language check on OUTPUT before artifact registration | verifySpeechBuffer (:247–356) runs before registration and lands in metaJson | Checks exist but **do not gate** registration or mixing (B-F02/B-F13). |

Positive §4.2 behaviors that hold: script-language mismatch throws before synthesis (:371–378); the voiceover pipeline auto-corrects language to the detected script with an honest note (pipelines/audio.ts:146–158); a bn request with a z-ai voice preference is "well-meaning upgraded" to the bn neural primary (resolveVoice :134–136, locked by REG-1d); the short-film LLM prompt mandates the script language and a one-shot detect+rewrite fixes wrong-language dialogue (short_film.ts:237, 320–368).

## 5. §4.3 Fallback chain — item by item

- **Per-attempt timeout:** Edge 30 s/segment (edge_tts.ts:205,266); z-ai 20 s/attempt ×3 with 90 s channel budget (sdk-helpers.ts:150–155). ✔
- **Bounded retry:** Edge 3/segment; z-ai withRetry 3; engines marked dead, skipped engine-aware; chain length bounded by profile (bn 5, en 7). ✔ (REG-1a/1b/1g + t8 lock the controller level; t1 re-run 7/7 at HEAD.)
- **Provider-specific error classification:** partial. 403 is surfaced verbatim and treated as engine-fatal (good), but 403 vs 401 vs network vs DRM-scheme is not distinguished; clock-skew learning only on 403/401 (edge_tts.ts:311). Acceptable.
- **Persistent 403 → no infinite retry:** ✔ (above).
- **Next-provider locale compatibility:** ✘ **NOT CHECKED — the core catastrophe.** `deadEngines` skip is engine-aware only; nothing checks that the next voice can speak the language (language_controller.ts:393–429). bn + Edge-dead ⇒ jam reads Bengali ⇒ garbage ⇒ `warn` ⇒ accepted. (B-F01.)
- **Per-line success/failure persistence:** partial. short_film keeps per-line artifacts with verification metaJson (:856–883), partialNotes on TTS-throw (:834–839) and on warn/fail verdicts (:894–908); `verificationSummaries` land in the final film metaJson (:1548). But per-line FAIL does not change the line's fate (B-F02) and the top-line result stays "চমৎকার" (B-F09).
- **Language verification before final artifact:** ✘ fail-verdict audio is still mixed (B-F02) and wrong-language artifacts are still registered (B-F13).
- **Partial-output honesty:** partialNotes + labels exist (motion_video voiceoverLabel :669–674; short_film "শুধু সাবটাইটেলে থাকবে" path :836–838) — but only for *synthesis throws*, not for verification failures, and the UI card's headline verdict doesn't reflect them.

## 6. §4.4 ASR / language verification — what exists vs what's demanded

Exists today (`verifySpeechBuffer`, language_controller.ts:247–356):
1. **Script plausibility:** ✘ `detectTranscriptLanguage` (:205–208) delegates to `detectLanguage` (:101–112) which sees only Bengali + Latin. CJK/Devanagari/Arabic are invisible; Chinese garbage → `'en'` (if any latin chars present) or `'unknown'`.
2. **Normalized similarity:** partial — en: Jaccard+trigram max (:163–196) with an unjustified 0.5 pass threshold (:312); bn: transcript Bengali-char ratio (:198–202) — structurally ~0 for *both* good and bad audio because ASR can't transcribe Bengali, and **the bn similarity value is never used in the verdict** (:322–331 checks only detectedLanguage bn/silence).
3. **CJK / unrelated-language detection:** ✘ absent (B-F04).
4. **Empty/repeated/truncated transcript:** empty→`'silence'`→fail (:328–331) ✔ (untested); **repetition detection absent** — the DB garbage transcripts are literally repeated tokens ("可真的，可真的，踢踢踢…"); truncation only via duration ratio (:293–298).
5. **Bengali punctuation/Unicode normalization/ASR variation tolerance:** ✘ none for bn (en normalization exists, :163–169).
6. **Verification limitations documented:** ✔ honestly and repeatedly (comments :6–15; profile asrSupport 'weak'; short_film warn note :896–899; availability-matrix cap-transcription :83). Threshold rationale/validation evidence: ✘ the 0.5 en threshold has none (B-F05).

**The fail-verdict-still-mixed path (real run, Audit D):** the missing gate is in `short_film.ts` — after `synthesizeVerifiedSpeech` returns, the code never inspects `out.verification.verdict` (:810–812); a FAIL line is written to disk (:843–846), pushed into `timedLines`, registered as an artifact (:856), and every `timedLines` entry with a `filePath` is mixed into the A1 dialogue timeline (:1239–1247) regardless of verdict. `synthesizeVerifiedSpeech` itself returns the last (failing) result when the chain exhausts (:464–472), so callers MUST gate — none do (short_film, audio pipeline :188–207 only notes, tools/audio.ts:447–474 registers). DB proof: `dialogue-2-studio.wav` verdict `fail` (10.6 s vs 1.5 s expected, similarity 0) — mixed into the final film.

## 7. Findings register

Severity: P0 = Bengali-integrity broken in production path; P1 = dishonest/unsound verification or metadata; P2 = bypass or aggregation gap; P3 = hygiene.

---

### B-F01 (P0) — Language-incompatible fallback: bn chain crosses engines into non-Bengali voices with no locale-compat check
- **Where:** `src/lib/agent/audio/language_controller.ts:68` (bn profile includes `jam`, `douji` as "জরুরি-ফলব্যাক"), `:73` (note admits they are not Bengali-trained), `:400–429` (deadEngines skip checks engine only — never the next voice's language capability).
- **Evidence:** real run cmvbbv86c… — every speech artifact carries "ইঞ্জিন-ফলব্যাক ব্যবহার হয়েছে — আগের ইঞ্জিন ব্যর্থ (…403)" and the actual voice jam/douji; transcripts = Chinese garbage, similarity 0 (DB, read-only). App's own probe had already established no z-ai voice is Bengali-trained (worklog:353; language_controller.ts:6–12 comments).
- **Why it matters:** §4.2 — "English voice দিয়ে বাংলা লেখা পড়িয়ে সেটিকে Bengali success বলা যাবে না"; this is the exact observed catastrophe. The fallback is *designed* to violate it.
- **Minimal fix:** per-voice `bnCapability: 'verified' | 'none'` in the profile; when the engine holding all bn-capable voices dies, throw `VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale` (§4.2 wording) instead of continuing into z-ai; keep jam/douji only behind an explicit, labeled degraded mode (or drop them from the bn profile entirely).
- **Regression locks:** §4.5 cases 2, 3, 7 (re-written: fallback must be locale-compatible or honestly fail), 11.

### B-F02 (P0) — No verdict gate: FAIL-verified audio is still registered, mixed, and the film reports "চমৎকার"
- **Where:** `src/lib/agent/production/pipelines/short_film.ts:810–812` (return value consumed without checking `verification.verdict`), `:843–846` (fail line → timedLines + done++), `:856–883` (artifact registered), `:1239–1247` (all filePath lines mixed into A1), `:1560–1564` (final verdict derived only from technical `problems`); enabler: `language_controller.ts:459–472` (chain-exhaustion returns the failing `lastResult` instead of rejecting).
- **Evidence:** DB `dialogue-2-studio.wav` — verdict `fail`, "অডিওর দৈর্ঘ্য অস্বাভাবিক দীর্ঘ — কণ্ঠটি স্ক্রিপ্ট সঠিকভাবে পড়তে পারেনি", still in the 30.000 s final film (Audit D Layer-C). Also `tools/audio.ts:459–474` registers the artifact unconditionally (B-F13).
- **Why it matters:** §4.3 "final artifact তৈরির আগে ভাষা যাচাই" — the only real gate the spec demands is missing; a user hears 10.6 s of garbage where a 2-word Bengali line should be, under a "চমৎকার" headline.
- **Minimal fix:** (a) `synthesizeVerifiedSpeech` should reject (typed error) when the whole chain fails verification — mirroring the engines-dead rejection; (b) short_film must treat a fail verdict exactly like the existing TTS-throw path (:834–839: subtitle-only, partialNotes) and factor `verificationSummaries` into the final verdict string.
- **Regression locks:** §4.5 cases 9, 12, 13.

### B-F03 (P0) — VOICE_UNAVAILABLE state does not exist anywhere
- **Where:** grep `VOICE_UNAVAILABLE|VoiceUnavailable|voice_unavailable` in `src/` → 0 matches. Closest state: all-engines-dead reject `language_controller.ts:464–471` (covers hard throws only, not "reachable engines have no bn-capable voice").
- **Why it matters:** §4.2 explicitly requires this honest state; without it the system structurally cannot tell the user "there is currently no verified Bengali voice" — it can only emit garbage with a warn label.
- **Minimal fix:** implement as part of B-F01 (one branch: profile has no reachable bn-capable voice → typed VOICE_UNAVAILABLE error surfaced in UI + step detail).
- **Regression locks:** §4.5 cases 1 (unavailable variant), 2, 13.

### B-F04 (P1) — bn verification is blind to wrong-language output: no CJK/unrelated-script detection, no repetition check, similarity computed but unused
- **Where:** `language_controller.ts:101–112` (detectLanguage sees only Bengali+Latin), `:198–202` (bn similarity = Bengali-char ratio of transcript), `:322–331` (bn+z-ai verdict: `warn` unless `silence`; similarity and non-bn scripts ignored).
- **Evidence:** DB speech-bn-jam — transcript "可真的，可真的，踢踢踢，忙的，踢踢踢，踢B T" → `detectedLanguage: "en"` (the two Latin letters "BT"), `similarity: 0`, verdict `warn`, mixed into an artifact labeled `languageLabel: "বাংলা"`.
- **Why it matters:** §4.4 items 1, 3, 4 — precisely the checks the master prompt demands after this exact evidence; without them `warn` is indistinguishable from "probably fine".
- **Minimal fix:** extend transcript language detection with CJK (and general non-Bengali/non-Latin) script classes → `detectedLanguage: 'other-script'` ⇒ verdict `fail` for bn; add trivial repetition detection (top token frequency / n-gram loop); use `similarity === 0 && transcript non-empty` ⇒ downgrade to `fail` (or at minimum a loud note) for bn.
- **Regression locks:** §4.5 cases 4, 5, 6 (promote the two DB transcripts to fixtures per Audit E's recommendation).

### B-F05 (P1) — en path false positive: unjustified 0.5 similarity threshold passed a romanized-Bengali garbage read as "English confirmed"
- **Where:** `language_controller.ts:311–314` (`similarity >= 0.5 && detectedLanguage === 'en'` ⇒ `pass`, "ASR রাউন্ড-ট্রিপ সাদৃশ্য যথেষ্ট — ইংরেজি কথা নিশিত"), `:195` (trigram×0.95 inflation).
- **Evidence:** DB speech-en-tongtong — transcript "Shubhoh bioya no tan bochar shukho, sumridhi ar shashti din niy asak." (romanized Bengali), similarity **0.57**, verdict **`pass`**, with a simultaneous engine-fallback note (Edge was dead).
- **Why it matters:** §4.4 — "কোনো score threshold বানালে তার rationale ও validation evidence লিখবে" — none exists; and the live artifact proves the threshold certifies wrong audio as verified. `max(jaccard, trigram)` is dominated by substring overlap, so near-random romanizations pass.
- **Minimal fix:** require *both* meaningful token-level overlap (e.g. ≥50% of script tokens present in transcript) and the numeric similarity; when an engine-fallback note is present, cap the verdict at `warn`; document the threshold's validation basis or mark it advisory.
- **Regression locks:** §4.5 cases 5, 10.

### B-F06 (P1) — Dishonest provenance: artifact metadata names the requested Edge voice, not the actual fallback voice used (extends E-F04)
- **Where:** `short_film.ts:868` (dialogue metaJson `voice` = requested `characterVoices[…]`, not `out.voice` — `effectiveVoice` is tracked at :814/:832 but never written), `:757` (narration metaJson `voice` = `resolveVoice` output = requested), `:887` (verificationSummaries `voice` = requested). Contrast: the audio pipeline IS honest (`audio.ts:200,291` uses `synth.usedVoice`) and the speech tool is honest (`tools/audio.ts:465,471` uses `result.verification.voice`).
- **Evidence (read-only DB):** `dialogue-1-studio.wav` metaJson `voice: "bn-BD-NabanitaNeural"` while its own verification notes prove the Edge 403 fallback — the actual voice was jam/douji. Same for `dialogue-2` (requested Pradeep) and `narration-a5.wav` (Nabanita, actual z-ai).
- **Why it matters:** §4.5 case 14 (provider metadata/locale consistency) and basic provenance honesty — the metadata a reviewer would use to attribute the audio is wrong on every fallback path in the film pipeline.
- **Minimal fix:** record `requestedVoice` AND `actualVoice` (+ engine, from `out.voice`/verification) in every TTS artifact metaJson and in verificationSummaries.
- **Regression locks:** §4.5 case 14.

### B-F07 (P1) — Unconditional "Bengali neural voices active" capability claims; no availability/verification records behind them
- **Where:** `capabilities.ts:473–477` (pre-confirmation user-facing note asserts bn-BD neural voices are "সত্যিকারের বাংলা-প্রশিক্ষিত … চালু" unconditionally), `availability-matrix.ts:59–65` (`runtime: 'healthy'`, `overall: 'available_with_limits'`, honestNote claims active bn neural voices — static, never consults `edgeTtsHealth`), `production-card.tsx:381–396` (UI recommends Edge bn voices with no availability signal), `system/route.ts:25–34` (the only honest health surface, informational only).
- **Why it matters:** §4.1 requires availability status + synthesis-test status + last-verified per voice; the current claims are a stale snapshot of 2026‑10‑13 contradicted by the very next real run (403). Users are promised দেশীয় উচ্চারণ that then silently degrades to Chinese garbage.
- **Minimal fix:** persist a small per-voice verification record (voice, engine, verdict, transcript, at) written by verifySpeechBuffer/edgeTtsHealth; condition the capability notes on live health ("Edge সক্রিয় কালে"); show degraded state in the voice selector.
- **Regression locks:** §4.5 cases 1, 13, 14.

### B-F08 (P2) — `text_to_speech` raw tool bypasses the entire language-integrity layer
- **Where:** `registry.ts:263–314` — direct `zai.audio.tts.create`, default voice `tongtong` (:267), enum {tongtong, jam, kazi}, **no detectLanguage, no verification, no fallback chain, artifact registered with no language metadata**; usage text (:270) makes no language claim/warning.
- **Why it matters:** the agent-facing surface any LLM can call; a Bengali script through it yields guaranteed wrong-language audio counted as a plain success (pre-§2-era tool left in place). Violates §4.2 via the back door.
- **Minimal fix:** route through `synthesizeVerifiedSpeech` (language auto-detect already exists in `speech_synthesis`, tools/audio.ts:433–446), or deprecate the tool with an honest usage note pointing to `speech_synthesis`.
- **Regression locks:** §4.5 case 3 (e2e variant).

### B-F09 (P2) — `warn` is treated as success at every aggregation layer; film-level verdict ignores speech verification entirely
- **Where:** `language_controller.ts:459` (`verdict !== 'fail'` ⇒ accepted), `voiceover.ts:94–100` (warn chunks mixed, notes only), `motion_video.ts:669–674` (label only), `short_film.ts:1560–1564` (final "চমৎকার" = f(technical problems) only; `speechVerification` sits in metaJson :1548 but never in the headline).
- **Why it matters:** §4.3 — partial acceptance requires a UI partial status; today the only partial signals are `partialNotes` lines, and the headline verdict stays fully positive even with warn/fail speech.
- **Minimal fix:** aggregate verificationSummaries into the result verdict (e.g. "চমৎকার" ⇒ "কার্যকর, তবে সতর্কতা: ১টি সংলাপ-লাইনের ভাষা-যাচাই ব্যর্থ/অযাচাইত"); render a speech-status badge on the completed card.
- **Regression locks:** §4.5 case 13 (+9).

### B-F10 (P2) — No locale granularity: bn-BD/bn-IN conflated; silent cross-dialect fallback; per-line locale unrecorded
- **Where:** `types.ts:551` (`SpeechLanguage = 'bn' | 'en'`), `language_controller.ts:68` (bn profile mixes bn-BD + bn-IN voices in one ordered chain), `:146–157` (assignCharacterVoices distributes all four neural voices across characters with no locale preference), EDGE_VOICES locale field exists (:47) but is unused by selection.
- **Why it matters:** §4.2 asks locale-correct selection and non-silent locale decisions; today a bn request can silently be spoken by a bn-IN voice (or vice versa) with no record. (Both are Bengali — lower severity than B-F01, but it is an unmanaged dimension.)
- **Minimal fix:** add `locale?: 'bn-BD' | 'bn-IN'` to the spec/profile, prefer matching-locale voices, record per-line locale in the artifact metaJson.
- **Regression locks:** §4.5 case 11 (+14).

### B-F11 (P2) — Edge adapter internals untested: bounded 3-attempt retry, clock-skew learning, segment split, health check have zero unit coverage
- **Where:** grep `edge_tts|synthesizeEdgeSpeech|splitForEdge|edgeTtsHealth` in `tests/` → only `isEdgeVoice` imported (t1:35, t8:25) as a real routing helper; the engine is always fully mocked at the tts-cache boundary (t1:70–91, t8:41–59).
- **Why it matters:** §4.5 case 8 ("persistent 403 → bounded attempts") is only locked at the controller level; the adapter's own retry budget/timeout/skew logic — the piece that must not loop forever — is untested.
- **Minimal fix:** unit-test `synthesizeSegment` failure classification + the 3-attempt loop with a mocked `ws`, and `edgeTtsHealth` caching.
- **Regression locks:** §4.5 case 8 (full).

### B-F12 (P3) — Stale/incorrect registry prose: "ভাষা-নিয়ন্ত্রক … bn→jam/douji" and no Edge provider entry in the model registry
- **Where:** `model-registry-data.ts:222` (pre-2026-10-13 routing note, contradicts the current bn→Edge-primary chain), `:192–224` (platform-tts entry has no Edge/microsoft-edge-neural counterpart although it is the primary bn engine).
- **Why it matters:** the registry is the UI/agent-facing capability source; it describes a routing that no longer exists and omits the actual bn primary.
- **Minimal fix:** update the note; add a `microsoft-edge-neural` registry entry with honest availability wording.

### B-F13 (P3) — Wrong-language output is registered as a normal artifact with no rejected/degraded marker
- **Where:** `tools/audio.ts:459–474` (speech_synthesis registers the artifact regardless of verdict; verdict lives only in metaJson), mirrored in short_film per-line artifacts.
- **Why it matters:** §4.5 case 12 — "wrong-language output artifact registration" should be impossible or at least visibly flagged; today `speech-bn-jam.wav` (Chinese garbage) exists in the conversation as an ordinary audio artifact whose fileName even asserts the language (`speech-bn-…`).
- **Minimal fix:** on `fail`, either skip registration or register with `kind:'audio'` + `status:'language_verification_failed'` and a fileName that doesn't assert the language.

### B-F14 (P3) — Dialogue-language rewrite: silent acceptance if the one-shot rewrite still returns the wrong language
- **Where:** `short_film.ts:356–361` — the "ভাষা ভুল ছিল… পুনর্লিখিত" note is pushed only `if (reDet.language === language)`; when the rewrite returns the same wrong language (or a different count), nothing is recorded and the wrong-language lines proceed to TTS.
- **Minimal fix:** push an honest partialNote in the else-branch (and treat a still-wrong dialogue set per B-F02's gate).

### Positive findings (verified holding at HEAD)
- B-P1: bounded 403 handling — no infinite retry (edge_tts.ts:359–370; REG-1g green; t1 re-run **7/7 PASS** this audit).
- B-P2: engine-aware skip + honest exhaustion rejection (language_controller.ts:393–401, 464–471) — the Phase-2 P0-BUG-01 fix claims all hold in code and tests.
- B-P3: honest fallback notes travel with the result ("ইঞ্জিন-ফলব্যাক ব্যবহার হয়েছে…" — present in every DB artifact of the real run) and `verify:false` is honestly labeled ("যাচাই বন্ধ ছিল").
- B-P4: input-side language integrity is solid: mismatch throw (:371–378), voiceover auto-correct with note (audio.ts:146–158), bn z-ai-preference upgrade (REG-1d), LLM dialogue language mandate + detect/rewrite (short_film.ts:237,320–368), bn normalizer never romanizes (safety valve, bn-text-normalizer.ts:24).
- B-P5: tts-cache provenance is honest (voice+engine in meta, tts-cache.ts:108–116) and the cache key includes voice — no cross-voice poisoning.
- B-P6: ASR 30 s limit handled by 28 s chunking (sdk-helpers.ts:194–245).

## 8. §4.5 test-gap table (14 cases)

| # | §4.5 case | Status | Evidence / gap |
|---|---|---|---|
| 1 | Bengali voice success | **MISSING (unit) / BLOCKED (live)** | No test asserts the bn+Edge duration-healthy ⇒ `pass` branch (language_controller.ts:302–307); live Layer-D blocked (E's D1/D2 sheets). |
| 2 | Bengali voice unavailable | **MISSING** | VOICE_UNAVAILABLE state absent (B-F03). |
| 3 | English voice requested for Bengali | **PARTIAL** | REG-1d unit (resolveVoice upgrade) only; no e2e rejection; `text_to_speech` bypass untested (B-F08). |
| 4 | Chinese-script ASR output | **MISSING** | The observed defect; t1's ASR mock returns Bengali (t1:97). DB transcripts available as fixtures (Audit E §2.2). |
| 5 | 0% similarity | **MISSING** | No test exercises similarity 0 with non-silent transcript for bn or en. |
| 6 | Partial/empty transcript | **MISSING** | silence→fail code (:328–331) untested; empty chunk handling in transcribeBuffer untested. |
| 7 | Edge 403 → compatible fallback | **EXISTS — BUT LOCKS THE FLAW** | REG-1a (t1:130–154) asserts fallback to `jam` — an incompatible voice — i.e. the test enshrines B-F01's contract. Needs rewriting with B-F01. |
| 8 | Persistent 403 → bounded attempts | **PARTIAL** | REG-1g (controller exhaustion) ✔; adapter-level 3-attempt/skew/timeout untested (B-F11). |
| 9 | Multi-line speech, one line fails | **PARTIAL** | t8 8d/8e cover all-engines-dead per chunk; short_film partialNotes on throw; **fail-verdict-line exclusion untested because the gate doesn't exist** (B-F02). |
| 10 | English TTS regression | **PARTIAL** | No en-profile fallback walk, no similarity-threshold test; the 0.57 false positive (B-F05) unlocked. |
| 11 | Unsupported locale | **MISSING** | No locale concept to reject (B-F10); silent substitution (requested bn-IN-Bashkar → Nabanita) untested. |
| 12 | Wrong-language output artifact registration | **MISSING** | Registration never gated (B-F02/B-F13). |
| 13 | UI status & user-facing error | **PARTIAL** | verdictLabel units exist; no UI-level fail/partial status test (suite-wide no-DOM limitation, tests/README.md:62–75). |
| 14 | Provider metadata & locale consistency | **MISSING** | metaJson voice ≠ actual voice (B-F06) unlocked. |

Tally: full EXISTS 0 (case 7 exists but locks a flawed contract), PARTIAL 5 (3, 8, 9, 10, 13), MISSING 8 (1-unit, 2, 4, 5, 6, 11, 12, 14). Consistent with E-F06's "9 of 14" count; delta: this audit reclassifies case 7 from "covered" to "covered-but-defective" and case 9 to partial.

## 9. Root-cause register (numbered)

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

Root causes REFUTED / not confirmed:
- "Edge 403 is caused by a code bug (bad token/headers)" — refuted as a *root cause of Defect A*: the protocol worked on 2026‑10‑13 (worklog:1004–1010) and the 403 is an environment/provider-side rejection; the code's handling is bounded and honest. The defect is what the chain does *after* 403 (RC-1/RC-2).
- "The z-ai SDK has a Bengali voice we're failing to select" — refuted: SDK exposes no locale parameter and no Bengali-capable voice (§2 above).
- "ASR similarity is the gate and it's mis-tuned for bn" — partially true but not the root: for bn the similarity value is not even consulted in the verdict (RC-3); the deeper root is that no machine check can validate Bengali pronunciation with this ASR, which the code honestly documents — making VOICE_UNAVAILABLE/degraded-mode the only honest options (RC-1).

## 10. Defect A verdict

**CONFIRMED — Critical Defect A is real, reproduced in a user-initiated production run, and fully explained by RC-1 + RC-2 (+RC-3/4/5 amplifiers).** The evidence chain: persistent Edge 403 (DB notes on every speech artifact) → engine-aware skip lands on jam/douji which cannot speak Bengali (RC-1) → the garbage output is either `warn` (Chinese-script transcript invisible to the verifier, RC-3) or `fail` (duration) → in both cases it is registered and mixed with no gate (RC-2) → the film reports "চমৎকার" (RC-9) and the artifacts name the Edge voice that was never used (RC-5). The en sibling shows the same class of failure in the opposite direction (romanized garbage certified `pass` at similarity 0.57, RC-4).

**Is the current bn TTS path honest? No.** It is honest at the *note* level (fallback notes, warn labels, ASR-limitation disclaimers are all genuinely present and persisted) and dishonest at every *decision* level: language-incompatible fallback is chosen silently, verification verdicts don't gate anything, provenance is wrong, capability claims are stale absolutes, and one agent-facing tool bypasses the entire controller.

**The exact fix set that would make the bn path honest** (smallest set, in dependency order):
1. **VOICE_UNAVAILABLE state (RC-1/B-F03):** tag every profile voice with its verified language capability; when no bn-capable voice is reachable (Edge dead), `synthesizeVerifiedSpeech` rejects with the §4.2 message instead of falling to jam. If a degraded non-Bengali read is ever offered, it must be an explicit, user-visible opt-in mode labeled as transliteration-grade, never a fallback.
2. **Verdict gate (RC-2/B-F02):** verification-exhaustion rejects like engine-exhaustion does; short_film/audio/voiceover treat fail lines exactly like TTS-throws (subtitle-only + honest notes); artifact registration for fail outputs is blocked or explicitly marked `language_verification_failed`; the film headline verdict factors in speech verification.
3. **Output-language checks (RC-3/B-F04 + RC-4/B-F05):** script-class detection (CJK ⇒ `other-script` ⇒ fail for bn), repetition detection, similarity-0 handling, justified en threshold (or advisory-only), fallback results capped at `warn`.
4. **True provenance (RC-5/B-F06):** `requestedVoice` + `actualVoice` + engine on every TTS artifact.
5. **Health-conditioned claims + per-voice verification records (RC-6/B-F07):** persist verdict/transcript/last-verified per voice; capabilities/availability/UI notes become conditional on live health.
6. **Close the bypass (RC-7/B-F08):** `text_to_speech` through the controller or deprecated.
7. **Test wave (E-F06 refined, §8 table):** the 8 MISSING + rewrite of REG-1a's flawed lock + adapter-level 403 boundedness units; promote the two DB transcripts (speech-bn-jam, speech-en-tongtong) into tracked fixtures as Audit E recommended — they make cases 4/5/10 lockable offline at zero API cost.
8. Live Bengali-capability validation of the Edge bn voices (Layer D) remains **BLOCKED — LIVE PROVIDER NOT AUTHORIZED** until the lead obtains user authorization; no cost numbers are invented here.

## 11. Commands & evidence trail
- Test run (the one permitted): `bun test tests/regression/t1-bengali-tts-fallback.test.ts` → 7 pass / 0 fail, 29 expects, 1.38s.
- DB read: `bun:sqlite` readonly on `db/custom.db`, `Artifact` rows `speech-bn-jam` (×2), `speech-en-tongtong`, `narration-a5`, `dialogue-1-studio`, `dialogue-2-studio` (full metaJson quoted in §6/§7 evidence).
- No source/test modified, no provider/SDK calls, no browser, no git mutations, dev server untouched.
