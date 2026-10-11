# Task 2-a — Agent Core + Chat UI (Creative Studio upgrade) Work Record

Scope (only these 2 files edited):
- `src/components/chat/empty-state.tsx` (rewritten)
- `src/components/studio/production-card.tsx` (enhanced; working flow untouched)

## What was delivered

### empty-state.tsx (rewrite)
- Hero: "অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও" + one-line Bengali description covering ছবি তৈরি/এডিট, গানের পরিকল্পনা ও ভয়েসওভার, মোশন ভিডিও, মিউজিক ভিডিও ও শর্টফিল্ম।
- 4 feature cards via `Card` component: ছবি স্টুডিও (ImagePlus), অডিও স্টুডিও (AudioLines), ভিডিও স্টুডিও (Film), ফিল্ম ডিরেক্টর (Clapperboard). Grid `grid-cols-2 lg:grid-cols-4`, emerald icon tint (no blue/indigo).
- 5 quick-start chips with the mandated labels (short_film / cinematic image / TTS with sample Bengali text / song planning / image→video). Pattern preserved: `setDraft(text)` + `focusComposer()` from `useChatStore`. Chips: `min-h-11` (44px), `h-auto` multiline wrap, `rounded-full`, `max-w-full`.
- Attachment hint line (no emoji — references the composer's attach button), `role="group"` + Bengali `aria-label` on the chip group, icons `aria-hidden`.

### production-card.tsx (additive enhancements)
- **দৈর্ঘ্য (durationSec) Select** in SpecEditor for video types:
  - motion_video: ৫/৮/১০/১২/১৫/২০ · music_video: ১৫/৩০/৬০/৯০/১২০/১৮০ · short_film: ৩০/৪৫/৬০/৯০/১২০ (within §১৫ DURATION_LIMITS)
  - If current `durationSec` is outside the preset list it is auto-included (sorted) so the Select never shows blank; if `undefined`, `value=''` shows placeholder "স্বয়ংক্রিয়" (verified against installed Radix: `shouldShowPlaceholder(value) → value === "" || undefined`).
  - Mobile: `col-span-2 sm:col-span-1`.
- **ফরম্যাট Select** (PNG/JPEG/WebP) for `type === 'image'`, rendered only when `spec.format` is defined (per instruction).
- **AmberNote component** (small amber note: `border-amber-500/30 bg-amber-500/5 text-amber-700`, TriangleAlert icon):
  - All video types in `awaiting_confirmation`: exact honesty text "ভিডিও তৈরি হয় AI স্টোরিবোর্ড + সিনেম্যাটিক ক্যামেরা-মোশন পাইপলাইনে — ডিফিউশন ভিডিও-মডেল নয়; ফটোরিয়ালিস্টিক অভিনয়ের নিশ্চয়তা নেই।" (warning conveyed by the amber TriangleAlert icon instead of an emoji, per the no-emoji code rule).
  - `music_video` when `spec.songArtifactId === undefined && spec.sound !== 'uploaded_song'`: "গান আপলোড করা হয়নি — ভিডিও নীরব থাকবে। চাইলে গানের অডিও আপলোড করে আবার অনুরোধ করুন।"
- **StepList**: running steps wrapped in `animate-pulse` span (spinner kept); done steps show `toBnDigits((durationMs/1000).toFixed(1)) + ' সেকেন্ড'` right-aligned (`shrink-0`) when `durationMs > 0`.
- **গ্যালারিতে দেখুন** link-button (completed && artifacts.length > 0) → `useUiView.getState().setActiveView('gallery')`, placed in a `flex flex-wrap gap-2` row with সংশোধন করুন.
- Summary badges now use Bengali digits (aspect/duration/fps) and `WebP`-cased format labels; removed 2 pre-existing unused imports (FileText, Switch).
- Mobile-safe: header title `truncate`, badges `flex-wrap`, selects grid-cols-2, notes wrap, durations `shrink-0`.

## Verification (all done)
- `bunx eslint src/components/chat/empty-state.tsx src/components/studio/production-card.tsx` → exit 0, zero errors/warnings.
- `bunx tsc --noEmit` → **zero errors in my two files** (grep-filtered). Pre-existing errors elsewhere are NOT mine: `src/hooks/use-productions.ts:74` (`evt.productionId` accessed on the `{type:'ping'}` variant — needs `evt.type` narrowing; shared file, I must not edit), `src/lib/agent/tools/production.ts` (ToolSpec missing `usage`; another agent's file), plus old `examples/`/`skills/` errors.
- curl: `GET /` → 200, `GET /api/tools` → 200; SSR HTML contains "ক্রিয়েটিভ স্টুডিও", the hero title, all 4 feature-card titles, and all 5 chip strings.
- dev.log: clean recompile of `/` (5.9s compile, 200), no errors after edits.
- Full agent-chat E2E intentionally NOT run (other agents are mid-pipeline; failures there are out of scope).

## Notes for later agents / main agent
- Fix suggestion for use-productions.ts:74 (integration pass): early-return on `evt.type === 'ping'` before reading `evt.productionId`.
- Duration/format edits flow through the existing `editedSpec` → confirm override-merge → `validateSpec` (backend clamps to DURATION_LIMITS), so no backend change needed.
- `production-card.tsx` is currently untracked in git (new file from the foundation task); my edits are in place on disk.
