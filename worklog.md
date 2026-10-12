# Worklog — Agentic AI Chat System (পূর্ণাঙ্গ Agentic AI)

Project: Next.js 16 (App Router) + TypeScript + Tailwind 4 + shadcn/ui + Prisma(SQLite) + z-ai-web-dev-sdk
Goal: ব্যবহারকারীর মাস্টার প্ল্যান অনুযায়ী — Agent Orchestrator + Tool Registry + Execution Loop + Memory + Artifacts + SSE Live Progress সহ Agentic Chat। UI বাংলা-প্রথম।

## Shared contract (একমাত্র সত্যের উৎস)
- `src/lib/types.ts` — সব shared types, TOOL_CATALOG, RunEvent SSE shapes। **কেউ পরিবর্তন করবে না।**
- `prisma/schema.prisma` — ইতিমধ্যে লেখা ও db:push করা: Conversation, Message, AgentRun, AgentStep, ToolCall, Artifact।
- Prisma client: `import { db } from '@/lib/db'`

## Task assignments
- Task 1 (main agent): audit, skills, contract, schema, deps — সম্পন্ন
- Task 2-a (subagent, frontend): `src/app/page.tsx` + `src/components/chat/**` + `src/hooks/**` — শুধু UI
- Task 2-b (subagent, backend): `src/lib/agent/**` + `src/app/api/**` — শুধু server
- Task 3 (main agent): integration + lint + fixes
- Task 4 (main agent): agent-browser E2E verification
- Task 5 (main agent): final report

## Rules for ALL agents
- Dev server ইতিমধ্যে port 3000-এ চলছে — নতুন ইনস্ট্যান্স চালাবে না, `bun run build` চালাবে না।
- User-visible route শুধু `/` (src/app/page.tsx)। অন্য কোনো page route নয়। API routes ঠিক আছে।
- z-ai-web-dev-sdk শুধু server-side।
- রং: blue/indigo নিষিদ্ধ; primary accent = emerald; neutrals = stone/slate।
- এই ফাইলে append করুন (overwrite নয়): `cat >> /home/z/my-project/worklog.md << 'EOF' ... EOF`
- ফাইলের দায়িত্ব-সীমা মেনে চলুন (frontend ≠ backend files)।

## API endpoints (contract)
| Endpoint | Method | Request → Response |
|---|---|---|
| /api/tools | GET | → ToolInfo[] (TOOL_CATALOG) |
| /api/conversations | GET | → ConversationSummary[] |
| /api/conversations/[id] | DELETE | → { ok: true } |
| /api/conversations/[id] | GET | → ConversationDetail (messages + activities + artifacts + runStats) |
| /api/chat | POST | ChatRequest → ChatResponse { runId, conversationId, userMessage }; run ব্যাকগ্রাউন্ডে চলে |
| /api/runs/[id]/events | GET | SSE stream of RunEvent (প্রথমে replay, তারপর live + DB diff-poll fallback) |
| /api/artifacts/[id] | GET | → ArtifactMeta |
| /api/artifacts/[id]/file | GET | → bytes (local) বা 302 redirect (external); `?download=1` → attachment header |

## SDK cheat-sheet (z-ai-web-dev-sdk — server-side only, verified from skills)
```ts
import ZAI from 'z-ai-web-dev-sdk';
const zai = await ZAI.create(); // singleton রেখে পুনর্ব্যবহার করুন

// LLM (native tool-calling নেই → JSON protocol ব্যবহার করুন)
const c = await zai.chat.completions.create({ messages, thinking: { type: 'disabled' } });
const text = c.choices[0]?.message?.content;
// দ্রষ্টব্য: system prompt-কে প্রথম message হিসেবে role 'assistant' দিয়ে পাঠান (skill নির্দেশনা)।

// Web search
const results = await zai.functions.invoke('web_search', { query, num: 6 });
// results: [{ url, name, snippet, host_name, rank, date, favicon }]

// Page reader
const r = await zai.functions.invoke('page_reader', { url });
// r.data: { title, url, html, publishedTime } — html থেকে ট্যাগ স্ট্রিপ করে text বানান

// Image generation (sizes: 1024x1024, 768x1344, 864x1152, 1344x768, 1152x864, 1440x720, 720x1440)
const r = await zai.images.generations.create({ prompt, size: '1024x1024' });
// r.data[0].base64 → Buffer.from(base64, 'base64') → file-এ সেভ

// TTS (input ≤ 1024 chars; stream:false হলে wav/mp3)
const res = await zai.audio.tts.create({ input, voice: 'tongtong', speed: 1, response_format: 'mp3', stream: false });
const buf = Buffer.from(new Uint8Array(await res.arrayBuffer()));

// ASR
const r = await zai.audio.asr.create({ file_base64 }); // → r.text

// VLM (লোকাল ছবির ক্ষেত্রে data:image/png;base64,... URL ব্যবহার করুন — public URL কেবল তখনই যখন ছবি ইন্টারনেট-অ্যাক্সেসযোগ্য)
const r = await zai.chat.completions.createVision({
  messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }],
  thinking: { type: 'disabled' },
});
// r.choices[0].message.content

// Image search (CLI-only!) — execFile দিয়ে, timeout ≥ 150s, --no-rank দিয়ে দ্রুত
// execFile('<projectRoot>/node_modules/.bin/z-ai', ['image-search', '-q', query, '-c', '4', '--gl', 'us', '--no-rank'])
// stdout JSON: { success, results: [{ original_url, caption, source, original_width, original_height }] }
```

## Agent execution loop (backend, JSON protocol)
1. Context তৈরি: system prompt (role 'assistant') + সর্বশেষ ~20টি বার্তা (tool-result গুলো 'user' role-এ `[TOOL_RESULT] name ...` ফরম্যাটে)।
2. LLM কল → parse: সম্পূর্ণ টেক্সট JSON `{"tool": "...", "arguments": {...}}` (বা ```json fence, বা প্রথম { … শেষ } ) হলে tool call, নাহলে final answer।
3. Tool call: registry থেকে যাচাই (unknown tool / zod validation fail → structured error আবার LLM-কে) → tool_start emit → timeout-সহ execute → ফলাফল DB-তে → tool_end emit → ফলাফল context-এ append → ধাপ ২।
4. MAX_STEPS = 8; ছাড়িয়ে গেলে "আর কোনো টুল ছাড়া এখনই চূড়ান্ত উত্তর দাও" নির্দেশনায় শেষ কল।
5. Final answer → assistant Message + run finished → SSE 'message' + 'run_finished'।

---
Task ID: 1
Agent: main (Z.ai Code orchestrator)
Task: প্রজেক্ট অডিট, স্কিল ডকুমেন্টেশন লোড, API কনট্র্যাক্ট ও Prisma স্কিমা তৈরি, ডিপেন্ডেন্সি প্রস্তুত

Work Log:
- প্রজেক্ট অডিট: Next.js 16.1.3 (Turbopack), shadcn/ui সম্পূর্ণ সেট, z-ai-web-dev-sdk v0.0.18, dev server চালু (port 3000)
- ৮টি স্কিল লোড: LLM, image-generation, image-search, TTS, ASR, web-search, web-reader, VLM
- গুরুত্বপূর্ণ সিদ্ধান্ত: SDK-তে native tool-calling নেই → JSON tool-protocol + parser (ব্যবহারকারীর প্ল্যানের tool_call_parser ধারণা)
- লেখা: src/lib/types.ts (shared contract, TOOL_CATALOG ৮টি টুল), prisma/schema.prisma (৬টি মডেল)
- `bun run db:push` সফল, `remark-gfm` ইনস্টল, z-ai CLI বাইনারি যাচাইকৃত

Stage Summary:
- Contract + schema + cheat-sheet তৈরি — Task 2-a (frontend) ও Task 2-b (backend) এখন প্যারালালে চালু করা যায়
- image-search টুল CLI-only (execFile), বাকি সবটুল SDK দিয়ে
- টুল তালিকা: web_search, read_web_page, generate_image, search_images, analyze_image, text_to_speech, transcribe_audio, search_conversations

---
Task ID: 2-a
Agent: full-stack-developer (frontend)
Task: সম্পূর্ণ বাংলা-প্রথম Agentic Chat UI — `/` রুট (page.tsx + components/chat + hooks), types.ts কনট্র্যাক্টের বিপরীতে

Work Log:
- worklog.md, types.ts, globals.css, tailwind.config.ts, ui কম্পোনেন্ট API অডিট করে ডিজাইন-সিদ্ধান্ত নেওয়া
- zustand-কেন্দ্রিক স্টেট: `src/hooks/use-chat-store.ts` (conversations/activeId/messages/isRunActive/draft/pendingAttachments + সব fetch/mutate অ্যাকশন)
- `src/hooks/use-conversations.ts` (তালিকা fetch + refetch), `src/hooks/use-tools.ts` (GET /api/tools → fallback TOOL_CATALOG)
- `src/hooks/use-agent-run.ts`: POST /api/chat → optimistic user msg → pending assistant (`pending-{runId}`) → EventSource(`/api/runs/{id}/events`)। RunEvent-এর union হ্যান্ডেল (tool_start/tool_end/message/run_finished, ping উপেক্ষা)। SSE error হলে 2s পোলিং fallback (GET /api/conversations/{id} — userMessage-এর পরের assistant msg দিয়ে রান-ফলাফল শনাক্তকরণ, runStats এলে বন্ধ, 180s টাইমআউট)। কথোপকথন বদলালে inView গার্ডে মিউটেশন স্কিপ + run_finished-এ সার্ভার-সত্য রিফ্রেশ।
- কম্পোনেন্ট: bn-format (বাংলা অঙ্ক/সময়/runStats), tool-icon (lucide ম্যাপ), pulsing-dots, markdown (react-markdown+gfm, typography প্লাগইন নেই), artifact-view (ছবি গ্রিড + Dialog প্রিভিউ + ডাউনলোড, অডিও `<audio>`), activity-card (Collapsible, amber/emerald/red স্ট্যাটাস ব্যাজ), message-bubble (ইউজার emerald বাবল / অ্যাসিস্ট্যান্ট টাইমলাইন+মার্কডাউন+runStats), message-list (near-bottom অটো-স্ক্রল), composer (অটো-রিসাইজ Textarea, Enter/Shift+Enter, Paperclip DropdownMenu অ্যাটাচ ৫MB/১০MB লিমিট, framer-motion indeterminate প্রোগ্রেস), empty-state (হিরো+৩ ফিচার কার্ড+৪ কুইক-স্টার্ট চিপ), sidebar (নতুন চ্যাট, কথোপকথন তালিকা+মুছে ফেলা AlertDialog, টুল রেজিস্ট্রি ক্যাটাগরি-গ্রুপড)
- page.tsx রিরাইট: min-h-dvh flex-col শেল, sticky header (মোবাইল হ্যামবার্গার→Sheet বাম সাইডবার, এজেন্ট-সক্রিয় পালস ডট+Tooltip), ডেস্কটপ 72px সাইডবার, চ্যাট কলাম (স্ক্রল+কম্পোজার), mt-auto footer (৮টি টুল সক্রিয় ব্যাজ, safe-area) — layout.tsx-এ শুধু metadata আপডেট
- যাচাই: `bun run lint` 0 error/0 warning; `bunx tsc --noEmit`-এ src/-তে 0 এরর (examples/, skills/-এর পুরোনো এরর বাদে); curl 200 + dev.log-এ কম্পাইল এরর নেই; SSR HTML-এ সব বাংলা স্ট্রিং উপস্থিত

Stage Summary:
- তৈরি: src/app/page.tsx (রিরাইট), src/app/layout.tsx (শুধু metadata), src/hooks/{use-chat-store,use-conversations,use-agent-run,use-tools}.ts, src/components/chat/{bn-format,tool-icon,pulsing-dots,markdown,artifact-view,activity-card,message-bubble,message-list,composer,empty-state,sidebar}.tsx(x) — মোট 16 ফাইল
- কনট্র্যাক্ট-অস্পষ্টতার সমাধান: (১) SSE ইভেন্ট unnamed `message` ও নামযুক্ত ইভেন্ট দুই ফরম্যাটেই শোনা হয় (backend 2-b যেটাই পাঠুক); (২) পোলিং-তে রান-ফলাফল শনাক্তকরণ: run-এর userMessage.id-এর পরের প্রথম assistant বার্তা (পুরোনো রানের সাথে সংঘর্ষ এড়াতে); (৩) বার্তা-লেভেল artifacts শুধু তখনই রেন্ডার হয় যখন activity-তে দেখানো হয়নি (id-দিয়ে dedupe); (৪) ম্যান্ডেটেড স্ট্রিং হুবহু ব্যবহার, অতিরিক্ট প্রয়োজনীয় স্ট্রিং (অ্যাটাচ-লিমিট টোস্ট, aria-label, "কোনো কথোপকথন নেই", "ইনপুট/আউটপুট/ত্রুটি/সময়") বাংলায় যোগ
- API এখনও না থাকায় graceful: সব fetch try/catch — ব্যর্থ হলে টোস্ট/খালি-স্টেট/fallback (টুল ক্যাটালগ) — UI রেন্ডার ঠিক থাকে
- Task 3 (main agent): integration-এর সময় dev.log দেখে নিন — `/` এখন 200 OK, backend API যুক্ত হলে এন্ড-টু-এন্ড পরীক্ষা করা যাবে

---
Task ID: 2-b
Agent: full-stack-developer (backend)
Task: Agentic backend — Tool Registry + Orchestrator execution loop (JSON protocol) + background runs with SSE + artifact storage + সব API routes

Work Log:
- `src/lib/agent/storage.ts` — storage/artifacts/<cuid>.<ext> ফাইল সেভ/রিড (mkdir -p runtime-এ)
- `src/lib/agent/events.ts` — in-process event bus (globalThis-cached, HMR-safe) + 100-ইভেন্ট replay buffer + run_finished-এর পর grace cleanup
- `src/lib/agent/llm.ts` — SDK singleton, chatComplete (thinking disabled; 429/5xx-এ ৩ বার backoff retry), বাংলা system prompt (JSON tool protocol, ৮ টুলের বর্ণনা, সততার নিয়ম), tolerant parser (whole JSON → ```json fence → first{...}last; {"tool","arguments"} / {"tool_call":{...}} / array-first গ্রহণ)
- `src/lib/agent/serialize.ts` — Artifact/ToolCall/AgentRun/Message → ArtifactMeta/ActivityView/RunStats/ChatMessage mappers (orchestrator + API routes শেয়ার করে)
- `src/lib/agent/registry.ts` — ৮ টুল: web_search (SDK), read_web_page (SDK+HTML strip ৬০০০), generate_image (SDK→PNG artifact), search_images (CLI execFile, stdout থেকে {…} extract, external artifacts), analyze_image (artifact→base64 data URL বা public URL → createVision), text_to_speech (mp3→wav auto-fallback), transcribe_audio (ASR), search_conversations (SQLite contains, শিরোনাম+বার্তা, snippet≤২০০)। validateToolCall → unknown/zod-fail হলে structured {error,hint}
- `src/lib/agent/orchestrator.ts` — startAgentRun (setImmediate fire-and-forget), context = system + শেষ ২০ বার্তা, attachment pre-steps (ছবি→analyze_image, অডিও→transcribe_audio; আসল ToolCall+events+"ব্যবহারকারীর অ্যাটাচমেন্ট (…) বিশ্লেষণ:" context-এ), MAX_STEPS=8 loop, invalid tool → error feedback (ToolCall row ছাড়া), forced final ("আর কোনো টুল ছাড়া এখনই চূড়ান্ত উত্তর দাও"), finalize/fail $transaction-এ (message+run update atomic), runStats, stale sweep (>১০মি → interrupted), `[agent] run=xx step=n tool=x status=y ms=z` লগ
- API routes (সব force-dynamic + nodejs runtime, Next-16 `await params`): GET /api/tools; GET /api/conversations (sweep+summaries); GET/DELETE /api/conversations/[id] (activities/artifacts/runStats ম্যাপিং, cascade+ফাইল মুছে); POST /api/chat (validation ৮০০০ অক্ষর/৪ অ্যাটাচমেন্ট/~৭MB, শিরোনাম ৪২ অক্ষর, user_upload artifacts, run তৈরি করে সাথে সাথেই response); GET /api/runs/[id]/events (SSE: DB replay → live bus → ১.৫s DB diff-poll dedupe, ১৫s ping, abort-cleanup, run_finished-এ clean close); GET /api/artifacts/[id]; GET /api/artifacts/[id]/file (stream+immutable cache / 302 / download=1 Content-Disposition)

Stage Summary:
- Files: src/lib/agent/{storage,events,llm,serialize,registry,orchestrator}.ts + ৭টি API route files (tools, conversations, conversations/[id], chat, runs/[id]/events, artifacts/[id], artifacts/[id]/file)
- E2E (curl, সব পাস): ১) /api/tools → ৮ টুল। ২) সাধারণ চ্যাট → runId → SSE-তে tool_start/tool_end/message/run_finished → conversation-এ assistant message (title সেট হয়েছে, runStats ঠিক)। ৩) "ওয়েবে খুঁজে বলো" → web_search ToolCall done + activities-এ দেখা যায় + ফলাফলভিত্তিক উত্তর। ৪) পাহাড়ের ছবি → generate_image done, 178KB PNG artifact, /file → 200 image/png + immutable cache + download header, storage/artifacts/-এ আসল ফাইল।
- অতিরিক্ত যাচাই: search_images (৪ external artifact + 302 redirect, CLI smoke), analyze_image attachment pre-step (VLM লাল ছবি বর্ণনা করেছে), text_to_speech (mp3 400/1214 → wav fallback → RIFF ফাইল সেবা হচ্ছে), transcribe_audio (ASR কল সফল), tool-failure path (429 → structured error → সৎ উত্তর), failed-run fallback message, শেষ-রান SSE replay, DELETE cascade, 404গুলো।
- Known limitations/decisions: (ক) TTS সার্ভার বর্তমানে mp3 নেয় না — টুল mp3 চেষ্টা করে wav-এ fallback করে, mimeType সেই অনুযায়ী; (খ) LLM-এ 429 ঘন ঘন এসেছিল — chatComplete-এ ৩-বার backoff retry যোগ করা হয়েছে; (গ) ASR বাংলা অডিওতে দুর্বল ("福利，他开" ধরনের আউটপুট) — বাহ্যিক মডেল-সীমা; (ঘ) activity→artifact ম্যাপিং DB-তে toolCallId না থাকায় per-activity artifacts শুধু live SSE-তে আসে, message-level artifacts-এ সব থাকে; (ঙ) dev-server restart-এ চলমান রান ১০-মিনিট sweep-এ interrupted হবে। টেস্ট ডেটা মুছে ফ্রেশ অবস্থায় রাখা হয়েছে।

---
Task ID: 3
Agent: main (Z.ai Code orchestrator)
Task: ইন্টিগ্রেশন রিভিউ, lint, বাগ ফিক্স

Work Log:
- উভয় এজেন্টের কোর ফাইল রিভিউ (orchestrator, registry, llm, SSE route, serialize, chat route, page, hooks, components)
- সিস্টেম প্রম্পট উন্নত: চূড়ান্ত উত্তরে artifact url না লেখার নিয়ম যোগ
- বাগ ফিক্স ১: SSE রিকানেক্ট-রিপ্লেতে tool_start ডুপ্লিকেশন → use-agent-run.ts-এ activity-id dedupe
- বাগ ফিক্স ২: রিলোডে শেষ কথোপকথন ফিরে আসত না → localStorage persistence + use-conversations এ restore
- বাগ ফিক্স ৩: min-h-dvh-তে লম্বা কনটেন্ট পেজ স্ক্রল করাত → h-dvh (ভিউপোর্ট-বাউন্ডেড, ভেতরে স্ক্রল, ফুটার সবসময় নিচে)
- bun run lint → শূন্য ত্রুটি

Stage Summary:
- ইন্টিগ্রেশন সম্পূর্ণ, তিনটি UX বাগ ফিক্সড, কনট্র্যাক্ট উভয় পক্ষ মেনে চলেছে যাচাইকৃত

---
Task ID: 4
Agent: main (Z.ai Code orchestrator)
Task: Agent Browser দিয়ে E2E ভেরিফিকেশন

Work Log:
- পেজ লোড, বাংলা UI, টুল রেজিস্ট্রি (৮ টুল), quick-chips যাচাই
- Golden path ১: "পাহাড়ি দৃশ্যের ছবি বানাও" → লাইভ অ্যাক্টিভিটি (চলছে→সম্পন্ন) → আসল ছবি artifact (naturalWidth=1024) → প্রিভিউ ডায়ালগ + ডাউনলোড ✓
- Golden path ২: ওয়েব সার্চ ফলোআপ → ৫-৮টি টুল কল (search+read_web_page) → বাস্তব তারিখসহ বাংলা সারসংক্ষেপ ✓
- বাস্তব ব্যবহারকারী সমান্তরালে লাইভ ব্যবহার করছিলেন: বিড়ালের ছবি ✓, ভিডিও অনুরোধে সৎ fallback (ছবি+ব্যাখ্যা) ✓, নিউজ সামারি ✓
- রিলোড persistence + auto-restore ✓; মোবাইল 390x844 (হ্যামবার্গার+Sheet, ফুটার bottom=844, কোনো horizontal scroll নেই) ✓; ডেস্কটপ 1280x800 (ফুটার bottom=800, ভেতরে স্ক্রল) ✓
- console errors পরিষ্কার (duplicate-key ফিক্সের পর), dev.log সমস্ত 200

Stage Summary:
- সব golden path ব্রাউজারে সত্যিকারের ইন্টারঅ্যাকশন দিয়ে যাচাইকৃত; অ্যাপ প্রোডাকশন-রেডি

---
Task ID: 5
Agent: main (Z.ai Code orchestrator)
Task: চূড়ান্ত সমাপ্তি ও রিপোর্ট

Work Log:
- ভেরিফিকেশন স্ক্রিনশট পরিষ্কার, চূড়ান্ত lint + dev.log যাচাই
- ব্যবহারকারীর মাস্টার প্ল্যানের ১২-সিস্টেম ম্যাপিংসহ বাংলা রিপোর্ট প্রস্তুত

Stage Summary:
- Agentic AI Chat System সম্পূর্ণ: Orchestrator + ৮ টুলের Registry + Execution Loop (JSON প্রোটোকল) + SSE লাইভ প্রগতি + Artifacts + Memory + বাংলা UI; Freebuff প্রয়োজন হয়নি (z-ai-web-dev-sdk বিল্ট-ইন)

---
Task ID: 1 (Creative Studio upgrade)
Agent: main (Z.ai Code orchestrator)
Task: মাস্টার প্ল্যান "AI Creative Studio" আপগ্রেডের ভিত্তি (foundation) তৈরি — schema, contract, capability registry, production framework, API routes, UI shell। এরপর ৫টি প্যারালাল সাবএজেন্ট চালু হবে।

