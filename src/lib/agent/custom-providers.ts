// ============================================================
// কাস্টম API-প্ল্যাটফর্ম স্টোর — server-only।
//
// ব্যবহারকারীর নিজ-নির্মিত (self-hosted) OpenAI-কম্প্যাটিবল
// সিস্টেম যুক্ত করার পথ — Base URL + API Key + মডেল-নির্বাচন
// (+ ভাষা)। উদাহরণ-প্ল্যাটফর্ম:
//   Base URL: https://<host>/api/v1
//   Key:      amai_sk_… (মডেল-বাউন্ড, রেট-লিমিটেড, SHA-256-হ্যাশড)
//   Endpoints: GET /models · POST /chat/completions (stream + vision)
//             POST /images/generations
//
// সততার নিয়ম (আগের সব সিস্টেমের মতোই):
//  - প্রতিটি চ্যাট-কল ব্যবহারকারীর দেওয়া প্রকৃত Base URL-এ যায়
//    — ব্যাকএন্ডে GLM লুকিয়ে "কাস্টম" লেবেল নয়।
//  - কী-সমস্যা/নেটওয়ার্ক-সমস্যায় সৎ ত্রুটি; নীরব ফলব্যাক নিষিদ্ধ।
//  - কী কেবল লোকাল storage/custom-providers.json-এ (.gitignore-সুরক্ষিত);
//    API-উত্তরে কখনোই পূর্ণ কী ফেরে না — শুধু মাস্কড।
//  - মডেল-আইডি ফরম্যাট: custom:<providerId>:<apiModel>
//    (apiModel-এ কোলন থাকতে পারে — প্রথম দুটি কোলনেই ভাগ)।
// ============================================================

import { chmod, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import OpenAI from 'openai';
import type { ChatModelOption, ModelVerificationEntry } from './chat-models';
import {
  ExternalFatalError,
  ExternalRetryableError,
  toExternalMessages,
  type ExternalLLMMessage,
} from './external-llm';

const STORE_PATH = path.join(process.cwd(), 'storage', 'custom-providers.json');

/** কাস্টম-প্ল্যাটফর্মে নির্বাচিত একটি মডেল */
export interface CustomProviderModel {
  /** প্রকৃত API model-স্ট্রিং (যেমন glm-5.3) */
  apiModel: string;
  /** UI-প্রদর্শন-লেবেল (যেমন GLM-5.3) */
  label: string;
  addedAt: string;
}

/** একটি সংরক্ষিত কাস্টম প্ল্যাটফর্ম */
export interface CustomProvider {
  id: string; // cp_xxxxxxxx
  name: string;
  baseUrl: string;
  apiKey: string; // কেবল লোকাল-স্টোরেজে; API-উত্তরে কখনোই না
  language: 'auto' | 'bn' | 'en';
  models: CustomProviderModel[];
  createdAt: string;
  lastSyncAt?: string;
}

/** API-উত্তরের আকৃতি — কী মাস্কড */
export interface CustomProviderView {
  id: string;
  name: string;
  baseUrl: string;
  keyMasked: string;
  language: 'auto' | 'bn' | 'en';
  modelCount: number;
  createdAt: string;
  lastSyncAt?: string;
}

type ProviderFile = CustomProvider[];

const g = globalThis as unknown as { __customProviderCache?: { at: number; data: ProviderFile } };
const CACHE_TTL_MS = 4_000;

async function readStore(): Promise<ProviderFile> {
  const cached = g.__customProviderCache;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  let data: ProviderFile = [];
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ProviderFile;
    if (Array.isArray(parsed)) data = parsed.filter(p => p && typeof p === 'object' && typeof p.id === 'string');
  } catch {
    data = [];
  }
  g.__customProviderCache = { at: Date.now(), data };
  return data;
}

async function writeStore(data: ProviderFile): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), 'utf8');
  try {
    await chmod(STORE_PATH, 0o600);
  } catch {
    // অসমর্থিত FS — নীরব
  }
  g.__customProviderCache = { at: Date.now(), data };
}

// ------------------------------------------------------------
// যাচাই-সহায়ক
// ------------------------------------------------------------

