// ============================================================
// REGRESSION TEST 14 — Capability-aware validation & confirmation
// flow (Phase-4 Workstream D+E)
//
// Modules under test (REAL): POST /api/productions/validate,
// POST /api/productions/[id]/confirm, POST /api/productions/[id]/cancel
// handlers + the REAL validateSpec behind them.
//
// Boundaries:
//  - '@/lib/db' → in-memory fake (productions map — Phase-4 addition)
//  - '@/lib/security' → owner auth ok
//  - '@/lib/agent/production/runner' → startProduction recorded noop
//    (t3 pattern: heavy pipeline chain never loads)
//  - '@/lib/agent/video/ai_video' → videoProviderStatus stub (the
//    ONLY thing serialize/validate import from it) — keeps the SDK
//    out of the test graph
//  - No LLM, no SDK, no provider calls.
//
// Enforced contract (Phase-4 §6/§7/§2 F–G):
//  - Structured verdicts: supported / supported_with_limitations /
//    unsupported / requires_clarification / temporarily_unavailable.
//  - Client-supplied capability claims NEVER override server
//    validation (extra fields are ignored; 4K still adjusts).
//  - Provider busy → temporarily_unavailable, but confirmable;
//    cinematic_motion (local path) unaffected.
//  - providerStatus snapshot crosses the boundary WITHOUT error
//    text (no lastError leak).
//  - Confirm: only awaiting_confirmation → queued + startProduction
//    exactly once; invalid overrides → 422 + no start; duplicates →
//    409; cancel → no start; server ALWAYS revalidates.
// ============================================================

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { fakeDb, resetFakeDb, seedConversation, seedProduction, state } from '../helpers/fake-db';

const startProductionCalls: string[] = [];
/** প্রোভাইডার-স্ট্যাটাস স্টাব — প্রতি টেস্টে সেট করা যায় */
let providerStub: { busy: boolean; cooldownRemainingMs: number; lastError?: string; inFlightSec?: number };

mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/security', () => ({
  requireOwner: async () => ({ ok: true as const }),
}));
mock.module('@/lib/agent/production/runner', () => ({
  startProduction: (id: string) => {
    startProductionCalls.push(id);
  },
}));
mock.module('@/lib/agent/video/ai_video', () => ({
  videoProviderStatus: () => providerStub,
}));

// REAL route handlers — imported after the mocks
const { POST: validatePOST } = await import('@/app/api/productions/validate/route');
const { POST: confirmPOST } = await import('@/app/api/productions/[id]/confirm/route');
const { POST: cancelPOST } = await import('@/app/api/productions/[id]/cancel/route');

