# অডিট রিপোর্ট — Agentic AI Creative Studio (Phase-1)

**Task ID:** S8-2a · **তারিখ:** ২০২৬-১০-১১ · **অডিটর:** সাবএজেন্ট (audit docs)
**পরিধি:** সম্পূর্ণ রেপোজিটরি `/home/z/my-project` — সোর্স পড়ে (dev-server/build চালানো হয়নি) সত্যতা-যাচাইকৃত তালিকা। সঙ্গী দলিল: `docs/FEATURE_MATRIX.json` (মেশিন-পাঠযোগ্য, `scripts/gen-feature-matrix.ts` থেকে জেনারেটেড), `docs/KNOWN_BUGS.md`।

> **সততার মূলনীতি:** এই রিপোর্টে কোনো ফিচার "কাজ করে" লেখা হয়নি যদি না কোডে তার বাস্তব বাস্তবায়ন পড়ে নিশ্চিত হই। প্রতিটি অ-কার্যকর ক্ষমতার প্রকৃত কারণ (লাইসেন্স নয়) উল্লেখ করা হয়েছে।

---

## ১. সারসংক্ষেপ

| বিষয় | অবস্থা |
|---|---|
| মোট টুল (TOOL_CATALOG) | **৪১টি** — সবগুলোর বাস্তবায়ন ম্যাপ করা (নিচে §৪) |
| মডেল-রেজিস্ট্রি সীড (MODEL_SEED) | **২৪টি এন্ট্রি** (৪+১-মাত্রিক স্ট্যাটাসসহ — S8-2b-এর সমান্তরাল সংযোজন qualityStatus + ACE-Step/YuE/MMS-bn-TTS বিভাজন পুনর্জেনারেশন-স্ক্রিপ্ট স্বয়ংক্রিয়ভাবে তুলে নিয়েছে) |
| অ্যাভেইলেবিলিটি ম্যাট্রিক্স | **২৩টি সারি** — চালু ১২ · সীমাসহ-চালু ৪ · পরীক্ষামূলক ৩ · ভবিষ্যৎ ২ · এই-পরিবেশে-অনুপলব্ধ ২ |
| লাইসেন্সে-অবরুদ্ধ মডেল | **শূন্য** — কোনো এন্ট্রিই `blocked_by_license` নয়; প্রকৃত বাধা GPU / SDK-API-প্রকাশনা / ইন্টিগ্রেশন / গুণমান-যাচাই |
| সৎ-গেটেড টুল (ডাকলে ব্যাখ্যাসহ ব্যর্থ) | ৩টি: `generate_singing`, `separate_stems`, `lip_sync` |
| API রুট | **১৮টি রুট-ফাইল / ২০টি মেথড-এন্ডপয়েন্ট** (১টি অব্যবহৃত স্ক্যাফোল্ডসহ) — পূর্ণ ইনভেন্টরি §৩ |
| রেট-লিমিট/কোটা | চ্যাট ১৫/মি · কনফার্ম ১২/ঘণ্টা + ৪০/দিন (ঢাকা-দিন) · সিস্টেম-চেক ৪/১০মি · প্রোডাকশন কনকারেন্সি ২ |
| লোকাল স্মোক-স্যুট | `scripts-film-smoke.ts` **সব পাস** (এই সেশনে চালানো, লোকাল-অনলি) — §১০ |
| পরিচ্ছন্নতা-প্রার্থী | রুট-লেভেল অবশিষ্টাংশ ~১৪.৭MB+ — §১১ দ্রষ্টব্য |

---

## ২. স্থাপত্য-বিবরণ (Architecture)

**স্ট্যাক:** Next.js ^16.1.1 (App Router, Turbopack dev) · React ^19 · TypeScript ^5 · Tailwind 4 + shadcn/ui · Prisma ^6.11.1 (SQLite) · z-ai-web-dev-sdk ^0.0.18 (শুধু server-side) · FFmpeg 7.1.5 (সিস্টেম বাইনারি) · sharp ^0.34.3 · zustand ^5 · @tanstack/react-query ^5।

### ২.১ ডিরেক্টরি-কাঠামো

