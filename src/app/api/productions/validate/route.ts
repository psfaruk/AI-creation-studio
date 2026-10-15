// POST /api/productions/validate — Phase-4 D: প্রস্তাবিত কনফিগারেশনের
// লাইভ ক্ষমতা-যাচাই (নিশ্চিতকরণের আগে প্যানেলে দেখানোর জন্য)।
//
// নীতি:
//  - চূড়ান্ত রায় সবসময় আসল validateSpec থেকে — আলাদা ক্ষমতা-তালিকা নয়।
//  - ক্লায়েন্ট-সরবরাহি ক্ষমতা-দাবি (isSupported/provider/cost ইত্যাদি)
//    সম্পূর্ণ উপেক্ষিত — শুধু spec-এর ক্ষেত্রগুলোই যাচাই হয়।
//  - ভিডিও-ধরনে প্রোভাইডার-প্রাপ্যতার সৎ স্ন্যাপশট (busy/cooldown —
//    কোনো গোপন তথ্য নয়); অবস্থা যা-ই হোক নিশ্চিত করা যায়, অপেক্ষার
//    সৎ নোটসহ।
//  - confirm এন্ডপয়েন্ট নিজে আবার পুনঃযাচাই করে (§15) — এটি তার পূরক।
import { NextResponse } from 'next/server';
import { requireOwner } from '@/lib/security';
import { checkRateLimit } from '@/lib/limits';
import { validateSpec } from '@/lib/agent/capabilities';
import { videoProviderStatus } from '@/lib/agent/video/ai_video';
import type { VideoProviderStatusView } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VIDEO_TYPES = ['motion_video', 'music_video', 'short_film'];
/** স্পেক-অবজেক্টের সর্বোচ্চ আকার — JSON-স্ট্রিং হিসেবে (সীমাবদ্ধ ইনপুট) */
const MAX_SPEC_JSON = 20_000;

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const rl = checkRateLimit(`spec-validate:${clientKey(req)}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `অনেক দ্রুত যাচাই-অনুরোধ — ${rl.retryAfterSec} সেকেন্ড পরে আবার চেষ্টা করুন` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec ?? 30) } }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'অনুরোধের বডি পড়া যায়নি (JSON হতে হবে)' }, { status: 400 });
  }
  const spec = body?.spec;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    return NextResponse.json({ error: 'spec অবজেক্ট প্রয়োজন' }, { status: 400 });
  }
  try {
    if (JSON.stringify(spec).length > MAX_SPEC_JSON) {
      return NextResponse.json({ error: 'spec খুব বড়' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'spec পড়া যায়নি' }, { status: 400 });
  }

  // (নিরাপত্তা) ক্লায়েন্টের ক্ষমতা-দাবি-জাতীয় অতিরিক্ত ক্ষেত্র সরিয়ে ফেলা
  // হয় না — validateSpec নিজেই শুধু পরিচিত ক্ষেত্রগুলো পড়ে; অজানা ক্ষেত্র
  // (যেমন isSupported) কখনো রায় বদলাতে পারে না।

  const validation = validateSpec(spec);
  const type = typeof spec?.type === 'string' ? spec.type : '';

  // ভিডিও-ধরনে প্রোভাইডার-প্রাপ্যতার সৎ স্ন্যাপশট (engine cinematic_motion
  // হলে ক্লাউড-প্রোভাইডারের অবস্থা প্রাসঙ্গিক নয় — লোকাল পথ)।
  // (নিরাপত্তা) lastError-টেক্সট এই সীমানা পার হয় না — শুধু বুলিয়ান/
  // গণনা-ধর্মী অবস্থা (কোনো ত্রুটি-টেক্সট/গোপন তথ্য ক্লায়েন্টে নয়)।
  let providerStatus: VideoProviderStatusView | undefined;
  let providerUnavailable = false;
  if (VIDEO_TYPES.includes(type) && spec?.videoEngine !== 'cinematic_motion') {
    const s = videoProviderStatus();
    providerStatus = {
      busy: s.busy,
      ...(s.inFlightSec !== undefined ? { inFlightSec: s.inFlightSec } : {}),
      cooldownRemainingMs: s.cooldownRemainingMs,
      ...(s.avgGenerationMs !== undefined ? { avgGenerationMs: s.avgGenerationMs } : {}),
    };
    providerUnavailable = providerStatus.busy || providerStatus.cooldownRemainingMs > 5_000;
  }

  // রায়-ম্যাপিং:
  //  - type-ই অজানা/অনুপস্থিত → requires_clarification
  //  - যাচাই ব্যর্থ → unsupported (ত্রুটি-তালিকাসহ)
  //  - যাচাই সফল + সমন্বয়/নোট আছে → supported_with_limitations
  //  - যাচাই সফল, পরিচ্ছন্ন → supported
  //  - ভিডিও-প্রোভাইডার ব্যস্ত/কুলডাউনে → temporarily_unavailable
  //    (তবে নিশ্চিত করা যায় — সৎ অপেক্ষা-নোট সহ)
  let verdict: 'supported' | 'supported_with_limitations' | 'unsupported' | 'requires_clarification' | 'temporarily_unavailable';
  if (!type) {
    verdict = 'requires_clarification';
  } else if (!validation.ok || !validation.validated) {
    verdict = 'unsupported';
  } else if (providerUnavailable) {
    verdict = 'temporarily_unavailable';
  } else if (validation.validated.adjustments.length > 0 || validation.validated.notes.length > 0) {
    verdict = 'supported_with_limitations';
  } else {
    verdict = 'supported';
  }

  return NextResponse.json({
    verdict,
    validation: {
      ok: validation.ok,
      errors: validation.errors,
      ...(validation.alternatives?.length ? { alternatives: validation.alternatives } : {}),
      ...(validation.validated
        ? {
            adjustments: validation.validated.adjustments,
            notes: validation.validated.notes,
            plannedSteps: validation.validated.plannedSteps,
            spec: validation.validated.spec,
          }
        : {}),
    },
    ...(providerStatus ? { providerStatus } : {}),
  });
}
