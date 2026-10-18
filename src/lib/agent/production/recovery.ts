// ============================================================
// Production Recovery — বুট-রিকভারি + শাটডাউন-চিহ্নিতকরণ (Phase 1, B-D3)
//
// নীতি (মাস্টার-প্রম্পট Phase 1):
//  - মেমরির সারি কখনোই ক্র্যাশ-নিরাপদ সত্য নয় — DB-ই সত্য।
//  - বাধাগ্রস্ত জব কখনো সফল চিহ্ত হয় না।
//  - পুনরায় চালু (requeue) কেবল সেই জবের, যার কোনো জেনারেশন-কলই
//    হয়নি (status='queued' + startedAt=null) — ডুপ্লিকেট-বিলিং অসম্ভব।
//  - 'running'/'validating' জব মাঝপথে মরে থাকলে → সৎ 'failed'
//    ("রিস্টার্টে বাধাগ্রস্ত") — নতুন প্রস্তাব/আবার-চালানোর পথ খোলা।
//
// runner.ts-এর আগের sweepInterruptedOnBoot-এর সৎ আচরণ অপরিবর্তিত —
// শুধু queued-never-started শাখাটি নতুন (নিরাপদ requeue) এবং লজিক
// টেস্টযোগ্য করার জন্য এই পৃথক মডিউলে (runner-এর ভারী ইমপোর্ট-গ্রাফ
// ছাড়াই fake-db দিয়ে পরীক্ষণযোগ্য)।
//
// একক-ইনস্ট্যান্স অনুমান: Railway Phase 2 এক-ওয়েব-সার্ভিস স্থাপত্যে
// বৈধ; worker-split (Phase 2b) হলে দাবি-করা (claim) লেনদেন যোগ হবে —
// docs/audit/railway-hf-deployment/phase-1-remaining-railway-steps.md।
// ============================================================

import { db } from '@/lib/db';
import { emitProduction } from './bus';

/** চলমান প্রসেসের পরিচিত জব-স্ন্যাপশট (running-সেট + মেমরি-সারি) */
export interface RecoveryActiveSnapshot {
  running: ReadonlySet<string>;
  queued: ReadonlyArray<string>;
}

export interface BootRecoveryOutcome {
  /** কখনো শুরুই হয়নি (queued + startedAt=null) → নিরাপদে পুনঃসারিভুক্ত */
  requeued: string[];
  /** মৃত প্রসেসের চলমান/যাচাইধর্মী/বাতিলপথের জব → সৎ failed */
  failed: string[];
}

/** রিস্টার্টে-বাধাগ্রস্ত জবের সৎ বার্তা (runner-এর পূর্ববর্তী বার্তারই অর্থ) */
export const RESTART_INTERRUPTED_MESSAGE =
  'সার্ভার রিস্টার্টে বাধাগ্রস্ত হয়েছে — আবার চালু করুন (নিচের "আবার চালান" বা "সংশোধন" দিয়ে নতুন প্রস্তাব তৈরি হবে)';

/** রিডিপ্লয়/শাটডাউনে বাধাগ্রস্ত জবের সৎ বার্তা (SIGTERM-পথের জন্য আলাদা) */
export const SHUTDOWN_INTERRUPTED_MESSAGE =
  'সার্ভার বন্ধ/রিডিপ্লয়ে বাধাগ্রস্ত হয়েছে — আবার চালু করুন (নতুন প্রস্তাব বা "আবার চালান")';

/**
 * বুট-রিকভারি — প্রসেস-শুরুতে (instrumentation থেকে, ৩ সে. দেরিতে) একবার।
 *
 * @param active চলমান প্রসেসের running/queued-স্ন্যাপশট — এই আইডিগুলোকে
 *   স্পর্শ করা হয় না (dev-HMR/একই-প্রসেসের সত্যিকারের চলমান কাজ)।
 * @param requeue নিরাপদ-পুনরায়-চালুযোগ্য জব এই কলব্যাকে যাবে
 *   (runner এখানে startProduction পাস করে — সারি-ক্যাপ + ডিডুপসহ)।
 */
export async function recoverProductionsOnBoot(
  active: RecoveryActiveSnapshot,
  requeue: (id: string) => void
): Promise<BootRecoveryOutcome> {
  const rows = await db.production.findMany({
    where: { status: { in: ['running', 'queued', 'validating', 'cancelling'] } },
    select: { id: true, status: true, startedAt: true },
  });
  const isActive = (id: string): boolean =>
    active.running.has(id) || active.queued.includes(id);

  const requeued: string[] = [];
  const failed: string[] = [];
  for (const row of rows) {
    if (isActive(row.id)) continue;
    // নিরাপত্তা-চুক্তি: runProduction ঠিক 'running'-এ রূপান্তরের সাথেই
    // startedAt লেখে — তাই queued+startedAt=null মানে কোনো জেনারেশন-কলই
    // হয়নি → ডুপ্লিকেট-বিলিং ঝুঁকি ছাড়াই requeue করা যায়।
    if (row.status === 'queued' && !row.startedAt) {
      requeued.push(row.id);
      continue;
    }
    failed.push(row.id);
  }

  if (failed.length > 0) {
    await db.production.updateMany({
      where: { id: { in: failed } },
      data: { status: 'failed', error: RESTART_INTERRUPTED_MESSAGE, finishedAt: new Date() },
    });
    for (const id of failed) {
      emitProduction(id, {
        type: 'production_finished',
        productionId: id,
        status: 'failed',
        error: RESTART_INTERRUPTED_MESSAGE,
      });
    }
  }
  for (const id of requeued) requeue(id);

  return { requeued, failed };
}

/**
 * লালনামূলক শাটডাউন (Railway SIGTERM, ~৩০ সে. গ্রেস-জানালা):
 * চলমান জবগুলোকে প্রক্রিয়া-মৃত্যুর আগেই সৎভাবে failed করে রাখো —
 * নতুন প্রসেসের বুট-সুইপের অপেক্ষা না করেই UI সত্য দেখায়।
 * (ফলাফল-রেস নিরাপদ: পাইপলাইন শেষ-মুহূর্তে 'completed' লিখতে পারলে
 * সেটিই বৈধ; SIGKILL হলে বুট-সুইপ অবশিষ্ট ঢেকে দেয় — প্রতিরক্ষা-স্তর।)
 */
export async function markInFlightInterruptedOnShutdown(runningIds: string[]): Promise<number> {
  if (runningIds.length === 0) return 0;
  const res = await db.production.updateMany({
    where: { id: { in: runningIds }, status: { in: ['running', 'validating'] } },
    data: { status: 'failed', error: SHUTDOWN_INTERRUPTED_MESSAGE, finishedAt: new Date() },
  });
  if (res.count > 0) {
    console.log(`[production] shutdown: ${res.count} টি চলমান প্রোডাকশন সৎভাবে failed চিহ্নিত (রিডিপ্লয়)`);
  }
  return res.count;
}
