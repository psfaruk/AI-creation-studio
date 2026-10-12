# Task 4-a — Pipeline local-first fallbacks (backend resilience agent)

পূর্ববর্তী এজেন্টদের রেকর্ড: `agent-ctx/2-a-agent-core-chat-ui.md`, `agent-ctx/2-b-backend.md`, `agent-ctx/2-c-audio-studio.md` + `worklog.md`-র শেষ সেকশনগুলো (S8-2b/c/d, S8-3/4/5)।

## উদ্দেশ্য
স্যান্ডবক্স-ব্যাপী ৪২৯-উইন্ডোতে (chat LLM + image-gen + TTS সব অচল) তিনটি ভিডিও-পাইপলাইন (music_video, motion_video, short_film) যেন প্রকৃত MP4 আউটপুট দিতে পারে — সৎ লেবেলিংসহ (প্রসিডিউরাল কনটেন্ট কখনো AI বলে দাবি নয়)।

## যা করা হয়েছে

### 1. নতুন `src/lib/agent/local-frames.ts`
- `generateLocalFrame(opts)` → নির্ধারক প্রসিডিউরাল PNG ফ্রেম, শুধু FFmpeg (~৩০০ms):
  - lavfi `gradients` সোর্স (মুড-প্যালেটের ৩ রং + হ্যাশ-নির্ধারিত দিক/জিটার) → `noise=alls=6:allf=t:all_seed=N` (ফিল্ম-গ্রেইন) → `vignette` → `scale` → rgb24 PNG।
  - অভ্যন্তরীণ রেন্ডার দীর্ঘ-অক্ষ ≥১০২৪px (সুপারস্যাম্পল), তারপর লক্ষ্য-মাপ — আউটপুট মাপ হুবহু WxH, ffprobe-যাচাই ফাংশনের ভিতরেই।
  - ডিটারমিনিজম: ইন-ফাইল FNV-1a + splitmix32 — (seed,width,height,mood) → SHA-256-অভিন্ন বাইট (ধূমপরীক্ষায় প্রমাণিত)।
  - ৬টি মুড-প্যালেট (sad/romantic/joyful/suspense/action/peaceful) + বাংলা/ইংরেজি মুক্ত-টেক্সট মিলানো; অজানা মুড → peaceful।
- `LOCAL_FRAME_LABEL` = 'লোকাল প্রসিডিউরাল ফ্রেম (ক্লাউড ইমেজ-জেনারেশন রেট-লিমিটেড — নিউরাল নয়)' — প্রতিটি honestLabel-এ বাধ্যতামূলক।

### 2. `pipelines/music_video.ts`
- `visual_plan`: chatJson try/catch — ৪২৯-এ data=null + সৎ নোট → বিদ্যমান fallbackDescription-পথ।
- `characters`: পোর্ট্রেট-ব্যর্থতায় (৪২৯-সহ) লোকাল প্রসিডিউরাল পোর্ট্রেট (seed `mv-char-${name}`, 864x1152) — portraitDataUrl বসে, artifact kind='local-procedural', সৎ partialNote; **db.character.upsert কেবল প্রকৃত AI-পোর্ট্রেটে**।
- `generate_shots` cinematic_motion: দুই tryGen-ব্যর্থতার পর শট-বাদের আগে লোকাল ফ্রেম (seed `mv-shot-${i}`) — সৎ engineLabel `শট N: লোকাল প্রসিডিউরাল ফ্রেম + ক্যামেরা-মোশন (ইমেজ-জেন রেট-লিমিটেড)`। ai_diffusion-শাখায় res.frameLocal → সৎ artifact-নোট।

### 3. `pipelines/motion_video.ts` (শেয়ার্ড generateAiShot-সহ)
- `generateAiShot`: AI-ভিডিও ও ফলব্যাক-ফ্রেম দুটোই ব্যর্থ হলে শেষ-উপায় লোকাল ফ্রেম (seed `aishot-fb-${index}`, fallbackGenSize-পার্স বা req-মাপ, নতুন ঐচ্ছিক `fallbackMood`) → kenBurns → `frameLocal:true` + সৎ engineLabel। throw কেবল লোকালও ব্যর্থ হলে।
- plan-ধাপ: shotPlanFromLLM try/catch → নির্ধারক সরল শট-তালিকা (সমান দৈর্ঘ্য, 'Cinematic scene N', MOVES-চক্র) + সৎ নোট।
- cinematic_motion-শাখা: লোকাল-শেষ-উপায় (seed `motion-shot-${i}`) + সৎ engineLabel।

