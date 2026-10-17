# Recovery Audit — Cinematic Acting & Visual Quality (Critical Defect C)

- **Task ID:** R-DOC-2 (documentation consolidation) · Audit basis: **R-D** · Fix wave: **R-FIX** · Live evidence: **R-WAVE4** (first-ever acting-quality review)
- **Defect (master prompt §6):** natural-acting / visual-realism claims must match evidence across 12 acting dimensions; camera & shot-continuity behaviors must be verified; the §6.2 romantic scenario's feasibility must be stated honestly; quality verdicts must not overstate.
- **Sources:** `findings/findings-d.md` (§6.1 table, real-run discovery, D-F/O registers at HEAD `c7927f7`), `worklog.md` R-D / R-FIX / R-WAVE4, `/tmp/r-wave4/evidence-vlm.json` (Layer-D VLM review of the 3 real clips), `tests/regression/t21-dialogue-timing-contract.test.ts`.
- **Citation convention:** *pre-fix* file:line = as audited in findings-d at `c7927f7`; *current* file:line = re-verified in the post-R-FIX working tree (full gate 185/185, 1977 expects, 22 files).
- **Status vocabulary (§6.1):** SUPPORTED (mechanism exists + verified) / PROMPT_GUIDED (requested via prompt text only, no guarantee) / UNSUPPORTED / NOT_VERIFIED (output-level).

---

## 1. §6.1 Acting-dimensions table (12 rows — mechanism status as audited at `c7927f7`, with post-R-FIX deltas)

Full evidence chain per row in findings-d §1; condensed here with the recovery deltas.

