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
