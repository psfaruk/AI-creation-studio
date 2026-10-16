# Phase 3 — Implementation Design (Media Quality, Cost & Latency)

Workstream design doc for Phase 3 of `psfaruk/AI-creation-studio`.
Written **before** implementation (mandatory workflow Step 2). Baseline evidence in
`README.md` (Step 1 audit, including the sandbox snapshot-restore incident).

Scope order: **A → B → C → D** (per approved prompt). No commits, no pushes, no
live provider calls in this phase. Every result will be labeled
PASS / FAIL / BLOCKED / NOT RUN / HYPOTHESIS with an evidence class
(code-inspected / unit-test / local-integration / live-provider).

---

## 0. Baseline (verified in Step 1)

| Item | State |
|---|---|
| Git HEAD | `2b0ef3e` = `origin/main` (expected Phase-3 baseline) — restored via fast-forward after a sandbox snapshot-restore incident (see README §1); working tree clean |
| `bun run test` | 47/47 pass, exit 0 (10.3s) |
| `bun run typecheck` / `bun run lint` / `bunx prisma validate` | all exit 0 |
| Dev server | Next.js 16.1.3 on :3000, healthy |
| FFmpeg / ffprobe | 7.1.5 — `loudnorm` (A->A) and `ebur128` (A->N) filters available |
| Dev DB | schema-valid, **pristine** (0 rows everywhere) |
| `storage/` | **absent** (snapshot restore dropped gitignored runtime dirs; `saveArtifactFile`/tts-cache self-heal via `mkdir recursive`) |
| Real recorded media | **none available locally** — the Phase-0/1 reference production `yrz3ymb7` and its 8 artifacts existed only in the previous sandbox instance's runtime storage |

Consequence for Workstream B: the "real local test artifact before/after" measurement
cannot be reproduced in this sandbox (would require a live provider run = unauthorized
budget). It will be marked **NOT RUN** with this reason; real-codec synthetic fixtures
(real procedural engines → real `mixSoundLayers` → real ffmpeg/ebur128 measurement)
provide the local-integration evidence instead.

---

## 1. Workstream A — motion-video TTS fallback reliability (High)

### 1.1 Root cause & evidence

`src/lib/agent/production/pipelines/motion_video.ts:645` — the narration loop calls
`cachedSynthesizeSpeech(chunks[i], spec.voice ?? 'tongtong', 1)` directly:

- **single voice, single engine** — if the requested voice's engine is down
  (e.g. the Edge-403 outage recorded in production `yrz3ymb7`), every chunk fails
  identically and is dropped with a partial note (`motion_video.ts:650-654`);
- **no fallback chain** — bypasses `synthesizeVerifiedSpeech`
  (`src/lib/agent/audio/language_controller.ts:363`), the shared Phase-2 fix
  (P0-BUG-01): per-voice try/catch, engine-aware skip (`deadEngines`), full
  profile chain (bn: 5 voices / en: 7), honest exhaustion error (REG-1g);
- **no Bengali text normalization** (§4 number/date/time → words) and no
  language-consistency guard — `synthesizeVerifiedSpeech` provides both;
- **no metadata** about the voice actually used.

Phase-2 worklog (P2-1) explicitly deferred this call site as a follow-up. It is the
**only** production TTS call still bypassing the shared abstraction
(`audio.ts:188,226`, `short_film.ts:705,764,784` were fixed in Phase 2;
`tools/audio.ts:447` already used it; `tts-benchmark-runner.ts:193` deliberately
benchmarks raw engines and stays as-is).

### 1.2 Design

Extract the narration loop into a pure, exported, unit-testable helper in
`motion_video.ts` (no behavior change for callers beyond the fallback upgrade):

```ts
export interface VoiceoverChunk {
  file: string; startSec: number;
  voice: string;            // actual voice that synthesized the chunk
  attempts: number;         // chain attempts used (1 = primary)
  engineNotes: string[];    // honest fallback/normalization notes (verbatim)
}
export interface VoiceoverOutcome {
  chunks: VoiceoverChunk[]; // successful chunks in order
  failures: string[];       // honest per-chunk failure notes (all engines dead)
}
export async function synthesizeVoiceoverChunks(opts: {
  chunks: string[];
  language: SpeechLanguage;          // ctx.spec.language ?? detect → 'bn' default
  voiceId?: string;                 // spec.voice (preferred voice)
  speed?: number;                   // 1 (current behavior)
  workingDir: string;               // files land at <workingDir>/voice-<i>.wav
}): Promise<VoiceoverOutcome>
```

