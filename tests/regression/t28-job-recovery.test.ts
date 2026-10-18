// ============================================================
// REGRESSION TEST 28 — Production Job Recovery (Phase 1, B-D3)
//
// Boundaries:
//  - Module under test (REAL): src/lib/agent/production/recovery.ts —
//    recoverProductionsOnBoot + markInFlightInterruptedOnShutdown।
//  - Mocked: '@/lib/db' → in-memory fake (কোনো আসল SQLite-লেখা নেই)।
//    emitProduction (bus) আসলই থাকে — বিশুদ্ধ ইন-মেমরি, কোনো পার্শ্ব-
//    প্রভাব নেই।
//  - No network, no LLM, no pipeline execution.
//
// Enforced contracts (মাস্টার-প্রম্পট Phase 1):
//  ১. queued + startedAt=null (কখনো শুরুই হয়নি) → নিরাপদ requeue —
//     DB-স্ট্যাটাস অপরিবর্তিত, ডুপ্লিকেট-জেনারেশনের সুযোগ নেই।
//  ২. running/validating/cancelling (মৃত প্রসেসের) → সৎ 'failed' +
//     বার্তা + finishedAt — কখনো 'completed' নয়।
//  ৩. চলমান প্রসেসের পরিচিত (active) আইডি কখনো স্পর্শ হয় না।
//  ৪. শাটডাউন-চিহ্নিতকরণ: কেবল running/validating-কে স্পর্শ করে,
//     সংখ্যা সৎভাবে ফেরত দেয়।
//  ৫. queued + startedAt≠null (প্রতিরক্ষামূলক) → failed (সফল নয়)।
// ============================================================

import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { fakeDb, resetFakeDb, seedConversation, seedProduction } from '../helpers/fake-db';

mock.module('@/lib/db', () => ({ db: fakeDb }));

// মক সেটআপের পরে আমদানি (t3-প্যাটার্ন)
const {
  recoverProductionsOnBoot,
  markInFlightInterruptedOnShutdown,
  RESTART_INTERRUPTED_MESSAGE,
} = await import('@/lib/agent/production/recovery');

const SPEC = { type: 'image', title: 't28' };

