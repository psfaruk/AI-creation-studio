// ============================================================
// REGRESSION TEST 24 — MP4-G cluster (security/review):
//  (A) D-9/B7 — durable human media-review workflow
//      (src/lib/agent/review/human-media-review.ts)
//  (B) H-3 — entry-time magic-byte sniffing of chat attachments
//      (src/lib/agent/media-sniff.ts + REAL POST /api/chat handler)
//  (C) H-8 — artifact-path containment in readArtifactFile
//      (src/lib/agent/storage.ts)
//
// Boundaries:
//  - Section A/C: REAL modules, pure unit — no DB, no network, no
//    real storage/ writes (containment proof uses a tmp-dir override
//    of readArtifactFile's `dir` param; nothing is written to the
//    project's storage/artifacts).
//  - Section B route tests: the REAL chat route handler with
//    '@/lib/db' (in-memory fake), '@/lib/security' (owner ok),
//    '@/lib/agent/orchestrator' (startAgentRun recorded noop) and
//    '@/lib/agent/storage' (saveArtifactFile recorded fake — the
//    real artifacts dir is NEVER touched) mocked.
//    '@/lib/agent/media-sniff' is deliberately NOT mocked — the
//    sniff is the code under test.
//  - Hermetic: no provider calls, no dev-DB, no real-disk writes
//    outside os.tmpdir().
// ============================================================

import { describe, expect, test, mock, beforeEach, afterAll } from 'bun:test';
import { fakeDb, resetFakeDb, state } from '../helpers/fake-db';
import type {
  HumanReviewStatus,
  HumanMediaReviewRecord,
  DimensionKey,
} from '@/lib/agent/review/human-media-review';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

// --- প্রকৃত storage মডিউল আগে ধরে নিতে হয় (মক-নিবন্ধনের আগে) —
// সেকশন C-তে প্রকৃত readArtifactFile (tmp-dir ওভাররাইডসহ) লাগবে।
const realStorage = await import('@/lib/agent/storage');

const startAgentRunCalls: string[] = [];
/** saveArtifactFile-মকের রেকর্ড — কী বাইট কোন ext-এ জমা হতে যাচ্ছিল */
const savedArtifacts: Array<{ ext: string; bytes: Buffer }> = [];

mock.module('@/lib/security', () => ({
  requireOwner: async () => ({ ok: true as const }),
}));
mock.module('@/lib/db', () => ({ db: fakeDb }));
mock.module('@/lib/agent/orchestrator', () => ({
  startAgentRun: (id: string) => {
    startAgentRunCalls.push(id);
  },
  STALE_RUN_MS: 10 * 60 * 1000,
}));
// storage-মক: প্রকৃত ডিস্ক-লেখা নয় — রেকর্ড + নকল পথ। readArtifactFile
// প্রকৃতই থাকে (রাউট এটি ডাকে না; সেকশন C সরাসরি প্রকৃত সংস্করণ ধরে)।
mock.module('@/lib/agent/storage', () => ({
  saveArtifactFile: async (buffer: Buffer, ext: string) => {
    savedArtifacts.push({ ext, bytes: buffer });
    const n = savedArtifacts.length;
    return { storagePath: `/tmp/t24-mock/t24-${n}.${ext}`, relName: `t24-${n}.${ext}` };
  },
  readArtifactFile: realStorage.readArtifactFile,
  artifactsDir: realStorage.artifactsDir,
}));

// রুট + টেস্ট-অধীন মডিউলগুলো — মকের পরে
const { POST } = await import('@/app/api/chat/route');
const {
  HUMAN_REVIEW_DIMENSIONS,
  createEmptyReview,
  summarizeReview,
  hasUnreviewedDimensions,
  validateReviewRecord,
  reviewStatusLabel,
} = await import('@/lib/agent/review/human-media-review');
const {
  sniffMediaKind,
  attachmentMismatchError,
  SNIFFED_KIND_FAMILY,
  ATTACHMENT_MISMATCH_ERROR,
  ATTACHMENT_ZIP_ERROR,
  ATTACHMENT_UNKNOWN_ERROR,
} = await import('@/lib/agent/media-sniff');

