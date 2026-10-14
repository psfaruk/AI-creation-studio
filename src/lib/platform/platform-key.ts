// ============================================================
// প্ল্যাটফর্ম-কী — অ্যাপের নিজস্ব OpenAI-কম্প্যাটিবল API-র
// (POST /api/v1/chat/completions, GET /api/v1/models) Bearer-কী।
//
// নকশা-সিদ্ধান্ত (মিনিমাল পুনরুদ্ধার — ইউজারের অনুরোধ):
//  - একটিই ব্যক্তিগত কী (একক-মালিক স্টুডিও) — পুরনো বহু-কী
//    ব্যবস্থার মতো জটিলতা নেই; কী ঘুরিয়ে (rotate) বদলানো যায়।
//  - storage/platform-key.json-এ থাকে (.gitignore-সুরক্ষিত —
//    কখনো GitHub-এ যায় না; 0600 best-effort)।
//  - যাচাই timing-safe তুলনায়।
//  - মালিক-সেশন টোকেনও Bearer-হিসেবে গ্রহণযোগ্য (v1-রাউটে) —
//    নিজের টেস্টের সুবিধা; কী হারালেও ঢোকা যায়।
// ============================================================

import { randomBytes, timingSafeEqual } from 'crypto';
import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

const PLATFORM_KEY_PATH = path.join(process.cwd(), 'storage', 'platform-key.json');

/** কী-প্রিফিক্স — পুরনো সিস্টেমের সাথে চেনা-জানা গঠন */
export const PLATFORM_KEY_PREFIX = 'amai_sk_';

export interface PlatformKeyRecord {
  version: 1;
  key: string;
  createdAt: string;
  /** সর্বশেষ rotate-এর সময় (প্রথম তৈরির সময় createdAt-এর সমান) */
  rotatedAt: string;
}

function isValidRecord(v: unknown): v is PlatformKeyRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    r.version === 1 &&
    typeof r.key === 'string' &&
    r.key.startsWith(PLATFORM_KEY_PREFIX) &&
    r.key.length === PLATFORM_KEY_PREFIX.length + 32 &&
    typeof r.createdAt === 'string' &&
    typeof r.rotatedAt === 'string'
  );
}

async function readRecord(): Promise<PlatformKeyRecord | null> {
  try {
    const raw = await readFile(PLATFORM_KEY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeRecord(record: PlatformKeyRecord): Promise<void> {
  await mkdir(path.dirname(PLATFORM_KEY_PATH), { recursive: true });
  await writeFile(PLATFORM_KEY_PATH, JSON.stringify(record, null, 2), 'utf8');
  try {
    await chmod(PLATFORM_KEY_PATH, 0o600);
  } catch {
    // best-effort
  }
}

function newKeyString(): string {
  return PLATFORM_KEY_PREFIX + randomBytes(16).toString('hex');
}

/** বর্তমান কী-রেকর্ড (raw) — না থাকলে null */
export async function getPlatformKeyRecord(): Promise<PlatformKeyRecord | null> {
  return readRecord();
}

/** কী না থাকলে তৈরি করে ফেরায়; থাকলে সেটিই */
export async function ensurePlatformKey(): Promise<PlatformKeyRecord> {
  const existing = await readRecord();
  if (existing) return existing;
  const now = new Date().toISOString();
  const record: PlatformKeyRecord = { version: 1, key: newKeyString(), createdAt: now, rotatedAt: now };
  await writeRecord(record);
  return record;
}

/** নতুন কী বসিয়ে পুরনোটি অচল (rotate) */
export async function rotatePlatformKey(): Promise<PlatformKeyRecord> {
  const existing = await readRecord();
  const now = new Date().toISOString();
  const record: PlatformKeyRecord = {
    version: 1,
    key: newKeyString(),
    createdAt: existing?.createdAt ?? now,
    rotatedAt: now,
  };
  await writeRecord(record);
  return record;
}

/** কী মুছে দেওয়া (revoke) — /api/v1 তখন শুধু মালিক-সেশনে চলবে */
export async function revokePlatformKey(): Promise<void> {
  await mkdir(path.dirname(PLATFORM_KEY_PATH), { recursive: true });
  await writeFile(PLATFORM_KEY_PATH, JSON.stringify(null), 'utf8');
  try {
    await chmod(PLATFORM_KEY_PATH, 0o600);
  } catch {
    // best-effort
  }
}

/** প্রদত্ত Bearer-মান প্ল্যাটফর্ম-কী-এর সাথে মেলে কি? (timing-safe) */
export async function verifyPlatformKey(candidate: string): Promise<boolean> {
  const record = await readRecord();
  if (!record) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(record.key);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** মাস্কড প্রিভিউ — UI-তে raw কী ডিফল্টভাবে নয় */
export function maskPlatformKey(key: string): string {
  if (key.length <= 12) return '••••••••';
  return `${key.slice(0, 11)}…${key.slice(-4)} (${key.length} অক্ষর)`;
}
