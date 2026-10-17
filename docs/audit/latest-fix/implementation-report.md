# Implementation Report — latest-fix (LF)

**Task ID:** LF-IMP · **Baseline:** `49d9b29` → এই কাজের সব পরিবর্তন **অসামঞ্জস্যপূর্ণ নয়, কমিট-বিহীন** (মাস্টার-প্রম্পট: কোনো commit/push/merge নয়) — পরিবর্তনগুলো ওয়ার্কিং ট্রিতে পর্যালোচনাযোগ্য।

---

## ১. Phase 0 — বেসলাইন (LF-0)

- `baseline-report.md` — git-ফরেনসিক + আজকের লাইভ-প্রোবগুলো (z-ai কণ্ঠ-ম্যাট্রিক্স, ASR-আচরণ, Google-TTS আবিষ্কার, Edge-403 পুনঃনিশ্চিত)।
- **Phase 0 verdict: PASS** — সোর্স-পরিবর্তনের অনুমতি-প্রাপ্ত বেসলাইন।

## ২. Phase 1 — বাংলা TTS-এর স্থায়ী সমাধান (LF-0 + LF-1)

### ২.১ নতুন প্রোভাইডার-মডিউল `src/lib/agent/audio/google_tts.ts`

- `translate.google.com/translate_tts?tl=bn` — **এই sandbox-এ লাইভ-যাচাইকৃত বাংলা কথা**।
- বাক্য-সীমানা চাঙ্কিং (≤১৮০ অক্ষর/অংশ, যতিচিহ্নহীন সারিতে শক্ত-ভাঙন) + ফ্রেম-কনক্যাট।
- প্রতি-অংশ ৩-পুনঃচেষ্টা (429 → দীর্ঘ অপেক্ষা); টাইমআউট ১৫সে; টাইপড বার্তা-শ্রেণি (429/403/404/5xx/টাইমআউট/নেটওয়ার্ক)।
- **ফাইল-তৈরি ≠ সাফল্য:** প্রতিক্রিয়া অবশ্যই `audio/*` content-type + MP3 ফ্রেম-সিঙ্ক (0xFF Ex) + ≥৪০০ বাইট — HTML-ব্লক/ক্যাপচা/করাপ্ট প্রত্যাখ্যান।
- স্বাস্থ্য-পরীক্ষা (৫-মিন ক্যাশ) → voice-verification রেকর্ড; `/api/system`-এ প্রবাহিত।
- সৎ সীমা-ঘোষণা কোড-মন্তব্য + রেজিস্ট্রি-নোটে: অপ্রাতিষ্ঠানিক/একক-কণ্ঠ/গতি>১-অসমর্থিত/কথা-শুধু।

### ২.২ চেইন-সংযোজন (§1.3-এর সঠিক ক্রম)

`bn-চেইন: Edge bn-BD (লোকেল-মিল) → Edge bn-IN → Google bn → VOICE_UNAVAILABLE (উভয় প্রোভাইডারের নামসহ)` — z-ai কণ্ঠ কাঠামোগতভাবে অযোগ্য (ক্ষমতা-ট্যাগ fail-closed); ভুল-ভাষা নীরব-ফলব্যাক অসম্ভব। ফলব্যাক-ফল সর্বোচ্চ `warn` (B-F05) + `ইঞ্জিন-ফলব্যাক` নোট + গুগল-সীমা-নোট (গতি/লোকেল)। `phoneticEnglish` ট্রান্সলিটারেশন এখন কেবল z-ai কণ্ঠে (গুগল-কণ্ঠ বাংলা লিপিই পড়ে)।

### ২.৩ languageStatus — §1.4 সততা-স্তর (LF-1)