Inside, per chunk: `synthesizeVerifiedSpeech({ task: 'speech', language, script,
voiceId, outputFormat: 'wav', sampleRate: 24000, speed }, { verify: false })`
→ `writeFile` → `mediaInfo` (real ffprobe) → cursor timing **unchanged**
(`cursor += durationSec + 0.2`).

Decisions (mirroring the Phase-2 pipeline decisions):
- **`verify: false`** — ASR back-check cost unchanged vs today (the current call
  has no ASR either). Duration truth still comes from real `ffprobe`.
- **Reuse, not copy**: the fallback chain, engine-aware skip, bounded attempts and
  honest exhaustion error all live in the shared abstraction. The helper adds only
  chunking, file IO, timing and metadata collection.
- **Optional speech stays optional**: a chunk whose *entire* engine chain is dead
  is recorded in `failures` (verbatim honest error, already redacted to 120 chars
  by the existing catch shape) and dropped — the video continues with remaining
  chunks / ambient bed, exactly like today but only on true exhaustion.
- **Metadata**: the pipeline passes `VoiceoverOutcome` into its result/meta —
  actual voices, attempts and engine notes become auditable (honest-label
  architecture unchanged: no fake "AI" claims, no hidden fallbacks).
- **Language**: `spec.language === 'en' ? 'en' : 'bn'` (same pattern as
  `short_film.ts:164`); the shared abstraction still runs its own script-language
  consistency guard.

### 1.3 Files

| File | Change |
|---|---|
| `src/lib/agent/production/pipelines/motion_video.ts` | narration block (637-672) calls the new helper; helper exported; honest voiceover meta added to result |
| `tests/regression/t8-motion-voiceover-fallback.test.ts` | **new** — REG-8 (7 classes below) |

### 1.4 REG-8 regression tests (7 classes)

Mock boundary: `mock.module('@/lib/agent/tts-cache')` (t1 pattern) so the **real**
`synthesizeVerifiedSpeech` chain runs against controllable engines; WAV fixtures via
real `encodeWav` (real ffprobe timing).

| ID | Class | Assertion |
|---|---|---|
| REG-8a | primary success | requested voice works → 1 attempt, no fallback note, timing cursor correct |
| REG-8b | fallback success | Edge 403 → chain reaches z-ai voice → chunk succeeds, `attempts>1`, honest engine note recorded in `engineNotes` |
| REG-8c | engine-aware skip | Edge 403 on first voice → remaining Edge voices **not called** (call-log proof), z-ai tried next |
| REG-8d | all engines dead | every engine fails → chunk lands in `failures` with the honest exhaustion message; other chunks still processed |
| REG-8e | optional speech truly optional | all chunks fail → `chunks: []`, helper resolves (no throw); caller keeps ambient/silent path |
| REG-8f | metadata truthfulness | outcome records actual voice per chunk + attempts + notes; requested-vs-actual mismatch visible |
| REG-8g | bounded retry | attempts never exceed profile length (bn 5 / en 7); no infinite loop; per-chunk chain is the only retry |

Invariants preserved: chunking (`chunkText(…, 950)`), cursor timing, no SRT in
motion_video (subtitle alignment N/A — verified in Step 1), mixing handoff
(`mixAudioTracks`), 10-min step timeout (S10).

---

## 2. Workstream B — final-mix loudness (High)

### 2.1 Root cause & evidence

`src/lib/agent/audio/sound_design.ts:564` `mixSoundLayers` — mixes the 5 §8 layers
(dialogue −3 dB, ambience −19 dB, foley −12 dB, music −15 dB, narration −7 dB,
ducking, `alimiter=limit=0.971`) and **measures** loudness (`preciseLufs`, ebur128)
but never **normalizes**: the only loudness complaint is `lufs < -30`
(`sound_design.ts:636`). Result: the recorded short film measured **−25.4 LUFS**
(Phase-0, P0-BUG-02) vs the −16 LUFS delivery target — too quiet, no complaint.
`motion_video`'s `mixAudioTracks` (`film-helpers.ts:285`) has the same shape but is
**out of Phase-3 scope** (Workstream B names the short-film finalization; recorded
as future-phase candidate).

