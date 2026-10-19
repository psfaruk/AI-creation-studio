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
//
// P4-hotfix (2026-10-19): SQLite-স্কিমা স্ব-নিরাময় — Railway-র
// preDeployCommand `prisma db push` অ্যাপ-কনটেইনারের মাউন্ট-করা
// ভলিউম-ফাইলে প্রভাব ফেলেনি (সম্ভবত ভলিউম-মাউন্ট ছাড়াই চলে) —
// অ্যাপ "The table main.Conversation does not exist" দিয়ে ৫০৩ করছিল।
// এখন যে-প্রক্রিয়া ভলিউম দেখে, সে-ই বুটে স্কিমা-সিঙ্ক নিশ্চিত করে
// (idempotent `prisma db push --skip-generate`; সিঙ্ক থাকলে <১ সে.)।
// ============================================================

/** প্রসেস-প্রতি একবারই চলার নিশ্চয়তা (HMR/পুনঃ-রেজিস্টার-সুরক্ষা) */
const g = globalThis as { __sqliteSchemaSelfHeal?: Promise<void> };

/** Prisma CLI চালানোর রানটাইম — node-প্রসেস নিজেই, নইলে PATH-এর node */
function cliRuntime(): string {
  return /node(\.exe)?$/i.test(process.execPath) ? process.execPath : 'node';
}

/**
 * SQLite (`file:`-URL) হলে বুটে `prisma db push --skip-generate` —
 * ফ্রেশ ভলিউমে টেবিল তৈরি, স্কিমা-ড্রিফট সংশোধ। ব্যর্থ হলে সতর্ক-লগ
 * (ক্র্যাশ নয় — অ্যাপ বুট ঠিক থাকে, কোয়েরি সৎভাবে ব্যর্থ হবে)।
 */
async function ensureSqliteSchema(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) return; // PG/অসেট — স্পর্শ করবে না

  const [{ execFile }, path, fs, { promisify }] = await Promise.all([
    import('node:child_process'),
    import('node:path'),
    import('node:fs'),
    import('node:util'),
  ]);
  const execFileAsync = promisify(execFile);

  const cli = path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js');
  const schema = path.join(process.cwd(), 'prisma', 'schema.prisma');
  if (!fs.existsSync(cli) || !fs.existsSync(schema)) {
    console.warn('[startup] SQLite স্ব-নিরাময় স্কিপ — prisma CLI/স্কিমা পাওয়া যায়নি');
    return;
  }

  try {
    const { stdout } = await execFileAsync(
      cliRuntime(),
      [cli, 'db', 'push', '--skip-generate', `--schema=${schema}`],
      { timeout: 90_000, cwd: process.cwd() },
    );
    // শেষ-অ-খালি-লাইন = ফলাফল-সারি ("already in sync" / "in sync …")
    const last = stdout.trim().split('\n').filter(Boolean).pop() ?? 'done';
    console.log(`[startup] SQLite স্কিমা স্ব-নিরাময়: ${last}`);
  } catch (err) {
    const msg = String((err as { stderr?: string; message?: string })?.stderr ?? (err as { message?: string })?.message ?? err).slice(0, 300);
    console.warn(`[startup] SQLite স্কিমা স্ব-নিরাময় ব্যর্থ — ${msg}`);
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // ১) SQLite-স্কিমা স্ব-নিরাময় (P4) — রানারের ৩ সে.-পরের বুট-সুইপের
  //    আগেই টেবিল তৈরি হয়ে থাকে; প্রসেস-প্রতি একবার।
  if (!g.__sqliteSchemaSelfHeal) g.__sqliteSchemaSelfHeal = ensureSqliteSchema();
  await g.__sqliteSchemaSelfHeal;

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