`SpeechVerification.languageStatus: ASR_VERIFIED | AUDIO_VALIDATION_ONLY | LANGUAGE_UNVERIFIED` — verdict থেকে স্বাধীন; pipeline verify-ধাপের বার্তায়, আর্টিফ্যাক্ট-মেটায়, ফলাফল-অবজেক্টে এবং UI ব্যাজে (artifact-view) প্রবাহিত। bn-ফল সৎভাবে `AUDIO_VALIDATION_ONLY` (এই পরিবেশে script-preserving বাংলা ASR নেই — ২০২৬-১০-১৭ প্রোব-প্রতিষ্ঠিত)।

### ২.৪ রাউটিং/সারফেস

`tts-cache.synthRaw`-এ goog-ইঞ্জিন (ক্যাশ-কী অপরিবর্তিত — কণ্ঠ-নামই ইঞ্জিন নির্ধারণ করে); `engineOfVoice`/short_film heuristic/`model-registry-data`-তে নতুন `google-translate-tts` এন্ট্রি (runtimeStatus: healthy, লাইভ-প্রোব-নোটসহ); capabilities/config-panel/prompts/tools-বিবরণ হালনাগাদ।

## ৩. Phase 2 — ক্ষমতা-বিচ্ছেদ ও গান (LF-2)

- `MUSIC_ENGINE_LABEL`-এ ক্যানোনিক্যাল `[PROCEDURAL_INSTRUMENTAL]` টোকেন (§2.1) — প্রতিটি ইনস্ট্রুমেন্টাল আর্টিফ্যাক্ট/গুণমান-স্ট্রিং-এ প্রবাহিত।
- গাওয়া-গানের অনুরোধ-পথ নথিভুক্ত ও যাচাইকৃত: sung-song intent → সৎ প্রকাশনা ("গান গাওয়ার মডেল এখন চালু নেই — ভুয়া গান বানানো হবে না") + সৎ-লেবেল-করা ইনস্ট্রুমেন্টাল বিকল্প।
- **প্রকৃত গাওয়া-গান প্রোভাইডার:** `singing-provider-research.md` (LF-2-R সাবএজেন্ট) — প্রমাণভিত্তিক সিদ্ধান্ত: **এই পরিবেশে BLOCKED** (key+পেমেন্ট/GPU); ভবিষ্যৎ-প্রার্থী ACE-Step 1.5 (MIT) — বাংলা-গাওয়ার লাইভ-যাচাই বাধ্যতামূলক শর্ত।

## ৪. Phase 3 — সিনেম্যাটিক পরিকল্পনা (LF-3)

- নতুন `cinematic/narrative.ts` — §3.2-এর সেমান্টিক পর্যালোচনা: OPENING_NOT_ESTABLISHING, SCENE_INTERLEAVED, REACTION_BEFORE_ACTION, VERY_SHORT_SHOT_CHAIN, SCENE_BOUNDARY_WITHOUT_NOTE + সৎ scope-নোট (দৃশ্য-কাস্ট-তালিকা ডেটা-মডেলে নেই — সদস্যপদ-যাচাই অসম্ভব, সৎভাবে ঘোষিত)।
- প্রিভিউ-ফলাফলে `narrativeReview` + প্রোডাকশন-কার্ডে ⚠ সতর্কতা-ব্লক (§3.4-র review-flag চাহিদা)।
- §3.1/§3.3/§3.৫-এর বাকি দাবি (স্থিতিশীল আইডি, ক্রম=টাইমলাইন=রেন্ডার, ক্যারেক্টার-রেফারেন্স, শট-রিইউজ, ডাউনগ্রেড-সৎ-নোট) পূর্ববর্তী Phase-5 থেকে বিদ্যমান — t16/t17/t19-লকড; নতুন ৭ টেস্ট REG-16Na…Ng।

## ৫. Phase 4 — লিপ-সিঙ্ক (LF-4)

