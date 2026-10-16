// ============================================================
// REG-18 — নিশ্চিতকরণ-পূর্ব শট-পরিকল্পনা-প্রিভিউ রুট
// (POST /api/productions/plan-preview — Phase-5 §7)।
//
// Modules under test (REAL): রুট-হ্যান্ডলার সম্পূর্ণ — owner-প্রমাণীকরণ,
// ২০/মিনিট রেট-লিমিট, স্পেক-সাইজ সীমা, §15 validateSpec-পুনঃযাচাই,
// কথোপকথন-মালিকানা + user_upload-অডিও-শুধু গান-সমাধান, নির্ধারক
// প্রিভিউ-পরিকল্পনা (preview.ts → পাইপলাইনের একই ফাংশন)।
//
// Mocked boundaries:
//  - '@/lib/security' → requireOwner (পরিস্থিতি-চালিত ok/401)
//  - '@/lib/db' → fakeDb (কথোপকথন/আর্টিফ্যাক্ট মানচিত্র)
//  - '@/lib/agent/storage' → readArtifactFile (প্রকৃত WAV-ফিক্সচার বাইট;
//    প্রতি-টেস্ট বাইট-ওভাররাইড + থ্রো-সুইচ — REG-18i/18j)
//  - '@/lib/agent/capabilities' → প্রকৃত মডিউলের সম্পূর্ণ স্প্রেড, কেবল
//    validateSpec প্রতি-টেস্ট নিয়ন্ত্রণযোগ্য (৪২২-শাখা চালাতে — REG-18j)
//  - কোনো LLM/প্রোভাইডার কল নেই — প্রিভিউ শূন্য-ব্যয় (স্থানীয় ffmpeg
//    বিট-বিশ্লেষণ ক্যাশ-সহ)
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { fakeDb, resetFakeDb, seedConversation, state, nextId, type FakeArtifact } from '../helpers/fake-db';
import { freshDir, cleanupRoots, buildSpeechWav } from '../helpers/cinematic-harness';
import { writeFile } from 'fs/promises';
import path from 'path';

let ownerOk = true;
let fixtureWav: Buffer = Buffer.alloc(0);
// প্রতি-টেস্ট স্টোরেজ-সুইচ: null → প্রকৃত ফিক্সচার-বাইট (REG-18i/18j)
let artifactBytes: Buffer | null = null;
let artifactReadError: Error | null = null;
// প্রতি-টেস্ট validateSpec-ওভাররাইড: null → প্রকৃত যাচাইকারী (REG-18j)
let validateSpecOverride: ((raw: unknown) => unknown) | null = null;

mock.module('@/lib/security', () => ({
  requireOwner: async () => {
    if (ownerOk) return { ok: true as const };
    return {
      ok: false as const,
      response: new Response('unauthorized', { status: 401 }),
    };
  },
}));

mock.module('@/lib/db', () => ({ db: fakeDb }));

mock.module('@/lib/agent/storage', () => ({
  readArtifactFile: async () => {
    if (artifactReadError) throw artifactReadError;
    return artifactBytes ?? fixtureWav;
  },
  artifactsDir: () => '/tmp/reg18-artifacts',
  artifactStoragePath: () => 'x',
}));

// capabilities: প্রকৃত মডিউলের সম্পূর্ণ স্প্রেড — কেবল validateSpec প্রতি-
// টেস্ট নিয়ন্ত্রণযোগ্য (৪২২-শাখা সরাসরি চালাতে); বাকি সব প্রতীক (maxShots
// ইত্যাদি) প্রকৃতই — মক কখনো প্রকৃত আচরণ ঢেকে দেয় না (P4-2-শ্রেণির
// মক-লিক নিরাপত্তা); mock.restore() শেষে ফিরিয়ে দেয়।
// খেয়াল: প্রকৃত validateSpec-ফাংশনটি মান হিসেবে মক-নিবন্ধনের আগেই
// ধরে নিতে হয় — নিবন্ধনের পরে realCapabilities.validateSpec নিজেই
// লাইভ-প্যাচ হয়ে মক-র‍্যাপার হয়ে যায়; সেটিকেই ডাকলে অসীম রিকার্শন
// (JSC টেইল-কল-এলিমিনেশনে স্ট্যাক-ওভারফ্লো না হয়ে চির-হ্যাং) হতো —
// t17/t19-এর real-symbol-capture নিয়মই এখানেও।
const realCapabilities = await import('@/lib/agent/capabilities');
const realValidateSpec = realCapabilities.validateSpec;
mock.module('@/lib/agent/capabilities', () => ({
  ...realCapabilities,
  validateSpec: (raw: unknown) =>
    validateSpecOverride ? validateSpecOverride(raw) : realValidateSpec(raw),
}));