/** Base URL-এর আকার-যাচাই + নরমালাইজ (শেষের / বাদ) */
export function normalizeBaseUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  let s = url.toString();
  // শেষের স্ল্যাশ-গুলো বাদ — আমরা নিজেরাই /models, /chat/completions জোড়া দিই
  while (s.endsWith('/')) s = s.slice(0, -1);
  if (s.length < 8) return null;
  return s;
}

/** কী-আকার যাচাই (provider-keys-এর মতোই) */
export function isValidKeyShape(key: unknown): key is string {
  if (typeof key !== 'string') return false;
  const t = key.trim();
  return t.length >= 8 && t.length <= 500 && !/\s/.test(t);
}

function maskKey(key: string): string {
  if (key.length <= 10) return '••••••••';
  return `${key.slice(0, 8)}…${key.slice(-4)} (${key.length} অক্ষর)`;
}

function newProviderId(): string {
  return `cp_${randomBytes(4).toString('hex')}`;
}

/** apiModel → সুন্দর লেবেল (glm-5.3 → GLM-5.3; nvidia/x → NVIDIA X) */
export function prettyModelLabel(apiModel: string): string {
  let s = apiModel;
  const slash = s.lastIndexOf('/');
  if (slash >= 0) s = s.slice(slash + 1);
  const parts = s.split(/[-_.]/);
  const joined = parts
    .map(p => (p.length <= 3 && p === p.toLowerCase() && /^(glm|gpt|sora|tts|vl|sd|x$)/i.test(p) === false ? p.toUpperCase() : p))
    .join('-');
  // সংখ্যাযুক্ত সংস্করণ-অংশ বড় হাতের করা ঠিক নয় — glm-5.3 → GLM-5.3 রাখতে
  // প্রতিটি অংশের প্রথম অক্ষরটাই বড় করা যথেষ্ট নয়; সরল নিয়ম:
  // পুরো স্ট্রিং-এর প্রথম অক্ষর বড় + অভ্যন্তরীণ হাইফেন অক্ষত।
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return label || joined;
}

/** ইমেজ-মডেলের আন্দাজ (cogview/dall-e/flux/sd…-জাতীয় id চ্যাটে চলে না) */
export function looksLikeImageModel(apiModel: string): boolean {
  return /cogview|dall-?e|imagen|flux|stable-?diffusion|sd3|sdxl|image|banana/i.test(apiModel);
}

// ------------------------------------------------------------
// CRUD
// ------------------------------------------------------------

function toView(p: CustomProvider): CustomProviderView {
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    keyMasked: maskKey(p.apiKey),
    language: p.language,
    modelCount: p.models.length,
    createdAt: p.createdAt,
    lastSyncAt: p.lastSyncAt,
  };
}

/** সব কাস্টম প্ল্যাটফর্ম (কী মাস্কড) */
export async function listCustomProviders(): Promise<CustomProviderView[]> {
  const all = await readStore();
  return all.map(toView);
}

async function getProviderRaw(id: string): Promise<CustomProvider | null> {
  const all = await readStore();
  return all.find(p => p.id === id) ?? null;
}

export interface AddCustomProviderInput {
  name?: unknown;
  baseUrl: unknown;
  apiKey: unknown;
  language?: unknown;
  models?: unknown; // string[] (apiModel তালিকা)
}

