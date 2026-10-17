# Latest-Fix Baseline Report — Phase 0

**Task ID:** LF-0 · **Date:** 2026-10-17 · **Auditor:** main agent (Z.ai Code)
**Mandate:** "AI Creation Studio — Latest GitHub Baseline Audit & Real Audio/Video Repair" — baseline
যাচাই করে সেটিকে সত্যের একক উৎস হিসেবে স্থির করা, এরপরেই source code পরিবর্তন শুরু।

---

## 1. Git baseline (নথিভুক্ত, যাচাইকৃত)

| প্রশ্ন | ফলাফল |
|---|---|
| `HEAD` | `49d9b29` — "fix: voiceover text fallback from chat message + generation blockage recovery" |
| `origin/main` | `49d9b29` — **HEAD-এর সাথে অভিন্ন** (ahead 0 / behind 0) |
| Working tree | পরিষ্কার — `git status --short` খালি (শুধু এই audit-ফোল্ডারের নতুন ফাইল, যা এই টাস্কের deliverable) |
| `git diff --check` | পরিষ্কার — কোনো whitespace-conflict/conflict-marker নেই |
| গত ১৫ commit | নিচের ইতিহাস-সারণি |

### ১.১ গত ১৫টি commit (পুরনো → নতুন)

| Commit | বিষয় |
|---|---|
| `568c0a4` | chat-403 fix (proxy-aware auth) + provider Base URL override + minimal /api/v1 restore |
| `acf147b` | deep-audit fix round: event-bus replay-from-emit, SSE reconnect/dedupe, music intent split (instrumental/sung-song), WAV+MP3, spec resolution |
| `f5fe336` | worklog: deep-audit fix round |
| `4b628fa` | platform auto-snapshot (UUID) |
| `8c472fb` | phase-1: regression suite (37 tests), observability layer, tool inventory, audit docs |
| `2b0ef3e` | phase-2 round 1: P0-BUG-01 TTS fallback fix, chat 409 idempotency guard, client run re-attach |
| `8ce272c` | feat: improve media quality and shot reuse |
| `310c712`, `92eb66d` | platform auto-snapshots (UUID) |
| `d982a4d` | worklog: phase-4 push approval |
| `c7927f7` | phase-5: cinematic director & camera shot planning + review fixes |
| `c028e2a`, `9819a9f`, `1b4fbae` | platform auto-snapshots (UUID) — 1b4fbae-এ schema-তে `confirmedAt` যুক্ত হয়েছিল |
| `49d9b29` | **HEAD** — voiceover text fallback from chat + generation blockage recovery (Prisma Client regenerate-এর নথি এবং কার্যকর সমাধান) |

### ১.২ সর্বশেষ commit-এ কী বদলেছে (মাস্টার-প্রম্পটের প্রশ্নমাফিক)

- **TTS**: কোনো TTS-engine কোড বদলায়নি — সৎ VOICE_UNAVAILABLE-নীতি অপরিবর্তিত।
- **Prisma generation**: মূল কারণ #১ নথিভুক্ত — `1b4fbae` schema-তে `confirmedAt DateTime?` যোগ করলেও runtime
  Prisma Client regenerate হয়নি → confirm-API 500 → সম্পূর্ণ জেনারেশন-ব্লকেজ। সমাধান `bun run db:generate`
  + `bun run db:push` (commit-message-এ নথিভুক্ত; runtime client এখন schema-সামঞ্জস্যপূর্ণ)।
- **Voiceover fallback**: `src/lib/agent/production/pipelines/audio.ts` `runVoiceover`-এর prepare-ধাপে
  spec.text খালি থাকলে চ্যাটের সর্বশেষ user-message থেকে স্ক্রিপ্ট নেওয়ার fallback + সৎ নোট;
  চ্যাটেও কিছু না থাকলে সৎ ব্যর্থতা।
- **Generation blockage recovery**: উপরের দুই সমাধান একত্রে — ব্রাউজারে যাচাইকৃত
  (confirm 200 → prepare পাস → synthesize সৎ VOICE_UNAVAILABLE)।

### ১.৩ অপ্রকাশিত/uncommitted পরিবর্তন সংরক্ষণ