// ------------------------------------------------------------
// ফিক্সচার-নির্মাতা — প্রতিটি ম্যাজিক-পরিবারের ছোট সৎ নমুনা
// ------------------------------------------------------------
const FIXTURES: Record<string, Buffer> = {
  wav: Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4, 0x10), Buffer.from('WAVEfmt ', 'ascii')]),
  mp3_id3: Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1'),
  mp3_sync: Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00]),
  mp3_sync_f3: Buffer.from([0xff, 0xf3, 0x00, 0x00]),
  mp3_sync_f2: Buffer.from([0xff, 0xf2, 0x00, 0x00]),
  ogg: Buffer.from('OggS\x00\x02\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'latin1'),
  mp4: Buffer.concat([Buffer.alloc(4, 0x00), Buffer.from('ftypisom\x00\x00\x02\x00isom', 'ascii')]),
  png: Buffer.concat([Buffer.from([0x89]), Buffer.from('PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(16, 0x41)]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  gif: Buffer.from('GIF89a\u0200\u0200', 'latin1'),
  webp: Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4, 0x20), Buffer.from('WEBPVP8 ', 'ascii')]),
  zip: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
  text: Buffer.from('এই ফাইলটি কোনো মিডিয়া নয় — নিছক টেক্সট।', 'utf8'),
  riff_avi: Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4, 0x20), Buffer.from('AVI LIST', 'ascii')]),
};

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

let ipSeq = 0;
function chatPost(body: Record<string, unknown>): Promise<Response> {
  ipSeq += 1;
  return POST(
    new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `198.51.100.${ipSeq}` },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof POST>[0],
  );
}

/** সব ১৩ মাত্রিক দেওয়া অবস্থায় রেকর্ড-বিল্ডার (টেস্ট-সাহায্যকারী) */
function fullDimensions(
  status: HumanReviewStatus,
  overrides: Partial<Record<DimensionKey, { status: HumanReviewStatus; note?: string }>> = {}
): Record<DimensionKey, { status: HumanReviewStatus; note?: string }> {
  const dims = {} as Record<DimensionKey, { status: HumanReviewStatus; note?: string }>;
  for (const key of HUMAN_REVIEW_DIMENSIONS) {
    dims[key] = overrides[key] ?? { status };
  }
  return dims;
}

const tmpRoots: string[] = [];
afterAll(() => {
  for (const t of tmpRoots) {
    try {
      rmSync(t, { recursive: true, force: true });
    } catch {
      /* সর্বোত্তম-প্রচেষ্টা পরিস্কারকরণ */
    }
  }
});

beforeEach(() => {
  resetFakeDb();
  startAgentRunCalls.length = 0;
  savedArtifacts.length = 0;
});

