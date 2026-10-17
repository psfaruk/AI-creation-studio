# Lip-Sync Provider Research (Phase 4) — ২০২৬-এর বর্তমান প্রেক্ষাপটে ৪-মাত্রিক ব্লকেজ-পুনঃযাচাই

- **Task ID:** LF-4-R (RESEARCH-ONLY — কোনো source code পরিবর্তন হয়নি, কোনো commit হয়নি)
- **Date:** 2026-10-17 · **Agent:** general-purpose (lip-sync provider research)
- **Baseline:** HEAD `49d9b29`; পূর্ববর্তী মূল্যায়ন — `docs/audit/recovery-phase-1-5/lipsync-capability-audit.md` (4-dimension blockage: license `needs_review` / provider `not_exposed_by_sdk` / hardware `unavailable_hardware` / integration `not_integrated`) + worklog LF-0+LF-1
- **Method:** `z-ai function web_search` (২৩টি কোয়েরি) + **primary-source সরাসরি ফেচ** (GitHub raw README/LICENSE — Wav2Lip, SadTalker, MuseTalk, LivePortrait, LatentSync, InfiniteTalk; Replicate model-page-গুলোর এমবেডেড billing-JSON; fal.ai model-page billing-JSON; sync.so pricing+billing docs; HeyGen help-center pricing; arXiv abstract; DOAJ API; HuggingFace models API; npm registry)। সব দাম/লাইসেন্স-দাবি নিচে প্রতিটি প্রোভাইডারের সাথে evidence URL-সহ; যা যাচাই করা যায়নি তা **UNVERIFIED** লেবেলযুক্ত।
- **Sandbox পরিবেশ (আজ পুনঃনিশ্চিত):** ২ CPU core, ~৪ GB RAM (4041 MB), **GPU নেই** (`/proc/driver/nvidia/version` অনুপস্থিত), কোনো paid API key নেই, outbound internet keyless endpoint-এ কর্মরত।

---

## 1. Wav2Lip (OSS) + Wav2Lip-HQ — পুরনো দাবি **এখনও সঠিক**, সঙ্গে নতুন তথ্য: লেখকদের নিজস্ব commercial API

### 1.1 লাইসেন্স (নন-কমার্শিয়াল দাবি আজও বৈধ — সরাসরি README থেকে যাচাইকৃত)

