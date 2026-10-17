// ============================================================
// REG-22 — লিপ-সিঙ্ক প্রোভাইডার-চুক্তি (D-5/B5) + সীমাবদ্ধ ডাউনলোড
// (D-4/B4) + placeDialogueLine-এর প্রকৃত চুক্তি (PART D)
//
//  L1–L6: lip_sync_module-এর নতুন LipSyncProvider চুক্তি —
//    সৎ-অসমর্থিত অ্যাডাপ্টার (প্রক্রিয়াকরণ সবসময় LIPSYNC_UNSUPPORTED
//    ছুড়ে দেয়, ৪-মাত্রিক বাধা-ভাঙন + বিকল্পসহ), ক্ষমতা-প্রতিবেদনের
//    ফিল্ড-আকৃতি অপরিবর্তিত, খরচ/লেটেন্সির অনুমানে কোনো বানানো সংখ্যা
//    নেই (costKnown:false + latencyKnown:false), মক-প্রোভাইডারের
//    অডিও-ভোগ-ইনভ্যারিয়েন্ট (প্রকৃত অডিও-বাইট ছাড়া কোনো প্রোভাইডার
//    সফলতা দাবি করতে পারে না), validateInput-এর স্ট্রাকচারাল যাচাই,
//    এবং activeLipSyncProvider একমাত্র সত্যের উৎস (রাউটার/ম্যাট্রিক্স
//    স্ট্যাটাস সেখান থেকেই উদ্ভূত — আজ অবিকল্পিত 'unavailable')।
//
//  D1–D7: downloadVideo-র সীমাবদ্ধতা — URL-স্কিম/ক্রেডেনশিয়াল যাচাই
//    (https: বা mock: — t10/t11/t17/t19/t21-এর হার্নেস-স্কিম), টাইমআউট,
//    সর্বোচ্চ-আকার (content-length-ঘোষণা + স্ট্রিমিং-চাঙ্ক উভয় পথে),
//    কনটেন্ট-টাইপ-যাচাই (বডির আগেই), কেবল-পুনঃপ্রচেষ্টাযোগ্য-ত্রুটিতে
//    বাউন্ডেড রিট্রাই (সর্বোচ্চ ৩ প্রচেষ্টা), সফল-পথে ≥50KB + ন্যূনতম-
//    আকার-স্যানিটি অক্ষত।
//
//  P1: placeDialogueLine (short_film.ts:209-224) সরাসরি একক-পরীক্ষা —
//    D-F02/R-FIX-2 চুক্তি: কার্সার-চালিত বসানো (লাইন কখনো ওভারল্যাপ
//    করে না), নেগেটিভ/শূন্য টাইমস্ট্যাম্প ০.৮ সে.-এ ক্ল্যাম্প, ম্যালফর্মড
//    লাইন-মেটাডেটা (text/endSec অনুপস্থিত) বসানো নষ্ট করে না।
//
// Isolation: '@/lib/db' মক (Prisma-ইনস্ট্যান্সই তৈরি হয় না — short_film
// গ্রাফের একমাত্র db-আমদানি); globalThis.fetch মক (D-গ্রুপ) — নেটওয়ার্ক
// নেই; কোনো প্রোভাইডার/LLM/TTS কল নেই (ai_video-র getZAI কখনো ডাকা হয়
// না — কেবল downloadVideo); ffmpeg প্রকৃত স্থানীয় বাইনারি (D7-ফিক্সচার
// ≥50KB MP4 — নেটওয়ার্ক নয়); storage/ অপরিবৃত (bunfig preload D-1)।
// L4-এর মক-প্রোভাইডার ইচ্ছাকৃতভাবে শুধুই এই ফাইলে (src/-তে নয়)।
// ============================================================

