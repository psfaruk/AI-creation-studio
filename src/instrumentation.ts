// ============================================================
// Next.js instrumentation — সার্ভার-শুরু হুক (Phase 1, B-D3)
//
// সমস্যা: প্রোডাকশন-রানারের বুট-রিকভারি সুইপ (মৃত প্রসেসের ঝুলে-থাকা
// জব সৎভাবে সমাধান করা) আগে শুধু প্রথম API-রাউট লোডে চলত — ট্রাফিক
// না থাকলে রিস্টার্টের পরেও অনির্দিষ্ট সময় পর্যন্ত জব-সারি মিথ্যা
// "running" দেখাত। register() সার্ভার-প্রসেস শুরুতেই চলে — রানার-মডিউল
// আগেভাগে লোড হয়ে ৩ সে.-দেরিতে বুট-সুইপ নিশ্চিত করে।
//
// নোট: edge-রানটাইমে চলে না (শর্ত-NEXT_RUNTIME দিয়ে সার্টেড);
// dev-মোডেও নিরাপদ — রানারের টাইমার-ইনিট globalThis-গার্ডেড।
// ============================================================

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // ১) প্রোডাকশন-রানার আগেভাগে বুট — বুট-সুইপ + stale-sweep টাইমার সক্রিয়
  await import('./lib/agent/production/runner');

  // ২) পরিবেশ-যাচাই — সতর্ক-লগ (ক্র্যাশ নয়; মান কখনো লগ হয় না)
  try {
    const { validateEnv, envStartupWarnings } = await import('./lib/env');
    const warnings = envStartupWarnings(validateEnv());
    for (const w of warnings) console.warn(w);
  } catch {
    // যাচাই-লগ ব্যর্থ হলে সার্ভার-শুরু ব্যাহত হবে না
  }
}
