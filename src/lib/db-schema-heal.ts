// ============================================================
// SQLite-স্কিমা স্ব-নিরাময় v2 (P4-hotfix, 2026-10-19)
//
// ইতিহাস (তিন ধাপের ফরেনসিক্স-ফলাফল):
//  ① Railway preDeployCommand `prisma db push` ভলিউম-ফাইলে প্রভাব ফেলেনি।
//  ② বুট-স্ব-নিরাময় CLI-স্পন সংস্করণ: standalone-এ register() চলে না
//    (NEXT_RUNTIME-গার্ড) — ঠিক করা হলো; তারপরও ব্যর্থ: prisma CLI-র
//    ট্রানজিটিভ নির্ভরতা (effect-ক্লোজার, ~৩২ প্যাকেজ) রানটাইম ইমেজে
//    নেই — "Cannot find module 'effect'"।
//  ③ সমাধান (এই সংস্করণ): CLI একেবারে বাদ। প্রকৃত DDL
//    (prisma/sqlite-bootstrap.sql — বিল্ডারে প্রতি বিল্ডে পুনঃজেনারেটেড)
//    সরাসরি **query engine** দিয়ে চালানো হয় (PrismaClient.
//    $executeRawUnsafe) — ইঞ্জিন-বাইনারি ইতিমধ্যে ইমেজে সক্রিয় ও
//    প্রমাণিত। কোনো নতুন নির্ভরতা/প্রসেস-স্পন/নেটওয়ার্ক নেই।
//
// ড্রিফট-নোট: নতুন টেবিল/ইনডেক্স যোগ হলে "already exists"-সহিষ্ণুতা
// সেগুলিও বসিয়ে দেয়; বিদ্যমান টেবিলে কলাম-সংযোজন এই পথে ধরা পড়ে না
// (সতর্কতা-নোট sqlite-bootstrap.sql হেডারে)।
//
// স্থাপত্য-নোট: instrumentation.ts থেকে আলাদা মডিউল — Next
// instrumentation-ফাইলের edge-বান্ডল node:-ইমপোর্ট দেখলে সতর্কতা তোলে;
// node-নির্ভর লজিক এখানে (ডাইনামিক-ইমপোর্ট-পৃথকীকরণ — প্রমাণিত নিরাপদ)।
//
// পর্যবেক্ষণযোগ্যতা: ফলাফল globalThis-রেকর্ডে জমে /api/health selfHeal-
// ফিল্ডে প্রকাশ্য (state/detail/cwd/dbFile/আকার — কোনো গোপন মান নয়)।
// ============================================================

import path from 'node:path';
import { db } from './db';

/** স্ব-নিরাময়ের প্রকাশযোগ্য ফলাফল-রেকর্ড */
export interface SchemaHealStatus {
  state:
    | 'idle' // register() এখনো চলেনি — instrumentation-নির্ণয়ের সংকেত
    | 'skipped-not-sqlite' // DATABASE_URL file: নয়
    | 'skipped-no-ddl' // bootstrap-DDL ফাইল পাওয়া যায়নি
    | 'running'
    | 'ok' // টেবিল বিদ্যমান (দ্রুত-পথ) বা DDL প্রয়োগ-সফল
    | 'failed' // সেন্টিনেল টেবিল সবশেষেও নেই — detail-এ ত্রুটি
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

/** সেন্টিনেল-টেবিল — schema-র প্রথম মডেল (থাকলে স্কিমা-উপস্থিতি ধরা হয়) */
const SENTINEL_TABLE = 'Conversation';

function setStatus(s: SchemaHealStatus): void {
  g.__schemaHealStatus = { ...s, at: new Date().toISOString() };
}

/** বর্তমান রেকর্ড (কখনো চালু না হলে idle) — /api/health-এ প্রকাশ্য */
export function getSchemaHealStatus(): SchemaHealStatus {
  return g.__schemaHealStatus ?? { state: 'idle' };
}

/** file:-URL → সিস্টেম-পথ (আপেক্ষিক হলে cwd-ভিত্তিক রেজলভ) */
function fileUrlToPath(url: string, cwd: string): string {
  let p = url.replace(/^file:/, '');
  if (!path.isAbsolute(p)) p = path.join(cwd, p);
  return p;
}

/** DDL → বিবৃতি-তালিকা (";\n"-বিভাজন + কমেন্ট-লাইন বাদ) */
function splitDdlStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map(s => s.replace(/^\s*--[^\n]*$/gm, '').trim())
    .filter(s => s.length > 0);
}