/** নতুন কাস্টম প্ল্যাটফর্ম সংরক্ষণ — সৎ যাচাইসহ */
export async function addCustomProvider(
  input: AddCustomProviderInput
): Promise<{ ok: true; provider: CustomProviderView } | { ok: false; error: string }> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) {
    return { ok: false, error: 'Base URL সঠিক নয় — http(s):// দিয়ে শুরু হওয়া পূর্ণ URL দিন (যেমন https://example.com/api/v1)' };
  }
  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!isValidKeyShape(apiKey)) {
    return { ok: false, error: 'API কী সঠিক নয় — অন্তত ৮ অক্ষর, ভেতরে ফাঁকা-জায়গা নয়' };
  }
  const language: 'auto' | 'bn' | 'en' =
    input.language === 'bn' || input.language === 'en' || input.language === 'auto'
      ? input.language
      : 'auto';

  // মডেল-নির্বাচন: অন্তত একটি লাগবেই (চ্যাটে ব্যবহারযোগ্য হতে)
  if (!Array.isArray(input.models) || input.models.length === 0) {
    return { ok: false, error: 'অন্তত একটি মডেল নির্বাচন করুন — "মডেল তালিকা আনুন" চাপলে প্ল্যাটফর্মের লাইভ তালিকা আসে' };
  }
  const seen = new Set<string>();
  const models: CustomProviderModel[] = [];
  for (const raw of input.models) {
    if (typeof raw !== 'string') continue;
    const apiModel = raw.trim();
    if (!apiModel || apiModel.length > 200 || seen.has(apiModel)) continue;
    seen.add(apiModel);
    models.push({ apiModel, label: prettyModelLabel(apiModel), addedAt: new Date().toISOString() });
  }
  if (models.length === 0) {
    return { ok: false, error: 'মডেল-তালিকা খালি এসেছে — অন্তত একটি বৈধ মডেল-নাম লাগবে' };
  }

  // একই Base URL আগে থেকে থাকলে পুরনোটি প্রতিস্থাপিত হবে না — আলাদা এন্ট্রি যাবে;
  // তবে হুবহু একই URL+কী থাকলে সৎ জানাই
  const all = await readStore();
  const dupUrl = all.find(p => p.baseUrl === baseUrl);
  const name =
    typeof input.name === 'string' && input.name.trim() !== ''
      ? input.name.trim().slice(0, 60)
      : new URL(baseUrl).host;

  const provider: CustomProvider = {
    id: newProviderId(),
    name,
    baseUrl,
    apiKey,
    language,
    models,
    createdAt: new Date().toISOString(),
  };
  all.push(provider);
  await writeStore(all);
  return {
    ok: true,
    provider: toView(provider),
    ...(dupUrl ? { warning: `এই Base URL-এর আগের একটি এন্ট্রি (${dupUrl.name}) আছে — দুটিই আলাদাভাবে তালিকাভুক্ত থাকবে` } : {}),
  } as { ok: true; provider: CustomProviderView };
}

