// ============================================================
// Next.js instrumentation — সার্ভার-শুরু হুক (Phase 1, B-D3)
//
// সমস্যা: প্রোডাকশন-রানারের বুট-রিকভারি সুইপ (মৃত প্রসেসের ঝুলে-থাকা
// জব সৎভাবে সমাধান করা) আগে শুধু প্রথম API-রাউট লোডে চলত — ট্রাফিক
// না থাকলে রিস্টার্টের পরেও অনির্দিষ্ট সময় পর্যন্ত জব-সারি মিথ্যা
// "running" দেখাত। register() সার্ভার-প্রসেস শুরুতেই চলে — রানার-মডিউল
// আগেভাগে লোড হয়ে ৩ সে.-দেরিতে বুট-সুইপ নিশ্চিত করে।
//
// P4-hotfix (2026-10-19): ① guard এখন কেবল edge-কে বাদ দেয় — আগের
// `!== 'nodejs'` শর্ত standalone server.js-এ (যেটা NEXT_RUNTIME সেট
// করেই না — ওটা শুধু next CLI করে) পুরো register()-কেই চির-স্কিপ করত;
// ফলে রানার-বুট/পরিবেশ-লগ/স্টোরেজ-প্রোব কখনো প্রোডাকশনে চলেনি।
// ② SQLite-স্কিমা স্ব-নিরাময় যোগ (lib/db-schema-heal — মডিউল-পৃথক,
// edge-বান্ডল-নিরাপত্তার জন্য)।
// ============================================================

export async function register(): Promise<void> {
  // Next-এর নিজের সিম্যান্টিক্স (instrumentation-node-extensions): কেবল
  // edge-রানটাইম বাদ; 'nodejs'-এ সীমাবদ্ধ নয় — কারণ standalone
  // server.js NEXT_RUNTIME সেট করে না, শুধু next CLI (dev/start) করে।
  if (process.env.NEXT_RUNTIME === 'edge') return;

  // ১) SQLite-স্কিমা স্ব-নিরাময় (P4) — রানারের ৩ সে.-পরের বুট-সুইপের
  //    আগেই ভলিউমে টেবিল তৈরি; প্রসেস-প্রতি একবার, ব্যর্থ হলে লগ-হজম।
  try {
    const { ensureSqliteSchemaOnce } = await import('./lib/db-schema-heal');
    await ensureSqliteSchemaOnce();
  } catch (err) {
    console.warn(`[startup] স্ব-নিরাময়-মডিউল লোড ব্যর্থ — ${String((err as { message?: string })?.message ?? err).slice(0, 200)}`);
  }

  // ২) প্রোডাকশন-রানার আগেভাগে বুট — বুট-সুইপ + stale-sweep টাইমার সক্রিয়
  await import('./lib/agent/production/runner');

  // ৩) পরিবেশ-যাচাই — সতর্ক-লগ (ক্র্যাশ নয়; মান কখনো লগ হয় না)
  try {
    const { validateEnv, envStartupWarnings } = await import('./lib/env');
    const warnings = envStartupWarnings(validateEnv());
    for (const w of warnings) console.warn(w);
  } catch {
    // যাচাই-লগ ব্যর্থ হলে সার্ভার-শুরু ব্যাহত হবে না
  }

  // ৪) স্টোরেজ-লেখার সক্ষমতা (Phase 2) — ভলিউম-মাউন্ট/অনুমতি ভুল হলে
  //    স্টার্টআপেই ধরা পড়ে; ব্যর্থ হলে সতর্ক-লগ (ক্র্যাশ নয়)।
  try {
    const { probeStorageWritable } = await import('./lib/health');
    const probe = await probeStorageWritable();
    if (probe.ok) console.log(`[startup] storage writable: ${probe.path}`);
    else console.warn(`[startup] storage NOT writable: ${probe.path} — ${probe.error ?? 'অজানা কারণ'}`);
  } catch {
    // প্রোব-লগ ব্যর্থ হলেও সার্ভার-শুরু ব্যাহত হবে না
  }
}