### 4. `pipelines/short_film.ts`
- `script_breakdown`: প্রথম chatJson try/catch → data না-পেলে **নির্ধারক ৩-দৃশ্য ফলব্যাক** — `splitStoryIntoThreeChunks` (বাক্য-সীমা । . ! ? \n, অক্ষর-ভারসাম্য; <৩ বাক্যে অক্ষর-বিভাজন), location='মূল দৃশ্য', dialogues=[] (কোনো বানানো সংলাপ নয়), logline='', সৎ নোট।
- দ্বিতীয় chatJson (শট-বিভাজন): try/catch → sd=null → প্রতি-দৃশ্যে-এক-শট ফলব্যাক + সৎ নোট।
- `character_bible`: লোকাল পোর্ট্রেট (seed `sf-char-${name}`) — bible-entry + সৎ artifact/note; Character-upsert কেবল AI-পোর্ট্রেটে।
- `acting_plan`: try/catch → data=null → বিদ্যমান প্রতি-শট ডিফল্ট-অবনমন।
- generate_shots: লোকাল-শেষ-উপায় (seed `sf-shot-${i}`); ai_diffusion-শাখায় fallbackMood+সৎ নোট।
- `continuity`: ইতিমধ্যে fail-soft ছিল (যাচাইকৃত) — ৪২৯-এ একবারের সৎ partialNote যোগ।
- **অস্পৃষ্ট**: speech / sound_design / final_mix (নির্দেশ মতো)।

## যাচাই
- `bunx tsc --noEmit`: src/-এ ০ এরর (৫টি পুরোনো: examples/, skills/, tmp-task2d/, scripts/)।
- `bun run lint` (পুরো প্রকল্প): PASS (exit 0)।
- ধূমপরীক্ষা ১: 720x1280 + 1280x720 PNG, ভিন্ন সিড, ~৩০০ms, ffprobe-মাপ-নিশ্চিত, ডিটারমিনিজম SHA-256 অভিন্ন ✓ (সাময়িক স্ক্রিপ্ট মুছে ফেলা)।
- ধূমপরীক্ষা ২ (fallback-E2E): generateLocalFrame → kenBurnsClip → বৈধ h264 MP4 (720x1280@30, ৩.৫ সে.) — ক্লাউড-ছাড়া শট-পথ ✓ (সাময়িক স্ক্রিপ্ট মুছে ফেলা)।
- Dev-server: বেঁচে আছে, /api/productions, /api/tools, / সব 200।

## ⚠️ মূল-এজেন্টের জন্য গুরুত্বপূর্ণ পার্শ্ব-পর্যবেক্ষণ
**GET /api/system 500** — `llmCacheStats is not a function`। কারণ: Turbopack-এর [app-route]-প্রসঙ্গে llm.ts-এর **পুরোনো ইন-মেমরি মডিউল** (llm.ts ০২:৩৭ + route.ts ০২:৪৪ সম্পাদনা দীর্ঘ-চলমান dev-server-এ জমা হয়েছিল)। প্রমাণ যে এটি আমার পরিবর্তনের ফল নয়: (১) /api/system-এর ইম্পোর্ট-গ্রাফ = system-info/tts-cache/llm/rate-limit-coordinator/limits — আমার ৪ ফাইলের কোনোটি নেই; (২) ডিস্কে কমপাইল-করা চাঙ্ক সঠিক (`.next/dev/server/chunks/[root-of-the-server]__6470163f._.js`-এ llmCacheStats আছে); (৩) POST /api/system কাজ করে (সে পথ ওই বাইন্ডিং ছোঁয় না); (৪) tsc/lint উভয়ই পরিষ্কার। touch + কনটেন্ট-নাজ (বাইট-অভিন্ন পুনরুদ্ধারসহ — llm.ts ও route.ts এখনো মূল-এজেন্টের সংস্করণের সাথে cmp-অভিন্ন) সারাতে পারেনি — **dev-server রিস্টার্ট করলেই সারবে**।

## সততার সিদ্ধান্তসমূহ
- প্রসিডিউরাল পোর্ট্রেট/ফ্রেম কখনো AI নয় — LOCAL_FRAME_LABEL + kind='local-procedural' + সৎ engineLabel সর্বত্র।
- প্রসিডিউরাল পোর্ট্রেট Character-টেবিলে স্থায়ী রেফারেন্স হয় না (upsert কেবল প্রকৃত AI-পোর্ট্রেটে)।
- নির্ধারক চিত্রনাট্য-ফলব্যাক সংলাপ/কণ্ঠ বানায় না — dialogues=[], নীরব সিনেম্যাটিক দৃশ্য; বর্ণনা-TTS কাজ করলে সে-পথ চালু, নইলে বিদ্যমান সৎ-স্কিপ।
- ফলব্যাক কেবল ব্যর্থতায় ট্রিগার হয় — ক্লাউড সচল থাকলে আগের আচরণ ১০০% অপরিবর্তিত।
