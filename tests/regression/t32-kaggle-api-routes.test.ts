// ============================================================
// t32 — Kaggle GPU API-রুট (POST/GET /api/kaggle/jobs, GET /[id])
//        + আর্টিফ্যাক্ট-রেজিস্ট্রেশন (ensureArtifactForJob)
//
// রুট-হ্যান্ডলার আসল, নির্ভরতা মকড ('@/lib/security' ও
// '@/lib/kaggle/jobs'); '@/lib/db' → fakeDb (repo-র প্রচলিত প্যাটার্ন)।
// কভারেজ: ইনপুট-যাচাই, auth-গার্ড, স্ট্যাটাস-ম্যাপিং,
// stale/offline-derivation, done→artifactUrl, ডুপ্লিকেট-রোধ,
// এবং "কোনো service-role ক্রেডেনশিয়াল কখনো প্রতিক্রিয়ায় নয়"।
// ============================================================

import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { KaggleConfigError, KaggleUpstreamError } from '@/lib/kaggle/errors';
import type { KaggleJobRow, KaggleJobView } from '@/lib/kaggle/status';

// --- মক: auth (পরীক্ষা-নিয়ন্ত্রিত) ---
let authOk = true;
mock.module('@/lib/security', () => ({
  requireOwner: async () =>
    authOk
      ? { ok: true as const }
      : {
          ok: false as const,
          response: new Response(JSON.stringify({ error: 'auth required', code: 'auth_required' }), {
            status: 401,
          }),
        },
}));

// --- মক: jobs ক্লায়েন্ট (কল-রেকর্ডিং + পরীক্ষা-ইম্প্ল) ---
const jobsState = {
  createCalls: [] as Array<{ type: string; prompt: string }>,
  getCalls: [] as string[],
  listCalls: [] as number[],
  createImpl: null as null | ((p: { type: string; prompt: string }) => unknown),
  getImpl: null as null | ((id: string) => unknown),
  listImpl: null as null | ((limit: number) => unknown),
};
mock.module('@/lib/kaggle/jobs', () => ({
  createJob: async (p: { type: string; prompt: string }) => {
    jobsState.createCalls.push(p);
    return jobsState.createImpl ? jobsState.createImpl(p) : makeRow();
  },
  getJob: async (id: string) => {
    jobsState.getCalls.push(id);
    return jobsState.getImpl ? jobsState.getImpl(id) : null;
  },
  listJobs: async (limit: number) => {
    jobsState.listCalls.push(limit);
    return jobsState.listImpl ? jobsState.listImpl(limit) : [];
  },
}));

// --- মক: db → fakeDb ---
mock.module('@/lib/db', () => ({ db: fakeDb }));

// মকের পরেই আসল রুট-হ্যান্ডলার ইম্পোর্ট
const { POST, GET: listGET } = await import('@/app/api/kaggle/jobs/route');
const { GET: oneGET } = await import('@/app/api/kaggle/jobs/[id]/route');
const { ensureArtifactForJob } = await import('@/lib/kaggle/artifacts');

// ------------------------------------------------------------
// সহায়ক
// ------------------------------------------------------------

const UUID = '3f2a9c1e-1111-4222-8333-444455556666';
let ipCounter = 1;

function isoAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function makeRow(overrides: Partial<KaggleJobRow> = {}): KaggleJobRow {
  return {
    id: UUID,
    type: 'music',
    prompt: 'calm piano',
    status: 'pending',
    result_url: null,
    error: null,
    created_at: isoAgo(5_000),
    updated_at: isoAgo(5_000),
    ...overrides,
  };
}

/** ensureArtifactForJob-এর প্যারামিটার — প্রদর্শন-ভিউ আকৃতি */
function makeView(overrides: Partial<KaggleJobView> = {}): KaggleJobView {
  return {
    id: UUID,
    type: 'music',
    prompt: 'calm piano',
    status: 'done',
    resultUrl: 'https://unit.supabase.co/storage/v1/object/public/outputs/x.wav',
    error: null,
    createdAt: isoAgo(5_000),
    updatedAt: isoAgo(5_000),
    stale: false,
    workerMayBeOffline: false,
    elapsedMs: 5_000,
    ...overrides,
  };
}

function jsonPost(body: unknown): Request {
  return new Request('http://localhost/api/kaggle/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.9.9.${ipCounter++}` },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function listGet(query = ''): Request {
  return new Request(`http://localhost/api/kaggle/jobs${query}`);
}

function oneGet(id: string): [Request, { params: Promise<{ id: string }> }] {
  return [
    new Request(`http://localhost/api/kaggle/jobs/${id}`),
    { params: Promise.resolve({ id }) },
  ];
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  authOk = true;
  resetFakeDb();
  jobsState.createCalls.length = 0;
  jobsState.getCalls.length = 0;
  jobsState.listCalls.length = 0;
  jobsState.createImpl = null;
  jobsState.getImpl = null;
  jobsState.listImpl = null;
});