/** কাস্টম প্ল্যাটফর্ম মুছে ফেলা */
export async function removeCustomProvider(id: string): Promise<boolean> {
  const all = await readStore();
  const idx = all.findIndex(p => p.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  await writeStore(all);
  return true;
}

export interface UpdateCustomProviderInput {
  name?: unknown;
  language?: unknown;
  apiKey?: unknown;
  models?: unknown;
}

/** বিদ্যমান প্ল্যাটফর্ম হালনাগাদ (নাম/ভাষা/কী/মডেল-নির্বাচন) */
export async function updateCustomProvider(
  id: string,
  input: UpdateCustomProviderInput
): Promise<{ ok: true; provider: CustomProviderView } | { ok: false; error: string }> {
  const all = await readStore();
  const idx = all.findIndex(p => p.id === id);
  if (idx === -1) return { ok: false, error: 'প্ল্যাটফর্মটি খুঁজে পাওয়া যায়নি' };
  const p = all[idx];

  if (input.name !== undefined) {
    if (typeof input.name === 'string' && input.name.trim() !== '') {
      p.name = input.name.trim().slice(0, 60);
    }
  }
  if (input.language === 'auto' || input.language === 'bn' || input.language === 'en') {
    p.language = input.language;
  }
  if (input.apiKey !== undefined) {
    const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    if (apiKey === '') {
      // খালি স্ট্রিং = কী অপরিবর্তিত
    } else if (isValidKeyShape(apiKey)) {
      p.apiKey = apiKey;
    } else {
      return { ok: false, error: 'নতুন API কী-এর আকৃতি সঠিক নয়' };
    }
  }
  if (input.models !== undefined) {
    if (!Array.isArray(input.models) || input.models.length === 0) {
      return { ok: false, error: 'অন্তত একটি মডেল নির্বাচিত থাকতে হবে' };
    }
    const seen = new Set<string>();
    const models: CustomProviderModel[] = [];
    for (const raw of input.models) {
      if (typeof raw !== 'string') continue;
      const apiModel = raw.trim();
      if (!apiModel || apiModel.length > 200 || seen.has(apiModel)) continue;
      seen.add(apiModel);
      models.push({
        apiModel,
        label: prettyModelLabel(apiModel),
        addedAt: new Date().toISOString(),
      });
    }
    if (models.length === 0) return { ok: false, error: 'মডেল-তালিকা খালি' };
    p.models = models;
  }

  all[idx] = p;
  await writeStore(all);
  return { ok: true, provider: toView(p) };
}

// ------------------------------------------------------------
// লাইভ /models প্রোব (সংরক্ষণ ছাড়াই — যোগ-ডায়ালগ ও রিফ্রেশে)
// ------------------------------------------------------------

export interface ProbeResult {
  ok: boolean;
  /** পাওয়া মডেল-আইডির তালিকা (সর্বোচ্চ ১০০টি, নাম-ক্রমে) */
  models: string[];
  host?: string;
  ms?: number;
  error?: string;
  /** কী ভুল হলে true (401/403) */
  authFailed?: boolean;
}

/** প্ল্যাটফর্মের আসল GET /models-এ Bearer-সহ ডাক */
export async function probeProviderModels(baseUrlRaw: string, apiKeyRaw: string): Promise<ProbeResult> {
  const baseUrl = normalizeBaseUrl(baseUrlRaw);
  if (!baseUrl) return { ok: false, models: [], error: 'Base URL সঠিক নয়' };
  const apiKey = apiKeyRaw.trim();
  if (!isValidKeyShape(apiKey)) return { ok: false, models: [], error: 'API কী সঠিক নয়' };

  const host = (() => {
    try {
      return new URL(baseUrl).host;
    } catch {
      return baseUrl;
    }
  })();
  const t0 = Date.now();
  // OpenAI SDK-র models.list()-দিয়ে প্রোব — এই পথটি এই পরিবেশে
  // ইতিমধ্যে প্রমাণিত (verifyExternalModel একই ক্লায়েন্ট-স্ট্যাক ব্যবহার
  // করে সফলভাবে চলে); র-গ্লোবাল fetch Next-প্যাচ এড়াতে SDK নিজস্ব
  // টাইমআউট-সহ নির্ভরযোগ্য।
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      timeout: 20_000,
      maxRetries: 0,
    });
    // OpenAI SDK GET {base}/models-এ Bearer কী-সহ ডাকে
    const page = await client.models.list();
    const ms = Date.now() - t0;
    const ids = Array.from(new Set(page.data.map(m => m.id).filter(id => id && id.trim() !== '')))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 100);
    if (ids.length === 0) {
      return {
        ok: false,
        models: [],
        host,
        ms,
        error: '/models উত্তরে কোনো মডেল-আইডি পাওয়া যায়নি — নিচের ঘরে মডেল-নাম হাতে লিখে যোগ করতে পারেন',
      };
    }
    return { ok: true, models: ids, host, ms };
  } catch (err) {
    const ms = Date.now() - t0;
    const status = (err as { status?: unknown } | null)?.status;
    const statusNum = typeof status === 'number' ? status : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    if (statusNum === 401 || statusNum === 403) {
      return {
        ok: false,
        models: [],
        host,
        ms,
        authFailed: true,
        error: `কী গৃহীত হয়নি (HTTP ${statusNum}) — কীটি এই প্ল্যাটফর্মের নয়, নাকি বাতিল (revoked)?`,
      };
    }
    if (statusNum != null) {
      return {
        ok: false,
        models: [],
        host,
        ms,
        error: `HTTP ${statusNum} — ${msg.slice(0, 160)}`,
      };
    }
    return {
      ok: false,
      models: [],
      host,
      ms,
      error: /abort|timed? ?out|timeout/i.test(msg)
        ? 'সময়শেষ (২০ সে.) — প্ল্যাটফর্মে পৌঁছানো যায়নি'
        : `সংযোগ ব্যর্থ — ${msg.slice(0, 140)}`,
    };
  }
}

// ------------------------------------------------------------
// মডেল-আইডি রেজল্যুশন: custom:<providerId>:<apiModel>
// ------------------------------------------------------------

export const CUSTOM_MODEL_PREFIX = 'custom:';

export function isCustomModelId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(CUSTOM_MODEL_PREFIX);
}

