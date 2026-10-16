// ============================================================
// REGRESSION TEST 13 — Chat-native configuration panel schema
// (Phase-4 Workstream C+D)
//
// Module under test (REAL): src/lib/agent/config-panel.ts (schema
// builder + client-side field validation) and the REAL GET handler
// of /api/productions/config-panel.
//
// Boundaries:
//  - '@/lib/db' → in-memory fake (song listing only)
//  - '@/lib/security' → owner auth ok (t3 pattern)
//  - capabilities.ts (constants source of truth) REAL — the schema
//    must be derived from it, not a parallel hardcoded list.
//  - No LLM, no SDK, no provider calls, no storage writes.
//
// Enforced contract (Phase-4 §5/§6):
//  - Category-specific fields per type; every default value passes
//    the REAL validateSpec.
//  - Unsupported options (60fps, 4K) exist but are disabled WITH a
//    reason — never silently promised.
//  - Duration options stay within DURATION_LIMITS.
//  - Field validation: required missing → error; disabled option
//    selected → error with reason; out-of-range duration → error;
//    in-range custom duration → OK; optional fields omittable.
//  - GET route: valid type 200 + schema + songs (ids/names only);
//    invalid type 400; rate limit enforced.
// ============================================================

import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { fakeDb, resetFakeDb, seedConversation, state } from '../helpers/fake-db';

mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/security', () => ({
  requireOwner: async () => ({ ok: true as const }),
}));

// REAL modules — imported after the mocks
const {
  buildConfigPanel,
  validateFieldsAgainstSchema,
} = await import('@/lib/agent/config-panel');
const { DURATION_LIMITS, plannedStepsFor, validateSpec } = await import('@/lib/agent/capabilities');
const { GET } = await import('@/app/api/productions/config-panel/route');

/** প্রতি টেস্টে ভিন্ন client-ip — রেট-লিমিট উইন্ডো আলাদা থাকে */
function panelRequest(type: string, opts?: { conversationId?: string; ip?: string }): Request {
  const params = new URLSearchParams({ type });
  if (opts?.conversationId) params.set('conversationId', opts.conversationId);
  return new Request(`http://localhost/api/productions/config-panel?${params.toString()}`, {
    headers: { 'x-forwarded-for': opts?.ip ?? `203.0.113.${(Math.random() * 250 + 1) | 0}` },
  });
}

beforeEach(() => {
  resetFakeDb();
});

