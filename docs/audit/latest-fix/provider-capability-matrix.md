# Provider Capability Matrix — latest-fix (LF)

**Task ID:** LF-PCM · **তারিখ:** ২০২৬-১০-১৭ · **পদ্ধতি:** প্রতিটি "উপলব্ধ" দাবি লাইভ-প্রোব বা প্রমাণ-লিংকসহ; অ-প্রমাণিত = UNVERIFIED; credential/Gate = BLOCKED।
প্রোব-ইভিডেন্স: `docs/audit/latest-fix/evidence/`, গবেষণা-নথি: `singing-provider-research.md`, `lipsync-provider-research.md`।

## ১. কণ্ঠ-জেনারেশন (কথা)

| প্রোভাইডার | ভাষা | এই পরিবেশে বাস্তব অবস্থা | প্রমাণ | ইন্টিগ্রেশন |
|---|---|---|---|---|
| Microsoft Edge-নিউরাল (bn-BD/bn-IN) | bn | ❌ **403-ব্লকড** (নীতি/নেটওয়ার্ক-পাশ) | voice-verification.json: fail 403 | প্রাথমিক-চেইন; ব্যর্থ হলে সৎ-স্কিপ |
| **Google-Translate TTS (tl=bn)** | bn | ✅ **কর্মরত — লাইভ-যাচাইকৃত** (২০২৬-১০-১৭) | baseline §৩.৩ + Test A (প্রকৃত প্রোডাকশন) | LF-0: bn-চেইনের সৎ-ফলব্যাক |
| z-ai TTS (৭ কণ্ঠ) | en ✅ / zh ✅ / bn ❌ | en/zh নিখুঁত রাউন্ড-ট্রিপ; **৭-এর কেউই বাংলা পড়ে না** | লাইভ-ম্যাট্রিক্স §৩.১ | en-ফলব্যাক; bn-চেইনে নিষিদ্ধ |
| Edge-নিউরাল hi/ur/zh | hi/ur/zh | ⚠️ ক্যাটালগ-নথিভুক্ত, এই পরিবেশে **অপরীক্ষিত** (Edge-403-নির্ভর) | profile `environmentVerification: unattempted` | রাউটিং-সমর্থিত |

**সীমা (Google):** অপ্রাতিষ্ঠানিক endpoint (SLA নেই) · একক কণ্ঠ (লিঙ্গ/bn-BD-bn-IN পার্থক্য নেই) · গতি>১ অসমর্থিত · কথা-শুধু (গান নয়) · প্রতি-অংশ ≈১৮০ অক্ষর (চাঙ্কিং-সহ)।

## ২. ASR (ভাষা-যাচাই)

| প্রোভাইডার | ক্ষমতা | প্রমাণ | ব্যবহার |
|---|---|---|---|
| z-ai ASR | en: ✅ নিখুঁত রাউন্ড-ট্রিপ · zh: ✅ · **bn: চীনা-অনুবাদ (script-preserving নয়)** | §৩.১ control + §৩.২ | en-রায়ের ভিত্তি (ASR_VERIFIED); bn-রায়ে ভিত্তি নয় → AUDIO_VALIDATION_ONLY |

## ৩. সংগীত

| ক্ষমতা | ইঞ্জিন | অবস্থা |
|---|---|---|
| speech_tts | উপরের কণ্ঠ-চেইন | ✅ (bn: Google-ফলব্যাকসহ) |
| instrumental_music | প্রসিডিউরাল সংশ্লেষণ v2 [PROCEDURAL_INSTRUMENTAL] | ✅ সৎ-লেবেলসহ (নিউরাল নয়, গাওয়া নয়) |
| sung_vocals / full_song_generation | **কোনো প্রোভাইডার নেই** | ⛔ BLOCKED — LF-2-R: সব ভোকাল-সক্ষম API key+পেমেন্ট; লোকাল মডেল GPU-চাহিত (হালকাতম ACE-Step-ও ≈৪.৭GB ওজন > sandbox RAM); HF Inference-এ lyrics-to-song সেবাই নেই; keyless ACE-Step Space লাইভ-প্রোবে ব্যর্থ। Suno-তে বাংলা গানের কমিউনিটি-প্রমাণ আছে কিন্তু পাবলিক API নেই। |
| vocal_isolation | টুল-রেজিস্ট্রিতে "ভবিষ্যৎ" | ⛔ সৎ-গেটেড |

## ৪. ভিডিও

| প্রোভাইডার | অবস্থা | প্রমাণ |
|---|---|---|
| z-ai video.generations (CogVideoX-3) | ✅ **কর্মরত** (টাস্ক-ভিত্তিক; with_audio-সহ AAC-স্ট্রিম) | Test C+D লাইভ-রান (এই দস্তাবেজের §৬) |
| i2v (ছবি→ভিডিও) | ✅ SDK-পথ (imageUrl) | ai_video.ts + টুল-রেজিস্ট্রি |
| লিপ-সিঙ্ক (কথা/গান) | ⛔ **BLOCKED** — ৪ মাত্রা: license (আংশিক-বদলেছে: MuseTalk 1.5 MIT, SadTalker Apache-2.0, Wav2Lip এখনও একাডেমিক-কেবল), provider (SDK-তে নেই; সব হোস্টেড API key+পেমেন্ট), hardware (GPU নেই — MuseTalk ন্যূনতম ৪GB VRAM), integration (অ্যাডাপ্টার নেই) | lipsync-provider-research.md |

## ৫. ছবি

| প্রোভাইডার | অবস্থা |
|---|---|
| z-ai images.generations (i2i/edit-সহ) | ✅ কর্মরত (স্টোরিবোর্ড/চরিত্র-পোর্ট্রেট/শট-ফলব্যাকে ব্যবহৃত) |
| image search (zai.images.search) | ✅ কর্মরত (প্রোভাইডার-স্বাস্থ্য-রুটে) |

## ৬. LLM / অন্যান্য

| প্রোভাইডার | অবস্থা |
|---|---|
| z-ai chat (LLM) | ✅ কর্মরত (রেট-লিমিট-সমন্বয়ক সহ) |
| ffmpeg/ffprobe | ✅ কর্মরত (সংস্করণ-নথিভুক্ত — মিডিয়া-যাচাইয়ের ভিত্তি) |
| Wikimedia Commons (নমুনা-অডিও) | ⚠️ CDN-স্তরে 429 — স্বাধীন বাংলা-ASR-নমুনার উৎস হিসেবে অনুপলব্ধ |

---

## ক্ষমতা-বিচ্ছেদ (কখনো এক করা যাবে না — §2.1)

`speech_tts` ≠ `instrumental_music` ≠ `sung_vocals` ≠ `full_song_generation` ≠ `vocal_isolation` ≠ `singing_lip_sync` — কোডে প্রতিটি আলাদা লেবেল/গেট; ইনস্ট্রুমেন্টাল আউটপুট প্রতিটি আর্টিফ্যাক্টে `[PROCEDURAL_INSTRUMENTAL]` টোকেনসহ সৎ-লেবেলে (LF-2)।