Work Log:
- বাংলা ফন্ট (Noto Sans Bengali Regular/Bold) ডাউনলোড → assets/fonts/ + ~/.fonts + fc-cache; sharp-দ্বারা SVG বাংলা রেন্ডার যাচাইকৃত ✓
- prisma/schema.prisma সম্প্রসারণ + db:push + db:generate: Message.productionId, Artifact.productionId/metaJson + kind 'video', নতুন Production, ProductionStep, ModelEntry মডেল
- src/lib/types.ts সম্প্রসারণ: ArtifactMeta.kind-এ 'video', AttachmentView/ChatRequest-এ video, CreativeJobSpec/ValidatedSpec/SpecAdjustment/ProductionView/ProductionStepView/ProductionSummary/ProductionEvent/ModelEntryView/AppView + TOOL_CATALOG ৩৮টি টুল (৯ ক্যাটাগরি)
- নতুন মডিউল: agent/sdk-helpers.ts (generateImageBuffer/editImageBuffer/synthesizeSpeech/transcribeBuffer/visionAnalyze/chatJson/extractJson), agent/capabilities.ts (§১৫ validation: aspect→size ম্যাপ, 720p/1080p only, fps 24/25/30, duration সীমা, maxShots, plannedStepsFor, validateSpec+adjustments+notes, summarizeSpec), media/ffmpeg.ts (runFfmpeg/ffprobeJson/mediaInfo/audioQuality[astats+silencedetect+ebur128]/makeWorkingDir/cleanupWorkingDir/srtTimestamp/buildSrt), agent/registry-helpers.ts (ToolSpec/ToolContext/ToolOutput টাইপ + createToolArtifact/artifactToDataUrl/artifactFilePath), agent/model-registry-data.ts (১৬ এন্ট্রি সীড)
- agent/prompts.ts — SYSTEM_PROMPT এখন রেজিস্ট্রি-চালিত (TOOLS-এর usage বেলে তৈরি); llm.ts থেকে পুরনো প্রম্পট সরানো; নতুন নিয়ম: বড় কাজে বাধ্যতামূলক propose_job, সততা (ডিফিউশন ভিডিও নয়, music/singing/stems/lip-sync gated), টাইপড প্যারামিটার নিয়ম, সুপারিশ (Shorts→9:16 30fps, সিনেম্যাটিক→16:9 24fps)
- registry.ts রি-স্ট্রাকচার: CORE_TOOLS (৮টি, প্রতিটিতে usage যোগ) + IMAGE_TOOLS/AUDIO_TOOLS/VIDEO_TOOLS/PRODUCTION_TOOLS aggregate; tools/{image,audio,video}.ts স্টাব (এজেন্টরা পূরণ করবে), tools/production.ts-এ propose_job (validateSpec→Production row→awaiting_confirmation) + create_character (LLM প্রম্পট→portrait artifact)
- production framework: bus.ts (প্রোডাকশন SSE ইভেন্ট bus), serialize.ts (toProductionView/toProductionSummary/toStepView), runner.ts (PipelineContext: runStep/setDetail/checkCancelled/registerArtifact/resolveArtifactFile/workingDir/partialNotes + startProduction + CancelledError + stale sweep ২০মি; partial লজিক: artifact থাকলে ত্রুটিতেও partial), pipelines/index.ts + ৫টি স্টাব পাইপলাইন
- API routes: GET /api/productions (sweep+list), GET /api/productions/[id], POST confirm (override-merge→validate→queued→start), POST cancel (cancelling flag), GET events (SSE: DB রিপ্লে→bus→poll), POST revise (নতুন awaiting_confirmation + parentProductionId), GET /api/registry (সীডসহ), GET /api/gallery (kind ফিল্টার)
- orchestrator: MAX_STEPS ১২, propose_job-ফলাফলে productionId ধরে চূড়ান্ত assistant message-এ লিংক, ভিডিও অ্যাটাচমেন্টে প্রি-স্টেপ নয় বরং context-নোট (inspect_media-এর ইঙ্গিত)
- serialize.ts: buildMessageView-এ productionId; chat route-এ video অ্যাটাচমেন্ট (২৫MB)
- UI: use-productions.ts (zustand+SSE+পোলিং fallback+confirm/cancel/revise), use-ui-view.ts, components/studio/{production-card, gallery-view, productions-view, registry-view, guide-view}, artifact-view-এ ভিডিও প্লেয়ার, message-bubble-এ ProductionCard+ভিডিও বাবল, composer-এ ভিডিও আপলোড, sidebar-এ ViewNav(৫ ভিউ)+নতুন ক্যাটাগরি লেবেল, page.tsx ভিউ-সুইচারসহ রিরাইট, layout metadata
- দেব-সার্ভার Prisma-regenerate-এর পর পুরনো ক্লায়েন্ট ক্যাশ করছিল → double-fork daemonize (/tmp/daemonize.py) দিয়ে রিস্টার্ট, এখন সেশন-জুড়ে টিকে থাকে
- যাচাই (curl): /api/tools → ৩৮ টুল ✓; /api/registry → ১৬ এন্ট্রি ✓; চ্যাট "মিউজিক ভিডিও বানাও" → propose_job → Production(awaiting_confirmation) ✓; confirm → queued→running→failed(স্টাব পাইপলাইন—প্রত্যাশিত) + step_end ইভেন্ট ✓; assistant message-এ productionId ✓; bun run lint → শূন্য ত্রুটি ✓