```
src/
├── app/                        # একমাত্র page-route '/' + API
│   ├── page.tsx, layout.tsx   # ৬-ভিউ শেল (chat/studio/gallery/productions/registry/guide)
│   └── api/**                 # ১৮টি এন্ডপয়েন্ট (সব force-dynamic + nodejs runtime)
├── components/
│   ├── chat/**                # মেসেজ-বাবল, কম্পোজার, সাইডবার, markdown, artifact-view…
│   ├── studio/**              # studio-view (১৭ মোড-কার্ড), registry-view (ম্যাট্রিক্স+সিস্টেম প্যানেল),
│   │                          # gallery/productions/guide, availability-badges (শেয়ার্ড রং-চুক্তি)
│   └── ui/**                  # shadcn/ui সেট
├── hooks/**                   # zustand স্টোর + use-agent-run (SSE+পোলিং ফলব্যাক) + use-availability/use-system
└── lib/
    ├── types.ts               # শেয়ার্ড চুক্তি — একমাত্র সত্যের উৎস (TOOL_CATALOG ৪১, SSE-ইভেন্ট,
    │                          # CreativeJobSpec, ৫-মাত্রিক স্ট্যাটাস, HardwareReport, বেঞ্চমার্ক-টাইপ)
    ├── db.ts, limits.ts       # Prisma singleton; স্লাইডিং-উইন্ডো রেট-লিমিট + দৈনিক কোটা
    ├── system-info.ts         # measureHardware (CPU/RAM/disk/GPU/ffmpeg-সংস্করণ) + টুল-স্বাস্থ্য মাইক্রো-চেক
    ├── utils.ts
    ├── media/ffmpeg.ts        # runFfmpeg/ffprobeJson/mediaInfo/audioQuality/makeTempDir/cleanupWorkingDir/buildSrt
    └── agent/
        ├── orchestrator.ts    # এজেন্ট লুপ (MAX_STEPS ১২, JSON টুল-প্রোটোকল, অ্যাটাচমেন্ট প্রি-স্টেপ,
        │                      # looksLikeToolCall কাটা-JSON সংশোধন, stale-sweep ১০ মি)
        ├── registry.ts        # CORE_TOOLS ৮টি + tools/* এগ্রিগেট + validateToolCall (zod → structured error)
        ├── registry-helpers.ts, storage.ts, serialize.ts, events.ts, llm.ts, prompts.ts, capabilities.ts
        ├── sdk-helpers.ts     # withRetry (§১০), TemporarilyUnavailableError, ছবি-জেন/এডিট, TTS (mp3→wav),
        │                      # transcribeBuffer (২৮ সে. চাঙ্কিং), visionAnalyze, chatJson, imageSearchSdkFirst
        ├── availability-matrix.ts  # ২৩-সারির ঐক্য-ক্ষমতা টেবিল + legend + usageMode
        ├── model-registry-data.ts  # MODEL_SEED ২২ এন্ট্রি (৪+১ মাত্রা, apiEndpoint, lastTestNote, errorReason)
        ├── film-helpers.ts    # kenBurnsClip/concatClips/mixAudioTracks/generateAmbientBed/burnSubtitles/shotPlanFromLLM…
        ├── audio/             # language_controller (ভাষা-নিশ্চিত TTS+ASR রাউন্ড-ট্রিপ), music_engine (প্রসিডিউরাল
        │                     # PCM + analyzeAudioEnergy), pcm (WAV-এনকোডার), sound_design (A1–A5)
        ├── video/             # ai_video (CogVideoX-3 সাবমিট/পোল/ডাউনলোড/validateVideoBuffer, requestKey idempotency),
        │                     # capability_router (৮-রুট টেবিল), lip_sync_module (৪+১-মাত্রিক বাধা-প্রতিবেদন)
        ├── production/        # runner (কনকারেন্সি ২ + সারি, stale-sweep ২০/৬০ মি, partial-লজিক, CancelledError),
        │   └── pipelines/     # bus, serialize + ৫টি পাইপলাইন: image/audio/motion_video/music_video/short_film
        └── tools/             # image.ts (১১), audio.ts (১০), video.ts (১০), production.ts (২)
```

### ২.২ Prisma মডেল (SQLite — `db/custom.db`)

| মডেল | ভূমিকা |
|---|---|
| Conversation / Message | চ্যাট-সংরক্ষণ; Message-এ runId (1:1), productionId, attachmentsJson |
| AgentRun / AgentStep / ToolCall | এজেন্ট-রান ইতিহাস, ধাপ, টুল-কল (ইনপুট/আউটপুট বাংলা সারাংশসহ) |
| Artifact | ফাইল-মেটাডেটা — kind image/audio/video/text, origin tool/user_upload/production, storagePath/sourceUrl, metaJson |
| Production / ProductionStep | Creative Job স্টেট-মেশিন (awaiting_confirmation→…→completed/partial/…), revision-চেইন (parentProductionId) |
| Character | Character Bible (§৭.২) — conversationId+name unique, portraitArtifactId, voice |
| ModelEntry | মডেল-রেজিস্ট্রি — ৪-মাত্রিক স্ট্যাটাস + apiEndpoint/apiModelId/lastTestedAt/errorReason/toolsJson |

### ২.৩ স্টোরেজ-লেআউট

- **আর্টিফ্যাক্ট:** `storage/artifacts/<base36-timestamp>-<uuid8>.<ext>` (`agent/storage.ts`; সার্ভিস `GET /api/artifacts/[id]/file`, external হলে 302)।
- **কাজের টেম্প:** `os.tmpdir()`-এ `mkdtemp` (টুল) বা প্রোডাকশন-workingDir — `finally`-এ `cleanupWorkingDir`।
- **DB:** `db/custom.db` (SQLite, ৩১২KB) — `DATABASE_URL` দিয়ে নির্ধারিত (মান এই রিপোর্টে উদ্ধৃত হয়নি)।

---

## ৩. সম্পূর্ণ API রুট-ইনভেন্টরি (প্রতিটি ফাইল পড়ে যাচাইকৃত)

সব রুট `export const dynamic='force-dynamic'; runtime='nodejs'` — Next-16 `await params` প্যাটার্ন।