Working tree পরিষ্কার — পূর্বসূরি agent-এর কোনো অপ্রকাশিত কাজ হারানোর ঝুঁকি নেই।
আজকের লাইভ-প্রোব evidence ফাইল repo-র বাইরে `/tmp/tts-probe/`-এ এবং নথিভুক্ত কপি
`docs/audit/latest-fix/evidence/`-তে। **কোনো destructive কমান্ড চালানো হয়নি; কোনো database reset হয়নি;
কোনো ফাইল overwrite হয়নি।**

---

## 2. পূর্বসূরি audit-document-সমূহ (পঠিত)

| সেট | অবস্থান | মূল সিদ্ধান্ত |
|---|---|---|
| Phase 0–5 | `docs/audit/phase-0` … `phase-5` | ভাষা-নিয়ন্ত্রক, ইঞ্জিন-সচেতন ফলব্যাক, ক্ষমতা-ট্যাগ, SSE-রিকানেক্ট, সিনেম্যাটিক-প্ল্যানার, shot-reuse |
| Recovery 1–5 | `docs/audit/recovery-phase-1-5` | 62 findings → R-FIX → 185-test স্যুট; speech-bn-jam চীনা-আবর্জনার পূর্ণ ইভিডেন্স-চেইন; সততা-নীতিগুলো স্থায়ীভাবে কোডে লেখা |
| worklog | `worklog.md` (২১৮০ লাইন) | সর্বশেষ এন্ট্রি RECOVERY-PUSH — জেনারেশন-ব্লকেজ সমাধান + অনুমোদিত push |

---

## 3. আজকের লাইভ প্রোব (2026-10-17, এই baseline-রিপোর্টের নতুন প্রমাণ) — সত্য এখন পরীক্ষিত

**পদ্ধতি**: একই বাংলা বাক্য
`“আজ বাংলাদেশের আকাশ পরিষ্কার এবং বাতাস বেশ সুন্দর।”` (স্বাভাবিক গতিতে ≈৪–৭ সে.) দিয়ে প্রতিটি
উপলব্ধ TTS-কণ্ঠ → ffprobe/RMS/নীরবতা-বিশ্লেষণ → z-ai ASR রাউন্ড-ট্রিপ → ইংরেজি/চীনা control-দিয়ে
পদ্ধতির সংশোধন-বৈধতা প্রমাণ। Evidence: `evidence/probe-*.json`, `evidence/probe-gtts-bn.mp3`।

### ৩.১ z-ai SDK TTS — ৭টি কণ্ঠের কেউই বাংলা পড়তে পারে না (পুনঃনিশ্চিত, লাইভ)

| কণ্ঠ | দৈর্ঘ্য | ASR রাউন্ড-ট্রিপ | রায় |
|---|---|---|---|
| tongtong | 26.02s | “他妈，他妈，他妈，C D C T G O Q W” | বর্ণ-ধরে-ধরে বানান — বাংলা নয় |
| chuichui | 25.42s | (আবর্জনা-প্যাটার্ন অনুরূপ) | বাংলা নয় |
| xiaochen | 3.84s | “To to, to dean, to dean…” | অর্থহীন |
| jam | 24.18s | (বানান-প্যাটার্ন) | বাংলা নয় |
| kazi | 14.84s | (আবর্জনা) | বাংলা নয় |
| douji | 10.36s | “Can be can be…” ×৩০০+ | রিপিট-আবর্জনা |
| luodo | 7.28s | “Pap, pap, pap…” | রিপিট-আবর্জনা |

**Control (পদ্ধতি বৈধ)**: xiaochen+English → ASR হুবহু "The weather is beautiful today." ✅;
tongtong+চীনা → ASR হুবহু "今天天气很好。" ✅ — অর্থাৎ প্রোব-পদ্ধতি নির্ভুল, ব্যর্থতাগুলো কণ্ঠের।

### ৩.২ z-ai ASR — বাংলা *বোঝে*, কিন্তু script-preserving ট্রান্সক্রিপ্ট দেয় না (নতুন আবিষ্কার)