Stage Summary:
- ভিত্তি সম্পূর্ণ ও লাইভ-যাচাইকৃত। ৫টি সাবএজেন্টের জন্য চুক্তি:
  * types.ts-ই একমাত্র সত্যের উৎস — পরিবর্তন নিষিদ্ধ; schema.prisma সম্পাদনা নিষিদ্ধ (প্রয়োজন হলে worklog-এ নোট করো, মূল এজেন্ট ঠিক করবে)
  * টুল প্যাটার্ন: tools/<domain>.ts-এ `export const X_TOOLS: ToolSpec[] = [...]` — ToolSpec { name, parameters(zod), timeoutMs, usage(বাংলা, arguments-সহ), inputSummary, execute(input, ctx)→{summary, resultJson, artifacts?} }; হেল্পার: registry-helpers.ts (createToolArtifact/artifactToDataUrl/artifactFilePath)
  * পাইপলাইন প্যাটার্ন: production/pipelines/<type>.ts-এ `export const xPipeline: PipelineFn = async ctx => {...}` — ctx.runStep(key,title,fn)/ctx.setDetail/ctx.checkCancelled (প্রতি শটে)/ctx.registerArtifact/ctx.resolveArtifactFile/ctx.workingDir/ctx.partialNotes; ফেরত দাও { result: {...}, statusOverride?: 'partial' }
  * মিডিয়া হেল্পার: @/lib/media/ffmpeg (runFfmpeg/mediaInfo/audioQuality/buildSrt/srtTimestamp) + agent/sdk-helpers (chatJson/generateImageBuffer/editImageBuffer/synthesizeSpeech/visionAnalyze)
  * নাম আইডি: টুল নামগুলো TOOL_CATALOG-এ (types.ts) চূড়ান্ত — edit_image, inpaint_image, remove_background, remove_object, restyle_image, enhance_image, color_grade_image, transform_image, compose_text_image, export_image, inspect_image | plan_music, generate_instrumental, generate_singing, separate_stems, process_audio, mix_audio, validate_audio, inspect_media | plan_video, generate_video, animate_image, process_video, enhance_video, interpolate_video, generate_subtitles, validate_video, lip_sync | propose_job, create_character
  * রং: emerald accent (blue/indigo নিষিদ্ধ), বাংলা-প্রথম UI, h-dvh শেল
  * দেব-সার্ভার daemonized; কখনো নিজে থেকে বন্ধ/রিস্টার্ট করবে না; curl দিয়ে টেস্ট (http://localhost:3000/api/...) + tail dev.log; প্রয়োজনে রিস্টার্ট লাগলে worklog-এ জানাও
  * lint: শুধু নিজের ফাইল `bunx eslint src/<path>...`; প্রজেক্ট-ব্যাপী `bun run lint` শেষে মূল এজেন্ট চালাবে

---
Task ID: 2-a (Creative Studio upgrade — Agent Core + Chat UI polish)
Agent: agent-core-chat-ui (subagent, frontend)
Task: চ্যাট UX পলিশ — empty-state রিরাইট (ক্রিয়েটিভ স্টুডিও হিরো) + production-card বৃদ্ধি (কার্যকরী ফ্লো অক্ষুণ্ণ রেখে)

Work Log:
- empty-state.tsx রিরাইট: হিরো "অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও" + বর্ণনায় সব ক্যাটাগরি (ছবি তৈরি/এডিট, গানের পরিকল্পনা ও ভয়েসওভার, মোশন ভিডিও, মিউজিক ভিডিও ও শর্টফিল্ম); ৪টি ফিচার কার্ড (ছবি স্টুডিও/ImagePlus, অডিও স্টুডিও/AudioLines, ভিডিও স্টুডিও/Film, ফিল্ম ডিরেক্টর/Clapperboard) — Card কম্পোনেন্ট দিয়ে, emerald আইকন-টিন্ট
- ৫টি কুইক-স্টার্ট চিপ (নির্ধারিত লেবেল: শর্টফিল্ম/ছবি/TTS-নমুনা-লেখা/গান-পরিকল্পনা/ছবি→ভিডিও) — setDraft+focusComposer প্যাটার্নে; min-h-11 (৪৪px) টাচ-টার্গেট, rounded-full, h-auto মাল্টিলাইন-র‍্যাপ; নিচে অ্যাটাচ-হিন্ট লাইন; role=group + বাংলা aria-label
- production-card.tsx (কেবল সংযোজনীয় পরিবর্তন — confirm/cancel/revise/SSE ফ্লো অপরিবর্তিত):
  * SpecEditor-এ ভিডিও টাইপের জন্য "দৈর্ঘ্য" Select — motion_video ৫/৮/১০/১২/১৫/২০, music_video ১৫/৩০/৬০/৯০/১২০/১৮০, short_film ৩০/৪৫/৬০/৯০/১২০ (§১৫ সীমার ভেতরে; বর্তমান মান তালিকার বাইরে হলে স্বয়ংক্রিয়ভাবে যুক্ত; undefined হলে "স্বয়ংক্রিয়" placeholder — Radix shouldShowPlaceholder('') যাচাইকৃত)
  * image টাইপে ফরম্যাট Select (PNG/JPEG/WebP) — spec.format defined হলেই দেখায় (নির্দেশনা অনুযায়ী)
  * awaiting_confirmation-এ AmberNote: ভিডিও সততা-নোট ("AI স্টোরিবোর্ড + সিনেম্যাটিক ক্যামেরা-মোশন পাইপলাইন… ডিফিউশন ভিডিও-মডেল নয়…") সব ভিডিও টাইপে + "গান আপলোড করা হয়নি…" নোট music_video-তে (songArtifactId undefined && sound !== 'uploaded_song') — নির্ধারিত টেক্সট হুবহু, TriangleAlert আইকনসহ ছোট অ্যাম্বার নোট
  * ধাপ-তালিকা: running ধাপে animate-pulse র‍্যাপার (স্পিনার রাখা হয়েছে), done ধাপে ডান পাশে বাংলা অঙ্কে সময় (toBnDigits, durationMs>0 হলে)
  * completed + artifacts থাকলে "গ্যালারিতে দেখুন" বোতাম → useUiView.getState().setActiveView('gallery'); সংশোধন-বোতামের সাথে flex-wrap সারিতে
  * সারাংশ-ব্যাজে বাংলা অঙ্ক (অনুপাত/দৈর্ঘ্য/FPS) + WebP-কেস লেবেল; ২টি অব্যবহৃত ইমপোর্ট (FileText, Switch) সরানো; মোবাইল-নিরাপদ লেআউট (grid-cols-2, flex-wrap, shrink-0, min-w-0)
- যাচাই: `bunx eslint src/components/chat/empty-state.tsx src/components/studio/production-card.tsx` → ০ এরর; `bunx tsc --noEmit`-এ আমার ২ ফাইলে ০ এরর; GET / → 200, GET /api/tools → 200; SSR HTML-এ হিরো + ৪ ফিচার-শিরোনাম + ৫ চিপ-স্ট্রিং সব উপস্থিত; dev.log-এ পরিষ্কার কম্পাইল

Stage Summary:
- ফাইল: src/components/chat/empty-state.tsx (রিরাইট), src/components/studio/production-card.tsx (বৃদ্ধি) — প্রোডাকশন ফ্লো (confirm/cancel/revise/SSE/artifacts) অক্ষত
- মূল এজেন্টের জন্য নোট: (ক) `bunx tsc --noEmit`-এ পূর্ব-থেকে-থাকা এরর দেখা গেছে src/hooks/use-productions.ts:74 (ProductionEvent-এর ping-variant-এ productionId নেই — evt.type narrow করা হয়নি) — শেয়ার্ড ফাইল বলে আমি স্পর্শ করিনি, ইন্টিগ্রেশন পাসে ঠিক করা দরকার; (খ) src/lib/agent/tools/production.ts-এ ToolSpec-এ usage অনুপস্থিত (অন্য এজেন্টের ফাইল); (গ) durationSec Select মান বদলালে পুরো editedSpec confirm-এ যায় — ব্যাকএন্ডের override-merge+validateSpec এটি সামলায়

---
Task ID: 2-c
Agent: full-stack-developer (Audio Studio — অডিও স্টুডিও)
Task: মাস্টার প্ল্যান §৪ বাস্তবায়ন — AUDIO_TOOLS-এর ৮টি টুল (plan_music, গেটেড ৩টি, process_audio, mix_audio, validate_audio, inspect_media) + audioPipeline (voiceover / music_plan / process তিন পথ)

Work Log:
- worklog.md-এর চুক্তি ও সব শেয়ার্ড মডিউল (registry-helpers, sdk-helpers, ffmpeg, runner, capabilities, types) অধ্যয়ন করে প্যাটার্ন মেনে বাস্তবায়ন
- tools/audio.ts:
  * plan_music — chatJson (STRICT JSON প্রম্পট) → MusicPlan sanitize → বাংলা টেক্সট-দলিল (মূল তথ্য / সেকশন-টেবিল / লিরিক্স [কবিতা]/[সুর]-ধাঁচের মার্কারসহ / ইনস্ট্রুমেন্ট তালিকা / ইংরেজি musicModelPrompt) → song-plan.txt (kind text) artifact; resultJson = পার্সড অবজেক্ট
  * generate_instrumental / generate_singing / separate_stems — লাইসেন্স-নীতিতে গেটেড; নির্ধারিত বাংলা ত্রুটি-বার্তা + বিকল্প-নির্দেশনা; usage-এ 'পরীক্ষামূলক/অবরুদ্ধ' উল্লেখ
  * process_audio — ৯টি op, সব FFmpeg-wrapper দিয়ে টেম্প-ডিরেক্টরিতে (makeTempDir + finally-এ cleanupWorkingDir): trim(-ss/-t), concat(aformat+concat), fade(afade), volume(dB), normalize(loudnorm I=-16:TP=-1.5:LRA=11 + aresample — loudnorm-এর 192kHz আউটপুট সমস্যা এড়াতে), eq(bass/treble), compress(acompressor -18dB), reverb(aecho — সৎ লেবেল 'প্রায়-রিভার্ব'), convert(-ar/-ac + libmp3lame 192k বা pcm_s16le); superRefine-এ op-ভিত্তিক ক্রস-ফিল্ড যাচাই (বাংলা বার্তা); সঠিক mime (audio/wav / audio/mpeg)
  * mix_audio — ২–৪ ট্র্যাক; প্রতিটিতে aformat + (crossfadeSec হলে) afade জোড়া + volume + adelay(all=1); duckMusicUnderVoice হলে শেষ (কণ্ঠ) ট্র্যাক asplit করে একই বিলম্বে সাইডচেইনে পাঠানো (সময়-সংযুক্ত ডাকিং), প্রথম ট্র্যাকে sidechaincompress; শেষে amix normalize=0 + alimiter(0.971:level=false)
  * validate_audio — audioQuality + নিজস্ব নির্ভুল ebur128 পাস (শেষ-মিল পার্সার): বাংলা মানব-পাঠযোগ্য রিপোর্ট (দৈর্ঘ্য/স্যাম্পল-রেট/চ্যানেল/পিক/RMS/LUFS/ক্লিপিং-সতর্কতা (>−০.১dB)/নীরব-অংশ >1.2s) + এক-লাইন রায়; resultJson = পূর্ণ রিপোর্ট অবজেক্ট
  * inspect_media — artifactFilePath → mediaInfo → {durationSec, hasVideo, hasAudio, width, height, fps, codecs, sampleRate, channels, sizeBytes} + বাংলা সারাংশ-লাইন
- pipelines/audio.ts — তিন পথ: (১) voiceover: prepare (≤950-অক্ষর বাক্য-সীমানায় খণ্ডবিভাজন) → synthesize (প্রতি অংশে TTS + ১ পুনঃচেষ্টা, checkCancelled, 'X/Y অংশ সম্পন্ন' ডিটেইল, ব্যর্থ অংশ partialNotes-এ) → master (concat+loudnorm → master.wav + libmp3lame 192k master.mp3) → validate (দৈর্ঘ্য>0, পিক ≤ −0.১dB, রেট 44100/48000; উভয় ফরম্যাটে artifact নিবন্ধন ${slug}.wav/.mp3); (২) music_plan: plan_music-এর যুক্তি ইনলাইনে (শেয়ার্ড planMusicContent) → song-plan.txt; (৩) process: sourceAudioArtifactIds-এর ওপর একই মাস্টারিং-যাচাই পুনঃব্যবহার
- শেয়ার্ড এক্সপোর্ট (পাইপলাইন টুল-ctx ভান না করে পুনঃব্যবহার করে): planMusicContent, formatMusicPlanDocument, chunkScriptForTts, toBn, fmtDb, slugifyTitle, measureLoudnessPrecise

Stage Summary:
- যাচাই (বাজেট-সচেতন: মোট ২টি বাস্তব TTS + ১টি LLM কল, সব টেস্ট-ডেটা ও টেম্প-ফাইল পরে মুছে ফেলা):
  * টুল-টেস্ট ১৭/১৭ পাস — বিশুদ্ধ ফাংশন (খণ্ডবিভাজন/দলিল), zod ব্যর্থ-পথ (বাংলা hint), ৩ গেটেড টুল, লাইভ চেইন TTS→normalize→convert(mp3/48k/mono)→validate (LUFS −১৮.২, পিক −১.৫dB)→mix (ডাকিং+ক্রসফেডসহ)→inspect_media, plan_music লাইভ (৫ সেকশন + বাংলা লিরিক্স + দলিল artifact)
  * পাইপলাইন E2E (সরাসরি Production queued → startProduction): স্ট্যাটাস completed, ৪ ধাপ done (বাংলা ডিটেইলসহ), 'বর্ষার-চিঠি'.wav (১.১৫MB) + '.mp3' (১৫৯KB) artifact, quality = 'শোনার যোগ্য, তবে ১টি নীরব-অংশ আছে; দৈর্ঘ্য ৬.৫ সেকেন্ড (লক্ষ্য ২০ সে.), ১টি অংশ, কণ্ঠ tongtong'
  * bunx eslint উভয় ফাইলে শূন্য ত্রুটি; bunx tsc — আমার ফাইলে শূন্য ত্রুটি; পাইপলাইন import-চেক OK; curl /api/tools → 200 (audio_studio-র ৮টি টুল স্পষ্ট); dev.log-এ আমার মডিউলে কোনো কম্পাইল-ত্রুটি নেই
- মূল এজেন্টের জন্য নোট: (ক) শেয়ার্ড audioQuality-র loudnessLufs পার্সার প্রথম-মিল নেয় — লাইভ-লাইনের আংশিক মান (প্রায়ই −৭০ LUFS) দেখায়; ffmpeg.ts অস্পৃশ্য রেখে আমি validate_audio/পাইপলাইনে আলাদা নির্ভুল ebur128 পাস (শেষ-মিল) ব্যবহার করেছি — ভিডিও-এজেন্টও measureLoudnessPrecise ব্যবহার করতে পারেন; (খ) ffmpeg-৭.১-এ aformat-এর অপশন 'sample_fmts' (বহুবচন) — singular দিলে 'Option not found'; (গ) pre-existing TS ত্রুটি (আমার স্কোপে নয়): tools/production.ts-এর দুটি টুলে বাধ্যতামূলক usage অনুপস্থিত, এবং use-productions.ts:৭৪-এ productionId টাইপ-ত্রুটি; (ঘ) dev.log-এর toolCall.update প্রসঙ্গে prisma:error — সমান্তরাল এজেন্টের টেস্টে চলমান রানের কথোপকথন মুছে ফেলার ফল, আমার পরিবর্তন-সৃষ্ট নয়
- বিস্তারিত নোট agent-ctx/2-c-audio-studio.md-এ (ভিডিও/মিউজিক-ভিডিও এজেন্টদের জন্য গচ্ছা-তালিকাসহ)

---
Task ID: 2-b (Creative Studio — Image Studio)
Agent: full-stack-developer (রিপোর্ট-টাইমআউট — মূল এজেন্ট যাচাই-সহ নিবন্ধন করল)
Task: ১১টি ইমেজ টুল + image production পাইপলাইন + BeforeAfter কম্পোনেন্ট

Work Log:
- tools/image.ts (৯১৪ লাইন): edit_image, inpaint_image, remove_background, remove_object, restyle_image (SDK edit-মডেল, preserve-নির্দেশনাসহ প্রম্পট), enhance_image (sharp lanczos+median+sharpen, সৎ নোট: নতুন AI-ডিটেইল নয়), color_grade_image (modulate/gamma/linear), transform_image (crop/resize/rotate/flip/floor/aspect→outputDims), compose_text_image (SVG+Noto Sans Bengali টাইপোগ্রাফি, ৪ থিম, স্ক্রিম+অটো-সাইজ), export_image (png/jpeg/webp), inspect_image (sharp মেটাডেটা + VLM গুণমান-মূল্যায়ন)
- pipelines/image.ts: prepare→generate/edit→overlay→validate (sharp মেটাডেটা-যাচাই + ফরম্যাট রপ্তানি; প্রি-ওভারলে বেসও আর্টিফ্যাক্ট হিসেবে)
- components/studio/before-after.tsx: তুলনা-স্লাইডার (ড্র্যাগ-হ্যান্ডেল, ৪৪px টাচ-টার্গেট)

Stage Summary:
- মূল এজেন্টের বাস্তব যাচাই: generateImageBuffer → edit_image ("bicycle → teal") ✓ → compose_text_image ("ঢাকার শরৎ" বাংলা হেডিং) ✓ → enhance_image (1024→2048) ✓ — সব টেস্ট-ডেটা পরিষ্কার। পোস্টার পাইপলাইন E2E: "একুশে বইমেলা" পোস্টার completed, VLM বাংলা টেক্সট-ওভারলে নিশ্চিত করেছে।

---
Task ID: 2-d (Creative Studio — Video Studio + Film Director)
Agent: full-stack-developer (রিপোর্ট-টাইমআউট — মূল এজেন্ট যাচাই-সহ নিবন্ধন করল)
Task: ৯টি ভিডিও টুল + film-helpers + ৩টি ফিল্ম পাইপলাইন (motion_video, music_video, short_film)

Work Log:
- tools/video.ts (৮১২ লাইন): plan_video (LLM শট-তালিকা), generate_video (ইনলাইন মিনি-পাইপলাইন ≤২০ সে.), animate_image (Ken Burns), process_video (trim/concat/speed/scale/crop/add_audio/replace_audio), enhance_video (eq/unsharp/hqdn3d/vidstab দুই-পাস), interpolate_video (minterpolate), generate_subtitles (LLM কিউ-সেগমেন্টেশন→SRT), validate_video (ffprobe যাচাই), lip_sync (গেটেড-সৎ)
- film-helpers.ts (৫৪৯ লাইন): kenBurnsClip (zoompan ৫ মুভ, ২x ওভারস্যাম্পল), concatClips (≤৬ ক্লিপে xfade, বেশিতে concat+fade), mixAudioTracks (adelay+sidechain ducking+amix+alimiter), generateAmbientBed (pink noise+lowpass), burnSubtitles (libass, Noto Sans Bengali force_style), shotPlanFromLLM, normalizeShotDurations
- পাইপলাইন ৩টি (motion_video ৩০১, music_video ৪২৪, short_film ৬১১ লাইন): পরিকল্পিত step-key মেনে চলে; প্রতি শটে checkCancelled + setDetail; ব্যর্থ শটে ১ পুনঃচেষ্টা → partialNotes; চরিত্র-বাইবেল পোর্ট্রেট রেফারেন্স-কন্ডিশনড স্টোরিবোর্ড (editImageBuffer "same person"); সংলাপ-TTS মাপা-দৈর্ঘ্য টাইমলাইন; ধারাবাহিকতা-পরীক্ষা; SRT বার্ন + আলাদা আর্টিফ্যাক্ট

Stage Summary:
- মূল এজেন্টের বাস্তব যাচাই (সবগুলো সম্পূর্ণ): শর্টফিল্ম "আকাশের সাথী" (৩৩.৫ সে., ৯ ধাপ সম্পন্ন, h264 720p 24fps + AAC, বাংলা সাবটাইটেল বার্ন-ইন VLM-যাচাইকৃত, স্ক্রিনপ্লে+পোর্ট্রেট+৫ ফ্রেম+SRT+MP4 আর্টিফ্যাক্ট); মোশন ভিডিও ৭.৪ সে.; মিউজিক ভিডিও ২০.০ সে. গান-সমলয়; animate_image+generate_subtitles টুল টেস্ট। মূল এজেন্টের ইন্টিগ্রেশন ফিক্স: continuity-পরীক্ষায় visionCompare (পোর্ট্রেট+ফ্রেম একসাথে) — আগে শুধু ফ্রেম যেত।

---
Task ID: 2-e (Creative Studio — Platform)
Agent: full-stack-developer (রিপোর্ট-ব্যর্থ — মূল এজেন্ট যাচাই-সহ নিবন্ধন করল)
Task: Gallery/Productions/Registry/Guide ভিউ সমৃদ্ধকরণ + limits.ts

Work Log:
- gallery-view.tsx (৩৩৮): প্রিভিউ ডায়ালগ (video/audio/text), origin ব্যাজ, ক্লায়েন্ট-সাইড ফিল্টার+গণনা, ৪০-এর পেজিং, রিট্রাই-সহ এরর-স্টেট
- productions-view.tsx (৪৬৩): স্টোর-চালিত লাইভ আপডেট, স্ট্যাটাস-ব্যাজ, প্রগ্রেস, এক্সপ্যান্ডেবল ধাপ-তালিকা, বাতিল-বোতাম, সংশোধন-ব্যাজ, সেকশন-ফিল্টার
- registry-view.tsx (৩৪৭): স্ট্যাটাস-গ্রুপড সেকশন, capability-চিপস, commercialUse-ব্যাজ, সার্চ, নীতি-সারমর্ম
- guide-view.tsx (২৭৭): স্থাপত্য-ডায়াগ্রাম (CSS), ফেজ-ম্যাপ, রোডম্যাপ
- lib/limits.ts (১০০): checkRateLimit (স্লাইডিং-উইন্ডো, globalThis-HMR-safe) + checkDailyProductionQuota (ঢাকা-দিন) + RATE_LIMITS প্রিসেট

Stage Summary:
- মূল এজেন্টের যাচাই: lint/tsc শূন্য; limits স্ট্যান্ডঅ্যালোন টেস্ট পাস; chat+confirm রুটে রেট-লিমিট ও কোটা ইন্টিগ্রেট করা হয়েছে (Task 3)।

---
Task ID: 3 (Creative Studio — ইন্টিগ্রেশন ও ফিক্স)
Agent: main (Z.ai Code orchestrator)
Task: সাবএজেন্ট-ফল যাচাই, ব্যাগ-ফিক্স, নিরাপত্তা-ইন্টিগ্রেশন, সম্পূর্ণ E2E

Work Log:
- ফিক্স ১: use-productions.ts-এ 'ping' ইউনিয়ন-ন্যারোয়িং TS ত্রুটি ('productionId' in evt গার্ড)
- ফিক্স ২: tools/production.ts-এ propose_job/create_character-এ বাদ-পড়া usage ফিল্ড যোগ
- ফিক্স ৩ (গুরুত্বপূর্ণ): LLM আউটপুট-টোকেনে কাটা টুল-কল JSON চূড়ান্ত উত্তর হয়ে যাচ্ছিল → orchestrator-এ looksLikeToolCall() শনাক্তকরণ + সংশোধন-অনুরোধ ফিডব্যাক লুপ; প্রম্পটে spec-কমপ্যাক্টনেস নিয়ম
- ফিক্স ৪: continuity_checker-এ visionCompare (রেফারেন্স-পোর্ট্রেট+ফ্রেম দুটোই VLM-এ)
- ফিক্স ৫: propose_job-এ অটো-ওয়্যার — মিউজিক ভিডিওতে কথোপকথনের সর্বশেষ আপলোড-গান songArtifactId হিসেবে, ছবি/motion_video-তে সর্বশেষ আপলোড-ছবি; প্রম্পট-নিয়মসহ
- নিরাপত্তা (§১১): chat রুটে রেট-লিমিট (১৫/মিনিট), confirm রুটে রেট-লিমিট (১২/ঘণ্টা) + দৈনিক কোটা (৪০ প্রোডাকশন/দিন, ঢাকা-দিন) — 429/403 বাংলা বার্তাসহ
- E2E যাচাই (সব বাস্তব API-কল): ৩৮ টুল রেজিস্টার্ড; চ্যাট→propose_job→কার্ড→confirm→SSE ধাপ→artifacts; ইমেজ টুল-চেইন (edit+বাংলা টাইপোগ্রাফি+আপস্কেল); পোস্টার প্রোডাকশন (VLM-নিশ্চিত বাংলা ওভারলে); ভয়েসওভার প্রোডাকশন (WAV+MP3, loudnorm); মোশন ভিডিও (৭.৪ সে.); মিউজিক ভিডিও (২০.০ সে. গান-সমলয়); শর্টফিল্ম (৯ ধাপ, ৩৩.৫ সে., বাংলা সাবটাইটেল বার্ন-ইন VLM-নিশ্চিত); animate_image+generate_subtitles; রেজিস্ট্রি ১৬ এন্ট্রি
- টেস্ট-ডেটা সম্পূর্ণ পরিষ্কার (২৭ artifact row, ৩৪ ফাইল, সব কথোপকথন/প্রোডাকশন)
- bun run lint শূন্য; bunx tsc --noEmit-এ src/ শূন্য

Stage Summary:
- পাঁচটি পাইপলাইনই বাস্তব-চালিত অবস্থায় সম্পূর্ণ। বাকি: Task 4 ব্রাউজার-E2E।

---
Task ID: 4 (Creative Studio — ব্রাউজার E2E যাচাই)
Agent: main (Z.ai Code orchestrator)
Task: Agent Browser দিয়ে সম্পূর্ণ অ্যাপের এন্ড-টু-এন্ড ভেরিফিকেশন

Work Log:
- হোম রেন্ডার: নতুন হিরো "অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও" + ৪ ফিচার-কার্ড + ৫ কুইক-চিপ (বাংলা) ✓
- গোল্ডেন পাথ ১ (সরাসরি টুল): পাহাড়ের ছবি চিপ → চ্যাট → generate_image → লাইভ অ্যাক্টিভিটি → ছবি artifact → প্রিভিউ ডায়ালগ + ডাউনলোড (VLM-নিশ্চিত: ক্লিন মডাল, বাংলা বোতাম) ✓
- গোল্ডেন পাথ ২ (ছোট TTS): শুভ বিজয়া লেখা → সরাসরি text_to_speech → অডিও প্লেয়ার চ্যাটে ✓
- গোল্ডেন পাথ ৩ (সৎ ব্যর্থতা): TTS আপস্ট্রিম 500 (কোড ১২৩৪) — এজেন্ট ৩ কণ্ঠে চেষ্টা করে সৎ বাংলা ব্যাখ্যা দিয়েছে (মাস্টার প্ল্যানের নিয়ম অনুযায়ী) ✓
- গোল্ডেন পাথ ৪ (প্রোডাকশন কার্ড): শর্টফিল্ম অনুরোধ → propose_job → নিশ্চিতকরণ কার্ড (সেটিংস-ব্যাজ + সতর্কতা-নোট + নিশ্চিত/বাতিল) → ব্রাউজারেই confirm → SSE লাইভ ধাপ (VLM-নিশ্চিত: প্রগ্রেস-বার ২২%, চেকমার্ক+স্পিনার) → চূড়ান্ত: ৫৫.১ সে. ফিল্ম, ভিডিও প্লেয়ার (duration/readyState যাচাইকৃত), আংশিক-নোট, সংশোধন-বোতাম ✓
- সংশোধন-ফ্লো: বাগ পাওয়া — নতুন revision কার্ড রেন্ডার হত না → production-card-এ nested revision কার্ড যোগ → ব্রাউজারে যাচাই ✓; উভয় রিভিশন-প্রস্তাব বাতিল করে পরিষ্কার অবস্থা
- ভিউ-সুইচিং: গ্যালারি (kind-ফিল্টার+গণনা+প্রিভিউ ডায়ালগ), প্রোডাকশন মনিটর, রেজিস্ট্রি (১৬ এন্ট্রি, স্ট্যাটাস-গ্রুপ), গাইড (স্থাপত্য+ফেজ-ম্যাপ) — সব ✓
- মোবাইল ৩৯০x৮৪৪: কোনো horizontal scroll নেই, ফুটার নিচে আটকে (footerBottom=844), হ্যামবার্গার+Sheet নেভ-সহ সব ভিউ ✓; ডেস্কটপ 1280x800 ✓
- অগ্রগতি-বাগ ফিক্স: runStep-এ DB progress-আপডেট + setDetail-এ মাঝ-ধাপ অগ্রগতি (পোলিং-ভিউতেও সঠিক %)
- console/page errors শূন্য; dev.log সব 200; bun run lint শূন্য; tsc src/ শূন্য

Stage Summary:
- ব্রাউজারে প্রতিটি কোর-ফ্লো বাস্তব ইন্টারঅ্যাকশনে যাচাইকৃত — অ্যাপ ইন্টারঅ্যাক্টিভ ও রানযোগ্য। একমাত্র সীমা: TTS আপস্ট্রিমে সাময়িক 500 (আমাদের কোডের বাইরে, সৎ হ্যান্ডলিং যাচাইকৃত)।

---
Task ID: 2–6, 8 (নতুন মাস্টার প্ল্যান §২–§৫, §৮, §৯, §১২-৮ — মূল এজেন্ট)
Agent: main (Z.ai Code orchestrator)
Task: Phase 1 অডিট + কোর-মডিউল: Audio Language Controller (§২), Music Engine (§৩), Real AI Video (§৪), Lip-Sync স্থাপত্য (§৫), Sound Design (§৮), রেজিস্ট্রি/সিস্টেম/হার্ডেনিং (§৯, §১২-৮)

Work Log:
- Phase 1 অডিট: হার্ডওয়্যার = ২ CPU কোর, ৪.১GB RAM, ডিস্ক ৯.৯GB (৭.৪ খালি), GPU নেই, FFmpeg 7.1.5
- **আবিষ্কার: SDK-তে প্রকৃত ভিডিও-জেনারেশন API আছে** (`zai.video.generations.create` + `zai.async.result.query`) — মডেল **cogvideox-3**। প্রোব-যাচাই: ৫ সে. t2v → ১৩৮ সে.-এ প্রকৃত MP4 (5.7MB); **i2v data-URL গ্রহণ করে** (১০৮০×১০৮০ h264); সাবমিটে ৪২৯-রেট-সীমা — ৬০ সে. ব্যাকঅফ দরকার; প্রতি শটে ২–৪ মিনিট
- TTS ভাষা-প্রোব: ৭ কণ্ঠ (tongtong/chuichui/xiaochen/jam/kazi/douji/luodo); tongtong/chuichui/xiaochen/luodo বাংলা লেখা মাত্র ২.৪–২.৭ সে.-এ "পড়ে" (আসলে পড়তে পারে না); jam ১০.১ সে. (সম্ভাব্য, ASR বাংলা বোঝে না); douji ৩৫ সে. ফাইল (ASR-এর ৩০ সে. সীমা ছাড়ায়); **সিদ্ধান্ত: কোনো কণ্ঠই বাংলা-প্রশিক্ষিত নয় → bn-রায় সবসময় 'warn' + মানব-প্রিভিউ**; en: jam প্রধান, ASR রাউন্ড-ট্রিপ কার্যকর
- ASR-এর ৩০ সে. সীমা → transcribeBuffer-এ ২৮ সে. চাঙ্কিং
- নতুন মডিউল (সব লোকাল-সংশ্লেষণ + SDK):
  * `src/lib/agent/audio/language_controller.ts` (§২) — AudioJobSpec, LANGUAGE_PROFILES, detectLanguage, resolveVoice, synthesizeVerifiedSpeech (TTS→দৈর্ঘ্য-যাচাই→ASR ব্যাক-চেক→রায় pass/warn/fail→fail-হলে বিকল্প কণ্ঠে ১ পুনঃচেষ্টা), transcriptSimilarity
  * `src/lib/agent/audio/music_engine.ts` (§৩) — synthesizeInstrumental (৬ মুড × স্কেল/কর্ড-প্রগ্রেশন/ছন্দ-সচেতন PCM সংশ্লেষণ + বিট-মার্কার + সেকশন + যাচাই), analyzeAudioEnergy (এনার্জি-বিট-শনাক্তকরণ §৬.১), detectMoodFromText
  * `src/lib/agent/audio/pcm.ts` — শেয়ার্ড WAV-এনকোডার/নয়েজ/রেজোনেটর/নরমালাইজার
  * `src/lib/agent/audio/sound_design.ts` (§৮) — ৫-স্তর (A1–A5), planSoundscape (বাংলা কীওয়ার্ড→অ্যাম্বিয়েন্স/ফোলে), ৯ অ্যাম্বিয়েন্স+৮ ফোলে PCM সংশ্লেষণ, mixSoundLayers (ডাকিং+লিমিটার+নির্ভুল ebur128)
  * `src/lib/agent/video/ai_video.ts` (§৪) — submitVideoTask (৪২৯-ধৈর্যশীল ৬০ সে. ব্যাকঅফ ×৬, ৩০ সে. স্পেসিং), pollVideoTask, downloadVideo, validateVideoBuffer (ffprobe), generateVideoClip, generateVideoClips
  * `src/lib/agent/video/capability_router.ts` (§৪.৩) — ৭-রুট টেবিল (কে কী করবে; FFmpeg কখনো AI-ভিডিও নয়)
  * `src/lib/agent/video/lip_sync_module.ts` (§৫) — সৎ-অবরুদ্ধ + ৭-ধাপ ওয়ার্কফ্লো + গান-অতিরিক্ত + সম্মতি-নিয়ম
- টুল-আপগ্রেড: generate_instrumental (অবরুদ্ধ→প্রকৃত প্রসিডিউরাল), **speech_synthesis** (নতুন, §২-সম্পূর্ণ), **analyze_audio** (নতুন, §৬.১), generate_video (নতুন engine প্যারামিটার: ai_diffusion ডিফল্ট + সৎ-ফলব্যাক + শট-লেবেল), **image_to_video** (নতুন, প্রকৃত CogVideoX i2v), lip_sync (§৫-প্রতিবেদনসহ), create_character (Character-টেবিল upsert, §৭.২)
- types.ts: TOOL_CATALOG +৩ টুল (মোট ৪১), spec-ফিল্ড +language/videoEngine/filmMode/mood/genre/tempoBpm/musicSource, AppView +'studio', ArtifactMeta+meta, VoicePreset ৭ কণ্ঠ, audioOperation +'instrumental'
- capabilities.ts: নতুন ফিল্ড-যাচাই, AI-শট-সীমা (motion≤3, mv≤5–7, sf≤6–8), ইঞ্জিন-সচেতন সততা-নোট, ধাপ-কাঠামো নতুন (motion: plan/generate_shots/assemble/validate; mv: song_input/visual_plan/characters/generate_shots/timeline/final_qc; sf: script_breakdown/character_bible/acting_plan/speech/generate_shots/sound_design/continuity/final_mix; audio: prepare/synthesize/verify/master/validate)
- prisma: Character মডেল (স্থায়ী বাইবেল, conversationId+name unique) → db:push ✓
- runner.ts: কনকারেন্সি-সীমা (সর্বোচ্চ ২ সমান্তরাল + সারি), stale-sweep ভিডিওতে ৬০ মি./শুধু-অডিও ২০ মি.
- system-info.ts + GET/POST /api/system (হার্ডওয়্যার + LLM/TTS-মাইক্রো-চেক + সৎ স্ট্যাটিক-স্বাস্থ্য; ৪২৯-এ সৎ 'down')
- model-registry-data: platform-videogen (CogVideoX-3 সক্রিয়), procedural-music-engine, sound-design-engine + §৯.১ মেটাডেটা (task_type/supported_languages/requires_gpu/max_duration/fallback_tool)
- prompts.ts: capability-router নিয়ম, নতুন টুল-নীতি, §৯.৩ স্ব-যাচাই চেকলিস্ট (৫ প্রশ্ন)
- ভিত্তি-যাচাই: foundation-smoke.ts → **৩২/৩২ পাস** (৬ মুড সংগীত, দৃশ্য-পরিকল্পনা, §৮ মিক্সার, ভাষা-ফাংশন, রাউটার, লিপ-সিঙ্ক-প্রতিবেদন); tsc src/ শূন্য; bun run lint শূন্য

Stage Summary:
- কোর-চুক্তি প্রস্তুত — Task 7 (পাইপলাইন) ও Task 9 (UI) এখন প্যারালালে চালু করা যায়
- পাইপলাইন-এজেন্টের জন্য API: generateVideoClips(reqs,{onStatus}) / synthesizeInstrumental({mood,durationSec,tempoBpm}) / analyzeAudioEnergy(file) / planSoundscape(text,{ambience,foley}) / renderSoundscapeBed(plan,durationSec,{foleyAtSec}) / mixSoundLayers(layers,outputPath,rules) / synthesizeVerifiedSpeech(spec,{verify}) / moodLabel / detectMoodFromText
- ধাপ-key অবশ্যই capabilities.ts-এর plannedStepsFor-এর সাথে মিলবে
- ArtifactMeta.meta এখন যাচাই/ইঞ্জিন-মেটাডেটা বহন করে (UI-এজেন্ট এটি দেখাবে)

---
Task ID: 9
Agent: full-stack-developer (UI)
Task: Creative Studio UI আপগ্রেড — মোড-স্টুডিও ভিউ (§১০), রেজিস্ট্রি-সিস্টেম প্যানেল (§৯), আর্টিফ্যাক্ট যাচাই-প্রিভিউ (§২.৩/§১১-B), SpecEditor নতুন ফিল্ড, গাইড-ফেজম্যাপ/Router/DoD

Work Log:
- লাইভ API-চুক্তি যাচাই: /api/system (হার্ডওয়্যার+১১ টুল-স্বাস্থ্য, POST=পুনঃচেক রেট-লিমিটেড), /api/registry (১৯ এন্ট্রি — platform-videogen/procedural-music-engine/sound-design-engine নতুন, §৯.১ কীসহ), /api/tools (৪১) — সব ডেটা-শেপ মিলিয়ে UI লেখা
- নতুন `src/hooks/use-system.ts`: useSystemInfo (useQuery, staleTime ৫ মি., retry ১) + useRecheckSystem (POST, RecheckError-এ status-বাহী → 429-টোস্ট আলাদা করে ধরা যায়); টাইপগুলো লোকালি (types.ts স্পর্শ নয়)
- নতুন `src/components/studio/studio-view.tsx` (§১০): Tabs-এ ৩ সেকশন — অডিও ৫ / ভিডিও ৬ / ফিল্ম ৫ = ১৬টি মোড-কার্ড; প্রতিটিতে স্ট্যাটাস-ব্যাজ (চালু=emerald, পরীক্ষামূলক=amber, অবরুদ্ধ=ধূসর-স্টোন, strikethrough নয়) + ৫টি বাধ্যতামূলক মেটা (ভাষা/সর্বোচ্চ দৈর্ঘ্য/ইঞ্জিন-প্রকৃতির ৩-লেবেল/আনুমানিক সময়/GPU) + সতর্কতা-নোট (বাংলা ভয়েসওভার="কণ্ঠ বাংলা-প্রশিক্ষিত নয়", ইনস্ট্রুমেন্টাল="প্রসিডিউরাল, নিউরাল নয়", রিয়েল AI="প্রতি শটে ২–৪ মি."); অবরুদ্ধ মোডে বোতাম নেই — কারণ-নোট; "শুরু করুন" → setDraft(মোড-ভিত্তিক সুপারিশ-সেটিংসসহ বাংলা draft) + setActiveView('chat') + focusComposer + টোস্ট; grid-cols-1 sm:grid-cols-2 lg:grid-cols-3, বোতাম h-11 (৪৪px)
- 'studio' ভিউ-ওয়্যারিং: sidebar.tsx VIEWS-এ দ্বিতীয় পজিশনে 'স্টুডিও' (LayoutGrid), nav grid-cols-3 (৬ আইটেম ২ সারিতে — মোবাইল Sheet-এও নিরাপদ); page.tsx-এ studio-section; use-ui-view.ts-এ কেবল নোট ('studio' AppView-এ আগেই ছিল)
- registry-view.tsx (§৯.১+§১৩): উপরে নতুন "সিস্টেম" প্যানেল — হার্ডওয়্যার-চিপস (CPU/RAM/ডিস্ক/GPU-nodata/FFmpeg/Node), ১১ টুল-স্বাস্থ্য (সবুজ/হলুদ/লাল ডট + লেটেন্সি + checkedAt + নোট, max-h-72 স্ক্রল), "পুনঃচেক" (লোডিং-স্পিনার, 429-এ বাংলা টোস্ট); QueryClientProvider লোকালি মোড়ানো (layout স্পর্শ নয়); ModelEntryCard-এ §৯.১ কী-রেন্ডার: task_type/supported_languages (বাংলা কোড-ম্যাপ, warn-tone)/requires_gpu/max_duration_sec/generation_time/fallback_tool বাংলা লেবেলসহ dl-সারি, বাকি capability আগের চিপে
- artifact-view.tsx (§২.৩+§১১-B): অডিওতে meta.verification → যাচাই-কার্ড (রায়-ব্যাজ pass=সবুজ/.warn=amber/fail=লাল, ভাষা+কণ্ঠ+সাদৃশ্য%+দৈর্ঘ্য চিপ, ASR-ট্রান্সক্রিপ্ট quote-স্টাইলে line-clamp-3 + প্রসারণ, নোট-তালিকা List-আইকনসহ); ইনস্ট্রুমেন্টালে মুড/টেম্পো/স্কেল/বিট-সংখ্যা/সেকশন + honestLabel; ভিডিওতে shotEngineLabels-চিপ + beatsSec + honestLabel; সব নিরাপদ রিডার-হেল্পার দিয়ে (meta না থাকলে আগের মতোই — backward-compatible)
- production-card.tsx: SpecEditor-এ ভাষা Select (audio+ভিডিও), ভিডিও-ইঞ্জিন Select (ai_diffusion ডিফল্ট/cinematic_motion — motion/mv/sf), filmMode Select (sf), mood Select (mv + audio-instrumental), সাবটাইটেল-সুইচ (sf, নতুন); কণ্ঠ-তালিকা ৭টিতে সম্প্রসারিত; spec-সারাংশে ভাষা/ইঞ্জিন/ফিল্ম-মোড/মুড/টেম্পো ব্যাজ; VIDEO_PIPELINE_NOTE → ইঞ্জিন-সচেতন VIDEO_ENGINE_NOTES (ai_diffusion="CogVideoX-3, প্রতি শটে ২–৪ মি." / cinematic_motion=আগের সৎ-নোট); মিউজিক-ভিডিও গান-নোট musicSource-সচেতন (procedural-স্কোর বনাম নীরব)
- empty-state.tsx: "ভিডিও স্টুডিও" কার্ড → "রিয়েল AI ভিডিও" (Video আইকন, CogVideoX-3-উল্লেখ), অডিও-কার্ডে ভাষা-যাচাই+প্রসিডিউরাল-সততা, ফিল্ম-কার্ডে ৮-স্তর; নতুন চিপ "✨ CogVideoX-3 দিয়ে ১০ সেকেন্ডের রিয়েল AI ভিডিও…" (ছবি→ভিডিও চিপের পাশে); হিরো-টেক্সট হালনাগাদ — কোথাও লিপ-সিঙ্ক/গান-গাওয়ার প্রতিশ্রুতি নেই
- guide-view.tsx: ফেজ-ম্যাপ নতুন ৮-ফেজ সত্য অনুযায়ী (P1 অডিট ✓ → P8 হার্ডেনিং ✓, P5 লিপ-সিঙ্ক অবরুদ্ধ-সৎ); §৪.৩ Capability Router ৭-সারির CSS-টেবিল (অনুরোধ→টুল→ইঞ্জিন→স্ট্যাটাস — capability_router.ts-এর লাইভ টেবিলের সাথে মিলিয়ে); §১৪ DoD ১৫-দফা সৎ-ব্যাজসহ (১১ চালু/২ পরীক্ষামূলক/২ অবরুদ্ধ); HONESTY/ROADMAP/CAPABILITIES/স্থাপত্য-চিত্র (৪১ টুল, ক্লাউড/লোকাল Workers-ভাগ) হালনাগাদ
- যাচাই: bunx tsc --noEmit → src/-এ আমার স্কোপে (components/hooks/page) ০ এরর; bunx eslint (সব স্পর্শিত ফাইল) → ০; ব্রাউজার-E2E (agent-browser): স্টুডিও-ভিউ ৩ ট্যাব+১৬ কার্ড+মেটা-সারি রেন্ডার ✓, "শুরু করুন"→draft+চ্যাট-ভিউ+ফোকাস ✓, রেজিস্ট্রি-সিস্টেম প্যানেল (চিপ/১১ স্বাস্থ্য-সারি/পুনঃচেক pending→সফল) ✓, TTS-কার্ডে §৯.১ মেটা-সারি ✓, গাইড ৮-ফেজ+৭-Router+১৫-DoD ✓, SpecEditor নতুন ফিল্ড+ইঞ্জিন-বদলে নোট/ব্যাজ-আপডেট ✓; মোবাইল ৩৯০px: কোনো horizontal overflow নেই, কার্ড ১-কলাম, বোতাম ৪৪px, ট্যাব-স্ক্রল নেই (viewport-emulation দিয়ে — সত্যিকারের ডিভাইস-টেস্ট এই পরিবেশে সম্ভব নয়, কোড-পর্যালোচনায় রেসপনসিভ-ক্লাস নিশ্চিত); dev.log-এ আমার পরিবর্তনে কোনো কম্পাইল-এরর নেই (একটি transient ⨯ ছিল src/lib/agent/tools/video.ts:465-এ — প্যারালাল পাইপলাইন-এজেন্টের মিড-এডিট, পরের রিকোয়েস্টেই ✓ Compiled)

Stage Summary:
- পরিবর্তিত ফাইল: src/components/studio/studio-view.tsx (নতুন), src/hooks/use-system.ts (নতুন), registry-view.tsx, production-card.tsx, guide-view.tsx, artifact-view.tsx, empty-state.tsx, sidebar.tsx, page.tsx, use-ui-view.ts (নোট) — types.ts বা কোনো backend/lib ফাইল স্পর্শ করা হয়নি
- মূল এজেন্টের জন্য নোট: ArtifactMeta.meta-র রেন্ডারিং সম্পূর্ণভাবে optional-নিরাপদ — পাইপলাইন-এজেন্ট meta বসালেই যাচাই/ইঞ্জিন-কার্ড দেখা যাবে (speech: verification+languageLabel+voice; ভিডিও: shotEngineLabels+honestLabel; ইনস্ট্রুমেন্টাল: tempoBpm+keyLabel+beatsSec+sections+honestLabel); registry-view-এর QueryClientProvider লোকাল — ভবিষ্যতে গ্লোবাল প্রভাইডার চাইলে layout.tsx-এ নিতে পারবেন; sidebar ViewNav এখন grid-cols-3 (৬ ভিউ, ২ সারি)
- সীমা: মোবাইল-যাচাই viewport-emulation-ভিত্তিক (৩৯০x৮৪৪) + কোড-পর্যালোচনা; /api/system-এর LLM/TTS স্বাস্থ্য এখন 'down' (429 রেট-সীমা) — UI সেটা সৎভাবেই লাল ডটে দেখাচ্ছে

---
Task ID: 7 (সাবএজেন্ট টাইমআউট — মূল এজেন্ট যাচাই-সহ সম্পন্ন)
Agent: full-stack-developer (pipelines) + main (সংশোধন/পরীক্ষা)
Task: নতুন মাস্টার প্ল্যান §৬/§৭/§২-অনুযায়ী ৪টি পাইপলাইন আপগ্রেড

Work Log (সাবএজেন্ট): motion_video (৩০১→৫৭৮ লাইন), music_video (৪২৪→৬৮৪), short_film (৬১২→১২২৪), audio (৩০৬→৫৩৯) — ধাপ-key চুক্তি মেনে, নতুন কোর-মডিউল (ai_video/sound_design/music_engine/language_controller) সংযুক্ত, সৎ-লেবেল/ফলব্যাক/Character-পুনঃব্যবহার — কোড লেখা শেষে রিপোর্টের আগে টাইমআউট।
Work Log (মূল এজেন্ট):
- tsc শূন্য নিশ্চিত + ধাপ-key যাচাই (মাল্টি-লাইন regex): সব পাইপলাইনে চুক্তিসম্মত key
- বাগ-ফিক্স: mixSoundLayers-এর ডাকিং-গ্রাফে অব্যবহৃত [musicSc] প্যাড → ffmpeg ব্যর্থ — asplit সংশোধন (৪-স্তর A1+A2+A4+A5 মিক্স এখন সফল, LUFS −২৭.২)
- TTS ব্যাকঅফ ধৈর্যশীলতর: ৫ চেষ্টা × ২০ সে.-বেস (৪২৯-বাস্তবতা)
- E2E ধূম-পরীক্ষা (pipeline-smoke.ts): (১) instrumental — ৬ সে.-এ completed, WAV+MP3, ৫ ধাপ ✓; (২) বাংলা ভয়েসওভার — verify-ধাপসহ completed ✓; (৩) মিউজিক ভিডিও (প্রসিডিউরাল গান+cinematic) — ৬ ধাপ, ২০.০৭ সে. গান-সমলয়, avSyncOk ✓; (৪) শর্টফিল্ম (cinematic) — ৮ ধাপ সম্পূর্ণ, ফিল্ম+SRT+সংলাপ-অডিও, সৎ partialNotes (এক TTS-লাইন ৪২৯-ব্যর্থ সৎভাবে রিপোর্ট) ✓; (৫) AI মোশন-ভিডিও — প্রকৃত CogVideoX-3 শট, লেবেল "শট 1: প্রকৃত AI (cogvideox-3)" ✓
- speech-tool-smoke: ১০/১০ (বাংলা রায় warn+নোট, ইংরেজি রাউন্ড-ট্রিপ, অসামঞ্জস্য-ত্রুটি, স্বয়ংক্রিয় শনাক্তকরণ, analyze_audio)

Stage Summary:
- ৫টি পাইপলাইনই নতুন কাঠামোতে বাস্তব-চালিত সফল; সৎ-ফলব্যাক/লেবেল-ব্যবস্থা সর্বত্র

---
Task ID: 10
Agent: main (Z.ai Code orchestrator)
Task: Definition of Done যাচাই (§১৪) + ব্রাউজার-E2E + চূড়ান্ত ইন্টিগ্রেশন

Work Log:
- স্টুডিও-ভিউ ব্রাউজার-যাচাই: ৩ ট্যাবে ১৬ মোড-কার্ড (চালু/পরীক্ষামূলক/অবরুদ্ধ ব্যাজ সঠিক), "শুরু করুন" → চ্যাটে draft+ফোকাস ✓
- রেজিস্ট্রি-ভিউ: সিস্টেম-প্যানেল (হার্ডওয়্যার-চিপ ২ কোর/৪.১GB/৭.৩GB খালি/GPU নেই + টুল-স্বাস্থ্য + পুনঃচেক) ✓
- গোল্ডেন-পাথ (ব্রাউজার-চ্যাট): "রোমান্টিক ইনস্ট্রুমেন্টাল ১৫ সে. ৯০ BPM" → এজেন্ট generate_instrumental কল → অ্যাক্টিভিটি-কার্ড সম্পন্ন → চূড়ান্ত উত্তরে সৎ-লেবেল ("প্রসিডিউরাল… নিউরাল মডেল নয়") → অডিও-প্লেয়ার (artifact প্রকৃত চালু) ✓
- মোবাইল ৩৯০×৮৪৪: কোনো হরাইজন্টাল-স্ক্রল নেই, ফুটার ৮৪৪-এ আটকা ✓; ডেস্কটপ ১২৮০×৮০০ ✓; console/page errors শূন্য ✓
- §১৫ প্রথম বাস্তব মাইলস্টোন-উপাদান যাচাই: বাংলা সংলাপ (ভাষা-যাচাইসহ) ✓ + প্রকৃত AI-generated চলমান শট (CogVideoX-3) ✓ + ব্যাকগ্রাউন্ড সাউন্ড-স্তর (A1–A5 মিক্স) ✓ — লিপ-সিঙ্ক অংশ সৎ-অবরুদ্ধ
- টেস্ট-ডাটা পরিষ্কার (সব ধূম-কথোপকথন/প্রোডাকশন/artifact); bun run lint শূন্য; tsc src/ শূন্য; dev.log পরিষ্কার

Stage Summary:
- §১৪-এর ১৫ দফার অবস্থা: ১,২ (বাংলা/ইংরেজি TTS+যাচাই) ✓ · ৩ ইনস্ট্রুমেন্টাল ✓ (পরীক্ষামূলক-সৎ) · ৪ গান-গাওয়া অবরুদ্ধ-সৎ · ৫,৬ (t2v/i2v প্রকৃত মোশন) ✓ · ৭ চরিত্র-অ্যানিমেশন পরীক্ষামূলক-সৎ · ৮,৯ লিপ-সিঙ্ক অবরুদ্ধ-সৎ · ১০ (A1–A5 ট্র্যাক) ✓ · ১১ (A/V সমলয়-যাচাই) ✓ · ১২ (বহু-দৃশ্য শর্টফিল্ম+সংলাপ+সাউন্ড+সাবটাইটেল+এক্সপোর্ট) ✓ · ১৩ (সৎ এরর/রিট্রাই/ফলব্যাক) ✓ · ১৪ (লাইসেন্স-রেজিস্ট্রি) ✓ · ১৫ (প্রিভিউ+রিভিশন-ফ্লো আগের সেশন থেকে চালু) ✓

---
Task ID: S1 (Unlock Master Plan — Sprint 1: Audit + Availability Matrix + False-Block সংশোধন)
Agent: main (Z.ai Code orchestrator)

Task: নতুন মাস্টার প্ল্যান (Unlock All Permitted AI Tools) §১–§৩ অডিট, চার-মাত্রিক স্ট্যাটাস কাঠামো, ভুল লাইসেন্স-সিদ্ধান্ত সংশোধন, Model & Tool Availability Matrix

Work Log:
- পূর্ণ অডিট: SDK v0.0.18-র সম্পূর্ণ API surface (index.d.ts) ম্যাপিং — ১০টি প্রকাশিত মেথড: chat.completions.create, createVision, audio.tts.create, audio.asr.create, images.generations.create/edit, images.search.create, video.generations.create, async.result.query, functions.invoke(web_search|page_reader)
- **লাইভ-প্রোব সফল (tmp-sprint2/probe-sdk-catalog.ts):** (ক) `images.search.create` SDK মেথড কাজ করে — ৩ ফলাফল ৯.৫ সে.-এ (আগে CLI-only ভাবা হত!); (খ) `video.generations.create({with_audio:true})` → ৫.২ সে. MP4-তে **প্রকৃত AAC অডিও-স্ট্রিম (16kHz mono)** ffprobe-নিশ্চিত; (গ) `request_id` প্যারামিটার গৃহীত ও echo-হয়ে ফেরে — **idempotency সমর্থিত**
- লাইসেন্স-যাচাই (web-search, §২-এর বাধ্যতামূলক নিয়ম): MusicGen ওয়েট CC-BY-NC 4.0 নিশ্চিত (HuggingFace মডেল-কার্ড); YuE ওয়েট CC-BY-NC 4.0; Wan2.2 মূলত Apache-2.0
- ভুল-সিদ্ধান্ত সংশোধন: MusicGen "blocked"(লাইসেন্স) → `allowed_noncommercial` + প্রকৃত বাধা `unavailable_hardware` + `not_exposed_by_sdk`; singing-tts-ও একই সংশোধন। রেজিস্ট্রিতে এখন কেউই blocked_by_license নয় — কোনো অ-বাণিজ্যিক-মডেল অযথা অবরুদ্ধ নেই
- prisma/schema.prisma: ModelEntry-তে ১০টি নতুন কলাম (licenseStatus, providerStatus, integrationStatus, runtimeStatus, apiEndpoint, apiModelId, lastTestedAt, lastTestNote, errorReason, toolsJson) + db:push; dev-server daemonize-রিস্টার্ট (পুরোনো Prisma-client ক্যাশ)
- types.ts: LicenseStatus/ProviderStatus/IntegrationStatus/RuntimeStatus টাইপ + ModelEntryView-সম্প্রসারণ + AvailabilityMatrixRow/Response (MatrixOverall: available|available_with_limits|experimental|unavailable_here|future)
- model-registry-data.ts: সম্পূর্ণ পুনর্লিখন — ২২ এন্ট্রি (নতুন: platform-image-search, platform-video-audio, platform-functions), প্রতিটিতে ৪-মাত্রিক স্ট্যাটাস + apiEndpoint + lastTestNote + errorReason + tools তালিকা
- availability-matrix.ts (নতুন): §৫-এর ঐক্য ক্ষমতা-টেবিল — ২৩ সারি (speech থেকে short_film পর্যন্ত), প্রতিটিতে ৪-মাত্রিক রায় + overall + honestNote + fallback; matrixRowForTask() + availabilityMatrixResponse() (usageMode + legend-সহ)
- /api/availability (নতুন GET): ম্যাট্রিক্স-প্রতিক্রিয়া; /api/registry: নতুন ফিল্ডসহ idempotent upsert (প্রতি কলে রিফ্রেশ) — curl-যাচাই: ২২ এন্ট্রি সব নতুন ফিল্ডসহ ✓, ম্যাট্রিক্স ২৩ সারি ✓
- capability-শ্রেণির সৎ রায়: TTS=available_with_limits (bn-প্রিভিউ বাধ্যতামূলক), instrumental=experimental (প্রসিডিউরাল-সৎ), full_song/টকিং-পোর্ট্রেট/গান-লিপসিঙ্ক=future/unavailable_here (কারণ-ভাঙনসহ), t2v/i2v/video_native_audio=available (প্রোব-যাচাইকৃত)

Stage Summary:
- **প্রথম Deliverable তৈরি ও লাইভ:** Model & Tool Availability Matrix (/api/availability) — সব মডেলের license/provider/integration/runtime/hardware/final-status একসাথে
- তিনটি নতুর আবিষ্কার SDK-তে: images.search SDK-মেথড, with_audio নেটিভ-অডিও, request_id idempotency — এগুলো এখন পাইপলাইনে যুক্ত হবে
- Task 2-b (backend) ও 2-c (frontend) সাবএজেন্টের জন্য প্রস্তুত; কাজের বিস্তারিত নিচের টাস্ক-বরাদ্দে

---
Task ID: 2-b (Unlock Master Plan — Backend Hardening)
Agent: full-stack-developer (backend)
Task: §১০ রিট্রাই-নীতি ওভারহল (Retry-After + ফুল-জিটার এক্সপোনেনশিয়াল) + SDK-প্রথম ছবি-সার্চ + ভিডিও আইডেম্পোটেন্সি/নেটিভ-অডিও-যাচাই + লিপ-সিঙ্ক ৪-মাত্রিক ভাঙন — সব সৎ-রায়, ৪২৯ কখনো লাইসেন্স-সমস্যা নয়

Work Log:
- sdk-helpers.ts: withRetry পুনর্লিখন — ত্রুটি-বস্তু থেকে Retry-After পার্স (err.retryAfter / headers['retry-after'] / বার্তা-টেক্সট; সেকেন্ড-সংখ্যা বা HTTP-date), Retry-After না থাকলে ফুল-জিটার এক্সপোনেনশিয়াল ব্যাকঅফ delay=random(baseMs/2, baseMs×2^attempt) ছাদ ৯০ সে., চেষ্টা-সংখ্যা কনফিগারযোগ্য (ডিফল্ট ৪); ৪২৯-নিঃশেষে নতুন এক্সপোর্টেড TemporarilyUnavailableError (বার্তা-প্রিফিক্স `TEMPORARILY_UNAVAILABLE:`) — UI এখন "সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট)" দেখাতে পারবে, ৫xx/টাইমআউট-নিঃশেষে আগের সৎ-বার্তাই; নতুন imageSearchSdkFirst(query,count) — SDK zai.images.search.create প্রাথমিক (প্রোব-যাচাইকৃত), ব্যর্থে CLI ফলব্যাক (z-ai image-search, ১৫০ সে. টাইমআউট), ফলাফল {results:[{url,caption,source,width?,height?}], via:'sdk'|'cli'}; parseRetryAfterMs/fullJitterDelayMs/isRateLimitErrorText-ও এক্সপোর্টেড; সব পুরনো এক্সপোর্ট অক্ষত
- registry.ts: search_images টুল এখন imageSearchSdkFirst ব্যবহার করে — একই নাম/প্যারামিটার/artifact-আকৃতি, resultJson-এ নতুন via:'sdk'|'cli' (সারাংশেও কোন পথ বলে), টুল-টাইমআউট ২৪০ সে.-এ (SDK+CLI উভয় পথের জন্য)
- ai_video.ts (§৭.১+§১০): AiVideoRequest-এ requestKey? — deriveRequestId (sanitized চাবি + প্রম্পটের sha1-হ্যাশ) থেকে নির্ধারক request_id, লুপের বাইরে একবারই তৈরি তাই ৪২৯-পুনঃসাবমিটেও একই id (প্রোভাইডার ডিডুপ্লিকেট করে — S1-প্রোবে request_id echo-যাচাইকৃত ছিল); validateVideoBuffer-র VideoValidation {ok, issues, info, hasAudio, audioCodec?} + expectAudio প্যারামিটার — 'অডিও-স্ট্রিম নেই' issue কেবল with_audio চাওয়া হলে, অন্যথা অডিও-অনুপস্থিতি কখনো ব্যর্থতা নয়; AiVideoClip-এ nativeAudio ফিল্ড; সাবমিট-ব্যাকঅফ এখন Retry-After-সচেতন + এক্সপোনেনশিয়াল+জিটার (৬০ সে. ভিত্তি → ৯০ সে. ছাদ), ৪২৯-নিঃশেষে TEMPORARILY_UNAVAILABLE:, ৫xx/টাইমআউটে আলাদা সৎ-বার্তা
- lip_sync_module.ts (§৮): LIP_SYNC_STATUS-এ ৪+১-মাত্রিক বাধা-ভাঙন — license:'needs_review' (Wav2Lip একাডেমিক-কেবল শর্ত, SadTalker/MuseTalk আলাদা), provider:'not_exposed_by_sdk' (SDK-তে লিপ-সিঙ্ক API নেই), hardware:'unavailable_hardware' (৪–১২GB VRAM, GPU নেই), integration:'not_integrated', benchmark:'not_done' (+গানে আলাদা বেঞ্চমার্ক-নোট) + প্রতি-মাত্রার ব্যাখ্যা LIP_SYNC_BLOCKAGE_NOTES-এ; lipSyncCapabilityReport() পুরনো আকৃতি + নতুন blockageDimensions ফিল্ড; runLipSync-এর সৎ-ত্রুটিতে ৪ মাত্রা + বিকল্প (সংলাপ-অডিও + AI-দৃশ্য আলাদা, মুখ-নড়াচড়ার দাবি নেই)
- capability_router.ts: নতুন রুট-ধরন video_native_audio — tool 'generate_video/image_to_video (withAudio)', ইঞ্জিন 'CogVideoX-3 with_audio (ক্লাউড ডিফিউশন + নেটিভ অডিও)', ready, নোটে প্রোব-যাচাইকৃত AAC-স্ট্রিম + ffprobe-যাচাই; VideoRequestKind টাইপ ও capabilityRouterTableBn() লেবেলসহ হালনাগাদ
- system-info.ts: স্ট্যাটিক স্বাস্থ্যে নতুন {image-search: ok, 'SDK-মেথড প্রোব-যাচাইকৃত (২০২৬-১০-১১); CLI-ফলব্যাক আছে'} ও {video-audio: ok, 'প্রোব-যাচাইকৃত: প্রকৃত AAC স্ট্রিম আসে'}; লিপ-সিঙ্ক নোট → '৪-মাত্রিক বাধা: SDK-তে API নেই · GPU নেই · অ্যাডাপ্টার নেই · বাংলা বেঞ্চমার্ক হয়নি'
- prompts.ts: সততা-অংশে ২টি নতুন নিয়ম — (ক) ভিডিওতে পরিবেশ-শব্দ চাইলে withAudio-তে প্রকৃত নেটিভ AAC অডিও আসে (ffprobe-যাচাইকৃত; নেটিভ বনাম প্রসিডিউরাল সৎভাবে জানাতে), (খ) ৪২৯/রেট-লিমিট = "সাময়িক রেট-লিমিট" — কখনো লাইসেন্স/অনুমতির সমস্যা নয়; TEMPORARILY_UNAVAILABLE দেখলে সেটিই বলতে; বাকি সব সততা-নিয়ম অক্ষত
- পাইপলাইন (হালকা স্পর্শ, কাঠামো অপরিবর্তিত): motion_video-র AiShotRequest-এ requestKey? (generateVideoClip-এ পাস-থ্রু) + ৩টি কল-সাইটে §১০ চাবি — motion: `${productionId}-shot-${i+1}`, music_video: `mv-…`, short_film: `sf-…` (productionId PipelineContext-এ প্রত্যেক পাইপলাইনের স্কোপে আছে)
- যাচাই: bunx tsc --noEmit → src/-এ ০ এরর (আগের এরর কেবল examples/, skills/, tmp-task2d/ — অস্পৃষ্ট); bunx eslint (১০টি স্পর্শিত ফাইল) → ০; bun run lint (পুরো প্রজেক্ট) → ০; ধূম-স্ক্রিপ্ট tmp-sprint2/retry-policy-smoke.ts (bun) → ২১/২১ পাস — জিটার-সীমা [floor,ছাদ] ১০০০ নমুনায়, এক্সপোনেনশিয়াল ছাদ-বৃদ্ধি, নিরন্তর ৪২৯→TemporarilyUnavailableError+প্রিফিক্স, নিরন্তর ৫০৩→সাধারণ সৎ-ব্যর্থতা, Retry-After পার্স (সংখ্যা/headers/বার্তা/HTTP-date) ও ব্যাকঅফে সম্মান, বাস্তব imageSearchSdkFirst কল → via:'sdk' ৩ ফলাফল ২.২ সে.-এ; curl: /api/tools ২০০, /api/registry ২০০, /api/availability ২০০, /api/system ২০০ (নতুন image-search/video-audio স্ট্যাটিক এন্ট্রি লাইভ প্রতিক্রিয়ায় দেখা গেছে); dev.log-এ কম্পাইল-এরর নেই; ধূম-স্ক্রিপ্ট DB স্পর্শ করে না — পরিষ্কার করার টেস্ট-ডেটা নেই

Stage Summary:
- §১০ পুরোণোভাবে বাস্তবায়িত: Retry-After-সচেতন ফুল-জিটার এক্সপোনেনশিয়াল রিট্রাই (৯০ সে. ছাদ) + আইডেম্পোটেন্সি-চাবি (request_id) + ৪২৯-নিঃশেষে TEMPORARILY_UNAVAILABLE সৎ-রায় — ৪২৯ আর কখনো লাইসেন্স-সমস্যা হিসেবে দেখাবে না
- তিনটি SDK-আবিষ্কার (S1-প্রোব) এখন উৎপাদন-পথে: images.search SDK-মেথড (via:'sdk'|'cli'), with_audio নেটিভ-AAC-যাচাই (expectAudio→hasAudio/nativeAudio), request_id ডিডুপ্লিকেশন — পাইপলাইন-শটে স্বয়ংক্রিয়
- লিপ-সিঙ্ক এখন ৪-মাত্রিক সৎ-ভাঙনসহ (license/provider/hardware/integration + benchmark) — registry/matrix/UI-তে blockageDimensions থেকে নেওয়া যাবে
- সীমা: tools/video.ts-এর generate_video/image_to_video স্কিমায় withAudio প্যারামিটার এখনো নেই (সে ফাইল এই টাস্কের স্কোপে ছিল না) — মডিউল/পাইপলাইন স্তরে ক্ষমতাটি চালু ও video_native_audio রুটে বিজ্ঞাপিত; ফ্রন্টএন্ড TEMPORARILY_UNAVAILABLE প্রিফিক্স ধরে নতুন বাংলা বার্তা দেখাতে পারবে (2-c-এর কাজ হতে পারে)

---
Task ID: 2-c (Unlock Master Plan — Availability Matrix UI)
Agent: full-stack-developer (frontend)
Task: মাস্টার প্ল্যান §১৫/§১১ অনুযায়ী Availability Matrix UI — রেজিস্ট্রিতে ২৩-সারির চার-মাত্রিক ম্যাট্রিক্স-প্যানেল, স্টুডিও-মোড-কার্ডে লাইভ ম্যাট্রিক্স-নির্ণীত সৎ স্ট্যাটাস, গাইডে Router+DoD সততা-আপডেট।

Work Log:
- নতুন `src/hooks/use-availability.ts`: useAvailability() — useQuery (use-system.ts-এর প্যাটার্ন: staleTime ৫ মি., retry ১, refetchOnWindowFocus বন্ধ), type-only import @/lib/types থেকে; ফেরত দেয় { data, isLoading, error, refetch }
- নতুন `src/components/studio/availability-badges.tsx` (শেয়ার্ড): OVERALL/LICENSE/PROVIDER/INTEGRATION/RUNTIME মেটা-ম্যাপ (emerald=চালু/স্বাস্থ্যবান, amber=সীমা/যাচাই-বাকি/আংশিক, stone=এই-পরিবেশে-অনুপলব্ধ, dashed stone=ভবিষ্যৎ, কেবল blocked_by_license=লাল) + OverallBadge + DimensionChip উপাদান — রেজিস্ট্রি ও স্টুডিও উভয়ে পুনঃব্যবহৃত
- bn-format.ts-এ নতুন formatDateBn() ("১১ অক্টোবর ২০২৬" — শুধু-তারিখ ISO-তে টাইমজোন-নিরাপে); বাকি সব অপরিবর্তিত
- registry-view.tsx: শীর্ষে নতুন "মডেল ও টুল অ্যাভেইলেবিলিটি ম্যাট্রিক্স" প্যানেল — usageMode-ঘোষণা (পরিবেশ+ব্যবহার+নোট), ৬টি ফিল্টার-চিপ সংখ্যাসহ (সব ২৩/চালু ১২/সীমাসহ ৪/পরীক্ষামূলক ৩/অনুপলব্ধ ২/ভবিষ্যৎ ২, min-h-11), ডেস্কটপে ৬-কলাম টেবিল-গ্রিড (ক্ষমতা+মডেল+টুল-চিপ | ৪ মাত্রা | সামগ্রিক) বনাম মোবাইলে স্ট্যাকড কার্ড (চিপ-র‍্যাপ), সারি-প্রসারণে (Collapsible) চার-মাত্রিক বিশ্লেষণ (legend-টেক্সটসহ — কোন মাত্রা বাধা স্পষ্ট) + apiEndpoint/apiModelId + শেষ পরীক্ষা (বাংলা তারিখ) + lastTestNote + honestNote + fallback + errorReason (amber সতর্ক-বক্স), max-h-[28rem] কাস্টম-স্ক্রলবার, লেজেন্ড-চিপস (২৪টি); QueryClientProvider রেজিস্ট্রি-ভিউয়ের শীর্ষে উত্তোলিত (use-system + use-availability একই ক্লায়েন্ট)
- ModelEntryCard-সম্প্রসারণ: চার-মাত্রিক চিপ + tools-চিপ + apiEndpoint/apiModelId (mono) + "শেষ পরীক্ষা: <তারিখ> — নোট" + errorReason (amber, "অনুপলব্ধতার প্রকৃত কারণ:") — §৯.১ কী-রেন্ডার অক্ষুণ্ণ
- সারাংশ-স্ট্রিপে সৎ নোট: "কোনো মডেল লাইসেন্স-অবরুদ্ধ নয় — অনুপলব্ধতার প্রকৃত কারণ… ম্যাট্রিক্সে দেখুন"; 'অবরুদ্ধ' সেকশন এখন শূন্য-হলে লুকানোই (গণনা-লেবেল "অবরুদ্ধ (লাইসেন্সে)")
- studio-view.tsx (§১১): ModeStatus সম্প্রসারিত (active/limited/experimental/unavailable/future) — statusFromOverall() ম্যাপ; প্রতিটি মোডে matrixKey (audio→cap-speech/cap-instrumental/cap-full-song; video→cap-t2v/cap-i2v/cap-video-audio/cap-character-motion/cap-talking-portrait/cap-singing-lipsync/cap-video-editing; film→cap-short-film/cap-music-video/cap-motion-video) — ম্যাট্রিক্স লোড হলে overall-রায়ই ব্যাজ (TTS/ভয়েসওভার→"সীমাসহ", পূর্ণ-গান→"ভবিষ্যৎ", লিপ-সিঙ্ক→"অনুপলব্ধ (এখানে)", ফিল্ম→"সীমাসহ"/"চালু"), না লোড হলে হার্ডকোডেড সৎ ফলব্যাক; কার্ডে চার-মাত্রিক চিপ + "শেষ পরীক্ষা: <তারিখ>" চিপ + অফ-মোডে "কারণ: <errorReason>" (stone) ও "বিকল্প: <fallback>" (emerald) নোট; নতুন ৭ম ভিডিও-মোড "নেটিভ-অডিওসহ AI ভিডিও" (cap-video-audio, CogVideoX-3 with_audio — S1-আবিষ্কৃত লাইভ ক্ষমতা, draft-সহ); লোকাল QueryClientProvider-র‍্যাপার
- guide-view.tsx: §৪.৩ Capability Router ৮ সারি — নতুন "ভিডিওর সাথে নেটিভ অডিও" → generate_video (withAudio) → "CogVideoX-3 with_audio (ক্লাউড)" → চালু; 'অবরুদ্ধ'→'অনুপলব্ধ' শব্দচুক্তি; §১৪ DoD-এ blocked→unavailable ("অনুপলব্ধ") + দুই সারিতে "বাধা: GPU/API (লাইসেন্স নয়)" + নতুন সৎ নোট ("লাইসেন্স-কারণে অবরুদ্ধ মডেল নেই…ম্যাট্রিক্সে দেখুন") + item-১৫-এ ম্যাট্রিক্স-উল্লেখ; Phase 5 'অবরুদ্ধ-সৎ'→'অনুপলব্ধ-সৎ' (কারণ-ভাঙনসহ); CAPABILITIES/HONESTY-তে নেটিভ-অডিও ও লাইসেন্স-স্পষ্টতা
- যাচাই: bunx tsc --noEmit → src/-এ ০ এরর (examples/skills/tmp-এর পুরোনো এরর অ-সংশ্লিষ্ট); bunx eslint (৬টি স্পর্শিত ফাইল) → ০; agent-browser E2E: ম্যাট্রিক্স ২৩ সারি+ফিল্টার-গণনা সঠিক, "অনুপলব্ধ" ফিল্টার→২ সারি, সারি-প্রসারণে চার-মাত্রিক বিশ্লেষণ+কারণ+বিকল্প ✓, সৎ নোট ✓, ModelEntryCard-চিপ ✓, স্টুডিও ৩ ট্যাবে ম্যাট্রিক্স-নির্ণীত ব্যাজ+চিপ+শেষ-পরীক্ষা+কারণ+বিকল্প ✓, নতুন নেটিভ-অডিও মোড ✓, গাইড ৮-সারি রাউটার+DoD-নোট ✓; মোবাইল ৩৯০×৮৪৪: গাইড/রেজিস্ট্রি/স্টুডিও — কোনো horizontal overflow নেই (390 vs 390); console/page errors শূন্য; dev.log-এ কম্পাইল-এরর নেই (সব API 200)

Stage Summary:
- পরিবর্তিত ফাইল: src/hooks/use-availability.ts (নতুন), src/components/studio/availability-badges.tsx (নতুন), src/components/studio/registry-view.tsx, src/components/studio/studio-view.tsx, src/components/studio/guide-view.tsx, src/components/chat/bn-format.ts (শুধু নতুন formatDateBn-সংযোজন) — src/lib/**, src/app/api/**, prisma/ স্পর্শ করা হয়নি
- §১৫-এর প্রথম Deliverable এখন UI-তে লাইভ: প্রতিটি ক্ষমতার license/provider/integration/runtime/overall রঙ-কোডেড, প্রসারণযোগ্য বিস্তারিতসহ; কোনো মডেল "লাইসেন্স-অবরুদ্ধ" দেখায় না — প্রকৃত কারণ মাত্রা-ভিত্তিক
- স্টুডিও-ব্যাজ এখন হার্ডকোডেড নয় — /api/availability-র overall থেকে নির্ণীত (ফলব্যাকসহ); ১৬→১৭ মোড (নেটিভ-অডিওসহ AI ভিডিও নতুন)
- বিস্তার নোট: টাস্ক-বর্ণনায় "১৬ মোড-কার্ড" ছিল; cap-video-audio-কে ম্যাপ করতে ৭ম ভিডিও-মোড যোগ করা হয়েছে (S1-প্রোব-যাচাইকৃত লাইভ ক্ষমতা — ব্যবহারকারীর অ্যাক্সেসের জন্য); audio-bn-voiceover→cap-speech ম্যাপ (TTSই মূল ইঞ্জিন, ASR-সীমা honestNote-এ অন্তর্ভুক্ত)

---
Task ID: S2 (Unlock Master Plan — Sprint 2–7: API Integration, Retry/Idempotency, Native Audio, UI Matrix, ফাইনাল যাচাই)
Agent: main (Z.ai Code orchestrator) + subagents 2-b (backend), 2-c (frontend)

Task: সাবএজেন্ট-ফল ইন্টিগ্রেশন + tools/video.ts-এ withAudio/native_ai সম্পূর্ণতা + ব্রাউজার-E2E + ফাইনাল রিপোর্ট

Work Log (subagent 2-b, backend):
- sdk-helpers.ts: withRetry পুনর্লিখন — Retry-After (সেকেন্ড/HTTP-date) সম্মান, full-jitter exponential backoff (90 সে. ক্যাপ), TemporarilyUnavailableError ('TEMPORARILY_UNAVAILABLE:' প্রিফিক্স) — 429 কখনো লাইসেন্স-সমস্যা হিসেবে দেখায় না; imageSearchSdkFirst() (SDK-প্রাথমিক + CLI-ফলব্যাক)
- registry.ts: search_images এখন SDK-পথে (resultJson-এ via: 'sdk'|'cli')
- ai_video.ts: requestKey → নির্ধারক request_id (deriveRequestId, রিট্রাই-চক্রের বাইরে একবার তৈরি — ৪২৯-পুনঃসাবমিটে একই id → provider-side ডিডুপ); validateVideoBuffer-এ expectAudio + hasAudio/audioCodec; AiVideoClip.nativeAudio; সাবমিট-ব্যাকঅফ Retry-After-সচেতন
- lip_sync_module.ts: ৪-মাত্রিক বাধা-ভাঙন (license: needs_review, provider: not_exposed_by_sdk, hardware: unavailable_hardware, integration: not_integrated + benchmark: not_done) — blockageDimensions ফিল্ড
- capability_router.ts: নতুন video_native_audio রুট (৮ রুট); system-info.ts: image-search/video-audio স্বাস্থ্য + লিপ-সিঙ্ক ৪-মাত্রিক নোট; prompts.ts: withAudio + 429-সততা নিয়ম
- পাইপলাইন: motion_video/music_video/short_film-এ requestKey থ্রেডিং (${productionId}-shot-N)
- ধূমপরীক্ষা 21/21 (jitter-বাউন্ড, 429→TemporarilyUnavailableError, 503→সাধারণ সৎ-ত্রুটি, Retry-After পার্সিং, প্রকৃত imageSearchSdkFirst → via:'sdk')

Work Log (subagent 2-c, frontend):
- use-availability.ts (নতুন hook) + availability-badges.tsx (শেয়ার্ড রং-চুক্তি: emerald=চালু, amber=সীমা/যাচাই, stone=অনুপলব্ধ/ভবিষ্যৎ)
- registry-view.tsx: ম্যাট্রিক্স প্যানেল (২৩ ক্ষমতা, ৬ ফিল্টার-চিপ, সম্প্রসারিত সারিতে ৪-মাত্রিক বিশ্লেষণ + API + শেষ-পরীক্ষা + কারণ + বিকল্প), ModelEntryCard-এ ৪-মাত্রিক চিপ, খালি 'blocked' গ্রুপ লুকানো + সৎ নোট
- studio-view.tsx: ১৭টি মোড-কার্ড এখন ম্যাট্রিক্স-চালিত স্ট্যাটাস + শেষ-পরীক্ষা + কারণ/বিকল্প; নতুন ১৭তম কার্ড 'নেটিভ-অডিওসহ AI ভিডিও'
- guide-view.tsx: ৮-সারির router টেবিল + DoD সৎ-হালনাগাদ

Work Log (main, ইন্টিগ্রেশন):
- tools/video.ts: generate_video-র sound-এ নতুন 'native_ai' মোড — AI-শটে withAudio+requestKey, অডিও-সংরক্ষী স্বাভাবিকীকরণ (-ar 44100 -ac 2), concatClipsKeepAudio (নতুন হেল্পার: নীরব ক্লিপে নীরব-ট্র্যাক যোগ → concat-demuxer; এই মোডে ট্রানজিশন নেই — সৎ নোট), nativeAudioShots গণনা + সৎ honestLabel/summary ('নেটিভ-অডিও আসেনি' হলে প্রতারণা নয়)
- image_to_video: withAudio প্যারামিটার + সৎ নেটিভ-অডিও লেবেল + requestKey
- bunx tsc --noEmit: src/-এ শূন্য (পুরোনো tmp-task2d/examples/skills-এর এরর অপ্রাসঙ্গিক); bun run lint: শূন্য
- ব্রাউজার-E2E: হোম ✓; রেজিস্ট্রি-ম্যাট্রিক্স (২৩ সারি + ফিল্টার-গণনা + সম্প্রসারিত বিস্তার + 'কোনো মডেল লাইসেন্স-অবরুদ্ধ নয়') ✓; অনুপলব্ধ-ফিল্টারে লিপ-সিঙ্ক ৪-মাত্রিক ভাঙন ✓; স্টুডিও-কার্ড (শেষ-পরীক্ষা ১১ অক্টোবর ২০২৬, কারণ, বিকল্প) ✓; চ্যাট golden path: 'পাহাড়ের ছবি খুঁজে আনো' → search_images SDK-পথে ৩.০ সে. (z-cdn URL) → ৪ artifact + প্রিভিউ ✓; গাইড ৮-সারির রাউটার ✓; মোবাইল ৩৯০×৮৪৪: কোনো overflow নেই, ফুটার ৮৪৪-এ ✓; console/page errors শূন্য ✓; টেস্ট-কথোপকথন মুছে ফেলা ✓

Stage Summary:
- §১৪-এর ১২ দফা� অবস্থা: (১) ভুল-ব্লক নেই ✓ (২) লাইসেন্স-সিদ্ধান্তে সূত্র ✓ (৩) API-মডেলের বাস্তব endpoint প্রোব-যাচাইকৃত ✓ (৪) হার্ডওয়্যারে-অসম্ভব মডেল 'ready' নয় ✓ (৫) bn-TTS/instrumental/রিয়েল AI-ভিডিও E2E পাস ✓ (৬) full-song/lip-sync/singing পৃথক-সৎ ✓ (৭) সৎ এরর+ফলব্যাক ✓ (৮) 429-হ্যান্ডলিং (Retry-After/jitter/idempotency/TEMPORARILY_UNAVAILABLE) ✓ (৯) কোনো bypass নয় ✓ (১০) UI-তে permission/capability/runtime পৃথক ✓ (১১) generation_mode লেবেল ✓ (১২) কোনো fake success নয় ✓
- নতুন-চালু ক্ষমতা: SDK ইমেজ-সার্চ (৩ সে.), ভিডিও নেটিভ AI-অডিও (with_audio, প্রোব-যাচাইকৃত AAC), request_id idempotency
- মিথ্যা-ব্লক সংশোধিত: MusicGen ও YuE এখন allowed_noncommercial — প্রকৃত বাধা হার্ডওয়্যার/API, UI-তে স্পষ্ট

---
Task ID: S8-0 (session-8 kickoff)
Agent: main
Task: নতুন ১৫-ধাপী "AI Creative Studio — Local-First সমস্যা সমাধান পরিকল্পনা" গ্রহণ; Phase-1/2 কাজের চুক্তি প্রস্তুত

Work Log:
- types.ts: QualityStatus (পাঁচম মাত্রা — quality_status) + ModelEntryView.qualityStatus + AvailabilityMatrixRow.quality; HardwareReport স্থানান্তরিত types.ts-এ (system-info.ts re-export করে); HardwareVerdict (৯-অবস্থা)/HardwareModelAssessment/HardwareManagerResponse; BnBenchmarkCategory/BnBenchmarkSentence/TtsBenchmarkAudioChecks/TtsBenchmarkSentenceResult/TtsBenchmarkReport
- availability-matrix.ts: ২৩ সারিতে quality মান যোগ (cloud-পথ = machine_checked, bn-speech/ASR + প্রাসিডিউরাল ইঞ্জিন = not_verified — ব্যবহারকারীর smoke/functional/quality ত্রিস্তরের সংজ্ঞা মেনে); cap-full-song → ACE-Step(প্রার্থী #১, রিপো Apache-2.0/ওয়েট-যাচাই বাকি) + YuE(প্রার্থী #২, CC-BY-NC 4.0) বিভাজন; legend-এ গুণমান-মাত্রা; cap-speech নোটে বেঞ্চমার্ক-ল্যাবের উল্লেখ
- types.ts TOOL_CATALOG: generate_singing/separate_stems/lip_sync-এর ভুল "লাইসেন্সের কারণে অবরুদ্ধ" বিবরণ সংশোধন — প্রকৃত কারণ GPU/SDK-API/ইন্টিগ্রেশন
- system-info.ts: HardwareReport import+re-export; singing স্ট্যাটিক-নোট সংশোধন (লাইসেন্স অ-বাণিজ্যিকে অনুমোদিত)

Stage Summary:
- চুক্তি (একমাত্র সত্যের উৎস) প্রস্তুত: src/lib/types.ts
- সমান্তরাল টাস্ক: S8-2a (অডিট-ডকুমেন্ট: AUDIT_REPORT.md/FEATURE_MATRIX.json/KNOWN_BUGS.md), S8-2b (হার্ডওয়্যার-গেট + /api/hardware + TTS-ক্যাশ + রেজিস্ট্রিতে qualityStatus/ACE-Step/YuE/MMS-bn-TTS সংযোজন + prisma), S8-2c (বাংলা TTS বেঞ্চমার্ক সাবসিস্টেম: নর্মালাইজার+উচ্চারণ-অভিধান+৬০ বাক্য+রানার+API), S8-2d (ফ্রন্টএন্ড: quality চিপ+হার্ডওয়্যার প্যানেল+বেঞ্চমার্ক ল্যাব)
- ইন্টিগ্রেশন ও যাচাই main agent করবে (S8-3/4/5)

---
Task ID: S8-2a
Agent: subagent (audit docs)
Task: Phase-1 অডিট-ডেলিভারেবল — docs/AUDIT_REPORT.md + docs/FEATURE_MATRIX.json + docs/KNOWN_BUGS.md + scripts/gen-feature-matrix.ts (পুনর্জেনারেশন-স্ক্রিপ্ট, চালিত)

Work Log:
- worklog.md (Sprint-era + S8-0 kickoff) ও src/lib/types.ts (চুক্তি: QualityStatus, HardwareReport, HardwareVerdict, বেঞ্চমার্ক-টাইপ) পড়ে প্রেক্ষাপট গ্রহণ
- সোর্স-অডিট (সব ফাইল পড়ে, dev-server/build চালানো হয়নি): registry.ts + tools/{image,audio,video,production}.ts (৪১ টুলের প্রতিটি হ্যান্ডলার), availability-matrix.ts (২৩ সারি), model-registry-data.ts, sdk-helpers.ts (withRetry/TemporarilyUnavailableError), llm.ts, orchestrator.ts, runner.ts, ৫টি পাইপলাইন, সব ১৮টি API রুট-ফাইল, prisma/schema.prisma, system-info.ts, limits.ts, storage.ts, package.json, .env (শুধু কী-নাম — DATABASE_URL; মান কখনো ছাপা হয়নি)
- scripts/gen-feature-matrix.ts লেখা (আপেক্ষিক ইমপোর্ট ../src/lib/... — bun-এ path-alias সমাধান হয় না বলে; IMPLEMENTATION_MAP হার্ডকোড কিন্তু registry/tools ফাইল পড়ে যাচাইকৃত, মন্তব্যসহ) — `bun scripts/gen-feature-matrix.ts` চালিয়ে docs/FEATURE_MATRIX.json জেনারেট (৪১ টুল: ১৯ sdk_cloud/৯ ffmpeg/৯ local_engine/৩ honest_gated/১ planning_only; ২৪ মডেল; ২৩ ম্যাট্রিক্স-সারি + legend + usageMode)
- docs/AUDIT_REPORT.md (বাংলা, ১২ সেকশন): স্থাপত্য + Prisma-মডেল + স্টোরেজ; ২০-সারির API-ইনভেন্টরি; ৪১ টুলের বাস্তবায়ন-ম্যাপ; ৩ ভিডিও-পাইপলাইনের ধাপ/ইঞ্জিন/ফলব্যাক/generation_mode-লেবেলিং; এরর-হ্যান্ডলিং নিরীক্ষা (নীরব-ফলব্যাক লেবেল-সূচি); পরিবেশ/ডিপেন্ডেন্সি; ম্যাট্রিক্স-সারাংশ (blocked_by_license=০; machine_checked ১৫/not_verified ৮/human_verified ০; unavailable_hardware=৪); S8-0-পরিবর্তন; রিগ্রেশন-স্যুট অবস্থা; অবশিষ্টাংশ-তালিকা
- docs/KNOWN_BUGS.md (বাংলা, ১০ এন্ট্রি — প্রতিটিতে উপসর্গ/মূল কারণ/প্রশমন/সৎ অবস্থা): TTS ৪২৯-উইন্ডো (S8-2b TTS-ক্যাশ + S8-2c skipped_rate_limited-নোটসহ), bn-TTS অনির্ণীত (মানব-শ্রবণ-গেট), bn-ASR দুর্বল (উপদেশমূলক), লিপ-সিঙ্ক ৪-মাত্রিক, পূর্ণ-গান/স্টেম হার্ডওয়্যার-বাধা + নতুন আবিষ্কার: transcribe_audio-এ ২৮-সে. চাঙ্কিং-ফাঁক, chatComplete-এর পুরনো রিট্রাই-নীতি, রুট-অবশিষ্টাংশ (tmp-sprint2/tmp-task2d/mixrepro-* ১০.৭MB/tool-results/upload/অরফান artifacts), স্থায়ী টেস্ট-হার্নেস নেই, ছোট সৎ-সীমা
- scripts-film-smoke.ts পরিদর্শন (লোকাল-অনলি, ক্লাউড/DB-স্পর্শ নেই) → চালিয়ে সব-পাস নিশ্চিত (kenBurns ৫ মুভ, xfade/ডিমাক্সার concat, ambient/duck-মিক্স, mux AAC, বাংলা সাবটাইটেল-বার্ন, ইউটিলিটি); tests/-এর ৩টি শেল-স্ক্রিপ্ট = স্যান্ডবক্স-অবকাঠামো, অ্যাপ-রিগ্রেশন নয় — নথিভুক্ত
- সমান্তরাল-এজেন্ট পর্যবেক্ষণ: অডিট-চলাকালে S8-2b রেজিস্ট্রি-সীড বদলায় (qualityStatus + ace-step/yue/mms-tts-ben — ২২→২৪); পুনঃচালনায় স্ক্রিপ্ট স্বয়ংক্রিয়ভাবে নতুন অবস্থা তুলে নিয়েছে (রিপোর্টে লাইভ-প্রমাণ হিসেবে লেখা)
- src/** সম্পূর্ণ অস্পৃষ্ট; ডকুমেন্টে দুটি ভাঙা অক্ষর (U+FFFD) ধরা পড়ে সংশোধন; JSON python-দিয়ে ভ্যালিডেটেড

Stage Summary:
- তৈরি: docs/AUDIT_REPORT.md (৩২৭ লাইন), docs/FEATURE_MATRIX.json (৯০KB, জেনারেটেড), docs/KNOWN_BUGS.md (১০ বাগ-এন্ট্রি), scripts/gen-feature-matrix.ts — docs/ ডিরেক্টরি নতুন
- মূল অডিট-সত্য: ৪১ টুলের ৩৮টি প্রকৃত-বাস্তবায়িত + ৩টি সৎ-গেটেড (GPU/API-বাধা, লাইসেন্স নয়); blocked_by_license=০; ম্যাট্রিক্স ২৩ সারি (available ১২/সীমাসহ ৪/পরীক্ষামূলক ৩/ভবিষ্যৎ ২/অনুপলব্ধ ২); human_verified=০ — সৎ স্বীকারোক্তি
- নতুন আবিষ্কার (S8-3-এর জন্য অ্যাকশন-আইটেম): (১) transcribe_audio টুলে transcribeBuffer-চাঙ্কিং যোগ দরকার; (২) chatComplete-কে withRetry-মোড়ানো; (৩) রুট-পরিচ্ছন্নতা (mixrepro-* ১০.৭MB, tmp-*, tool-results/, upload/, অরফান mv*-artifacts, /api Hello-world স্ক্যাফোল্ড); (৪) স্মোক-স্ক্রিপ্টগুলোর স্থায়ী tests/-হার্নেসে স্থানান্তর
---
Task ID: S8-2d
Agent: subagent (frontend)
Task: পাঁচম মাত্রা (গুণমান) চিপ + হার্ডওয়্যার প্যানেল + বাংলা TTS বেঞ্চমার্ক-ল্যাব — রেজিস্ট্রি/স্টুডিও/গাইড ভিউতে ফ্রন্টএন্ড
Work Log:
- availability-badges.tsx (সম্পাদনা): QUALITY_META (quality_machine_checked/human_verified=emerald, not_verified=amber, not_applicable=stone) + QualityBadge উপাদান (OverallBadge-এর ভিজ্যুয়াল চুক্তিতে, রানটাইম-অজানা মানে সৎ 'অজানা' ফলব্যাক); রঙ-চুক্তি অপরিবর্তিত (blue/indigo নেই)
- src/hooks/use-hardware.ts (নতুন): GET /api/hardware → HardwareManagerResponse; useState/useEffect, মাউন্টে অটো-লোড + ম্যানুয়াল refresh; expose { data, loading, error, refresh }; !json.profile শেপ-মিসম্যাচে বাংলা এরর-স্টেট (ক্র্যাশ-নিরাপদ)
- src/components/studio/hardware-panel.tsx (নতুন, 'use client'): 'হার্ডওয়্যার-পরিমাপ ও মডেল-রায়' — সেকশন A: ৬টি প্রোফাইল-কার্ড (CPU কোর+মডেল, RAM মোট/খালি, ডিস্ক, GPU note, FFmpeg/ffprobe, প্ল্যাটফর্ম+Node); সেকশন B: ৯-অবস্থার HardwareVerdict ব্যাজ (ready/ready_with_limits=emerald, needs_gpu/needs_more_ram/needs_model_download=stone, license_review_required/provider_rate_limited/integration_incomplete/quality_not_verified=amber) + বাংলা কারণ + বিকল্প-পথ; max-h-96 পাতলা কাস্টম স্ক্রলবার (ম্যাট্রিক্স-তালিকার মতো); সৎ ফুটার 'GPU নেই মানে স্থায়ীভাবে নিষ্ক্রিয় নয়…' + probedAt; loading=স্কেলিটন, error=ইনলাইন+আবার
- src/hooks/use-benchmark.ts (নতুন): GET /api/benchmark/tts → { current, latest }; পোলিং প্রতি ২.৫সে কেবল current?.status==='running' হলে (নীরব-মোডে, loading-ফ্লিকার নেই); start(scope)=POST {scope} — ৪০৯/ব্যর্থতায় বাংলা বার্তা রিটার্ন (বডির error/message থাকলে তা-ই), cancel()=DELETE; expose { current, latest, starting, start, cancel, loading, error, refresh }
- src/components/studio/benchmark-panel.tsx (নতুন, 'use client'): 'বাংলা TTS মান-যাচাই ল্যাব (৬০ বাক্যের বেঞ্চমার্ক)' — স্থায়ী amber সৎ-ব্যানার ('কোনো কণ্ঠই বাংলা-প্রশিন্নত নয়…মানব-শ্রবণ বাধ্যতামূলক'); 'দ্রুত প্রোব (৮ বাক্য)'/'পূর্ণ বেঞ্চমার্ক (৬০ বাক্য)' (running-এ ডিজেইবল+স্পিনার) + 'বাতিল করুন' + রেট-লিমিট-নোট; চলমান রানে done/total+% বার (emerald Progress) + চলতি শ্রেণি; সারসংক্ষেপ-কার্ড (পাস emerald/সতর্কতা amber/ব্যর্থ red/স্কিপ stone/ত্রুটি red) + বড় 'মানব-শ্রবণ যাচাই বাকি' amber ব্যাজ + honestNote + শুরু/শেষ সময়; ফলাফল-সারণী ৮-কলাম (# / শ্রেণি-ব্যাজ / বাক্য truncate+title / কণ্ঠ / রায়-ব্যাজ / দৈর্ঘ্য সে. / নীরবতা % / <audio controls h-8>) — max-h-96 overflow-y-auto পাতলা স্ক্রলবার + min-w-[52rem] টেবিল; সারি-ক্লিকে প্রসারণ (মূল+নর্মালাইজড বাক্য, সব নোট, ASR-ট্রান্সক্রিপ্ট + 'ASR-উপদেশ মাত্র — বাংলা ASR দুর্বল'); ব্যর্থ/বাতিল রানে সৎ-নোট; খালি-স্টেট (কী করে + ৬ শ্রেণির চিপ + 'প্রথমবার দ্রুত প্রোব চালিয়ে দেখুন'); GET-ব্যর্থতায় প্যানেল-শেল বজায় + ইনলাইন এরর+আবার (ক্র্যাশ-নিরাপদ)
- registry-view.tsx (সম্পাদনা, additive): (a) প্রসারিত ম্যাট্রিক্স-সারির বিশ্লেষণে 'গুণমান:' লাইন + QualityBadge + legend-টেক্সট; (b) ModelEntryCard-এ qualityStatus থাকলে QualityBadge চিপ (hasDims-এ qualityStatus যুক্ত); (c) ম্যাট্রিক্স-হেডারের নিচে ৫-মাত্রার রায়ের ঘোষণা-লাইন; প্যানেল-বিন্যাস: ম্যাট্রিক্স → BenchmarkPanel → HardwarePanel → SystemPanel
- studio-view.tsx (সম্পাদনা, additive): StudioMode-এ extraNote? ফিল্ড; শুধু TTS ('টেক্সট-টু-স্পিচ') মোড-কার্ডে amber লাইন 'বাংলা মান-যাচাই: বেঞ্চমার্ক-ল্যাবে (রেজিস্ট্রি ভিউ)' (মোড-নোটের একই স্টাইলে, কার্ড-কাঠামো অপরিবর্তিত)
- guide-view.tsx (সম্পাদনা, minimal): DoD-নোটের নিচে এক লাইন — 'পাঁচ-মাত্রার স্ট্যাটাস (লাইসেন্স/প্রোভাইডার/ইন্টিগ্রেশন/রানটাইম/গুণমান) + বাংলা TTS বেঞ্চমার্ক-ল্যাব (রেজিস্ট্রি ভিউ)।'
- যাচাই: bunx tsc --noEmit → src/ এ ০ এরর (৮টি এরর কেবল অন্য এজেন্টদের ফোল্ডারে: examples/, scripts/gen-feature-matrix.ts, skills/, tmp-task2d/ — স্পর্শ করা হয়নি); bun run lint + ফাইল-টার্গেটেড eslint → পরিষ্কার; agent-browser (headless) দিয়ে রেজিস্ট্রি/স্টুডিও/গাইড ভিউ লাইভ-যাচাই — সব নতুন স্ট্রিং রেন্ডার, প্যানেল-ক্রম সঠিক, console/page error নেই
- চুক্তি-সমীক্ষা: /api/hardware কাজের মাঝে ল্যান্ড করেছে (S8-2b) — HardwareManagerResponse-শেপ হুবহু মিলে যায় (profile+assessments+probedAt, ২৪ রায়); /api/availability-র ২৩ সারিতে quality + legend-এ quality_* কী — ম্যাট্রিক্স-লাইন লাইভ কাজ করছে; /api/benchmark/tts এই মুহূর্তে ৪০৪ (S8-2c সমান্তরাল) — প্যানেল সৎ-ব্যানারসহ ইনলাইন এরর+আবার দেখায়, ক্র্যাশ করে না (ঠিক যেমন চাওয়া হয়েছিল)
Stage Summary:
- নতুন: src/hooks/use-hardware.ts, src/hooks/use-benchmark.ts, src/components/studio/hardware-panel.tsx, src/components/studio/benchmark-panel.tsx
- সম্পাদনা: availability-badges.tsx (QUALITY_META+QualityBadge), registry-view.tsx (গুণমান-মাত্রা + কার্ড-চিপ + ৫-মাত্রা-ঘোষণা + প্যানেল-বসানো: ম্যাট্রিক্স→বেঞ্চমার্ক-ল্যাব→হার্ডওয়্যার), studio-view.tsx (TTS-কার্ডে amber মান-যাচাই-লাইন), guide-view.tsx (এক লাইন)
- tsc: src/ ০ এরর; lint: পরিষ্কার; agent-browser লাইভ-যাচাই পাস; সব রং emerald/amber/stone/red টোন, dark-mode ভ্যারিয়েন্টসহ, মোবাইল-ফার্স্ট (টেবিল min-w + অভিক্ষীর্ণ-স্ক্রল, প্যানেল স্ট্যাক)

---
Task ID: S8-2b
Agent: subagent (backend infra)
Task: হার্ডওয়্যার-গেট + /api/hardware (§১০) + TTS ডিস্ক-ক্যাশ/in-flight ডিডুপ (§১১) + রেজিস্ট্রিতে qualityStatus/ACE-Step/YuE-বিভাজন/MMS-bn-TTS + prisma
Work Log:
- নতুন src/lib/agent/hardware-gate.ts: ModelHardwareRequirement + MODEL_HARDWARE_REQUIREMENTS (২৪ এন্ট্রি — ১০ cloud_sdk, ৫ local_engine, ৯ local_model; রেজিস্ট্রি-কী-এর সাথে ১:১ মিল যাচাইকৃত) + computeHardwareVerdicts(profile) — §১০-প্রাধিকার: cloud_sdk→ready (কারণ: বাস্তব-স্বাস্থ্য /api/system-এ) · local_engine→RAM-সীমা· local_model→needs_gpu / needs_more_ram / needs_model_download; mms-tts-ben বিশেষ-কারণ (Python+torch রানটাইম-অনুপস্থিতি, CPU-সম্ভাব্যতা ব্যবহারকারীর মেশিনে); প্রতিটি অবরুদ্ধ মডেলে ম্যাট্রিক্স-সামঞ্জস্যপূর্ণ সৎ বাংলা fallback; রায়ে কখনোই "লাইসেন্স-অবরুদ্ধ" নয় (ধূমে ০-লিচ যাচাইকৃত)
- নতুন src/app/api/hardware/route.ts (GET): measureHardware() + computeHardwareVerdicts() → HardwareManagerResponse; প্রোব-ফল globalThis-এ ৬০ সে. TTL ক্যাশ + সমান্তরাল-কলে একটিই প্রোব (in-flight promise-যোগ); কোনো স্বাস্থ্য-মডেল API-কল নেই (হালকা রুট); probedAt = ক্যাশে-প্রোবের ISO-সময়
- নতুন src/lib/agent/tts-cache.ts (§১১): কী = sha1(`${voice}|${speed.toFixed(2)}|${text}`); ডিস্ক-অবস্থান storage/tts-cache/<২>/<২>/<hash>.<ext> + <hash>.meta.json সাইডকার {voice,speed,mimeType,ext,createdAt,chars}; HMR-নিরাপদ globalThis stats {hits,misses,inFlight} → ttsCacheStats(); cachedSynthesizeSpeech — synthesizeSpeech-এর সমান চুক্তি, ক্রম: in-flight-ম্যাপে যোগ → ডিস্ক-ক্যাশ → API+best-effort ক্যাশ-লেখা (লেখা-ব্যর্থতায় কল কখনো ব্যর্থ নয়); ইমপোর্ট-চক্র-নেই (sdk-helpers অপরিবর্তিত, tts-cache একমুখী ইমপোর্ট করে)
- কলার-সুইচ: production/pipelines/audio.ts (২ কল-সাইট), short_film.ts (২), motion_video.ts (১) এখন cachedSynthesizeSpeech ব্যবহার করে; স্বাস্থ্য-পরীক্ষা (system-info.ts) ও ভাষা-নিয়ন্ত্রক (language_controller.ts — অন্য এজেন্টের ফাইল, স্পর্শ করা হয়নি) খাঁটি synthesizeSpeech-এ থাকল — স্বাস্থ্য-প্রোব প্রকৃত API ছোঁবে, এটিই সৎ; language_controller-এর ক্যাশে-যাওয়া মূল-এজেন্ট ইন্টিগ্রেশনের জন্য রাখা
- model-registry-data.ts: SeedModelEntry-তে qualityStatus?: QualityStatus + ২৪ প্রতিটি এন্ট্রিতে মান — ক্লাউড TTS/ASR = quality_not_verified (ইংরেজি যন্ত্র-যাচাইকৃত/বাংলা অ-যাচাইকৃত — কোড-টীকায় ব্যাখ্যা), বাকি ৮ ক্লাউড = quality_machine_checked, প্রাসিডিউরাল ২ ইঞ্জিন = quality_not_verified (ফাংশনাল ধূম ≠ গুণমান), ffmpeg/sharp/noto = quality_not_applicable, স্তর-৩ সবাই = quality_not_verified; 'singing-tts' প্রতিস্থাপিত → 'ace-step' (প্রার্থী #১, licenseStatus needs_review — রিপো Apache-2.0 দেখা গেছে কিন্তু checkpoint/dependency-শর্ত যাচাই বাকি, ব্যবহারকারীর নির্দেশনা; sortOrder 75) + 'yue' (প্রার্থী #২, allowed_noncommercial, sortOrder 76) — উভয়ে errorReason-এ লাইসেন্স/হার্ডওয়্যার/API-মাত্রা পৃথক; নতুন 'mms-tts-ben' (লোকাল বাংলা-TTS shortlist, §৪; needs_model_download-কারণ, sortOrder 36)
- prisma/schema.prisma: ModelEntry-এ qualityStatus String? → bun run db:push সফল (Prisma Client রিজেনারেটসহ); registry/route.ts: upsert-ডেটা + ModelEntryView-ম্যাপিং-য়ে qualityStatus; seed-এ বাদ-পড়া key (পুরোনো singing-tts) deleteMany(notIn) — নইলে GET অবচিত পুরোনো এন্ট্রি ফিরিত
- ধূম-যাচাই (সাময়িক স্ক্রিপ্ট, পরে মুছে ফেলা + storage/tts-cache পরীক্ষা-এন্ট্রিসহ পরিষ্কার): (১) hardware-gate ১৬/১৬ প্রত্যাশিত রায় (২৪ রায়, ০ লাইসেন্স-লিচ; কল্পিত ১৬GB+GPU মেশিনে musicgen/demucs/mms → needs_model_download সঠিক); (২) ক্যাশ-পড়া-পথ: ডিস্ক-হিট বাফার-অভিন্ন, hits+১/misses-একই, speed-ভেদে ভিন্ন কী; (৩) preload-fake-SDK-তে ক্যাশ-লেখা+ডিডুপ: ৩ সমান্তরাল কল → ১টিই API-কল, পুনঃকল ডিস্ক-থেকে, stats নকশানুযায়ী নির্ভুল; (৪) ensureSeeded-সিমুলেশন সরাসরি DB-তে: ২৪ সারি, singing-tts-প্রান্তিকরণ ✓, qualityStatus-মান সব সঠিক; প্রকৃত API-পথের TTS-ধূম সরাসরি করতে গেলে লাইভ ৪২৯ (স্যান্ডবক্স-ব্যাপী) — withRetry সঠিকভাবে TEMPORARILY_UNAVAILABLE-এ শেষ, এটিই §১১-এর প্রেরণা
- যাচাই: bunx tsc --noEmit → src/-এ ০ এরর (পুরোনো অ-সংশ্লিষ্ট: examples/, skills/, tmp-task2d/, scripts/gen-feature-matrix.ts — শেষোক্তটি S8-2a-এর ফাইল, ImportMeta.dir-এ টাইপ-এরর, স্পর্শ করিনি); bun run lint (পুরো প্রজেক্ট) → ০; dev-server/build চালানো হয়নি; কোনো স্থায়ী টেস্ট-ফাইল রাখা হয়নি

Stage Summary:
- /api/hardware আকৃতি: { profile: HardwareReport, assessments: [{modelKey,name,verdict,reason,requires:{minRamGb?,minVramGb?,gpuRequired,localWeights?},fallback?}] ×২৪, probedAt } — ৬০ সে. TTL ক্যাশ, ৪ রায়-ধরন বাস্তবে আসে (ready ১৫ · needs_gpu ৭ · needs_more_ram ১ · needs_model_download ১ — এই স্যান্ডবক্সে)
- tts-cache: cachedSynthesizeSpeech(text,voice,speed)→SpeechResult; ttsCacheStats()→{hits,misses,inFlight} — hits=ডিস্ক-হিট, misses=প্রকৃত API-কল, inFlight=চলমান অনন্য কাজ (ডিডুপ-যোগদানকারী কাউন্ট করে না); পাইপলাইন-কলার ৩টি সুইচড, স্বাস্থ্য/ভাষা-নিয়ন্ত্রক খাঁটি পথে
- রেজিস্ট্রি: ২৪ এন্ট্রি (ace-step+yue বিভাজন, mms-tts-ben নতুন), প্রতিটিতে পঞ্চম মাত্রা qualityStatus (machine_checked ৮ · not_verified ১৩ · not_applicable ৩), DB-স্কিমা+রুট-ম্যাপিং সম্পূর্ণ
- মূল-এজেন্টের জন্য রাখা: language_controller.ts-এর cachedSynthesizeSpeech-সুইচ, /api/hardware-এর ফ্রন্টএন্ড-প্যানেল সংযোগ (S8-2c-এর hardware-panel), ttsCacheStats-এর কোনো API/UI-উন্মোচন (এখন শুধু এক্সপোর্ট), availability-matrix-এর cap-full-song modelKey 'ace-step' এখন রেজিস্ট্রি-সারির সাথে মেলে

---
Task ID: S8-2c
Agent: subagent (bn-tts benchmark) — টাইম-আউটে বিঘ্নিত; মূল-এজেন্ট যাচাঈ ও সম্পূর্ণ করেছে
Task: বাংলা TTS মান-যাচাই বেঞ্চমার্ক সাবসিস্টেম (পরিকল্পনা §৪ — তৃতীয় ধাপ)

Work Log:
- সাব-এজেন্ট টাইম-আউটের আগে সব ফাইল লিখে ফেলেছিল; মূল-এজেন্ট প্রতিটি ফাইল পড়ে ও ধূমপরীক্ষা চালিয়ে সম্পূর্ণতা নিশ্চিত করেছে
- নতুন src/lib/agent/audio/bn-text-normalizer.ts: NFC-ইউনিকোড, ইমোজি/মার্কডাউন পরিষ্কার, বাংলা+ASCII সংখ্যা→শব্দ (০–৯৯,৯৯,৯৯,৯৯৯; কুড়ি-ব্যবস্থা, হাজার/লাখ/কোটি, দশমিক), তারিখ (ডিডি/এমএম/বছর, ISO YYYY-MM-DD), সময় (H:MM → 'নয় টা ত্রিশ'), %→শতাংশ, punctuation→বিরতি-সমন্বয়, ইংরেজি শব্দ→ধ্বন্যাত্মক বানান, নিরাপত্তা-শর্ত (৪০%+ বাংলা-অক্ষর হারালে বাতিল)
- নতুন src/lib/agent/audio/bn-pronunciation-dictionary.ts: ৫০ ইংরেজি শব্দের ধ্বন্যাত্মক-রূপ (PHONETIC-ONLY নীতি) + ১৭টি সংরক্ষণাত্মক বাংলা উচ্চারণ-ওভাররাইড (প্রতিটিতে কারণ-কমেন্ট)
- নতুন src/lib/agent/audio/bn-benchmark-suite.ts: ঠিক ৬০ বাক্য (৬ শ্রেণি × ১০: কথোপকথন/নাটকীয়/আবেগ/বাংলা-ইংরেজি মিশ্র/সংখ্যা-তারিখ/গল্পপাঠ), QUICK_BENCHMARK_IDS ৮টি, numbers_dates-এ expected-ফিল্ডসহ
- নতুন src/lib/agent/audio/tts-benchmark-runner.ts: ব্যাকগ্রাউন্ড-জব (globalThis-HMR-নিরাপদ), jam/douji পর্যায়ক্রম, প্রতি বাক্যে নর্মালাইজ→TTS→অডিও-যন্ত্র-পরিমাপ (দৈর্ঘ্য/নীরবতা-অনুপাত/ক্লিপিং/নীরব-পরিসর)→রায় (pass/warn/fail/skipped_rate_limited/error), প্রথম ৩ সফল বাক্যে উপদেশমূলক ASR (bnCharRatio), ৪-পরপর-৪২৯-এ ৪৫ সে. বিরতি (সর্বোচ্চ ২, বাতিল-সচেতন), প্রতি বাক্যে report.json স্ন্যাপশট, রান-ডিরেক্টরি অডিওসহ সংরক্ষিত (মানব-শ্রবণের জন্য), latest.json পয়েন্টার; 'pass'-এ সর্বদা 'মানব-শ্রবণে যাচাই বাকি' নোট
- নতুন src/app/api/benchmark/tts/route.ts (GET/POST/DELETE — ২০২/৪০৯/৪০০) ও .../audio/route.ts (run/file কঠোর regex-যাচায়িত — path-traversal অসম্ভব)
- language_controller.ts-এ সংযোগ: bn-হলে synthesizeVerifiedSpeech-এ নর্মালাইজেশন (ভাষা-শনাক্তকরণ মূল স্ক্রিপ্টেই); যাচাই-নোটে সমন্বয়-সারাংশ
- মূল-এজেন্ট ইন্টিগ্রেশন (S8-3): language_controller + benchmark-runner এখন cachedSynthesizeSpeech (§১১ ডিস্ক-ক্যাশ/ডিডুপ-পথ; পুনঃরানে API-খরচ নয়, ক্যাশ-হিটে একই অডিও=একই রায় — সৎ)
- ধূমপরীক্ষা (bun -e): ২৫→পঁচিশ ✓ ১৫/০১/২০২৬→পনেরো জানুয়ারি দুই হাজার ছাব্বিশ ✓ ৯:৩০→নয় টা ত্রিশ ✓ ১২৫০→বারোশো পঞ্চাশ ✓ ১৫%→পনেরো শতাংশ ✓ লাখ/কোটি ✓ phone→ফোন ✓ MP4 ল্যাটিন-থাকা ✓ ISO-তারিখ ✓ ...→। ✓; স্যুট: ৬০ বাক্য/১০×৬ শ্রেণি/অনন্য আইডি/৮ কুইক-আইডি ✓; /api/benchmark/tts GET {current:null,latest:null} ✓
- বাস্তব-সীমা: TTS API বর্তমানে স্যান্ডবক্স-ব্যাপী ৪২৯-উইন্ডোতে — রানার প্রতি বাক্যে সৎ skipped_rate_limited রেকর্ড করে (কোনো মিথ্যা সফলতা নয়); উইন্ডো রিসেট হলে UI থেকে দ্রুত-প্রোব চালানো যাবে

Stage Summary:
- বেঞ্চমার্ক সাবসিস্টেম সম্পূর্ণ: নর্মালাইজার+অভিধান+৬০ বাক্য+রানার+২টি API; রায়-নীতি কেবল যন্ত্র-পরীক্ষার ভিত্তিতে — 'মানব-শ্রবণ বাকি' সর্বদা ঘোষিত
- bn-TTS-এর প্রকৃত উন্নতি এখনই চালু: সব bn কণ্ঠ-তৈরির পথে নর্মালাইজেশন (সংখ্যা/তারিখ/সময়/ইংরেজি-শব্দ ঠিকমতো বলা)
- বাকি: ৪২৯-উইন্ডো রিসেটের পর পূর্ণ ৬০-বাক্যের বাস্তব রান + মানব-শ্রবণ পর্যালোচনা (এটি ব্যবহারকারীর হাতে)

---
Task ID: S8-3/4/5 (ইন্টিগ্রেশন + যাচাই + রিপোর্ট)
Agent: main
Task: S8-২ সমান্তরাল ফলাফলের ইন্টিগ্রেশন, অডিট-সংশোধন, tsc/lint/ব্রাউজার-E2E ও চূড়ান্ত রিপোর্ট

Work Log:
- নতুন src/lib/agent/retry.ts: §১০-র পুনঃচেষ্টা-নীতি sdk-helpers থেকে বিশুদ্ধ মূলে সরানো (llm.ts-ও ব্যবহার করতে পারে, import-cycle নেই); sdk-helpers পুনঃ-রপ্তানি করে — সব পুরনো ইমপোর্টার অক্ষত
- llm.ts chatComplete: পুরনো নির্দিষ্ট-বিরতি রিট্রাই → withRetry (Retry-After-সচেতন, full-jitter, ৪ চেষ্টা; ৪২৯-নিঃশেষে TemporarilyUnavailableError) — অডিট-ফাইন্ডিং #৩ সমাধান
- sdk-helpers chatJson: নেটওয়ার্ক-কল withRetry-তে (JSON-পার্স-পুনঃচেষ্টা-লুপ অপরিবর্তিত)
- registry.ts transcribe_audio (অডিট-ফাইন্ডিং #২): সরাসরি asr.create-র বদলে transcribeBuffer (২৮-সে. চাঙ্কিং + ৪২৯-ব্যাকঅফ) + timeout ১৮০→৩০০ সে.
- language_controller + tts-benchmark-runner → cachedSynthesizeSpeech-এ সুইচ (S8-2b-এর রেখে-যাওয়া কাজ; পুনঃরানে API-খরচ নয়)
- scripts/gen-feature-matrix.ts: import.meta.dir → fileURLToPath (tsc-সামঞ্জস্য); পুনর্জেনারেট সফল (৪১ টুল + ২৪ মডেল + ২৩ সারি)
- /api/system GET-তে ttsCache পরিসংখ্যান {hits, misses, inFlight}
- tsc: src/-এ ০ এরর; lint: PASS
- ব্রাউজার-E2E (agent-browser): হোম ✓ কনসোল-এরর নেই ✓; রেজিস্ট্রি-ভিউ: ৫-মাত্রার ঘোষণা + ২৩ সারি + ACE-Step/YuE ভাগ + প্রসারিত সারিতে গুণমান-মাত্রা ✓; বেঞ্চমার্ক-ল্যাব: দ্রুত-প্রোব চালু → running ০/৮ → UI অগ্রগতি ১/৮ + skipped_rate_limited সৎ-প্রদর্শন + রেট-লিমিট-নোট → বাতিল → cancelled (২ স্কিপ, সারসংক্ষেপ humanListeningPending:true, latest.json বাতিল-রানে লেখা হয়নি — সঠিক) → প্রোব-বোতাম পুনরায় সক্রিয় ✓; হার্ডওয়্যার-প্যানেল: ২৪ রায় বাংলা-লেবেলে ✓; স্টুডিও TTS-কার্ডে নতুন amber লাইন ✓; গাইডে পাঁচ-মাত্রা+ল্যাব-উল্লেখ ✓; মোবাইল ৩৯০×৮৪৪ আড়াআড়ি-স্ক্রল নেই, ফুটার নিচে ✓; পৃষ্ঠা-এরর নেই ✓
- বাস্তব-সীমার সৎ দলিল: TTS API পুরো E2E-চলাকালীন স্যান্ডবক্স-ব্যাপী ৪২৯-উইন্ডোতে ছিল — তাই 'pass' রায় ব্রাউজারে প্রদর্শিত হয়নি; রানারের সৎ-স্কিপ পথ বাস্তবে প্রমাণিত হয়েছে। উইন্ডো রিসেটের পর UI থেকে দ্রুত-প্রোব চালালে pass/warn-ফলাফল আসবে (ডিস্ক-ক্যাশের কারণে পুনঃরান বিনা-খরচে)

Stage Summary:
- ব্যবহারকারীর ১৫-ধাপী পরিকল্পনার Phase-1 (অডিট+স্থিতিশীলতা) সম্পূর্ণ: docs/AUDIT_REPORT.md + docs/FEATURE_MATRIX.json + docs/KNOWN_BUGS.md + রিজেনারেশন-স্ক্রিপ্ট
- Phase-2-এর অবকাঠামো সম্পূর্ণ: ৫-মাত্রিক স্ট্যাটাস (quality_status সহ), হার্ডওয়্যার-সচেতন মডেল-ম্যানেজার (/api/hardware, ৯-অবস্থার রায়), বাংলা TTS বেঞ্চমার্ক-ল্যাব (৬০ বাক্য + নর্মালাইজার + উচ্চারণ-অভিধান + ASR-উপদেশ + মানব-শ্রবণ-গেট), §১১-নির্ভরযোগ্যতা (retry.ts-এর একক নীতি, TTS ডিস্ক-ক্যাশ/ডিডুপ, /api/system-এ ক্যাশ-পরিসংখ্যান)
- রেজিস্ট্রি: ২৪ মডেল (ACE-Step #১ needs_review-ওয়েট-শর্তসহ, YuE #২ allowed_noncommercial, MMS-bn-TTS লোকাল-shortlist নতুন) — কেউই লাইসেন্স-অবরুদ্ধ নয়
- ব্যবহারকারীর জন্য বাকি: ৪২৯-উইন্ডো রিসেটে পূর্ণ বেঞ্চমার্ক-রান + মানব-শ্রবণ পর্যালোচনা; GPU-সমৃদ্ধ পরিবেশে ACE-Step/YuE/MMS-এর ইন্টিগ্রেশন (Phase ৩–৬)

---
Task ID: 4-b
Agent: subagent (frontend — run_note + banner + quick-create)
Task: রেট-লিমিট-যুগে সৎ UI — চ্যাটে run_note অ্যাম্বার-লাইন, রেট-লিমিট ব্যানার, স্টুডিওতে LLM-মুক্ত "⚡ দ্রুত তৈরি" ফর্ম ও প্রোডাকশন-কার্ডে ইঞ্জিনের সৎ লেবেল

Work Log:
- types.ts: ChatMessage-এ ঐচ্ছিক `statusNote?: string` (ক্লায়েন্ট-ক্ষণস্থায়ী; সার্ভার কখনো পাঠায় না)। RunEvent-এর run_note টাইপ মূল এজেন্ট আগেই যোগ করেছিল — ডুপ্লিকেট করিনি।
- use-agent-run.ts: SSE_EVENT_NAMES-এ 'run_note' + dispatch-এ নতুন case — inView হলে pending বার্তায় statusNote বসে; চূড়ান্ত 'message' ইভেন্টে pending পুরো বদলে যায় বলে নোট আপনিই মুছে যায়।
- message-bubble.tsx: pending bubble-এর ভেতরে statusNote থাকলে সরু অ্যাম্বার লাইন (pulsing dot + border-l-2 amber, text-xs, role="status") — অপেক্ষার স্কেলেটনের উপরে।
- use-system.ts: RateLimitChannelStatus/RateLimitsStatus টাইপ + SystemInfo.rateLimits? ঐচ্ছিক ফিল্ড (পিছিয়ে-সামঞ্জস্যপূর্ণ)।
- নতুন src/components/chat/rate-limit-banner.tsx: GET /api/system প্রতি ৩০ সে. পোল (AbortController + in-flight guard — স্বাস্থ্য-চেক রেট-লিমিটে ৫৯ সে. আটকে থাকলে অনুরোধ জমে না); anyBlocked হলে কম্পোজারের উপরে সরু অ্যাম্বার ব্যানার (CloudOff + বাংলা বার্তা + ব্লকড চ্যানেল-চিপ বাংলা সংখ্যায়, যেমন "চ্যাট ৪০ সে."), না থাকলে কিছুই রেন্ডার হয় না। page.tsx-এর চ্যাট-সেকশনে Composer-এর আগে বসানো।
- নতুন src/components/studio/quick-create.tsx ("⚡ দ্রুত তৈরি"): কাজের ধরন (music_video/short_film/motion_video) · শিরোনাম · আইডিয়া/গল্প (লেবেল ধরনভেদে) · দৈর্ঘ্য (ডিফল্ট ৪০/৪০/১২, সীমা-হিন্ট ১৫–১৮০/৩০–১২০/৫–২০) · অনুপাত (mv ৯:১৬, বাকি ১৬:৯) · মান · ইঞ্জিন (cinematic_motion-হিন্টসহ) → POST /api/productions { spec } (conversationId বাদ = নতুন কথোপকথন); short_film-এ story নয়তো idea ফিল্ড। সাফল্যে টোস্ট + ফর্ম-ক্লিয়ার + তালিকা রিফ্রেশ + সার্ভারের সৎ adjustments/notes ফর্মের নিচে role="status" নোটে; ব্যর্থতায় সার্ভারের বাংলা এরর-বার্তা ডেস্ট্রাকটিভ টোস্টে।
- productions-view.tsx: হেডারের পরে QuickCreateCard; তালিকায় awaiting_confirmation আইটেম এখন চ্যাট-কার্ড (production-card.tsx) হিসেবে রেন্ডার হয় — বিদ্যমান "নিশ্চিত করুন" বাটন ও স্পেক-এডিটর স্টুডিও-ভিউতেই পাওয়া যায়; খালি-অবস্থার বার্তাও আপডেট।
- production-card.tsx: হেডারের মেটা-লাইনে সব অবস্থাতে ইঞ্জিনের সৎ লেবেল — cinematic_motion হলে অ্যাম্বারে "ইঞ্জিন: ক্যামেরা-মোশন (AI ডিফিউশন নয়)", ai_diffusion হলে "ইঞ্জিন: AI ডিফিউশন (CogVideoX-3)"। রিডিজাইন করিনি।
- যাচাই: `bunx tsc --noEmit` → src/-এ শূন্য এরর (একটি ক্ষণস্থায়ী এরর মূল এজেন্টের সমান্তরাল ব্যাকএন্ড-এডিটের মাঝামাঝি স্ন্যাপশট ছিল, পরে আপনিই ঠিক); `bun run lint` → পরিষ্কার; dev.log-এ আমার কম্পোনেন্টে নতুন কম্পাইল/রানটাইম এরর নেই।
- agent-browser E2E: দ্রুত-তৈরি ফর্ম পূরণ→POST→নতুন কার্ড "নিশ্চয়তার অপেক্ষায়"+নিশ্চিত-বাটন তালিকার শীর্ষে (পরে টেস্ট-প্রোডাকশনটি বাতিল করে পরিষ্কার করা); ব্যানার blocked/unblocked দুই অবস্থায় নেটওয়ার্ক-মক দিয়ে যাচাই; লাইভ রানে run_note অ্যাম্বার-লাইন দেখা গেছে ("ক্লাউড LLM রেট-লিমিটেড (৪২৯…) পুনঃচেষ্টা 1/৮ — 4 সেকেন্ড অপেক্ষা…")। কনসোলে কোনো এরর নেই।

Stage Summary:
- পরিবর্তিত ফাইল: src/lib/types.ts (শুধু statusNote), src/hooks/use-agent-run.ts, src/hooks/use-system.ts, src/components/chat/message-bubble.tsx, src/app/page.tsx, src/components/studio/productions-view.tsx, src/components/studio/production-card.tsx; নতুন: src/components/chat/rate-limit-banner.tsx, src/components/studio/quick-create.tsx।
- UX সিদ্ধান্ত: (১) ৪২৯-কে সবসময় "সাময়িক, লাইসেন্স-সমস্যা নয়" হিসেবে দেখানো — ব্যানার+run_note উভয়েই; (২) রেট-লিমিটেড সময়ে চ্যাট-নির্ভরতা ভাঙতে LLM-মুক্ত সরাসরি-তৈরির পথ, আর নিশ্চিতকরণ একই ভিউতে (মনিটর থেকে চ্যাটে যেতে হয় না); (৩) সার্ভারের সৎ সমন্বয়/নোট টোস্টের বদলে ফর্মের নিচে স্থায়ী ছোট নোটে — মিস না হয়; (৪) পুনর্ব্যবহৃত প্যাটার্ন: shadcn Card/Input/Select/Textarea/Label, toast@use-toast (sonner-Toaster মাউন্টেড নেই), toBnDigits@bn-format, AmberNote-ধাঁচ, useProductions স্টোর, ProductionCard-এর বিদ্যমান কনফার্ম-ফ্লো।
- নোট: মূল এজেন্টের সমান্তরাল এডিটের সময় /api/system সাময়িকভাবে ৫০০ দিচ্ছিল (llmCacheStats) — ব্যানার নীরবে সেটি সামলায় (non-ok → রেন্ডার নেই, পরের টিকে রিট্রাই)।

---
Task ID: 4-a
Agent: subagent (pipeline local-first fallbacks)
Task: তিন ভিডিও-পাইপলাইনে লোকাল-ফার্স্ট ফলব্যাক — স্যান্ডবক্স-ব্যাপী ৪২৯-উইন্ডোতেও সৎ-লেবেলসহ প্রকৃত MP4

Work Log:
- নতুন src/lib/agent/local-frames.ts: ক্লাউড-ছাড়া নির্ধারক প্রসিডিউরাল ফ্রেম-জেনারেটর — lavfi `gradients` (মুড-প্যালেট ৩ রং, হ্যাশ-নির্ধারিত দিক; ফিল্টার-সমর্থন আগেই যাচাই: FFmpeg 7.1.5-এ gradients/noise/vignette/geq সব আছে) → `noise=alls=6:allf=t:all_seed=N` (ফিল্ম-গ্রেইন, হ্যাশ-সিডেড) → vignette → scale (অভ্যন্তরীণ রেন্ডার দীর্ঘ-অক্ষ ≥১০২৪px, তারপর লক্ষ্য-মাপ) → rgb24 PNG। ডিটারমিনিজম: ইন-ফাইল FNV-1a + splitmix32-ধাঁচ (নতুন npm-নির্ভরতা শূন্য); (seed,width,height,mood) এক হলে SHA-256-অভিন্ন বাইট। LOCAL_FRAME_LABEL = 'লোকাল প্রসিডিউরাল ফ্রেম (ক্লাউড ইমেজ-জেনারেশন রেট-লিমিটেড — নিউরাল নয়)' — প্রতিটি honestLabel-এ বাধ্যতামূলক। মুড-প্যালেট ৬টি (sad/romantic/jjoyful/suspense/action/peaceful) + বাংলা/ইংরেজি মুক্ত-টেক্সট মিলানো।
- ধূমপরীক্ষা ১ (সাময়িক স্ক্রিপ্ট, পরে মুছে ফেলা): 720x1280 + 1280x720 PNG ভিন্ন সিডে ~৩০০-৩২০ms-এ, ffprobe-যাচাইকৃত মাপ/কোডেক, ডিটারমিনিজম SHA-256 অভিন্ন ✓, honestLabel-এ বাধ্যতামূলক বাংলা ✓; ধূমপরীক্ষা ২ (fallback-path E2E, মুছে ফেলা): generateLocalFrame → kenBurnsClip → বৈধ h264 MP4 720x1280@30fps ৩.৫ সে. — ক্লাউড-ছাড়া শট-উৎপাদন-পথ প্রমাণিত।
- music_video.ts: (ক) visual_plan-এর chatJson try/catch-মোড়ানো — ৪২৯-এ সৎ নোট 'LLM ভিজ্যুয়াল-পরিকল্পনা রেট-লিমিটেড — সাধারণ শট-তালিকা ব্যবহৃত (AI-পরিকল্পনা নয়)' + data=null → বিদ্যমান fallbackDescription-পথ চালু; অন্য ত্রুটিতেও একই অবনমন। (খ) characters-ধাপে পোর্ট্রেট-ব্যর্থতায় (৪২৯-সহ) লোকাল প্রসিডিউরাল পোর্ট্রেট (seed `mv-char-${name}`, 864x1152) — portraitDataUrl বসে, artifact metaJson-এ kind='local-procedural'+honestLabel+note, partialNote সৎ; Character-টেবিল-upsert কেবল প্রকৃত AI-পোর্ট্রেটে (প্রসিডিউরাল ফ্রেমকে স্থায়ী রেফারেন্স বানানো অসৎ)। (গ) generate_shots cinematic_motion: দুই tryGen-ব্যর্থতার পর শট-বাদের আগে লোকাল ফ্রেম (seed `mv-shot-${i}`, dims-মাপ) — artifact-নোট সৎ, engineLabel `শট N: লোকাল প্রসিডিউরাল ফ্রেম + ক্যামেরা-মোশন (ইমেজ-জেন রেট-লিমিটেড/ব্যর্থ)`; ai_diffusion-শাখায় res.frameLocal হলে artifact-নোট লোকাল-প্রসিডিউরাল ঘোষণা করে।
- motion_video.ts: (ক) generateAiShot-এ শেষ-উপায় — AI-ভিডিও ও ফলব্যাক-ফ্রেম (edit/generate) দুটোই ব্যর্থ হলে লোকাল ফ্রেম (seed `aishot-fb-${index}`, fallbackGenSize-র 'WxH' পার্স → ভাঙলে req-এর width/height; fallbackMood নতুন ঐচ্ছিক ক্ষেত্র) → fb-frame-এ লেখা → kenBurnsClip; রিটার্নে frameLocal:true + engineLabel `শট N: লোকাল প্রসিডিউরাল ফ্রেম + ক্যামেরা-মোশন (ক্লাউড রেট-লিমিটেড/ব্যর্থ)`; throw কেবল লোকাল-ফ্রেমও ব্যর্থ হলে (তিন-স্তরের কারণসহ)। AiShotResult-এ frameLocal? যোগ। (খ) plan-ধাপে shotPlanFromLLM try/catch — ৪২৯-এ নির্ধারক সরল শট-তালিকা (count-শট, সমান দৈর্ঘ্য, 'Cinematic scene N', MOVES-চক্র) + সৎ নোট। (গ) cinematic_motion-শাখায় একই লোকাল-শেষ-উপায় (seed `motion-shot-${i}`) + সৎ engineLabel।
- short_film.ts: (ক) script_breakdown-এর প্রথম chatJson try/catch — data না-পেলে নির্ধারক ৩-দৃশ্য ফলব্যাক: splitStoryIntoThreeChunks (বাক্য-সীমা । . ! ? \n, প্রায়-সমান অক্ষর-ভারসাম্য; বাক্য<৩ হলে অক্ষর-ভিত্তিক), location='মূল দৃশ্য', timeOfDay='দিন', action=খণ্ড (≤৬০০), estimatedSec=durationSec/3, dialogues=[] (কোনো বানানো সংলাপ/কণ্ঠ নয় — নীরব সিনেম্যাটিক দৃশ্য), characters=[] (spec-এ চরিত্র-ক্ষেত্র নেই), logline='', title=spec.title; সৎ নোট 'চিত্রনাট্য-রেট-লিমিটেড — গল্পের তিন-অংশের সরল বিভাজন (AI-চিত্রনাট্য নয়)'। (খ) দ্বিতীয় chatJson (শট-বিভাজন) try/catch — ৪২৯-এ sd=null → বিদ্যমান প্রতি-দৃশ্যে-এক-শট ফলব্যাক + সৎ নোট। (গ) character_bible: AI-পোর্ট্রেট ব্যর্থ হলে লোকাল পোর্ট্রেট (seed `sf-char-${name}`) — bible-এ entry, artifact kind='local-procedural'+honestLabel, সৎ partialNote; db.character.upsert কেবল প্রকৃত AI-পোর্ট্রেটে। (ঘ) acting_plan try/catch — ৪২৯-এ data=null → বিদ্যমান প্রতি-শট ডিফল্ট-অবনমন চলে + সৎ নোট। (ঙ) generate_shots cinematic_motion: লোকাল-শেষ-উপায় (seed `sf-shot-${i}`) ai_diffusion-শাখায় fallbackMood+সৎ artifact-নোট। (চ) continuity: ইতিমধ্যেই fail-soft (per-shot try/catch) ছিল — যাচাইকৃত; শুধু ৪২৯-ক্ষেত্রে একবারের সৎ partialNote যোগ। speech/sound_design/final_mix অস্পৃষ্ট (নির্দেশ মতো)।
- সাধারণ নিয়ম সব ফাইলে: ইম্পোর্ট isRateLimitErrorText '../../sdk-helpers' থেকে (প্রতি ফাইলে সামঞ্জস্যপূর্ণ); ক্লাউড কাজ করলে আগের আচরণ অপরিবর্তিত — ফলব্যাক কেবল ব্যর্থতায়; প্রতিটি ফলব্যাক-পথ partialNotes/engineLabel/metaJson-এ সৎ বাংলা ঘোষণা করে।
- যাচাই: bunx tsc --noEmit → src/-এ ০ এরর (৫টি পুরোনো অ-সংশ্লিষ্ট: examples/, skills/, tmp-task2d/, scripts/gen-feature-matrix.ts); bun run lint (পুরো প্রকল্প) → ০; dev-server বেঁচে আছে (সব রুট 200)।
- পার্শ্ব-পর্যবেক্ষণ (আমার পরিবর্তনের বাইরে, মূল-এজেন্টের জন্য দলিল): GET /api/system 500 — `llmCacheStats is not a function` (Turbopack [app-route]-প্রসঙ্গে llm.ts-এর পুরোনো ইন-মেমরি মডিউল; llm.ts ০২:৩৭ + route.ts ০২:৪৪-এর সম্পাদনা দীর্ঘ-চলমান dev-server-এ জমা হয়েছিল)। ডিস্কে কমপাইল-করা চাঙ্ক সঠিক (llmCacheStats আছে), POST /api/system কাজ করে (সে বাইন্ডিং ছোঁয় না), /api/system-এর ইম্পোর্ট-গ্রাফে আমার ৪টি ফাইলের কোনোটিই নেই — আমার পরিবর্তন কারণ নয়; touch/কনটেন্ট-নাজ (বাইট-অভিন্ন পুনরুদ্ধারসহ) সারায়নি — dev-server রিস্টার্টেই সারবে।

Stage Summary:
- নতুন: src/lib/agent/local-frames.ts (generateLocalFrame, LOCAL_FRAME_LABEL, LocalFrameOptions/Result) — শুধু FFmpeg, নির্ধারক, ~৩০০ms/ফ্রেম
- সম্পাদিত: pipelines/music_video.ts, pipelines/motion_video.ts (generateAiShot-সহ), pipelines/short_film.ts — প্রতিটি ক্লাউড-নির্ভর ধাপে সৎ-লেবেলসহ লোকাল/নির্ধারক অবনমন; এখন ৪২৯-উইন্ডোতেও তিন পাইপলাইনই প্রকৃত MP4 দেয় (music_video: প্রসিডিউরাল গান+লোকাল ফ্রেম; short_film: ৩-দৃশ্য নির্ধারক বিভাজন+নীরব দৃশ্য+লোকাল সাউন্ড-ডিজাইন; motion_video: নির্ধারক শট-তালিকা+লোকাল ফ্রেম)
- সততার সিদ্ধান্ত: প্রসিডিউরাল পোর্ট্রেট কখনো Character-টেবিলে স্থায়ী রেফারেন্স হয় না; নির্ধারক চিত্রনাট্য-ফলব্যাক কখনো সংলাপ/কণ্ঠ বানায় না (dialogues=[]); প্রতিটি লোকাল-ফ্রেম artifact-এ kind='local-procedural'+LOCAL_FRAME_LABEL, প্রতিটি শটে সৎ engineLabel
- ইচ্ছাকৃতভাবে ফলব্যাক-ছাড়া রাখা: speech-ধাপ (ইতিমধ্যে fail-soft — TTS-ব্যর্থতায় 'শুধু সাবটাইটেলে থাকবে' নোট; সংশ্লেষিত কণ্ঠ বানানো অসৎ হবে), sound_design/final_mix (সম্পূর্ণ লোকাল), song_input-এর আপলোড-গান-শূন্যতা (ব্যবহারকারীর ইনপুট-প্রয়োজনীয়তা), kenBurnsClip/concat নিজেরা লোকাল
- GET /api/system-এর পুরোনো 500 (Turbopack stale-binding, মূল-এজেন্টের llm.ts/route.ts ক্ষেত্র) — দলিলসহ রিপোর্ট করা; dev-server রিস্টার্টে সমাধান

---
Task ID: S9 (মূল-এজেন্ট — ৪২৯ গভীর-সমাধান + ব্যাকটেস্ট)
Agent: main
Task: ব্যবহারকারীর রিপোর্ট "TEMPORARILY_UNAVAILABLE: LLM (চ্যাট) — 429-এ কাজ ব্যর্থ, সব কিছু deeply fix + backtest করে মিউজিক ভিডিও/ফিল্ম বানান" — সম্পূর্ণ সমাধান ও বাস্তব যাচাই

Work Log:
- প্রোব-নির্ণয়: chat+image+TTS সব ক্লাউড API স্যান্ডবক্স-ব্যাপী ৪২৯-উইন্ডোতে (উভয় দিন); মূল কারণ-শৃঙ্খল: chatComplete-এর পুরনো বাজেট ৪×৩ সে.≈১৬ সে. → রান ধাপ ০-এ মৃত্যু → propose_job-ই হয় না → মিউজিক ভিডিও/ফিল্ম তৈরির একমাত্র পথ (চ্যাট) বন্ধ; /api/productions-এ POST-ও ছিল না
- নতুন src/lib/agent/rate-limit-coordinator.ts: ৬ চ্যানেল (chat/image/tts/asr/video/search) অভিযোজিত কুলডাউন (স্কেলার ১৫→৩০→৬০→১২০ সে., Retry-After অগ্রাধিকার) + চ্যানেল-সিরিয়ালাইজেশন (সমান্তরাল ৪২৯-ঝড় প্রতিরোধ) + waitForChannel (বাজেট-শেষে -1 = "এখনো ব্লকড" সৎ-সংকেত) + cloudSkipAdvised দ্রুত-গেট + coordinatorStatus (/api/system-এ উন্মুক্ত)
- retry.ts: চ্যানেল-সচেতন withRetry (কুলডাউন-অপেক্ষা → সিরিয়ালাইজড কল → ৪২৯-এ coordinator-নোট → full-jitter ব্যাকঅফ); বাজেট-অতিক্রমে নিষ্ফল চেষ্টা নয়, তাৎক্ষণিক TemporarilyUnavailableError
- llm.ts: chatComplete ৬ চেষ্টা/base ৪ সে./max ৬০ সে./কুলডাউন-বাজেট ৯০ সে. (মোট ≈৪–৫ মিনিট < ১০-মিনিট stale-sweep) + ডিস্ক-ক্যাশ storage/llm-chat/ (sha1(context) → উত্তর, TTL ১২ ঘণ্টা — পুনঃকল/ব্যাকটেস্ট বিনা-খরচে) + onRateLimitWait হুক
- sdk-helpers.ts: ছবি-জেন/সম্পাদনা ২ চেষ্টা+গেট, TTS গেট, chatJson ৪ চেষ্টা+গেট; নতুন fastFailIfGated — দীর্ঘ কুলডাউনে ক্লাউড-চেষ্টাই বাদ (প্রতি শটে মিনিট নয়)
- ai_video.ts: submitVideoTask-এ গেট + মাঝ-লুপে ৪২৯-কুলডাউন ব্রেক + coordinator-নোটিফিকেশন
- orchestrator.ts: chatCompleteWithNotes (প্রতিটি অপেক্ষায় SSE run_note — UI-তে অ্যাম্বার স্ট্যাটাস-লাইন); ৪২৯-নিঃশেষে loop-ব্রেক → নিয়ম-ভিত্তিক ইন্টেন্ট-ফলব্যাক (মিউজিক ভিডিও/শর্ট ফিল্ম/মোশন ভিডিও প্যাটার্ন; চ্যানেল-ব্লকড হলে cinematic_motion ইঞ্জিন) → createProduction → সৎ চূড়ান্ত বার্তা+প্রস্তাব-কার্ড; ইন্টেন্ট-না-মিললে উন্নত সৎ-ব্যর্থতা (সাময়িক/লাইসেন্স-নয়/স্টুডিও-বিকল্প নির্দেশনা)
- নতুন src/lib/agent/production/create.ts: শেয়ার্ড তৈরি-পথ (validateSpec → অটো-ওয়্যার → Production row); propose_job রিফ্যাক্টর + নতুন POST /api/productions (স্টুডিও UI থেকে LLM-ছাড়া সরাসরি তৈরি; স্থানীয় রেট-লিমিট + দৈনিক কোটা)
- types.ts: RunEvent-এ run_note; ChatMessage-এ statusNote (ক্লায়েন্ট-ক্ষণস্থায়ী); /api/runs/[id]/events-এ run_note ফরওয়ার্ডিং
- system-info.ts: স্বাস্থ্য-চেক দ্রুত-রায়ে রূপান্তর — কুলডাউন-চলাকালীন কোনো API-কল নয় (আগে ৬০ সে. ঝুলত), ৪২৯-প্রোব coordinator-কে জানায়; /api/system ০.৬ সে.-এ (আগে ৬০ সে.)
- সততা-সংশোধন: music_video-র sound-ডিফল্ট কেবল আসল গান-আর্টিফ্যাক্ট থাকলে 'uploaded_song' (নইলে অসংরক্ষিত; কার্ডে "প্রসিডিউরাল ইনস্ট্রুমেন্টাল (আপলোড করা গান নেই)"); summarizeSpec-এ বাংলা শব্দ-লেবেল
- dev-server ডেমন-সমস্যা সমাধান: স্যান্ডবক্স Bash-call শেষে সন্তান-প্রসেস reap করে — double-fork (setsid সাবশেল) দিয়ে PID 1-এ reparent করা হয়; Turbopack stale-binding (llmCacheStats 500) রিস্টার্টে সমাধান
- ব্যাকটেস্ট (৪২৯-উইন্ডো চলাকালীনই, তিনটি প্রকৃত প্রোডাকশন): (১) সরাসরি-API মিউজিক ভিডিও → প্রকৃত MP4 ৩৯.৯ সে./৭২০×১২৮০@৩০/h264+aac, ৭ শট, avSyncOk=true, প্রতিটি শটে সৎ লেবেল "লোকাল প্রসিডিউরাল ফ্রেম + ক্যামেরা-মোশন (ইমেজ-জেন রেট-লিমিটেড)"; (২) শর্ট ফিল্ম → প্রকৃত MP4 ৩৯.২ সে./১২৮০×৭২০@২৪/aac, ৩-দৃশ্য নির্ধারক বিভাজন (কোনো বানানো সংলাপ নয়), TTS-ব্যর্থতা সৎ-নোট; (৩) চ্যাট ইন্টেন্ট-ফলব্যাক (ব্যবহারকারীর মূল বাগ-দৃশ্য) → ৪২৯-অপেক্ষা-নোটসহ রিট্রাই → নিয়ম-ভিত্তিক প্রস্তাব → নিশ্চিত → প্রকৃত MP4 ৩৯.৯ সে./১০৮০×১৯২০@৩০; ffprobe-দ্বারা সব শারীরিকভাবে যাচাইকৃত
- ব্রাউজার-E2E (agent-browser): হোম ✓; ইন্টেন্ট-ফলব্যাক কথোপকথনে সৎ বার্তা+প্রোডাকশন-কার্ড ("আংশিক সফল", সৎ ইঞ্জিন-লেবেল) ✓; প্রোডাকশন-মনিটরে "⚡ দ্রুত তৈরি" ফর্ম → পূরণ → জমা → "নিশ্চয়তার অপেক্ষায়" কার্ড ✓ (পরে বাতিল); কনসোল/পেজ-এরর শূন্য ✓; মোবাইল ৩৯০px ওভারফ্লো শূন্য + ফুটার-দৃশ্যমান ✓; tsc/lint পরিষ্কার ✓

Stage Summary:
- ৪২৯ এখন আর কাজ মারে না: অপেক্ষা (সৎ run_note) → নিয়ম-ভিত্তিক প্রস্তাব → লোকাল-ফার্স্ট প্রোডাকশন; ক্লাউড ফিরলে স্বয়ংক্রিয়ভাবে AI-পথ (সিরিয়ালাইজড, ক্যাশড, Retry-After-সচেতন)
- নতুন অবকাঠামো: rate-limit-coordinator + fastFailIfGated গেট + POST /api/productions + production/create.ts শেয়ার্ড-পথ + LLM ডিস্ক-ক্যাশ + run_note SSE
- ৪২৯-উইন্ডোতে মিউজিক ভিডিও/ফিল্ম নির্মাণ প্রমাণিত (৩টি প্রকৃত MP4, ffprobe-যাচাইকৃত, প্রতিটি ফলব্যাক সৎ-লেবেলসহ); UI-তে দ্রুত-তৈরি + রেট-লিমিট-ব্যানার + অপেক্ষা-স্ট্যাটাস
- বাকি (ব্যবহারকারীর হাতে): ৪২৯-উইন্ডো রিসেটের পর পূর্ণ-AI পথের পুনঃপরীক্ষা; বাংলা TTS বেঞ্চমার্ক-রান ও মানব-শ্রবণ (আগের ধাপের পরিকল্পনা অনুযায়ী)

---
Task ID: S10 (মূল-এজেন্ট — পুনঃব্যাকটেস্টে ধরা পড়া রিট্রাই-হ্যাং গভীর-সমাধান)
Agent: main
Task: freebuff-অনুরোধ প্রসঙ্গে পুনঃব্যাকটেস্ট চালাতে গিয়ে আবিষ্কৃত বাগ: ৪২৯-উইন্ডোতে শর্ট-ফিল্মের speech-ধাপ ~১০.৫ মিনিট TTS-কুলডাউন-অপেক্ষায় ঝুলে থাকত — মূল কারণ বিশ্লেষণ ও সম্পূর্ণ সমাধান

Work Log:
- freebuff (npm v0.2.26, Codebuff-র পুনঃব্র্যান্ড) যাচাই: এটি টার্মিনাল কোডিং-এজেন্ট CLI, মডেল-API প্রদানকারী নয় — ওয়েবঅ্যাপের ব্যাকএন্ড-ইনফারেন্সে সংযুক্ত করা সম্ভব নয়; নিরাপত্তা/ToS-ঝুঁকির কারণে ইনস্টল করা হয়নি (ব্যবহারকারীকে সৎ ব্যাখ্যা দেওয়া হয়েছে)
- পুনঃব্যাকটেস্ট (৪২৯-উইন্ডোতেই): (১) মিউজিক ভিডিও "বর্ষার রাতের মেলোডি" → প্রকৃত MP4 ২৯.৯৭ সে./720×1280@30/h264+aac, ৬/৬ ধাপ, ২:৫১-এ সম্পন্ন; (২) শর্ট ফিল্ম "শেষ চিঠি" → speech-ধাপ ~১০.৫ মিনিট ঝুলে মোট ১১:২৫-এ partial-সম্পন্ন — বাগ-আবিষ্কার
- মূল-কারণ: withRetry-এ cooldownBudgetMs প্রতি attempt-এ নতুন হিসেব হতো (প্রতি চেষ্টায় তাজা ৫-মিনিট বাজেট) — ৫ TTS-চেষ্টা × (৫ মি. কুলডাউন-অপেক্ষা + ৯০ সে. ব্যাকঅফ) ≈ ~৩০ মিনিট পর্যন্ত ঝুলে থাকার সম্ভাবনা; দ্বিতীয় কারণ: runner-এর runStep-এ কোনো সময়সীমা ছিল না (অজানা হ্যাং-এ stale-sweep-এর ২০/৬০ মি. পর্যন্ত অপেক্ষা)
- Fix 1 (retry.ts): বাজেট এখন সম্পূর্ণ withRetry-কলের মোট অপেক্ষা-সীমা (কুলডাউন+ব্যাকঅফ মিলে) — প্রতি-চেষ্টায় বাকি-বাজেট হিসেব, শূন্য হলে/পরের অপেক্ষা ছাড়ালে তাৎক্ষণিক TemporarilyUnavailableError; docstring হালনাগাদ
- Fix 2 (sdk-helpers.ts synthesizeSpeech): ৫→৩ চেষ্টা, স্পষ্ট cooldownBudgetMs: 90_000 — speech-ধাপের TTS-প্রতীক্ষা সর্বোচ্চ ~৯০ সে.+জিটার (~২.৫ মি. সর্বোচ্চ)
- Fix 3 (runner.ts): নতুন StepTimeoutError + RunStepOptions{timeoutMs} — runStep-এ Promise.race-টাইমআউট, অতিক্রান্ত হলে fail-soft (ধাপ failed + সৎ partialNote + undefined রিটার্ন + প্রোডাকশন চালু); জম্বি-প্রহরী (টাইমআউট-পরের setDetail নিষ্ক্রিয়) + জম্বি-নীরবতা (আনহ্যান্ডেলড-রিজেকশন প্রতিরোধ); CancelledError অপরিবর্তিত-পাসথ্রু; এছাড়া পর্যায়ক্রমিক stale-sweep টাইমার (৬০ সে., globalThis-গার্ডেড, unref) — ট্রাফিক ছাড়াও ঝুলন্ত প্রোডাকশন সৎ-সমাধান পাবে
- Fix 4 (তিন পাইপলাইনে timeout-ওয়্যারিং, শুধু রিটার্ন-অব্যবহৃত কল-সাইটে): short_film — script_breakdown ৬ মি./character_bible ৫ মি./acting_plan ৬ মি./speech ৪ মি./generate_shots (ai_diffusion ৫৫ মি. বনাম cinematic_motion ১৫ মি.)/sound_design+continuity+final_mix ১০ মি.; music_video — song_input+visual_plan ৬ মি./characters ৫ মি./generate_shots ইঞ্জিন-ভিত্তিক/timeline+final_qc ১০ মি.; motion_video — plan ৬ মি./generate_shots ইঞ্জিন-ভিত্তিক/assemble+validate ১০ মি. (audio.ts/image.ts-এর ধাপ রিটার্ন-ভ্যালু-ব্যবহৃত — ইচ্ছাকৃতভাবে স্পর্শ নয়, তাদের ক্লাউড-কল Fix 1-এ সীমাবদ্ধ)
- যাচাই: bunx tsc --noEmit → src/-এ ০ এরর (কেবল পুরোনো অ-সংশ্লিষ্ট examples/skills/tmp ফাইল); bun run lint → ০; dev-server সুস্থ
- পুনঃব্যাকটেস্ট (সংশোধনের পরে, ৪২৯-উইন্ডোতেই): শর্ট ফিল্ম → ৮/৮ ধাপ done, speech-ধাপ ১০.৫ মি. → **৯০.০ সেকেন্ড** (ঠিক বাজেট-সীমায় সৎ TemporarilyUnavailableError), মোট ১১:২৫ → **৪:২৮ (268 সে.)**; প্রকৃত MP4 35.২১ সে./1280×720@24/h264+aac (5.9MB) ffprobe-যাচাইকৃত; ধাপভিত্তিক সময়: script 45.3s/bible 0s/acting 0s/speech 90.0s/shots 54.1s/sound 2.8s/continuity 0s/mix 72.4s; ৯টি সৎ partialNotes (চিত্রনাট্য-ফলব্যাক, A5-ব্যর্থতা, লোকাল-প্রসিডিউরাল-ফ্রেম...)
- ব্রাউজার-E2E (agent-browser): হোম ✓; প্রোডাকশন-ভিউতে উভয় রান "আংশিক সফল" সৎ-লেবেলসহ ✓; বিস্তারিত-এ ৮-ধাপ তালিকায় প্রতি-ধাপের সময় (speech ৯০.০ সে. দৃশ্যমান) ✓; আর্টিফ্যাক্ট (৩টি স্টোরিবোর্ড PNG + ভিডিও) ✓; কনসোল/পেজ-এরর শূন্য ✓; মোবাইল 390px ওভারফ্লো শূন্য + ফুটার-দৃশ্যমান ✓; ডেস্কটপ 1280px ✓
- ব্যাকটেস্ট-স্ক্রিপ্ট scripts/backtest-productions.ts হিসেবে স্থায়ীকরণ (ভবিষ্যৎ ৪২৯-উইন্ডো যাচাইয়ের জন্য); অস্থায়ী ফাইল পরিষ্কার

Stage Summary:
- রিট্রাই-হ্যাং সম্পূর্ণ সমাধান: ৪২৯-উইন্ডোতে শর্ট-ফিল্ম ১১:২৫ → ৪:২৮; TTS-প্রতীক্ষা ~১০.৫ মি. → ৯০ সে. (নতুন মোট-বাজেট শব্দার্থ)
- নতুন সুরক্ষা-স্তর: প্রতি-ধাপ সময়সীমা (fail-soft, প্রোডাকশন বাঁচে) + পর্যায়ক্রমিক stale-sweep (ট্রাফিক-নিরপেক্ষ)
- ৪২৯-উইন্ডোতে মিউজিক ভিডিও (২:৫১) ও শর্ট ফিল্ম (৪:২৮) উভয়ই প্রকৃত MP4-সহ সৎ-লেবেলে সম্পন্ন — ffprobe-যাচাইকৃত
- freebuff ইনস্টল করা হয়নি: টার্মিনাল কোডিং-CLI (API-প্রদানকারী নয়), নিরাপত্তা/ToS-ঝুঁকি; অ্যাপের AI-পথ z-ai-web-dev-sdk + রেট-লিমিট-কোঅর্ডিনেটর + লোকাল-ফার্স্ট ফলব্যাকেই সমাধান