### 2.2 Design — two-pass loudnorm helper in `src/lib/media/ffmpeg.ts`

```ts
export interface LoudnessStats { integratedLufs: number | null; truePeakDbtp: number | null; lra: number | null; }
export async function measureLoudness(file: string, opts?): Promise<LoudnessStats>;
//   ebur128=peak=true → parse I / LRA / True peak (existing preciseLufs logic,
//   generalized + true-peak added; sound_design keeps its own summary use).

export interface LoudnessNormalization {
  applied: boolean; reason?: 'silence' | 'already-at-target';
  before: LoudnessStats; after: LoudnessStats;
  inputChannels: number; outputChannels: number;
  durationInSec: number; durationOutSec: number;
}
export async function normalizeLoudnessTwoPass(
  input: string, output: string,
  opts?: { targetLufs?: number /* -16 */; maxTruePeakDbtp?: number /* -1.5 */; targetLra?: number /* 11 */ }
): Promise<LoudnessNormalization>;
```

FFmpeg plan (channel-layout-aware, no mono→stereo assumption):

1. **Probe** input via `ffprobeJson` — reject `> 2` channels with an explicit
   "unsupported channel layout" error (never silently mangle; our mix is always
   stereo — 5.1 handling is out of scope and must fail honestly).
2. **Pass 1 (analysis)**: `-i in -af loudnorm=I=<target>:TP=<tp>:LRA=<lra>:print_format=json -f null -`
   → parse `input_i / input_tp / input_lra / input_thresh`. `input_i === '-inf'`
   (silent) → **no normalization**: byte-copy input → output, `applied:false,
   reason:'silence'` (caller records an honest issue; a silent "mix" is a mix
   problem, not a gain problem).
3. **Pass 2 (apply)**: `-i in -af loudnorm=I=…:TP=…:LRA=…:measured_I=…:measured_TP=…:
   measured_LRA=…:measured_thresh=…:offset=…:linear=true,aresample=44100
   -ac <channels> -c:a pcm_s16le out` — linear mode = static gain when within
   dynamic-range limits; true peak enforced by `TP`. `-ac` = probed input channels
   (mono stays mono).
4. **Measure after** (`measureLoudness`) → returned in `after`. Non-zero ffmpeg
   exit → `runFfmpeg` already throws (never disguised as success — verified
   `ffmpeg.ts:97-172`).
5. **Invariants checked by the helper itself**: duration in/out (loudnorm linear
   does not change timing) and channel count in/out — both returned for the
   caller/report; mismatches surface as honest issues.

### 2.3 Wiring into `mixSoundLayers` (short-film finalization)

After the existing raw mix is written to `outputPath` (PCM stereo 44.1k):

```
raw mix → normalizeLoudnessTwoPass(outputPath → outputPath.norm.tmp.wav)
        → ok? rename over outputPath : (silence → keep raw + honest issue)
```

- `SoundMixReport` **additive** fields: `targetLufs?: number`,
  `normalizedLufs?: number`, `truePeakDbtp?: number`, `loudnessApplied?: boolean`.
  Existing fields keep their meaning (`loudnessLufs` = final measured value).
- Honest verification issues: if `applied` and `|after.I − target| > 1.5 LU` →
  issue; if `applied` and `after.TP > −1.5 + 0.3` → issue (loudnorm tolerance).
- `DEFAULT_MIX_RULES` gains `targetLufs: -16`, `maxTruePeakDbtp: -1.5` (documented
  delivery target; overridable per call — future pipelines can opt in).
- `short_film.ts:1261` detail message extended: `লক্ষ্য −16 LUFS → অর্জিত −15.9 LUFS (TP −1.6 dB)`.
- `muxAudio` untouched (`-c:v copy` → fps/resolution/duration of video stream
  unchanged; A-V sync preserved — REG-9f proves with stream-delta measurement).

### 2.4 Files

| File | Change |
|---|---|
| `src/lib/media/ffmpeg.ts` | + `measureLoudness`, `normalizeLoudnessTwoPass`, `LoudnessStats`/`LoudnessNormalization` (additive) |
| `src/lib/agent/audio/sound_design.ts` | `mixSoundLayers` post-mix normalization + report fields + `MixRules` targets |
| `src/lib/agent/production/pipelines/short_film.ts` | detail message only (1 line) |
| `tests/regression/t9-final-mix-loudness.test.ts` | **new** — REG-9 |

