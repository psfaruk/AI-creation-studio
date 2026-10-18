# syntax=docker/dockerfile:1

# ============================================================
# AI Creation Studio — production image (Railway staging, Phase 2)
#
# দুই-স্তরের বিল্ড:
#   builder  — node:22-slim + bun 1.3.14 (CI-এ যাচাইকৃত পিন সংস্করণ):
#              bun install --frozen-lockfile → PostgreSQL প্রোভাইডার-ফ্লিপ
#              (dual-mode পরিকল্পনা) → prisma generate → next build +
#              prepare-standalone → .next/standalone
#   runtime  — node:22-slim + Debian ffmpeg (libx264/aac/libmp3lame/
#              libass/libvidstab — প্রমাণ:
#              docs/audit/railway-hf-deployment/phase-1-ffmpeg-runtime-requirements.md)
#              + fonts-noto-core (Noto Sans Bengali সহ — .deb-যাচাইকৃত:
#              NotoSansBengali-{Regular,Bold}.ttf) + ca-certificates (PG TLS)।
#
# সচেতন-সিদ্ধান্ত: কনটেইনার root হিসেবে চলে — Railway ভলিউম root-মালিকানাধীন
# এবং non-root ইমেজের অনুমতি-সমস্যা নথিভুক্ত (docs.railway.app/reference/
# volumes)। হার্ডেনিং-বিকল্প phase-2-railway-staging.md §9-এ।
#
# নির্মাণ-সময়ের কোনো গোপন মান এই ফাইলে নেই — সব আসল মান Railway-র
# রানটাইম সার্ভিস-ভেরিয়েবল থেকে আসে।
# ============================================================

# ---------- Stage 1: builder ----------
FROM node:22-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# নির্মাণ-সময়ের ডামি URL — prisma generate / next build কখনো সংযোগ করে না
# (সব API-রুট force-dynamic; CI-ও অস্তিত্বহীন file:-URL দিয়ে সবুজ)।
# আসল DATABASE_URL Railway-র রানটাইম ভেরিয়েবল।
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"

# bun 1.3.14 — ঠিক যে সংস্করণে CI পুরো স্যুট+বিল্ড যাচাই করেছে
# (bun.lock-ও এতেই তৈরি; moving-target `latest` এড়ানো)।
RUN npm install -g bun@1.3.14

# নির্ভরতা আগে (লেয়ার-ক্যাশযোগ্য)
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# সোর্স (দ্রষ্টব্য .dockerignore — গোপন/জাঙ্ক/রানটাইম-ডেটা বাদ)
COPY . .

# Dual-mode Prisma (phase-1-database-migration-plan.md §3.2):
# রিপো-স্কিমা লোকাল-dev-এ SQLite-ই থাকে; প্রোডাকশন ইমেজ PostgreSQL
# ক্লায়েন্ট বানায়। বেসলাইন মাইগ্রেশন: prisma/migrations/0_init (চেকইন)।
# এই sed কেবল builder-স্টেজের অনুলিপিতে চলে — রিপো অপরিবর্তিত।
RUN sed -i 's/^  provider = "sqlite"$/  provider = "postgresql"/' prisma/schema.prisma \
 && bun run db:generate

# প্রোডাকশন বিল্ড — next build + scripts/prepare-standalone.mjs
# (নেটওয়ার্ক লাগে next/font/google Geist-এর জন্য — CI-সমান)
RUN bun run build

# ---------- Stage 2: runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0

# FFmpeg (Debian বিল্ড — libvidstab সহ, Alpine নয়) + Noto ফন্ট
# (বাংলা সাবটাইটেল-বার্ন + SVG টেক্সট) + CA সার্টিফিকেট (PG TLS)।
# মাপ: ffmpeg-চেইন ≈ ৫১ MB + fonts-noto-core (dpkg Installed-Size)।
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Standalone Next সার্ভার: server.js + traced node_modules
# + .next/static + public (prepare-standalone.mjs-সন্নিবেশিত)।
COPY --from=builder /app/.next/standalone ./

# Prisma CLI + PG-স্কিমা + মাইগ্রেশন — `prisma migrate deploy`-র জন্য
# (Railway preDeployCommand; স্কিমাটি builder-এর PG-ফ্লিপ করা অনুলিপি)।
# রানটাইম কোয়েরি-ক্লায়েন্ট standalone-tracing-এ রয়েছে (node_modules/.prisma)।
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma

# গ্লোবাল `prisma` র‍্যাপার — ডিপ্লয়-সময়ে npx/নেটওয়ার্ক লাগে না।
RUN printf '#!/bin/sh\nexec node /app/node_modules/prisma/build/index.js "$@"\n' > /usr/local/bin/prisma \
 && chmod +x /usr/local/bin/prisma

# মাউন্ট-পয়েন্ট: Railway ভলিউম → /app/storage (সব রানটাইম-পথ
# process.cwd()/storage-এ শেকড); /app/db — SQLite-ফলব্যাক চালাতে চাইলে।
RUN mkdir -p /app/storage /app/db

# Railway PORT env → standalone server.js নিজেই পড়ে (ডিফল্ট 3000)।
EXPOSE 3000

CMD ["node", "server.js"]
