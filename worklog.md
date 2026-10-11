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