| # | Dimension | Mechanism status | Core evidence (pre-fix file:line) | Post-R-FIX / Wave-4 delta |
|---|---|---|---|---|
| 1 | Facial expression & scene emotion | PROMPT_GUIDED | SF acting-plan `facialExpression` (short_film.ts:610–613, stored :647) → actingText :1003 → prompt `extra` :1014–1015; MV has no facial channel (generic actionEn + style suffix) | **First output-level evidence (VLM, §6):** plausible expressions in all 3 real clips — still no verification mechanism |
| 2 | Eye gaze & attention direction | PROMPT_GUIDED | acting `gaze` :645 → actingText :1001; no plan-level gaze field (types.ts:139–175); MV none | Unchanged — gaze remains free text, not structure |
| 3 | Mouth movement with dialogue | UNSUPPORTED (honestly disclaimed) | `lipSync:false` (short_film.ts:1556, music_video.ts:860); limitation "লিপ-সিঙ্ক নেই…" (planner.ts:885); lip_sync_module blocked 4-dimension | Unchanged by design — Defect B stays BLOCKED; `lipSync:false` retained |
| 4 | Head movement & body gesture | PROMPT_GUIDED | acting `action`/`bodyHands` :644,646 → actingText :1000,1002; KenBurns is camera motion, not body (capability_map.ts:23–27) | **First output-level evidence (VLM, §6):** natural poses ×3, one "slightly stiff or posed" hands caveat |
| 5 | Action continuity | PROMPT_GUIDED (weak, incidental) | shared scene `actionEn` (planner.ts:652–655) + deterministic `lightingMood` (:657, 441–456); 0.4 s crossfade; continuity check identity-only ≤3 shots (short_film.ts:1351–1408) | Unchanged |
| 6 | Subject identity / appearance consistency | **SUPPORTED** (single character per shot, hard two-character gap) | portraits :475–598 → i2v `imageUrl` reaches the provider (:1040; ai_video.ts:351); "Same person (identical face, hair, outfit)" edit :1105–1112; VLM continuity :1382–1394 — real run 2/2 matched ("একই ব্যক্তির মুখ, ছোট চুল এবং সাদা পোশাক"). GAP: only `scene.characters[0]` ever conditioned a shot (planner.ts:660–662) | **D-F04 narrows the gap** (§4): dialogue scenes now distribute characters across OTS/reaction slots; per-shot `characters` (plural) reaches portrait selection (short_film.ts:829) — identity for character B now conditioned *when budget allows* (still not at 30 s, §7) |
| 7 | Camera framing & subject position | PROMPT_GUIDED | `sizeFramingPhrase` (capability_map.ts:64–83) → prompt; delivery verdict `prompt_guided` (:55–56); honest limitation (planner.ts:884). Real run: provider returned 1890×1080 landscape for a 9:16 request | Unchanged — provider framing genuinely not guaranteed (D-F11); local normalization is load-bearing |
| 8 | Scene-to-scene visual continuity | PROMPT_GUIDED | deterministic per-scene lighting map (planner.ts:441–456, REG-16f2); scene-consistent actionEn/lighting; no output verification beyond identity VLM | Unchanged |
| 9 | Speaker reaction & conversational turn-taking | UNSUPPORTED (structural gap, **proven by the real run**) | dialogue lines never attached to shots (short_film.ts:967–977); `acting.speaks` collected (:648) but never reached prompts (:998–1007). Real run: আকাশ's line played over the establishing-shot tail (9.75–13.37 s); প্রিয়া's 10.6 s line ran across the dialogue shot AND the closing shot where she has left | **D-F02 fixes the alignment half** (§4): lines placed in the speaker's shot window + speaks-gist into prompts. Upgraded to structured-prompt-guided; reaction *coverage* still budget-limited (§7) |
| 10 | Unnatural body motion / face deformation / temporal flicker | UNSUPPORTED | no detection mechanism anywhere (continuity step is identity-only VLM); no claims made either — but nothing could even detect a violation | **First (narrow) evidence (VLM, §6):** no obvious artifacts/deformations in 3 mid-frames — still no temporal/flicker analysis |
| 11 | Repetitive identical shots | PROMPT_GUIDED mitigation + deliberate-reuse residual | variety rules (planner.ts:202–208 MV, :618–629 SF; REG-16a3b/c), adjacent-size energy-pair alternation (:287–315; REG-16a4), distinct cache keys (shot_cache.ts:141–153; REG-16l); residual: identical prompts intentionally reuse the same cached clip | Duplicate-prompt honest note added (R-FIX dedup-note) |
| 12 | Unexplained position/costume changes | PROMPT_GUIDED (identity path only) | i2v conditioning + "identical face, hair, outfit" edit text + VLM checks মুখ/চুল/পোশাক for ≤3 character shots (:1385) | Unchanged |

**Mechanism-level counts (as audited): SUPPORTED 1 · PROMPT_GUIDED 8 · UNSUPPORTED 3.**
**Output-level: all 12 rows were NOT_VERIFIED pre-review** — the single real film in the repo had never been through a §6.4 review sheet, no face/mouth/flicker analysis existed anywhere, and no other real provider video existed. **Wave-4 changes this partially (§6): dimensions #1/#4/#10 now carry first VLM-level evidence; the human review sheet remains NOT REVIEWED.**

---

## 2. The real-run discovery (D-F01 — the decisive, previously unanalyzed evidence)

**Production `cmvbbv86c000apzrc9mra61oi`** — a real, user-initiated, end-to-end romantic short-film run, sitting unanalyzed in git-ignored runtime state (`storage/` + `db/custom.db`) until Audit D:

- **The exact §6.2 romantic scenario:** spec = 30 s romantic short film, 9:16, bn, `ai_diffusion`, filmMode short_film, sound narration; title is user-imperative phrasing "🎬 ৩০ সেকেন্ডের রোমান্টিক শর্টফিল্ম বানাও"; screenplay "দুঃখের বৃষ্টি" — 3 scenes, আকাশ + প্রিয়া.
- **Timing:** started 2026-10-16T18:55:23Z, finished 19:18:52Z — **29 seconds before the phase-5 commit `c7927f7` (19:19:21Z)**; the master recovery prompt was pasted at 19:18:13Z — i.e. almost certainly the user's own pre-recovery-prompt test. Undocumented in worklog/docs until the recovery audits (O-2).
- **3 real CogVideoX-3 clips** (`storage/shot-cache/`, model `cogvideox-3`, hasAudio:false on all): 10.29 s 1080×1440@31, 10.29 s 1080×1440@31, 10.23 s **1890×1080@31** (landscape for a 9:16 request — provider ignores size; local normalization re-applies w/h/fps, exactly why the cache fingerprint excludes them).
- **Final `studio.mp4`** (17.4 MB, Layer-C re-verification): exactly 30.000 s, 1080×1920@24, video/audio streams both 30.000 s (avSyncOk true), true peak −1.5 dBFS, integrated **−14.4 LUFS** (report said −16.3 on the pre-trim 65.8 s mix — O-6), subtitles burned, LRA 4.4.
- **Speech evidence:** dialogue-1 `warn` (Edge 403 → z-ai fallback, similarity 0), dialogue-2 **`fail`** (10.6 s for the 5-word "বৃষ্টি ভালোই লাগে।") — both still mixed into the film (D-F05); narration 41.1 s scheduled from 24.7 s → ~87 % silently truncated (D-F06/E-F01).
- **Plan evidence:** shot-plan.json with 3 shots, **all-Bengali `actionEn`** (D-F03 — Bengali text reached CogVideoX-3 prompts); প্রিয়া never a shot character (D-F04); VLM identity 2/2 OK; resultJson aiShots 3/3, 6 partialNotes (incl. the fail verdict + the dialogue-length note pushed twice — D-F10).
- **Acting quality of this artifact: NEVER reviewed until Wave-4 (§6).** This was the single most valuable recovery input, sitting unanalyzed (D-F01, P1).

---

## 3. Fixes landed (R-FIX — from findings-d §4/§6 + the R-FIX worklog; current file:line verified)

**Structural acting fixes:**

- **D-F02 (P1) — speaker→shot alignment.** `placeLineInSpeakerShot` (short_film.ts:210–223) places each line inside the speaker's shot window when it fits (`matchedSpeakerShot` flag, `shotId` on the line; falls back to the scene cursor with an honest note otherwise). `spokenGistForShot` (:797–811): when `acting.speaks=true`, the first ~40 characters of the speaker's line ride the prompt as `speaks: "…"` — with the standing rule "মুখ-নড়াচড়া/লিপ-সিঙ্কের দাবি কখনো হয় না (§৫)" (:822–824). The real-run misalignment (আকাশ over the establishing shot; প্রিয়া across two shots) is now structurally prevented and regression-locked via the t21 timing contracts.
- **D-F03 (P1) — prompt-language guard, both halves.** Shared, lead-owned contract `cinematic/lang-guard.ts` (`containsBengaliScript`, `bengaliScriptShare` — Bengali script = U+0980–U+09FF) applied to (a) the script-LLM output half and (b) the planner-fallback half (English `actionEn` fallback + honest coordination note). The real run's Bengali-actionEn-to-CogVideoX-3 breach can no longer recur silently.
- **D-F04 (P2) — two-character dialogue-scene coverage.** The planner now tracks which characters are already conditioned and distributes dialogue-scene slots: **reaction slot → `characters[1]`** ("অন্য চরিত্রটি সাড়া দিচ্ছে" coverage), medium/OTS slots alternate so a ≥2-conditioned-slot scene presents **both** characters (planner.ts:723–734); action scenes keep `characters[0]` (previous behavior). Per-shot `characters` (plural) now reaches portrait selection (short_film.ts:829).

**Verdict/aggregation honesty fixes:**