- `lipsync-provider-research.md` (LF-4-R) — চার মাত্রার পুনঃযাচাই: license আংশিক-বদলেছে (Wav2Lip এখনও একাডেমিক-কেবল; MuseTalk 1.5 MIT; SadTalker Apache-2.0), provider/hardware/integration বহাল → **সামগ্রিক BLOCKED অপরিবর্তিত**।
- `lip_sync_module.ts`-এর ঘোষণাগুলো বর্তমান প্রমাণে হালনাগাদ (সৎ-সততা: পুরোনো নোট অসম্পূর্ণ ছিল)। LIP_SYNC_UNSUPPORTED আচরণ অপরিবর্তিত — সাবটাইটেল/মিক্স-ভিত্তিক বিকল্পকে কখনো "লিপ-সিঙ্ক সম্পন্ন" বলা হয় না।

## ৬. Phase 5 — নির্ভরযোগ্যতা (LF-5)

- **নতুন:** `TTS_CACHE_DIR` env-ওভাররাইড + স্যুট-প্রিলোড আইসোলেশন (ভবিষ্যতের কোনো টেস্ট প্রকৃত TTS-ক্যাশ বিষ-করতে পারবে না — LF-RC-3); গুগল-প্রোভাইডারের বাউন্ডেড-রিট্রাই/টাইমআউট/রেট-লিমিট-শ্রেণি।
- **যাচাইকৃত-বিদ্যমান (টেস্ট-লকড):** ডুপ্লিকেট-রান গার্ড (t3), SSE-রিপ্লে/রিকানেক্ট (t4), 429-বাউন্ডেড-রিট্রাই (t6), ক্লায়েন্ট রি-অ্যাটাচ (t7/t2), কিউ-বনাম-কনফার্মেশন প্রতীক্ষার পৃথক মেট্রিক (t23, confirmedAt/confirmationHoldMs), পার্শিয়াল-রিটেনশন (t17b/t8d-e), শট-ক্যাশ ফিঙ্গারপ্রিন্ট = {v, model, prompt, duration, quality, image, withAudio, size} (t10) + TTS-ক্যাশ-কী = {voice, speed, text} (t26q) — §৫-এর ক্যাশ-কী চাহিদা পূরণ।

## ৭. Phase 6 — বাস্তব E2E (LF-6)

- **Test A (বাংলা কথা):** ✅ **লাইভ-সম্পন্ন** — `real-media-evidence.md` দেখুন (প্রকৃত প্রোডাকশন, ffprobe/RMS/ASR-প্রমাণসহ)।
- **Test B (গাওয়া গান):** ⛔ **BLOCKED** — প্রোভাইডার-শূন্যতা (§৩-এর ম্যাট্রিক্স); সৎ ব্যাখ্যা real-media-evidence.md-এ।
- **Test C (৩০সে সিনেম্যাটিক ভিডিও) + Test D (সম্পূর্ণ মিউজিক ভিডিও):** লাইভ-রান চালু হয়েছে (`cmvcsgzwa000jsmrz2ffuqrwj` — ৩০ সে., স্ট্যান্ডার্ড, CogVideoX-3, ৩ শট) — ফলাফল real-media-evidence.md-এ।

## ৮. পরিবর্তিত/নতুন ফাইলের পূর্ণ তালিকা

**নতুন (৭):** `src/lib/agent/audio/google_tts.ts`, `src/lib/agent/cinematic/narrative.ts`, `tests/regression/t26-google-tts-provider.test.ts`, `tests/regression/t0-google-tts-cache-routing.test.ts`, `docs/audit/latest-fix/*` (রিপোর্টসমূহ + evidence/)।
**পরিবর্তিত (১৫):** `audio/language_controller.ts`, `audio/edge_tts.ts`, `audio/music_engine.ts`, `tts-cache.ts`, `production/pipelines/audio.ts`, `production/pipelines/short_film.ts`, `cinematic/preview.ts`, `video/lip_sync_module.ts`, `agent/capabilities.ts`, `agent/config-panel.ts`, `agent/prompts.ts`, `agent/tools/audio.ts`, `agent/model-registry-data.ts`, `app/api/system/route.ts`, `hooks/use-config-panel.ts`, `components/studio/production-card.tsx`, `components/chat/artifact-view.tsx`, `tests/helpers/test-storage-preload.ts`, `tests/regression/t1,t8,t16,t20,t25`।