/** কোনো প্রতিক্রিয়ায় সেবা-চাবির মান নেই — সব রুট-পরীক্ষায় ব্যবহৃত */
const FAKE_SECRET = 'fake-super-secret-service-role-key-123';
async function expectNoSecretLeak(res: Response): Promise<void> {
  const text = JSON.stringify(await res.clone().json().catch(() => ({}))) + res.status;
  expect(text.includes(FAKE_SECRET)).toBe(false);
  expect(text.includes('apikey')).toBe(false);
  expect(text.includes('Bearer ')).toBe(false);
}

// ------------------------------------------------------------
// POST /api/kaggle/jobs — ইনপুট-যাচাই
// ------------------------------------------------------------

describe('t32: POST /api/kaggle/jobs', () => {
  test('বৈধ music জব → 200 + ন্যূনতম প্রতিক্রিয়া', async () => {
    const res = await POST(jsonPost({ type: 'music', prompt: '  hello world  ' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const data = await bodyOf(res);
    expect(data.id).toBe(UUID);
    expect(data.status).toBe('pending');
    expect(data.type).toBe('music');
    expect(jobsState.createCalls).toEqual([{ type: 'music', prompt: 'hello world' }]);
  });

  test('video টাইপও গৃহীত (কর্মী সৎভাবে ব্যর্থ করবে)', async () => {
    const res = await POST(jsonPost({ type: 'video', prompt: 'a clip' }));
    expect(res.status).toBe(200);
    expect(jobsState.createCalls[0]?.type).toBe('video');
  });

  test('অবৈধ type → 400, জব তৈরি হয় না', async () => {
    const res = await POST(jsonPost({ type: 'poem', prompt: 'x' }));
    expect(res.status).toBe(400);
    expect(jobsState.createCalls.length).toBe(0);
  });

  test('খালি/শুধু-স্পেস প্রম্পট → 400', async () => {
    expect((await POST(jsonPost({ type: 'music', prompt: '   ' }))).status).toBe(400);
    expect((await POST(jsonPost({ type: 'music', prompt: '' }))).status).toBe(400);
    expect(jobsState.createCalls.length).toBe(0);
  });

  test('১০০০+ অক্ষরের প্রম্পট → 400 (বার্তায় সীমা); ঠিক ১০০০ → ঠিক', async () => {
    const res = await POST(jsonPost({ type: 'music', prompt: 'x'.repeat(1_001) }));
    expect(res.status).toBe(400);
    expect(((await bodyOf(res)).error as string).includes('1000')).toBe(true);
    expect(jobsState.createCalls.length).toBe(0);
    const ok = await POST(jsonPost({ type: 'music', prompt: 'y'.repeat(1_000) }));
    expect(ok.status).toBe(200);
  });

  test('অ-JSON বডি → 400', async () => {
    const res = await POST(jsonPost('this is not json'));
    expect(res.status).toBe(400);
  });

  test('কলার-সরবরাহকৃত status/result_url গৃহীত হয় না', async () => {
    const res = await POST(
      jsonPost({ type: 'music', prompt: 'x', status: 'done', result_url: 'https://evil.example/x' }),
    );
    expect(res.status).toBe(200);
    expect((await bodyOf(res)).status).toBe('pending');
    expect(jobsState.createCalls).toEqual([{ type: 'music', prompt: 'x' }]);
  });

  test('auth বন্ধ → 401, জব-ক্লায়েন্ট ডাকা হয় না', async () => {
    authOk = false;
    const res = await POST(jsonPost({ type: 'music', prompt: 'x' }));
    expect(res.status).toBe(401);
    expect(jobsState.createCalls.length).toBe(0);
  });

  test('কনফিগ-ত্রুটি → 503 + code', async () => {
    jobsState.createImpl = () => {
      throw new KaggleConfigError('সার্ভারে Supabase কনফিগার করা নেই — অনুপস্থিত ভেরিয়েবল: SUPABASE_KEY।');
    };
    const res = await POST(jsonPost({ type: 'music', prompt: 'x' }));
    expect(res.status).toBe(503);
    const data = await bodyOf(res);
    expect(data.code).toBe('kaggle_not_configured');
    await expectNoSecretLeak(res);
  });

  test('আপস্ট্রিম-ত্রুটি → 502 + code, ক্রেডেনশিয়াল-লিক নেই', async () => {
    jobsState.createImpl = () => {
      throw new KaggleUpstreamError(`Supabase উত্তর দিলে HTTP 500 — ${FAKE_SECRET} ছড়িয়ে গিয়েছিল`, 500);
    };
    const res = await POST(jsonPost({ type: 'music', prompt: 'x' }));
    expect(res.status).toBe(502);
    const data = await bodyOf(res);
    expect(data.code).toBe('kaggle_upstream_error');
    // নোট: বার্তা-স্যানিটাইজেশন jobs-ক্লায়েন্টেই হয় (t31-যাচাইকৃত);
    // এখানে নিশ্চিত হই প্রতিক্রিয়া-খামে কোনো হেডার/চাবি-আকৃতি নেই।
    await expectNoSecretLeak(res);
  });
});

// ------------------------------------------------------------
// GET /api/kaggle/jobs — তালিকা
// ------------------------------------------------------------

describe('t32: GET /api/kaggle/jobs (তালিকা)', () => {
  test('ডিফল্ট সীমা 20 পাঠানো হয়', async () => {
    jobsState.listImpl = () => [makeRow()];
    const res = await listGET(listGet());
    expect(res.status).toBe(200);
    expect(jobsState.listCalls).toEqual([20]);
    const data = await bodyOf(res);
    expect(Array.isArray(data.jobs)).toBe(true);
    expect((data.jobs as Array<Record<string, unknown>>)[0].id).toBe(UUID);
  });

  test('অবৈধ limit → 400; বাড়তি limit → 50-এ ক্ল্যাম্প', async () => {
    expect((await listGET(listGet('?limit=abc'))).status).toBe(400);
    expect((await listGET(listGet('?limit=0'))).status).toBe(400);
    expect((await listGET(listGet('?limit=-3'))).status).toBe(400);
    await listGET(listGet('?limit=500'));
    expect(jobsState.listCalls[jobsState.listCalls.length - 1]).toBe(50);
    await listGET(listGet('?limit=5'));
    expect(jobsState.listCalls[jobsState.listCalls.length - 1]).toBe(5);
  });

  test('auth বন্ধ → 401', async () => {
    authOk = false;
    expect((await listGET(listGet())).status).toBe(401);
  });

  test('কনফিগ-ত্রুটি → 503', async () => {
    jobsState.listImpl = () => {
      throw new KaggleConfigError('Supabase কনফিগার করা নেই।');
    };
    expect((await listGET(listGet())).status).toBe(503);
  });
});

// ------------------------------------------------------------
// GET /api/kaggle/jobs/[id] — একক জব + derivation + artifactUrl
// ------------------------------------------------------------

describe('t32: GET /api/kaggle/jobs/[id]', () => {
  test('অবৈধ UUID → 400, ক্লায়েন্ট ডাকা হয় না', async () => {
    const [req, ctx] = oneGet('not-a-uuid');
    const res = await oneGET(req, ctx);
    expect(res.status).toBe(400);
    expect(jobsState.getCalls.length).toBe(0);
  });

  test('জব নেই → 404', async () => {
    jobsState.getImpl = () => null;
    const [req, ctx] = oneGet(UUID);
    expect((await oneGET(req, ctx)).status).toBe(404);
  });

  test('সদ্য-তৈরি pending → pending, অফলাইন-ইঙ্গিত নেই', async () => {
    jobsState.getImpl = () => makeRow({ status: 'pending', created_at: isoAgo(5_000), updated_at: isoAgo(5_000) });
    const [req, ctx] = oneGet(UUID);
    const res = await oneGET(req, ctx);
    expect(res.status).toBe(200);
    const job = (await bodyOf(res)).job as Record<string, unknown>;
    expect(job.status).toBe('pending');
    expect(job.workerMayBeOffline).toBe(false);
    expect(job.artifactUrl).toBeUndefined();
    await expectNoSecretLeak(res);
  });

  test('২ মিনিটের বেশি pending → অফলাইন-ইঙ্গিত, কিন্তু pending-ই থাকে', async () => {
    jobsState.getImpl = () => makeRow({ status: 'pending', created_at: isoAgo(3 * 60_000), updated_at: isoAgo(3 * 60_000) });
    const [req, ctx] = oneGet(UUID);
    const job = (await bodyOf(await oneGET(req, ctx))).job as Record<string, unknown>;
    expect(job.status).toBe('pending');
    expect(job.workerMayBeOffline).toBe(true);
  });

  test('সদ্য-running → running', async () => {
    jobsState.getImpl = () => makeRow({ status: 'running', created_at: isoAgo(60_000), updated_at: isoAgo(30_000) });
    const [req, ctx] = oneGet(UUID);
    const job = (await bodyOf(await oneGET(req, ctx))).job as Record<string, unknown>;
    expect(job.status).toBe('running');
    expect(job.stale).toBe(false);
  });

  test('৯০ মিনিটের বেশি running → স্টেল-ব্যর্থ রায়', async () => {
    jobsState.getImpl = () => makeRow({ status: 'running', created_at: isoAgo(92 * 60_000), updated_at: isoAgo(91 * 60_000) });
    const [req, ctx] = oneGet(UUID);
    const job = (await bodyOf(await oneGET(req, ctx))).job as Record<string, unknown>;
    expect(job.status).toBe('failed');
    expect(job.stale).toBe(true);
    expect(String(job.error)).toContain('running');
  });

  test('ব্যর্থ জব → error ফেরত, artifactUrl নেই', async () => {
    jobsState.getImpl = () => makeRow({ status: 'failed', error: 'video worker not implemented yet' });
    const [req, ctx] = oneGet(UUID);
    const res = await oneGET(req, ctx);
    const job = (await bodyOf(res)).job as Record<string, unknown>;
    expect(job.status).toBe('failed');
    expect(job.error).toBe('video worker not implemented yet');
    expect(job.artifactUrl).toBeUndefined();
  });

  test('সম্পন্ন জব → resultUrl + artifactUrl (একবারই রেজিস্টার, ডুপ্লিকেট নয়)', async () => {
    const resultUrl = 'https://unit.supabase.co/storage/v1/object/public/outputs/abc.wav';
    jobsState.getImpl = () => makeRow({ status: 'done', result_url: resultUrl });
    const [req, ctx] = oneGet(UUID);

    const res1 = await oneGET(req.clone(), { params: Promise.resolve({ id: UUID }) });
    const job1 = (await bodyOf(res1)).job as Record<string, unknown>;
    expect(job1.status).toBe('done');
    expect(job1.resultUrl).toBe(resultUrl);
    expect(typeof job1.artifactUrl).toBe('string');
    expect(String(job1.artifactUrl).startsWith('/api/artifacts/')).toBe(true);

    const stored = await fakeDb.artifact.findMany({ where: { sourceUrl: resultUrl } });
    expect(stored.length).toBe(1);
    expect(stored[0].kind).toBe('audio');
    expect(stored[0].storagePath).toBe(null);
    expect(String(stored[0].metaJson)).toContain('KAGGLE_GPU_MUSICGEN');

    // দ্বিতীয়বার পোল → একই আর্টিফ্যাক্ট (নতুন সারি নয়)
    const res2 = await oneGET(req.clone(), { params: Promise.resolve({ id: UUID }) });
    const job2 = (await bodyOf(res2)).job as Record<string, unknown>;
    expect(job2.artifactUrl).toBe(job1.artifactUrl);
    expect((await fakeDb.artifact.findMany({ where: { sourceUrl: resultUrl } })).length).toBe(1);
  });

  test('auth বন্ধ → 401', async () => {
    authOk = false;
    const [req, ctx] = oneGet(UUID);
    expect((await oneGET(req, ctx)).status).toBe(401);
  });
});

// ------------------------------------------------------------
// ensureArtifactForJob — সরাসরি (আসল মডিউল + fakeDb)
// ------------------------------------------------------------

describe('t32: ensureArtifactForJob', () => {
  test('pending/failed → null, কোনো সারি তৈরি হয় না', async () => {
    expect(await ensureArtifactForJob(makeView({ status: 'pending', resultUrl: null }))).toBeNull();
    expect(await ensureArtifactForJob(makeView({ status: 'failed', resultUrl: null, error: 'boom' }))).toBeNull();
    expect(await ensureArtifactForJob(makeView({ status: 'done', resultUrl: null }))).toBeNull();
    expect((await fakeDb.artifact.findMany({ where: {} })).length).toBe(0);
  });

  test('ভিন্ন দুটি done-জব → দুটি আর্টিফ্যাক্ট, উভয়েই এক্সটার্নাল-পথ', async () => {
    const urlA = await ensureArtifactForJob(makeView({ resultUrl: 'https://unit.supabase.co/a.wav' }));
    const urlB = await ensureArtifactForJob(
      makeView({ id: '0b1f2c3d-4455-4666-8777-888999000000', resultUrl: 'https://unit.supabase.co/b.wav' }),
    );
    expect(urlA).not.toBeNull();
    expect(urlB).not.toBeNull();
    expect(urlA).not.toBe(urlB);
    expect((await fakeDb.artifact.findMany({ where: {} })).length).toBe(2);
  });
});
