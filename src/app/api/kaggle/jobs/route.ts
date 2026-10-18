// GET  /api/kaggle/jobs — সাম্প্রতিক জবের তালিকা (স্টেল/offline-derivation সহ)
// POST /api/kaggle/jobs — নতুন রিমোট-কর্মী জব (Supabase jobs কিউতে pending সারি)
//
// নিরাপত্তা: বাকি সব রুটের মতোই requireOwner (মালিক-সেশন) + স্থানীয়
// রেট-লিমিট। প্রতিক্রিয়ায় কখনো SUPABASE_KEY বা আপস্ট্রিম-হেডার যায় না।
import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/limits';
import { requireOwner } from '@/lib/security';
import { createJob, listJobs } from '@/lib/kaggle/jobs';
import { kaggleClientKey, toKaggleErrorResponse } from '@/lib/kaggle/route-helpers';
import {
  KAGGLE_LIST_DEFAULT_LIMIT,
  KAGGLE_LIST_MAX_LIMIT,
  KAGGLE_PROMPT_MAX_CHARS,
  deriveJobView,
} from '@/lib/kaggle/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const rawLimit = url.searchParams.get('limit');
  let limit = KAGGLE_LIST_DEFAULT_LIMIT;
  if (rawLimit !== null) {
    const n = Number(rawLimit);
    if (!Number.isInteger(n) || n < 1) {
      return NextResponse.json(
        { error: `limit অবশ্যই ১–${KAGGLE_LIST_MAX_LIMIT}-এর ধনাত্মক পূর্ণসংখ্যা হবে।` },
        { status: 400, headers: NO_STORE },
      );
    }
    limit = Math.min(n, KAGGLE_LIST_MAX_LIMIT);
  }

  try {
    const rows = await listJobs(limit);
    const now = Date.now();
    return NextResponse.json(
      { jobs: rows.map(r => deriveJobView(r, now)) },
      { headers: NO_STORE },
    );
  } catch (e) {
    return toKaggleErrorResponse(e);
  }
}

export async function POST(req: Request) {
  // --- মালিক-সেশন (P0 নিরাপত্তা) ---
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  // --- স্থানীয় রেট-লিমিট (prod-create-নথির মতো) ---
  const rl = checkRateLimit(`kaggle-job-create:${kaggleClientKey(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত জব-তৈরির অনুরোধ — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন।` },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(rl.retryAfterSec ?? 30) } },
    );
  }

  // --- বডি-পাঠ ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)।' },
      { status: 400, headers: NO_STORE },
    );
  }
  const obj = (body ?? {}) as Record<string, unknown>;

  // --- ইনপুট-যাচাই (type সাদা-তালিকাভুক্ত; status/result_url গ্রহণই হয় না) ---
  const type = obj.type;
  if (type !== 'music' && type !== 'video') {
    return NextResponse.json(
      { error: 'type অবশ্যই "music" বা "video" হতে হবে।' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (typeof obj.prompt !== 'string') {
    return NextResponse.json(
      { error: 'prompt অবশ্যই স্ট্রিং হতে হবে।' },
      { status: 400, headers: NO_STORE },
    );
  }
  const prompt = obj.prompt.trim();
  if (!prompt) {
    return NextResponse.json(
      { error: 'প্রম্পট খালি রাখা যাবে না।' },
      { status: 400, headers: NO_STORE },
    );
  }
  if (prompt.length > KAGGLE_PROMPT_MAX_CHARS) {
    return NextResponse.json(
      {
        error: `প্রম্পট সর্বোচ্চ ${KAGGLE_PROMPT_MAX_CHARS} অক্ষরের হতে পারে (পেয়েছি: ${prompt.length})।`,
      },
      { status: 400, headers: NO_STORE },
    );
  }

  // --- জব-তৈরি (শুধু type+prompt; কলার-সরবরাহকৃত অবস্থা/URL নেই) ---
  try {
    const row = await createJob({ type, prompt });
    const view = deriveJobView(row, Date.now());
    return NextResponse.json(
      { id: view.id, status: view.status, type: view.type },
      { headers: NO_STORE },
    );
  } catch (e) {
    return toKaggleErrorResponse(e);
  }
}
