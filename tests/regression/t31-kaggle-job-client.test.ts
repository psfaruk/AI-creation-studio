// ============================================================
// t31 — Kaggle GPU jobs ক্লায়েন্ট (src/lib/kaggle/jobs.ts)
//
// সম্পূর্ণ মক-ভিত্তিক (কোনো নেটওয়ার্ক নয়): globalThis.fetch স্টাব,
// env save/restore। কভারেজ:
//  - env-অনুপস্থিতি → স্যানিটাইজড কনফিগ-ত্রুটি (মান কখনো বার্তায় নয়)
//  - createJob সফলতা: REST-চুক্তি (হেডার/Prefer/বডি) + সারি-ফেরত
//  - আপস্ট্রিম ত্রুটি → নিরাপদ বার্তা + চাবি-রিড্যাকশন
//  - অবৈধ UUID → যাচাই-ত্রুটি, fetch-ই হয় না
//  - সারি-ভ্যালিডেশন (আবশ্যক ক্ষেত্র অনুপস্থিত)
//  - listJobs সীমাবদ্ধ (default 20, সর্বোচ্চ 50)
// ============================================================

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// jobs.ts 'server-only' import করে — bun-test প্রসঙ্গে নিরপেক্ষ করা
mock.module('server-only', () => ({}));

import {
  KaggleConfigError,
  KaggleUpstreamError,
  KaggleValidationError,
} from '@/lib/kaggle/errors';

const { createJob, getJob, listJobs } = await import('@/lib/kaggle/jobs');

// ------------------------------------------------------------
// সহায়ক — fetch স্টাব + env ব্যবস্থাপনা
// ------------------------------------------------------------

type StubResponse = { status: number; payload: unknown };

class FakeResponse {
  readonly status: number;
  readonly ok: boolean;

  constructor(status: number, private readonly payload: unknown) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
  }

  async json(): Promise<unknown> {
    return this.payload;
  }

  async text(): Promise<string> {
    return typeof this.payload === 'string' ? this.payload : JSON.stringify(this.payload);
  }
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

const calls: RecordedCall[] = [];
let handler: (url: string, init?: RequestInit) => StubResponse | Promise<StubResponse> = () => ({
  status: 200,
  payload: [],
});

const ENV = {
  SUPABASE_URL: 'https://unit-test.supabase.co',
  SUPABASE_KEY: 'unit-test-service-role-key-abcdef',
};

// স্টাব-ইনস্টল একবারই (ফাইল-শেষে প্রসেসই শেষ হয় — bun test --isolate);
// প্রতিটি টেস্টের আগে কল-লগ/হ্যান্ডলার/env পুনঃস্থাপিত হয়।
globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
  const url = input instanceof URL ? input.toString() : String(input);
  calls.push({
    url,
    method: init?.method ?? 'GET',
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  const r = await handler(url, init);
  return new FakeResponse(r.status, r.payload) as unknown as Response;
}) as typeof fetch;

beforeEach(() => {
  calls.length = 0;
  handler = () => ({ status: 200, payload: [] });
  for (const [k, v] of Object.entries(ENV)) {
    process.env[k] = v;
  }
});

const UUID = '3f2a9c1e-1111-4222-8333-444455556666';

function makeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: UUID,
    type: 'music',
    prompt: 'calm piano',
    status: 'pending',
    result_url: null,
    error: null,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
    ...overrides,
  };
}

// ------------------------------------------------------------
// env-কনফিগারেশন
// ------------------------------------------------------------