/** কাস্টম-মডেল আইডি ভাঙা — [providerId, apiModel] (apiModel-এ কোলন থাকতে পারে) */
export function parseCustomModelId(id: string): { providerId: string; apiModel: string } | null {
  if (!isCustomModelId(id)) return null;
  const rest = id.slice(CUSTOM_MODEL_PREFIX.length);
  const firstColon = rest.indexOf(':');
  if (firstColon <= 0) return null;
  const providerId = rest.slice(0, firstColon);
  const apiModel = rest.slice(firstColon + 1);
  if (!providerId || !apiModel) return null;
  return { providerId, apiModel };
}

/** কাস্টম-মডেল আইডি বানানো */
export function buildCustomModelId(providerId: string, apiModel: string): string {
  return `${CUSTOM_MODEL_PREFIX}${providerId}:${apiModel}`;
}

/** সংরক্ষিত কাস্টম মডেলখানা ক্যাটালগ-সদৃশ এন্ট্রিতে রূপান্তর (UI-তালিকার জন্য) */
export async function customModelEntries(): Promise<ChatModelOption[]> {
  const all = await readStore();
  const out: ChatModelOption[] = [];
  for (const p of all) {
    const host = (() => {
      try {
        return new URL(p.baseUrl).host;
      } catch {
        return p.baseUrl;
      }
    })();
    for (const m of p.models) {
      out.push({
        id: buildCustomModelId(p.id, m.apiModel),
        label: `${m.label} (${p.name})`,
        description: `${host} · ${m.apiModel} — নিজের কাস্টম API-প্ল্যাটফর্মের প্রকৃত মডেল${p.language !== 'auto' ? ` · ভাষা: ${p.language === 'bn' ? 'বাংলা' : 'English'}` : ''}`,
        tags: looksLikeImageModel(m.apiModel) ? (['legacy'] as const) : ([] as const),
        contextK: 0,
        provider: 'custom',
        apiModel: m.apiModel,
        customProvider: {
          id: p.id,
          name: p.name,
          host,
          language: p.language,
        },
      });
    }
  }
  return out;
}

/** কাস্টম-মডেল আইডি → সেই এন্ট্রি + প্ল্যাটফর্ম-র কী (server-internal) */
export async function findCustomModel(
  id: string
): Promise<{ entry: ChatModelOption; provider: CustomProvider; model: CustomProviderModel } | null> {
  const parsed = parseCustomModelId(id);
  if (!parsed) return null;
  const p = await getProviderRaw(parsed.providerId);
  if (!p) return null;
  const m = p.models.find(x => x.apiModel === parsed.apiModel);
  if (!m) return null;
  const host = (() => {
    try {
      return new URL(p.baseUrl).host;
    } catch {
      return p.baseUrl;
    }
  })();
  return {
    entry: {
      id,
      label: `${m.label} (${p.name})`,
      description: `${host} · ${m.apiModel} — নিজের কাস্টম API-প্ল্যাটফর্ম`,
      tags: [],
      contextK: 0,
      provider: 'custom',
      apiModel: m.apiModel,
      customProvider: { id: p.id, name: p.name, host, language: p.language },
    },
    provider: p,
    model: m,
  };
}

/** কাস্টম-মডেল আইডিটি বর্তমানে বৈধ কি না (chat-route-এর যাচাইয়ের জন্য) */
export async function customModelExists(id: string): Promise<boolean> {
  return (await findCustomModel(id)) !== null;
}

// ------------------------------------------------------------
// চ্যাট-কম্প্লিশন — প্রকৃত OpenAI SDK দিয়ে ব্যবহারকারীর Base URL-এ
// ------------------------------------------------------------

const gClients = globalThis as unknown as { __customLlmClients?: Map<string, OpenAI> };

function getCustomClient(baseUrl: string, apiKey: string, timeoutMs: number): OpenAI {
  if (!gClients.__customLlmClients) gClients.__customLlmClients = new Map();
  const cacheKey = `${baseUrl}|${apiKey}`;
  const hit = gClients.__customLlmClients.get(cacheKey);
  if (hit) return hit;
  const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: timeoutMs, maxRetries: 0 });
  // একই প্ল্যাটফর্মের পুরনো-কী ক্লায়েন্ট বাদ
  for (const k of Array.from(gClients.__customLlmClients.keys())) {
    if (k.startsWith(`${baseUrl}|`)) gClients.__customLlmClients.delete(k);
  }
  gClients.__customLlmClients.set(cacheKey, client);
  return client;
}

