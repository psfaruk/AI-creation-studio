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