Google-অনুবাদ-TTS-এর বাংলা অডিওর ASR-ফল: **“今天，巴基斯坦的天空非常干净。”**
(চীনা অনুবাদ — অর্থ: "আজ আকাশ খুব পরিষ্কার" — অর্থ মিলেছে, দেশনামে ASR-ত্রুটি)।
অর্থাৎ ASR বাংলা কথাকে **চীনা অনুবাদে** ফেরত দেয়, বাংলা লিপিতে নয়।
পরিণাম: script-preserving বাংলা ASR-যাচাই এই পরিবেশে **অসম্ভব** → মাস্টার-প্রম্পট §1.4 অনুযায়ী
বাংলা অডিওর ভাষা-স্ট্যাটাস সৎভাবে `LANGUAGE_UNVERIFIED` / `AUDIO_VALIDATION_ONLY` হতে হবে।

### ৩.৩ Google Translate TTS (`tl=bn`) — **এই sandbox-এ বাস্তবে কর্মরত বাংলা TTS provider** (নতুন আবিষ্কার)

- HTTP **200**, `audio/mpeg`, 40,320 বাইট, বৈধ MP3 (FF FB ম্যাজিক)।
- **দৈর্ঘ্য 5.04s** — বাক্যের জন্য সঠিক (z-ai-গার্বেজের 26s-এর বিপরীতে)।
- RMS −19.0 dB, peak −2.4 dB — সুস্থ কথার মাত্রা; নীরবতা-কভারেজ নগণ্য।
- ASR সেম্যান্টিক-রাউন্ড-ট্রিপ পাস (উপরের চীনা-অনুবাদে অর্থ মিলেছে) — **প্রকৃত বাংলা উচ্চারণ প্রমাণিত**।
- সীমাবদ্ধতা (সৎ): অপ্রাতিষ্ঠানিক endpoint, কোনো SLA নেই, রেট-লিমিট অজানা, প্রতি-অনুরোধে
  টেক্সট-দৈর্ঘ্যের সীমা (≈২০০ অক্ষর) — লম্বা স্ক্রিপ্টে চাঙ্ক-কনক্যাট দরকার। কোনো key/পেমেন্ট নেই।

### ৩.৪ Edge TTS — এই পরিবেশে 403 (পুনঃনিশ্চিত)

`storage/voice-verification.json`: `bn-BD-NabanitaNeural` — verdict `fail`,
"অনুপলব্ধ — Edge TTS সংযোগ-ত্রুটি: Unexpected server response: 403" (verifiedAt 2026-10-17T17:30Z)।
bn-BD/bn-IN কণ্ঠগুলো ক্যাটালগে সঠিক, কিন্তু এই sandbox থেকে পৌঁছানো যায় না।

### ৩.৫ ভিডিও-জেনারেশন — SDK-তে `video.generations.create` + `async.result.query` আছে

`node_modules/z-ai-web-dev-sdk/dist/index.d.ts:92–110` — prompt/image_url/quality/duration/fps,
task-status PROCESSING→SUCCESS/FAIL। অ্যাপের `src/lib/agent/video/ai_video.ts` এটিই ব্যবহার করে
(Phase 6-এর Test C-এর জন্য লাইভ-প্রোব পরিকল্পিত)।

### ৩.৬ অন্যান্য পরিবেশগত সীমা

- `upload.wikimedia.org` এই IP থেকে CDN-স্তরে 429 — স্বাধীন বাংলা অডিও-নমুনা আনা যায়নি
  (ASR-বাংলা-ক্ষমতার সরাসরি যাচাই এভাবে BLOCKED; পরোক্ষভাবে §৩.২-এ প্রতিষ্ঠিত)।
- GPU নেই — লিপ-সিঙ্ক/সঙ্গীত-মডেলের লোকাল-রান অসম্ভব (লিপ-সিঙ্ক মডিউলে ইতিমধ্যে ৪-মাত্রিক সৎ ব্লকেজ)।

---

## 4. Provider বাস্তবতা বনাম কোড-ক্ষমতা — আলাদা তালিকা (মাস্টার-প্রম্পটের নির্দেশ)

