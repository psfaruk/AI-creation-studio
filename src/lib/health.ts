// ============================================================
// Health-check core — Phase 2 (Railway staging)
//
// উদ্দেশ্য: একটি সস্তা, সৎ, নিরীক্ষণ-যোগ্য /api/health রুটের
// নিকট-তম যুক্তি-স্তর। Railway-র healthcheckPath এটিই ব্যবহার করবে।
//
// নীতি:
//  - কোনো গোপন মান কখনো প্রতিক্রিয়ায় যায় না — কেবল ok/না-ok,
//    সংস্করণ-স্ট্রিং, বিলম্ব-মিলিসেকেন্ড, পথ।
//  - সম্পূর্ণ নির্ভরতা-ইনজেকশন: runHealthChecks() নিজে কোনো
//    db/fs/child_process স্পর্শ করে না — রুট (বা instrumentation)
//    বাস্তব প্রোব জোগায়; টেস্ট (t30) খাঁটি নকল দেয় (mock-free)।
//  - সত্যের শ্রেণিবিন্যাস:
//      'error'    = ডেটাবেস অসম্পর্কিত → HTTP 503 (Railway-র
//                   দৃষ্টিতে কনটেইনার সুস্থ নয়)
//      'degraded' = ডেটাবেস আছে, কিন্তু storage/ffmpeg/env-র কোনো
//                   সমস্যা → HTTP 200 (মিডিয়া-পাইপলাইন ক্ষতিগ্রস্ত
//                   হতে পারে, অ্যাপ চলছে)
//      'ok'       = সব পরীক্ষা সবুজ → HTTP 200
// ============================================================

import { execFile } from 'node:child_process';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateEnv, type EnvReport } from '@/lib/env';
import { zAiConfigured } from '@/lib/providers/sandbox-detect';

export type { EnvReport };

const execFileAsync = promisify(execFile);

export type HealthStatus = 'ok' | 'degraded' | 'error';

export interface DbCheck {
  ok: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface StorageCheck {
  ok: boolean;
  path: string;
  error?: string;
}

export interface FfmpegCheck {
  ok: boolean;
  version?: string | null;
  error?: string;
}

export interface EnvHealthCheck {
  ok: boolean;
  production: boolean;
  missingRequired: string[];
  missingRecommended: string[];
}

export interface ProvidersCheck {
  /** shape-only সনাক্তকরণ — মান/গোপন কখনো পড়া হয় না (sandbox-detect) */
  zaiSdk: 'configured' | 'not-configured';
}

export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  uptimeSeconds: number;
  checks: {
    database: DbCheck;
    storage: StorageCheck;
    ffmpeg: FfmpegCheck;
    env: EnvHealthCheck;
    providers: ProvidersCheck;
  };
}

/** রুট/instrumentation যা জোগায়; টেস্ট যা চায় তা-ই দেয় */
export interface HealthDeps {
  /** সস্তা db-ping — বাস্তবে db.conversation.count() */
  countFn: () => Promise<number>;
  probeFfmpeg: () => Promise<FfmpegCheck>;
  probeStorage: () => Promise<StorageCheck>;
  /** ঐচ্ছিক — না দিলে validateEnv() নিজেই চলে */
  envReport?: EnvReport;
  /** ঐচ্ছিক — না দিলে zAiConfigured() (shape-only) */
  zaiConfigured?: () => boolean;
  /** ডিফল্ট ৩০০০ms — db-ping এই সময়ে সাড়া না দিলে ব্যর্থ ধরা হয় */
  dbTimeoutMs?: number;
}

/**
 * URL-ক্রেডেনশিয়াল-মাস্ক (user:pass@host → ***@host) — দুই স্তরে প্রয়োগ:\n *  ① খাঁটি প্রোব/truncateMsg-স্তরে; ② runHealthChecks-এর রিপোর্ট-সীমানায়
 *  (প্রতিরক্ষা-গভীরতা — ভবিষ্যতের কোনো প্রোব ভুলে গেলেও ফাঁস হবে না)।
 */
const maskUrlCredentials = (s: string): string =>
  s
    .replace(/\/\/[^/@\s:]+:[^@\s/]*@/g, '//***@')
    .replace(/\/\/[^/@\s]+@/g, '//***@');

/**
 * ত্রুটি-স্ট্রিং নিরাপত্তা-চুক্তি:
 *  ① ২০০ অক্ষরে সীমিত;
 *  ② URL-এ এমবেড করা ক্রেডেনশিয়াল মাস্ক — ডেটাবেস-সংযোগ-ত্রুটি কখনো
 *     গোপন মান ফাঁস দেবে না (postgres://u:SECRET@h → postgres://***@h)।
 */
const truncateMsg = (err: unknown): string =>
  maskUrlCredentials(String((err as { message?: string } | null | undefined)?.message ?? err)).slice(0, 200);