| # | এন্ডপয়েন্ট | মেথড | উদ্দেশ্য · কী কল করে |
|---|---|---|---|
| ১ | `/api` | GET | স্ক্যাফোল্ড-অবশেষ: `{message:"Hello, world!"}` — অ্যাপ কোথাও ব্যবহার করে না (§১১) |
| ২ | `/api/tools` | GET | `TOOL_CATALOG` (৪১ ToolInfo) ফেরত — types.ts থেকে সরাসরি |
| ৩ | `/api/registry` | GET | `MODEL_SEED` ২৪ এন্ট্রি idempotent upsert (`db.modelEntry`) → ModelEntryView[] প্রতি কলে রিফ্রেশ |
| ৪ | `/api/availability` | GET | `availabilityMatrixResponse()` — ২৩-সারি ম্যাট্রিক্স + legend + usageMode |
| ৫ | `/api/system` | GET | `measureHardware()` (os/statfs/nvidia-smi/ffmpeg -version) + `runToolHealthChecks()` (LLM/TTS আসল মাইক্রো-কল, ৪২৯-এ সৎ 'down') |
| ৬ | `/api/system` | POST | জোর করে পুনঃস্বাস্থ্য-চেক — রেট-লিমিট `systemCheck` ৪/১০মি |
| ৭ | `/api/chat` | POST | চ্যাট-প্রবেশদ্বার — রেট-লিমিট ১৫/মি/IP (x-forwarded-for); যাচাই: ≤৮০০০ অক্ষর, ≤৪ অ্যাটাচমেন্ট (ছবি/অডিও ~৭MB, ভিডিও ~২৫MB base64); কথোপকথন রিজলভ/তৈরি, শিরোনাম ৪২ অক্ষর, user_upload artifact সেভ, AgentRun তৈরি → `startAgentRun` fire-and-forget |
| ৮ | `/api/conversations` | GET | `sweepStaleRuns()` (১০ মি পুরনো → interrupted) + ConversationSummary[] |
| ৯ | `/api/conversations/[id]` | GET | ConversationDetail — প্রতি বার্তা `buildMessageView` (activities/artifacts/runStats) |
| ১০ | `/api/conversations/[id]` | DELETE | ক্যাসকেড-ডিলিট + লোকাল artifact ফাইল best-effort unlink |
| ১১ | `/api/runs/[id]/events` | GET | **SSE (RunEvent)** — DB-রিপ্লে → লাইভ bus (queue-বাফার + dedupe) → ১.৫ সে. DB diff-poll + ১৫ সে. ping; run_finished-এ clean close |
| ১২ | `/api/artifacts/[id]` | GET | ArtifactMeta |
| ১৩ | `/api/artifacts/[id]/file` | GET | লোকাল ফাইল stream (immutable cache) / external 302 / `?download=1` → Content-Disposition (UTF-8 filename) |
| ১৪ | `/api/gallery` | GET | artifact তালিকা — `kind` ফিল্টার + `limit` ≤৩০০ + conversationTitle |
| ১৫ | `/api/productions` | GET | `sweepStaleProductions()` + ProductionSummary[] (`limit` ≤১০০, `conversationId` ফিল্টার) |
| ১৬ | `/api/productions/[id]` | GET | সম্পূর্ণ ProductionView (steps + artifacts) |
| ১৭ | `/api/productions/[id]/confirm` | POST | নিশ্চয়তা — রেট-লিমিট ১২/ঘণ্টা + দৈনিক কোটা ৪০ (ঢাকা-দিন); spec-ওভাররাইড মার্জ → `validateSpec` → queued → `startProduction` (কনকারেন্সি ২ + সারি) |
| ১৮ | `/api/productions/[id]/cancel` | POST | awaiting/queued → cancelled; running/validating → 'cancelling' ফ্ল্যাগ (runner ধাপের মাঝে `checkCancelled` দেখে থামে) |
| ১৯ | `/api/productions/[id]/revise` | POST | নতুন awaiting_confirmation + parentProductionId (revision-চেইন §১৬) |
| ২০ | `/api/productions/[id]/events` | GET | **SSE (ProductionEvent)** — DB-রিপ্লে → লাইভ bus (named+unnamed দুই ফরম্যাটে) → ২.৫ সে. poll + ১৫ সে. ping; সর্বোচ্চ ১ ঘণ্টা |

---

## ৪. টুল ক্যাটালগ → ব্যাকএন্ড ফাংশন ম্যাপিং (৪১/৪১)

`implementation` মান: **sdk_cloud** (z-ai SDK ক্লাউড API) · **local_engine** (sharp/PCM/Prisma) · **ffmpeg** (লোকাল FFmpeg 7.1) · **honest_gated** (ডাকলে সৎ structured error) · **planning_only** (জেনারেশন নয়)। প্রতিটি সারি সোর্স ফাইল পড়ে নিশ্চিত — মেশিন-পাঠযোগ্য কপি `docs/FEATURE_MATRIX.json`-এ।

### ৪.১ মূল এজেন্ট টুল — `src/lib/agent/registry.ts` (CORE_TOOLS)

