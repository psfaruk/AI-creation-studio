# Singing-Provider Research — Phase 2.2 (গাওয়া গান / Sung Vocals)

**Task ID:** LF-2-R · **Date:** 2026-10-17 · **Agent:** general-purpose (research-only)
**Method:** `web-search` (z-ai `web_search` function, ২০+ কোয়েরি) + সরাসরি উৎস-fetch (GitHub raw README, Hugging Face API/model card, arXiv HTML, Gemini docs) + **একটি live probe** (ACE-Step official HF Space-এ anonymous API-call)
**Mandate:** বাস্তব sung-vocals (প্রকৃত গাওয়া গান) generation-সক্ষম প্রোভাইডার খুঁজে বের করা — এই sandbox-এ (no GPU, no paid API keys, 2 CPU cores, 3.9GB RAM, outbound internet OK for free endpoints) কোনোটি কি **keyless/বিনামূল্যে** এখনই integrate করা যায়?

**সততার নিয়ম (audit §1.4-সংগত):** কোনো provider-কে "Bengali singing supported" বলা হয়নি যদি না সরাসরি প্রমাণ থাকে। প্রমাণবিহীন দাবি = **UNVERIFIED**।

---

## 0. পরিবেশ-সীমা (এই রিপোর্টের প্রেক্ষাপট)

| সীমা | মান (যাচাইকৃত `free -h`, `nproc`) | অর্থ |
|---|---|---|
| GPU | **নেই** | সব local music-model infeasible |
| RAM | **3.9 GB** (available ~1.7GB) | এমনকি সবচেয়ে ছোট গানের model-এর weights-ও RAM-এ ধরে না |
| CPU | **2 cores** | CPU-only inference কয়েক ঘণ্টা/গান স্কেলের — ব্যবহারিকভাবে infeasible |
| API keys | **নেই** | সব paid hosted API = BLOCKED |
| Outbound internet | কাজ করে (free endpoints) | keyless free path খোঁজার একমাত্র সুযোগ |

---

## 1. ACE-Step (ACE Studio / GitHub `ace-step`) — ★ সবচেয়ে প্রাসঙ্গিক open-source candidate

**দুই সংস্করণ বর্তমানে আছে:** v1 (2025-05, 3.5B) এবং **ACE-Step 1.5** (2026-01 মুক্তি; 2026-04-এ XL 4B DiT সিরিজ)।

- **Sung vocals?** **হ্যাঁ** — lyrics-to-song মূল ক্ষমতা; complete song with lead vocals, lyrics, hooks (README + fal.ai model page + third-party review সবাই সম্মত)।
- **Instrumental vs vocals:** উভয়ই; instrumental-only mode + LoRA training, cover, repaint, stem separation আছে।
- **Bengali evidence:** ⚠️ **গাওয়ার জন্য UNVERIFIED** —
  - v1: 19 languages, top-10 = en/zh/ru/es/ja/de/fr/pt/it/ko; বাকিগুলো underperform হতে পারে (README, GitHub); Bengali তালিকায় নেই।
  - v1.5: "50+ languages" দাবি (README + arXiv 2602.00744) কিন্তু **paper/README কোথাও Bengali নাম করে না**; training-এ 50% lyrics phonemic representation-এ রূপান্তর — দুর্বল-ভাষার pronunciation ভালো হওয়ার একটি প্রক্রিয়াগত সম্ভাবনা আছে, কিন্তু প্রমাণ নয়।
  - **বিভ্রান্তি-সতর্কতা:** `ACE-Step/acestep-transcriber` model card-এ South Asia-র তালিকায় **Bengali (bn)** আছে — কিন্তু ওটি *audio-transcription/captioning* উপাদান (Qwen2.5-Omni-based), **গায়ক-মডেল নয়**। Transcriber বাংলা চেনে ≠ গান বাংলায় গাইতে পারে।