function jsonRequest(url: string, body: unknown, ip: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const IP = (n: number) => `203.0.114.${n}`;

beforeEach(() => {
  resetFakeDb();
  startProductionCalls.length = 0;
  providerStub = { busy: false, cooldownRemainingMs: 0 };
});

// ------------------------------------------------------------
// POST /api/productions/validate — ক্ষমতা-সচেতন রায়
// ------------------------------------------------------------

describe('REG-14: capability validation endpoint (Phase-4 D)', () => {
  test('REG-14a: clean image spec → supported; video spec → supported_with_limitations (honest notes)', async () => {
    const imageRes = await validatePOST(
      jsonRequest('http://localhost/api/productions/validate', { spec: { type: 'image', title: 'পোস্টার', quality: 'standard' } }, IP(1))
    );
    expect(imageRes.status).toBe(200);
    const imageData = await imageRes.json();
    expect(imageData.verdict).toBe('supported');

    const videoRes = await validatePOST(
      jsonRequest('http://localhost/api/productions/validate', { spec: { type: 'motion_video', title: 'মোশন', durationSec: 10, quality: 'standard' } }, IP(2))
    );
    const videoData = await videoRes.json();
    expect(videoData.verdict).toBe('supported_with_limitations');
    expect(videoData.validation.notes.length).toBeGreaterThan(0);
    expect(videoData.validation.adjustments).toBeDefined();
  });

  test('REG-14b: 4K / 60fps demands → supported_with_limitations with adjustments to the real maxima', async () => {
    const res = await validatePOST(
      jsonRequest(
        'http://localhost/api/productions/validate',
        { spec: { type: 'short_film', title: 'ফিল্ম', durationSec: 60, quality: 'high', resolution: '4k', fps: 60 } },
        IP(3)
      )
    );
    const data = await res.json();
    expect(data.verdict).toBe('supported_with_limitations');
    const fields = data.validation.adjustments.map((a: { field: string; to: string }) => `${a.field}->${a.to}`);
    expect(fields).toContain('resolution->1080p');
    expect(fields).toContain('fps->30');
    expect(data.validation.spec.resolution).toBe('1080p');
    expect(data.validation.spec.fps).toBe(30);
  });

  test('REG-14c: client-supplied capability claims cannot override server validation', async () => {
    const res = await validatePOST(
      jsonRequest(
        'http://localhost/api/productions/validate',
        {
          spec: {
            type: 'short_film',
            title: 'ফিল্ম',
            durationSec: 60,
            resolution: '4k',
            // ক্লায়েন্ট-দাবি — সার্ভার কখনো মানে না
            isSupported: true,
            supported: true,
            provider: 'custom',
            canDo4k: true,
            cost: 'free',
          },
        },
        IP(4)
      )
    );
    const data = await res.json();
    expect(data.verdict).not.toBe('supported');
    expect(data.validation.adjustments.some((a: { field: string }) => a.field === 'resolution')).toBe(true);
    expect(data.validation.spec.resolution).toBe('1080p');
  });

  test('REG-14d: missing type → requires_clarification; unknown type → unsupported', async () => {
    const missing = await validatePOST(jsonRequest('http://localhost/api/productions/validate', { spec: { title: 'কিছু' } }, IP(5)));
    expect((await missing.json()).verdict).toBe('requires_clarification');

    const unknown = await validatePOST(jsonRequest('http://localhost/api/productions/validate', { spec: { type: 'hologram' } }, IP(6)));
    const unknownData = await unknown.json();
    expect(unknownData.verdict).toBe('unsupported');
    expect(unknownData.validation.errors.length).toBeGreaterThan(0);
    expect(unknownData.validation.errors[0]).toContain('hologram');
  });

  test('REG-14e: provider busy → temporarily_unavailable (still confirmable) + snapshot without error text', async () => {
    providerStub = {
      busy: true,
      cooldownRemainingMs: 0,
      inFlightSec: 42,
      lastError: 'sk-SECRET-should-never-cross-429 at provider',
    };
    const res = await validatePOST(
      jsonRequest('http://localhost/api/productions/validate', { spec: { type: 'music_video', title: 'এমভি', durationSec: 40, quality: 'standard' } }, IP(7))
    );
    const data = await res.json();
    expect(data.verdict).toBe('temporarily_unavailable');
    expect(data.providerStatus.busy).toBe(true);
    expect(data.providerStatus.inFlightSec).toBe(42);
    // নিরাপত্তা-চুক্তি: ত্রুটি-টেক্সট/গোপন তথ্য এই সীমানা পার হয় না
    expect(JSON.stringify(data)).not.toContain('lastError');
    expect(JSON.stringify(data)).not.toContain('sk-SECRET');

    // কুলডাউন-ও একই রায়
    providerStub = { busy: false, cooldownRemainingMs: 30_000 };
    const cd = await validatePOST(
      jsonRequest('http://localhost/api/productions/validate', { spec: { type: 'music_video', title: 'এমভি', durationSec: 40, quality: 'standard' } }, IP(8))
    );
    expect((await cd.json()).verdict).toBe('temporarily_unavailable');
  });

  test('REG-14f: cinematic_motion (local path) unaffected by cloud-provider state', async () => {
    providerStub = { busy: true, cooldownRemainingMs: 60_000 };
    const res = await validatePOST(
      jsonRequest(
        'http://localhost/api/productions/validate',
        { spec: { type: 'motion_video', title: 'মোশন', durationSec: 10, videoEngine: 'cinematic_motion' } },
        IP(9)
      )
    );
    const data = await res.json();
    expect(data.verdict).not.toBe('temporarily_unavailable');
    expect(data.providerStatus).toBeUndefined();
  });

  test('REG-14g: malformed body → 400; oversized spec → 400', async () => {
    const notJson = await validatePOST(jsonRequest('http://localhost/api/productions/validate', 'not-json{', IP(10)));
    expect(notJson.status).toBe(400);
    const noSpec = await validatePOST(jsonRequest('http://localhost/api/productions/validate', { hello: 1 }, IP(11)));
    expect(noSpec.status).toBe(400);
    const huge = await validatePOST(
      jsonRequest('http://localhost/api/productions/validate', { spec: { type: 'image', idea: 'x'.repeat(25_000) } }, IP(12))
    );
    expect(huge.status).toBe(400);
  });
});

// ------------------------------------------------------------
// POST /api/productions/[id]/confirm + cancel — প্রকৃত প্রবাহ
// ------------------------------------------------------------

describe('REG-14: confirmation flow (Phase-4 E)', () => {
  test('REG-14h: confirm awaiting production → 200, queued in db, startProduction exactly once', async () => {
    const conv = seedConversation('conv-14h');
    const prod = seedProduction(conv.id, { type: 'motion_video', title: 'মোশন', durationSec: 10, quality: 'standard' });

    const res = await confirmPOST(jsonRequest(`http://localhost/api/productions/${prod.id}/confirm`, {}, IP(20)), {
      params: Promise.resolve({ id: prod.id }),
    });
    expect(res.status).toBe(200);
    expect(startProductionCalls).toEqual([prod.id]);
    const row = state().productions.get(prod.id)!;
    expect(row.status).toBe('queued');
    const spec = JSON.parse(row.specJson);
    // সার্ভার-পুনঃযাচাই: validateSpec-এর নরমালাইজড স্পেকই স্থায়িত্ব পেয়েছে
    expect(spec.type).toBe('motion_video');
    expect(spec.videoEngine).toBe('ai_diffusion');
  });

  test('REG-14i: confirm with unsupported overrides → honest server-side adjustment (§15), persisted spec is the adjusted one', async () => {
    const conv = seedConversation('conv-14i');
    const prod = seedProduction(conv.id, { type: 'short_film', title: 'ফিল্ম', durationSec: 60, quality: 'standard' });

    // ক্লায়েন্ট-পক্ষ থেকে অসমর্থিত ওভাররাইড (পুরোনো UI/হাতে-লেখা):
    // সার্ভার-পুনঃযাচাই কখনো নীরবে মেনে নেয় না — §১৫-চুক্তি অনুযায়ী
    // স্বচ্ছ সমন্বয় করে (60fps→30, 999s→সীমা) এবং সেটিই স্থায়িত্ব পায়।
    const res = await confirmPOST(
      jsonRequest(`http://localhost/api/productions/${prod.id}/confirm`, { spec: { fps: 60, durationSec: 999 } }, IP(21)),
      { params: Promise.resolve({ id: prod.id }) }
    );
    expect(res.status).toBe(200);
    expect(startProductionCalls).toEqual([prod.id]);
    const row = state().productions.get(prod.id)!;
    expect(row.status).toBe('queued');
    const spec = JSON.parse(row.specJson);
    expect(spec.fps).toBe(30); // ৬০ নয় — সৎ সমন্বয়
    expect(spec.durationSec).toBe(120); // short_film-সীমা
    const body = await res.json();
    expect(body.spec.fps).toBe(30);
    expect(body.spec.durationSec).toBe(120);
  });

  test('REG-14j: repeated confirm → 409 (duplicate-run protection); unknown id → 404', async () => {
    const conv = seedConversation('conv-14j');
    const prod = seedProduction(conv.id, { type: 'image', title: 'ছবি', quality: 'standard' });

    const first = await confirmPOST(jsonRequest(`http://localhost/api/productions/${prod.id}/confirm`, {}, IP(22)), {
      params: Promise.resolve({ id: prod.id }),
    });
    expect(first.status).toBe(200);

    // দ্বিতীয় নিশ্চিতকরণ (রিফ্রেশ/ডাবল-ক্লিক) → 409, নতুন startProduction নয়
    const second = await confirmPOST(jsonRequest(`http://localhost/api/productions/${prod.id}/confirm`, {}, IP(23)), {
      params: Promise.resolve({ id: prod.id }),
    });
    expect(second.status).toBe(409);
    expect(startProductionCalls).toEqual([prod.id]);

    const missing = await confirmPOST(jsonRequest('http://localhost/api/productions/prod-404/confirm', {}, IP(24)), {
      params: Promise.resolve({ id: 'prod-404' }),
    });
    expect(missing.status).toBe(404);
  });

  test('REG-14k: cancel awaiting → cancelled, no production started; confirm after cancel → 409', async () => {
    const conv = seedConversation('conv-14k');
    const prod = seedProduction(conv.id, { type: 'audio', title: 'অডিও', audioOperation: 'instrumental', durationSec: 30, quality: 'standard' });

    const cancelRes = await cancelPOST(
      new Request(`http://localhost/api/productions/${prod.id}/cancel`, { method: 'POST', headers: { 'x-forwarded-for': IP(25) } }),
      { params: Promise.resolve({ id: prod.id }) }
    );
    expect(cancelRes.status).toBe(200);
    expect(startProductionCalls).toEqual([]);
    expect(state().productions.get(prod.id)!.status).toBe('cancelled');

    const confirmAfter = await confirmPOST(jsonRequest(`http://localhost/api/productions/${prod.id}/confirm`, {}, IP(26)), {
      params: Promise.resolve({ id: prod.id }),
    });
    expect(confirmAfter.status).toBe(409); // বাতিল-প্রস্তাব আর নিশ্চিতযোগ্য নয়
    expect(startProductionCalls).toEqual([]);
  });
});