describe('REG-13: config-panel schema (Phase-4 C+D)', () => {
  test('REG-13a: music_video panel — song selector, engine, honest limitations, planned steps, shots', () => {
    const p = buildConfigPanel('music_video');
    const keys = p.fields.map(f => f.key);
    expect(keys).toContain('songArtifactId');
    expect(keys).toContain('videoEngine');
    expect(keys).toContain('aspect');
    expect(keys).toContain('durationSec');
    expect(keys).toContain('fps');
    expect(keys).toContain('resolution');
    expect(p.plannedSteps).toEqual(plannedStepsFor('music_video'));
    // সৎ-সীমা: লিপ-সিঙ্ক নেই + প্রসিডিউরাল স্কোরের সৎ নোট
    expect(p.limitations.some(l => l.includes('লিপ-সিঙ্ক'))).toBe(true);
    expect(p.limitations.some(l => l.includes('প্রসিডিউরাল'))).toBe(true);
    // শট-আনুমান engine-সচেতন
    expect(p.estimatedShots.engine).toBe('ai_diffusion');
    expect(p.estimatedShots.min).toBeGreaterThan(0);
    expect(p.estimatedShots.max).toBeGreaterThanOrEqual(p.estimatedShots.min);
  });

  test('REG-13b: short_film panel — filmMode + subtitles; audio panel — voiceover/instrumental', () => {
    const film = buildConfigPanel('short_film');
    expect(film.fields.map(f => f.key)).toContain('filmMode');
    expect(film.fields.map(f => f.key)).toContain('subtitles');
    const audio = buildConfigPanel('audio');
    const op = audio.fields.find(f => f.key === 'audioOperation');
    expect(op?.options?.map(o => o.value)).toEqual(['voiceover', 'instrumental']);
  });

  test('REG-13c: duration options stay within DURATION_LIMITS for every video/audio type', () => {
    for (const type of ['motion_video', 'music_video', 'short_film', 'audio'] as const) {
      const p = buildConfigPanel(type);
      const dur = p.fields.find(f => f.key === 'durationSec')!;
      expect(dur).toBeDefined();
      const lim = DURATION_LIMITS[type];
      expect(dur.min).toBe(lim.min);
      expect(dur.max).toBe(lim.max);
      for (const opt of dur.options ?? []) {
        const v = Number(opt.value);
        expect(v).toBeGreaterThanOrEqual(lim.min);
        expect(v).toBeLessThanOrEqual(lim.max);
      }
      expect((dur.options ?? []).length).toBeGreaterThan(0);
    }
  });

  test('REG-13d: unsupported options are disabled WITH reasons (60fps, 4K) — never silently offered', () => {
    const p = buildConfigPanel('music_video');
    const fps = p.fields.find(f => f.key === 'fps')!;
    const fps60 = fps.options?.find(o => o.value === '60');
    expect(fps60).toBeDefined();
    expect(fps60!.disabled).toBe(true);
    expect(fps60!.disabledReasonBn).toBeTruthy();

    const res = p.fields.find(f => f.key === 'resolution')!;
    const res4k = res.options?.find(o => o.value === '4k');
    expect(res4k).toBeDefined();
    expect(res4k!.disabled).toBe(true);
    expect(res4k!.disabledReasonBn).toBeTruthy();
  });

  test('REG-13e: schema defaults pass the REAL validateSpec for every type', () => {
    for (const type of ['image', 'audio', 'motion_video', 'music_video', 'short_film'] as const) {
      const p = buildConfigPanel(type);
      const spec: Record<string, unknown> = { type };
      for (const f of p.fields) {
        const v = f.value ?? f.defaultValue;
        if (v !== undefined && v !== '') spec[f.key] = f.kind === 'select' && (f.min !== undefined) ? Number(v) : v;
      }
      const v = validateSpec(spec);
      expect(v.ok).toBe(true);
    }
  });

  // ------------------------------------------------------------
  // ক্ষেত্র-যাচাই (প্যানেল-পূর্ব, ক্লায়েন্ট-পক্ষ — সার্ভার-যাচাইয়ের পূরক)
  // ------------------------------------------------------------

  test('REG-13f: field validation — required missing, disabled option, out-of-range, custom-in-range, optional omitted', () => {
    const p = buildConfigPanel('music_video');

    // required (quality) অনুপস্থিত → স্পষ্ট ত্রুটি
    const missing = validateFieldsAgainstSchema(p, {
      type: 'music_video',
      videoEngine: 'ai_diffusion',
      aspect: '9:16',
      durationSec: '40',
      language: 'bn',
    });
    expect(missing.some(e => e.key === 'quality' && e.messageBn.includes('আবশ্যক'))).toBe(true);

    // নিষ্ক্রিয় অপশন (60fps) নির্বাচিত → কারণসহ ত্রুটি
    const disabled = validateFieldsAgainstSchema(p, {
      quality: 'standard',
      fps: '60',
      videoEngine: 'ai_diffusion',
    });
    const fpsErr = disabled.find(e => e.key === 'fps');
    expect(fpsErr).toBeDefined();
    // সৎ-কারণ বার্তাটিই ত্রুতি (৬০FPS পাইপলাইনে নেই)
    expect(fpsErr!.messageBn).toContain('ফ্রেম-রেট');
    expect(fpsErr!.messageBn).toContain('৬০FPS');

    // সীমা-বহির্ভূত দৈর্ঘ্য (400s) → সীমা-ত্রুটি
    const outOfRange = validateFieldsAgainstSchema(p, {
      quality: 'standard',
      durationSec: '400',
    });
    expect(outOfRange.some(e => e.key === 'durationSec' && e.messageBn.includes('সীমা'))).toBe(true);

    // প্রিসেট-তালিকার বাইরের কিন্তু সীমার-ভেতরের দৈর্ঘ্য (45s) → বৈধ
    const custom = validateFieldsAgainstSchema(p, {
      quality: 'standard',
      videoEngine: 'ai_diffusion',
      aspect: '9:16',
      durationSec: '45',
      language: 'bn',
    });
    expect(custom.filter(e => e.key === 'durationSec')).toEqual([]);

    // ঐচ্ছিক ক্ষেত্র বাদ দিলে কোনো ত্রুটি নয়
    const minimal = validateFieldsAgainstSchema(p, {
      quality: 'standard',
      videoEngine: 'ai_diffusion',
      aspect: '9:16',
      durationSec: '40',
      language: 'bn',
    });
    expect(minimal).toEqual([]);
  });

  // ------------------------------------------------------------
  // GET /api/productions/config-panel — রিয়েল রাউট হ্যান্ডলার
  // ------------------------------------------------------------

  test('REG-13g: valid type → 200 with schema; invalid type → 400', async () => {
    const ok = await GET(panelRequest('music_video'));
    expect(ok.status).toBe(200);
    const data = await ok.json();
    expect(data.type).toBe('music_video');
    expect(Array.isArray(data.fields)).toBe(true);
    expect(data.fields.length).toBeGreaterThan(0);
    expect(data.limitations.length).toBeGreaterThan(0);

    const bad = await GET(panelRequest('hologram'));
    expect(bad.status).toBe(400);
  });

  test('REG-13h: music_video + conversationId → uploaded songs listed as id/name only', async () => {
    const conv = seedConversation('conv-13h');
    state().artifacts.set('art-song-1', {
      id: 'art-song-1',
      conversationId: conv.id,
      runId: null,
      productionId: null,
      messageId: null,
      origin: 'user_upload',
      kind: 'audio',
      mimeType: 'audio/mpeg',
      fileName: 'amar-gaan.mp3',
      size: 1000,
      storagePath: 'storage/x.mp3',
      sourceUrl: null,
      metaJson: null,
      createdAt: new Date(Date.now() - 5_000),
    });
    const res = await GET(panelRequest('music_video', { conversationId: conv.id }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sourceOptions).toBeDefined();
    expect(data.sourceOptions.songs).toEqual([{ id: 'art-song-1', fileName: 'amar-gaan.mp3' }]);
    // নিরাপত্তা: URL/পাথ/গোপন তথ্য কখনো যায় না
    const json = JSON.stringify(data.sourceOptions);
    expect(json).not.toContain('storagePath');
    expect(json).not.toContain('storage/');
  });

  test('REG-13i: rate limit — 31st rapid request from the same client → 429', async () => {
    const ip = '198.51.100.77';
    let last = 200;
    for (let i = 0; i < 31; i++) {
      const res = await GET(panelRequest('image', { ip }));
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

// ------------------------------------------------------------
// (R-FIX-4 / A2-F02) স্কিমা-ক্যাশ স্বাস্থ্য — REAL use-config-panel-এর
// মডিউল-ক্যাশ ব্যবস্থাপনা (হুক-ফাংশনগুলো নয় — DOM/RTL নেই, তাই ক্যাশের
// পিওর একক-চুক্তি: fresh/বাসি যাচাই + বাতিলকরণ + পুনঃআনার সিড)।
// ------------------------------------------------------------

const {
  peekConfigPanelSchema,
  rememberConfigPanelSchema,
  isSchemaCacheFresh,
  invalidateConfigPanelSchema,
} = await import('@/hooks/use-config-panel');

describe('REG-13j: config-panel schemaCache invalidation + freshness (A2-F02 — songs uploaded after card creation surface without a full reload)', () => {
  const schemaA = buildConfigPanel('music_video');
  const schemaB = buildConfigPanel('short_film');

  test('REG-13j-1: freshness window — a fresh entry is served, a stale entry is not "fresh" (the refetch trigger)', () => {
    // এন্ট্রি মনে রাখা (fetchedAt টেস্ট বসায়) — কার্ড তৈরির মুহূর্তের মতো
    rememberConfigPanelSchema('music_video:conv-a1', schemaA, Date.now() - 1_000);
    expect(peekConfigPanelSchema('music_video:conv-a1')).toBe(schemaA);
    expect(isSchemaCacheFresh('music_video:conv-a1')).toBe(true);

    // ৩১ সে. আগের এন্ট্রি — বাসি: মাউন্ট/refresh-পথ পুনঃআনা ট্রিগার করে
    rememberConfigPanelSchema('music_video:conv-a2', schemaA, Date.now() - 31_000);
    expect(isSchemaCacheFresh('music_video:conv-a2')).toBe(false);
    // পুরনো স্কিমা ততক্ষণ প্রদর্শন-ফলব্যাক হিসেবে থাকে (লোডিং-ফ্লিকার নয়)
    expect(peekConfigPanelSchema('music_video:conv-a2')).toBe(schemaA);

    // সদ্য-আনা এন্ট্রি আবার সদ্য
    rememberConfigPanelSchema('music_video:conv-a2', schemaA, Date.now());
    expect(isSchemaCacheFresh('music_video:conv-a2')).toBe(true);
  });

  test('REG-13j-2: invalidateConfigPanelSchema — per-type, per-conversation, and full-clear all drop exactly what they claim', () => {
    rememberConfigPanelSchema('music_video:conv-1', schemaA);
    rememberConfigPanelSchema('music_video:conv-2', schemaA);
    rememberConfigPanelSchema('short_film:conv-1', schemaB);

    // শুধু এক কথোপকথনের music_video এন্ট্রি
    invalidateConfigPanelSchema('music_video', 'conv-1');
    expect(peekConfigPanelSchema('music_video:conv-1')).toBeNull();
    expect(peekConfigPanelSchema('music_video:conv-2')).toBe(schemaA);
    expect(peekConfigPanelSchema('short_film:conv-1')).toBe(schemaB);

    // প্রকারভেদে সব (নতুন অডিও-আপলোডের পরে গান-তালিকা সব কথোপকথনেই সদ্যি)
    invalidateConfigPanelSchema('music_video');
    expect(peekConfigPanelSchema('music_video:conv-2')).toBeNull();
    expect(peekConfigPanelSchema('short_film:conv-1')).toBe(schemaB);

    // সম্পূর্ণ পরিষ্কার
    invalidateConfigPanelSchema();
    expect(peekConfigPanelSchema('short_film:conv-1')).toBeNull();
  });

  test('REG-13j-3: invalidation makes the next mount refetch — the pre-fix "stale until page reload" dead end is gone (upload → invalidate → fresh fetch seeds the new song list)', () => {
    // প্রাক-ফিক্স দোষ: ক্যাশ কখনো বাতিল হত না — কার্ড খোলার পরে আপলোড করা
    // গান পুরো পৃষ্ঠা-রিফ্রেশ ছাড়া গান-নির্বাচকে আসত না। এখন: এন্ট্রি
    // বাতিল হলে পরের মাউন্ট/refresh-ই পুনঃআনা করে (নিচে সিড-প্রমাণ)।
    rememberConfigPanelSchema('music_video:conv-fresh', schemaA);
    expect(isSchemaCacheFresh('music_video:conv-fresh')).toBe(true);

    invalidateConfigPanelSchema('music_video', 'conv-fresh');
    expect(peekConfigPanelSchema('music_video:conv-fresh')).toBeNull();
    // পুনঃআনা-সিমুলেশন: নতুন স্কিমা (নতুন গান-তালিকাসহ) বসে গেলে সদ্য-এন্ট্রি
    const schemaNew = buildConfigPanel('music_video');
    rememberConfigPanelSchema('music_video:conv-fresh', schemaNew);
    expect(peekConfigPanelSchema('music_video:conv-fresh')).toBe(schemaNew);
    expect(isSchemaCacheFresh('music_video:conv-fresh')).toBe(true);
  });
});
