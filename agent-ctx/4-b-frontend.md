# Task 4-b — frontend (run_note + rate-limit banner + quick-create)

Task: রেট-লিমিট-যুগের সৎ UI — চ্যাটে `run_note` অ্যাম্বার-লাইন, /api/system-ভিত্তিক রেট-লিমিট ব্যানার, স্টুডিওতে LLM-মুক্ত "⚡ দ্রুত তৈরি" ফর্ম, প্রোডাকশন-কার্ডে ইঞ্জিনের সৎ লেবেল।

## Files changed
- `src/lib/types.ts` — ChatMessage-এ ঐচ্ছিক `statusNote?: string` যোগ (মাত্র এটি; run_note RunEvent-টাইপ মূল এজেন্টের, ডুপ্লিকেট করিনি)
- `src/hooks/use-agent-run.ts` — SSE_EVENT_NAMES + dispatch-এ `run_note` case (inView হলে pending বার্তায় statusNote সেট)
- `src/hooks/use-system.ts` — RateLimitChannelStatus / RateLimitsStatus টাইপ + SystemInfo.rateLimits? (optional)
- `src/components/chat/message-bubble.tsx` — pending bubble-এ statusNote অ্যাম্বার-লাইন (pulsing dot, border-l-2 amber, role="status")
- `src/components/chat/rate-limit-banner.tsx` (নতুন) — ৩০ সে. পোল, AbortController + in-flight guard; anyBlocked হলে কম্পোজারের উপরে সরু অ্যাম্বার ব্যানার + ব্লকড-চ্যানেল চিপ (বাংলা সংখ্যা); না থাকলে null রেন্ডার
- `src/app/page.tsx` — চ্যাট-সেকশনে Composer-এর আগে `<RateLimitBanner />`
- `src/components/studio/quick-create.tsx` (নতুন) — "⚡ দ্রুত তৈরি" ফর্ম → POST /api/productions { spec } (conversationId বাদ); short_film→story, else→idea; সাফল্যে টোস্ট+রিফ্রেশ+সৎ adjustments/notes ইনলাইন; ব্যর্থতায় বাংলা এরর-টোস্ট
- `src/components/studio/productions-view.tsx` — হেডারের পরে QuickCreateCard; awaiting_confirmation আইটেম এখন ProductionCard (বিদ্যমান নিশ্চিত-বাটনসহ); empty-টেক্সট আপডেট
- `src/components/studio/production-card.tsx` — হেডার মেটা-লাইনে সব অবস্থায় সৎ ইঞ্জিন-লেবেল (cinematic_motion → অ্যাম্বারে "AI ডিফিউশন নয়")

## Wiring
- Banner: page.tsx চ্যাট-সেকশন, `<RateLimitBanner />` ঠিক `<Composer />`-এর আগে (chat ভিউতেই মাউন্ট ⇒ পোল তখনই চলে)
- Quick-create: productions-view.tsx-এ হেডারের পরে, ফিল্টার-চিপের আগে; onCreated → setSection('all') + setReload(n+1)

## Reused patterns
- shadcn: Card, Input, Textarea, Label, Select, Button, Badge
- toast from `@/hooks/use-toast` (sonner-এর Toaster এই অ্যাপে মাউন্টেড নেই — তাই প্রজেক্ট-প্যাটার্নই ব্যবহার)
- `toBnDigits` from `@/components/chat/bn-format`
- `useProductions` store + ProductionCard-এর বিদ্যমান confirm ফ্লো, AmberNote-ধাঁচের রং

## Verification
- `bunx tsc --noEmit` → src/-এ শূন্য এরর (একটি ক্ষণস্থায়ী এরর মূল এজেন্টের সমান্তরাল motion_video.ts-এডিটের মাঝামাঝি স্ন্যাপশট ছিল — সে নিজেই ঠিক করেছে)
- `bun run lint` → ক্লিন; dev.log-এ আমার ফাইলে নতুন এরর নেই
- agent-browser E2E: quick-create→কার্ড(নিশ্চিত-বাটনসহ) তালিকার শীর্ষে ✓ (টেস্ট-প্রোডাকশন পরে বাতিল); ব্যানার blocked/unblocked মক-টেস্ট ✓; লাইভ রানে run_note অ্যাম্বার-লাইন ✓; কনসোল-এরর নেই ✓
- নোট: মূল এজেন্টের সমান্তরাল এডিটে /api/system সাময়িক ৫০০ ছিল — ব্যানার নীরবে সামলায় (non-ok → কিছু নয়, ৩০ সে. পরে রিট্রাই)
