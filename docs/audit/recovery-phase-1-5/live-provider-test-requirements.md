# Recovery Phase 1–5 — Live-Provider Test Requirements (Layer D) (R-DOC-3)

Layer D = real-provider acceptance evidence. Two states exist in this round, both recorded
honestly: **(a) a user-authorized minimal live backtest (R-WAVE4) was executed** through the
*fixed* code paths on 2026-10-16 ~22:21–22:23, and **(b) everything beyond that remains
BLOCKED / NOT RUN** with an authorization protocol below. No cost figure is fabricated —
usage/cost is **UNKNOWN** wherever the repo contains no pricing data (master §7 Layer D rule).

Authorization of record (worklog R-WAVE4): the user explicitly instructed
"তুমি নিজেই জেনারেট করে backtest করবে" ("you yourself generate and backtest") — that
authorized the minimal Wave-4 evidence collection and nothing more (no video generation, no
hosted lip-sync, no further spend).

## 1. What WAS run (R-WAVE4 — minimal, through the fixed controller)

Harness: two bun scripts driving the **real** controller code (not mocks).
Evidence directory: `/tmp/r-wave4/` — `tts-backtest.ts`, `vlm-review.ts`,
`evidence-tts.json` (TTS backtest record), `evidence-vlm.json` (VLM review record),
`en-sample.wav` (the real 241,296-byte en synthesis), `frame-1.jpg`, `frame-2.jpg`,
`frame-3.jpg` (the reviewed mid-frames). Note: there is intentionally **no `bn-sample.wav`**
— the bn line was *rejected* before synthesis, so no bn audio exists to preserve; the typed
rejection in `evidence-tts.json` is the evidence.

### 1.1 Edge health probe — FREE (Microsoft endpoint), result: DOWN

- `edgeHealth: { ok:false, note: "অনুপলব্ধ — Edge TTS সংযোগ-ত্রুটি: WebSocket connection to
  'wss://speech.platform.bing.com/consumer/speech/synthesiz…'" }` — the probe fails fast
  with the honest connection-error note; no crash, no hang.
- Evidence: `/tmp/r-wave4/evidence-tts.json` (top-level `edgeHealth`).
- Meaning: Edge TTS (the only bn-BD/bn-IN-capable engine in the registry) remains
  environmentally unreachable today — same class as the 2026-10-16 403s.

### 1.2 bn line → typed honest rejection — LIVE PROOF of the Defect-A fix (§4.2)

- Requested a Bengali line through the fixed chain; outcome: **rejected**
  `SpeechSynthesisError[VOICE_UNAVAILABLE]`, `attempts: 1`, message verbatim:
  *"VOICE_UNAVAILABLE: No verified voice is available for the requested Bengali locale.
  (বাংলা-প্রশিক্ষিত কণ্ঠগুলো — Microsoft Edge-নিউরাল bn-BD/bn-IN — এই মুহূর্তে পৌঁছানো যাচ্ছে
  না: …; z-ai কণ্ঠ বাংলা পড়তে পারে না বলে ভুল-ভাষার নীরব ফলব্যাক নিষিদ্ধ — §৪.২)"*.
- This is exactly the master §4.2 mandated behavior. **Before R-FIX the same situation
  produced Chinese-character garbage audio** (DB evidence, promoted fixtures); now it
  produces a typed, explainable, single-attempt rejection.
- Evidence: `evidence-tts.json` → `bn` block.

### 1.3 en control line → real SDK TTS + real ASR round-trip — PASS (B-F05 hardening proven live)

- Real z-ai SDK TTS, voice `tongtong`, engine `zai`: **241,296-byte WAV**
  (`en-sample.wav`, sha256 prefix `4bf8391e…`), duration 5 s.
- Real ASR round-trip: transcript **"The rain today feels quite good and soothing."** —
  exact, `similarity: 1`, `tokenCoverage: 8/8`, `detectedLanguage: "en"`, `verdict: "pass"`,
  `attempts: 1`, honest Bengali note "ASR রাউন্ড-ট্রিপ সাদৃশ্য ও শব্দ-আবৃত্তি দুটোই যথেষ্ট —
  ইংরেজি কথা নিশ্চিত।"