- **D-F05 (P2) + O-1 + O-5 — fail-verified audio no longer counts as success.** Fail-verdict lines are subtitle-only with honest notes and counted separately ("Nটি লাইন TTS-ফেরত" — never "N/N সফল" with a fail inside, short_film.ts:1124–1129); the headline verdict factors speech verification — "চমৎকার" only when clean, otherwise "কার্যকর, তবে সতর্কতা: …" plus soft caveats listing warn/fail counts (:1979–1984). Locked by REG-21a (t21:284) using the real-run proof (10.6 s of garbage under a "চমৎকার" headline) as the contract's motivating case.
- **D-F06 (P2) — overflow honesty.** Dialogue and narration lines crossing the film end are detected, honestly noted, and recorded as `{overflowSec, action:'truncated'}` (short_film.ts:1511–1526 for A1 dialogue, :1683–1687 for A5 narration) — the real run's 87 % narration loss class can no longer be silent.

**Overstated-claim fixes (O-1..O-6 from findings-d §4):**

| # | Was | Now |
|---|---|---|
| O-1 | result.quality "চমৎকার" with a fail-verdict dialogue line | Fixed with D-F05 (above) — verdict weighs speechVerification |
| O-2 | exit-report §4 "live E2E NOT RUN" stale vs. the repo's real run | The real run is now documented as existing evidence in findings-d §5, findings-e V4, and this audit; the phase-5 exit report itself was not retroactively edited |
| O-3 | ai_diffusion label "…রিয়েলিস্টিক, ধীর…" (unverified quality adjective) | "প্রকৃত AI ডিফিউশন ভিডিও (CogVideoX-3) — ধীর (প্রতি শটে ~২–৪ মিনিট)" (production-card.tsx:390–394) |
| O-4 | "প্রতিটি শট … প্রকৃতভাবে তৈরি হয়" without the fallback path | "…রেট-সীমা/ব্যর্থতায় কিছু শট স্টোরিবোর্ড+ক্যামেরা-মোশনে নামতে পারে (ফলাফল-লেবেলে দেখা যাবে)" (production-card.tsx:356) |
| O-5 | step detail "2/2 সংলাপ-লাইন সফল" counting a fail | Honest split counts (short_film.ts:1124–1129) |
| O-6 | `technicalReport.loudnessLufs` describing the pre-trim mix | `loudnessSignal` field labels the measured signal ('delivered' vs 'pre-mix'; the delivered signal is measured when possible — short_film.ts:1873–1892) |

Adjacent hygiene landed in the same wave: D-F10 duplicate-partialNote dedup, D-F12 portrait artifact filename fix, E-F03 MIME sniffing.

---

## 4. §6.3 Camera & shot-continuity checklist — all six items VERIFIED/locked (findings-d §2)

