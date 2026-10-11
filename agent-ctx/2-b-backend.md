# Task 2-b — Backend Agent Work Record

## Scope delivered
- `src/lib/agent/` — storage.ts, events.ts, llm.ts, serialize.ts, registry.ts, orchestrator.ts
- `src/app/api/` — tools, conversations (GET), conversations/[id] (GET/DELETE), chat (POST), runs/[id]/events (SSE GET), artifacts/[id] (GET), artifacts/[id]/file (GET)

## Key implementation facts (for later agents)
- LLM JSON protocol: model replies `{"tool":"name","arguments":{...}}` as the WHOLE message → tool call; anything else = final Markdown answer. Tool results return as role-'user' messages: `[TOOL_RESULT] name: X\nstatus: success|error\n<json>`.
- System prompt is sent as the FIRST message with role **'assistant'** (SDK convention), Bengali, includes tool catalog + honesty rules + "translate image prompts to English".
- Parser accepts: whole-text JSON, ```json fences, first-`{`-to-last-`}`; shapes `{"tool","arguments"}` and `{"tool_call":{...}}`; array → first element with a `tool` key.
- MAX_STEPS=8, then one forced no-tool final call; stepCount capped at 8 when forced.
- Attachment pre-steps: user image uploads auto-analyzed (analyze_image) and audio auto-transcribed BEFORE the loop; results enter context as "ব্যবহারকারীর অ্যাটাচমেন্ট (file) বিশ্লেষণ: …".
- SSE: subscribe-first → DB replay → flush queued live events (dedupe by activityId/status) → 1.5s DB diff-poll + live bus + 15s ping; clean close after run_finished; works even across HMR because of the DB poll.
- TTS: API currently rejects `response_format:'mp3'` (400/1214) → tool falls back to 'wav'; artifacts carry the real mimeType (audio/wav). Frontend <audio> plays wav fine.
- LLM adapter retries 429/5xx up to 3× (2.5s/6s backoff) before failing a run.
- All test conversations + artifact files were deleted after E2E (clean slate).

## E2E results (all passed)
1. GET /api/tools → 8 tools
2. Simple chat → runId → SSE message+run_finished → conversation shows assistant msg (title, activities, runStats)
3. Web search chat → web_search ToolCall done + visible in assistant activities
4. Image gen chat → image artifact + /file 200 image/png + file on disk
(+ search_images/302, TTS/wav, ASR, attachment/VLM, failure paths, DELETE, 404s)

---
## Sprint-2 Task ID: 2-b (Unlock Master Plan — Backend Hardening)
Agent: full-stack-developer (backend)
Date: 2026-10-11

### Scope touched (backend only)
src/lib/agent/sdk-helpers.ts, src/lib/agent/registry.ts, src/lib/agent/video/ai_video.ts,
src/lib/agent/video/lip_sync_module.ts, src/lib/agent/video/capability_router.ts,
src/lib/system-info.ts, src/lib/agent/prompts.ts,
src/lib/agent/production/pipelines/{motion_video,music_video,short_film}.ts

### Key changes (§10 / §7.1 / §8)
1. sdk-helpers.ts: withRetry rewritten — Retry-After parse (err.retryAfter / headers / message-text; seconds|HTTP-date),
   full-jitter exp backoff random(baseMs/2, baseMs*2^attempt) capped 90s, configurable attempts (default 4);
   429-exhaustion → exported TemporarilyUnavailableError with `TEMPORARILY_UNAVAILABLE:` prefix (429 ≠ license issue).
   New: imageSearchSdkFirst(query, count) → SDK zai.images.search.create first (gl:'us', rank:false), CLI fallback
   (node_modules/.bin/z-ai image-search, 150s timeout), normalized {results:[{url,caption,source,width?,height?}], via}.
   Also exported: parseRetryAfterMs, fullJitterDelayMs, isRateLimitErrorText. All old exports intact.
2. registry.ts search_images: now uses imageSearchSdkFirst; resultJson = {via:'sdk'|'cli', results:[...]}; tool timeout 240s.
3. ai_video.ts: AiVideoRequest.requestKey? → deriveRequestId(sanitized key + sha1(prompt)10) passed as request_id
   (stable across 429-retries → provider dedupe). validateVideoBuffer(buffer, {expectAudio}) → VideoValidation
   {ok, issues, info, hasAudio, audioCodec?}; issue 'অডিও-স্ট্রিম নেই' ONLY when expectAudio. AiVideoClip.nativeAudio.
   Submit backoff: Retry-After-aware + full-jitter exp (60s base → 90s cap); 429-exhaustion → TEMPORARILY_UNAVAILABLE:,
   5xx/timeout-exhaustion → honest generic message.
4. lip_sync_module.ts: LIP_SYNC_STATUS now carries license:'needs_review' (Wav2Lip academic-only; SadTalker/MuseTalk separate),
   provider:'not_exposed_by_sdk', hardware:'unavailable_hardware' (4–12GB VRAM, no GPU), integration:'not_integrated',
   benchmark:'not_done' (+singing extra-benchmark note) + LIP_SYNC_BLOCKAGE_NOTES. Report keeps old shape +
   new blockageDimensions. runLipSync error mentions all 4 dimensions + fallback.
5. capability_router.ts: new VideoRequestKind 'video_native_audio' (ready, CogVideoX-3 with_audio, probe-verified AAC note) + label.
6. system-info.ts statics: +image-search (ok, SDK probe-verified 2026-10-11, CLI fallback), +video-audio (ok, real AAC stream),
   lip-sync note → '৪-মাত্রিক বাধা: SDK-তে API নেই · GPU নেই · অ্যাডাপ্টার নেই · বাংলা বেঞ্চমার্ক হয়নি'.
7. prompts.ts: honesty rules for withAudio (native AAC, ffprobe-verified) and 429="সাময়িক রেট-লিমিট" never license issue.
8. pipelines: generateAiShot accepts requestKey → passes to generateVideoClip; call sites pass
   `${ctx.productionId}-shot-${i+1}` (motion), `mv-…`/`sf-…` (music_video/short_film).

### Verification
- bunx tsc --noEmit → 0 errors in src/ (pre-existing errors only in examples/, skills/, tmp-task2d/ — untouched).
- bunx eslint <all 10 touched files> → 0 errors; bun run lint (whole project) → 0.
- Smoke tmp-sprint2/retry-policy-smoke.ts (bun): 21/21 pass — jitter bounds [floor, cap], exponential ceiling growth,
  429-exhaustion → TemporarilyUnavailableError + prefix, 503-exhaustion → generic honest error, Retry-After parse
  (seconds/headers/message/HTTP-date) + honored in backoff, real imageSearchSdkFirst call → via:'sdk', 3 results 2.2s.
- curl: /api/tools 200, /api/registry 200, /api/availability 200, /api/system 200 (new static entries live in response).
- dev.log tail: no compile errors (only expected SDK 429/400 logs from in-flight traffic).
- No test data created (smoke never touches DB) — nothing to clean.

### Notes for next agents
- UI can key "সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট)" off message prefix `TEMPORARILY_UNAVAILABLE:` (error class TemporarilyUnavailableError).
- lipSyncCapabilityReport().blockageDimensions now available for registry/matrix UI rendering.
- generate_video/image_to_video tool schemas (tools/video.ts — out of my scope) do not yet expose withAudio param;
  the capability is live at the module/pipeline level (AiVideoRequest.withAudio) and advertised via video_native_audio route.