/** ভাষা-নির্দেশ (প্ল্যাটফর্ম-সেটিং অনুযায়ী) — সিস্টেম-বার্তার শেষে জোড়া হয় */
function languageDirective(language: 'auto' | 'bn' | 'en'): string {
  if (language === 'bn') return '\n\nনির্দেশনা: ব্যবহারকারীর ভাষা যাই হোক, তোমার চূড়ান্ত উত্তর অবশ্যই বাংলা ভাষায় দাও।';
  if (language === 'en') return '\n\nInstruction: Regardless of the user language, always write your final answer in English.';
  return '';
}

/** কাস্টম প্ল্যাটফর্মে চ্যাট-কম্প্লিশন (llm.ts-এর রাউটিং থেকে ডাকা হয়) */
export async function customChatComplete(
  messages: ExternalLLMMessage[],
  modelId: string,
  opts?: {
    timeoutMs?: number;
    maxTokens?: number;
    /** লাইভ টোকেন-স্ট্রিম (llm.ts chatComplete থেকে আসে) */
    onDelta?: (delta: string) => void;
    onAttemptBegin?: () => void;
  }
): Promise<string> {
  const found = await findCustomModel(modelId);
  if (!found) {
    throw new ExternalFatalError(
      'কাস্টম মডেলটি আর তালিকায় নেই — মডেল-সিলেক্টর থেকে আবার বেছে নিন (প্ল্যাটফর্মটি সরানো বা মডেল-তালিকা বদলানো হয়েছে হতে পারে)'
    );
  }
  const { provider, model } = found;
  const timeoutMs = opts?.timeoutMs ?? 120_000;

  // সিস্টেম-বার্তায় ভাষা-নির্দেশ জোড়া (প্রথম assistant-বার্তা = সিস্টেম কনভেনশন)
  const converted = toExternalMessages(messages);
  if (converted.length > 0 && converted[0].role === 'system') {
    converted[0] = { role: 'system', content: converted[0].content + languageDirective(provider.language) };
  } else {
    converted.unshift({ role: 'system', content: languageDirective(provider.language).trim() });
  }

  const client = getCustomClient(provider.baseUrl, provider.apiKey, timeoutMs);
  const body: Record<string, unknown> = {
    model: model.apiModel,
    messages: converted,
    stream: false,
    max_tokens: opts?.maxTokens ?? 4096,
  };
  // ইমেজ-জাতীয় আইডি হলে সৎভাবে জানাই — চ্যাট-কম্প্লিশন ইমেজ-মডেলে সাধারণত 400
  if (looksLikeImageModel(model.apiModel)) {
    body.max_tokens = 64;
  }

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      opts?.onAttemptBegin?.();
      if (opts?.onDelta) {
        // স্ট্রিমিং-পথ — প্রকৃত OpenAI SDK stream (টোকেন-বাই-টোকেন)
        const stream = (await client.chat.completions.create(
          { ...body, stream: true } as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          { timeout: timeoutMs }
        )) as unknown as AsyncIterable<{
          choices?: Array<{ delta?: { content?: unknown } }>;
        }>;
        let full = '';
        for await (const chunk of stream) {
          const d = chunk?.choices?.[0]?.delta?.content;
          if (typeof d === 'string' && d.length > 0) {
            full += d;
            opts.onDelta(d);
          }
        }
        if (full.trim() !== '') return full;
        lastErr = new ExternalRetryableError('খালি উত্তর এসেছে');
      } else {
        const res = await client.chat.completions.create(
          body as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
          { timeout: timeoutMs }
        );
        const content = res?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.trim() !== '') return content;
        lastErr = new ExternalRetryableError('খালি উত্তর এসেছে');
      }
    } catch (err) {
      const status = (err as { status?: unknown } | null)?.status;
      const statusNum = typeof status === 'number' ? status : undefined;
      const errText = err instanceof Error ? err.message : String(err);
      if (statusNum === 401 || statusNum === 403) {
        throw new ExternalFatalError(
          `${provider.name}: কী গৃহীত হয়নি (HTTP ${statusNum}) — কী বাতিল/ভুল হলে প্ল্যাটফর্ম সম্পাদনা করে নতুন কী দিন`
        );
      }
      if (statusNum === 429) {
        throw new ExternalFatalError(
          `${provider.name}: রেট-লিমিট (HTTP 429) — কী-এর সীমা (যেমন ১২০ req/min) ছুঁয়ে গেছে হতে পারে; কিছুক্ষণ পরে আবার`
        );
      }
      if (statusNum === 404 || statusNum === 400) {
        throw new ExternalFatalError(
          `${provider.name}: অনুরোধ গৃহীত হয়নি (HTTP ${statusNum}) — মডেল-নাম "${model.apiModel}" এই প্ল্যাটফর্মে চ্যাটের জন্য না-ও থাকতে পারে; মডেল-তালিকা রিফ্রেশ করুন`
        );
      }
      if (statusNum != null && statusNum >= 500) {
        lastErr = new ExternalRetryableError(`${provider.name}: সার্ভার-ত্রুটি (HTTP ${statusNum})`);
      } else if (/abort|timed? ?out|timeout/i.test(errText)) {
        lastErr = new ExternalRetryableError(`সময়শেষ (টাইমআউট > ${Math.round(timeoutMs / 1000)} সে.)`);
      } else {
        lastErr = new ExternalRetryableError(`${provider.name}: ${errText.slice(0, 160)}`);
      }
    }
    if (attempt === 2) break;
    await new Promise(r => setTimeout(r, 1200));
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`${provider.name}: ${msg}`);
}