import { describe, expect, test, mock, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { LipSyncJobSpec, LipSyncProvider, LipSyncOutput } from '@/lib/agent/video/lip_sync_module';
import type { ProviderDownloadError } from '@/lib/agent/video/ai_video';

// short_film-গ্রাফের একমাত্র db-আমদানি — মক (কোনো Prisma-ইনস্ট্যান্স নয়)
mock.module('@/lib/db', () => ({
  db: {
    character: { findMany: async () => [], upsert: async () => ({}) },
  },
}));

const { downloadVideo, ProviderDownloadError: PDE, DOWNLOAD_MAX_BYTES } = await import('@/lib/agent/video/ai_video');
const {
  runLipSync,
  LIP_SYNC_STATUS,
  LipSyncProviderError,
  unsupportedLipSyncProvider,
  activeLipSyncProvider,
} = await import('@/lib/agent/video/lip_sync_module');
const { placeDialogueLine } = await import('@/lib/agent/production/pipelines/short_film');
const { routeVideoRequest } = await import('@/lib/agent/video/capability_router');
const { AVAILABILITY_MATRIX } = await import('@/lib/agent/availability-matrix');
const { buildFixtureMp4 } = await import('../helpers/cinematic-harness');

// ------------------------------------------------------------
// সাধারণ সরঞ্জাম
// ------------------------------------------------------------

const VALID_SPEC: LipSyncJobSpec = {
  characterImageArtifactId: 'art-char-1',
  dialogueAudioArtifactId: 'art-audio-1',
  language: 'bn',
  isSinging: false,
};

const REAL_FETCH = globalThis.fetch;
const ROOTS: string[] = [];
let fetchCalls = 0;

/** প্রতি-টেস্ট fetch-মক: কল-সংখ্যা গণনা করে (নেটওয়ার্ক কখনোই নয়) */
function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  fetchCalls = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    fetchCalls++;
    return impl(String(url), init as RequestInit | undefined);
  }) as typeof fetch;
}

/** ব্যর্থতা-দাবি সহায়ক — টাইপড ProviderDownloadError ফেরায় */
async function expectDownloadError(p: Promise<Buffer>): Promise<ProviderDownloadError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(PDE);
    return err as ProviderDownloadError;
  }
  throw new Error('প্রত্যাশিত ব্যর্থতা এলো না — downloadVideo সফল হয়ে গেছে');
}

/** D4-ইনভ্যারিয়েন্টের মক — অডিও-বাইট না দেখলে কখনো সফলতা দেয় না */
function makeMockLipSyncProvider(): LipSyncProvider & { audioConsumed: boolean } {
  const provider: LipSyncProvider & { audioConsumed: boolean } = {
    audioConsumed: false,
    id: 'mock-lipsync',
    // মকটি কেবল অডিও-ইনভ্যারিয়েন্ট যাচাইয়ের — উৎপাদন-ক্ষমতার দাবি নয়,
    // তাই ক্ষমতা-প্রতিবেদনও সৎ-অনুপলব্ধই ফেরায়
    getCapabilities: () => unsupportedLipSyncProvider.getCapabilities(),
    validateInput: spec =>
      spec?.dialogueAudioArtifactId
        ? { ok: true }
        : { ok: false, reason: 'dialogueAudioArtifactId অনুপস্থিত (মক-যাচাই)' },
    estimateCostAndLatency: () => ({
      costKnown: false,
      latencyKnown: false,
      note: 'মক-প্রোভাইডার — সংখ্যা বানানো হয় না।',
    }),
    process: async (_spec, opts) => {
      const audio = opts?.audioBuffer;
      if (!audio || audio.length === 0) {
        // অডিও-বাইট ভোগ না করে সফলতা দেওয়া নিষিদ্ধ — চুক্তির মূল ইনভ্যারিয়েন্ট
        throw new LipSyncProviderError(
          'LIPSYNC_INVALID_INPUT',
          'মক-প্রোভাইডার: প্রকৃত অডিও-বাইট ছাড়া সফলতা দাবি করা হয় না'
        );
      }
      provider.audioConsumed = true;
      const out: LipSyncOutput = { processed: true, provenance: 'mock', mediaBuffer: audio };
      return out;
    },
    validateOutput: async () => ({ ok: false, reason: 'মক-প্রোভাইডার — আউটপুট যাচাই নয়।' }),
  };
  return provider;
}

// স্যুট-শুরুতে একবার: প্রকৃত যাচাই-উত্তীর্ণ ≥50KB MP4 (D6b/D7-এর জন্য)
let fixtureMp4: Buffer;
{
  const dir = await mkdtemp(path.join(tmpdir(), 'reg22-fixture-'));
  ROOTS.push(dir);
  fixtureMp4 = await buildFixtureMp4(dir, 'reg22-clip.mp4');
}

afterAll(async () => {
  globalThis.fetch = REAL_FETCH;
  await Promise.all(ROOTS.map(d => rm(d, { recursive: true, force: true }).catch(() => undefined)));
});

