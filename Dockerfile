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
# (সব API-রুট force-dynamic; CI-ও এই ধরনের অস্তিত্বহীন file:-URL দিয়ে সবুজ)।
# আসল ডেটাবেস-পথ রানটাইম-স্টেজের ENV-ডিফল্টে (নিচে দেখুন)।
ENV DATABASE_URL="file:/tmp/build-dummy.db"

# bun 1.3.14 — ঠিক যে সংস্করণে CI পুরো স্যুট+বিল্ড যাচাই করেছে
# (bun.lock-ও এতেই তৈরি; moving-target `latest` এড়ানো)।
RUN npm install -g bun@1.3.14

# নির্ভরতা আগে (লেয়ার-ক্যাশযোগ্য)
COPY package.json bun.lock bunfig.toml ./
RUN bun install --frozen-lockfile

# সোর্স (দ্রষ্টব্য .dockerignore — গোপন/জাঙ্ক/রানটাইম-ডেটা বাদ)
COPY . .

# P4-hotfix — প্রোডাকশন-ডিফল্ট SQLite (রিপো-স্কিমার সঙ্গে অপরিবর্তিত):
# একক-মালিক স্টুডিওতে ভলিউম-ব্যাকড SQLite (file:/app/storage/studio.db —
# রানটাইম-স্টেজের ENV-ডিফল্ট) যথেষ্ট এবং মালিকের শূন্য-কনফিগ। আগের
# PG-ফ্লিপ ডিজাইনে (phase-1-database-migration-plan.md §3.2) DATABASE_URL
# রানটাইমে সেট না থাকায় প্রোডাকশন DB-স্তর অচল ছিল (2026-10-19 প্রমাণিত)।
# PostgreSQL-পথ ফিরতে চাইলে: এখানে আবার provider-ফ্লিপ sed যোগ করে
# PG-ক্লায়েন্ট বানিয়ে রানটাইমে DATABASE_URL সার্ভিস-ভেরিয়েবলে বসাতে হবে।
RUN bun run db:generate

# প্রোডাকশন বিল্ড — next build + scripts/prepare-standalone.mjs
# (নেটওয়ার্ক লাগে next/font/google Geist-এর জন্য — CI-সমান)
RUN bun run build

# ---------- Stage 2: runtime ----------
FROM node:22-slim AS runtime
WORKDIR /app

# DATABASE_URL-ডিফল্ট: ভলিউম-ব্যাকড SQLite। Railway সার্ভিস-ভেরিয়েবল
# ইমেজ-ENV-কে ওভাররাইড করে — মালিক ভবিষ্যতে PG চাইলে শুধু সার্ভিসে
# DATABASE_URL বসালেই হবে (সে ক্ষেত্রে builder-এ PG-ক্লায়েন্ট ফ্লিপ আবশ্যক,
# উপরের মন্তব্য দেখুন)।
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    DATABASE_URL="file:/app/storage/studio.db"

# FFmpeg (Debian বিল্ড — libvidstab সহ, Alpine নয়) + Noto ফন্ট
# (বাংলা সাবটাইটেল-বার্ন + SVG টেক্সট) + CA সার্টিফিকেট (আউটবাউন্ড
# HTTPS: z.ai/Supabase/TLS-সাধারণ)।
# মাপ: ffmpeg-চেইন ≈ ৫১ MB + fonts-noto-core (dpkg Installed-Size)।
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Standalone Next সার্ভার: server.js + traced node_modules
# + .next/static + public (prepare-standalone.mjs-সন্নিবেশিত)।
COPY --from=builder /app/.next/standalone ./

# Prisma CLI + স্কিমা — `prisma db push --skip-generate`-এর জন্য
# (Railway preDeployCommand; স্কিমা SQLite-ই থাকে এখন)।
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# P4-hotfix: জেনারেটেড কোয়েরি-ক্লায়েন্ট স্পষ্ট কপি — Next-এর standalone
# output-file-tracing ইঞ্জিন-বাইনারি মিস করেছিল ("could not locate the
# Query Engine for runtime debian-openssl-3.0.x" → প্রোডাকশন /api/health
# 503; @prisma-কপি একা যথেষ্ট নয় — ক্লায়েন্ট .prisma-ডিরে ইঞ্জিন খোঁজে)।
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

# গ্লোবাল `prisma` র‍্যাপার — ডিপ্লয়-সময়ে npx/নেটওয়ার্ক লাগে না।
RUN printf '#!/bin/sh\nexec node /app/node_modules/prisma/build/index.js "$@"\n' > /usr/local/bin/prisma \
 && chmod +x /usr/local/bin/prisma

# মাউন্ট-পয়েন্ট: Railway ভলিউম → /app/storage (সব রানটাইম-পথ
# process.cwd()/storage-এ শেকড — P4-hotfix থেকে এটিই SQLite-ডেটাবেসের
# বাড়িও: storage/studio.db)।
RUN mkdir -p /app/storage /app/db

# Railway PORT env → standalone server.js নিজেই পড়ে (ডিফল্ট 3000)।
EXPOSE 3000

CMD ["node", "server.js"]