1. **Shot plan → provider prompt/params: VERIFIED (locked).** Prompts built from the plan shot; all generation-affecting fields flow through `prompt.ts:21–35`. Locked by REG-17a (t17:236–240 — submitted prompts contain `sizeFramingPhrase('establishing_wide')` + `movementPhrase('zoom_in')`) and t19:293–294. Provider body keys are exactly the probe contract — **no native camera parameter can reach the provider** (t17:247–251, t19:301–304).
2. **Wide/medium/close-up variation: VERIFIED at plan level.** MV adjacent-size energy-pair alternation + penultimate-wide guard (REG-16a4); SF per-scene slot patterns (planner.ts:547–592). Real run: establishing_wide → medium → wide — varied.
3. **Camera movement prompt-only vs native: VERIFIED honest.** ai_diffusion → always `prompt_guided` ("CogVideoX-3-এ কোনো নেটিভ ক্যামেরা-প্যারামিটার নেই"); cinematic_motion → 5 local KenBurns moves `local_motion`; dolly/handheld/orbit → `downgraded_to_local` with deterministic fallback + honest reason; UI badges carry the same verdicts.
4. **Scene order preserved: VERIFIED.** Validator enforces `order === i` + unique ids + scene references; timeline concatenates in `shots` order. Real run: S01→S02→S03 intact.
5. **Shot-cache incompatible-reuse risk: CLOSED (REG-16l + E4)** — fingerprint = full provider request (movement change → new key, framing change → new key, identical → same key; measured sha256 a≠b/a≠c/a=d). Documented residuals: w/h/fps deliberately excluded from the key (load-bearing — the real run's 31 fps / odd-size clips were locally normalized); identical prompts intentionally share footage (dimension #11 residual).
6. **Final duration & audio mix: VERIFIED in tests + real run.** REG-9b duration/layout/A-V sync; −16 LUFS target, TP ≤ −1.2 dBTP; real run independently re-verified (30.000 s both streams, TP −1.5). The two real-run defects found here (D-F06 narration truncation, D-F07 loudness mismatch) are both fixed (§3).

---

## 5. NEW EVIDENCE — Wave-4 VLM frame review of the 3 real clips (first-ever acting-quality evidence)

Source: `/tmp/r-wave4/evidence-vlm.json` (2026-10-16T22:23:33Z) + frame-*.jpg. **Method:** mid-frame of each of the 3 real CogVideoX-3 clips from Production cmvbbv86c…, reviewed with the app's own `visionAnalyze` (7 questions: person visible / face visible / mouth state / expression / pose naturalness / artifacts-deformations / shot description). Cost: 3× VLM calls, documented (worklog R-WAVE4). This realizes — in minimal form — the budget-free upgrade path findings-d prescribed for dimensions #1/#4/#10 ("VLM frame review vs. plan emotion, budget-free on stored frames").

| Clip | VLM observations (quoted) |
|---|---|
| 1 — `1d46cce8…` (10.29 s, 1080×1440@31, silent) | Person visible, in profile; mouth **slightly open**; expression "**Serious or concerned**"; pose "**Natural**"; "**No obvious artifacts**; the image appears to be a high-quality AI generation with realistic lighting and textures"; medium shot — a woman looking out from a doorway onto a wet, blue-lit street at night |
| 2 — `67c63a5f…` (10.29 s, 1080×1440@31, silent) | **Two people visible** (woman's face clearly visible, man's in profile); woman's mouth closed, man's **slightly open "as if speaking"**; expressions "**gentle, calm smile**" / "**focused, attentive**"; "**Natural, though the hand positioning looks slightly stiff or posed**"; "No obvious visual artifacts or deformations"; medium close-up of a couple at a table, sunset background |
| 3 — `e0379c44…` (10.23 s, 1890×1080@31, silent) | Two people (man clearly visible, woman in profile); mouth **closed**; "**Serious, intense, or contemplative**"; pose "**Natural**"; artifacts "**No**"; medium shot, dimly lit hazy interior with strong backlighting |

**Honest reading:**

- **Positive:** natural poses in all 3 clips; plausible, interpretable expressions in all 3; **no reported artifacts, deformations, or face corruption** — the first output-level evidence that the acting/realism dimensions produce non-degenerate results on the one real artifact.
- **Honest caveats (kept, not buried):** (a) clip 2 — "hand positioning looks slightly stiff or posed"; (b) slightly-open mouths in clips 1–2 are **prompt-random motion, not speech sync** — consistent with `hasAudio:false` and with the standing `lipSync:false` declaration; nothing claims otherwise.
- **Scope limits:** single mid-frame per clip — **not** temporal/flicker analysis, **not** motion-plausibility over time, and VLM output is itself an estimate, not proof. The two-person compositions in clips 2–3 arose from prompt text even though the pre-fix plan conditioned only `characters[0]` — the second person's identity was therefore unverified at generation time (dimension #6 gap as it then stood).
- **Baseline caveat:** these clips were generated by the **pre-fix pipeline** (Bengali actionEn prompts, single-character conditioning, pre-D-F02/D-F03/D-F04) — this is a baseline measurement, not a post-fix validation; a post-fix regeneration has not been run (live generation not authorized).
- **Review status:** acting-quality evidence is now **VLM-reviewed (3 real clips)**; the human §6.4 review sheet on the real film is still **NOT REVIEWED**.

---

## 6. §6.2 Romantic-scenario feasibility — PARTIALLY EXPRESSIBLE (improved by the fix wave)

**Expressible before and now (verified in code + the real run):** opening environment+distance (first-scene `establishing_wide` + `environment` — real run S01); scene purposes matching the §6.2 beats (পরিচিতি ও ভৌগোলিক স্থাপন / সংলাপ-কভারেজ / অ্যাকশন-কভারেজ / সমাপনি); OTS + reaction framing vocabulary in the dialogue slot pattern; Bengali dialogue via per-voice verified TTS + subtitles at measured timings; **two character portraits** (both আকাশ and প্রিয়া received portraits in the real run); ending beat (`zoom_out` + `transitionIn: 'সমাপনি-বিট'` — real run S03); honest labels throughout.

**Gaps (findings-d §3.2) and their post-R-FIX status:**

| # | Gap (as proven in the real run) | Pre-fix | Post-R-FIX |
|---|---|---|---|
| 1 | Two named characters in one shot / per-shot attribution (প্রিয়া never conditioned a shot) | inexpressible | **Improved (D-F04):** reaction → `characters[1]`, OTS alternation — both characters conditioned when the dialogue scene gets ≥2 slots; still impossible at 30 s budgets (row 4) |
| 2 | Gaze/eye-contact as structure | free text only | unchanged (no plan field, no verification) |
| 3 | Dialogue-to-shot speaker alignment (both real-run lines misaligned) | broken | **Fixed (D-F02):** speaker-shot windows + speaks-gist in prompts |
| 4 | Reaction close-up at 30 s | budget-blocked | **still budget-limited:** `shortFilmShotCount = ceil(30/10) = 3` for ai_diffusion ⇒ 1 shot/scene ⇒ OTS/reaction slots (which need ≥2/≥3 shots in the scene) cannot appear — geometry unchanged; 45–60 s durations unlock them |
| 5 | Mouth movement with dialogue | blocked | unchanged (Defect B — honestly disclaimed) |
| 6 | Prompt-language contract (Bengali actionEn reached CogVideoX-3) | unenforced | **Fixed (D-F03), both halves** |

**Verdict: PARTIALLY EXPRESSIBLE — improved.** The §6.2 skeleton (environment → dialogue scene → ending, subtitles, honest labels, single-character identity) was in fact produced end-to-end once, and the Wave-4 VLM review shows the output is non-degenerate at the frame level. Two-character attribution and speaker alignment are now expressible within budget limits; reaction coverage at 30 s remains budget-limited and mouth movement remains honestly blocked.

---

## 7. Defect C verdict

**Defect C was a claims-vs-evidence gap, not a fabricated-capability one.** The honesty architecture (delivery badges, limitations block, `lipSync:false`, anti-overclaim instructions inside the LLM prompts) was genuine and consistently applied — findings-d's positive finding; §6.3's six camera/continuity items were all VERIFIED/locked. The real debts were: the only real E2E artifact sitting 100 % unanalyzed (D-F01), structural acting gaps (D-F02 speaker alignment, D-F03 prompt-language breach, D-F04 single-character slot), verdict/aggregation dishonesty (D-F05/O-1/O-5 — "চমৎকার" over fail-verified audio), silent overflow (D-F06), and six overstated/stale claims (O-1..O-6). All are fixed in the working tree with regression locks (t21 + the R-FIX test wave; full gate 185/185), and the first-ever acting-quality evidence now exists: a VLM frame review of the 3 real CogVideoX-3 clips — natural poses, plausible expressions, no artifacts, one "slightly stiff hands" honest note, slightly-open mouths consistent with prompt-random motion and the no-lip-sync declaration. That evidence is VLM-level and pre-fix-baseline; **human review of the real film remains NOT REVIEWED**, reaction coverage at 30 s remains budget-limited, and mouth movement with dialogue remains honestly blocked (Defect B). Nothing in the product claims otherwise.

*No git mutations; no source/test modifications in this documentation task; VLM evidence cited read-only from `/tmp/r-wave4/evidence-vlm.json`.*
