# AI Creative Studio

An **Agentic AI Creative Studio** — a local-first, hardware-adaptive content creation platform built with Next.js 16. It generates music, sound design, voice (Bangla/English TTS), images, and real AI videos (CogVideoX-3 cloud), then assembles them into productions (music videos / short films).

## ✨ Key Features

| Capability | Provider | Notes |
|---|---|---|
| 🎬 AI Video | CogVideoX-3 (cloud) | Real MP4 output, E2E verified |
| 🎵 Music Generation | Procedural (local) | Multi-genre, deterministic seeds |
| 🎚️ Sound Design | Local (A1–A5 presets) | Stems, mixing, mastering |
| 🗣️ TTS | Edge Neural + Cloud | Bangla (bn-BD) + English voices |
| 🖼️ Image Generation | Cloud (z-ai-web-dev-sdk) | Posters, stills, concept art |
| 🧠 LLM Chat / Agent | Cloud LLM | Creative direction, orchestration |
| 🎞️ Production Assembly | Local (ffmpeg) | Music videos, short films |

## 🏗️ Architecture

- **Local-First Hardware Adaptation** — designed for 2 CPU / ~4GB RAM / no-GPU machines. A hardware-aware Model Manager picks the best available provider per task and falls back gracefully.
- **Capability Router** — routes each creative task (text/music/image/video/voice) to the right provider with 8-field status tracking (`license / provider / integration / runtime / quality / last_tested_at / failure_reason / fallback_mode`).
- **Language Controller** — first-class Bangla + English support across UI, prompts, and TTS.
- **Nine-state Model Manager** — reflects real runtime health (rate limits, fallbacks, outages) in the UI. No fake "success" states.

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York)
- **Database**: Prisma ORM + SQLite
- **Media**: ffmpeg (assembly), z-ai-web-dev-sdk (AI skills, server-side only)
- **State**: Zustand (client) + TanStack Query (server)

## 🚀 Getting Started

**Prerequisites (পূর্বশর্ত):**

