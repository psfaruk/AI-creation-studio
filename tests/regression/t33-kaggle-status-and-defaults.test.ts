// ============================================================
// t33 — Kaggle GPU: স্ট্যাটাস-derivation + ডিফল্ট-আচরণ-অপরিবর্তিত-রায়
//
// মক-মুক্ত টেস্ট:
//  - status.ts: deriveJobView-এর সব কেস (pending/running/done/failed/
//    stale/offline-hint), shouldContinuePolling (terminal-এ পোলিং থামে),
//    UUID-যাচাই, ধ্রুবক-সুস্থতা।
//  - availability-matrix: ২৩টি মূল সারি অক্ষত + নতুন cap-kaggle-music
//    (env-সচেতন; configured ≠ কর্মী-অনলাইন), cap-instrumental অপরিবর্তিত।
//  - providers/registry: কোনো ক্যাগল-কী নেই — ডিফল্ট ইনস্ট্রুমেন্টাল
//    প্রদানকারী (প্রসিডিউরাল) আগের মতোই available/portable।
// ============================================================

import { describe, expect, test } from 'bun:test';

import {
  KAGGLE_JOB_POLL_INTERVAL_MS,
  KAGGLE_LIST_DEFAULT_LIMIT,
  KAGGLE_LIST_MAX_LIMIT,
  KAGGLE_PENDING_OFFLINE_HINT_MS,
  KAGGLE_PROMPT_MAX_CHARS,
  KAGGLE_RUNNING_STALE_MS,
  deriveJobView,
  isValidKaggleJobId,
  shouldContinuePolling,
  type KaggleJobRow,
} from '@/lib/kaggle/status';

const UUID = '3f2a9c1e-1111-4222-8333-444455556666';