describe('t31: env অনুপস্থিতি', () => {
  test('দুটো ভেরিয়েবলই নেই → KaggleConfigError, শুধু নাম বলে (মান নয়), fetch হয় না', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_KEY;
    let caught: unknown;
    try {
      await createJob({ type: 'music', prompt: 'x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KaggleConfigError);
    const msg = (caught as Error).message;
    expect(msg).toContain('SUPABASE_URL');
    expect(msg).toContain('SUPABASE_KEY');
    expect(msg).not.toContain(ENV.SUPABASE_KEY);
    expect(msg).not.toContain('https://unit-test.supabase.co');
    expect(calls.length).toBe(0);
  });

  test('শুধু SUPABASE_KEY অনুপস্থিত → বার্তায় কেবল সেই নাম', async () => {
    delete process.env.SUPABASE_KEY;
    let caught: unknown;
    try {
      await listJobs(5);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KaggleConfigError);
    const msg = (caught as Error).message;
    expect(msg).toContain('SUPABASE_KEY');
    expect(msg).not.toContain('SUPABASE_URL,');
    expect(msg).not.toContain(ENV.SUPABASE_KEY);
    expect(calls.length).toBe(0);
  });
});

// ------------------------------------------------------------
// createJob — REST-চুক্তি
// ------------------------------------------------------------

describe('t31: createJob', () => {
  test('সফল: সঠিক URL/মেথড/হেডার/Prefer/বডি + সারি ফেরত', async () => {
    handler = () => ({ status: 201, payload: [makeRow()] });
    const row = await createJob({ type: 'music', prompt: 'hello' });
    expect(row.id).toBe(UUID);
    expect(calls.length).toBe(1);
    const call = calls[0];
    expect(call.url.startsWith('https://unit-test.supabase.co/rest/v1/jobs')).toBe(true);
    expect(call.url.includes('select=')).toBe(true);
    expect(call.method).toBe('POST');
    expect(call.headers.apikey).toBe(ENV.SUPABASE_KEY);
    expect(call.headers.Authorization).toBe(`Bearer ${ENV.SUPABASE_KEY}`);
    expect(call.headers.Prefer).toBe('return=representation');
    expect(call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(call.body ?? '{}')).toEqual({ type: 'music', prompt: 'hello' });
  });

  test('রিপ্রেজেন্টেশন-সারি না এলে স্পষ্ট আপস্ট্রিম-ত্রুটি', async () => {
    handler = () => ({ status: 201, payload: [] });
    let caught: unknown;
    try {
      await createJob({ type: 'music', prompt: 'x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KaggleUpstreamError);
    expect((caught as Error).message).not.toContain(ENV.SUPABASE_KEY);
  });

  test('আপস্ট্রিম 500: নিরাপদ বার্তা + চাবি-রিড্যাকশন', async () => {
    handler = () => ({
      status: 500,
      payload: { message: `internal boom ${ENV.SUPABASE_KEY} leaked` },
    });
    let caught: unknown;
    try {
      await createJob({ type: 'music', prompt: 'x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KaggleUpstreamError);
    const err = caught as KaggleUpstreamError;
    expect(err.upstreamStatus).toBe(500);
    expect(err.message).toContain('HTTP 500');
    expect(err.message).toContain('internal boom');
    expect(err.message).not.toContain(ENV.SUPABASE_KEY);
  });

  test('অ-JSON আপস্ট্রিম-বডিও নিরাপদে হ্যান্ডেল হয়', async () => {
    handler = () => ({ status: 502, payload: '<html>bad gateway</html>' });
    let caught: unknown;
    try {
      await createJob({ type: 'music', prompt: 'x' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KaggleUpstreamError);
    expect((caught as Error).message).toContain('502');
  });
});

// ------------------------------------------------------------
// getJob — UUID-গার্ড ও সারি-ভ্যালিডেশন
// ------------------------------------------------------------

describe('t31: getJob', () => {
  test('অবৈধ UUID → KaggleValidationError, fetch হয় না', async () => {
    let caught: unknown;
    try {
      await getJob('not-a-uuid');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KaggleValidationError);
    expect(calls.length).toBe(0);
  });

  test('খালি ফলাফল → null (জব নেই)', async () => {
    handler = () => ({ status: 200, payload: [] });
    const row = await getJob(UUID);
    expect(row).toBeNull();
    expect(calls[0].url.includes(`id=eq.${UUID}`)).toBe(true);
    expect(calls[0].url.includes('limit=1')).toBe(true);
  });

  test('সারিতে id অনুপস্থিত → ভ্যালিডেশন-ত্রুটি', async () => {
    handler = () => {
      const row = makeRow();
      delete (row as Record<string, unknown>).id;
      return { status: 200, payload: [row] };
    };
    let caught: unknown;
    try {
      await getJob(UUID);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(KaggleUpstreamError);
    expect((caught as Error).message).toContain('অসম্পূর্ণ');
  });
});

// ------------------------------------------------------------
// listJobs — সীমাবদ্ধ পাঠ
// ------------------------------------------------------------

describe('t31: listJobs', () => {
  test('সীমা 50-এ ক্ল্যাম্প (অসীম পাঠ রোধ)', async () => {
    handler = () => ({ status: 200, payload: [] });
    await listJobs(999);
    expect(calls[0].url.includes('limit=50')).toBe(true);
  });

  test('অবৈধ/শূন্য সীমা → ডিফল্ট 20', async () => {
    handler = () => ({ status: 200, payload: [] });
    await listJobs(0);
    expect(calls[0].url.includes('limit=20')).toBe(true);
  });

  test('সাম্প্রতিক-ক্রম সহ সারি ফেরত', async () => {
    handler = () => ({
      status: 200,
      payload: [makeRow({ id: '0b1f2c3d-4455-4666-8777-888999000000', status: 'done', result_url: 'https://unit.supabase.co/x.wav' })],
    });
    const rows = await listJobs(5);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('done');
    expect(rows[0].result_url).toBe('https://unit.supabase.co/x.wav');
    expect(calls[0].url.includes('order=created_at.desc')).toBe(true);
  });

  test('204 No Content → খালি তালিকা', async () => {
    handler = () => ({ status: 204, payload: null });
    const rows = await listJobs(5);
    expect(rows).toEqual([]);
  });
});
