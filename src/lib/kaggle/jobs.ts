// ============================================================
// Kaggle GPU মিউজিক-কর্মী — সার্ভার-ওনলি Supabase jobs ক্লায়েন্ট।
//
// নকশা:
//  - প্লেইন fetch (নতুন ভারী নির্ভরতা নয়) + 'server-only' গার্ড —
//    ক্লায়েন্ট কম্পোনেন্ট থেকে import হলেই বিল্ড-সময়ে ব্যর্থ।
//  - শুধু GET (read) ও এক-বার POST (insert) — অ্যাপ-সাইড কখনো জবের
//    অবস্থা mutate করে না (দাবি/সমাপ্তি কর্মী PATCH করে)।
//  - POST কখনো অন্ধভাবে retry হয় না (ডুপ্লিকেট-জব ঝুঁকি);
//    GET-ও এখানে retry করে না — UI-পোলিংই প্রাকৃতিক পুনঃচেষ্টা।
//  - সব ত্রুটি-বার্তা স্যানিটাইজড; চাবির মান কখনো বার্তায় নেই।
// ============================================================

import 'server-only';

import { getSupabaseConfig, missingSupabaseVars } from './config';
import { KaggleConfigError, KaggleUpstreamError, KaggleValidationError } from './errors';
import {
  KAGGLE_LIST_DEFAULT_LIMIT,
  KAGGLE_LIST_MAX_LIMIT,
  isValidKaggleJobId,
  type KaggleJobRow,
  type KaggleJobType,
} from './status';

const REST_PATH = '/rest/v1/jobs';
/** শুধু প্রয়োজনীয় কলাম — অসীম পাঠ নয় */
const SELECT_COLUMNS = 'id,type,prompt,status,result_url,error,created_at,updated_at';
const REQUEST_TIMEOUT_MS = 10_000;
const SAFE_FIELD_MAX_CHARS = 200;

function requireConfig() {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new KaggleConfigError(
      `সার্ভারে Kaggle GPU মিউজিক-কর্মীর Supabase কনফিগার করা নেই — অনুপস্থিত ভেরিয়েবল: ${missingSupabaseVars().join(', ')}।`,
    );
  }
  return cfg;
}

/** PostgREST ত্রুটি-বডির নিরাপদ অংশ (message/details/hint — প্রতিটি সীমিত) */
function safeUpstreamMessage(status: number, bodyText: string): string {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(bodyText.slice(0, 2_000));
  } catch {
    parsed = null;
  }
  const parts: string[] = [];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['message', 'details', 'hint']) {
      const v = obj[key];
      if (typeof v === 'string' && v.trim()) parts.push(v.trim().slice(0, SAFE_FIELD_MAX_CHARS));
    }
  }
  const detail = parts.length > 0 ? ` — ${parts.join(' · ')}` : ' (আপস্ট্রিম বিস্তারিত তথ্য দেয়নি)';
  return `Supabase উত্তর দিলে HTTP ${status}${detail}`;
}

interface RestOptions {
  method: 'GET' | 'POST';
  searchParams?: Record<string, string>;
  body?: unknown;
  prefer?: string;
}