| টুল | বাস্তবায়ন | ফাইল → ফাংশন |
|---|---|---|
| web_search | sdk_cloud | registry.ts → `webSearchSpec` → `zai.functions.invoke('web_search')` |
| read_web_page | sdk_cloud | registry.ts → `readWebPageSpec` → `zai.functions.invoke('page_reader')` + stripHtml (≤৬০০০ অক্ষর) |
| generate_image | sdk_cloud | registry.ts → `generateImageSpec` → `zai.images.generations.create` → PNG artifact |
| search_images | sdk_cloud | registry.ts → `searchImagesSpec` → `imageSearchSdkFirst` — SDK `zai.images.search` প্রাথমিক, CLI `z-ai image-search` ফলব্যাক; resultJson-এ `via:'sdk'\|'cli'` |
| analyze_image | sdk_cloud | registry.ts → `analyzeImageSpec` → `zai.chat.completions.createVision` (artifact→data-URL রূপান্তরসহ) |
| text_to_speech | sdk_cloud | registry.ts → `textToSpeechSpec` → `zai.audio.tts.create` (mp3→কোড-১২১৪ হলে wav; RIFF-স্নিফে mime সংশোধন) |
| transcribe_audio | sdk_cloud | registry.ts → `transcribeAudioSpec` → `zai.audio.asr.create` — **সরাসরি কল, ২৮-সে. চাঙ্কিং নেই** (KNOWN_BUGS #৩-খ) |
| search_conversations | local_engine | registry.ts → `searchConversationsSpec` → Prisma `contains`-সার্চ (বার্তা+শিরোনাম, snippet) |
| speech_synthesis | sdk_cloud | tools/audio.ts → `speechSynthesisSpec` → `language_controller.synthesizeVerifiedSpeech` — ভাষা-শনাক্তকরণ → TTS → দৈর্ঘ্য-যাচাই → ASR ব্যাক-চেক → রায় pass/warn/fail; **bn-রায় সবসময় 'সতর্কতা' + মানব-প্রিভিউ বাধ্যতামূলক** |
| analyze_audio | local_engine | tools/audio.ts → `analyzeAudioSpec` → `music_engine.analyzeAudioEnergy` (FFmpeg ডিকোড → ৫০ms RMS-হপ → বিট/এনার্জি-বিভাগ/BPM; সৎ নোট: সরলীকৃত) |

### ৪.২ Image Studio — `src/lib/agent/tools/image.ts` (১১টি)

| টুল | বাস্তবায়ন | নোট |
|---|---|---|
| edit_image, inpaint_image, remove_background, remove_object, restyle_image | sdk_cloud | সবগুলো `editImageBuffer` → `zai.images.generations.edit` (প্রম্পটে সংরক্ষণ-নির্দেশনা) |
| enhance_image | local_engine | sharp lanczos+median+sharpen — **সৎ লেবেল: নতুন AI-ডিটেইল নয়** |
| color_grade_image | local_engine | sharp modulate/gamma/linear |
| transform_image | local_engine | sharp crop/resize/rotate/flip/aspect |
| compose_text_image | local_engine | SVG + Noto Sans Bengali + sharp; বেস-ছবি না দিলে SDK-জেনারেট হতে পারে (হাইব্রিড, লেবেলকৃত) |
| export_image | local_engine | sharp png/jpeg/webp |
| inspect_image | local_engine (+VLM) | sharp মেটাডেটা + `visionAnalyze` গুণমান-মূল্যায়ন |

### ৪.৩ Audio Studio — `src/lib/agent/tools/audio.ts` (১০টি)

| টুল | বাস্তবায়ন | নোট |
|---|---|---|
| plan_music | sdk_cloud | `chatJson` STRICT-JSON → MusicPlan → song-plan.txt artifact |
| generate_instrumental | local_engine | `music_engine.synthesizeInstrumental` — ৬ মুড × স্কেল/কর্ড/ছন্দ PCM + বিট-মার্কার + ইঞ্জিন-নিজস্ব যাচাই; **প্রসিডিউরাল, নিউরাল নয় (সৎ লেবেল)** |
| generate_singing | **honest_gated** | `throw GATE_SINGING` — সৎ বার্তা + বিকল্প (plan_music / speech_synthesis); প্রকৃত বাধা GPU+SDK-API (লাইসেন্স নয়) |
| separate_stems | **honest_gated** | `throw GATE_STEMS` — Demucs/UVR ইনস্টল নেই + CPU/RAM-সীমা |
| process_audio | ffmpeg | ৯টি op (trim/concat/fade/volume/normalize-loudnorm/eq/compress/reverb-aecho/convert) — টেম্প-ডির + finally-cleanup; reverb সৎভাবে "প্রায়-রিভার্ব" |
| mix_audio | ffmpeg | aformat/afade/adelay + sidechaincompress ডাকিং + amix + alimiter |
| validate_audio | ffmpeg | astats + silencedetect + নিজস্ব নির্ভুল ebur128 পাস (শেষ-মিল পার্সার) |
| inspect_media | ffmpeg | `mediaInfo` (ffprobe JSON) |

### ৪.৪ Video Studio — `src/lib/agent/tools/video.ts` (১০টি)

| টুল | বাস্তবায়ন | নোট |
|---|---|---|
| plan_video | sdk_cloud | `shotPlanFromLLM` (chatJson শট-তালিকা) |
| generate_video | sdk_cloud | ইঞ্জিন `ai_diffusion` (ডিফল্ট) → `ai_video.generateVideoClip` (CogVideoX-3, withAudio, requestKey) + FFmpeg স্বাভাবিকীকরণ; `cinematic_motion` → স্টোরিবোর্ড+Ken Burns; **AI-শট ব্যর্থ হলে সৎ-লেবেলসহ ফলব্যাক** (shotEngineLabels-এ "ক্যামেরা-মোশন ফলব্যাক (AI-ব্যর্থ: …)") |
| image_to_video | sdk_cloud | CogVideoX-3 i2v (data-URL ইনপুট); দুই বার ব্যর্থ হলে **নীরব ফলব্যাক নয়** — সৎ ত্রুটি + animate_image সুপারিশ |
| animate_image | ffmpeg | `kenBurnsClip` (zoompan, ২x ওভারস্যাম্পল) — ক্যামেরা-মোশন, নতুন AI-মোশন নয় |
| process_video | ffmpeg | trim/concat/speed/scale/crop/add_audio/replace_audio |
| enhance_video | ffmpeg | eq/unsharp/hqdn3d/vidstab (দুই-পাস) |
| interpolate_video | ffmpeg | minterpolate |
| generate_subtitles | sdk_cloud (+ffmpeg) | LLM কিউ-সেগমেন্টেশন → `buildSrt` লোকাল |
| validate_video | ffmpeg | ffprobe যাচাই (দৈর্ঘ্য/রেজোলিউশন/fps/স্ট্রিম/A-V সিঙ্ক) |
| lip_sync | **honest_gated** | `lipSyncCapabilityReport()` দিয়ে ৪+১-মাত্রিক বাধা-প্রতিবেদনসহ throw — মিথ্যা সফলতা নয় |

### ৪.৫ Production — `src/lib/agent/tools/production.ts` (২টি)

| টুল | বাস্তবায়ন | নোট |
|---|---|---|
| propose_job | planning_only | `validateSpec` + অটো-ওয়্যারিং (সর্বশেষ আপলোড গান/ছবি) → Production row (awaiting_confirmation); কোনো জেনারেশন নয় |
| create_character | sdk_cloud | `chatComplete` পোর্ট্রেট-প্রম্পট → `generateImageBuffer` → Character upsert (Character Bible) |

---

## ৫. প্রোডাকশন পাইপলাইন (৩টি ভিডিও + ২টি অন্য)

Runner (`production/runner.ts`): কনকারেন্সি **২** + FIFO সারি, stale-sweep ২০ মি (AI-ভিডিওতে ৬০ মি), `checkCancelled` প্রতি শটে, আর্টিফ্যাক্ট থাকলে ত্রুটিতেও **partial** + partialNotes।

### ৫.১ motion_video (`pipelines/motion_video.ts`, ৫৮৪ লাইন) — ধাপ: `plan → generate_shots → assemble → validate`

- **plan:** LLM শট-তালিকা (`shotPlanFromLLM`) + capability-routing; ইঞ্জিন `ai_diffusion` (ডিফল্ট) / `cinematic_motion`।
- **generate_shots:** ai_diffusion হলে প্রতি শটে `generateVideoClip` (CogVideoX-3, `requestKey: ${productionId}-shot-N` → নির্ধারক request_id, ৪২৯-পুনঃসাবমিটে একই id); **২ বার ব্যর্থ হলে সৎ-ফলব্যাক:** AI স্টোরিবোর্ড-ফ্রেম (চরিত্র-রেফারেন্স কন্ডিশনড হলে `editImageBuffer`) + Ken Burns — `engineLabel: "শট N: ক্যামেরা-মোশন ফলব্যাক (AI-ব্যর্থ: …)"`, ফলব্যাক-ফ্রেম artifact হিসেবে নিবন্ধিত। cinematic_motion হলে সরাসরি ফ্রেম+Ken Burns ("ইঞ্জিন-নির্বাচিত" লেবেল)।
- **assemble:** `concatClips` xfade (AI-ইঞ্জিনে ০.৩ সে.); sound='ambient' হলে `mixAudioTracks` সংশ্লেষিত পরিবেশ-শব্দ।
- **validate:** দৈর্ঘ্য/মাত্রা/কোডেক ffprobe-যাচাই; ফলাফলে `engine`, `aiModel`, সৎ-লেবেল — *"X/Y শট প্রকৃত AI (cogvideox-3); বাকি Zটি স্টোরিবোর্ড+ক্যামেরা-মোশন ফলব্যাক"*।
- **generation_mode লেবেলিং:** প্রতি আর্টিফ্যাক্টের metaJson-এ shotEngineLabels + honestLabel — ai_video বনাম image_animation কখনো গোপন হয় না।

### ৫.২ music_video (`pipelines/music_video.ts`, ৬৮৬ লাইন) — ধাপ: `song_input → visual_plan → characters → generate_shots → timeline → final_qc`

- **song_input:** আপলোড-গান (songArtifactId) বা প্রসিডিউরাল স্কোর (`synthesizeInstrumental`, musicSource অনুযায়ী); `analyzeAudioEnergy` বিট-মার্কার।
- **visual_plan / characters:** সেকশন-ভিত্তিক শট-তালিকা (ইঞ্জিন অনুযায়ী সীমা) + শিল্পী-পোর্ট্রেট রেফারেন্স।
- **generate_shots:** motion_video-র একই ইঞ্জিন-প্যাটার্ন (`requestKey: mv-…`) + সৎ-ফলব্যাক।
- **timeline:** বিট-মার্কারে ক্লিপ-টাইমিং; **final_qc:** গান-সমলয় যাচাই (avSyncOk), দৈর্ঘ্য।
- সততা: *"গায়কের মুখ নড়ে না (লিপ-সিঙ্ক নেই) — সৎভাবে ঘোষিত"* — ম্যাট্রিক্স-সারি cap-music-video = available_with_limits।

### ৫.৩ short_film (`pipelines/short_film.ts`, ১২২৬ লাইন) — ধাপ: `script_breakdown → character_bible → acting_plan → speech → generate_shots → sound_design → continuity → final_mix`

- **script_breakdown:** LLM দৃশ্য/শট বিভাজন (ইঞ্জিন অনুযায়ী cap)। **character_bible:** পোর্ট্রেট + Character upsert (§৭.২ পুনঃব্যবহার)। **acting_plan:** প্রতি শটে অভিনয়-নির্দেশনা।
- **speech:** `synthesizeVerifiedSpeech` প্রতি সংলাপ-লাইনে (ভাষা-যাচাইসহ, bn-রায় 'সতর্কতা'); ব্যর্থ লাইন → **partialNotes-এ সৎ রিপোর্ট, পাইপলাইন থামে না**।
- **generate_shots:** একই CogVideoX-3 + ফলব্যাক (`requestKey: sf-…`, চরিত্র-পোর্ট্রেট রেফারেন্স)। **sound_design:** A1–A5 পাঁচ-স্তর `planSoundscape`/`mixSoundLayers` (ডাকিং+লিমিটার+ebur128)। **continuity:** VLM `visionCompare` (পোর্ট্রেট+ফ্রেম)। **final_mix:** টাইমলাইন-মাক্স + বাংলা সাবটাইটেল বার্ন (libass + Noto Sans Bengali) + SRT artifact।

### ৫.৪ অন্য দুটি

- **audio** (`pipelines/audio.ts`, ৫৩৯): voiceover পথ `prepare (≤৯৫০-অক্ষর চাঙ্কিং) → synthesize → verify (ASR ব্যাক-চেক) → master (loudnorm, WAV+MP3) → validate`; এবং music_plan / instrumental / process পথ।
- **image** (`pipelines/image.ts`, ২২৯): `prepare → generate/edit → overlay (বাংলা টাইপোগ্রাফি) → validate (sharp + রপ্তানি)`।

---

## ৬. এরর-হ্যান্ডলিং ইনভেন্টরি

### ৬.১ §১০ রিট্রাই-নীতি — `sdk-helpers.ts`

- **`withRetry(fn, label, attempts=4, baseMs=4000)`** — রিট্রাযোগ্য: ৪২৯/রেট-লিমিট/৫xx/টাইমআউট।
- **Retry-After পার্সিং:** `err.retryAfter` → `headers['retry-after']` → বার্তা-টেক্সট; সেকেন্ড-সংখ্যা বা HTTP-date — পাওয়া গেলে সেটিই ব্যাকঅফ (৯০ সে. ছাদে সীমিত)।
- **Full-jitter এক্সপোনেনশিয়াল:** `delay = random(baseMs/2, min(90s, baseMs×2^attempt))`।
- **৪২৯-নিঃশেষে** → `TemporarilyUnavailableError` (প্রিফিক্স `TEMPORARILY_UNAVAILABLE:`) — *রেট-লিমিট কখনোই লাইসেন্স/অনুমতির সমস্যা নয়*; ৫xx/টাইমআউট-নিঃশেষে সাধারণ সৎ-ব্যর্থতা।
- **TTS:** ৫ চেষ্টা × ২০ সে.-বেস; **ASR/ছবি-সার্চ** withRetry-মোড়া।
- **ব্যতিক্রম (সৎ-নোট):** `llm.ts chatComplete` আলাদা, পুরনো নীতি — ৩ চেষ্টা, নির্দিষ্ট ২.৫/৬ সে. ব্যাকঅফ (full-jitter নয়)। এজেন্ট-সিদ্ধান্ত লুপ এখনো এটি ব্যবহার করে — ভারী ৪২৯-উইন্ডোতে রান সৎভাবে failed হতে পারে (KNOWN_BUGS #১-ঘ)।
- **ভিডিও আইডেম্পোটেন্সি:** `ai_video.ts` `deriveRequestId` (sanitized requestKey + প্রম্পটের sha1) → `request_id` লুপের বাইরে একবার তৈরি — ৪২৯-পুনঃসাবমিটে একই id, প্রোভাইডার ডিডুপ করে; সাবমিট-ব্যাকঅফ ৬০ সে.-বেস, Retry-After-সচেতন।

### ৬.২ অর্কেস্ট্রেটর/রানার স্তর

- অজানা টুল / zod-ব্যর্থতা → **structured error + hint**, LLM-কে ফিডব্যাক (uncaught throw নয়); `looksLikeToolCall` দিয়ে কাটা-JSON টুল-কল সংশোধন-লুপ; MAX_STEPS ১২ পার হলে বাধ্যতামূলক চূড়ান্ত উত্তর; stale-run sweep ১০ মি → interrupted।
- রানারে CancelledError, ধাপ-প্রতি ব্যাকগ্রাউন্ড ট্র্যাকিং, partial-স্ট্যাটাস, ২০/৬০-মি stale-sweep, MAX_CONCURRENT=২।

### ৬.৩ নীরব-ফলব্যাক নিরীক্ষা (সবগুলো লেবেলকৃত কি না)

| ফলব্যাক-স্থান | সৎ লেবেল? |
|---|---|
| TTS mp3→wav (কোড ১২১৪) | ✅ mimeType/এক্সট অনুযায়ী; RIFF-স্নিফে ভুল লেবেল ঠেকানো |
| search_images SDK→CLI | ✅ resultJson `via` + সারাংশে পথ-ঘোষণা |
| generate_video AI→Ken Burns | ✅ shotEngineLabels + honestLabel + ফলব্যাক-ফ্রেম artifact |
| image_to_video ব্যর্থতা | ✅ **নীরব ফলব্যাক নেই** — সৎ ত্রুটি + বিকল্প-সুপারিশ |
| native_ai অডিও না এলে | ✅ "নেটিভ-অডিও চাওয়া হয়েছিল, আসেনি — সৎ-তথ্য" |
| ASR খণ্ড-ব্যর্থতা | ✅ আংশিক ট্রান্সক্রিপ্ট জোড়া (কোড-কমেন্টে ঘোষিত) — ব্যবহারকারী-দৃশ্যমান লেবেল নেই (ছোট ফাঁক) |
| enhance_image (sharp) | ✅ "নতুন AI-ডিটেইল নয়" |
| process_audio reverb | ✅ "প্রায়-রিভার্ব" (aecho) |
| প্রসিডিউরাল ইনস্ট্রুমেন্টাল | ✅ honestLabel "নিউরাল মডেল নয়" |
| TTS-লাইন ব্যর্থ (short_film) | ✅ partialNotes + partial-স্ট্যাটাস |

---

## ৭. পরিবেশ ও ডিপেন্ডেন্সি

- **হার্ডওয়্যার (measureHardware সংজ্ঞা):** ২ CPU কোর, ~৪.১GB RAM, GPU নেই (`nvidia-smi`-প্রোব), ডিস্ক statfs-পরিমাপ।
- **FFmpeg/ffprobe:** সিস্টেম বাইনারি — `ffmpeg version 7.1.5-0+deb13u1`; সংস্করণ রানটাইমে `execFile('ffmpeg', ['-version'])` দিয়ে শনাক্ত (system-info.ts), কখনো হার্ডকোড নয়।
- **মূল ডিপেন্ডেন্সি (package.json):** next ^16.1.1 · react/react-dom ^19.0.0 · prisma/@prisma/client ^6.11.1 · z-ai-web-dev-sdk ^0.0.18 · zod ^4.0.2 · zustand ^5.0.6 · @tanstack/react-query ^5.82.0 · sharp ^0.34.3 · react-markdown ^10.1.0 + remark-gfm ^4.0.1 · framer-motion ^12.23.2 · lucide-react ^0.525.0 · sonner ^2.0.6 · tailwindcss ^4 · typescript ^5 · eslint ^9 · bun-types ^1.3.4। (next-auth, next-intl, recharts ইত্যাদি টেমপ্লেট-উত্তরাধিকার — অ্যাপ-কোডে ব্যবহৃত নয়।)
- **.env:** শুধু `DATABASE_URL` কী বিদ্যমান — **মান এই রিপোর্টে কখনো ছাপা হয়নি**; SDK ক্রেডেনশিয়াল ফাইলে নয়, স্যান্ডবক্স-রানটাইম থেকে আসে।
- **DB:** `db/custom.db` (SQLite, ৩১২KB); মাইগ্রেশন-স্ক্রিপ্ট `db:push`-ভিত্তিক (`--accept-data-loss`)।

---

## ৮. বর্তমান ফিচার-স্ট্যাটাস (Availability Matrix — ২৩ সারি, ৫ মাত্রা)

প্রতিটি সারিতে: **license · provider · integration · runtime · quality** + সামগ্রিক রায়। সারসংক্ষেপ (`docs/FEATURE_MATRIX.json`-এ সম্পূর্ণ):

| সামগ্রিক রায় | সংখ্যা | কোন ক্ষমতা |
|---|---|---|
| available | ১২ | ছবি-জেন/এডিট/সার্চ/বিশ্লেষণ, t2v, i2v, ভিডিও-নেটিভ-অডিও, ভিডিও-সম্পাদনা, সাবটাইটেল, মোশন-ভিডিও, ওয়েব-সার্চ, পেজ-রিডিং |
| available_with_limits | ৪ | TTS (bn-কণ্ঠ প্রশিক্ষিত নয়), ASR (bn দুর্বল), মিউজিক-ভিডিও (লিপ-সিঙ্ক নেই), শর্ট-ফিল্ম (ঠোঁট-সিঙ্ক নয়) |
| experimental | ৩ | প্রসিডিউরাল ইনস্ট্রুমেন্টাল, চরিত্র-শরীর-নড়াচড়া (ফলাফল পরিবর্তনশীল), সাউন্ড-ডিজাইন A1–A5 |
| future | ২ | সম্পূর্ণ গান (ACE-Step প্রার্থী #১ / YuE #২ — GPU+API-বাধা), স্টেম-পৃথকীকরণ (Demucs/UVR) |
| unavailable_here | ২ | টকিং-পোর্ট্রেট লিপ-সিঙ্ক, গান-গাওয়ার লিপ-সিঙ্ক — উভয়েই **৪-মাত্রিক বাধা** (SDK-API নেই · GPU নেই · অ্যাডাপ্টার নেই · বেঞ্চমার্ক হয়নি) |

**গুণমান-মাত্রা (নতুন পঞ্চম মাত্রা):** machine_checked = **১৫ সারি** (ক্লাউড-পথ — ffprobe/মেটাডেটা-যাচাই পাস, মানব-শ্রবণ বাকি) · not_verified = **৮ সারি** (bn-TTS, bn-ASR, প্রসিডিউরাল ইনস্ট্রুমেন্টাল, পূর্ণ-গান, স্টেম, টকিং-পোর্ট্রেট, গান-লিপ-সিঙ্ক, সাউন্ড-ডিজাইন) · human_verified = **০** (এখনো কোনো ক্ষমতাই মানব-যাচাইতে উত্তীর্ণ হয়নি — সৎ স্বীকারোক্তি)।

**মূল সত্য:** `blocked_by_license` = ০ (লাইসেন্স-বিভাজন: provider_api_only ১৫ · allowed ২ · allowed_noncommercial ১ · allowed_with_conditions ২ · needs_review ৩)। প্রকৃত বাধা-মাত্রা: runtime `unavailable_hardware` = ৪ সারি (পূর্ণ-গান, স্টেম, টকিং-পোর্ট্রেট, গান-লিপ-সিঙ্ক — সবই GPU-প্রয়োজন), provider `not_exposed_by_sdk` = ৪ সারি, integration `not_integrated` = ৪ সারি (একই চার সারি তিন মাত্রাতেই বাধাগ্রস্ত), লাইসেন্স-যাচাই-বাকি (needs_review) = ৩ সারি (লিপ-সিঙ্ক প্রার্থী ×২, Demucs-checkpoint)। অর্থাৎ — **লাইসেন্স কোথাও দেওয়াল নয়; দেওয়াল হার্ডওয়্যার ও API-প্রকাশনা।**

---

## ৯. এই সেশনে যা বদলেছে (S8-0 চুক্তি-পরিবর্তন — অডিট-পূর্বসূরি)

1. **পঞ্চম মাত্রা quality_status** — `types.ts`-এ `QualityStatus` (quality_not_verified / quality_machine_checked / quality_human_verified / quality_not_applicable); `ModelEntryView.qualityStatus` + `AvailabilityMatrixRow.quality`; ২৩ ম্যাট্রিক্স-সারিতে মান বসানো (ক্লাউড-পথ = machine_checked, bn-speech/ASR + প্রসিডিউরাল ইঞ্জিন = not_verified); legend-এ গুণমান-ব্যাখ্যা।
2. **ACE-Step / YuE বিভাজন** — `cap-full-song` সারিতে দুই প্রার্থী আলাদা লাইসেন্স-পথসহ: ACE-Step (রিপো Apache-2.0, ওয়েট-শর্ত যাচাই বাকি) প্রার্থী #১, YuE (ওয়েট CC-BY-NC 4.0, অ-বাণিজ্যিকে অনুমোদিত) প্রার্থী #২; প্রকৃত বাধা উভয়ের ক্ষেত্রেই GPU (~৪.৫GB VRAM ন্যূনতম) + SDK-API নেই + bn-বেঞ্চমার্ক হয়নি।
3. **সৎ টুল-বিবরণ সংশোধন** — TOOL_CATALOG-এ `generate_singing` / `separate_stems` / `lip_sync`-এর ভুল "লাইসেন্সের কারণে অবরুদ্ধ" বিবরণ প্রকৃত কারণে বদলানো (GPU/SDK-API/ইন্টিগ্রেশন); system-info.ts-এর singing স্ট্যাটিক-নোটও সংশোধিত।
4. **নতুন চুক্তি-টাইপ** — `HardwareReport` types.ts-এ স্থানান্তরিত (system-info.ts re-export করে); `HardwareVerdict` ৯-অবস্থা + `HardwareModelAssessment`/`HardwareManagerResponse`; বাংলা TTS বেঞ্চমার্ক-টাইপ (`BnBenchmarkCategory`, `TtsBenchmarkSentenceResult`-এ `skipped_rate_limited`, `TtsBenchmarkReport.summary.humanListeningPending`)।

এই অডিট-টাস্কের (S8-2a) নিজস্ব আউটপুট: `docs/AUDIT_REPORT.md`, `docs/FEATURE_MATRIX.json`, `docs/KNOWN_BUGS.md`, `scripts/gen-feature-matrix.ts` — কোনো src/ ফাইল স্পর্শ করা হয়নি।

**লাইভ-প্রমাণ (পুনর্জেনারেশন-স্ক্রিপ্টের কার্যকারিতা):** অডিট-চলাকালেই সমান্তরাল এজেন্ট S8-2b রেজিস্ট্রি-সীডে `qualityStatus` + নতুন এন্ট্রি (`ace-step`, `yue`, `mms-tts-ben`) যোগ করেছে (২২ → ২৪ এন্ট্রি); `bun scripts/gen-feature-matrix.ts` পুনঃচালনায় FEATURE_MATRIX.json স্বয়ংক্রিয়ভাবে নতুন অবস্থা তুলে নিয়েছে — ম্যানুয়াল সিঙ্কের প্রয়োজন হয়নি। এটিই স্ক্রিপ্টের উদ্দেশ্য-সফলতার প্রমাণ।

---

## ১০. রিগ্রেশন-স্যুটের অবস্থা

| আইটেম | অবস্থা |
|---|---|
| `tests/` (৩টি শেল-স্ক্রিপ্ট) | `database-runtime-build.sh`, `python-runtime-build.sh`, `python-runtime-container.sh` — **স্যান্ডবক্স-অবকাঠামো স্ক্রিপ্ট, অ্যাপ-কোডের রিগ্রেশন-টেস্ট নয়** (প্রি-এক্সিস্টিং scaffolding) |
| `scripts-film-smoke.ts` (১২৯ লাইন) | **লোকাল-অনলি ধূমপরীক্ষা — এই সেশনে চালিয়ে সব পাস ✅**: রং-ব্লক ছবি (sharp) → kenBurns ৫ মুভ + ভগ্নাংশ-দৈর্ঘ্য → xfade/ডিমাক্সার concat → ambient/duck-মিক্স/শূন্য-মিক্স → mux (AAC) → **বাংলা সাবটাইটেল-বার্ন** → ইউটিলিটি (sanitize/nearestAspect/normalizeShotDurations)। কোনো ক্লাউড-কল/DB-লেখা নেই — নিরাপদ। |
| tmp-sprint2/ ও tmp-task2d/-এর স্মোক-স্ক্রিপ্ট | `retry-policy-smoke.ts` (২১/২১), `foundation-smoke.ts` (৩২/৩২), `pipeline-smoke.ts`, `speech-tool-smoke.ts` (১০/১০), SDK-প্রোবসমূহ — **ডেভ-যুগের যাচাই-ইতিহাস; সংস্করণ-নিয়ন্ত্রণের বাইরে রাখা** (পরিচ্ছন্নতা-প্রার্থী, তবে ইতিহাস-দলিল §১১) |
| স্থায়ী টেস্ট-হার্নেস | **নেই** — vitest/jest-কৃত কোনো টেস্ট ফাইল রেপোতে নেই; E2E-যাচাই ঐতিহাসিকভাবে curl/agent-browser ধূমপরীক্ষায় হয়েছে (worklog-নথিভুক্ত)। **সুপারিশ: স্মোকগুলোর একটি স্থায়ী tests/-হার্নেসে স্থানান্তর দরকার** |

---

## ১১. অবশিষ্টাংশ ও পরিচ্ছন্নতা-প্রার্থী (এই অডিটে আবিষ্কৃত)

| পথ | আকার | কী | সুপারিশ |
|---|---|---|---|
| `tmp-sprint2/` | ৩২KB | ৩টি প্রোব/স্মোক-স্ক্রিপ্ট (license-verify, retry-policy-smoke, probe-sdk-catalog) | স্থায়ী টেস্টে না নিলে মুছে ফেলা |
| `tmp-task2d/` | ৬৮KB | ৯টি ডেভ-যুগের প্রোব (video-api-probe×৩, mix-repro, pipeline-smoke…) | উপরের মতোই |
| `mixrepro-W0JAJq/`, `mixrepro-uOlU0Z/` | **১০.৭MB** | mix-রিপ্রোডাকশন টেম্প WAV (a1–a5, mix) | নিঃশর্ত মুছে ফেলা |
| `tool-results/` | ২.০MB (২৮ ফাইল) | টুল-আউটপুট ধার (read/bash-ফলাফল) | নিঃশর্ত মুছে ফেলা (runtime-আর্টিফ্যাক্ট) |
| `upload/` | ১.৬MB (২৮ ফাইল) | "Pasted Content…" — ব্যবহারকারীর পেস্ট-আপলোড | সাবধানে যাচাই করে মুছা |
| `storage/artifacts/` | ২৯MB (২০ ফাইল) | mv*-প্রিফিক্স টেস্ট-যুগের artifact — DB পরিষ্কার হলেও ফাইল রয়ে গেছে (অরফান) | DB-এ রেফারেন্স নেই এমনগুলো মুছা |
| `src/app/api/route.ts` | — | "Hello, world!" স্ক্যাফোল্ড — অ্যাপ ব্যবহার করে না | মুছে ফেলা নিরাপদ |
| `agent-ctx/` (৩ ফাইল) | ২৮KB | সাবএজেন্ট-হ্যান্ডঅফ নোট | ইতিহাস-দলিল — রাখা যায় |

**অতিরিক্ত সূক্ষ্ম-পর্যবেক্ষণ (src/ পরিবর্তন ছাড়াই):** src/-তে কোনো TODO/FIXME/ট্র্যাশ-কমেন্ট পাওয়া যায়নি — কোডবেস সচেতনভাবে পরিচ্ছন্ন।

---

## ১২. চূড়ান্ত সৎ-রায়

- **যা সত্যিই চলে:** ৪১টি টুলের মধ্যে ৩৮টি বাস্তব বাস্তবায়নসহ (১৯ sdk_cloud + ৯ ffmpeg + ৯ local_engine + ১ planning_only — হাইব্রিডগুলো নোটসহ); ৫টি পাইপলাইন ঐতিহাসিকভাবে E2E-চালিত; সৎ-লেবেল/ফলব্যাক-চুক্তি সর্বত্র।
- **যা সৎভাবে চালু নয়:** গান-গাওয়া, স্টেম-পৃথকীকরণ, লিপ-সিঙ্ক — তিনটিই গেটেড, কারণ GPU/SDK-API/ইন্টিগ্রেশন (লাইসেন্স নয়)।
- **যা এখনো প্রমাণিত নয়:** বাংলা TTS-এর শ্রবণ-মান (কোনো কণ্ঠই bn-প্রশিক্ষিত নয়; মানব-শ্রবণ-গেট বাকি), এবং কোনো ক্ষমতারই human_verified রায় নেই।
- **ঝুঁকিস্থান:** TTS ৪২৯-উইন্ডো, transcribe_audio-এর চাঙ্কিং-ফাঁক, chatComplete-এর পুরনো রিট্রাই-নীতি — বিস্তারিত `docs/KNOWN_BUGS.md`।