### 2.5 REG-9 tests

Real ffmpeg on temp files; layers from real procedural engines (music_engine
instrumental, sound_design bed) + PCM voice; **independent** ebur128 re-measurement
(not the helper) for non-circular assertions.

| ID | Class | Assertion |
|---|---|---|
| REG-9a | nominal normalize | quiet multi-layer mix → `normalizedLufs` within ±1.0 LU of −16; independent ebur128 agrees; `truePeakDbtp ≤ −1.5+0.3` |
| REG-9b | duration/layout/sync preservation | WAV duration in/out equal ±0.05s; channels preserved; full mux integration: normalized mix + real `testsrc2` video via real `muxAudio` → duration/fps/resolution unchanged, A/V stream delta < 0.5s |
| REG-9c | mono passthrough | direct helper test: mono input stays mono (channel count out == in) |
| REG-9d | silent input | all-zero PCM → `applied:false, reason:'silence'`, honest issue, output exists, no crash |
| REG-9e | corrupt input | garbage bytes → helper **throws** (non-zero ffmpeg exit not disguised); no fake output |
| REG-9f | unsupported layout | 6-channel fixture (ffmpeg `pan`) → explicit unsupported-layout error |
| REG-9g | report truthfulness | `mixSoundLayers` report carries before/after/target/applied; issue raised when post-normalization deviation > threshold (synthetically induced) |
| REG-9h | before/after on real recorded artifact | **NOT RUN** — artifact lost in sandbox snapshot restore; regenerating needs live provider budget. Documented, not faked. |

---

## 3. Workstream C — successful-shot cache reuse (High impact)

### 3.1 Root cause & evidence

P0-BUG-04: every production run pays full provider cost per shot. `generateAiShot`
(`motion_video.ts:165`) → `generateVideoClip` (`ai_video.ts:501`) — submit → poll →
download → validate; working dir `storage/productions/{id}` is `rm -rf`'d after every
run (`runner.ts:512`). Existing reuse: character portraits, TTS disk cache, §10
request-id idempotency within one run. **No cross-run shot reuse.** Phase-1
measurement: `generate_shots` = 1,079.7s of a 1,436s short film (~75%).

### 3.2 Cache placement — inside `generateVideoClip` (single choke point)

All paths (direct pipeline calls, `prewarmVideoClip`, `generateVideoClips`) go
through `generateVideoClip`; caching there makes prewarm automatically cache-aware
(a prewarm of a cached request resolves instantly — no wasted submit) and covers
all 3 pipelines with one wiring.

New module `src/lib/agent/video/shot_cache.ts`:

```ts
export interface ShotCacheKeyInput {        // = full provider request fingerprint
  v: 1;                                     // schema version (bump = invalidate all)
  model: string;                            // AI_VIDEO_MODEL ('cogvideox-3')
  prompt: string;                           // exact provider prompt (normalized trim)
  durationSec: number;                      // clamped 5|10 grid value actually sent
  quality: 'speed' | ...;                   // as sent
  imageUrlSha256: string | null;            // sha256 of the exact data-URL bytes
  withAudio: boolean;                       // as sent
}
export function shotCacheFingerprint(req): { json: string; sha256: string };
//   canonical JSON (sorted keys, stable separators) → sha256 hex (64 lowercase)

export interface CachedShotClip {
  buffer: Buffer; model: string; taskId: string;
  nativeInfo: object; hasAudio: boolean; storedAt: string;
}
export async function shotCacheLookup(fingerprint: string): Promise<CachedShotClip | null>;
//   read sidecar+media, strict shape check, size>0, re-validate via
//   validateVideoBuffer (reuse-time validation), on any flaw: delete entry,
//   count 'invalid', return null (→ caller regenerates)
export async function shotCacheStore(fingerprint: string, clip: CachedShotClip): Promise<void>;
//   only called AFTER validateVideoBuffer ok (completed+validated);
//   write .tmp + rename (atomic-ish), sidecar JSON; best-effort (never fails the run)
export function shotCacheStats(): { hits; joined; misses; invalid; bypass; stores; evictions; bytesStored; entries };
export function joinInFlight<T>(fingerprint: string, job: () => Promise<T>): Promise<T>;
//   in-flight dedupe (tts-cache pattern); 2nd caller with same fingerprint joins
//   the running promise ('joined' counter — honest "avoided call" class)
```