const { POST } = await import('@/app/api/productions/plan-preview/route');
const { parseAndValidateShotPlan } = await import('@/lib/agent/cinematic/validate');
const { resetSongAnalysisCacheForTests } = await import('@/lib/agent/cinematic/preview');

const g = globalThis as unknown as Record<string, unknown>;

function call(spec: unknown, opts: { ip?: string; conversationId?: string } = {}): Promise<Response> {
  const ip = opts.ip ?? '203.0.113.7';
  return POST(
    new Request('http://localhost/api/productions/plan-preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ spec, ...(opts.conversationId ? { conversationId: opts.conversationId } : {}) }),
    }) as unknown as Parameters<typeof POST>[0],
  );
}

const MV_SPEC = { type: 'music_video', title: 'নিয়ন বৃষ্টি', durationSec: 20, quality: 'draft', mood: 'বৃষ্টিভেজা রাত' };
const SF_SPEC = { type: 'short_film', title: 'বিদায়', durationSec: 40, quality: 'draft' };

/** গান-আর্টিফ্যাক্ট বপন — REG-18e-এর প্যাটার্নেই (সম্পূর্ণ রো, মানচিত্রে বসানো)। */
function seedAudioArtifact(conversationId: string, over: Partial<FakeArtifact> = {}): string {
  const artId = nextId('art');
  state().artifacts.set(artId, {
    id: artId,
    conversationId,
    runId: null,
    productionId: null,
    messageId: null,
    origin: 'user_upload',
    kind: 'audio',
    mimeType: 'audio/wav',
    fileName: 'song.wav',
    size: fixtureWav.length,
    storagePath: 'storage/song.wav',
    sourceUrl: null,
    metaJson: null,
    createdAt: new Date(),
    ...over,
  });
  return artId;
}

beforeEach(() => {
  ownerOk = true;
  artifactBytes = null;
  artifactReadError = null;
  validateSpecOverride = null;
  resetFakeDb();
  resetSongAnalysisCacheForTests();
  (g.__rateLimitWindows as Map<string, number[]> | undefined)?.clear();
});

afterAll(async () => {
  await cleanupRoots();
  // মক-পরিস্রবণ-স্বাস্থ্য: পরের ফাইলগুলো প্রকৃত মডিউল ফেরো পায়
  mock.restore();
});