/**
 * SQLite (`file:`-URL) হলে: সেন্টিনেল-টেবিল অনুপস্থিত হলে
 * bootstrap-DDL সরাসরি query engine দিয়ে প্রয়োগ। ব্যর্থ হলে
 * সতর্ক-লগ + স্ট্যাটাস-রেকর্ড (ক্র্যাশ নয় — অ্যাপ বুট ঠিক থাকে,
 * কোয়েরি সৎভাবে ব্যর্থ হবে)। কখনো reject করে না।
 */
async function ensureSqliteSchemaImpl(): Promise<void> {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) {
    setStatus({ state: 'skipped-not-sqlite', cwd: process.cwd() });
    return;
  }

  const fs = await import('node:fs');
  const cwd = process.cwd();
  const dbFile = fileUrlToPath(url, cwd);
  const ddlPath = path.join(cwd, 'prisma', 'sqlite-bootstrap.sql');
  const base: Pick<SchemaHealStatus, 'cwd' | 'dbFile'> = { cwd, dbFile };
  const fileStats = (s: SchemaHealStatus): SchemaHealStatus => {
    try {
      const st = fs.statSync(dbFile);
      return { ...s, dbFileExists: true, dbFileBytes: st.size };
    } catch {
      return { ...s, dbFileExists: false };
    }
  };

  if (!fs.existsSync(ddlPath)) {
    setStatus(fileStats({ ...base, state: 'skipped-no-ddl', detail: ddlPath }));
    console.warn(`[startup] SQLite স্ব-নিরাময় স্কিপ — bootstrap-DDL পাওয়া যায়নি: ${ddlPath}`);
    return;
  }

  setStatus({ ...base, state: 'running' });

  /** সেন্টিনেল-টেবিল আছে কি না */
  const hasSentinel = async (): Promise<boolean> => {
    const rows = (await db.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${SENTINEL_TABLE}'`,
    )) as Array<{ name: string }>;
    return rows.length > 0;
  };

  try {
    if (await hasSentinel()) {
      // দ্রুত-পথ: স্কিমা ইতিমধ্যে বিদ্যমান (dev-db / আগের বুটে প্রয়োগকৃত)
      setStatus(fileStats({ ...base, state: 'ok', detail: 'already-present' }));
      return;
    }

    const sql = fs.readFileSync(ddlPath, 'utf8');
    const statements = splitDdlStatements(sql);
    let applied = 0;
    const errors: string[] = [];
    for (const stmt of statements) {
      try {
        await db.$executeRawUnsafe(stmt);
        applied++;
      } catch (err) {
        // "already exists" = আংশিক-বিদ্যমান স্কিমায় সহিষ্ণুতা (নতুন-টেবিল-ড্রিফট)
        const msg = String((err as { message?: string }).message ?? err);
        if (!/already exists/i.test(msg)) errors.push(msg.slice(0, 120));
      }
    }

    if (await hasSentinel()) {
      setStatus(fileStats({
        ...base,
        state: 'ok',
        detail: `applied ${applied}/${statements.length}${errors.length ? `; উপেক্ষিত-ত্রুটি ${errors.length}` : ''}`,
      }));
      console.log(`[startup] SQLite স্কিমা স্ব-নিরাময়: ${applied}/${statements.length} বিবৃতি প্রয়োগ`);
    } else {
      const detail = `sentinel অনুপস্থিত সত্ত্বেও ${applied}/${statements.length}; ${errors.slice(0, 2).join(' | ')}`.slice(0, 300);
      setStatus(fileStats({ ...base, state: 'failed', detail }));
      console.warn(`[startup] SQLite স্কিমা স্ব-নিরাময় ব্যর্থ — ${detail}`);
    }
  } catch (err) {
    const msg = String((err as { message?: string }).message ?? err).slice(0, 300);
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