// ============================================================
// (A) D-9/B7 — মানব-মিডিয়া-পর্যালোচনা মডিউল
// ============================================================
describe('REG-24 [D-9/B7]: human media-review workflow — never invent outcomes', () => {
  test('REG-24a: createEmptyReview — ১৩টি মাত্রিকই NOT_REVIEWED, রায় NOT_REVIEWED, reviewer/তারিখ কখনো বানানো হয় না', () => {
    const empty = createEmptyReview('art-empty-1', 'prod-42');

    expect(HUMAN_REVIEW_DIMENSIONS.length).toBe(13);
    expect(Object.keys(empty.dimensions).length).toBe(13);
    for (const key of HUMAN_REVIEW_DIMENSIONS) {
      expect(empty.dimensions[key]).toEqual({ status: 'NOT_REVIEWED' });
    }
    expect(empty.overallStatus).toBe('NOT_REVIEWED');
    // reviewer-নাম/তারিখ কখনো আবিষ্কার করা হয় না — null-ই থাকে
    expect(empty.reviewer).toBe(null);
    expect(empty.reviewedAt).toBe(null);
    expect(empty.artifactId).toBe('art-empty-1');
    expect(empty.productionId).toBe('prod-42');
    // productionId না দিলে কী-টিই আসে না
    const noProd = createEmptyReview('art-empty-2');
    expect('productionId' in noProd).toBe(false);
  });

  test('REG-24a2: মাত্রিক-তালিকা master-prompt B7-এর হুবহু ১৩টি কী (ক্রমসহ) — ড্রিফট-লক', () => {
    expect([...HUMAN_REVIEW_DIMENSIONS]).toEqual([
      'character_identity',
      'face_stability',
      'facial_expressions',
      'body_hand_movement',
      'camera_composition',
      'temporal_consistency_flicker',
      'scene_continuity',
      'lipsync_alignment',
      'pronunciation_intelligibility',
      'music_speech_balance',
      'subtitle_correctness',
      'av_synchronization',
      'overall_realism',
    ]);
  });

  test('REG-24b: summarizeReview — সৎ সারাংশ-চুক্তি (FAIL > PWL > PASS > সব-NOT_REVIEWED)', () => {
    const withDims = (dims: Record<DimensionKey, { status: HumanReviewStatus }>) =>
      ({ dimensions: dims }) as Parameters<typeof summarizeReview>[0];

    // সব NOT_REVIEWED → NOT_REVIEWED
    expect(summarizeReview(withDims(fullDimensions('NOT_REVIEWED')))).toBe('NOT_REVIEWED');
    // একটি FAIL → FAIL (বাকি যা-ই হোক)
    expect(
      summarizeReview(withDims(fullDimensions('PASS', { face_stability: { status: 'FAIL' } })))
    ).toBe('FAIL');
    // FAIL নেই, কিন্তু PWL আছে → PASS_WITH_LIMITATIONS
    expect(
      summarizeReview(
        withDims(fullDimensions('PASS', { lipsync_alignment: { status: 'PASS_WITH_LIMITATIONS' } }))
      )
    ).toBe('PASS_WITH_LIMITATIONS');
    // সব PASS → PASS
    expect(summarizeReview(withDims(fullDimensions('PASS')))).toBe('PASS');
  });

  test('REG-24b2: আংশিক-পর্যালোচিত রেকর্ড — সারাংশ দেখা-হয়েছে মাত্রিকগুলোর, আর ফাঁকটি hasUnreviewedDimensions সৎভাবে প্রকাশ করে', () => {
    const mixed = fullDimensions('NOT_REVIEWED', { character_identity: { status: 'PASS' } });
    const record = { dimensions: mixed } as Parameters<typeof summarizeReview>[0];

    // কেবল ১টি মাত্রিক দেখা হয়েছে (PASS) → সারাংশ PASS, কিন্তু…
    expect(summarizeReview(record)).toBe('PASS');
    // …১২টি অ-পর্যালোচিত মাত্রিকের ফাঁক লুকানো হয় না
    expect(hasUnreviewedDimensions(record)).toBe(true);

    // পূর্ণ-পর্যালোচিত রেকর্ডে ফাঁক নেই
    expect(hasUnreviewedDimensions({ dimensions: fullDimensions('PASS') } as never)).toBe(false);
    expect(hasUnreviewedDimensions({ dimensions: fullDimensions('NOT_REVIEWED') } as never)).toBe(true);
  });

  test('REG-24c: validateReviewRecord — বানানো ফলাফল/অজানা কী/অবৈধ অবস্থা/artifactId-অনুপস্থিতি প্রত্যাখ্যাত', () => {
    // (১) রায়-দাবি কিন্তু reviewer খালি → উদ্ভাবিত ফলাফল
    const passNoReviewer = {
      artifactId: 'art-x',
      reviewedAt: '2026-10-18T10:00:00+06:00',
      dimensions: fullDimensions('PASS'),
      overallStatus: 'PASS',
    };
    const r1 = validateReviewRecord(passNoReviewer);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join('\n')).toContain('reviewer');

    // (১-খ) রায়-দাবি কিন্তু reviewedAt অনুপস্থিত → উদ্ভাবিত
    const passNoDate = {
      artifactId: 'art-x',
      reviewer: 'নবানীতা',
      dimensions: fullDimensions('PASS'),
      overallStatus: 'PASS',
    };
    const r1b = validateReviewRecord(passNoDate);
    expect(r1b.ok).toBe(false);
    if (!r1b.ok) expect(r1b.errors.join('\n')).toContain('reviewedAt');

    // (২) অজানা মাত্রিক-কী
    const r2 = validateReviewRecord({
      artifactId: 'art-x',
      reviewer: 'রা',
      reviewedAt: '2026-10-18T10:00:00Z',
      dimensions: { ...fullDimensions('PASS'), villain_charisma: { status: 'PASS' } },
      overallStatus: 'PASS',
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.join('\n')).toContain('villain_charisma');

    // (২-খ) বাধ্যতামূলক ১৩ কীয়ের একটি বাদ গেলে আংশিক রেকর্ড — প্রত্যাখ্যাত
    const partialDims = fullDimensions('NOT_REVIEWED');
    delete (partialDims as Record<string, unknown>).av_synchronization;
    const r2b = validateReviewRecord({
      artifactId: 'art-x',
      reviewer: 'রা',
      reviewedAt: '2026-10-18T10:00:00Z',
      dimensions: partialDims,
      overallStatus: 'NOT_REVIEWED',
    });
    expect(r2b.ok).toBe(false);
    if (!r2b.ok) expect(r2b.errors.join('\n')).toContain('av_synchronization');

    // (৩) অবৈধ অবস্থা-মান
    const r3 = validateReviewRecord({
      artifactId: 'art-x',
      reviewer: 'রা',
      reviewedAt: '2026-10-18T10:00:00Z',
      dimensions: fullDimensions('PASS', { face_stability: { status: 'PROBABLY_FINE' as never } }),
      overallStatus: 'PASS',
    });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.errors.join('\n')).toContain('face_stability');

    // (৩-খ) overallStatus-এ অবৈধ মান
    const r3b = validateReviewRecord({
      artifactId: 'art-x',
      reviewer: 'রা',
      reviewedAt: '2026-10-18T10:00:00Z',
      dimensions: fullDimensions('PASS'),
      overallStatus: 'EXCELLENT' as never,
    });
    expect(r3b.ok).toBe(false);
    if (!r3b.ok) expect(r3b.errors.join('\n')).toContain('overallStatus');

    // (৪) artifactId অনুপস্থিত
    const r4 = validateReviewRecord({
      reviewer: 'রা',
      reviewedAt: '2026-10-18T10:00:00Z',
      dimensions: fullDimensions('PASS'),
      overallStatus: 'PASS',
    });
    expect(r4.ok).toBe(false);
    if (!r4.ok) expect(r4.errors.join('\n')).toContain('artifactId');

    // (৫) অসঙ্গতি: সব মাত্রিক NOT_REVIEWED অথচ overallStatus PASS দাবি — উদ্ভাবিত
    const r5 = validateReviewRecord({
      artifactId: 'art-x',
      reviewer: 'রা',
      reviewedAt: '2026-10-18T10:00:00Z',
      dimensions: fullDimensions('NOT_REVIEWED'),
      overallStatus: 'PASS',
    });
    expect(r5.ok).toBe(false);
    if (!r5.ok) expect(r5.errors.join('\n')).toContain('invented');

    // (৫-খ) উল্টো অসঙ্গতি: মাত্রিক-রায় আছে অথচ overallStatus NOT_REVIEWED
    const r5b = validateReviewRecord({
      artifactId: 'art-x',
      reviewer: 'রা',
      reviewedAt: '2026-10-18T10:00:00Z',
      dimensions: fullDimensions('PASS', { character_identity: { status: 'NOT_REVIEWED' } }),
      overallStatus: 'NOT_REVIEWED',
    });
    expect(r5b.ok).toBe(false);
    if (!r5b.ok) expect(r5b.errors.join('\n')).toContain('inconsistent');
  });

  test('REG-24c2: validateReviewRecord — প্রকৃত-ভরা সৎ রেকর্ড গৃহীত; আংশিক-সৎ রেকর্ডও (প্রমাণসহ) গৃহীত', () => {
    // পূর্ণ-সৎ: প্রকৃত reviewer + তারিখ + ১৩ মাত্রিক রায় + নোট + ব্লকার
    const honestFull = {
      artifactId: 'art-real-7',
      productionId: 'prod-mv-3',
      reviewer: 'নবানীতা রায়',
      reviewedAt: '2026-10-18T14:30:00+06:00',
      dimensions: fullDimensions('PASS', {
        lipsync_alignment: { status: 'FAIL', note: 'শট ২-এ ঠোঁট ৩০০ms আগে চলছে' },
        music_speech_balance: { status: 'PASS_WITH_LIMITATIONS', note: 'শেষ ৫ সে.-এ সংগীত একটু উঁচু' },
      }),
      overallStatus: 'FAIL',
      blockerNote: 'ঠোঁট-সমলয় ব্লকিং — পুনঃজেনারেশন দরকার',
    };
    const ok = validateReviewRecord(honestFull);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const rec: HumanMediaReviewRecord = ok.record;
      expect(rec.artifactId).toBe('art-real-7');
      expect(rec.productionId).toBe('prod-mv-3');
      expect(rec.reviewer).toBe('নবানীতা রায়');
      expect(rec.dimensions.lipsync_alignment.status).toBe('FAIL');
      expect(rec.dimensions.lipsync_alignment.note).toContain('ঠোঁট');
      expect(rec.overallStatus).toBe('FAIL');
      expect(rec.blockerNote).toBeDefined();
      // সারাংশ-সাহায্যকারী একই রেকর্ডে চলে
      expect(summarizeReview(rec)).toBe('FAIL');
      expect(hasUnreviewedDimensions(rec)).toBe(false);
    }

    // আংশিক-সৎ: reviewer শুরু করেছেন, ১টি মাত্রিক দেখেছেন, বাকি NOT_REVIEWED
    const honestPartial = {
      artifactId: 'art-real-8',
      reviewer: 'রা',
      reviewedAt: '2026-10-18T15:00:00Z',
      dimensions: fullDimensions('NOT_REVIEWED', { subtitle_correctness: { status: 'PASS_WITH_LIMITATIONS', note: '২টি বানান-ভুল' } }),
      overallStatus: 'PASS_WITH_LIMITATIONS',
    };
    const okP = validateReviewRecord(honestPartial);
    expect(okP.ok).toBe(true);
    if (okP.ok) {
      expect(summarizeReview(okP.record)).toBe('PASS_WITH_LIMITATIONS');
      expect(hasUnreviewedDimensions(okP.record)).toBe(true);
    }
  });

  test('REG-24d: reviewStatusLabel — ঠিক ৪টি অবস্থা, প্রতিটির স্বতন্ত্র বাংলা লেবেল; ৪-এর বাইরে কিছু নয়', () => {
    const statuses: HumanReviewStatus[] = ['NOT_REVIEWED', 'PASS', 'PASS_WITH_LIMITATIONS', 'FAIL'];
    const labels = statuses.map(reviewStatusLabel);
    expect(labels).toEqual(['পর্যালোচিত হয়নি', 'উত্তীর্ণ', 'সীমাবদ্ধতাসহ উত্তীর্ণ', 'অনুত্তীর্ণ']);
    expect(new Set(labels).size).toBe(4);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    // "৪-এর বাইরে কিছু নয়" — যাচাইকারীই অবৈধ অবস্থা প্রত্যাখ্যান করে
    // (REG-24c-এর ৩ নং শর্ত) — কেবল ৪টি মান বৈধ পথে ঢোকে।
    for (const bogus of ['pass', 'Approved', 'PENDING', '', 'fail '] as never[]) {
      const res = validateReviewRecord({
        artifactId: 'art-bogus',
        reviewer: 'রা',
        reviewedAt: '2026-10-18T10:00:00Z',
        dimensions: fullDimensions('PASS'),
        overallStatus: bogus,
      });
      expect(res.ok).toBe(false);
    }
  });
});