- Note: this line went through the **primary** engine (not a fallback), so `pass` is legal;
  REG-1i locks that an *en result after engine fallback* can never claim `pass` — the
  2026-10-16 false-positive class (0.57 similarity ⇒ pass) is closed at both levels.
- Evidence: `evidence-tts.json` → `en` block + `en-sample.wav`.

### 1.4 VLM acting review of the 3 real CogVideoX-3 clips — ADVISORY evidence

- Mid-frame of each real clip (1080×1440×2, 1890×1080×1; 31 fps; 10.29/10.29/10.23 s) sent
  through the app's own `visionAnalyze` with a 7-question acting rubric.
- Results (`evidence-vlm.json` + `frame-1/2/3.jpg`): people visible in all three; natural
  postures; credible expressions; **no distortions/artifacts** ("high-quality AI generation
  with realistic lighting and textures"); honest observations recorded — clip 2: two people,
  man's mouth slightly open "as if speaking", "hand positioning looks slightly stiff or
  posed"; clip 1: mouth "slightly open" (prompt-random motion — **consistent with the
  no-lip-sync declaration**, not a sync claim).
- Status: **VLM-reviewed, NOT human-reviewed.** Per master §6.4 this is advisory evidence
  only — automation cannot prove acting quality; human review remains open.

### 1.5 Spend ledger (complete)

- Edge probe: free (Microsoft public endpoint).
- z-ai SDK: **1× TTS (en)** + **1× ASR** + **3× VLM** — the documented minimal set; nothing
  else was called. No pricing data exists in the repo → total cost **UNKNOWN**, no estimate
  fabricated (Phase-4 decision stands).

## 2. What remains BLOCKED / NOT RUN (each with reason + owner)

| # | Item | Status | Reason | Owner decision needed |
|---|---|---|---|---|
| D-a | **§4.5 case 1 — live bn TTS success** (Bengali voice actually synthesizing + verified Bengali) | **NOT RUN (environmental)** | Edge bn-BD/bn-IN unreachable today (probe down); z-ai has no Bengali-capable voice (SDK reality, findings-b); the fixed code correctly refuses to fake it. The *unit* (REG-1h) and the *honest-failure* live path are proven; the *success* path is not. | Re-try when Edge recovers; pronunciation still needs human listening (§4.4) even then |
| D-b | **Real-provider video generation of a fixed-pipeline film** (D3 sheet: 1 fixed 5 s t2v prompt, `request_id` idempotency) | **NOT RUN** | Not covered by the user's Wave-4 authorization; usage/cost UNKNOWN (historically 138 s for a 5 s clip; 429 backoff 60 s ×6 built in) | Explicit authorization per §3 protocol |
| D-c | **Hosted lip-sync** (any provider) | **BLOCKED — NOT AUTHORIZED** | No lip-sync model/endpoint exists in the SDK (findings-c); hosted-API categories listed **without fabricated costs**; local models infeasible (2 CPU / 4.1 GB / no GPU) | Provider selection + cost review + authorization; until then the honest BLOCKED/UNSUPPORTED labels stay |
| D-d | **Human listening / human acting review** | **NOT RUN** | Requires the user's ears/eyes; ASR similarity and VLM review are explicitly not pronunciation/acting proof (master §4.4/§6.4) | User review of `/tmp/r-wave4/en-sample.wav` + `frame-*.jpg` and any future bn sample |
| D-e | Adapter-level Edge ws-mock + B-F13 tool-gate unit | documented follow-up (test-side, budget-free) | B-F11 partial — controller-level rejects are locked (REG-1a/1g/20i); the raw-tool bypass is closed in code (registry routes `text_to_speech` through the controller, B-F08) | Fix-wave follow-up, no authorization needed |

## 3. Authorization protocol for each pending live item (pre-flight, master §7 Layer D)

Before any Layer-D run, announce and get explicit user authorization for:

