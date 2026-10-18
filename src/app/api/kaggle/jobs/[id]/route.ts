// GET /api/kaggle/jobs/[id] — একক জবের অবস্থা + নিরাপদ প্রদর্শন-ক্ষেত্র।
//
// - আইডি UUID-আগেই-যাচাই (অবৈধ → 400; অসীম পাঠ রোধ)।
// - না পেলে 404।
// - প্রতিক্রিয়ায় কখনো SUPABASE_KEY/আপস্ট্রিম-হেডার যায় না।
// - done-জব প্রথমবার দেখা গেলে ফলাফলটি একবার (idempotent) বিদ্যমান
//   Artifact-মডেলে রেজিস্টার হয় → artifactUrl ফেরত যায়; ব্যর্থ হলে
//   UI সরাসরি resultUrl ব্যবহার করে (জব-স্ট্যাটাস অক্ষুণ্ণ থাকে)।
import { NextResponse } from 'next/server';

import { requireOwner } from '@/lib/security';
import { ensureArtifactForJob } from '@/lib/kaggle/artifacts';
import { getJob } from '@/lib/kaggle/jobs';
import { toKaggleErrorResponse } from '@/lib/kaggle/route-helpers';
import { deriveJobView, isValidKaggleJobId } from '@/lib/kaggle/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidKaggleJobId(id)) {
    return NextResponse.json(
      { error: 'জব-আইডি বৈধ UUID নয়।', code: 'kaggle_invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const row = await getJob(id);
    if (!row) {
      return NextResponse.json(
        { error: 'জব খুঁজে পাওয়া যায়নি।' },
        { status: 404, headers: NO_STORE },
      );
    }
    const job = deriveJobView(row, Date.now());
    const artifactUrl = await ensureArtifactForJob(job);
    return NextResponse.json(
      { job: artifactUrl ? { ...job, artifactUrl } : job },
      { headers: NO_STORE },
    );
  } catch (e) {
    return toKaggleErrorResponse(e);
  }
}