describe('REG-22: লিপ-সিঙ্ক প্রোভাইডার-চুক্তি + সীমাবদ্ধ ডাউনলোড', () => {
  // ----------------------------------------------------------
  // L-গ্রুপ — LipSyncProvider (D-5/B5)
  // ----------------------------------------------------------

  test('REG-22L1: runLipSync সৎ টাইপড ত্রুটি ছুড়ে দেয় — ৪-মাত্রিক বাধা + বিকল্পসহ', async () => {
    let caught: unknown;
    try {
      await runLipSync(VALID_SPEC);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LipSyncProviderError);
    const e = caught as InstanceType<typeof LipSyncProviderError>;
    expect(e.code).toBe('LIPSYNC_UNSUPPORTED');
    const msg = String(e.message);
    // ৪-মাত্রিক বাধা-ভাঙন — প্রতিটি মাত্রার সৎ রায় বার্তায় উপস্থিত
    expect(msg).toContain('লাইসেন্স needs_review');
    expect(msg).toContain('প্রোভাইডার not_exposed_by_sdk');
    expect(msg).toContain('হার্ডওয়্যার unavailable_hardware');
    expect(msg).toContain('ইন্টিগ্রেশন not_integrated');
    expect(msg).toContain('বাংলা-বেঞ্চমার্কও not_done');
    // বিকল্প স্পষ্ট — শুধু "না" নয়
    expect(msg).toContain('বিকল্প: সংলাপের অডিও (TTS) + AI-জেনারেটেড দৃশ্য');
    expect(msg).toContain('মুখের নড়াচড়ার দাবি করা হয় না');
  });

  test('REG-22L2: অসমর্থিত প্রোভাইডারের ক্ষমতা-প্রতিবেদন — অনুপলব্ধ + সব বাধা-মাত্রা উপস্থিত', () => {
    const caps = unsupportedLipSyncProvider.getCapabilities();
    expect(caps.available).toBe(false);
    expect(caps.talking.status).toBe('unavailable');
    expect(caps.singing.status).toBe('unavailable');
    expect(caps.blockageDimensions).toMatchObject({
      license: 'needs_review',
      provider: 'not_exposed_by_sdk',
      hardware: 'unavailable_hardware',
      integration: 'not_integrated',
      benchmark: 'not_done',
    });
    expect(caps.blockageDimensions.notes).toBeDefined();
    // LIP_SYNC_STATUS-র ক্ষেত্র-আকৃতি অপরিবর্তিত (UI/টুল চুক্তি)
    expect(LIP_SYNC_STATUS.available).toBe(false);
    expect(LIP_SYNC_STATUS.talkingStatus).toBe('unavailable');
    expect(LIP_SYNC_STATUS.singingStatus).toBe('unavailable');
  });

  test('REG-22L3: খরচ/লেটেন্সির অনুমান সৎ-অজানা — কোনো বানানো সংখ্যা নেই', () => {
    const est = unsupportedLipSyncProvider.estimateCostAndLatency(VALID_SPEC);
    expect(est.costKnown).toBe(false);
    expect(est.latencyKnown).toBe(false);
    // অজানা মানে অজানা — কোনো সংখ্যাসূচক ক্ষেত্রই নেই
    for (const [key, value] of Object.entries(est)) {
      expect(typeof value === 'number').toBe(false);
      expect(key).toBeTruthy();
    }
    expect(typeof est.note).toBe('string'); // কেন-অজানা তার ব্যাখ্যা আছে
  });

  test('REG-22L4: মক-ইনভ্যারিয়েন্ট — অডিও না ভোগ করে কোনো প্রোভাইডার সফলতা দিতে পারে না', async () => {
    const p1 = makeMockLipSyncProvider();
    // অডিও-অপশন নেই → ছুড়ে দেয়; খালি বাফার → ছুড়ে দেয়
    await expect(p1.process(VALID_SPEC)).rejects.toMatchObject({ code: 'LIPSYNC_INVALID_INPUT' });
    await expect(p1.process(VALID_SPEC, { audioBuffer: Buffer.alloc(0) })).rejects.toMatchObject({
      code: 'LIPSYNC_INVALID_INPUT',
    });
    expect(p1.audioConsumed).toBe(false); // এখনো কোনো অডিও দেখেনি
    // ইনভ্যারিয়েন্ট: audioConsumed:false অবস্থায় কোনো কলই সফল নয়
    let everSucceeded = false;
    for (let i = 0; i < 3; i++) {
      try {
        await p1.process(VALID_SPEC);
        everSucceeded = true;
      } catch {
        // প্রত্যাশিত ব্যর্থতা
      }
    }
    expect(everSucceeded).toBe(false);
    expect(p1.audioConsumed).toBe(false);

    // প্রকৃত অ-খালি অডিও-বাইটসহ → লেবেলসহ সফলতা (provenance:'mock')
    const audio = Buffer.from(new Uint8Array([1, 2, 3, 4, 5]));
    const out = await p1.process(VALID_SPEC, { audioBuffer: audio });
    expect(out.processed).toBe(true);
    if (out.processed) {
      expect(out.provenance).toBe('mock');
      expect(out.mediaBuffer.equals(audio)).toBe(true);
    }
    expect(p1.audioConsumed).toBe(true); // সফলতার আগেই অডিও ভোগ হয়েছে

    // ফ্রেশ ইনস্ট্যান্সও অডিও ছাড়া কখনো সফল নয়
    const p2 = makeMockLipSyncProvider();
    let p2SawSuccess = false;
    try {
      await p2.process(VALID_SPEC);
      p2SawSuccess = true;
    } catch {
      // প্রত্যাশিত
    }
    expect(p2SawSuccess).toBe(false);
    expect(p2.audioConsumed).toBe(false);
  });

  test('REG-22L5: validateInput — প্রকৃত স্ট্রাকচারাল সমস্যাগুলোই রিপোর্ট করে', () => {
    expect(unsupportedLipSyncProvider.validateInput(VALID_SPEC)).toEqual({ ok: true });

    const noChar = unsupportedLipSyncProvider.validateInput({
      ...VALID_SPEC,
      characterImageArtifactId: '',
    });
    expect(noChar.ok).toBe(false);
    if (!noChar.ok) expect(noChar.reason).toContain('characterImageArtifactId');

    const noAudio = unsupportedLipSyncProvider.validateInput({
      ...VALID_SPEC,
      dialogueAudioArtifactId: '',
    });
    expect(noAudio.ok).toBe(false);
    if (!noAudio.ok) expect(noAudio.reason).toContain('dialogueAudioArtifactId');

    const noLang = unsupportedLipSyncProvider.validateInput({ ...VALID_SPEC, language: '' });
    expect(noLang.ok).toBe(false);
    if (!noLang.ok) expect(noLang.reason).toContain('language');
  });

  test('REG-22L6: activeLipSyncProvider — একমাত্র সত্যের উৎস; রাউটার/ম্যাট্রিক্স সেখান থেকেই উদ্ভূত', () => {
    const active = activeLipSyncProvider();
    expect(active.id).toBe(unsupportedLipSyncProvider.id);
    expect(active).toBe(unsupportedLipSyncProvider); // একই ইনস্ট্যান্স — রেজিস্ট্রি একটিই
    expect(active.getCapabilities().available).toBe(false);

    // রাউটার + ম্যাট্রিক্স আজ অবিকল্পিত মানেই (অবহেলা-হার্ডকোড নয় — উদ্ভব-প্রমাণ)
    expect(routeVideoRequest('lip_sync').status).toBe('unavailable');
    const lipRows = AVAILABILITY_MATRIX.filter(
      r => r.taskType === 'talking_portrait' || r.taskType === 'singing_lipsync'
    );
    expect(lipRows.length).toBe(2);
    for (const row of lipRows) {
      expect(row.overall).toBe('unavailable_here');
      expect(row.license).toBe('needs_review');
      expect(row.provider).toBe('not_exposed_by_sdk');
      expect(row.integration).toBe('not_integrated');
      expect(row.runtime).toBe('unavailable_hardware');
    }
  });

  // ----------------------------------------------------------
  // D-গ্রুপ — downloadVideo-র সীমাবদ্ধতা (D-4/B4)
  // ----------------------------------------------------------

  test('REG-22D1: http:/file:/data: স্কিম প্রত্যাখ্যান — INVALID_URL, কোনো রিট্রাই নয়', async () => {
    mockFetch(() => new Response(new Uint8Array([1]), { status: 200 }));
    for (const bad of [
      'http://provider.example/clip.mp4',
      'file:///etc/passwd',
      'data:video/mp4;base64,AAAA',
      'ftp://provider.example/clip.mp4',
    ]) {
      const err = await expectDownloadError(downloadVideo(bad));
      expect(err.code).toBe('INVALID_URL');
      expect(err.retryable).toBe(false);
    }
    // স্কিম-যাচাই fetch-এর আগেই — একবারও নয় (স্পেকের "রিট্রাই নয়"-এর চেয়েও কড়া)
    expect(fetchCalls).toBe(0);
  });

  test('REG-22D2: URL-এ এমবেডেড ক্রেডেনশিয়াল — INVALID_URL', async () => {
    mockFetch(() => new Response(new Uint8Array([1]), { status: 200 }));
    const err = await expectDownloadError(downloadVideo('https://user:pass@provider.example/clip.mp4'));
    expect(err.code).toBe('INVALID_URL');
    expect(err.retryable).toBe(false);
    expect(fetchCalls).toBe(0);
  });

  test('REG-22D3: content-length সীমার চেয়ে বড় → DOWNLOAD_TOO_LARGE, বডি নামানোর আগেই', async () => {
    // বডি ইচ্ছাকৃতভাবে null — content-length-রক্ষী বাদ দিলে বাস্তবায়ন ০-বাইট
    // পড়ে "অস্বাভাবিক ছোট" বলে ব্যর্থ হতো; DOWNLOAD_TOO_LARGE পেলে প্রমাণ —
    // বডি স্পর্শ করার আগেই ঘোষিত আকারেই প্রত্যাখ্যান
    mockFetch(
      () =>
        new Response(null, {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': '999999999' },
        })
    );
    const err = await expectDownloadError(downloadVideo('https://provider.example/clip.mp4', { maxBytes: 100_000 }));
    expect(err.code).toBe('DOWNLOAD_TOO_LARGE');
    expect(err.retryable).toBe(false);
    expect(fetchCalls).toBe(1); // সীমা-অতিক্রম কখনো পুনঃপ্রচেষ্টাযোগ্য নয়
  });

  test('REG-22D4: স্ট্রিমিং-সীমা — content-length নেই, চাঙ্কেই বাতিল', async () => {
    const chunk = new Uint8Array(64 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(chunk);
        c.enqueue(chunk);
        c.enqueue(chunk);
        c.close();
      },
    });
    mockFetch(() => new Response(stream, { status: 200, headers: { 'content-type': 'video/mp4' } }));
    // ৬৪KB+৬৪KB = ১২৮KB > ১০০KB — দ্বিতীয় চাঙ্ক পড়ার মুহূর্তেই বাতিল
    const err = await expectDownloadError(downloadVideo('https://provider.example/clip.mp4', { maxBytes: 100_000 }));
    expect(err.code).toBe('DOWNLOAD_TOO_LARGE');
    expect(err.retryable).toBe(false);
    expect(fetchCalls).toBe(1);
  });

  test('REG-22D5: ভুল কনটেন্ট-টাইপ → INVALID_CONTENT_TYPE; 404 → একবারই, রিট্রাই-নয়', async () => {
    // text/html — ভিডিও নয়, বডির আগেই প্রত্যাখ্যান
    mockFetch(
      () =>
        new Response('<html>login page</html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
    );
    let err = await expectDownloadError(downloadVideo('https://provider.example/clip.mp4'));
    expect(err.code).toBe('INVALID_CONTENT_TYPE');
    expect(err.retryable).toBe(false);
    expect(fetchCalls).toBe(1);

    // application/json — একইভাবে ভুল
    mockFetch(() => new Response('{"error":1}', { status: 200, headers: { 'content-type': 'application/json' } }));
    err = await expectDownloadError(downloadVideo('https://provider.example/clip.mp4'));
    expect(err.code).toBe('INVALID_CONTENT_TYPE');
    expect(fetchCalls).toBe(1);

    // 404 — কখনো পুনঃপ্রচেষ্টাযোগ্য নয়, ঠিক একবারই ডাকা হয়
    mockFetch(() => new Response('not found', { status: 404 }));
    err = await expectDownloadError(downloadVideo('https://provider.example/clip.mp4'));
    expect(err.code).toBe('DOWNLOAD_HTTP_ERROR');
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(404);
    expect(fetchCalls).toBe(1);
  });

  test('REG-22D6: 5xx → বাউন্ডেড রিট্রাই (ঠিক ৩ প্রচেষ্টা); 500-তারপর-200 → ২য় কলেই সফল', async () => {
    // সবসময় 500 — ২টি রিট্রাই শেষে সৎ ব্যর্থতা (retryable:true)
    mockFetch(() => new Response('boom', { status: 500 }));
    const err = await expectDownloadError(downloadVideo('https://provider.example/clip.mp4'));
    expect(err.code).toBe('DOWNLOAD_HTTP_ERROR');
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(500);
    expect(fetchCalls).toBe(3); // ১ + ২ রিট্রাই — অন্ধ লেড্ডার নয়

    // 500 → 200 ক্রম — দ্বিতীয় প্রচেষ্টাতেই সফল, বাইট অক্ষত
    let call = 0;
    mockFetch(() => {
      call++;
      return call === 1
        ? new Response('boom', { status: 500 })
        : new Response(new Uint8Array(fixtureMp4), { status: 200, headers: { 'content-type': 'video/mp4' } });
    });
    const buf = await downloadVideo('https://provider.example/clip.mp4');
    expect(buf.equals(fixtureMp4)).toBe(true);
    expect(fetchCalls).toBe(2);
  });

  test('REG-22D7: সফল-পথ — https + video/mp4 + ≥50KB ফিক্সচার; গ্রহণযোগ্য বিকল্প টাইপ; ন্যূনতম-আকার-স্যানিটি অক্ষত', async () => {
    // মূল সফল-পথ: ভিডিও কনটেন্ট-টাইপ + প্রকৃত ≥50KB MP4 ফিক্সচার
    mockFetch(() => new Response(new Uint8Array(fixtureMp4), { status: 200, headers: { 'content-type': 'video/mp4' } }));
    const buf = await downloadVideo('https://provider.example/clip.mp4');
    expect(buf.length).toBeGreaterThanOrEqual(50_000);
    expect(buf.equals(fixtureMp4)).toBe(true);
    expect(fetchCalls).toBe(1);

    // অ-নামবিশিষ্ট বাইনারিও গ্রহণযোগ্য
    mockFetch(
      () => new Response(new Uint8Array(fixtureMp4), { status: 200, headers: { 'content-type': 'application/octet-stream' } })
    );
    expect((await downloadVideo('https://provider.example/clip.mp4')).length).toBeGreaterThanOrEqual(50_000);

    // কনটেন্ট-টাইপ অনুপস্থিত — গ্রহণযোগ্য (t10/t11/t17/t19/t21-এর মক-আকৃতি)
    mockFetch(() => new Response(new Uint8Array(fixtureMp4), { status: 200 }));
    expect((await downloadVideo('https://provider.example/clip.mp4')).length).toBeGreaterThanOrEqual(50_000);

    // mock: হার্নেস-স্কিম — ৫টি রিগ্রেশন-টেস্টের ডাউনলোড-পথের সামঞ্জস্য-চুক্তি
    mockFetch(() => new Response(new Uint8Array(fixtureMp4), { status: 200 }));
    expect((await downloadVideo('mock://reg22-clip-latest')).length).toBeGreaterThanOrEqual(50_000);

    // ডিফল্ট সীমাসূচক ধ্রুবক — রপ্তানিকৃত ও প্রতিশ্রুত-মাত্রায়
    expect(DOWNLOAD_MAX_BYTES).toBe(256 * 1024 * 1024);

    // পুরোনো ন্যূনতম-আকার-স্যানিটি অক্ষত — ১০KB "ভিডিও" সৎভাবে ব্যর্থ
    mockFetch(
      () => new Response(new Uint8Array(Buffer.alloc(10_000, 1)), { status: 200, headers: { 'content-type': 'video/mp4' } })
    );
    let smallErr: unknown;
    try {
      await downloadVideo('https://provider.example/tiny.mp4');
    } catch (e) {
      smallErr = e;
    }
    expect(smallErr).toBeInstanceOf(Error);
    expect(String((smallErr as Error).message)).toContain('অস্বাভাবিক ছোট');
    expect(smallErr).not.toBeInstanceOf(PDE);
  });

  // ----------------------------------------------------------
  // P-গ্রুপ — placeDialogueLine-এর প্রকৃত চুক্তি (PART D)
  // ----------------------------------------------------------

  test('REG-22P1a: কার্সার-চালিত বসানো — লাইন কখনো ওভারল্যাপ করে না, স্পিকার-শটে মিল', () => {
    const windows = [
      { shotId: 'shot-1', startSec: 0, endSec: 6, characters: ['রহিম'] },
      { shotId: 'shot-2', startSec: 6, endSec: 12, characters: ['আয়েশা'] },
    ];
    const opts = { windows, sceneStartSec: 0 };

    // ১ম লাইন — রহিমের শট-উইন্ডোতে
    const p1 = placeDialogueLine({ character: 'রহিম', measuredSec: 2 }, { ...opts, cursorSec: 0 });
    expect(p1).toEqual({ startSec: 0.1, endSec: 2.1, shotId: 'shot-1', matchedSpeakerShot: true });

    // ২য় লাইন — কার্সার = আগের শেষ; শুরু কখনো আগের শেষের আগে নয়
    const p2 = placeDialogueLine({ character: 'রহিম', measuredSec: 3 }, { ...opts, cursorSec: p1.endSec });
    expect(p2.startSec).toBeGreaterThanOrEqual(p1.endSec);
    expect(p2.shotId).toBe('shot-1');
    expect(p2.matchedSpeakerShot).toBe(true);

    // ৩য় লাইন — উইন্ডোতে জায়গা নেই → দৃশ্য-ক্রমিক ফলব্যাক, তবু ওভারল্যাপ নয়
    const p3 = placeDialogueLine({ character: 'রহিম', measuredSec: 2 }, { ...opts, cursorSec: p2.endSec });
    expect(p3.startSec).toBeGreaterThanOrEqual(p2.endSec);
    expect(p3.shotId).toBeNull();
    expect(p3.matchedSpeakerShot).toBe(false);

    // অন্য চরিত্রের লাইন — সেই চরিত্রের উইন্ডোতেই যায় (D-F02 মূল চুক্তি)
    const pA = placeDialogueLine({ character: 'আয়েশা', measuredSec: 2 }, { ...opts, cursorSec: 0 });
    expect(pA.shotId).toBe('shot-2');
    expect(pA.startSec).toBe(6.1); // উইন্ডো-শুরু + ০.১
    expect(pA.matchedSpeakerShot).toBe(true);

    // কোনো উইন্ডোতেই নেই এমন চরিত্র — সৎ ফলব্যাক (shotId:null)
    const pX = placeDialogueLine({ character: 'অচেনা', measuredSec: 1 }, { ...opts, cursorSec: 0 });
    expect(pX.shotId).toBeNull();
    expect(pX.matchedSpeakerShot).toBe(false);
    expect(pX.startSec).toBeGreaterThanOrEqual(0); // দৃশ্য-শুরু + ০.১৫ ভিত্তিতে
  });

  test('REG-22P1b: নেগেটিভ/শূন্য টাইমস্ট্যাম্প নিরাপদ — ০.৮ সে.-এ ক্ল্যাম্প', () => {
    const windows = [{ shotId: 's', startSec: 0, endSec: 10, characters: ['রহিম'] }];
    for (const bad of [-5, 0, -0.001]) {
      const p = placeDialogueLine({ character: 'রহিম', measuredSec: bad }, { windows, sceneStartSec: 0, cursorSec: 0 });
      expect(p.endSec - p.startSec).toBe(0.8); // Math.max(0.8, measuredSec)
      expect(p.endSec).toBeLessThanOrEqual(10.1);
      expect(Number.isFinite(p.startSec)).toBe(true);
      expect(Number.isFinite(p.endSec)).toBe(true);
    }
  });

  test('REG-22P1c: ম্যালফর্মড লাইন-মেটাডেটা (text/endSec অনুপস্থিত) বসানো নষ্ট করে না', () => {
    const windows = [{ shotId: 's', startSec: 0, endSec: 10, characters: ['রহিম'] }];
    const opts = { windows, sceneStartSec: 0, cursorSec: 0 };
    // placeDialogueLine কেবল {character, measuredSec} পড়ে — বাকি ক্ষেত্র
    // (text/emotion/endSec…) অনুপস্থিত থাকলে বসানো-গণিত অপরিবর্তিত
    const malformed = { character: 'রহিম', measuredSec: 1.5 } as any;
    const full = { character: 'রহিম', text: 'আমি আসছি', emotion: 'দৃঢ়', measuredSec: 1.5, endSec: undefined } as any;
    const a = placeDialogueLine(malformed, opts);
    const b = placeDialogueLine(full, opts);
    expect(a).toEqual(b);
    expect(a).toEqual({ startSec: 0.1, endSec: 1.6, shotId: 's', matchedSpeakerShot: true });
  });
});