function row(overrides: Partial<KaggleJobRow> = {}): KaggleJobRow {
  return {
    id: UUID,
    type: 'music',
    prompt: 'p',
    status: 'pending',
    result_url: null,
    error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function isoAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

// ------------------------------------------------------------
// deriveJobView — সব অবস্থা
// ------------------------------------------------------------

describe('t33: deriveJobView', () => {
  const NOW = Date.now();

  test('সদ্য-তৈরি pending → pending, ইঙ্গিত নেই', () => {
    const v = deriveJobView(row({ created_at: isoAgo(5_000), updated_at: isoAgo(5_000) }), NOW);
    expect(v.status).toBe('pending');
    expect(v.workerMayBeOffline).toBe(false);
    expect(v.stale).toBe(false);
  });

  test('pending > ২ মিনিট → অফলাইন-ইঙ্গিত, কিন্তু pending-ই (মিথ্যা-ব্যর্থ নয়)', () => {
    const v = deriveJobView(row({ created_at: isoAgo(2.5 * 60_000), updated_at: isoAgo(2.5 * 60_000) }), NOW);
    expect(v.status).toBe('pending');
    expect(v.workerMayBeOffline).toBe(true);
  });

  test('running সদ্য-আপডেটেড → running', () => {
    const v = deriveJobView(row({ status: 'running', created_at: isoAgo(60_000), updated_at: isoAgo(10_000) }), NOW);
    expect(v.status).toBe('running');
    expect(v.stale).toBe(false);
  });

  test('running > ৯০ মিনিট (updated_at থেকে) → স্টেল-ব্যর্থ রায়', () => {
    const v = deriveJobView(
      row({ status: 'running', created_at: isoAgo(95 * 60_000), updated_at: isoAgo(91 * 60_000) }),
      NOW,
    );
    expect(v.status).toBe('failed');
    expect(v.stale).toBe(true);
    expect(v.error).toBeTruthy();
  });

  test('running ৮৯ মিনিট → এখনো running (সীমানার ভিতরে)', () => {
    const v = deriveJobView(
      row({ status: 'running', created_at: isoAgo(95 * 60_000), updated_at: isoAgo(89 * 60_000) }),
      NOW,
    );
    expect(v.status).toBe('running');
    expect(v.stale).toBe(false);
  });

  test('done → resultUrl ফেরত', () => {
    const v = deriveJobView(
      row({ status: 'done', result_url: 'https://unit.supabase.co/x.wav' }),
      NOW,
    );
    expect(v.status).toBe('done');
    expect(v.resultUrl).toBe('https://unit.supabase.co/x.wav');
  });

  test('failed → error ফেরত', () => {
    const v = deriveJobView(row({ status: 'failed', error: 'video worker not implemented yet' }), NOW);
    expect(v.status).toBe('failed');
    expect(v.error).toBe('video worker not implemented yet');
  });

  test('অজানা অবস্থা/ধরন → সৎ-ব্যর্থ', () => {
    const v = deriveJobView(row({ status: 'weird' }), NOW);
    expect(v.status).toBe('failed');
    expect(v.error).toBeTruthy();
    const v2 = deriveJobView(row({ type: 'poem' }), NOW);
    expect(v2.status).toBe('failed');
    expect(v2.error).toBeTruthy();
  });
});

// ------------------------------------------------------------
// shouldContinuePolling — terminal-এ পোলিং থামে
// ------------------------------------------------------------

describe('t33: shouldContinuePolling', () => {
  test('pending/running → true; done/failed (স্টেল-ব্যর্থসহ) → false', () => {
    expect(shouldContinuePolling({ status: 'pending' })).toBe(true);
    expect(shouldContinuePolling({ status: 'running' })).toBe(true);
    expect(shouldContinuePolling({ status: 'done' })).toBe(false);
    expect(shouldContinuePolling({ status: 'failed' })).toBe(false);
  });
});

// ------------------------------------------------------------
// UUID + ধ্রুবক
// ------------------------------------------------------------

describe('t33: UUID-যাচাই ও ধ্রুবক', () => {
  test('বৈধ v4 UUID → true; অবৈধ → false', () => {
    expect(isValidKaggleJobId(UUID)).toBe(true);
    expect(isValidKaggleJobId('not-a-uuid')).toBe(false);
    expect(isValidKaggleJobId('')).toBe(false);
    expect(isValidKaggleJobId('3f2a9c1e-1111-4222-c333-444455556666')).toBe(false); // ভ্যারিয়েন্ট-নিবল c (সংরক্ষিত) — [89ab]-এর বাইরে
  });

  test('ধ্রুবক-চুক্তি (৫ সে. পোল, ২ মি. ইঙ্গিত, ৯০ মি. স্টেল, ১০০০ অক্ষর)', () => {
    expect(KAGGLE_JOB_POLL_INTERVAL_MS).toBe(5_000);
    expect(KAGGLE_PENDING_OFFLINE_HINT_MS).toBe(120_000);
    expect(KAGGLE_RUNNING_STALE_MS).toBe(90 * 60_000);
    expect(KAGGLE_PROMPT_MAX_CHARS).toBe(1_000);
    expect(KAGGLE_LIST_DEFAULT_LIMIT).toBe(20);
    expect(KAGGLE_LIST_MAX_LIMIT).toBe(50);
  });
});

// ------------------------------------------------------------
// ডিফল্ট-আচরণ অপরিবর্তিত — availability matrix + provider registry
// ------------------------------------------------------------

describe('t33: ডিফল্ট পথ অপরিবর্তিত (matrix + registry)', () => {
  test('২৩টি মূল matrix-সারি অক্ষত + cap-kaggle-music সংযোজন = ২৪, সব কী অনন্য', async () => {
    const { AVAILABILITY_MATRIX } = await import('@/lib/agent/availability-matrix');
    const keys = AVAILABILITY_MATRIX.map(r => r.key);
    const originalKeys = [
      'cap-speech', 'cap-transcription', 'cap-instrumental', 'cap-full-song', 'cap-stems',
      'cap-imagegen', 'cap-imageedit', 'cap-imagesearch', 'cap-vision',
      'cap-t2v', 'cap-i2v', 'cap-character-motion', 'cap-video-audio',
      'cap-talking-portrait', 'cap-singing-lipsync',
      'cap-video-editing', 'cap-subtitles', 'cap-sound-design',
      'cap-motion-video', 'cap-music-video', 'cap-short-film',
      'cap-web-search', 'cap-page-reader',
    ];
    for (const k of originalKeys) {
      expect(keys.includes(k)).toBe(true);
    }
    expect(keys.includes('cap-kaggle-music')).toBe(true);
    expect(AVAILABILITY_MATRIX.length).toBe(originalKeys.length + 1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('cap-instrumental সারি অপরিবর্তিত — প্রসিডিউরাল, experimental', async () => {
    const { AVAILABILITY_MATRIX } = await import('@/lib/agent/availability-matrix');
    const instrumental = AVAILABILITY_MATRIX.find(r => r.key === 'cap-instrumental');
    expect(instrumental?.overall).toBe('experimental');
    expect(instrumental?.provider).toBe('local_engine');
    expect(instrumental?.model).toContain('প্রসিডিউরাল');
  });

  test('ক্যাগল-সারি env-সচেতন: configured হলেও সর্বোচ্চ experimental', async () => {
    const { kaggleMusicMatrixRow } = await import('@/lib/agent/availability-matrix');
    const off = kaggleMusicMatrixRow({ configured: false });
    expect(off.overall).toBe('unavailable_here');
    expect(String(off.errorReason)).toContain('SUPABASE_URL');
    const on = kaggleMusicMatrixRow({ configured: true });
    expect(on.overall).toBe('experimental'); // "available" দাবি নয় — কর্মী-অনলাইন আলাদা
    expect(String(on.honestNote)).toContain('অপ্ট-ইন');
    expect(on.taskType).toBe('remote_gpu_music');
    // env-চালিত পাঠও কাজ করে (env → configured)
    process.env.SUPABASE_URL = 'https://t33.supabase.co';
    process.env.SUPABASE_KEY = 't33-key';
    try {
      expect(kaggleMusicMatrixRow().overall).toBe('experimental');
    } finally {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_KEY;
    }
  });

  test('matrixRowForTask: remote_gpu_music → ক্যাগল-সারি; instrumental_music → মূল সারি', async () => {
    const { matrixRowForTask } = await import('@/lib/agent/availability-matrix');
    expect(matrixRowForTask('remote_gpu_music')?.key).toBe('cap-kaggle-music');
    expect(matrixRowForTask('instrumental_music')?.key).toBe('cap-instrumental');
  });

  test('providers/registry-তে কোনো ক্যাগল-কী নেই; ডিফল্ট ইনস্ট্রুমেন্টাল আগের মতোই', async () => {
    const { getCapabilityReports } = await import('@/lib/providers/registry');
    const reports = getCapabilityReports({ sandboxConfigured: false });
    expect(reports.every(r => !r.key.includes('kaggle'))).toBe(true);
    const music = reports.find(r => r.key === 'instrumental_music');
    expect(music?.status).toBe('available');
    expect(music?.portable).toBe(true);
    expect(music?.provider).toContain('procedural');
  });
});