| ক্ষমতা | কোডে আছে? | এই পরিবেশে বাস্তবে উপলব্ধ? | প্রমাণ |
|---|---|---|---|
| বাংলা speech TTS — Edge নিউরাল | ✅ (edge_tts.ts, ৪ কণ্ঠ) | ❌ 403 | voice-verification.json + পূর্ববর্তী রান |
| বাংলা speech TTS — Google Translate | ❌ (আজ পর্যন্ত কোডে ছিল না) | ✅ **200, সঠিক দৈর্ঘ্য, সেম্যান্টিক-রাউন্ড-ট্রিপ পাস** | §৩.৩ |
| বাংলা speech TTS — z-ai ৭ কণ্ঠ | (কোড-পথ আছে) | ❌ কেউই বাংলা পড়ে না | §৩.১ লাইভ-ম্যাট্রিক্স |
| ইংরেজি TTS | ✅ | ✅ (Edge-403 হলে z-ai fallback লাইভ-প্রমাণিত) | §৩.১ control |
| চীনা/হিন্দি/উর্দু TTS | ✅ (রাউটিং) | ⚠️ hi/ur/zh লাইভ-অপরীক্ষিত (Edge-403 নির্ভর) | language_controller নোট |
| Script-preserving বাংলা ASR | ❌ (ASR-ট্রান্সক্রিপ্ট চাঙ্কিং আছে) | ❌ ASR চীনা-অনুবাদ দেয় | §৩.২ |
| ইংরেজি/চীনা ASR | ✅ | ✅ নিখুঁত রাউন্ড-ট্রিপ | §৩.১ control |
| গাওয়া গান (sung vocals) | ❌ (সৎ-গেটেড) | ❌ কোনো provider নেই | music_engine.ts:9-10 |
| Procedural instrumental | ✅ | ✅ (নিজস্ব সিন্থ ইঞ্জিন) | music_engine.ts |
| ভিডিও জেনারেশন | ✅ (ai_video.ts) | ✅ SDK-পথ; লাইভ-প্রোব বাকি | §৩.৫ |
| লিপ-সিঙ্ক | ইন্টারফেস-সম্পূর্ণ | ❌ (provider+GPU+লাইসেন্স-ব্লকড) | lip_sync_module.ts |

---

## 5. Phase 1-এর করণীয় এই baseline-থেকে উৎসারিত

1. **Google Translate TTS-কে প্রকৃত provider হিসেবে সংযুক্ত করা** — bn-চেইনে Edge-কণ্ঠগুলোর পরে
   সৎ-লেবেলসহ (অপ্রাতিষ্ঠানিক endpoint, একক কণ্ঠ, দৈর্ঘ্য-সীমা, চাঙ্কিং); কখনোই ভুল-ভাষা নয়।
2. **কণ্ঠ-ক্ষমতা রেজিস্ট্রি সম্প্রসারণ** — live-verified বনাম catalog-only প্রতিটি কণ্ঠে; আজকের প্রোব-ফল
   রেকর্ড হিসেবে জমা।
3. **§1.4 স্ট্যাটাস**: বাংলা ফলাফলে `LANGUAGE_UNVERIFIED`/`AUDIO_VALIDATION_ONLY` সৎ-ব্যাজ।
4. **রিগ্রেশন-টেস্ট** — §1.5-এর ৯টি দৃশ্যের প্রতিটি (mock-ইঞ্জিনসহ, hermetic)।

## 6. Phase 0 acceptance

- [x] HEAD/origin/status/15-commit নথিভুক্ত
- [x] সর্বশেষ push-এর commit baseline (49d9b29)
- [x] পূর্বসূরির uncommitted পরিবর্তন সংরক্ষিত (কিছু ছিল না — ট্রি পরিষ্কার)
- [x] `git diff --check` পরিষ্কার
- [x] সর্বশেষ commit-এর TTS/Prisma/voiceover/blockage-পরিবর্তন যাচাই
- [x] পূর্ববর্তী audit/phase/recovery-রিপোর্ট পঠিত
- [x] Provider-বাস্তবতা বনাম কোড-ক্ষমতা আলাদা তালিকাভুক্ত
- [x] কোনো destructive/overwrite/reset কমান্ড চালানো হয়নি

**Phase 0 verdict: PASS** — baseline স্থির, সোর্স-পরিবর্তন শুরুর অনুমতি পাওয়া গেছে।