| Item | Provider & adapter | Input | Est. usage / cost | Outputs | Acceptance criteria | Failure handling |
|---|---|---|---|---|---|---|
| **bn success validation** (D-a) | Edge bn-BD/bn-IN neural via `language_controller` (probe first) | 3 fixed Bengali sentences (10–60 chars) × the locale-matched neural voices + 1 en control | **UNKNOWN** (≈4–7 TTS calls; no pricing data in repo) | WAVs + verification report (verdict/similarity/transcript/duration) | (a) ffprobe-valid WAV 24 kHz mono; (b) duration plausibility ≤0.45 s/char; (c) transcript has NO CJK chars for bn input; (d) similarity > 0 only counts if transcript is Bengali-script; (e) verdict `warn` or better with honest notes; (f) **human-listening gate stays mandatory** | 403/429 → bounded retry (REG-6 policy) then honest `TemporarilyUnavailableError`; persistent failure → record BLOCKED, never register unverified audio |
| **ASR round-trip on promoted fixtures** (D2 sheet) | z-ai SDK ASR via `transcribeBuffer` (28 s chunking) | `speech-bn-jam.wav` + `speech-en-tongtong.wav` + D-a fresh outputs | **UNKNOWN** (≈3–5 ASR calls) | transcripts + similarity/detected-language report | (a) bn input transcript must NOT be Chinese/repeated garbage (regression vs the recorded 可真的… evidence); (b) en control similarity ≥0.5-class with token coverage gate; (c) empty transcript ⇒ fail, never pass | verdict `fail`/`warn` per controller; never silently drop a line |
| **One-shot video generation** (D3 sheet, D-b) | z-ai SDK video (`cogvideox-3`, `ai_video.ts`, `request_id` idempotency) | 1 fixed 5 s t2v prompt (Bengali scene description) | **UNKNOWN** (1 video task; historically 138 s; 429 backoff built in) | MP4 + validation report | (a) ffprobe: h264, decodable, 5 s ±1, fps sane (record actual — provider has delivered 31 fps); (b) honest engine label; (c) no audio expected unless `with_audio:true` | 429 → 60 s backoff ≤6; timeout → honest failure, no fake artifact; cancel honored |
| **VLM frame analysis** (D4 — already partially run) | z-ai SDK vision via `visionCompare`/`visionAnalyze` | portraits + frames from real clips, Bengali prompt | **UNKNOWN** (1–3 vision calls) | text verdict per frame | non-empty Bengali verdict answering the question; **ADVISORY only** (§6.4) | rate-limit → single honest skip note, non-blocking |
| **Hosted lip-sync** (D-c) | TBD — no candidate exposed by the current SDK | dialogue WAV + clip per §5.2 timing contract | **UNKNOWN — costs never surveyed; do not fabricate** | synced clip or honest LIP_SYNC_* failure | phoneme-level sync evidence + A/V validation; never a mocked success | any failure ⇒ honest LIP_SYNC_* state; the 4-dimensional blocked declaration stays until a real contract exists |

Standing rules (unchanged): announce provider, inputs, shot counts, UNKNOWN-cost
disclaimer, outputs, acceptance criteria, failure handling → get authorization → record
every artifact + evidence record under this directory → never mark quality-passed on mocked
or partial evidence → "BLOCKED — LIVE PROVIDER NOT AUTHORIZED" whenever authorization is absent.

## 4. Verdict for Layer D at the end of the recovery round

- **Proven live:** bn honest-failure (typed VOICE_UNAVAILABLE, attempts=1, exact §4.2
  message); en path end-to-end (real TTS → real ASR → similarity 1.0 / 8-of-8 coverage →
  pass); VLM advisory acting review of the three real clips (people visible, natural,
  artifact-free, honest caveats).
- **Not proven live:** bn success (Edge down — environmental, honestly recorded); a
  fresh fixed-pipeline film from real providers; any lip-sync capability; human
  pronunciation/acting sign-off.
- No live call was made outside the authorized minimal set; nothing was fabricated to
  fill the gaps.