// ============================================================
// (B) H-3 — এন্ট্রি-টাইম ম্যাজিক-বাইট শনিফ + রাউট-স্তরের প্রত্যাখ্যান
// ============================================================
describe('REG-24 [H-3]: magic-byte sniffing of chat attachments', () => {
  test('REG-24e: sniffMediaKind — প্রতিটি ম্যাজিক-পরিবার সঠিকভাবে চেনা হয়', () => {
    expect(sniffMediaKind(new Uint8Array(FIXTURES.wav))).toBe('wav');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.mp3_id3))).toBe('mp3');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.mp3_sync))).toBe('mp3');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.mp3_sync_f3))).toBe('mp3');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.mp3_sync_f2))).toBe('mp3');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.ogg))).toBe('ogg');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.mp4))).toBe('mp4');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.png))).toBe('png');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.jpeg))).toBe('jpeg');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.gif))).toBe('gif');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.webp))).toBe('webp');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.zip))).toBe('zip');
    // অচেনা বাইট-স্বভাব → সৎ 'unknown' (অনুমান নয়)
    expect(sniffMediaKind(new Uint8Array(FIXTURES.text))).toBe('unknown');
    expect(sniffMediaKind(new Uint8Array(FIXTURES.riff_avi))).toBe('unknown');
    expect(sniffMediaKind(new Uint8Array(0))).toBe('unknown');
    // পরিবার-ম্যাপ: audio ← wav/mp3/ogg, video ← mp4, image ← png/jpeg/gif/webp,
    // zip/unknown → কোনো মিডিয়া পরিবার নয়
    expect(SNIFFED_KIND_FAMILY).toEqual({
      wav: 'audio',
      mp3: 'audio',
      ogg: 'audio',
      mp4: 'video',
      png: 'image',
      jpeg: 'image',
      gif: 'image',
      webp: 'image',
      zip: null,
      unknown: null,
    });
  });

  test('REG-24f: attachmentMismatchError — সঙ্গত ঘোষণা null, অমিল/zip/অচেনা হলে বাংলা ত্রুটি', () => {
    // সঙ্গত: ঘোষিত kind + ঘোষিত MIME-পরিবার + বাইট — সব একমত
    expect(attachmentMismatchError('image', 'image/png', new Uint8Array(FIXTURES.png))).toBe(null);
    expect(attachmentMismatchError('audio', 'audio/mpeg', new Uint8Array(FIXTURES.mp3_id3))).toBe(null);
    expect(attachmentMismatchError('audio', 'audio/wav', new Uint8Array(FIXTURES.wav))).toBe(null);
    expect(attachmentMismatchError('video', 'video/mp4', new Uint8Array(FIXTURES.mp4))).toBe(null);
    // অ-মিডিয়া MIME-ঘোষণা কিন্তু kind সঠিক + বাইট সমর্থিত → kind-ই কর্তৃত্ব
    expect(attachmentMismatchError('audio', 'application/octet-stream', new Uint8Array(FIXTURES.wav))).toBe(null);

    // অমিল: ঘোষিত audio কিন্তু বাইট PNG
    expect(attachmentMismatchError('audio', 'audio/mpeg', new Uint8Array(FIXTURES.png))).toBe(
      ATTACHMENT_MISMATCH_ERROR
    );
    // অমিল: ঘোষিত image কিন্তু বাইট MP4
    expect(attachmentMismatchError('image', 'image/png', new Uint8Array(FIXTURES.mp4))).toBe(
      ATTACHMENT_MISMATCH_ERROR
    );
    // অমিল: kind ঠিক, কিন্তু dataUrl-এর MIME-পরিবার বাইটের সাথে মেলে না
    expect(attachmentMismatchError('audio', 'video/mp4', new Uint8Array(FIXTURES.wav))).toBe(
      ATTACHMENT_MISMATCH_ERROR
    );

    // zip: যে-ধরনেই ঘোষণা হোক — মিডিয়া নয়
    expect(attachmentMismatchError('image', 'image/png', new Uint8Array(FIXTURES.zip))).toBe(ATTACHMENT_ZIP_ERROR);
    // অচেনা বাইট-স্বভাব → kind-safety প্রত্যাখ্যান
    expect(attachmentMismatchError('video', 'video/mp4', new Uint8Array(FIXTURES.text))).toBe(
      ATTACHMENT_UNKNOWN_ERROR
    );
    expect(attachmentMismatchError('audio', 'audio/wav', new Uint8Array(FIXTURES.riff_avi))).toBe(
      ATTACHMENT_UNKNOWN_ERROR
    );
  });

  test('REG-24g [রাউট-স্তর]: ভুল-লেবেল করা অ্যাটাচমেন্ট ৪০০-এ প্রত্যাখ্যাত — কোনো কথোপকথন/রান/আর্টিফ্যাক্ট দূষিত হয় না', async () => {
    // audio ঘোষণা করা হয়েছে, বাইট আসলে PNG
    const res = await chatPost({
      content: 'এই গানটা শুনে দেখো',
      attachments: [{ kind: 'audio', name: 'gan.png', dataUrl: dataUrl('audio/mpeg', FIXTURES.png) }],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('ফাইলের ঘোষিত ধরন ও প্রকৃত বাইট-স্বভাব মেলেনি');

    // গার্ড যেকোনো db-লেখার আগেই — কিছুই দূষিত হয়নি
    expect(state().conversations.size).toBe(0);
    expect(state().messages.size).toBe(0);
    expect(fakeDb.__agentRunCreateCalls().length).toBe(0);
    expect(savedArtifacts.length).toBe(0);
    expect(startAgentRunCalls.length).toBe(0);
  });

  test('REG-24g2 [রাউট-স্তর]: ZIP-বাইট বা অচেনা বাইট মিডিয়া ঘোষণা করে পাঠালে সৎ ৪০০', async () => {
    // PNG ঘোষণা করা ZIP
    const zipRes = await chatPost({
      content: 'ছবি',
      attachments: [{ kind: 'image', name: 'pic.png', dataUrl: dataUrl('image/png', FIXTURES.zip) }],
    });
    expect(zipRes.status).toBe(400);
    expect(((await zipRes.json()) as { error?: string }).error).toBe(ATTACHMENT_ZIP_ERROR);

    // MP4 ঘোষণা করা নিছক-টেক্সট
    const unknownRes = await chatPost({
      content: 'ভিডিও',
      attachments: [{ kind: 'video', name: 'clip.mp4', dataUrl: dataUrl('video/mp4', FIXTURES.text) }],
    });
    expect(unknownRes.status).toBe(400);
    expect(((await unknownRes.json()) as { error?: string }).error).toBe(ATTACHMENT_UNKNOWN_ERROR);
    expect(savedArtifacts.length).toBe(0);
  });

  test('REG-24h [রাউট-স্তর]: সৎ অ্যাটাচমেন্ট গৃহীত — স্নিফ-করা বাইটই আর্টিফ্যাক্ট হিসেবে জমা হয়', async () => {
    const res = await chatPost({
      content: 'এই ছবিটা এডিট করো',
      attachments: [{ kind: 'image', name: 'photo.png', dataUrl: dataUrl('image/png', FIXTURES.png) }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runId: string; conversationId: string };
    expect(typeof body.runId).toBe('string');

    // যাচাই-সময়ে ডিকোড করা একই বাইটই saveArtifactFile-এ গেছে
    expect(savedArtifacts.length).toBe(1);
    expect(savedArtifacts[0].ext).toBe('png');
    expect(Buffer.compare(savedArtifacts[0].bytes, FIXTURES.png)).toBe(0);

    // আর্টিফ্যাক্ট-রো সৎ মেটাডেটাসহ
    const artifacts = [...state().artifacts.values()];
    expect(artifacts.length).toBe(1);
    expect(artifacts[0].origin).toBe('user_upload');
    expect(artifacts[0].kind).toBe('image');
    expect(artifacts[0].mimeType).toBe('image/png');
    expect(artifacts[0].storagePath).toContain('t24-mock');
    expect(artifacts[0].size).toBe(FIXTURES.png.length);

    // রান শুরু হয়েছে (মক-রেকর্ডেড)
    expect(startAgentRunCalls).toEqual([body.runId]);
  });

  test('REG-24h2 [রাউট-স্তর]: একাধিক সৎ অ্যাটাচমেন্ট (image+audio) একসাথে গৃহীত', async () => {
    const res = await chatPost({
      content: 'ছবি আর গান — দুটোই দিলাম',
      attachments: [
        { kind: 'image', name: 'a.png', dataUrl: dataUrl('image/png', FIXTURES.png) },
        { kind: 'audio', name: 'b.mp3', dataUrl: dataUrl('audio/mpeg', FIXTURES.mp3_id3) },
      ],
    });
    expect(res.status).toBe(200);
    expect(savedArtifacts.map((s) => s.ext).sort()).toEqual(['mp3', 'png']);
    expect(state().artifacts.size).toBe(2);
  });
});

// ============================================================
// (C) H-8 — readArtifactFile পাথ-কন্টেইনমেন্ট
// ============================================================
describe('REG-24 [H-8]: artifact-path containment in storage.readArtifactFile', () => {
  test('REG-24i: ভেতরের পথ পড়া যায়; ../-পালায়ন, বাইরের absolute পথ ও ভাইবোন-প্রিফিক্স প্রত্যাখ্যাত; ভেতরের অনুপস্থিত ফাইল ENOENT (ভিন্ন ত্রুটি)', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 't24-artifacts-'));
    tmpRoots.push(dir);
    const inside = path.join(dir, 'legit-artifact.bin');
    writeFileSync(inside, Buffer.from('t24-inside'));

    // (১) স্বাভাবিক আর্টিফ্যাক্ট-পথ — পড়া যায়
    const buf = await realStorage.readArtifactFile(inside, dir);
    expect(buf.toString()).toBe('t24-inside');

    // (২) ../-পালায়ন → সৎ বাংলা কন্টেইনমেন্ট-ত্রুটি
    const escape = path.join(dir, '..', 'outside-secret.txt');
    await expect(realStorage.readArtifactFile(escape, dir)).rejects.toThrow(
      'আর্টিফ্যাক্ট-পথ সংরক্ষণ-ডিরেক্টরির বাইরে — প্রত্যাখ্যাত'
    );

    // (২-খ) একদমই বাইরের absolute পথ
    await expect(realStorage.readArtifactFile('/etc/passwd', dir)).rejects.toThrow('বাইরে');

    // (২-গ) প্রিফিক্স-আক্রমণ: ভাইবোন ডিরেক্টরি (dir + '-evil') dir-এর
    // ভেতরে নয় — base + path.sep ছাড়া startsWith ফাঁদ হতো
    const sibling = `${dir}-evil/steal.bin`;
    await expect(realStorage.readArtifactFile(sibling, dir)).rejects.toThrow('বাইরে');

    // (২-ঘ) গভীর ../-শৃঙ্খলও ধরা পড়ে
    await expect(realStorage.readArtifactFile(path.join(dir, 'a', '..', '..', 'x.bin'), dir)).rejects.toThrow(
      'বাইরে'
    );

    // (৩) ভেতরের কিন্তু অনুপস্থিত ফাইল → ENOENT-জাতীয় ফাইল-ত্রুটি
    // (কন্টেইনমেন্ট-ত্রুটি নয়) — দুই ধরনের ব্যর্থতা আলাদা ও সৎ
    let missingErr: Error | null = null;
    try {
      await realStorage.readArtifactFile(path.join(dir, 'missing.bin'), dir);
    } catch (e) {
      missingErr = e as Error;
    }
    expect(missingErr).not.toBeNull();
    expect(missingErr!.message).not.toContain('বাইরে');
    expect(/ENOENT|no such file/i.test(missingErr!.message)).toBe(true);
  });

  test('REG-24i2: ডিফল্ট dir (প্রকৃত ARTIFACTS_DIR)-ও সুরক্ষিত — বাইরের পথ কখনো পড়ার আগেই প্রত্যাখ্যাত (ডিস্ক-লেখা ছাড়াই)', async () => {
    // প্রকৃত storage/artifacts-এ কিছু লেখা হয় না; কেবল যাচাই করা হয় যে
    // নিশ্চিত-অস্তিত্বহীন বাইরের পথ কন্টেইনমেন্ট-ত্রুটিতেই ব্যর্থ হয়
    await expect(
      realStorage.readArtifactFile('/nonexistent-t24-probe/secret.txt')
    ).rejects.toThrow('আর্টিফ্যাক্ট-পথ সংরক্ষণ-ডিরেক্টরির বাইরে — প্রত্যাখ্যাত');
  });
});