// ------------------------------------------------------------
// মডেল-যাচাই (/api/models POST-এর জন্য) — প্রকৃত ৮-টোকেন কল
// ------------------------------------------------------------

const VERIFY_TIMEOUT_MS = 30_000;

export async function verifyCustomModel(modelId: string): Promise<ModelVerificationEntry> {
  const t0 = Date.now();
  const found = await findCustomModel(modelId);
  if (!found) {
    return {
      ok: false,
      error: 'কাস্টম মডেলটি আর তালিকায় নেই',
      testedAt: new Date().toISOString(),
    };
  }
  const { provider, model } = found;
  try {
    const client = getCustomClient(provider.baseUrl, provider.apiKey, VERIFY_TIMEOUT_MS);
    const res = await client.chat.completions.create(
      {
        model: model.apiModel,
        messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
        stream: false,
        max_tokens: 8,
      } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { timeout: VERIFY_TIMEOUT_MS }
    );
    const content = res?.choices?.[0]?.message?.content;
    const ok = typeof content === 'string' && content.trim().length > 0;
    return {
      ok,
      servedModel: res?.model ?? model.apiModel,
      ms: Date.now() - t0,
      testedAt: new Date().toISOString(),
      ...(ok ? {} : { error: 'খালি উত্তর' }),
    };
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    const statusNum = typeof status === 'number' ? status : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    if (statusNum === 429) {
      return {
        ok: false,
        rateLimited: true,
        error: `${provider.name}: রেট-লিমিট (HTTP 429) — কী-সীমা ছুঁয়েছে হতে পারে`,
        testedAt: new Date().toISOString(),
      };
    }
    const reason =
      statusNum === 401 || statusNum === 403
        ? 'কী গৃহীত হয়নি'
        : statusNum === 404 || statusNum === 400
          ? 'মডেল-নাম চ্যাটে গৃহীত হয়নি (ইমেজ-মডেল হতে পারে)'
          : statusNum != null
            ? `HTTP ${statusNum}`
            : 'নেটওয়ার্ক/সংযোগ ব্যর্থ';
    return {
      ok: false,
      error: `${provider.name}: ${reason} — ${msg.slice(0, 120)}`,
      testedAt: new Date().toISOString(),
    };
  }
}

/** সব কাস্টম মডেলের আইডি (যাচাই-লুপের জন্য) */
export async function allCustomModelIds(): Promise<string[]> {
  const all = await readStore();
  const ids: string[] = [];
  for (const p of all) {
    for (const m of p.models) ids.push(buildCustomModelId(p.id, m.apiModel));
  }
  return ids;
}