- **Hardware (local):** README-র সর্বনিম্ন tier = **≤6GB VRAM** (2B turbo + INT8 quantization + full CPU offload, LM নিষ্ক্রিয়); স্বাভাবিক tier 8–24GB; XL ≥12GB। 2B DiT-এর weights ≈**4.7GB** — এই sandbox-এর মোট RAM-ই (3.9GB) ওর নিচে → **local infeasible (প্রমাণিত সংখ্যায়)**। INSTALL guide-এ CPU mode উল্লেখ আছে, কিন্তু 2-core/4GB-তে একটি পূর্ণ গান = ঘণ্টার পর ঘণ্টা — practical নয়।
- **License:** **MIT** (v1.5 README "License & Disclaimer" অংশ; v1-ও পরিচালিত) — commercial use অনুমোদিত।
- **Hosted API:** নিজস্ব কোনো official paid API নেই; third-party hosting আছে — fal.ai `$0.0002/sec` (≈$1/83min), Replicate `lucataco/ace-step` ≈`$0.021/run`, Venice.ai `$0.03/track` থেকে — **সবগুলোতে API key + পেমেন্ট লাগে → BLOCKED in current environment**। `acestep.io`-এর "API + daily credits" বিজ্ঞাপন আছে, কিন্তু এটি unofficial তৃতীয় পক্ষ (official README-তে ভুয়া-ডোমেইন সতর্কতা আছে)।
- **Free official paths:** (ক) `acemusic.ai` — official "100% free" web app, **কিন্তু public API নেই** (browser-only); (খ) **official HF Space demo** `ACE-Step/Ace-Step-v1.5` — RUNNING on `zero-a10g`, anonymous Gradio API খোলা (`/gradio_api/info` → HTTP 200, `/generation_wrapper` endpoint, `simple_vocal_language` parameter)। **Live probe (LF-2-R):** দুইবার anonymous generation-call (custom + simple mode, 49-param payload) — দুটোই **`event: error, data: null`** ফেরত দিল → **keyless generation ব্যবহারিকভাবে BLOCKED** (ZeroGPU anonymous quota/প্রমাণীকরণ)।
- **Evidence:** https://github.com/ace-step/ACE-Step-1.5 · https://github.com/ace-step/ACE-Step · https://arxiv.org/html/2602.00744v1 · https://huggingface.co/ACE-Step/acestep-transcriber · https://fal.ai/models/fal-ai/ace-step/prompt-to-audio · https://replicate.com/lucataco/ace-step · https://venice.ai/models/ace-step-15

## 2. YuE (HKUST / M-A-P, GitHub `multimodal-art-projection/YuE`)

- **Sung vocals?** **হ্যাঁ** — "lyrics2song": complete song with vocal track + accompaniment; YuE2 (2026-09) claims Suno v5/v6-প্রতিদ্বন্দ্বী quality (WildSongBench)।
- **Bengali evidence:** **নেই** — v1 স্পষ্টভাবে English, Mandarin, Cantonese, Japanese, Korean + code-switching (README + project page); কোনো Indic ভাষার দাবি বা উদাহরণ পাওয়া যায়নি। YuE2-তে ভাষা-তালিকা আরও অস্পষ্ট। **Bengali = UNVERIFIED (প্রবণতা: সম্ভব নয়)**।
- **Hardware:** YuE2 = **Linux + Python 3.12 + NVIDIA BF16 GPU + 24GB VRAM** (README Quick start); v1-ও বড় GPU চায়। → **local infeasible**।
- **License:** v1 (2025-01-30 থেকে) = **Apache 2.0 — weights সহ**; **YuE2 = code Apache 2.0, কিন্তু model weights CC BY-NC 4.0 + শর্ত** — academic/non-commercial ফ্রি, **commercial-এ তাদের সাথে যোগাযোগ করে license কিনতে হবে**।
- **Hosted API:** official নেই; free web demo আছে (NOIZ-hosted `yue.noizai.net`, browser-only, API নেই); ComfyUI/agent-skill সবই local-GPU নির্ভর।
- **Evidence:** https://github.com/multimodal-art-projection/YuE · https://map-yue.github.io · https://arxiv.org/html/2503.08638v1 · https://huggingface.co/m-a-p/YuE-s1-7B-anneal-en-icl

## 3. MusicGen (Meta) — ❌ instrumental-only (vocals নয়)

