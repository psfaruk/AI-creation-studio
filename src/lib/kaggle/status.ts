// ============================================================
// Kaggle GPU জব — স্ট্যাটাস-derivation ও শেয়ারড ধ্রুবক (isomorphic)।
//
// এই মডিউলটি সার্ভার-রুট ও ক্লায়েন্ট-উভয়েই import করা নিরাপদ —
// কোনো env-পাঠ, কোনো fetch, কোনো গোপন কিছুই এখানে নেই।
//
// সততা-নিয়ম:
//  - "running" ৯০ মিনিটের বেশি পুরনো হলে *দেখানো-অবস্থা* failed
//    (stale) — DB মিউটেট করা হয় না (নিরাপদ, কোনো cron নেই)।
//  - "pending" ২ মিনিটের বেশি হলে pending-ই থাকে — শুধু
//    workerMayBeOffline ইঙ্গিত যোগ হয় (কর্মী বন্ধ প্রমাণ নয়)।
// ============================================================

export type KaggleJobType = 'music' | 'video';
export type KaggleJobStatus = 'pending' | 'running' | 'done' | 'failed';

/** ক্লায়েন্ট-পোলিং বিরতি (আনুমানিক ৫ সেকেন্ড) */
export const KAGGLE_JOB_POLL_INTERVAL_MS = 5_000;
/** pending এত মিলিসেকেন্ডের বেশি হলে কর্মী-অফলাইন ইঙ্গিত */
export const KAGGLE_PENDING_OFFLINE_HINT_MS = 2 * 60_000;
/** running এত মিলিসেকেন্ড আপডেট-না-হলে স্টেল-ব্যর্থ হিসেবে দেখানো */
export const KAGGLE_RUNNING_STALE_MS = 90 * 60_000;
/** প্রম্পটের সর্বোচ্চ দৈর্ঘ্য (trim-এর পরে) */
export const KAGGLE_PROMPT_MAX_CHARS = 1_000;
export const KAGGLE_LIST_DEFAULT_LIMIT = 20;
export const KAGGLE_LIST_MAX_LIMIT = 50;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** জব-আইডি (Supabase gen_random_uuid → v4) আগে-থেকে যাচাই */
export function isValidKaggleJobId(id: string): boolean {
  return UUID_RE.test(id);
}

/** Supabase public.jobs সারির কাঁচা আকৃতি (snake_case, REST-নথি) */
export interface KaggleJobRow {
  id: string;
  type: string;
  prompt: string;
  status: string;
  result_url: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** API-প্রতিক্রিয়ার নিরাপদ প্রদর্শন-ভিউ (ক্যামেলকেস) */
export interface KaggleJobView {
  id: string;
  type: KaggleJobType;
  prompt: string;
  status: KaggleJobStatus;
  resultUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** true = ৯০ মিনিটের বেশি running-এ আটকে ছিল → দেখানো-অবস্থা failed */
  stale: boolean;
  /** true = pending ২ মিনিটের বেশি — কর্মী-অফলাইন "ইঙ্গিত" (প্রমাণ নয়) */
  workerMayBeOffline: boolean;
  /** তৈরি হওয়া থেকে অতিবাহিত ms (এই derivation-এর মুহূর্তে) */
  elapsedMs: number;
}

/** DB-সত্য → প্রদর্শন-ভিউ (stale/offline-derivation সহ) */
export function deriveJobView(row: KaggleJobRow, nowMs: number): KaggleJobView {
  const createdAtMs = Date.parse(row.created_at);
  const updatedAtMs = Date.parse(row.updated_at);
  const createdAt = Number.isFinite(createdAtMs) ? createdAtMs : nowMs;
  const updatedAt = Number.isFinite(updatedAtMs) ? updatedAtMs : createdAt;
  const elapsedMs = Math.max(0, nowMs - createdAt);

  const typeOk = row.type === 'music' || row.type === 'video';
  let status: KaggleJobStatus;
  let stale = false;
  let error = row.error;

  switch (row.status) {
    case 'pending':
      status = 'pending';
      break;
    case 'running':
      if (nowMs - updatedAt > KAGGLE_RUNNING_STALE_MS) {
        // স্টেল-derivation: DB-সারি অপরিবর্তিত — শুধু দেখানো-রায়
        status = 'failed';
        stale = true;
        error = error ?? 'জবটি ৯০ মিনিটের বেশি "running" অবস্থায় আটকে ছিল — কর্মী-সেশন সম্ভবত বন্ধ হয়ে গিয়েছিল। নতুন করে পাঠান।';
      } else {
        status = 'running';
      }
      break;
    case 'done':
      status = 'done';
      break;
    case 'failed':
      status = 'failed';
      break;
    default:
      status = 'failed';
      error = error ?? `অজানা জব-অবস্থা: ${String(row.status).slice(0, 40)}`;
  }

  // DB CHECK-সীমার বাইরের ধরন (তত্ত্বগতভাবে অসম্ভব) — সৎ-ব্যর্থ
  if (!typeOk) {
    status = 'failed';
    error = error ?? `অজানা জব-ধরন (music/video ছাড়া অন্য কিছু): ${String(row.type).slice(0, 40)}`;
  }

  return {
    id: row.id,
    type: row.type === 'video' ? 'video' : 'music',
    prompt: row.prompt,
    status,
    resultUrl: row.result_url,
    error,
    createdAt: new Date(createdAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    stale,
    workerMayBeOffline: status === 'pending' && elapsedMs >= KAGGLE_PENDING_OFFLINE_HINT_MS,
    elapsedMs,
  };
}

/** পোলিং চালু থাকবে কি না — terminal (done/failed) হলে বন্ধ */
export function shouldContinuePolling(job: Pick<KaggleJobView, 'status'>): boolean {
  return job.status === 'pending' || job.status === 'running';
}
