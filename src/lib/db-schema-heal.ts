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
//
// পর্যবেক্ষণযোগ্যতা (P4-ধাপ-২): ফলাফল globalThis-রেকর্ডে জমে এবং
// /api/health selfHeal-ফিল্ডে প্রকাশ্য — লগ-দর্শনাধীন না থেকেই
// বুট-আচরণ নির্ণয়যোগ্য। কোনো গোপন মান নেই: শুধু state/স্নিপেট/পথ/আকার।
// ============================================================

import path from 'node:path';

/** স্ব-নিরাময়ের প্রকাশযোগ্য ফলাফল-রেকর্ড */
export interface SchemaHealStatus {
  state:
    | 'idle' // register() এখনো চলেনি — instrumentation-নির্ণয়ের সংকেত
    | 'skipped-not-sqlite' // DATABASE_URL file: নয়
    | 'skipped-no-cli' // prisma CLI/স্কিমা-ফাইল ইমেজে নেই
    | 'running'
    | 'ok' // db push সফল (সদ্য-সিঙ্ক বা already-in-sync)
    | 'failed' // CLI অশূন্য-প্রস্থান/টাইমআউট — detail-এ stderr-স্নিপেট
    | 'module-error'; // মডিউল-অভ্যন্তরীণ ব্যতিক্রম
  detail?: string;
  at?: string;
  cwd?: string;
  dbFile?: string;
  dbFileExists?: boolean;
  dbFileBytes?: number;
}

interface HealGlobal {
  __sqliteSchemaSelfHeal?: Promise<void>;
  __schemaHealStatus?: SchemaHealStatus;
}

const g = globalThis as HealGlobal;

/** Prisma CLI চালানোর রানটাইম — node-প্রসেস নিজেই, নইলে PATH-এর node */
function cliRuntime(): string {
  return /node(\.exe)?$/i.test(process.execPath) ? process.execPath : 'node';
}

/** file:-URL → সিস্টেম-পথ (আপেক্ষিক হলে cwd-ভিত্তিক রেজলভ) */
function fileUrlToPath(url: string, cwd: string): string {
  let p = url.replace(/^file:/, '');
  if (!path.isAbsolute(p)) p = path.join(cwd, p);
  return p;
}

function setStatus(s: SchemaHealStatus): void {
  g.__schemaHealStatus = { ...s, at: new Date().toISOString() };
}

/** বর্তমান রেকর্ড (কখনো চালু না হলে idle) — /api/health-এ প্রকাশ্য */
export function getSchemaHealStatus(): SchemaHealStatus {
  return g.__schemaHealStatus ?? { state: 'idle' };
}

/**
 * SQLite (`file:`-URL) হলে `prisma db push --skip-generate` — ফ্রেশ
 * ভলিউমে টেবিল তৈরি, স্কিমা-ড্রিফট সংশোধ। ব্যর্থ হলে সতর্ক-লগ +
 * স্ট্যাটাস-রেকর্ড (ক্র্যাশ নয় — অ্যাপ বুট ঠিক থাকে, কোয়েরি সৎভাবে
 * ব্যর্থ হবে)। কখনো reject করে না — কল-কারী নিশ্চিন্তে await করতে পারে।
 */
async function ensureSqliteSchemaImpl(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) {
    setStatus({ state: 'skipped-not-sqlite', cwd: process.cwd() });
    return;
  }

  const [{ execFile }, fs, { promisify }] = await Promise.all([
    import('node:child_process'),
    import('node:fs'),
    import('node:util'),
  ]);
  const execFileAsync = promisify(execFile);

  const cwd = process.cwd();
  const dbFile = fileUrlToPath(url, cwd);
  const cli = path.join(cwd, 'node_modules', 'prisma', 'build', 'index.js');
  const schema = path.join(cwd, 'prisma', 'schema.prisma');
  const base: Pick<SchemaHealStatus, 'cwd' | 'dbFile'> = { cwd, dbFile };
  const fileStats = (s: SchemaHealStatus): SchemaHealStatus => {
    try {
      const st = fs.statSync(dbFile);
      return { ...s, dbFileExists: true, dbFileBytes: st.size };
    } catch {
      return { ...s, dbFileExists: false };
    }
  };

  if (!fs.existsSync(cli) || !fs.existsSync(schema)) {
    setStatus(fileStats({ ...base, state: 'skipped-no-cli', detail: `cli=${fs.existsSync(cli)} schema=${fs.existsSync(schema)}` }));
    console.warn('[startup] SQLite স্ব-নিরাময় স্কিপ — prisma CLI/স্কিমা পাওয়া যায়নি');
    return;
  }

  setStatus({ ...base, state: 'running' });
  try {
    const { stdout } = await execFileAsync(
      cliRuntime(),
      [cli, 'db', 'push', '--skip-generate', `--schema=${schema}`],
      { timeout: 120_000, cwd },
    );
    // শেষ-অ-খালি-লাইন = ফলাফল-সারি ("already in sync" / "in sync …")
    const last = stdout.trim().split('\n').filter(Boolean).pop() ?? 'done';
    setStatus(fileStats({ ...base, state: 'ok', detail: last.slice(0, 300) }));
    console.log(`[startup] SQLite স্কিমা স্ব-নিরাময়: ${last}`);
  } catch (err) {
    const e = err as { stderr?: string; message?: string; killed?: boolean };
    const msg = `${e.killed ? 'timeout/kill: ' : ''}${String(e.stderr ?? e.message ?? err).slice(0, 280)}`;
    setStatus(fileStats({ ...base, state: 'failed', detail: msg }));
    console.warn(`[startup] SQLite স্কিমা স্ব-নিরাময় ব্যর্থ — ${msg}`);
  }
}

/** মেমো-র‍্যাপার — প্রসেস-প্রতি একবারই চলে; ব্যর্থতাও লগ-হজম করে */
export function ensureSqliteSchemaOnce(): Promise<void> {
  if (!g.__sqliteSchemaSelfHeal) {
    g.__sqliteSchemaSelfHeal = ensureSqliteSchemaImpl().catch(err => {
      setStatus({
        state: 'module-error',
        detail: String((err as { message?: string })?.message ?? err).slice(0, 300),
        cwd: process.cwd(),
      });
      console.warn(`[startup] SQLite স্কিমা স্ব-নিরাময় মডিউল-ব্যর্থ — ${String((err as { message?: string })?.message ?? err).slice(0, 300)}`);
    });
  }
  return g.__sqliteSchemaSelfHeal;
}