describe('REG-18: plan-preview রুট (Phase-5 §7)', () => {
  test('REG-18a: owner-প্রমাণীকরণ ব্যর্থ → 401, কোনো প্রিভিউ নয়', async () => {
    ownerOk = false;
    const res = await call(MV_SPEC, { ip: '203.0.113.101' });
    expect(res.status).toBe(401);
  });

  test('REG-18b: ইনপুট-সীমা — spec নেই/বড়/অ-সমর্থিত ধরন → 400', async () => {
    expect((await call(undefined, { ip: '203.0.113.1' })).status).toBe(400);
    expect((await call('string-spec', { ip: '203.0.113.2' })).status).toBe(400);
    expect(
      (await call({ ...MV_SPEC, idea: 'x'.repeat(21_000) }, { ip: '203.0.113.3' })).status,
    ).toBe(400);
    expect((await call({ type: 'audio', title: 'গান' }, { ip: '203.0.113.4' })).status).toBe(400);
  });

  test('REG-18c: §15-পুনঃযাচাই — অবৈধ ওভাররাইড সার্ভারে বাদ, পরিকল্পনার কাঠামো নির্ধারকই', async () => {
    // অবৈধ এনাম-ওভাররাইড — validateSpec স্যানিটাইজ করে (বাদ + সমন্বয়-নোট);
    // প্রিভিউ-পরিকল্পনায় তাই প্রয়োগই হয়নি: S01 প্ল্যানারের এস্টাব্লিশিংই থাকে
    const res = await call(
      { ...MV_SPEC, cinematicOverrides: { shots: [{ index: 0, size: 'megawide' }, { index: 9, movement: 'orbit' }] }, durationSec: -5 },
      { ip: '203.0.113.5' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: {
        shots: { shotId: string; size: string; movement: string }[];
        adjustments: { field: string; from: string; to: string; reason: string }[];
      };
    };
    // প্রতিক্রিয়ার পরিকল্পনাই কাঠামোগতভাবে বৈধ (কন্ট্রাক্ট-আকৃতির প্রমাণ)
    expect(parseAndValidateShotPlan(body.plan).ok).toBe(true);
    expect(body.plan.shots[0].size).toBe('establishing_wide'); // ওভাররাইড প্রয়োগ হয়নি
    expect(body.plan.shots[0].movement).not.toBe('orbit');
    // কাঠামো-নির্ধারক: বাদ-পড়া অবৈধ ওভাররাইডের কোনো মিথ্যা প্রয়োগ-নোট নেই।
    // adjustments-এ কেবল পরিকল্পনার নিজস্ব সৎ-সমন্বয় থাকতে পারে — কোনো
    // এন্ট্রিই ব্যবহারকারী-সম্পাদনা/ওভাররাইড-বাদ দাবি করে না, এবং অবৈধ
    // মান ('megawide') প্রতিক্রিয়ায় প্রতিধ্বনিত হয় না
    expect(Array.isArray(body.plan.adjustments)).toBe(true);
    for (const a of body.plan.adjustments) {
      expect(typeof a.field).toBe('string'); // এন্ট্রি-আকৃতি সত্যিই adjustments-এর
      expect(a.field.startsWith('shot.S01.')).toBe(false); // S01-এ কোনো প্রয়োগ-নোট নয়
      expect(a.field.startsWith('shot-override[')).toBe(false); // বাদ-নোটও নয় — স্যানিটাইজ আগেই বাদ দিয়েছে
    }
    expect(JSON.stringify(body).includes('megawide')).toBe(false);
    // ঋণাত্মক দৈর্ঘ্য ক্ল্যাম্পড — প্রিভিউ ডিফল্ট দৈর্ঘ্য থেকে জানালা বানায়
    expect(body.plan.shots.length).toBeGreaterThan(0);
  });

  test('REG-18d: মিউজিক-ভিডিও প্রসিডিউরাল — নির্ধারক পরিকল্পনা + সৎ লেবেল', async () => {
    const res = await call(MV_SPEC, { ip: '203.0.113.8' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: unknown;
      summary: { shotCount: number; totalPlannedSec: number; beatSource: string; deliveryCounts: Record<string, number>; limitations: string[] };
      beatSourceLabel: string;
    };
    expect(parseAndValidateShotPlan(body.plan).ok).toBe(true);
    expect(body.summary.beatSource).toBe('bpm_grid_estimate');
    expect(body.summary.shotCount).toBe(2); // draft ai — পাইপলাইন-সূত্রই
    expect(body.beatSourceLabel).toContain('BPM-গ্রিড');
    // সৎ-সীমা: নেটিভ ক্যামেরা-প্যারামিটার নেই + লিপ-সিঙ্ক নেই
    expect(body.summary.limitations.some(l => l.includes('নেটিভ ক্যামেরা-প্যারামিটার নেই'))).toBe(true);
    expect(body.summary.limitations.some(l => l.includes('লিপ-সিঙ্ক নেই'))).toBe(true);
  });

  test('REG-18e: আপলোড-গান — মালিকানা+ধরন-সীমা, সৎ ফলব্যাক, বিশ্লেষণ-লেবেল', async () => {
    const dir = await freshDir('reg18e');
    await writeFile(path.join(dir, 'song.wav'), fixtureWav);
    const conv = seedConversation();
    // সঠিক: এই কথোপকথনের user_upload অডিও
    const artId = nextId('art');
    state().artifacts.set(artId, {
      id: artId,
      conversationId: conv.id,
      runId: null,
      productionId: null,
      messageId: null,
      origin: 'user_upload',
      kind: 'audio',
      mimeType: 'audio/wav',
      fileName: 'song.wav',
      size: fixtureWav.length,
      storagePath: 'storage/song.wav',
      sourceUrl: null,
      metaJson: null,
      createdAt: new Date(),
    });
    const res = await call(
      { ...MV_SPEC, songArtifactId: artId, durationSec: 20 },
      { ip: '203.0.113.9', conversationId: conv.id },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { plan: { beatSource: string; shots: { shotId: string }[] }; summary: { beatSource: string }; analysisLabel?: string; beatSourceLabel: string };
    // সাইন-টোনে বিট নেই → সৎ duration_fallback (বানানো বিট নয়)
    expect(body.plan.beatSource).toBe('duration_fallback');
    expect(body.summary.beatSource).toBe('duration_fallback');
    expect(typeof body.analysisLabel).toBe('string');

    // ভুল ধরন (ভিডিও-আর্টিফ্যাক্ট) → গান হিসেবে নেওয়া হয় না → প্রসিডিউরাল
    const videoArtId = nextId('art');
    state().artifacts.set(videoArtId, {
      id: videoArtId,
      conversationId: conv.id,
      runId: null,
      productionId: null,
      messageId: null,
      origin: 'user_upload',
      kind: 'video',
      mimeType: 'video/mp4',
      fileName: 'clip.mp4',
      size: 100,
      storagePath: 'storage/clip.mp4',
      sourceUrl: null,
      metaJson: null,
      createdAt: new Date(),
    });
    const res2 = await call(
      { ...MV_SPEC, songArtifactId: videoArtId },
      { ip: '203.0.113.10', conversationId: conv.id },
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { plan: { beatSource: string } };
    expect(body2.plan.beatSource).toBe('bpm_grid_estimate'); // প্রসিডিউরাল ফলব্যাক

    // অন্য কথোপকথনের আর্টিফ্যাক্ট → নিরাপত্তা-সীমা (পড়া হয় না)
    const otherConv = seedConversation();
    const res3 = await call(
      { ...MV_SPEC, songArtifactId: artId },
      { ip: '203.0.113.11', conversationId: otherConv.id },
    );
    expect(res3.status).toBe(200);
    const body3 = (await res3.json()) as { plan: { beatSource: string } };
    expect(body3.plan.beatSource).toBe('bpm_grid_estimate'); // মালিকানা-অমিল → গান নয়
  });

  test('REG-18f: শর্টফিল্ম — কঙ্কাল-প্রিভিউ + রানটাইম-সীমার সৎ ঘোষণা', async () => {
    const res = await call(SF_SPEC, { ip: '203.0.113.12' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: unknown;
      summary: { shotCount: number; limitations: string[]; beatSource: string };
    };
    expect(parseAndValidateShotPlan(body.plan).ok).toBe(true);
    expect(body.summary.beatSource).toBe('narrative');
    expect(body.summary.limitations.some(l => l.includes('জেনারেশন-সময়ে'))).toBe(true);
  });

  test('REG-18g: রেট-লিমিট — এক IP থেকে ২১তম অনুরোধ → 429', async () => {
    const ip = '203.0.113.99';
    for (let i = 0; i < 20; i++) {
      const r = await call(MV_SPEC, { ip });
      expect(r.status).toBe(200);
    }
    const blocked = await call(MV_SPEC, { ip });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    // ভিন্ন IP প্রভাবিত নয়
    expect((await call(MV_SPEC, { ip: '203.0.113.98' })).status).toBe(200);
  });

  test('REG-18h: উৎস-সীমা — user_upload নয় এমন অডিও (জেনারেশন-উৎস) গান নয় → সৎ প্রসিডিউরাল ফলব্যাক', async () => {
    const conv = seedConversation();
    // ধরন/কথোপকথন সঠিক, কিন্তু উৎস 'production' (যেমন আগের রানের তৈরি
    // ইন্সট্রুমেন্টাল) — রুট এটিকে আপলোড-গান হিসেবে নেয় না
    const artId = seedAudioArtifact(conv.id, {
      origin: 'production',
      fileName: 'instrumental.wav',
    });
    const res = await call(
      { ...MV_SPEC, songArtifactId: artId },
      { ip: '203.0.113.20', conversationId: conv.id },
    );
    expect(res.status).toBe(200); // ৪xx নয় — নীরব সৎ-ফলব্যাক
    const body = (await res.json()) as {
      plan: { beatSource: string };
      summary: { shotCount: number };
      beatSourceLabel: string;
      analysisLabel?: string;
    };
    // মাপা-বিট ভান নয় — প্রসিডিউরাল BPM-গ্রিডের সৎ লেবেল
    expect(body.plan.beatSource).toBe('bpm_grid_estimate');
    expect(body.beatSourceLabel).toContain('BPM-গ্রিড');
    expect(body.summary.shotCount).toBeGreaterThan(0);
    expect(body.analysisLabel).toBeUndefined(); // বিশ্লেষণই হয়নি
  });

  test('REG-18i: গান-ফাইল পড়া ব্যর্থ → song=null সৎ ফলব্যাক — পরিকল্পনা তবুও ফেরে', async () => {
    const conv = seedConversation();
    const artId = seedAudioArtifact(conv.id);
    artifactReadError = new Error('স্টোরেজ পড়া ব্যর্থ: /home/z/my-project/storage/lost-song.wav');
    const res = await call(
      { ...MV_SPEC, songArtifactId: artId },
      { ip: '203.0.113.23', conversationId: conv.id },
    );
    expect(res.status).toBe(200); // স্টোরেজ-ব্যর্থতা প্রিভিউকে ভাসায় না
    const body = (await res.json()) as {
      plan: unknown;
      summary: { beatSource: string; shotCount: number };
      beatSourceLabel: string;
      analysisLabel?: string;
    };
    expect(parseAndValidateShotPlan(body.plan).ok).toBe(true); // পরিকল্পনা সম্পূর্ণ
    expect(body.summary.beatSource).toBe('bpm_grid_estimate');
    expect(body.beatSourceLabel).toContain('BPM-গ্রিড');
    expect(body.summary.shotCount).toBeGreaterThan(0);
    expect(body.analysisLabel).toBeUndefined();
    // ভেতরের স্টোরেজ-ত্রুটির পথ প্রতিক্রিয়ায় যায়নি (নীরবে গিলে ফেলা)
    const raw = JSON.stringify(body);
    expect(raw.includes('/home/')).toBe(false);
    expect(raw.includes('lost-song')).toBe(false);
  });

  test('REG-18j: ৪২২-পথ — অবৈধ-স্পেক ও বিশ্লেষণ-ব্যর্থতা উভয় প্রতিক্রিয়াই সার্ভার-পথ-মুক্ত', async () => {
    // (১) অবৈধ-স্পেক ৪২২: validateSpec-ব্যর্থতা (ইচ্ছাকৃতভাবে পথ-বহিত
    // বার্তাসহ — নিরাপত্তা-গভীরতার লক)। রুটের ৪০০-গেটের কারণে সাধারণ
    // ইনপুট থেকে এই শাখায় পৌঁছানো যায় না — তাই যাচাইকারী বাধ্য করা
    validateSpecOverride = () => ({
      ok: false,
      errors: ['গান-আর্টিফ্যাক্ট অবৈধ: /tmp/reg18-forced-invalid.wav (নমুনা-ত্রুটি)'],
    });
    const res1 = await call(MV_SPEC, { ip: '203.0.113.24' });
    expect(res1.status).toBe(422);
    const raw1 = await res1.text();
    const body1 = JSON.parse(raw1) as { error: string; details: string[] };
    expect(body1.error).toBe('সেটিংস যাচাই ব্যর্থ');
    expect(Array.isArray(body1.details)).toBe(true);
    expect(raw1.includes('/tmp')).toBe(false); // টেম্প-পথ লিক নয়
    expect(raw1.includes('[ফাইল]')).toBe(true); // পথ → সৎ প্লেসহোল্ডার
    // ওভাররাইড বন্ধ — (২)-তে প্রকৃত যাচাইকারীই আবার চালু
    validateSpecOverride = null;

    // (২) বিশ্লেষণ-ব্যর্থতা ৪২২: সঠিক user_upload গান, কিন্তু বাইট নষ্ট —
    // প্রকৃত ffprobe ব্যর্থ হয় এবং তার বার্তায় টেম্প-পথ থাকে
    const conv = seedConversation();
    const artId = seedAudioArtifact(conv.id);
    artifactBytes = Buffer.from('এটি প্রকৃত অডিও ফাইল নয় — ffprobe অবশ্যই ব্যর্থ করবে');
    const res2 = await call(
      { ...MV_SPEC, songArtifactId: artId },
      { ip: '203.0.113.25', conversationId: conv.id },
    );
    expect(res2.status).toBe(422);
    const raw2 = await res2.text();
    expect(raw2.includes('/tmp')).toBe(false); // টেম্প-পথ স্যানিটাইজড
    expect(/\/(?:home|var|usr|Users|root|private|mnt|etc|opt|srv)\b/.test(raw2)).toBe(false); // অন্য কোনো অ্যাবসোলিউট-পথও নয়
    expect(raw2.includes('[ফাইল]')).toBe(true); // পথ-প্রতিস্থাপনের প্রমাণ
    expect(raw2.includes('ffprobe')).toBe(true); // "কী ব্যর্থ" — সৎ রাখে
  });

  test('REG-18k (A2-F06, R-FIX-3): কঙ্কাল-বৈচিত্র্য — রুট-পথে সন্নিহিত অভিন্ন (সাইজ+মুভমেন্ট) জোড়া নয়', async () => {
    // ৪০ সে./high ai → ৪ শট, ৪ দৃশ্য — পুরনো কোডে S02 ও S03 উভয়ই
    // wide+pan_right হতো (findings-a2 A2-F06-এর প্রমাণ-কেস: টানা নন-
    // স্ট্যাটিক মুভ-পুনরাবৃত্তি + সন্নিহিত একই সাইজ)। রুট প্রিভিউ এখন
    // রান-পরিকল্পকের §3-নিয়মের আলো-সংস্করণ গার্ড মেনে প্যাটার্ন ভাঙে।
    const res = await call(
      { type: 'short_film', title: 'বিদায়', durationSec: 40, quality: 'high' },
      { ip: '203.0.113.26' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plan: { shots: { shotId: string; size: string; movement: string }[]; adjustments: unknown[] };
    };
    expect(parseAndValidateShotPlan(body.plan).ok).toBe(true);
    const shots = body.plan.shots;
    expect(shots.length).toBe(4); // ceil(40/10)=4 — হাই-কোয়ালিটি ai বাজেট
    // রিগ্রেশন-কেস: S02 ও S03 আর অভিন্ন নয় (গার্ড প্যানের দিক ভাঙে)
    expect(`${shots[1].size}+${shots[1].movement}`).not.toBe(`${shots[2].size}+${shots[2].movement}`);
    // সাধারণ নিয়ম: কোনো সন্নিহিত জোড়াই একই (সাইজ এবং মুভমেন্ট) নয়;
    // টানা একই নন-স্ট্যাটিক মুভও নয় (static পুনরাবৃত্তি বৈধ)
    for (let i = 1; i < shots.length; i++) {
      expect(`${shots[i].size}+${shots[i].movement}`).not.toBe(`${shots[i - 1].size}+${shots[i - 1].movement}`);
      if (shots[i].movement !== 'static') {
        expect(shots[i].movement).not.toBe(shots[i - 1].movement);
      }
    }
    // স্থির-আর্ক চুক্তি অটুট: প্রথম এস্টাব্লিশিং, শেষ সমাপনি-জুম-আউট
    expect(shots[0].size).toBe('establishing_wide');
    expect(shots[shots.length - 1].movement).toBe('zoom_out');
    // গার্ড সন্তুষ্ট — সৎ-নোটের (skeleton.diversity) দরকারই হয়নি
    expect(body.plan.adjustments).toEqual([]);
  });
});

// স্যুট-সেটআপ: প্রকৃত WAV ফিক্সচার (গান-আর্টিফ্যাক্ট বাইট)
{
  const dir = await freshDir('reg18-fixture');
  fixtureWav = await buildSpeechWav(dir, 'song.wav');
}