/** রিপোর্ট-সীমানার শেষ-প্রহর (undefined অপরিবর্তিত থাকে) */
const sanitizeError = (s: string | undefined): string | undefined =>
  s === undefined ? undefined : maskUrlCredentials(s).slice(0, 200);

/** স্টোরেজ-রুট — সব রানটাইম-পথের মতোই process.cwd() ভিত্তিক */
export function storageRoot(): string {
  return path.join(process.cwd(), 'storage');
}

/**
 * স্টোরেজ-লেখার সক্ষমতা-প্রোব: mkdir + ১-বাইট লেখা + মুছে ফেলা।
 * রেডিপ্লয়/ভলিউম-মাউন্ট ভুল হলে এখানেই ধরা পড়বে (Railway volume)।
 */
export async function probeStorageWritable(): Promise<StorageCheck> {
  const dir = storageRoot();
  try {
    await mkdir(dir, { recursive: true });
    const probe = path.join(dir, '.health-probe');
    await writeFile(probe, 'ok', 'utf8');
    await unlink(probe);
    return { ok: true, path: dir };
  } catch (err) {
    return { ok: false, path: dir, error: truncateMsg(err) };
  }
}

/** ffmpeg-প্রোব ক্যাশ (৬০ সে.) — HMR-নিরাপদ globalThis-প্যাটান (/api/hardware-এর মতো) */
const FFMPEG_PROBE_TTL_MS = 60_000;
const g = globalThis as { __healthFfmpegCache?: { at: number; check: FfmpegCheck } };

export async function probeFfmpeg(): Promise<FfmpegCheck> {
  const cached = g.__healthFfmpegCache;
  if (cached && Date.now() - cached.at < FFMPEG_PROBE_TTL_MS) return cached.check;

  let check: FfmpegCheck;
  try {
    const { stdout } = await execFileAsync('ffmpeg', ['-version'], { timeout: 5_000 });
    const version = (stdout.match(/ffmpeg version ([^\s]+)/) ?? [])[1] ?? null;
    check = version
      ? { ok: true, version }
      : { ok: false, error: 'ffmpeg -version ফলাফল পার্স করা যায়নি' };
  } catch (err) {
    check = { ok: false, error: truncateMsg(err) };
  }
  g.__healthFfmpegCache = { at: Date.now(), check };
  return check;
}

/** মূল নিরীক্ষণ-সমষ্টি — কোনো পার্শ্ব-প্রভাব নেই, শুধু ইনজেকশন চালায় */
export async function runHealthChecks(deps: HealthDeps): Promise<HealthReport> {
  // ১) ডেটাবেস — একমাত্র 'error'-স্তরের নিরীক্ষা
  const dbTimeoutMs = deps.dbTimeoutMs ?? 3_000;
  const dbStart = Date.now();
  let database: DbCheck;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`db ping timeout after ${dbTimeoutMs}ms`)), dbTimeoutMs);
    });
    // টাইমার যেন প্রসেস-শাটডাউন আটকে না রাখে (টেস্ট/একক-কমান্ডে)
    (timer as unknown as { unref?: () => void } | undefined)?.unref?.();
    await Promise.race([deps.countFn(), timeout]);
    database = { ok: true, latencyMs: Date.now() - dbStart };
  } catch (err) {
    database = { ok: false, latencyMs: Date.now() - dbStart, error: truncateMsg(err) };
  }

  // ২) বাকি প্রোবগুলো সমান্তরাল — স্বাধীন
  const envReport = deps.envReport ?? validateEnv();
  const production = envReport.production;
  const missingRequired = envReport.items
    .filter(i => !i.ok && i.level === 'required')
    .map(i => i.key);
  const missingRecommended = envReport.items
    .filter(i => !i.ok && i.level === 'recommended')
    .map(i => i.key);
  const env: EnvHealthCheck = {
    ok: missingRequired.length === 0 && !(production && missingRecommended.length > 0),
    production,
    missingRequired,
    missingRecommended,
  };

  const [storage, ffmpeg] = await Promise.all([deps.probeStorage(), deps.probeFfmpeg()]);

  const providers: ProvidersCheck = {
    zaiSdk: (deps.zaiConfigured ?? zAiConfigured)() ? 'configured' : 'not-configured',
  };

  const status: HealthStatus = !database.ok
    ? 'error'
    : !storage.ok || !ffmpeg.ok || !env.ok
      ? 'degraded'
      : 'ok';

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    checks: {
      database: { ...database, error: sanitizeError(database.error) },
      storage: { ...storage, error: sanitizeError(storage.error) },
      ffmpeg: { ...ffmpeg, error: sanitizeError(ffmpeg.error) },
      env,
      providers,
    },
  };
}

/** HTTP-স্ট্যাটাস-ম্যাপিং — error=503, বাকি সব 200 */
export function healthStatusCode(report: HealthReport): 200 | 503 {
  return report.status === 'error' ? 503 : 200;
}