- **Sung vocals?** **না — সরকারি model card-এ লেখা:** "The model is not able to generate realistic vocals"; প্রশিক্ষণ-ডেটা থেকে vocals **সরিয়ে ফেলা হয়েছিল** (HT-Demucs source-separation দিয়ে)। এটি নিজে থেকেই কখনো গাওয়া গান দেবে না।
- **Bengali:** প্রাসঙ্গিক নয় (vocal নেই); এমনকি text-prompt-ও English-কেন্দ্রিক ("will not perform as well in other languages")।
- **License:** code MIT, **weights CC-BY-NC 4.0** (non-commercial)।
- **Hardware:** 300M–3.3B; GPU ছাড়া অত্যন্ত ধীর।
- **ফল:** প্রকল্পের বর্তমান procedural instrumental (honest label) পথের চেয়ে MusicGen কোনো সুবিধা দেয় না — singing-research-এর জন্য **বাতিল**।
- **Evidence:** https://huggingface.co/facebook/musicgen-large (limitations + license sections)

## 4. Suno — vocals: হ্যাঁ; API: ❌ official নেই (partner-only)

- **Sung vocals?** হ্যাঁ — শিল্পসেরা sung-vocals + lyrics (নিজেদের প্রচার + সব তুলনা-নিবন্ধ সম্মত)।
- **Bengali evidence:** পরোক্ষভাবে **হ্যাঁ (গানের প্রমাণ আছে, API প্রমাণ নয়)** — Suno-clone consumer সাইটে ব্যবহারকারীদের তৈরি বাংলা গানের বড় সংগ্রহ: brev.ai-তে "Bengali Music AI tracks" ৩৩টি, musichero.ai-তে ১৯০টি, aimusic.so-তে ৭টি "Bangla Song" ট্র্যাক; Soundverse-এর ব্লগ "How to Create a Bengali Song With AI Music Generation" (2026-02)। অর্থাৎ Suno-শ্রেণির মডেল বাংলা গান গাইতে **পারে** — কিন্তু এগুলো সব **web-UI consumer পণ্য**, আমাদের runtime থেকে access করার বৈধ keyless পথ নেই।
- **API:** **Official public API নেই** — 2026-এর একাধিক উৎস: "Suno doesn't sell a public API" (sunor.cc, 2026-06); partner/enterprise-only program (digitalmusicnews 2026-07; aimusicapi.ai 2026-07: "Suno's is partner-only")। ঘোরানো বাজারে unofficial third-party "Suno API" resellers আছে (sunoapi.org, musicapi.ai, GoAPI, 302.ai…) — **সবগুলো paid + account-credential-নির্ভর + Suno ToS-risk**।
- **Verdict:** **requires credentials/payment — BLOCKED in current environment**।
- **Evidence:** https://suno.com/pricing · https://sunor.cc/blog/suno-api-pricing-2026 · https://www.digitalmusicnews.com/2026/07/03/suno-is-opening-an-api-partner-program · https://brev.ai/tag/bengali-music · https://musichero.ai/tag/Bengali · https://www.soundverse.ai/blog/article/how-to-create-a-bengali-song-with-ai-music-generation

## 5. Udio — vocals: হ্যাঁ; API: ❌ public নেই

- **Sung vocals?** হ্যাঁ (Suno-প্রতিদ্বন্দ্বী; তুলনা-নিবন্ধে "realistic vocals and coherent lyrics" প্রশংসিত)।
- **Bengali evidence:** **UNVERIFIED** — কোনো বাংলা-নির্দিষ্ট উদাহরণ/দলিল পাওয়া যায়নি।
- **API:** **public API নেই** — "As of May 2026 Udio does NOT [have a public API]" (api-evangelist GitHub profile, 2026-10); apiframe/sunor সব তৃতীয় পক্ষের wrapper — paid।
- **Verdict:** **requires credentials/payment — BLOCKED**।
- **Evidence:** https://github.com/api-evangelist/udio · https://www.udio.com · https://aimusicapi.ai/en/blog/ai-music-generation-api-comparison

## 6. Stable Audio (Stability AI)

