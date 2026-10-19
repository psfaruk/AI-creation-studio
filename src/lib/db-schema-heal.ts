// ============================================================
// SQLite-স্কিমা স্ব-নিরাময় (P4-hotfix, 2026-10-19)
//
// প্রেক্ষাপট: Railway-র preDeployCommand `prisma db push` অ্যাপ-
// কনটেইনারের ভলিউম-মাউন্ট করা storage/studio.db-তে প্রভাব ফেলেনি —
// অ্যাপ "The table main.Conversation does not exist" দিয়ে ৫০৩ করছিল।
// সমাধান: যে-প্রসেস ভলিউম দেখে, সে-ই বুটে idempotent
// `prisma db push --skip-generate` চালিয়ে স্কিমা-সিঙ্ক নিশ্চিত করে।
//
// স্থাপত্য-নোট: instrumentation.ts থেকে আলাদা মডিউল — Next
// instrumentation-ফাইলটির একটি edge-বান্ডলও বানায়; সরাসরি
// `import('node:…')` সেখানে edge-চেকার সতর্কতা তোলে। node-নির্ভর
// লজিক এখানে (ডাইনামিক-ইমপোর্ট-পৃথকীকরণ) রেখে সেই সমস্যা এড়ানো হয় —
// ./lib/health (execFile) ও ./lib/agent/** একই প্যাটার্নে সপ্তাহখানেক
// ধরে CI-সবুজ।
// ============================================================

/** প্রসেস-প্রতি একবারই চলার নিশ্চয়তা (HMR/পুনঃ-রেজিস্টার-সুরক্ষা) */
const g = globalThis as { __sqliteSchemaSelfHeal?: Promise<void> };

/** Prisma CLI চালানোর রানটাইম — node-প্রসেস নিজেই, নইলে PATH-এর node */
function cliRuntime(): string {
  return /node(\.exe)?$/i.test(process.execPath) ? process.execPath : 'node';
}

/**
 * SQLite (`file:`-URL) হলে `prisma db push --skip-generate` — ফ্রেশ
 * ভলিউমে টেবিল তৈরি, স্কিমা-ড্রিফট সংশোধ। ব্যর্থ হলে সতর্ক-লগ
 * (ক্র্যাশ নয় — অ্যাপ বুট ঠিক থাকে, কোয়েরি সৎভাবে ব্যর্থ হবে)।
 * কখনো reject করে না — কল-কারী নিশ্চিন্তে await করতে পারে।
 */
async function ensureSqliteSchemaImpl(): Promise<void> {
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
      { timeout: 120_000, cwd: process.cwd() },
    );
    // শেষ-অ-খালি-লাইন = ফলাফল-সারি ("already in sync" / "in sync …")
    const last = stdout.trim().split('\n').filter(Boolean).pop() ?? 'done';
    console.log(`[startup] SQLite স্কিমা স্ব-নিরাময়: ${last}`);
  } catch (err) {
    const msg = String((err as { stderr?: string; message?: string })?.stderr ?? (err as { message?: string })?.message ?? err).slice(0, 300);
    console.warn(`[startup] SQLite স্কিমা স্ব-নিরাময় ব্যর্থ — ${msg}`);
  }
}

/** মেমো-র‍্যাপার — প্রসেস-প্রতি একবারই চলে; ব্যর্থতাও লগ-হজম করে */
export function ensureSqliteSchemaOnce(): Promise<void> {
  if (!g.__sqliteSchemaSelfHeal) {
    g.__sqliteSchemaSelfHeal = ensureSqliteSchemaImpl().catch(err => {
      console.warn(`[startup] SQLite স্কিমা স্ব-নিরাময় মডিউল-ব্যর্থ — ${String((err as { message?: string })?.message ?? err).slice(0, 300)}`);
    });
  }
  return g.__sqliteSchemaSelfHeal;
}