- Node.js 20+ অথবা [Bun](https://bun.sh) 1.x
- `ffmpeg` — PATH-এ থাকতে হবে (ভিডিও/অডিও অ্যাসেম্বলি ও লোকাল ফ্রেম-রেন্ডারের জন্য; `ffmpeg -version` দিয়ে যাচাই করুন)

```bash
# 1. Install dependencies (ডিপেন্ডেন্সি ইনস্টল)
bun install          # or: npm install

# 2. Configure environment (এনভায়রনমেন্ট কনফিগ)
cp .env.example .env
# .env-এ DATABASE_URL দেখে নিন — ডিফল্ট file:./db/custom.db (পোর্টেবল রিলেটিভ পাথ)

# 3. Push database schema (SQLite ডেটাবেস তৈরি)
bun run db:push      # prisma db push (npm: npm run db:push)

# 4. Start dev server (ডেভ-সার্ভার চালু)
bun run dev          # http://localhost:3000
```

Production build: `bun run build` → `bun run start` (standalone output; নিচের ডিপ্লয়মেন্ট সেকশন দেখুন)।

## 📁 স্টোরেজ কাঠামো (Storage Layout)

অ্যাপের রানটাইম-ডেটা কোথায় থাকে — `storage/` ও `upload/` সম্পূর্ণ **git-অগ্রাহ্য** (`.gitignore`-এ `/storage/` blanket নিয়ম, security-audit ফিক্স):

```
db/custom.db                 # SQLite ডেটাবেস (Prisma) — কথোপকথন, রান, আর্টিফ্যাক্ট-মেটা (রানটাইম ফাইল)
storage/
  artifacts/                 # জেনারেট করা মিডিয়া (png/mp3/mp4/txt)
  productions/               # প্রোডাকশন-ভিত্তিক ওয়ার্ক-ফাইল (শট, ভয়েস-লাইন, বাইবেল-ইমেজ)
  llm-chat/                  # LLM রেসপন্স-ক্যাশ — TTL ১২ ঘণ্টা (প্রম্পট-টেক্সট থাকে, তাই কমিট-অযোগ্য)
  tts-cache/                 # TTS অডিও-ক্যাশ
  model-verification.json    # চ্যাট-মডেল যাচাই-ফলাফলের ক্যাশ (TTL ৬ ঘণ্টা)
  provider-keys.json         # গোপন — ব্যক্তিগত GLM API-কী (কখনোই কমিট করবেন না)
upload/                      # ইউজার-আপলোড/টুল-জাঞ্জ — একইভাবে git-বহির্ভূত
```

## 🔐 নিরাপত্তা (Security)

- **একক-মালিক মডেল (single-owner):** এই স্টুডিওতে একজনই মালিক। প্রথম চালুর সময় পাসকোড সেট না থাকলে **প্রথম ভিজিটর** UI-তে (SecurityGate ফ্লো) পাসকোড সেট করে মালিক হয়ে যান — এরপর সেটি সার্ভারে হ্যাশ হয়ে জমা থাকে।
- **`STUDIO_OWNER_PASSCODE` (env):** পাবলিক ডিপ্লয়ের আগে `.env`-এ এটি বসিয়ে দিলে প্রথম-ভিজিটর-সেট ফ্লো বাইপাস হয় — সেটিই মালিকের পাসকোড। না দিলে প্রথম ভিজিটরই সেট করবেন (লোকাল ব্যবহারে খালি রাখাই স্বাভাবিক)।
- **API-নিরাপত্তা:** `/api/auth/*` (লগইন/সেশন) ছাড়া **প্রতিটি** `/api/...` রুট **মালিকের সেশন (owner session) ছাড়া প্রত্যাখ্যাত**। (চ্যাট-মডেল হিসেবে শুধু GLM-পরিবার চলে: বিল্ট-ইন Z.ai SDK + নিজের কীতে Z.ai API / BigModel; প্রতিটি এক্সটার্নাল প্রোভাইডারে **ঐচ্ছিক Base URL ওভাররাইড** করা যায় — কী-ডায়ালগে।)
- **নিজস্ব OpenAI-কম্প্যাটিবল API (`/api/v1`, মিনিমাল):** অ্যাপটিকেই বাইরের OpenAI-ক্লায়েন্টের Base URL হিসেবে ব্যবহার করা যায় — `GET /api/v1/models` ও `POST /api/v1/chat/completions` (স্ট্রিমিংসহ) Bearer-কী নিয়ে চলে। কীটি (`amai_sk_…`) কী-ডায়ালগের "অ্যাপের নিজস্ব API" অংশ থেকে তৈরি/ঘোরানো/রিভোক করা যায় (`storage/platform-key.json`, মালিক-সুরক্ষিত)। মালিক-সেশন টোকেনও Bearer-হিসেবে গ্রহণযোগ্য।
- **লক-বাটন:** সাইডবারের লক-বাটন দিয়ে সেশন সঙ্গে সঙ্গে লক করা যায় — শেয়ারড স্ক্রিনে স্টুডিও খোলা রেখে দূরে যাওয়ার সময় কাজে লাগে।
- **গোপন ফাইল:** `storage/provider-keys.json`-এ ব্যক্তিগত GLM API-কী (+ Base URL-ওভাররাইড) এবং `storage/platform-key.json`-এ `/api/v1`-এর `amai_sk_…` কী থাকে — পুরো `storage/` ডিরেক্টরি git-অগ্রাহ্য, তবু ব্যাকআপ/শেয়ারের সময় সাবধান থাকুন। UI-তে কী কখনোই মাস্কড ছাড়া দেখানো হয় না (প্রকাশ-বাটনে মালিক নিজে দেখতে পারেন)।

## 🌍 ডিপ্লয়মেন্ট (Deployment)

- **দীর্ঘস্থায়ী প্রসেস দরকার (persistent Node process):** ফায়ার-অ্যান্ড-ফরগেট এজেন্ট-রান ও লম্বা ভিডিও-জব (মিনিট-পর্যায়ের) ব্যাকগ্রাউন্ডে চলে — তাই **serverless (Vercel/Lambda-স্টাইল) উপযোগী নয়**। VPS/Docker-এ দীর্ঘস্থায়ী Node প্রসেস হিসেবে চালান।
- **পারসিস্টেন্ট ভলিউম আবশ্যক:** SQLite ফাইল (`db/custom.db`) ও `./storage` ডিরেক্টরি **রিডিপ্লয়েও টিকে থাকতে হবে** — এগুলো হারালে কথোপকথন, আর্টিফ্যাক্ট ও প্রোডাকশন সব হারাবেন।
- **সিঙ্গেল-ইনস্ট্যান্স:** প্রোডাকশন-কিউ ও ইভেন্ট-বাস ইন-মেমরি — তাই **একই সময়ে একটিই ইনস্ট্যান্স** চালান। মাল্টি-রেপ্লিকা দরকার হলে আগে বাইরের কিউ (Redis ইত্যাদি) যুক্ত করতে হবে।
- জেনারেট করা সব ফাইল `./storage`-এর নিচে থাকে (নিচের স্টোরেজ-কাঠামো দেখুন) — ভলিউম-ব্যাকআপ ও ক্লিনআপ সেখানেই করুন।

## 📁 Project Structure

```
src/
  app/            # Next.js App Router (studio UI + /api routes)
  components/     # shadcn/ui + studio UI components
  lib/
    agent/        # Agentic pipeline (production, capability routing, TTS, video)
    media/        # ffmpeg helpers
    db.ts         # Prisma client
storage/          # Runtime data (gitignored — see স্টোরেজ কাঠামো above)
prisma/           # DB schema
db/               # SQLite database file (runtime data)
.zscripts/        # Dev-server lifecycle scripts
```

## ⚠️ Honest Status Labels

Every capability reports its **real** status — a button being clickable does not mean the feature is enabled. Features are only marked working after a real output + passing test. Rate limits (HTTP 429) are reported as runtime limits, not broken integrations.

## 📜 License

Personal / non-commercial use. Third-party model licenses apply — items lacking license clarity are flagged `license_review_required`.
