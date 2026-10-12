# AI Creative Studio

An **Agentic AI Creative Studio** — a local-first, hardware-adaptive content creation platform built with Next.js 16. It generates music, sound design, voice (Bangla/English TTS), images, and real AI videos (CogVideoX-3 cloud), then assembles them into productions (music videos / short films).

## ✨ Key Features

| Capability | Provider | Notes |
|---|---|---|
| 🎬 AI Video | CogVideoX-3 (cloud) | Real MP4 output, E2E verified |
| 🎵 Music Generation | Procedural (local) | Multi-genre, deterministic seeds |
| 🎚️ Sound Design | Local (A1–A5 presets) | Stems, mixing, mastering |
| 🗣️ TTS | Cloud TTS | Bangla + English voices |
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

```bash
# 1. Install dependencies
bun install   # or npm install

# 2. Configure environment
cp .env.example .env   # then edit DATABASE_URL if needed

# 3. Push database schema
bun run db:push

# 4. Start dev server
bun run dev            # http://localhost:3000
```

## 📁 Project Structure

```
src/
  app/            # Next.js App Router (single / route)
  components/     # shadcn/ui + studio UI components
  lib/
    agent/        # Agentic pipeline (production, capability routing)
    db.ts         # Prisma client
storage/
  artifacts/      # Generated media (wav, png, mp4, txt)
scripts/          # Backtest & verification scripts
agent-ctx/        # Agent work context docs
prisma/           # DB schema
```

## ⚠️ Honest Status Labels

Every capability reports its **real** status — a button being clickable does not mean the feature is enabled. Features are only marked working after a real output + passing test. Rate limits (HTTP 429) are reported as runtime limits, not broken integrations.

## 📜 License

Personal / non-commercial use. Third-party model licenses apply — items lacking license clarity are flagged `license_review_required`.