`generateVideoClip` wiring (pseudocode):

```
fp = fingerprint(req)                        // bypass flag for tests/tools
if (!opts?.bypassCache) {
  hit = await shotCacheLookup(fp)  →  return clip (fromCache: true, stats.hits++)
  existing in-flight? → join (stats.joined++) → return (fromCache: true)
}
… existing submit→poll→download→validate …
on success: shotCacheStore(fp, …) (stats.misses++ counted before submit)
```

**Honest labeling**: `AiVideoClip` gains optional `fromCache?: boolean`;
`generateAiShot` renders `শট N: প্রকৃত AI (ক্যাশ-হিট, <model>)` and
`ShotEngineRecord` gains `cacheHit?: boolean` — cached clips are real AI output
previously generated for a byte-identical request; the label says so. No FFmpeg
output is ever labeled AI (existing §4.3 rule untouched).

### 3.3 Cache-key schema — what is in, what is out, and why

| Field | In key? | Rationale |
|---|---|---|
| schema version `v` | ✅ | any change to request shape/codecs/validation auto-invalidates |
| model + provider channel | ✅ | output distribution differs per model; channel is the fixed z-ai cloud video endpoint (no per-user config exists for video — unlike LLM `baseURL` overrides) |
| prompt (exact, trimmed) | ✅ | the primary output determinant |
| negative prompt | n/a | `AiVideoRequest` has no negative-prompt field (verified) |
| durationSec (as sent) | ✅ | 5 vs 10s grid |
| quality (as sent) | ✅ | 'speed' today |
| imageUrl bytes hash | ✅ | sha256 of the full data-URL string — i2v reference identity |
| withAudio | ✅ | affects provider request + returned streams |
| seed / other params | n/a | request carries none (verified `AiVideoRequest`) |
| width/height/fps | ❌ **deliberate** | NOT provider inputs — they are the *local* ffmpeg normalization applied after (`motion_video.ts:195-205`); re-applied deterministically on every hit, so the final clip is identical to a fresh generate+normalize. Including them would only reduce reuse with zero safety gain. (REG-10c proves hit → normalized output equals fresh → normalized output byte-path) |
| `requestKey` | ❌ | §10 idempotency key (productionId+shotIndex) — not an output determinant; per-run only |
| `onStatus` / `isCancelled` | ❌ | behavioral callbacks, not request content |

