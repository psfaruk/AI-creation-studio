# Task 2-c — Audio Studio Agent Work Record

## Files delivered (only these two)
- `src/lib/agent/tools/audio.ts` — AUDIO_TOOLS (8 tools) + shared exported helpers
- `src/lib/agent/production/pipelines/audio.ts` — audioPipeline (voiceover / music_plan / process)

## Tools (names match TOOL_CATALOG exactly)
- `plan_music` — chatJson STRICT JSON → sanitized MusicPlan → Bengali text document (tথ্য: তথ্য/সেকশন-টেবিল/লিরিক্স/ইনস্ট্রুমেন্ট/musicModelPrompt) → `song-plan.txt` text artifact; resultJson = parsed plan object.
- `generate_instrumental`, `generate_singing`, `separate_stems` — GATED: always throw with the mandated Bengali message (license policy / Demucs not installed), each usage string says পরীক্ষামূলক/অবরুদ্ধ.
- `process_audio` — 9 ops via runFfmpeg to temp dir (makeTempDir + cleanupWorkingDir in finally): trim(-ss/-t), concat(aformat→concat filter), fade(afade, needs mediaInfo for fade-out start), volume(dB), normalize(loudnorm=I=-16:TP=-1.5:LRA=11 **+ aresample** — loudnorm dynamic mode outputs 192kHz without it), eq(bass=g / treble=g chained), compress(acompressor=-18dB:3:15:200), reverb(aecho, honest label 'প্রায়-রিভার্ব'), convert(-ar/-ac/libmp3lame 192k or pcm_s16le). Output format defaults to source's (mp3→mp3), mime audio/wav|audio/mpeg. Cross-field zod validation via superRefine (Bengali issue messages, e.g. eq requires bassDb|trebleDb).
- `mix_audio` — 2–4 tracks; per track `aformat=sample_fmts=fltp:...` (+NOTE: option is `sample_fmts`, plural — singular fails on ffmpeg 7.1) + optional afade pair (crossfadeSec) + volume + adelay(`all=1`). duckMusicUnderVoice: last track asplit → side branch delayed same ms → `sidechaincompress=threshold=0.03:ratio=8:attack=20:release=400` on track 0. Then `amix=inputs=N:normalize=0,alimiter=limit=0.971:level=false` → wav artifact.
- `validate_audio` — audioQuality() + own precise ebur128 pass (see gotcha) → Bengali report lines + one-line verdict; resultJson = full report incl. `report` text field.
- `inspect_media` — mediaInfo → {durationSec, hasVideo, hasAudio, width, height, fps, videoCodec, audioCodec, sampleRate, channels, sizeBytes} + Bengali summary.

## Shared exports from tools/audio.ts (pipeline reuses — no ctx faking)
`planMusicContent(idea, opts)` → {plan, document}; `formatMusicPlanDocument(plan, opts)`; `chunkScriptForTts(text, max=950)` (splits at । ? ! . \n, keeps order, hard-splits overlong sentences at spaces); `toBn`; `fmtDb`; `slugifyTitle` (keeps Bengali letters); `slugifyFileName`; `measureLoudnessPrecise`.

## Pipeline (audioPipeline)
- Dispatches on `spec.audioOperation` (default 'voiceover').
- voiceover: prepare (chunk ≤950 chars, detail 'স্ক্রিপ্ট N অক্ষর → Mটি অংশ') → synthesize (per chunk: checkCancelled, synthesizeSpeech, 1 retry, mediaInfo duration check, failure → partialNotes + continue, detail 'X/Y অংশ সম্পন্ন'; all-failed → throw) → master (concat filter (or single) + loudnorm → master.wav; libmp3lame 192k → master.mp3) → validate (duration>0, peak ≤ -0.1dB, sampleRate 44100/48000 → clipping/rate anomalies to partialNotes; registers `${slug}.wav` + `${slug}.mp3` audio artifacts). Returns {result: {quality (Bengali one-liner + durationSec + chunks count), durationSec, chunks, voice, targetDurationSec}}.
- music_plan: planMusicContent inline → song-plan.txt via ctx.registerArtifact. NOTE: validateSpec always sets durationSec for type audio (default 60).
- process: sourceAudioArtifactIds → (concat if >1) + loudnorm master + validate (reuses buildMaster/validateAndRegister helpers).

## Gotchas discovered (for later agents, esp. video/music_video)
1. **Shared audioQuality's loudnessLufs is unreliable** — its regex takes the FIRST `I: ... LUFS` match, which is a live-line partial value (often -70). ffmpeg.ts is shared/untouchable, so `measureLoudnessPrecise` (last-match parse of a separate ebur128 pass) is exported from tools/audio.ts — use it whenever you need real LUFS.
2. **aformat option is `sample_fmts`** (plural) — `sample_fmt` fails with "Option not found" on ffmpeg 7.1.
3. **loudnorm single-pass upsamples to 192 kHz** — always chain `aresample=44100` (or set -ar).
4. **sidechaincompress consumes the sidechain input** — to also mix the voice, `asplit` it and delay BOTH branches by the same start offset so ducking stays time-aligned.
5. Artifact.runId is a FK to AgentRun — in standalone scripts create a real AgentRun row before createToolArtifact.
6. TTS server still rejects mp3 (400/1214) → synthesizeSpeech wav fallback works; SDK logs the 400 noisily (harmless).
7. `bun /tmp/...` import of project files via absolute path works (per-file tsconfig alias resolution OK); Write tool can't write outside /home/z — temp tests were placed at project root and deleted after.

## Verification done (all green, test files deleted after)
- Pure fn tests (chunking, doc format), zod invalid paths, 3 gated tools → 17/17 PASS with exactly 1 real TTS call + 1 LLM call (plan_music live: 5 sections + Bengali lyrics + doc).
- Pipeline E2E via direct DB Production (queued → startProduction): status completed, 4 steps done, `বর্ষার-চিঠি.wav` (1.15MB) + `.mp3` (159KB) artifacts, honest quality line (1 silent range detected). All rows/files/conversation cleaned.
- `bunx eslint` both files: zero errors; `tsc --noEmit`: zero errors in my files; pipeline import check OK; `curl /api/tools` 200 with all 8 audio_studio tools; dev.log: no compile errors from my modules.

## Pre-existing issues NOT mine (for main agent)
- `src/lib/agent/tools/production.ts`: propose_job + create_character missing required `usage` (ToolSpec) → 2 TS errors.
- `src/hooks/use-productions.ts(74)`: `productionId` not on ProductionEvent type → TS error.
- dev.log prisma:error on toolCall.update = parallel agent deleted a conversation mid-run (not from my change).
