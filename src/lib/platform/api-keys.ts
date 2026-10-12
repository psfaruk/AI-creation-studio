// ============================================================
// api-keys.ts — প্ল্যাটফর্ম API-কী ব্যবস্থাপনা (server-only)
//
// ব্যবহারকারীর নিজ-প্ল্যাটফর্মের নিয়ম হুবহু:
//  - প্রতিটি কী একটি মডেলের সাথে বাঁধা (Model-bound)
//  - কী-ভিত্তিক রেট-লিমিট (ডিফল্ট ১২০ req/min)
//  - প্রতিটি কল লগ হয় (endpoint, মডেল, স্ট্যাটাস, latency)
//  - কী কখনোই পরিষ্কার অবস্থায় জমা থাকে না — কেবল SHA-256 হ্যাশ
//  - প্রদর্শনে মাস্কড রূপ: amai_sk_413d…6019
//
// কী-এর আকৃতি: amai_sk_ + ৩২টি hex-অক্ষর (১৬ র‍্যান্ডম বাইট)
// ============================================================

import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { findPlatformModel, PLATFORM_MODELS } from './platform-models';

export const KEY_PREFIX = 'amai_sk_';

/** নতুন কী তৈরি: {full (একবারই দেখানো), masked, hash} */
export function generateApiKey(): { full: string; masked: string; hash: string } {
  const bytes = randomBytes(16);
  const hex = bytes.toString('hex'); // ৩২ অক্ষর
  const full = `${KEY_PREFIX}${hex}`;
  return { full, masked: maskKey(full), hash: hashKey(full) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** amai_sk_413d…6019 রূপে মাস্ক */
export function maskKey(full: string): string {
  if (!full.startsWith(KEY_PREFIX)) return `${full.slice(0, 8)}…${full.slice(-4)}`;
  const body = full.slice(KEY_PREFIX.length);
  if (body.length <= 8) return full;
  return `${KEY_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

export interface CreateKeyInput {
  name: string;
  modelId: string;
  rateLimitPerMin?: number;
  defaultLanguage?: 'auto' | 'bn' | 'en';
}

export interface CreateKeyResult {
  id: string;
  full: string; // কেবল তৈরির মুহূর্তে — আর কখনো ফেরানো হয় না
  masked: string;
  record: {
    id: string;
    name: string;
    modelId: string;
    rateLimitPerMin: number;
    defaultLanguage: string;
    status: string;
    createdAt: string;
  };
}

export async function createApiKey(input: CreateKeyInput): Promise<CreateKeyResult> {
  const model = findPlatformModel(input.modelId);
  if (!model) {
    throw new Error(`অজানা মডেল: ${input.modelId} — প্ল্যাটফর্ম-তালিকায় নেই`);
  }
  const name = (input.name ?? '').trim().slice(0, 60) || 'unnamed';
  const rate = Math.max(1, Math.min(600, Math.round(input.rateLimitPerMin ?? 120)));
  const lang = input.defaultLanguage ?? 'auto';
  const { full, masked, hash } = generateApiKey();

  const rec = await db.apiKey.create({
    data: {
      name,
      keyHash: hash,
      keyMasked: masked,
      modelId: model.id,
      rateLimitPerMin: rate,
      defaultLanguage: lang,
      status: 'active',
    },
  });

  return {
    id: rec.id,
    full,
    masked,
    record: {
      id: rec.id,
      name: rec.name,
      modelId: rec.modelId,
      rateLimitPerMin: rec.rateLimitPerMin,
      defaultLanguage: rec.defaultLanguage,
      status: rec.status,
      createdAt: rec.createdAt.toISOString(),
    },
  };
}

// ------------------------------------------------------------
// প্রমাণীকরণ + রেট-লিমিট — /api/v1/* রাউটগুলো ব্যবহার করে
// ------------------------------------------------------------

export interface AuthKeyResult {
  ok: true;
  key: {
    id: string;
    name: string;
    modelId: string;
    rateLimitPerMin: number;
    defaultLanguage: string;
  };
}

export interface AuthKeyError {
  ok: false;
  status: number; // 401 | 403 | 429
  code: string;
  message: string;
}

/** Authorization: Bearer amai_sk_... যাচাই (কী-হ্যাশ → রেকর্ড → স্ট্যাটাস → বাইন্ডিং → রেট-লিমিট) */
export async function authenticateApiKey(
  bearer: string | null,
  wantModel?: string
): Promise<AuthKeyResult | AuthKeyError> {
  if (!bearer) {
    return {
      ok: false,
      status: 401,
      code: 'missing_api_key',
      message:
        'API কী দেওয়া হয়নি — Authorization: Bearer amai_sk_… হেডার পাঠান (কী তৈরি করুন: Keys প্যানেল)',
    };
  }
  const key = bearer.replace(/^Bearer\s+/i, '').trim();
  if (!key.startsWith(KEY_PREFIX)) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_api_key',
      message: `কী-এর আকৃতি ভুল — ${KEY_PREFIX}… দিয়ে শুরু হতে হবে`,
    };
  }
  const hash = hashKey(key);
  const rec = await db.apiKey.findUnique({ where: { keyHash: hash } });
  if (!rec) {
    return {
      ok: false,
      status: 401,
      code: 'invalid_api_key',
      message: 'কী পাওয়া যায়নি — বাতিল বা ভুল কী',
    };
  }
  if (rec.status !== 'active') {
    return {
      ok: false,
      status: 403,
      code: 'key_revoked',
      message: `এই কীটি বাতিল করা হয়েছে (${rec.revokedAt?.toISOString() ?? ''})`,
    };
  }
  // মডেল-বাইন্ডিং: কী কেবল তার নিজের মডেলে ডাকতে পারে
  if (wantModel && wantModel !== rec.modelId) {
    return {
      ok: false,
      status: 403,
      code: 'model_not_bound',
      message: `এই কীটি কেবল "${rec.modelId}"-এ বাঁধা — "${wantModel}" ডাকতে চাইলে সেই মডেলের আলাদা কী তৈরি করুন`,
    };
  }
  // রেট-লিমিট: শেষ ৬০ সেকেন্ডের কল-সংখ্যা
  const windowStart = new Date(Date.now() - 60_000);
  const recent = await db.apiCallLog.count({
    where: { keyId: rec.id, createdAt: { gte: windowStart } },
  });
  if (recent >= rec.rateLimitPerMin) {
    return {
      ok: false,
      status: 429,
      code: 'rate_limit_exceeded',
      message: `রেট-লিমিট ছাড়িয়েছে: ${rec.rateLimitPerMin} req/min (কী: ${rec.keyMasked}) — কিছুক্ষণ পরে আবার`,
    };
  }
  return {
    ok: true,
    key: {
      id: rec.id,
      name: rec.name,
      modelId: rec.modelId,
      rateLimitPerMin: rec.rateLimitPerMin,
      defaultLanguage: rec.defaultLanguage,
    },
  };
}

// ------------------------------------------------------------
// কল-লগিং + পরিসংখ্যান
// ------------------------------------------------------------

export async function logApiCall(input: {
  keyId: string;
  endpoint: string;
  model?: string | null;
  status: number;
  latencyMs: number;
  error?: string | null;
}): Promise<void> {
  try {
    await db.apiCallLog.create({
      data: {
        keyId: input.keyId,
        endpoint: input.endpoint,
        model: input.model ?? null,
        status: input.status,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        error: input.error ? input.error.slice(0, 300) : null,
      },
    });
    await db.apiKey.update({
      where: { id: input.keyId },
      data: { lastUsedAt: new Date(), totalRequests: { increment: 1 } },
    });
  } catch {
    // লগ-ব্যর্থতা মূল কলকে ভাঙবে না
  }
}

export interface KeyStats {
  totalRequests: number;
  last24h: number;
  avgLatencyMs: number | null;
  lastUsedAt: string | null;
  recentErrors: Array<{ at: string; status: number; error: string | null; endpoint: string }>;
}

export async function keyStats(keyId: string): Promise<KeyStats> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [key, last24, agg, lastUsed, recent] = await Promise.all([
    db.apiKey.findUnique({ where: { id: keyId } }),
    db.apiCallLog.count({ where: { keyId, createdAt: { gte: since24h } } }),
    db.apiCallLog.aggregate({
      where: { keyId },
      _avg: { latencyMs: true },
    }),
    db.apiCallLog.findFirst({ where: { keyId }, orderBy: { createdAt: 'desc' } }),
    db.apiCallLog.findMany({
      where: { keyId, status: { gte: 400 } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
  ]);
  return {
    totalRequests: key?.totalRequests ?? 0,
    last24h: last24,
    avgLatencyMs: agg._avg.latencyMs != null ? Math.round(agg._avg.latencyMs) : null,
    lastUsedAt: lastUsed?.createdAt?.toISOString() ?? key?.lastUsedAt?.toISOString() ?? null,
    recentErrors: recent.map(r => ({
      at: r.createdAt.toISOString(),
      status: r.status,
      error: r.error,
      endpoint: r.endpoint,
    })),
  };
}

// ------------------------------------------------------------
// তালিকা / বাতিল
// ------------------------------------------------------------

export async function listApiKeys(): Promise<
  Array<{
    id: string;
    name: string;
    keyMasked: string;
    modelId: string;
    rateLimitPerMin: number;
    defaultLanguage: string;
    status: string;
    createdAt: string;
    revokedAt: string | null;
    stats: KeyStats;
  }>
> {
  const keys = await db.apiKey.findMany({ orderBy: { createdAt: 'desc' } });
  return Promise.all(
    keys.map(async k => ({
      id: k.id,
      name: k.name,
      keyMasked: k.keyMasked,
      modelId: k.modelId,
      rateLimitPerMin: k.rateLimitPerMin,
      defaultLanguage: k.defaultLanguage,
      status: k.status,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
      stats: await keyStats(k.id),
    }))
  );
}

export async function revokeApiKey(id: string): Promise<boolean> {
  const rec = await db.apiKey.findUnique({ where: { id } });
  if (!rec || rec.status !== 'active') return false;
  await db.apiKey.update({
    where: { id },
    data: { status: 'revoked', revokedAt: new Date() },
  });
  return true;
}

/** কী-তৈরির ফর্মের জন্য মডেল-তালিকা (kind-সহ, client-safe) */
export function platformModelOptions() {
  return PLATFORM_MODELS.map(m => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    description: m.description,
    backend: m.backend,
    sizes: m.sizes,
  }));
}