- **Sung vocals?** **ভাগ করে দেখতে হবে:**
  - **Open weights (Stable Audio Open / Stable Audio 3.0 small+medium): ❌ vocals নেই** — "Stable Audio 3 is a family of open-weight models … for **instrumental music and sound effects** generation" (arXiv 2605.17991); "Does Stable Audio 3.0 generate vocals or lyrics? **No.** … instrumental music and sound effects only" (AVB guide 2026-05)।
  - **Commercial web app/API (Stable Audio 2.x/3.x subscription):** ওয়েব অ্যাপে song-with-vocals বৈশিষ্ট্যের ইঙ্গিত আছে, তবে **UNVERIFIED** (নিশ্চিত ডকুমেন্টে গাওয়ার স্পষ্ট ঘোষণা পাইনি)। API = Stability AI API, প্রতি generation **$0.20** (20 credits × $0.01), **key লাগে**। Web free tier = মাসে ৫০ credits (browser-only)।
- **Bengali:** **UNVERIFIED** (কোনো দাবি/উদাহরণ নেই)।
- **Verdict:** open-weight পথ গানের জন্য অচল (instrumental-only), API পথ **requires credentials — BLOCKED**।
- **Evidence:** https://stability.ai/stable-audio · https://arxiv.org/html/2605.17991v1 · https://aivideobootcamp.com/blog/stable-audio-3-complete-guide-2026 · https://stableaudio.com/pricing · https://www.therundown.ai/tools/stable-audio-2-5

## 7. Hosted API platforms (Replicate / fal.ai / Hugging Face Inference) — lyrics-to-song সাপেক্ষে

- **fal.ai:** ACE-Step serve করে — "For vocal tracks, fal hosts several models that can turn lyrics and style instructions into complete songs" (fal explore page); দাম `$0.0002/sec`। কিন্তু **free credits শুধুমাত্র Sandbox/Playground-এ, "they cannot be used through the API"** (fal docs) → API = পেমেন্ট লাগে। **BLOCKED**।
- **Replicate:** `lucataco/ace-step` ≈`$0.021/run`; সাধারণভাবে API ব্যবহারে billing লাগে। **BLOCKED**।
- **Hugging Face Inference Providers:** free tier = মাসে **$0.10 credit** (klymentiev/metronome 2026) — এবং সবচেয়ে গুরুত্বপূর্ণ: **HF API দিয়ে যাচাই করা হয়েছে — কোনো ACE-Step / DiffRhythm / YuE মডেলই কোনো Inference Provider-এ serve করা হয় না** (`huggingface.co/api/models?search=...` → সবগুলোর `inferenceProviderMapping` = none)। অর্থাৎ **lyrics-to-song এই পথে একেবারেই নেই** — ফ্রি হোক বা টাকায়।
- **অন্যান্য:** Venice.ai ($0.03/track+), aimlapi/302.ai Suno-resellers — সব paid।
- **Evidence:** https://fal.ai/explore/text-to-music-apis · https://fal.ai/docs/documentation/model-apis/sandbox · https://huggingface.co/docs/inference-providers/en/pricing · https://klymentiev.com/blog/huggingface-inference-api · https://huggingface.co/api/models?search=ace-step · https://huggingface.co/api/models?search=diffrhythm

## 8. অন্যান্য প্রাসঙ্গিক candidate (অতিরিক্ত অনুসন্ধান)

- **Google Lyria 3 / 3.5 (Gemini API):** নতুন কিন্তু গুরুত্বপূর্ণ — "structural coherence, including **vocals, timed lyrics**, and full instrumental arrangements" (official docs, 2026-10); models `lyria-3-clip-preview`, `lyria-3.5`; **paid preview** ($0.08/song, OpenRouter; Lyria 2 $0.06/30s); `x-goog-api-key` লাগে → **BLOCKED**। Bengali: **UNVERIFIED**। Evidence: https://ai.google.dev/gemini-api/docs/music-generation · https://blog.google/innovation-and-ai/technology/developers-tools/lyria-3-developers · https://openrouter.ai/google/lyria-3-pro-preview
- **DiffRhythm (ASLP-lab):** open-source full-song (vocals+accompaniment, ~4 min) latent-diffusion; **Apache 2.0 (code+DiT weights)** — license-দিক থেকে সবচেয়ে উদার; কিন্তু **minimum 16GB VRAM fp16** → local infeasible; মূলত en/zh; Bengali **UNVERIFIED**; hosted শুধু consumer সাইট (diffrhythm.com)। Evidence: https://github.com/ASLP-lab/DiffRhythm · https://www.spheron.network/blog/deploy-open-source-ai-music-generation-gpu-cloud-2026
- **কনজিউমার free সাইট (Somio, Singify, aisinging.ai, brev.ai…):** browser-only বিনামূল্যের গান; কোনো public API নেই → integration-অযোগ্য।