async function supabaseRest<T>(opts: RestOptions): Promise<T> {
  const cfg = requireConfig();
  const url = new URL(`${cfg.url}${REST_PATH}`);
  for (const [key, value] of Object.entries(opts.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: opts.method,
      signal: controller.signal,
      headers: {
        apikey: cfg.apiKey,
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        ...(opts.prefer ? { Prefer: opts.prefer } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // প্রতিরক্ষা: আপস্ট্রিম-বার্তায় যদি কখনো চাবি প্রতিফলিত হয়, মুছে ফেলো
      const message = safeUpstreamMessage(res.status, text).split(cfg.apiKey).join('***');
      throw new KaggleUpstreamError(message, res.status);
    }
    if (res.status === 204) return [] as T;
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof KaggleUpstreamError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new KaggleUpstreamError(
        `Supabase অনুরোধ ${REQUEST_TIMEOUT_MS / 1000} সেকেন্ডে সাড়া দেয়নি (timeout)।`,
        504,
      );
    }
    const reason = e instanceof Error ? e.message.slice(0, 120) : 'অজানা ত্রুটি';
    throw new KaggleUpstreamError(`Supabase-এ যোগাযোগ ব্যর্থ (${reason})`, 0);
  } finally {
    clearTimeout(timer);
  }
}

/** আপস্ট্রিম সারি → যাচাইকৃত KaggleJobRow (রানটাইম validation, `any` নয়) */
function toJobRow(raw: unknown, context: string): KaggleJobRow {
  if (!raw || typeof raw !== 'object') {
    throw new KaggleUpstreamError(`Supabase ${context}-এ প্রত্যাশিত জব-সারি পাওয়া যায়নি।`, 0);
  }
  const o = raw as Record<string, unknown>;
  const row: KaggleJobRow = {
    id: typeof o.id === 'string' ? o.id : '',
    type: typeof o.type === 'string' ? o.type : '',
    prompt: typeof o.prompt === 'string' ? o.prompt : '',
    status: typeof o.status === 'string' ? o.status : '',
    result_url: typeof o.result_url === 'string' ? o.result_url : null,
    error: typeof o.error === 'string' ? o.error : null,
    created_at: typeof o.created_at === 'string' ? o.created_at : '',
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : '',
  };
  if (!row.id || !row.created_at || !row.updated_at || !row.status) {
    throw new KaggleUpstreamError(`Supabase ${context}-এ অসম্পূর্ণ জব-সারি (আবশ্যক ক্ষেত্র অনুপস্থিত)।`, 0);
  }
  return row;
}

/**
 * নতুন জব তৈরি (status = pending, DB-default)।
 * Prefer: return=representation দিয়ে তৈরি-হওয়া সারি ফেরত নেওয়া হয়।
 */
export async function createJob(params: { type: KaggleJobType; prompt: string }): Promise<KaggleJobRow> {
  const rows = await supabaseRest<unknown>({
    method: 'POST',
    prefer: 'return=representation',
    searchParams: { select: SELECT_COLUMNS },
    body: { type: params.type, prompt: params.prompt },
  });
  if (!Array.isArray(rows) || rows.length < 1) {
    throw new KaggleUpstreamError('Supabase নতুন তৈরি জব-সারি ফেরত দেয়নি (return=representation)।', 0);
  }
  return toJobRow(rows[0], 'INSERT');
}

/** একক জব (আইডি UUID-আগেই-যাচাই); না পেলে null */
export async function getJob(id: string): Promise<KaggleJobRow | null> {
  if (!isValidKaggleJobId(id)) {
    throw new KaggleValidationError('জব-আইডি বৈধ UUID নয়।');
  }
  const rows = await supabaseRest<unknown[]>({
    method: 'GET',
    searchParams: { select: SELECT_COLUMNS, id: `eq.${id}`, limit: '1' },
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return toJobRow(rows[0], 'SELECT');
}

/** সাম্প্রতিক জব — সীমাবদ্ধ (1–50), স্থিতিশীল ক্রম (created_at অবরোহী) */
export async function listJobs(limit: number): Promise<KaggleJobRow[]> {
  const n = Math.floor(limit);
  const bounded = Math.min(
    Number.isFinite(n) && n >= 1 ? n : KAGGLE_LIST_DEFAULT_LIMIT,
    KAGGLE_LIST_MAX_LIMIT,
  );
  const rows = await supabaseRest<unknown[]>({
    method: 'GET',
    searchParams: { select: SELECT_COLUMNS, order: 'created_at.desc', limit: String(bounded) },
  });
  if (!Array.isArray(rows)) return [];
  return rows.map((raw, i) => toJobRow(raw, `SELECT#${i}`));
}
