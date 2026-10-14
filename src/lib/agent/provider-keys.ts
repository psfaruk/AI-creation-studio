// ============================================================
// এক্সটার্নাল-প্রোভাইডার API-কী + Base URL স্টোর — server-only।
//
//  - প্রতিটি প্রোভাইডারের এন্ট্রি: { key, baseURL? }
//      key     = API কী (গোপন — কখনোই UI-তে raw রূপে ফেরানো হয় না)
//      baseURL = ঐচ্ছিক কাস্টম Base URL ওভাররাইড (গোপন নয় —
//                ইউজারের নিজের লেখা এন্ডপয়েন্ট; ফাঁকা হলে প্রোভাইডারের
//                অফিসিয়াল ডিফল্ট ব্যবহৃত হয়)
//  - storage/provider-keys.json-এ স্থানীয়ভাবে থাকে
//    (.gitignore-সুরক্ষিত — কখনোই GitHub-এ যাবে না)।
//  - পুরনো ফরম্যাট (মান = খালি কী-স্ট্রিং) পড়ার সময় নতুন শেপে
//    নরমালাইজ হয় — মাইগ্রেশন স্বয়ংক্রিয়।
//  - কী-রেজল্যুশন-ক্রম: ফাইল → env → null।
//    (baseURL-ওভাররাইডের env-ফলব্যাক নেই — শুধু ফাইল/ইনপুট থেকে)
// ============================================================

import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { PROVIDERS, isExternalProvider, type ChatProviderId } from './chat-models';

const KEYS_PATH = path.join(process.cwd(), 'storage', 'provider-keys.json');

/** প্রোভাইডার-এন্ট্রির নতুন আকৃতি */
export interface ProviderKeyEntry {
  /** API কী (গোপন) */
  key: string;
  /** ঐচ্ছিক Base URL ওভাররাইড — ফাঁকা/অনুপস্থিত = প্রোভাইডার-ডিফল্ট */
  baseURL?: string;
}

/** কী ফাইলের আকৃতি: { "zai-api": { key, baseURL? }, "glm": {…} } (পুরনো: string) */
type KeyFile = Partial<Record<ChatProviderId, ProviderKeyEntry | string>>;

const g = globalThis as unknown as { __providerKeyCache?: { at: number; data: Record<string, ProviderKeyEntry> } };
/** ফাইল-ক্যাশ (৫ সে.) — একই রানের বারবার fs-read এড়াতে */
function cacheTTL(): number {
  return 5_000;
}

/** পুরনো (string) বা নতুন (object) মান → ProviderKeyEntry */
function normalizeEntry(v: ProviderKeyEntry | string | undefined): ProviderKeyEntry | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : { key: t };
  }
  if (v && typeof v === 'object' && typeof v.key === 'string' && v.key.trim() !== '') {
    return { key: v.key.trim(), ...(typeof v.baseURL === 'string' && v.baseURL.trim() !== '' ? { baseURL: v.baseURL.trim() } : {}) };
  }
  return null;
}

async function readKeyFile(): Promise<Record<string, ProviderKeyEntry>> {
  const cached = g.__providerKeyCache;
  if (cached && Date.now() - cached.at < cacheTTL()) return cached.data;
  const data: Record<string, ProviderKeyEntry> = {};
  try {
    const raw = await readFile(KEYS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as KeyFile;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [provider, entry] of Object.entries(parsed)) {
        const norm = normalizeEntry(entry as ProviderKeyEntry | string);
        if (norm) data[provider] = norm;
      }
    }
  } catch {
    // ফাইল নেই/পড়া গেল না — খালি অবস্থা
  }
  g.__providerKeyCache = { at: Date.now(), data: { ...data } };
  return data;
}