---

## 9. বাংলা গাওয়া গান — প্রমাণের সৎ হিসাব

| দাবি | প্রমাণ-স্তর |
|---|---|
| Suno-শ্রেণির বাণিজ্যিক মডেল বাংলা গান গাইতে পারে | ✅ পরোক্ষ প্রমাণ (brev.ai ৩৩টি, musichero ১৯০টি বাংলা AI-ট্র্যাক; Soundverse বাংলা-গান টিউটোরিয়াল) — কিন্তু প্রবেশাধিকার সব **paid/web-only** |
| ACE-Step 1.5 বাংলা গাইতে পারে | ⚠️ **UNVERIFIED** — "50+ languages" দাবি আছে, Bengali নাম-করে নেই; transcriber-এ bn আছে (গায়ক নয়); phonemic-training = সম্ভাবনার ইঙ্গিত, প্রমাণ নয় |
| YuE বাংলা গাইতে পারে | ❌ সম্ভাবনা কম — official তালিকা en/zh/ja/ko; কোনো Indic দাবি নেই |
| MusicGen / Stable Audio Open | ❌ প্রশ্নই আসে না — vocals নেই |
| Google Lyria বাংলা | ⚠️ UNVERIFIED |

---

## 10. Summary Matrix

| Provider | প্রকৃত গাওয়া vocals? | Bengali গান | License (weights) | Local min. | Hosted API (free quota?) | এই sandbox-এ ফলাফল |
|---|---|---|---|---|---|---|
| **ACE-Step v1 / 1.5** | ✅ (lyrics→song) | ⚠️ UNVERIFIED (transcriber-এ bn; singer-এ প্রমাণ নেই) | **MIT** | ≤6GB VRAM (2B+offload); weights ≈4.7GB | fal/Replicate/Venice — সব paid; HF Space demo free কিন্তু anonymous-call **probe-এ ব্যর্থ** | **BLOCKED** (no GPU; free Space keyless নয়) |
| **YuE v1 / YuE2** | ✅ (lyrics2song) | ❌ official তালিকায় নেই | v1 Apache-2.0; **YuE2 CC BY-NC 4.0** (commercial আলাদা license) | **24GB VRAM** (YuE2) | official API নেই; free web demo (API নেই) | **BLOCKED** (hardware) |
| **MusicGen (Meta)** | ❌ instrumental-only (vocals ডেটা থেকে সরানো) | — | CC-BY-NC 4.0 | GPU প্রায়-আবশ্যক | HF-এ আছে (instrumental) | গানের জন্য **প্রযোজ্য নয়** |
| **Suno** | ✅ (best-in-class) | ✅ পরোক্ষ (consumer সাইটে ৩৩–১৯০ বাংলা ট্র্যাক) | proprietary | N/A (cloud) | ❌ official public API নেই (partner-only); resellers paid | **BLOCKED** (credentials/payment) |
| **Udio** | ✅ | ⚠️ UNVERIFIED | proprietary | N/A | ❌ public API নেই | **BLOCKED** |
| **Stable Audio (open)** | ❌ instrumental/SFX only | — | open weights | GPU | — | গানের জন্য **প্রযোজ্য নয়** |
| **Stable Audio (commercial/API)** | ⚠️ web-app vocals UNVERIFIED | ⚠️ UNVERIFIED | proprietary | N/A | $0.20/gen, key লাগে | **BLOCKED** (credentials) |
| **Google Lyria 3/3.5** | ✅ (vocals + timed lyrics, docs-প্রমাণিত) | ⚠️ UNVERIFIED | proprietary | N/A | paid preview ($0.08/song), key লাগে | **BLOCKED** (credentials) |
| **DiffRhythm** | ✅ | ⚠️ UNVERIFIED (মূলত en/zh) | **Apache 2.0** | 16GB VRAM | consumer সাইট ছাড়া নেই | **BLOCKED** (hardware) |
| **HF Inference Providers** | — | — | — | — | free $0.10/মাস; **কোনো lyrics-to-song মডেলই serve হয় না** (API-যাচাইকৃত) | **প্রযোজ্য নয়** |

