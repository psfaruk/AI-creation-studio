// ============================================================
// Kaggle GPU মিউজিক — সম্পন্ন জবের ফলাফল বিদ্যমান Artifact-
// মডেলে নথিভুক্ত করা (Phase 6-এর সবচেয়ে অনুপ্রবেশক-হীন পথ)।
//
// পূর্ব-নজির: image-search আর্টিফ্যাক্ট আজই sourceUrl (external) +
// storagePath=null দিয়ে রেজিস্টার হয় — /api/artifacts/[id]/file
// রুট 302-redirect করে, গ্যালারি/চ্যাট-প্লেয়ার স্বাভাবিক চলে।
// ক্যাগল-ফলাফলও ঠিক সেই পথেই যায় — কোনো নতুন গ্যালারি-সিস্টেম নেই।
//
// সতর্কতা: ফাইলটি Supabase Storage-এ (পাবলিক outputs বাকেট) —
// অ্যাপের নিজের storage/-এ নয়; size=0 = "অজানা (এক্সটার্নাল)"।
// নথিভুক্তকরণ ব্যর্থ হলে null ফেরত দেয় — UI তখন সরাসরি result_url
// ব্যবহার করে; জব-স্ট্যাটাস কখনো এজন্য ব্যর্থ হয় না।
// ============================================================

import { db } from '@/lib/db';
import type { KaggleJobView } from './status';

const KAGGLE_MUSIC_CONVERSATION_TITLE = '🎛️ ক্যাগল GPU মিউজিক';

/**
 * done-জবের ফলাফল একবার (idempotent) Artifact হিসেবে রেজিস্টার করে।
 * @returns আর্টিফ্যাক্ট-ফাইল URL (`/api/artifacts/{id}/file`) বা null
 */
export async function ensureArtifactForJob(job: KaggleJobView): Promise<string | null> {
  if (job.status !== 'done' || !job.resultUrl) return null;

  try {
    // ডুপ্লিকেট-রোধ: একই sourceUrl আগে রেজিস্টার হলে সেটিই ফেরত
    const existing = await db.artifact.findFirst({ where: { sourceUrl: job.resultUrl } });
    if (existing) return `/api/artifacts/${existing.id}/file`;

    // কথোপকথন find-or-create (Artifact.conversationId আবশ্যক-সম্পর্ক)
    let conversation = await db.conversation.findFirst({
      where: { title: KAGGLE_MUSIC_CONVERSATION_TITLE },
    });
    if (!conversation) {
      conversation = await db.conversation.create({
        data: { title: KAGGLE_MUSIC_CONVERSATION_TITLE },
      });
    }

    const artifact = await db.artifact.create({
      data: {
        conversationId: conversation.id,
        origin: 'tool',
        kind: 'audio',
        mimeType: 'audio/wav',
        fileName: `kaggle-musicgen-${job.id}.wav`,
        size: 0, // এক্সটার্নাল — প্রকৃত বাইট-আকার অজানা (সৎ-0)
        storagePath: null, // লোকাল ফাইল নেই — 302-redirect পথ
        sourceUrl: job.resultUrl,
        metaJson: JSON.stringify({
          provider: 'kaggle-gpu-musicgen',
          kaggleJobId: job.id,
          honestLabel:
            'KAGGLE_GPU_MUSICGEN — রিমোট Kaggle T4 GPU (MusicGen); ইনস্ট্রুমেন্টাল-ধাঁচের অডিও, গাওয়া কণ্ঠ নয়',
        }),
      },
    });
    return `/api/artifacts/${artifact.id}/file`;
  } catch {
    // রেজিস্ট্রেশন-ব্যর্থতা জব-ফলাফল দেখানোকে ব্যাহত করবে না
    return null;
  }
}
