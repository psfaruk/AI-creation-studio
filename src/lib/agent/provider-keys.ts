// ============================================================
// এক্সটার্নাল-প্রোভাইডার API-কী স্টোর — server-only।
//
//  - কী-গুলো storage/provider-keys.json-এ স্থানীয়ভাবে থাকে
//    (.gitignore-সুরক্ষিত — কখনোই GitHub-এ যাবে না)।
//  - ফাইলে না থাকলে process.env ফলব্যাক
//    (DEEPSEEK_API_KEY / GLM_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY)।
//  - রেজল্যুশন-ক্রম: ফাইল → env → null।
//  - ক্লায়েন্টে কখনোই raw কী ফেরানো হয় না — শুধু মাস্কড অবস্থা।
// ============================================================

import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { PROVIDERS, isExternalProvider, type ChatProviderId } from './chat-models';

const KEYS_PATH = path.join(process.cwd(), 'storage', 'provider-keys.json');

/** কী ফাইলের আকৃতি: { "zai-api": "id.secret", "glm": "…" } */
type KeyFile = Partial<Record<ChatProviderId, string>>;

const g = globalThis as unknown as { __providerKeyCache?: { at: number; data: KeyFile } };
/** ফাইল-ক্যাশ (৫ সে.) — একই রানের বারবার fs-read এড়াতে */
function cacheTTL(): number {
  return 5_000;
}

async function readKeyFile(): Promise<KeyFile> {
  const cached = g.__providerKeyCache;
  if (cached && Date.now() - cached.at < cacheTTL()) return cached.data;
  let data: KeyFile = {};
  try {
    const raw = await readFile(KEYS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as KeyFile;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      data = parsed;
    }
  } catch {
    data = {};
  }
  g.__providerKeyCache = { at: Date.now(), data: { ...data } };
  return data;
}

async function writeKeyFile(data: KeyFile): Promise<void> {
  await mkdir(path.dirname(KEYS_PATH), { recursive: true });
  await writeFile(KEYS_PATH, JSON.stringify(data, null, 2), 'utf8');
  try {
    // শুধু-মালিক-পাঠযোগ্য — কী-ফাইলের স্বাভাবিক নিরাপত্তা
    await chmod(KEYS_PATH, 0o600);
  } catch {
    // উইন্ডোজ/অসমর্থিত FS-এ নীরব
  }
  g.__providerKeyCache = { at: Date.now(), data: { ...data } };
}

function isProviderId(v: unknown): v is ChatProviderId {
  return typeof v === 'string' && v in PROVIDERS;
}

/** কী-মানের আকার-যাচাই (শিথল কিন্তু অর্থহীন ইনপুট আটকায়) */
export function isValidApiKeyShape(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const t = key.trim();
  return t.length >= 8 && t.length <= 500 && !/\s/.test(t);
}

/** প্রোভাইডারের কী — ফাইল → env → null (server-only) */
export async function getProviderKey(provider: ChatProviderId): Promise<string | null> {
  if (!isProviderId(provider) || !isExternalProvider(provider)) return null;
  const file = await readKeyFile();
  const fromFile = file[provider];
  if (typeof fromFile === 'string' && fromFile.trim() !== '') return fromFile.trim();
  const envName = PROVIDERS[provider].envVar;
  const fromEnv = envName ? process.env[envName] : undefined;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return null;
}

/** কী সংরক্ষণ (ফাইলে; env-কে ওভাররাইড করে না — রেজল্যুশনে ফাইল আগে) */
export async function setProviderKey(provider: ChatProviderId, key: string): Promise<void> {
  if (!isProviderId(provider) || !isExternalProvider(provider)) {
    throw new Error('অজানা এক্সটার্নাল প্রোভাইডার');
  }
  const file = await readKeyFile();
  file[provider] = key.trim();
  await writeKeyFile(file);
}

/** কী মুছে ফেলা (ফাইল থেকে; env-ফলব্যাক থাকলে সেটাই আবার কাজে আসবে) */
export async function clearProviderKey(provider: ChatProviderId): Promise<void> {
  if (!isProviderId(provider) || !isExternalProvider(provider)) {
    throw new Error('অজানা এক্সটার্নাল প্রোভাইডার');
  }
  const file = await readKeyFile();
  delete file[provider];
  await writeKeyFile(file);
}

/** মাস্কিং — raw কী কখনোই UI-তে যাবে না */
function maskKey(key: string): string {
  if (key.length <= 10) return '••••••••';
  return `${key.slice(0, 4)}…${key.slice(-3)} (${key.length} অক্ষর)`;
}

export interface ProviderKeyStatus {
  hasKey: boolean;
  /** মাস্কড প্রিভিউ — শুধু কী থাকলে */
  masked: string | null;
  /** কোথা থেকে এল */
  source: 'file' | 'env' | null;
}

/** সব এক্সটার্নাল প্রোভাইডারের কী-অবস্থা (মাস্কড) */
export async function providerKeyStatuses(): Promise<Record<string, ProviderKeyStatus>> {
  const file = await readKeyFile();
  const out: Record<string, ProviderKeyStatus> = {};
  for (const p of Object.values(PROVIDERS)) {
    if (p.kind !== 'external') continue;
    const fromFile = file[p.id];
    if (typeof fromFile === 'string' && fromFile.trim() !== '') {
      out[p.id] = { hasKey: true, masked: maskKey(fromFile.trim()), source: 'file' };
      continue;
    }
    const envName = p.envVar;
    const fromEnv = envName ? process.env[envName] : undefined;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
      out[p.id] = { hasKey: true, masked: maskKey(fromEnv.trim()), source: 'env' };
      continue;
    }
    out[p.id] = { hasKey: false, masked: null, source: null };
  }
  return out;
}