async function writeKeyFile(data: Record<string, ProviderKeyEntry>): Promise<void> {
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

/**
 * Base URL-এর আকার-যাচাই — http(s) URL, ভেতরে সাদাস্থান নয়,
 * যুক্তিসঙ্গত দৈর্ঘ্য। OpenAI-কম্প্যাটিবল যে-কোনো এন্ডপয়েন্ট
 * (api.z.ai, open.bigmodel.cn, নিজস্ব প্রক্সি, এই অ্যাপের /api/v1 — সব চলে)।
 */
export function isValidBaseURLShape(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const t = url.trim();
  if (t.length < 8 || t.length > 300 || /\s/.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** প্রোভাইডারের কার্যকর Base URL — ওভাররাইড → প্রোভাইডার-ডিফল্ট (server-only) */
export async function getProviderBaseURL(provider: ChatProviderId): Promise<string | null> {
  if (!isProviderId(provider) || !isExternalProvider(provider)) return null;
  const file = await readKeyFile();
  const entry = file[provider];
  const override = entry?.baseURL;
  if (override && isValidBaseURLShape(override)) return override.trim();
  const def = PROVIDERS[provider].baseURL;
  return def ?? null;
}

/** প্রোভাইডারের কী — ফাইল → env → null (server-only) */
export async function getProviderKey(provider: ChatProviderId): Promise<string | null> {
  if (!isProviderId(provider) || !isExternalProvider(provider)) return null;
  const file = await readKeyFile();
  const fromFile = file[provider]?.key;
  if (typeof fromFile === 'string' && fromFile.trim() !== '') return fromFile.trim();
  const envName = PROVIDERS[provider].envVar;
  const fromEnv = envName ? process.env[envName] : undefined;
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim();
  return null;
}

/**
 * কী (এবং ঐচ্ছিক Base URL) সংরক্ষণ — এন্ট্রি পুরোটা একসাথে লেখা হয়।
 * baseURL অনুপস্থিত হলে বিদ্যমান ওভাররাইড অক্ষত থাকে।
 */
export async function setProviderKey(provider: ChatProviderId, key: string, baseURL?: string | null): Promise<void> {
  if (!isProviderId(provider) || !isExternalProvider(provider)) {
    throw new Error('অজানা এক্সটার্নাল প্রোভাইডার');
  }
  const file = await readKeyFile();
  const prev = file[provider];
  const next: ProviderKeyEntry = { key: key.trim() };
  if (baseURL != null) {
    const t = baseURL.trim();
    if (t !== '') next.baseURL = t;
  } else if (prev?.baseURL) {
    next.baseURL = prev.baseURL;
  }
  file[provider] = next;
  await writeKeyFile(file);
}

/**
 * শুধু Base URL ওভাররাইড আপডেট — বিদ্যমান কী অক্ষত থাকে।
 * baseURL = null/'' হলে ওভাররাইড মুছে প্রোভাইডার-ডিফল্টে ফেরে।
 */
export async function setProviderBaseURL(provider: ChatProviderId, baseURL: string | null): Promise<void> {
  if (!isProviderId(provider) || !isExternalProvider(provider)) {
    throw new Error('অজানা এক্সটার্নাল প্রোভাইডার');
  }
  const file = await readKeyFile();
  const prev = file[provider];
  if (!prev) {
    // কী এখনো নেই — কী-বিহীন এন্ট্রি অর্থহীন (পড়ার সময়ই বাদ পড়ে)।
    // URL-ওভাররাইড শুধু কী-সহ এন্ট্রিতেই থাকে — UI-তে কী ছাড়া সেভ
    // আটকানো হয়, এখানে নীরব no-op।
    return;
  }
  const t = baseURL == null ? '' : baseURL.trim();
  if (t === '') {
    const { key } = prev;
    file[provider] = { key };
  } else {
    file[provider] = { key: prev.key, baseURL: t };
  }
  await writeKeyFile(file);
}

/** কী মুছে ফেলা — এন্ট্রি পুরোটা (কী + Base URL-ওভাররাইড) বাদ যায় */
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
  /** চালু Base URL ওভাররাইড (গোপন নয়) — না থাকলে null (= ডিফল্ট) */
  baseURL: string | null;
  /** প্রোভাইডারের অফিসিয়াল ডিফল্ট Base URL */
  defaultBaseURL: string;
}

/** সব এক্সটার্নাল প্রোভাইডারের কী-অবস্থা (মাস্কড) + Base URL তথ্য */
export async function providerKeyStatuses(): Promise<Record<string, ProviderKeyStatus>> {
  const file = await readKeyFile();
  const out: Record<string, ProviderKeyStatus> = {};
  for (const p of Object.values(PROVIDERS)) {
    if (p.kind !== 'external') continue;
    const entry = file[p.id];
    const defaultBaseURL = p.baseURL ?? '';
    if (entry && typeof entry.key === 'string' && entry.key.trim() !== '') {
      out[p.id] = {
        hasKey: true,
        masked: maskKey(entry.key.trim()),
        source: 'file',
        baseURL: entry.baseURL ?? null,
        defaultBaseURL,
      };
      continue;
    }
    const envName = p.envVar;
    const fromEnv = envName ? process.env[envName] : undefined;
    if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
      out[p.id] = {
        hasKey: true,
        masked: maskKey(fromEnv.trim()),
        source: 'env',
        baseURL: entry?.baseURL ?? null,
        defaultBaseURL,
      };
      continue;
    }
    out[p.id] = {
      hasKey: false,
      masked: null,
      source: null,
      baseURL: entry?.baseURL ?? null,
      defaultBaseURL,
    };
  }
  return out;
}