আজকের `master` README (https://github.com/Rudrabha/Wav2Lip):

- Disclaimer (README §Disclaimer): *"All results from this open-source code or our demo website should only be used for research/academic/personal purposes only. As the models are trained on the LRS2 dataset, any form of commercial use is strictly prohibited."*
- License section: *"This repository can only be used for personal/research/non-commercial purposes. However, for commercial requests, please contact us directly at rudrabha@synclabs.so or prajwal@synclabs.so."*
- **অর্থাৎ recovery-audit-এর "Wav2Lip ওয়েট একাডেমিক-কেবল (LRS2-শর্তযুক্ত), commercial use নিষিদ্ধ" দাবি ২০২৬-এও হুবহু সঠিক — UNCHANGED।**

### 1.2 নতুন তথ্য: README-র একেবারে উপরে এখন "Commercial Version" সেকশন

- README এখন শুরু হয় `# Commercial Version` — *"the commercial version is of a much higher quality than the old open source model"* + "Create your API Key" → লেখকদের (Rudrabha/Prajwal — বর্তমানে **Sync Labs/sync.so**) turn-key hosted API: *"We have a turn-key hosted API with new and improved lip-syncing models here: https://synclabs.so/"*।
- নতুন HD মডেল: *"We have an HD model trained on a dataset allowing commercial usage. The size of the generated face will be 192 x 288"* — অর্থাৎ commercial পথ **আছে, কিন্তু hosted/paid**; OSS সংস্করণ তেমনই নন-কমার্শিয়াল।

### 1.3 Hosted availability

| প্ল্যাটফর্ম | মডেল | দাম | শর্ত |
|---|---|---|---|
| sync.so (Sync Labs, লেখকদেরই কোম্পানি) | lipsync-2 / lipsync-2-pro / lipsync-1.9 / sync-3 | lipsync-2 **$0.05/s**, lipsync-1.9 **$0.025/s**, sync-3 **$0.1334/s** (25 fps, per-frame বিলিং) — pricing পেজ থেকে যাচাইকৃত | API key + account দরকার (নিচে §8.3) |
| Replicate | `sync/lipsync-2` | **$0.05/s** (২০ সেকেন্ড/$1) — model-page billing-JSON থেকে যাচাইকৃত | Replicate token + billing দরকার |
| fal.ai | `fal-ai/sync-lipsync` (wav2lip++) | **$0.70/min** (`"billing_unit":"minutes","price":0.7`, partner API) — model-page JSON থেকে যাচাইকৃত | fal key দরকার |
| Replicate lipsync collection | Wav2Lip নিজে | **তালিকায় নেই** (আজকের https://replicate.com/collections/lipsync — ১৬টি মডেলের মধ্যে Wav2Lip-এর নাম নেই) | — |

### 1.4 Hardware / input constraints / ভাষা

- GPU: Wav2Lip inference-ক্লাস ≈৪ GB VRAM (পূর্ববর্তী audit-এর সংখ্যা; CPU-only চলে কিন্তু প্রতি লাইনে মিনিট-থেকে-কয়েক-মিনিট সময় + ওয়েট নন-কমার্শিয়াল)।
- Input: যেকোনো ভিডিও + যেকোনো ভাষার অডিও (audio-feature-driven, identity-agnostic); মুখ-অঞ্চল 96×96 (নিম্ন রেজোলিউশন — এজন্যই Wav2Lip-HQ জাতীয় এক্সটেনশন)।
- **Wav2Lip-HQ** (https://github.com/Markfryazino/wav2lip-hq) — আনঅফিসিয়াল এক্সটেনশন (GFPGAN/সুপার-রেজোলিউশন); শেষ আপডেট Feb 2023 (স্টেল); Wav2Lip-এর নন-কমার্শিয়াল শর্ত + থার্ড-পার্টি SR-মডেলের নিজস্ব লাইসেন্স উত্তরাধিকারে পায়; কোনো অফিসিয়াল hosted API নেই। (Wav2Lip-HD: https://github.com/saifhassan/Wav2Lip-HD — Real-ESRGAN ভিত্তিক, একই শ্রেণি।)
- Bengali: নিচে §11 — TRAVID (2023) বাংলা-সহ ভারতীয় ভাষায় Wav2Lip-পাইপলাইন ব্যবহার করেছে (প্রত্যক্ষ প্রমাণ); স্বতন্ত্র বাংলা কোয়ালিটি-বেঞ্চমার্ক নেই।

---

## 2. SadTalker — লাইসেন্স-মাত্রায় **পরিবর্তন এসেছে** (Apache 2.0, নন-কমার্শিয়াল শর্ত প্রত্যাহৃত)

আজকের `main` branch (https://github.com/OpenTalker/SadTalker) থেকে সরাসরি যাচাইকৃত:

- README Highlights: *"**The license has been updated to Apache 2.0, and we've removed the non-commercial restriction**"* — অর্থাৎ recovery-audit-এর "SadTalker-এর আলাদা/সংশয়িত লাইসেন্স" ধারণা এখন **পুরনো**; কোড Apache 2.0।
- LICENSE ফাইল: "SadTalker is licensed under the Apache 2.0 License, **except for the third-party components listed below**" (Tencent-কপিরাইট) — https://github.com/OpenTalker/SadTalker/blob/main/LICENSE
- **সতর্কতা (সৎ):** থার্ড-পার্টি বিশ্লেষণ (https://sadtalker.ai/sadtalker-github, https://sync.so/blog/what-is-sadtalker — Jul 2026) বলছে কোড Apache-2.0 হলেও commercial deployment-এ pre-trained checkpoint-এর training-data provenance যাচাই করা উচিত (weights কি সম্পূর্ণ commercial-safe তা official সূত্রে স্পষ্ট নয়) — checkpoint-স্তরের এই সূক্ষ্মতা **UNVERIFIED** রাখা হলো।

**Hosted:** Replicate `cjwbw/sadtalker` ≈**$0.13/run**, `lucataco/sadtalker` ≈$0.13/run (search-snippet + পেজ); fal.ai `fal-ai/sadtalker` (GPU-A100, compute-second বিলিং, পেজে licenseType "commercial")। **GPU:** inference ≈4–8 GB VRAM (audit-সংখ্যা; NVIDIA প্রায় বাধ্যতামূলক)। **Input:** একটি স্থির ছবি + অডিও → talking-head (ভিডিও-টু-ভিডিও লিপ-সিঙ্ক নয় — sync.so ব্লগ: "SadTalker is not a lip sync model for existing video")।

---

## 3. MuseTalk 1.5 — লাইসেন্স-মাত্রায় **সবচেয়ে বড় পরিবর্তন**: কোড MIT + ওয়েট এখন স্পষ্টভাবে commercial-OK

আজকের `main` README (https://github.com/TMElyralab/MuseTalk) সরাসরি যাচাইকৃত:

- Disclaimer/License সেকশন: *"`code`: The code of MuseTalk is released under the **MIT License**. There is no limitation for both academic and commercial usage. `model`: **The trained model are available for any purpose, even commercially.**" (শুধু testdata non-commercial)।
- **MuseTalk 1.5 রিলিজ (2025-03-28):** *"The inference codes, training codes and model weights of MuseTalk 1.5 are all available now!"* — দ্বি-স্তর প্রশিক্ষণ + sync loss; arXiv 2410.10122।
- HuggingFace `TMElyralab/MuseTalk` tag: `license:mit` (HF API যাচাইকৃত)।
- **অর্থাৎ প্রকল্পের `lip_sync_module.ts`-এ candidate হিসেবে থাকা MuseTalk-এর লাইসেন্স-ব্লক এখন আর `needs_review` নয় — commercial ব্যবহার স্পষ্টভাবে অনুমোদিত (code+weights উভয়ই)।** (তবু নীচের hardware/provider ব্লক অক্ষত।)

**Hardware (README থেকে নতুন সূক্য):** real-time 30fps+ on Tesla V100; **ন্যূনতম পরীক্ষিত হার্ডওয়্যার: RTX 3050 Ti Laptop GPU, 4GB VRAM, fp16 — ৮-সেকেন্ড ভিডিওতে ≈৫ মিনিট** — অর্থাৎ GPU লাগবেই (CUDA); ২-CPU sandbox-এ অসম্ভব। **Input:** ভিডিও + অডিও → 256×256 face-region inpainting (resolutions সীমিত; উচ্চতর রেজোলিউশনে GFPGAN-জাতীয় SR মডেল লাগে); ভাষা README-য় উল্লেখ: চীনা/ইংরেজি/জাপানি (audio-driven হওয়ায় তাত্ত্বিকভাবে language-agnostic)।

**Hosted:** fal.ai `fal-ai/musetalk` (GPU-A100, compute-second বিলিং, পেজে "Commercial use permitted" + licenseType "commercial"); Replicate `douwantech/musetalk` ≈**$0.054/run** (model-page: "costs approximately $0.054 ... 18 runs per $1")।

---

## 4. LivePortrait — MIT, কিন্তু এটি মূলত ভিডিও-চালিত portrait-animation (অডিও-চালিত লিপ-সিঙ্ক নয়)

- Repo: https://github.com/KwaiVGI/LivePortrait (GitHub এখন `KlingAIResearch/LivePortrait`-এ redirect করে — Kuaishou/Kling রিসার্চ-গ্রুপে স্থানান্তরিত)। **LICENSE = MIT** (raw fetch যাচাইকৃত: "MIT License, Copyright (c) 2024 Kuaishou Visual Generation and Interaction Center")।
- README-এ কোনো commercial-নিষেধ পাওয়া যায়নি; শুধু deepfake-ঝুঁকি নিয়ে ethics-disclaimer।
- **মডেলের প্রকৃতি:** চালক-ভিডিওর মোশন দিয়ে portrait animate করে (video-driven reenactment) — অডিও→মুখ সরাসরি নয়; লিপ-সিঙ্ক পাইপলাইনে ব্যবহার করতে হলে অন্য অডিও-টু-মোশন উপাদান লাগে। প্রকল্পের প্রয়োজনের (dialogue-audio → মুখ) সঙ্গে সরাসরি মিলে না।
- Hardware: NVIDIA GPU কেন্দ্রিক (README: "Animals mode is ONLY tested on Linux and Windows with NVIDIA GPU")। বর্তমান hosted availability এই রাউন্ডে পুনঃযাচাই করা হয়নি — **UNVERIFIED** (audit-এর "GPU-oriented" দাবি অক্ষত)।

---

## 5. LatentSync (ByteDance) — Apache-2.0 কোড, OpenRAIL++ ওয়েট, ৮–১৮ GB VRAM

- Repo: https://github.com/bytedance/LatentSync — **LICENSE = Apache 2.0** (raw fetch যাচাইকৃত)।
- সংস্করণ: 1.5 (2025-03-14) ও **1.6 (2025-06-11, 512×512, ব্লার-সমস্যা সমাধান)** — README changelog।
- **VRAM (README সরাসরি):** *"Minimum VRAM for inference: **8 GB** with LatentSync 1.5; **18 GB** with LatentSync 1.6"*; training-এ 20–55 GB। HuggingFace: `ByteDance/LatentSync-1.6` — tag **`license:openrail++`** (HF API যাচাইকৃত; weights-এ use-restriction শর্তযুক্ত লাইসেন্স, commercial সাধারণভাবে অনুমোদিত কিন্তু use-restrictions মানতে হয়), downloads ≈২২৩ হাজার।
- **ভাষা-প্রসঙ্গ:** 1.5-এর changelog বলছে *"improves performance on **Chinese** videos"* — বহুভাষিক উন্নতিতে ByteDance-এর নজর আছে; বাংলা উল্লেখ নেই।
- **Hosted:** Replicate `bytedance/latentsync` ≈**$0.10/run** (পেজ: "costs approximately $0.10 ... 10 runs per $1", Nvidia L40S, **177.4K runs** — model-page যাচাইকৃত: https://replicate.com/bytedance/latentsync)। arXiv পেপার: https://arxiv.org/html/2412.09262v1।

---

## 6. নতুন open-source লিপ-সিঙ্ক/টকিং-হেড সমাধান (2025–2026) — এই রাউন্ডে চিহ্নিত

| মডেল | কী | লাইসেন্স (যাচাইকৃত উৎস) | Hardware | Hosted |
|---|---|---|---|---|
| **Wan 2.2 S2V** (Alibaba) — `Wan-AI/Wan2.2-S2V-14B` | speech/audio → টকিং-পোর্ট্রেট ভিডিও | **Apache-2.0** (HF API tag যাচাইকৃত) | 14B — ভারী; Wan2.2 রিপো: 14B পূর্ণ-কোয়ালিটি ৮০ GB-ক্লাস VRAM; কমিউনিটি ৪৮০p ~6–8 GB consumer GPU-তে ১০–১৫ মিনিট/ক্লিপ | Replicate `wan-video/wan-2.2-s2v` **$0.02/s** (model-page billing-JSON যাচাইকৃত) |
| **InfiniteTalk** (MeiGen-AI) — https://github.com/MeiGen-AI/InfiniteTalk | অডিও-চালিত unlimited-length টকিং ভিডিও + full-body dubbing | README: *"The models in this repository are licensed under the Apache 2.0 License"* (+generated content-এ অধিকার নেই) | Wan-ভিত্তিক; "very low VRAM" মোড আছে (`--num_persistent_param_in_dit 0`); কমিউনিটি ওয়ার্কফ্লো ~16 GB VRAM | RunAPI/ComfyUI-স্মৃতির hosted উল্লেখ; মূল পথ self-host (GPU) |
| **LTX-2.3 LipDub / DubIt** (Lightricks) — `Lightricks/LTX-2.3-22b-IC-LoRA-DubIt` | বিদ্যমান ফুটেজে lip-dubbing (IC-LoRA, 22B) | HF tag **`license:other`** (কাস্টম open-weights লাইসেন্স — সুনির্দিষ্ট শর্ত এই রাউন্ডে পড়া হয়নি — **UNVERIFIED**) | 22B — ভারী GPU | ltx.io (https://ltx.io/blog/lipsync-vs-lipdub, May 2026); fal/Replicate ইকোসিস্টেম |
| **OmniHuman-1 / 1.5** (ByteDance) | ছবি+অডিও → পূর্ণ-দেহীয় মানব-অ্যানিমেশন | HF রিপো **gated** (লগইন+শর্ত-গ্রহণ ছাড়া ওয়েট নামানো যায় না — API-তে "Invalid username or password" প্রত্যয়িত) | ভারী | Replicate `bytedance/omni-human` **$0.14/s** (model-page billing-JSON যাচাইকৃত) |
| **MultiTalk, video-retalking, Kling Lip Sync, fabric (VEED)** | বিবিধ | — | — | Replicate lipsync collection-এ উপস্থিত (https://replicate.com/collections/lipsync); Kling `kwaivgi/kling-lip-sync` **$0.014/s** |

**নোট:** এই নতুন মডেলগুলোর কোনোটিই "GPU-বিহীন CPU-তে চলে" দাবি করে না — সবই CUDA-GPU প্রত্যাশা করে।

---

## 7. Speech (কথা) বনাম Singing (গান) — পৃথক বেঞ্চমার্ক-প্রমাণ

- **Hi-Singers** (arXiv 2609.22264, Sep 2026 — https://arxiv.org/html/2609.22264v1): *"the first large-scale, high-quality, in-the-wild video dataset specifically tailored for **singing head synthesis**"* — ২৯,৬০৮ ক্লিপ / ≈১৭০ ঘণ্টা + নিবেদিত evaluation benchmark। Abstract স্পষ্ট বলছে: speech-dataset-এ প্রশিক্ষিত বর্তমান মডেলগুলো গানে **"rhythmic drift" ও constrained dynamics**-এ ভোগে — অর্থাৎ **কথা-বনাম-গানের domain-gap এখন ডকুমেন্টেড সত্য; গানের জন্য আলাদা মডেল/ডেটাসেট লাগে।**
- কমিউনিটি blind-test (r/StableDiffusion): *"The usual audio-driven tools do OK on speech but fall apart on singing. Mouths lag, or gape into an 'O' on every vowel"* — https://www.reddit.com/r/StableDiffusion/comments/1x6363f/
- তুলনা-সাইট rfab.ai-র লিপ-সিঙ্ক তুলনায় আলাদা "one singer" টেস্ট-কেস আছে (https://rfab.ai/compare/lip-sync, Oct 2026)।
- **Hedra Character-3** বাজারজাত করা হয় গান-পারফরম্যান্স ভিডিওর জন্য (third-party রিভিউ: https://digitalagencynetwork.com/best-ai-tools-for-songs-and-lip-sync-performance-videos) — কিন্তু বাংলা গানে এর কোনো প্রমাণ পাওয়া যায়নি।
- **প্রকল্প-প্রাসঙ্গিক সিদ্ধান্ত:** কথার লিপ-সিঙ্ক ও গানের লিপ-সিঙ্ক আলাদা সমস্যা — `LIP_SYNC_STATUS.talkingStatus` / `singingStatus` পৃথক রাখার বিদ্যমান নকশা-সিদ্ধান্ত বর্তমান গবেষণায়ও সমর্থিত।

---

## 8. Commercial / hosted API — দাম, free tier, এবং এই sandbox-এ সম্ভাবনা

### 8.1 Replicate (মডেল-হোস্টিং প্ল্যাটফর্ম)

- যাচাইকৃত দাম (model-page billing-JSON থেকে, per second of output video): `kwaivgi/kling-lip-sync` **$0.014/s** · `wan-video/wan-2.2-s2v` **$0.02/s** · `heygen/lipsync-speed` **$0.0333/s** · `sync/lipsync-2` **$0.05/s** · `heygen/lipsync-precision` **$0.0667/s** · `bytedance/omni-human` **$0.14/s**; per-run: `douwantech/musetalk` ≈$0.054, `bytedance/latentsync` ≈$0.10, `cjwbw/sadtalker` ≈$0.13।
- **Credentials:** API token + billing (পে-অ্যাজ-ইউ-গো) **বাধ্যতামূলক** → *requires credentials — BLOCKED in current environment*। (তৃতীয়-পক্ষ সূত্রে নতুন অ্যাকাউন্টে কিছু ফ্রি ক্রেডিটের কথা বলা হলেও অ্যাকাউন্ট-সৃষ্টি ছাড়া কিছুই পাওয়া যায় না — https://replicate.com/pricing)

### 8.2 fal.ai

- `fal-ai/sync-lipsync` **$0.70/min** (partner API); `fal-ai/musetalk`, `fal-ai/sadtalker` GPU-A100 compute-second বিলিং (পেজ-JSON যাচাইকৃত)।
- **Credentials:** signup-এ trial credit (তৃতীয়-পক্ষ সূত্রে $১০–২০, মেয়াদ ১ সপ্তাহ–১ বছর — fal FAQ: https://fal.ai/docs/documentation/model-apis/faq), স্থায়ী free tier নেই; API key বাধ্যতামূলক → *BLOCKED*।

### 8.3 Sync Labs / sync.so (Wav2Lip-লেখকদের কোম্পানি — API `https://api.sync.so/v2`)

- **Free tier (billing docs থেকে যাচাইকৃত, https://sync.so/docs/product/billing):** *"Every free account gets **3 free generations per month** (including lipsync-2 pro) plus 10 combined text-to-speech and dubbing generations, with up to 3 of those 10 used for dubbing and a maximum duration of 20 seconds"* — অর্থাৎ সত্যিকারের ফ্রি কোটা **আছে**, কিন্তু free **account + API key** লাগবেই।
- Paid: Hobbyist $5/mo + $0.05/s … Scale $249/mo + $0.04/s; মডেলভেদে lipsync-2 $0.05/s, lipsync-1.9 $0.025/s, sync-3 $0.1334/s, dubbing $0.10/s(audio) (pricing পেজ যাচাইকৃত: https://sync.so/pricing)।
- **এই sandbox-এ:** account খোলা সম্ভব নয় → *requires credentials — BLOCKED*।

### 8.4 HeyGen (avatar/lipsync প্ল্যাটফর্ম + API)

- অফিসিয়াল help-center (Oct 2026, যাচাইকৃত — https://help.heygen.com/en/articles/10060327-heygen-api-pricing-explained): API এখন pay-as-you-go; **"HeyGen does not offer free API credits starting Feb 2026"**; Video Translation: Speed—LipSync **$0.81/min**, Precision—LipSync **$1.50/min**; Photo/Studio Avatar $0.99/min, Digital Twin $0.60/min।
- Studio-র Free plan: মাসে ৩টি ভিডিও (API নয়) — https://www.heygen.com/pricing; developer portal: https://developers.heygen.com ("Start free, scale on pay-as-you-go from $5")।
- **Credentials বাধ্যতামূলক → BLOCKED।**

### 8.5 D-ID

- API pricing পেজ (https://www.d-id.com/pricing/api — JS-rendered, ইনডেক্সস্নিপেট): **14-day trial** ক্রেডিট-ক্যাপে "up to 3 min video / 10 min streaming"; তারপর paid (third-party: Lite ~$5.90/mo, API ~$29/mo·20min-ক্লাস — https://www.argil.ai/blog/d-id-pricing-5be73, Apr 2026)।
- **Credentials বাধ্যতামূলক → BLOCKED।**

### 8.6 Hedra

- Developer platform আছে (https://www.hedra.com/develop/models/video); Character-3 API দাম (third-party, Jul 2025: https://magichour.ai/blog/guide-to-hedra-ai): 540p **$0.025/s**, 720p **$0.05/s**, 1080p **$0.0625/s**; Studio-র free plan 400 ক্রেডিট ≈ ২ মিনিট 720p ভিডিও (https://wavespeed.ai/blog/posts/wavespeedai-vs-hedra-comparison, Dec 2025)। অফিসিয়াল pricing পেজ JS-rendered — সংখ্যাগুলোর অফিসিয়াল-নিশ্চয়তা **UNVERIFIED**।
- **Credentials বাধ্যতামূলক → BLOCKED।**

### 8.7 অন্যান্য (ElevenLabs Lip Sync — "Video generation requires a paid plan", তাদের নিজ FAQ: https://elevenlabs.io/lip-sync; magichour.ai — signup-ফ্রি-ক্রেডিট no-credit-card: https://magichour.ai/api/lip-sync; labs.everypixel.com — ট্রায়াল-পরে $1/60s: https://labs.everypixel.com/lipsync; kie.ai marketplace) — **সবই account+key দাবি করে → BLOCKED**।

### 8.8 "Sana GeniusRP"

- এই নামে কোনো ফলাফল পাওয়া যায়নি (web_search: "No search results available") — **UNVERIFIED / খুঁজে পাওয়া যায়নি**; সম্ভবত ভুল নাম বা অতি-নত পণ্য। কোনো দাবি করা হলো না।

---

## 9. Keyless-ফ্রি পথ কি আছে? (একমাত্র তাত্ত্বিক ব্যতিক্রম — production-অযোগ্য)

- **HuggingFace Spaces (ZeroGPU):** HF-ডকুমেন্ট অনুযায়ী (https://huggingface.co/docs/hub/en/spaces-api-endpoints) unauthenticated দৈনিক GPU-quota **২ মিনিট**, free account-এ ৫ মিনিট, Pro-তে বেশি — অর্থাৎ তাত্ত্বিকভাবে `gradio_client` দিয়ে keyless লিপ-সিঙ্ক Space ডাকা সম্ভব। **কিন্তু:** (১) কোটা অতি-ক্ষুদ্র ও শেয়ার্ড, (২) অনেক Space এখন token দাবি করে/API বন্ধ রাখে, (৩) কোনো SLA নেই, (৪) উৎপাদন-পাইপলাইনে অনির্ভরযোগ্য — **কোনো নির্ভরযোগ্য keyless lip-sync endpoint এই রিসার্চে পাওয়া যায়নি।** Google-Translate-TTS-এর মতো "ওপেন-ফ্রি-endpoint" লিপ-সিঙ্ক জগতে **বিদ্যমান নয়**।

---

## 10. z-ai SDK পুনঃযাচাই (provider মাত্রা) — v0.0.18 এখনও latest, অডিও-কন্ডিশনিং এখনও নেই

- `npm view z-ai-web-dev-sdk version` → **0.0.18**; প্রজেক্টে ইনস্টলডও 0.0.18 — নতুন সংস্করণ বের হয়নি।
- `node_modules/z-ai-web-dev-sdk/dist/index.d.ts` পুনঃপরীক্ষিত: `CreateVideoGenerationBody` = `{model, prompt, image_url, quality, with_audio, watermark_enabled, size, fps, duration, request_id, user_id}` — **কোনো অডিও-ইনপুট ফিল্ড নেই**; পুরো `.d.ts`-এ `lip|viseme|talking|avatar|reenact|audio_url` → **০ ম্যাচ**।
- **অর্থাৎ "provider: not_exposed_by_sdk" মাত্রা ২০২৬-১০-১৭-এও হুবহু সঠিক — UNCHANGED।**

---

## 11. বাংলা কথা / বাংলা গানে লিপ-সিঙ্ক — প্রমাণ-ভাণ্ডাল

| প্রশ্ন | প্রমাণ | রায় |
|---|---|---|
| বাংলা **কথায়** লিপ-সিঙ্ক হয়েছে কি? | **TRAVID** (arXiv 2309.11338, 2023 — https://arxiv.org/abs/2309.11338): English→**Bengali**, Hindi, Nepali, Telugu end-to-end lip-synced ভিডিও-অনুবাদ (শিক্ষামূলক লেকচার, low-resource সেটিং) — Wav2Lip-শ্রেণির পাইপলাইন বাংলাকে টার্গেট-ভাষা হিসেবে ব্যবহার করেছে | **পরোক্ষ-হ্যাঁ** (কোনো মান-স্কোর নেই) |
| Indian-language ডাবিং-এ প্রকাশিত বেঞ্চমার্ক? | **IEEE Access 2025** (DOI 10.1109/ACCESS.2025.3562883, DOAJ API যাচাইকৃত) "Wav2Lip Bridges Communication Gap…Indian Languages" — পরীক্ষিত ভাষা: **Tamil, Telugu, Hindi, English (বাংলা নয়)**; ASR-তুলনা Wav2vec2 vs Google SR | হিন্দি/তামিল/তেলুগুতে ইতিবাচক; **বাংলা পরীক্ষিত নয়** |
| মডেলগুলো ভাষা-নিরপেক্ষ তো? | Wav2Lip/MuseTalk/LatentSync সবই audio-feature-driven (Mel/SyncNet/Whisper-embedding) — তাত্ত্বিকভাবে ভাষা-অজ্ঞেয়বাদী; MuseTalk README চীনা/ইংরেজি/জাপানি, LatentSync 1.5 চীনা-উন্নতি উল্লেখ করে; কোনোটিতেই বাংলা নথিভুক্ত নয় | তাত্ত্বিক-হ্যাঁ, নথিভুক্ত-না |
| **বাংলা গানে** লিপ-সিঙ্ক? | কোনো প্রমাণ পাওয়ে যায়নি (Hi-Singers ডেটাসেট ইংরেজি/চীনা-প্রধান in-the-wild; কোনো বাংলা-গান লিপ-সিঙ্ক গবেষণা/বেঞ্চমার্ক নেই) | **শূন্য প্রমাণ — UNVERIFIED, ধরে নেওয়া যাবে না** |

---

## 12. সারসংক্ষেপ-ম্যাট্রিক্স (২০২৬-১০-১৭ যাচাইকৃত তথ্য)

| প্রোভাইডার/মডেল | লাইসেন্স (commercial) | Hosted API + দাম | GPU/VRAM (self-host) | Input সীমা | কথা/গান | বাংলা | এই sandbox-এ |
|---|---|---|---|---|---|---|---|
| Wav2Lip (OSS) | ❌ **নন-কমার্শিয়াল (আজও সঠিক)**; commercial=লেখকদের hosted API | sync.so $0.025–0.1334/s; fal $0.70/min; Replicate-তে নেই | ≈4 GB VRAM; CPU-only অতি-ধীর | 96×96 মুখ; যেকোনো ভিডিও+অডিও | কথা-প্রধান; গানে দুর্বল (কমিউনিটি) | TRAVID-পরোক্ষ | ❌ ওয়েট-লাইসেন্স + GPU + credentials |
| Wav2Lip-HQ/HD (আনঅফিসিয়াল) | ❌ উত্তরাধিকার-নন-কমার্শিয়াল + SR-মডেল শর্ত; Feb 2023 স্টেল | কোনো অফিসিয়াল নেই | GPU দরকার | Wav2Lip-ই; শুধু রেজোলিউশন-উন্নত | কথা | UNVERIFIED | ❌ |
| SadTalker | ✅ **Apache 2.0 (শর্ত-প্রত্যাহার — পরিবর্তন)**; checkpoint-provenance সতর্কতা | Replicate ≈$0.13/run; fal A100 | ≈4–8 GB VRAM | **ছবি**+অডিও → talking-head (ভিডিও-ইনপুট নয়) | কথা | UNVERIFIED | ❌ GPU + credentials |
| MuseTalk 1.5 | ✅ **MIT কোড + ওয়েট "any purpose, even commercially" — পরিবর্তন** | fal (A100, "Commercial use permitted"); Replicate ≈$0.054/run | min পরীক্ষিত: 4 GB VRAM GPU (fp16; ৮সে≈৫মি); RT 30fps+ @V100 | ভিডিও+অডিও; 256×256 face-region | কথা (RT-ঝোঁক) | README: zh/en/ja | ❌ GPU (CUDA নেই) + credentials |
| LivePortrait | ✅ MIT | বর্তমান hosted UNVERIFIED | NVIDIA GPU-কেন্দ্রিক | ভিডিও-চালিত reenactment (অডিও→মুখ নয়) | n/a (অডিও-চালিত নয়) | n/a | ❌ প্রকৃতি-ই বেমানান |
| LatentSync 1.5/1.6 | ✅ কোড Apache-2.0; ওয়েট **OpenRAIL++** (use-restriction সহ commercial) | Replicate ≈$0.10/run (177K runs) | **8 GB (v1.5) / 18 GB (v1.6) VRAM** | ভিডিও+অডিও; v1.6 512×512; চীনা-উন্নতি নথিভুক্ত | কথা-প্রধান | UNVERIFIED | ❌ GPU + credentials |
| Wan 2.2 S2V-14B | ✅ Apache-2.0 (HF) | Replicate $0.02/s | 14B — ভারী (৮০ GB-ক্লাস পূর্ণ; কম-VRAM মোডে ধীর) | পোর্ট্রেট-ছবি+স্পিচ → ভিডিও | কথা | UNVERIFIED | ❌ GPU + credentials |
| InfiniteTalk | ✅ Apache-2.0 (মডেলসহ) | মূলত self-host/ComfyUI | Wan-ভিত্তিক; low-VRAM মোড আছে, GPU লাগে | ছবি/ভিডিও+অডিও; unlimited-length | কথা + dubbing | UNVERIFIED | ❌ GPU |
| LTX-2.3 DubIt | ⚠️ `license:other` — UNVERIFIED শর্ত | ltx.io/fal/Replicate | 22B — ভারী | বিদ্যমান ফুটেজে dub | কথা/dub | UNVERIFIED | ❌ GPU + credentials |
| OmniHuman (ByteDance) | ⚠️ HF-রিপো gated (শর্ত-গ্রহণ লাগে) | Replicate $0.14/s | ভারী | ছবি+অডিও→পূর্ণ-দেহ | কথা (গান-দাবি UNVERIFIED) | UNVERIFIED | ❌ gated + GPU + credentials |
| **D-ID** | commercial | 14-day trial; paid | SaaS | ছবি/অ্যাভাটার+অডিও | কথা | UNVERIFIED | ❌ credentials — BLOCKED |
| **HeyGen API** | commercial | **Feb 2026 থেকে ফ্রি API ক্রেডিট নেই**; Speed-LipSync $0.81/min, Precision $1.50/min; Replicate-তে $0.0333–0.0667/s | SaaS | ভিডিও/ছবি+অডিও | কথা/দাবিং | UNVERIFIED | ❌ credentials — BLOCKED |
| **sync.so (Sync Labs)** | commercial | **ফ্রি: ৩ জেনারেশন/মাস (account লাগবে)**; $0.025–0.1334/s | SaaS | ভিডিও/ছবি+অডিও; ফ্রি টায়ারে ২০সে-সীমা | কথা | UNVERIFIED | ❌ credentials — BLOCKED |
| **Hedra** | commercial | Character-3 API ≈$0.025–0.0625/s (third-party); Studio-ফ্রি 400 ক্রেডিট≈২মি | SaaS | ছবি+অডিও (গান-মার্কেটিং) | কথা+গান-ঝোঁক | UNVERIFIED | ❌ credentials — BLOCKED |
| **ElevenLabs Lip Sync** | commercial | "Video generation requires a paid plan" | SaaS | ছবি+অডিও, 480p/720p | কথা | UNVERIFIED | ❌ credentials — BLOCKED |
| Sana GeniusRP | — | **খুঁজে পাওয়া যায়নি** | — | — | — | — | UNVERIFIED |

---

## 13. চূড়ান্ত সৎ রায় — ৪-মাত্রিক ব্লকেজ আজও বৈধ কি?

> **মূল প্রশ্ন: এই sandbox-এ paid credential ছাড়া এবং GPU ছাড়া কি প্রকৃত লিপ-সিঙ্ক চালানো সম্ভব? — উত্তর: না (NO)। সামগ্রিক BLOCKED অবস্থা অক্ষত। তবে মাত্রা-ভেদে দুইটি গুরুত্বপূর্ণ স্পষ্টীকরণ এসেছে।**

### মাত্রা ১ — License (`needs_review`) → **আংশিক পরিবর্তন (আর প্রধান ব্লক নয়, তবে Wav2Lip-দাবি অক্ষত)**

- **Wav2Lip-এর একাডেমিক-কেবল/নন-কমার্শিয়াল দাবি ২০২৬-এও ১০০% সঠিক** (README সরাসরি পুনঃযাচাইকৃত) — পুরনো audit-এর এই বাক্যটি অক্ষত থাকবে।
- **কিন্তু** MuseTalk (MIT কোড + ওয়েট "any purpose, even commercially"), SadTalker (Apache 2.0, নন-কমার্শিয়াল শর্ত প্রত্যাহৃত), LatentSync (Apache-2.0 কোড + OpenRAIL++ ওয়েট), Wan 2.2 S2V (Apache-2.0), InfiniteTalk (Apache-2.0) — অর্থাৎ প্রার্থী-মডেলের বড় অংশের লাইসেন্স এখন commercial-clear। `license: 'needs_review'` লেবেল পুরো-শ্রেণির জন্য এখন **অতি-রক্ষণশীল/পুরনো**; মডেল-নির্দিষ্ট হলে MuseTalk/LatentSync-এর জন্য resolve করা যেত। (checkpoint-provenance সূক্ষ্মতা SadTalker-এ রয়ে গেছে — UNVERIFIED নয়, সতর্কতা-নোট।)

### মাত্রা ২ — Provider (`not_exposed_by_sdk`) → **এখনও বৈধ (UNCHANGED)**

- z-ai-web-dev-sdk **0.0.18-ই এখনো latest** (npm যাচাইকৃত); ভিডিও-জেনারেশন বডিতে অডিও-ইনপুট নেই — `not_exposed_by_sdk` হুবহু সঠিক।
- বাইরের জগতে hosted API-র **ঘাটতি নেই** (Replicate/fal/sync.so/HeyGen/Hedra — $0.014/s থেকে $1.50/min), এমনকি সত্যিকারের ফ্রি কোটাও আছে (sync.so ৩ জেনারেশন/মাস); **কিন্তু প্রতিটি পথে account+API key বাধ্যতামূলক** → এই পরিবেশে *requires credentials — BLOCKED*। একমাত্র keyless তাত্ত্বিক পথ HF ZeroGPU-র anonymous ২ মিনিট/দিন কোটা — অনির্ভরযোগ্য, production-অযোগ্য (§9)। অর্থাৎ ব্লকেজের **কারণটি** এখন "লিপ-সিঙ্ক API বলে কিছু নেই" নয়, বরং "প্রতিটি বিদ্যমান API-তে credential লাগে" — ফলাফল (BLOCKED) অভিন্ন।

### মাত্রা ৩ — Hardware (`unavailable_hardware`) → **এখনও বৈধ (UNCHANGED), সংখ্যা আরও দৃঢ়**

- প্রতিটি বর্তমান মডেল CUDA-GPU প্রত্যাশা করে: MuseTalk-এর নথিভুক্ত ন্যূনতম = **4 GB VRAM সহ GPU** (RTX 3050 Ti, fp16); LatentSync ৮–১৮ GB; SadTalker ≈৪–৮ GB; Wan-S2V/LTX-22B অনেক বেশি। এই sandbox: ২ CPU / ~৪ GB RAM / **GPU-বিহীন** (NVIDIA driver অনুপস্থিত প্রত্যয়িত) — কোনোটিরই স্ব-হোস্টিং সম্ভব নয়। CPU-only Wav2Lip তাত্ত্বিকভাবে সম্ভব কিন্তু অতি-ধীর **এবং তার ওয়েট নন-কমার্শিয়াল** — দ্বৈত-ব্লকড।

### মাত্রা ৪ — Integration (`not_integrated`) → **এখনও বৈধ (UNCHANGED)**

- কোনো adapter/endpoint যুক্ত হয়নি; `src/lib/agent/video/lip_sync_module.ts` আজও `available:false` + ৪-মাত্রিক ঘোষণা + সর্বদা-থ্রোইং gate (আজ পুনঃপঠিত); registry-তে `wav2lip-sadtalker` এন্ট্রি এখনও "planned/যাচাই বাকি"; কোনো hosted provider ব্যবহারকারীর পক্ষ থেকে অনুমোদিত হয়নি — `LIVE PROVIDER NOT AUTHORIZED` অবস্থা অক্ষত।

### ভবিষ্যতের বাস্তব পথ (পরিবর্তিত বাস্তবতা-সহ, সিদ্ধান্ত নয়)

লাইসেন্স-ব্লক মূলত দূর হয়েছে (MuseTalk/LatentSync শ্রেণিতে); বাস্তব পথ এখন **ব্যবহারকারীর অনুমোদনে একটি hosted provider + API key + ছোট বাজেট** (যেমন sync.so-র ফ্রি ৩-জেনারেশন/মাস ট্রায়াল-হিসেবে, বা Replicate-র per-run মডেল), যা recovery-audit §6-এর LipSyncJob/adapter-চুক্তিতে সরাসরি বসে যায়। বাংলা কথায় প্রথম পরীক্ষা করা উচিত (TRAVID-পূর্বসূরি আছে), বাংলা **গানের** জন্য কোনো প্রমাণ-ভিত্তি নেই — আলাদা বেঞ্চমার্ক-ছাড়া `singingStatus` দাবি কখনোই করা যাবে না।

---

*Research-only task: কোনো source/test পরিবর্তন হয়নি; কোনো commit/push হয়নি; `lip_sync_module.ts` অপরিবর্তিত যাচাইকৃত। সব তৃতীয়-পক্ষ দাম/দাবি উৎস-লেবেলযুক্ত; যাচাই-বহির্ভূত সবকিছু UNVERIFIED।*