---

## 11. চূড়ান্ত সৎ রায় (Final Verdict)

**এই sandbox-এ — বিনামূল্যে, key ছাড়া — প্রকৃত গাওয়া গানের (sung vocals) generation এই মুহূর্তে integrate করা সম্ভব নয়। প্রতিটি পথ প্রমাণসহ বন্ধ:**

1. **Local self-hosting:** প্রতিটি vocals-সক্ষম open model GPU চায় — YuE2 24GB VRAM, DiffRhythm 16GB, ACE-Step 1.5 ≤6GB (সর্বনিম্ন) — আর সবচেয়ে ছোটটির weights (≈4.7GB) পর্যন্ত এই sandbox-এর মোট RAM (3.9GB)-এর বাইরে। **সংখ্যাগতভাবেই infeasible।**
2. **Paid hosted APIs:** fal.ai / Replicate / Venice / Stability API / Gemini-Lyria / সব Suno-reseller — প্রতিটিতে API key + পেমেন্ট লাগে → **requires credentials — BLOCKED in current environment**। (fal-এর free credits API-তে খরচ করা যায় না — তাদেরই ডকুমেন্ট অনুযায়ী।)
3. **Official keyless free paths — live-probed:** একমাত্র বাস্তব কন্টেন্ডার ছিল ACE-Step-এর official HF Space (free, RUNNING, anonymous Gradio API খোলা) — **দুটি anonymous generation-call প্রেরণ করা হয়েছে, দুটোই তাৎক্ষণিক `event: error`** → keyless generation কার্যত অবরুদ্ধ। `acemusic.ai` free কিন্তু browser-only (API নেই)।
4. **Bengali গাওয়া:** বাণিজ্যিক প্ল্যাটফর্মে বাংলা AI-গানের বাস্তব প্রমাণ আছে, কিন্তু free/keyless কোনো পথে বাংলা গাওয়ার কোনো যাচাই করা যায়নি — **কোনো "Bengali singing supported" দাবি এখন করা যাবে না।**

**সুপারিশ (audit-সংগত সৎ অবস্থান):**
- প্রকল্পের বর্তমান honest state ঠিক আছে: **instrumental procedural music (লেবেলসহ) + গাওয়া গান = প্রকৃত প্রোভাইডার-অভাবে সৎভাবে BLOCKED**। কোনো ভুল "সংগীত জেনারেট হচ্ছে" প্রতিশ্রুতি যোগ করা উচিত নয়।
- ভবিষ্যতে GPU বা পেইড key এলে **প্রথম পছন্দ ACE-Step 1.5** (MIT license, সর্বনিম্ন VRAM, 50+ ভাষার দাবি, সেরা docs) — এবং তখনও **Bengali singing-এর live verification টেস্ট বাধ্যতামূলক** (গানের অডিও → script-preserving বাংলা ASR-র অভাবে ন্যূনতম মানব-শোনা যাচাই) আগে চালিয়ে তবেই যেকোনো ভাষা-দাবি label করা হবে।
- YuE2 quality-তে এগিয়ে থাকলেও weights-এর **non-commercial license** এবং 24GB VRAM — এই প্রকল্পের জন্য দ্বিতীয় সারির বিকল্প।

---
*Research-only টাস্ক: কোনো source code পরিবর্তন হয়নি; একমাত্র আউটপুট এই রিপোর্ট + worklog এন্ট্রি। সব সিদ্ধান্ত 2026-10-17-এর web-উৎস + live probe-এর ভিত্তিতে।*