Canonical serialization: `JSON.stringify` with fixed key order → `sha256` (hex).
No user-controlled string ever touches a path: the on-disk name **is** the hex
fingerprint (tts-cache's `<first2>/<next2>/<hash>` sharding pattern).

### 3.4 Safety & ownership

| Concern | Guarantee |
|---|---|
| Path traversal | impossible — paths built only from 64-char hex fingerprint + fixed root |
| Reuse validity | store **only** post-`validateVideoBuffer` clips; lookup re-validates; invalid → evict + count + miss |
| Concurrency | in-flight dedupe map (join, no duplicate submits); `.tmp`+rename writes; the provider gate (single in-flight submit) is untouched and still bounds real submits |
| Cache vs temp separation | cache lives at `storage/shot-cache/` — **outside** `storage/productions/{id}`; `cleanupWorkingDir` (`rm -rf` per-run working dir) can never touch it; no cleanup path enumerates the cache root except explicit eviction |
| Disk budget | default cap `SHOT_CACHE_MAX_BYTES = 512 MiB` (module constant, overridable via `globalThis.__shotCacheRootOverride`-style test hook only); FIFO eviction by `storedAt` with `evictions` counter; per-entry size recorded in sidecar |
| Observability | `shotCacheStats()` mirrors `ttsCacheStats()`; counters wired into the production metrics line (Workstream D). **No savings claim without these real counters** — test assertions use the counters themselves |
| Trade-off | identical request → identical clip (no fresh variation). Strict fingerprint (any prompt/image/model change → miss) is the mitigation; documented in code comment + report |

Invalidation strategy: content-addressed — no TTL (a validated clip for a
byte-identical request stays valid); schema bump `v` is the manual nuke; evictions
are size-driven only.

### 3.5 Files

| File | Change |
|---|---|
| `src/lib/agent/video/shot_cache.ts` | **new** — fingerprint, lookup/store, stats, in-flight, eviction, test root override |
| `src/lib/agent/video/ai_video.ts` | `generateVideoClip` cache wiring + `AiVideoClip.fromCache` + stage timings (Workstream D co-located) |
| `src/lib/agent/production/pipelines/motion_video.ts` | honest cache-hit label + `ShotEngineRecord.cacheHit` |
| `tests/regression/t10-shot-cache-reuse.test.ts` | **new** — REG-10 |

### 3.6 REG-10 tests

Cache root overridden to a temp dir (`globalThis.__shotCacheRootOverride`,
set/reset per test — the storage/ guarantee holds). Real tiny MP4 fixture
(ffmpeg `testsrc2`, generated once per run) as the "provider output";
SDK boundary mocked for the `generateVideoClip` integration tests.

| ID | Class | Assertion |
|---|---|---|
| REG-10a | same input → validated hit | 2nd identical call: no 2nd provider submit (call-log), `fromCache`, stats `hits=1, misses=1, stores=1` |
| REG-10b | changed input → miss | any single field changed (prompt / imageUrl hash / duration / model / quality / withAudio / schema v) → miss + store under a different key |
| REG-10c | hit output equivalence | hit path → normalized clip equals fresh-generate → normalized path (same ffmpeg normalization, real bytes) |
| REG-10d | invalid entry discarded | corrupt media bytes on disk → lookup evicts, counts `invalid`, caller regenerates (miss) |
| REG-10e | in-flight join | two concurrent identical calls → one submit, both resolve, `joined=1` |
| REG-10f | bypass | `bypassCache` → provider called, no store, `bypass` counted |
| REG-10g | eviction honesty | tiny byte cap → oldest entries evicted, `evictions`/`bytesStored` truthful |
| REG-10h | path safety | fingerprint is 64-hex; no API accepts a user path; directory listing contains only hex names |
| REG-10i | prewarm interplay | `prewarmVideoClip` on cached request → resolves from cache, no submit |
| REG-10j | counter honesty | stats never claim a store/hit that did not happen (sequential assertions) |

---

## 4. Workstream D — queue / retry / latency (Medium-high)

### 4.1 Evidence base (Phase-1, historical real run `yrz3ymb7`)

generate_shots 1,079.7s (~75% of 1,436s) · queue wait 25.1s · character_bible
152.1s · final_mix 129.9s (~4.3× realtime for a 30s film). n=1 production — no
percentiles claimed.

### 4.2 Design — stage-level metrics (additive, redaction-safe)

`src/lib/agent/run-metrics.ts` gains a **production-scoped accumulator**
(`getProductionMetrics(productionId)`), extending the existing one-line-per-
production principle (LOW VOLUME unchanged — aggregated, not per-shot lines):

```ts
interface ProductionMetricsAcc {
  shotsRequested, shotsFromCache, shotsJoined, providerSubmits: number;
  submitMsTotal, pollMsTotal, downloadMsTotal, validateMsTotal: number;
  cacheStores, cacheInvalid: number;          // from shot_cache (C)
  stageNotes: string[];                        // bounded, redacted
}
```

`generateVideoClip` records per-shot stage durations (`submit/poll/download/
validate`) + cache outcome into the accumulator (productionId via a scoped
context — the same AsyncLocalStorage-free globalThis pattern the ffmpeg tracker
uses, keyed by the current production; chat-path runs unaffected).
`logProductionMetrics` line gains these fields (all counts/durations/enums —
**redaction rules unchanged**: no prompts, no URLs, no user content).

### 4.3 Retry / cancellation / concurrency audit (verify + document, fix only real gaps)

| Path | Existing bound (verified in Step 1) | Verdict |
|---|---|---|
| ai_video submit | 429 ladder [15,30,60,90,120]s inside an 8-min submit budget; non-429 submit errors rethrow immediately (permanent ≠ retried) | keep — REG-6 locked |
| ai_video poll | adaptive 10→45s, 15-min timeout, 429 tolerated in poll | keep |
| TTS | profile-chain fallback (≤5/7 bounded); engine-level failure skips engine; permanent errors (403) not retried on the same engine | keep — t1/t8 lock |
| LLM chat | `withRetry` bounded attempts + ms budgets + cooldown fast-fail | keep — REG-6 locked |
| ffmpeg | no retry (local, deterministic) | keep |
| Cancellation | `checkCancelled` at every step start + per-shot; `isCancelled` 2s ticks inside provider polls; 5s ffmpeg kill-watch; `CancelledError` name-contract | keep — t2/t7 lock parts |
| Concurrency | `MAX_CONCURRENT=2` productions; single-task video gate + 150s cooldown | **unchanged invariant** (no unbounded parallelism introduced anywhere) |

Deliverable: the audit table above lands in `latency-results.md` with code
references; any *new* code (stage metrics, shot cache) must respect the same
invariants (bounded, cancellation-checked, no parallel submit).

### 4.4 Improvement claims policy

- Local, measurable now: loudnorm cost added to final_mix (fixture, n=3,
  before/after wall-time); cache-hit serve time vs store time (fixture, real fs).
- Provider-side latency: **NOT RUN** this phase (no live budget) — any future
  claim needs comparable before/after + sample size ≥ 10 (Phase-1 §7 list).

### 4.5 Files

| File | Change |
|---|---|
| `src/lib/agent/run-metrics.ts` | production accumulator + extended `logProductionMetrics` fields (additive) |
| `src/lib/agent/video/ai_video.ts` | stage timing + cache-outcome recording (co-located with C wiring) |
| `src/lib/agent/production/runner.ts` | pass accumulator into `logProductionMetrics` call sites (2 places, additive) |
| `tests/regression/t11-production-stage-metrics.test.ts` | **new** — REG-11 |

### 4.6 REG-11 tests

| ID | Class | Assertion |
|---|---|---|
| REG-11a | stage fields present | a (mocked-provider) `generateVideoClip` run records submit/poll/download/validate durations ≥ 0 into the accumulator |
| REG-11b | redaction | metrics line + stageNotes contain no prompt text / URL / user content even when injected into surrounding contexts |
| REG-11c | bounded volume | exactly one production-metrics line per production end; accumulator map size safety valve works |
| REG-11d | counters coherent | shotsRequested == fromCache + joined + providerSubmits |

---

## 5. Cross-workstream regression & sequencing

1. Full suite (`bun run test`) must stay green after **each** workstream lands;
   existing REG-1…REG-7 assertions are never weakened (t1/t2/t3/t4 untouched;
   t5/t6/t7 untouched).
2. Order: A (t8) → B (t9) → C (t10) → D (t11) — C and D share `ai_video.ts`
   wiring, so C lands the cache first, D adds timing on top.
3. `bun run typecheck` + `bun run lint` + `bunx prisma validate` after each
   workstream; `next build` NOT RUN (sandbox rule) — recorded as such.
4. Isolation contract (tests/README.md) extended for the new files: mocked SDK
   boundary for t10/t11 integration parts; cache root override for t10; real
   ffmpeg only on temp paths; dev DB untouched (md5 before/after recorded).

## 6. Risks / rollback / budget

| WS | Risk | Mitigation | Rollback |
|---|---|---|---|
| A | behavior change in a working pipeline | helper is pure extraction + shared-abstraction swap; timing/mixing untouched; REG-8 covers 7 classes | revert narration block to direct `cachedSynthesizeSpeech` (single hunk) |
| B | audio character change from normalization; loudnorm dynamic-mode edge | linear=true (static gain within limits); TP enforced; deviation-threshold issue; real ebur128 verification in tests | unwrap the normalization call in `mixSoundLayers` (helpers remain, unused) |
| C | wrong reuse; disk growth; double-submit races | strict sha256 fingerprint; reuse-time re-validation; hex-only paths; in-flight dedupe; size cap + eviction; bypass flag | remove lookup/store calls from `generateVideoClip` (2 hunks); disk cache left inert |
| D | metrics overhead/noise | in-memory counters + one JSON line per production end; unmeasured → null | revert wiring; accumulator inert |

**Budget**: zero live provider calls; zero DB writes outside tests (fake-db / no
DB at all in new tests); zero writes to `storage/` in tests (override roots /
temp dirs only); no new dependencies (bun:test, node:crypto, node:fs — all
existing). No commits / no pushes without explicit user approval (workflow Step 6).