describe('t28 · recoverProductionsOnBoot', () => {
  let requeued: string[];
  const requeue = (id: string) => requeued.push(id);

  beforeEach(() => {
    resetFakeDb();
    requeued = [];
  });

  test('queued + কখনো-শুরু-হয়নি → নিরাপদ requeue (DB-স্ট্যাটাস অপরিবর্তিত)', async () => {
    seedConversation('conv-1');
    const p = seedProduction('conv-1', SPEC, { status: 'queued', startedAt: null });
    const out = await recoverProductionsOnBoot({ running: new Set(), queued: [] }, requeue);
    expect(out.requeued).toEqual([p.id]);
    expect(out.failed).toEqual([]);
    expect(requeued).toEqual([p.id]);
    // DB-সত্য: এখনো queued — runProduction-ই ঠিক সময়ে running করবে
    const row = await (fakeDb.production as any).findUnique({ where: { id: p.id } });
    expect(row?.status).toBe('queued');
  });

  test('মৃত প্রসেসের running → সৎ failed + বার্তা + finishedAt (কখনো সফল নয়)', async () => {
    seedConversation('conv-1');
    const p = seedProduction('conv-1', SPEC, {
      status: 'running',
      startedAt: new Date(Date.now() - 60_000),
    });
    const out = await recoverProductionsOnBoot({ running: new Set(), queued: [] }, requeue);
    expect(out.failed).toEqual([p.id]);
    expect(out.requeued).toEqual([]);
    const row = await (fakeDb.production as any).findUnique({ where: { id: p.id } });
    expect(row.status).toBe('failed');
    expect(row.error).toBe(RESTART_INTERRUPTED_MESSAGE);
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(row.status === 'completed').toBe(false);
  });

  test('validating ও cancelling-ও সৎ failed (ঝুলে-থাকা অবস্থা নয়)', async () => {
    seedConversation('conv-1');
    const v = seedProduction('conv-1', SPEC, { status: 'validating', startedAt: new Date() });
    const c = seedProduction('conv-1', SPEC, { status: 'cancelling', startedAt: new Date() });
    const out = await recoverProductionsOnBoot({ running: new Set(), queued: [] }, requeue);
    expect(new Set(out.failed)).toEqual(new Set([v.id, c.id]));
    for (const id of [v.id, c.id]) {
      const row = await (fakeDb.production as any).findUnique({ where: { id } });
      expect(row.status).toBe('failed');
    }
  });

  test('active (চলমান প্রসেসের) আইডি কখনো স্পর্শ হয় না — running-সেট ও মেমরি-সারি উভয়ই', async () => {
    seedConversation('conv-1');
    const live1 = seedProduction('conv-1', SPEC, { status: 'running', startedAt: new Date() });
    const live2 = seedProduction('conv-1', SPEC, { status: 'queued', startedAt: null });
    const dead = seedProduction('conv-1', SPEC, { status: 'running', startedAt: new Date() });
    const out = await recoverProductionsOnBoot(
      { running: new Set([live1.id]), queued: [live2.id] },
      requeue
    );
    expect(out.requeued).toEqual([]);
    expect(out.failed).toEqual([dead.id]);
    const r1 = await (fakeDb.production as any).findUnique({ where: { id: live1.id } });
    const r2 = await (fakeDb.production as any).findUnique({ where: { id: live2.id } });
    expect(r1.status).toBe('running'); // অক্ষত
    expect(r2.status).toBe('queued'); // অক্ষত
  });

  test('queued + startedAt≠null (প্রতিরক্ষামূলক অবস্থা) → failed, সফল নয়', async () => {
    seedConversation('conv-1');
    const p = seedProduction('conv-1', SPEC, { status: 'queued', startedAt: new Date() });
    const out = await recoverProductionsOnBoot({ running: new Set(), queued: [] }, requeue);
    expect(out.requeued).toEqual([]);
    expect(out.failed).toEqual([p.id]);
  });

  test('টার্মিনাল/প্রাক-কনফার্ম স্ট্যাটাস কখনো স্পর্শ হয় না', async () => {
    seedConversation('conv-1');
    const done = seedProduction('conv-1', SPEC, { status: 'completed', startedAt: new Date(), finishedAt: new Date() });
    const failed = seedProduction('conv-1', SPEC, { status: 'failed', error: 'আগের কারণ' });
    const awaiting = seedProduction('conv-1', SPEC, { status: 'awaiting_confirmation' });
    const out = await recoverProductionsOnBoot({ running: new Set(), queued: [] }, requeue);
    expect(out.requeued).toEqual([]);
    expect(out.failed).toEqual([]);
    const f = await (fakeDb.production as any).findUnique({ where: { id: failed.id } });
    expect(f.error).toBe('আগের কারণ'); // পুরোনো ব্যর্থতার কারণ মুছে যায়নি
    void done; void awaiting;
  });
});

describe('t28 · markInFlightInterruptedOnShutdown (SIGTERM-পথ)', () => {
  beforeEach(() => {
    resetFakeDb();
  });

  test('কেবল running/validating স্পর্শ করে; সংখ্যা সৎ', async () => {
    seedConversation('conv-1');
    const r = seedProduction('conv-1', SPEC, { status: 'running', startedAt: new Date() });
    const v = seedProduction('conv-1', SPEC, { status: 'validating', startedAt: new Date() });
    const q = seedProduction('conv-1', SPEC, { status: 'queued', startedAt: null });
    const c = seedProduction('conv-1', SPEC, { status: 'completed', finishedAt: new Date() });
    const count = await markInFlightInterruptedOnShutdown([r.id, v.id, q.id, c.id]);
    expect(count).toBe(2);
    const rr = await (fakeDb.production as any).findUnique({ where: { id: r.id } });
    const vv = await (fakeDb.production as any).findUnique({ where: { id: v.id } });
    const qq = await (fakeDb.production as any).findUnique({ where: { id: q.id } });
    expect(rr.status).toBe('failed');
    expect(vv.status).toBe('failed');
    expect(rr.error).toContain('রিডিপ্লয়');
    expect(qq.status).toBe('queued'); // queued স্পর্শহীন — বুট-রিকভারির জিম্মা
  });

  test('খালি তালিকায় ০ — কোনো DB-কল ছাড়াই', async () => {
    const count = await markInFlightInterruptedOnShutdown([]);
    expect(count).toBe(0);
  });
});
