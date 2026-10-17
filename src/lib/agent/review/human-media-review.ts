// ============================================================
// মানব-মিডিয়া-পর্যালোচনা (D-9/B7) — durable human review workflow.
//
// HONESTY RULE (এই মডিউলের মূল চুক্তি):
//   NEVER invent human-review outcomes. জেনারেট করা কোনো আর্টিফ্যাক্টের
//   পর্যালোচনা শুরু হয় 'NOT_REVIEWED' দিয়ে — কেবল একজন প্রকৃত মানুষের
//   পর্যালোচনাই সেটি বদলাতে পারে। reviewer-নাম / তারিখ / রায় কখনো
//   বানানো হয় না; createEmptyReview() কখনোই reviewer বা তারিখ আবিষ্কার
//   করে না (null-ই থাকে), আর validateReviewRecord() প্রমাণ-ছাড়া রায়
//   (PASS/PASS_WITH_LIMITATIONS/FAIL) প্রত্যাখ্যান করে।
//
// Usage: docs/review/human-media-review-template.md টেমপ্লেটে ভরে একটি
// রেকর্ড তৈরি হয়; validateReviewRecord() সেটি যাচাই করে;
// summarizeReview()/hasUnreviewedDimensions() সৎ সারাংশ দেয়।
//
// ১৩টি মাত্রিক (master-prompt B7 হুবহু) — এর বাইরে কোনো কী গ্রহণযোগ্য
// নয়, এবং একটি বৈধ রেকর্ডে ১৩টির সবগুলোই থাকতে হয় (অ-পর্যালোচিত হলে
// 'NOT_REVIEWED' মান হিসেবে — কী বাদ দিয়ে সারাংশ সাজানো অসৎ)।
// ============================================================

/** B7-এর ১৩টি পর্যালোচনা-মাত্রিক — হুবহু তালিকা, ক্রম-অবিকল। */
export const HUMAN_REVIEW_DIMENSIONS = [
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
] as const;

export type DimensionKey = (typeof HUMAN_REVIEW_DIMENSIONS)[number];

/** পর্যালোচনার ৪টি অবস্থা — এর বাইরে কিছু নয়। */
export type HumanReviewStatus = 'NOT_REVIEWED' | 'PASS' | 'PASS_WITH_LIMITATIONS' | 'FAIL';

const ALLOWED_STATUSES: readonly HumanReviewStatus[] = [
  'NOT_REVIEWED',
  'PASS',
  'PASS_WITH_LIMITATIONS',
  'FAIL',
];

/** একটি মাত্রিকের ফল: অবস্থা + ঐচ্ছিক প্রমাণ-নোট। */
export interface HumanReviewDimensionResult {
  status: HumanReviewStatus;
  note?: string;
}

/** পূর্ণ, মানুষের-ভরা পর্যালোচনা-রেকর্ড (প্রমাণসহ)। */
export interface HumanMediaReviewRecord {
  artifactId: string;
  productionId?: string;
  reviewer: string;
  reviewedAt: string;
  dimensions: Record<DimensionKey, HumanReviewDimensionResult>;
  overallStatus: HumanReviewStatus;
  blockerNote?: string;
}

/**
 * পর্যালোচনা-শুরুর সৎ অবস্থা: সব মাত্রিক NOT_REVIEWED, রায় NOT_REVIEWED,
 * reviewer/তারিখ null — কখনো বানানো হয় না।
 */
export interface UnreviewedMediaReview {
  artifactId: string;
  productionId?: string;
  reviewer: null;
  reviewedAt: null;
  dimensions: Record<DimensionKey, HumanReviewDimensionResult>;
  overallStatus: 'NOT_REVIEWED';
}

/** যেকোনো রেকর্ড-আকৃতির সারাংশের জন্য দরকারি ন্যূনতম অংশ। */
export type ReviewSummaryInput = Pick<HumanMediaReviewRecord, 'dimensions'>;

/**
 * নতুন (এখনো-অপর্যালোচিত) আর্টিফ্যাক্টের রেকর্ড-খসড়া: ১৩টি মাত্রিকই
 * NOT_REVIEWED, overallStatus NOT_REVIEWED, reviewer/reviewedAt null।
 * reviewer-এর নাম বা তারিখ কখনো আবিষ্কার করা হয় না — সেগুলো কেবল
 * প্রকৃত মানব-পর্যালোচনার ফলেই বসে।
 */
export function createEmptyReview(
  artifactId: string,
  productionId?: string
): UnreviewedMediaReview {
  const dimensions = {} as Record<DimensionKey, HumanReviewDimensionResult>;
  for (const key of HUMAN_REVIEW_DIMENSIONS) {
    dimensions[key] = { status: 'NOT_REVIEWED' };
  }
  return {
    artifactId,
    ...(productionId !== undefined ? { productionId } : {}),
    reviewer: null,
    reviewedAt: null,
    dimensions,
    overallStatus: 'NOT_REVIEWED',
  };
}

/** অবস্থার ক্রম (খারাপ → ভালো); NOT_REVIEWED = রায় নেই। */
const STATUS_SEVERITY: Record<HumanReviewStatus, number> = {
  FAIL: 0,
  PASS_WITH_LIMITATIONS: 1,
  PASS: 2,
  NOT_REVIEWED: 3,
};

/**
 * মাত্রিক-সারাংশ (সৎ সমষ্টি):
 *  - কোনো মাত্রিক FAIL হলে → FAIL
 *  - না হলে কোনো PASS_WITH_LIMITATIONS থাকলে → PASS_WITH_LIMITATIONS
 *  - না হলে কোনো PASS থাকলে → PASS
 *  - সবগুলোই NOT_REVIEWED হলে → NOT_REVIEWED
 * আংশিক-পর্যালোচিত রেকর্ডে (কিছু দেখা হয়েছে, কিছু হয়নি) সারাংশ কেবল
 * *দেখা হয়েছে-এমন* মাত্রিকগুলোর উপরেই দাঁড়ায় — ফাঁকটি আলাদাভাবে
 * hasUnreviewedDimensions() সৎভাবে প্রকাশ করে (সারাংশে লুকানো হয় না)।
 */
export function summarizeReview(record: ReviewSummaryInput): HumanReviewStatus {
  let aggregate: HumanReviewStatus = 'NOT_REVIEWED';
  for (const key of HUMAN_REVIEW_DIMENSIONS) {
    const dim = record.dimensions[key];
    if (!dim) continue; // validateReviewRecord এ অনুপস্থিত কী ধরা পড়ে
    if (STATUS_SEVERITY[dim.status] < STATUS_SEVERITY[aggregate]) {
      aggregate = dim.status;
    }
  }
  return aggregate;
}

/** অন্তত একটি মাত্রিক এখনো NOT_REVIEWED কি না — ফাঁকটি সৎভাবে জানায়। */
export function hasUnreviewedDimensions(record: ReviewSummaryInput): boolean {
  return HUMAN_REVIEW_DIMENSIONS.some((key) => record.dimensions[key]?.status === 'NOT_REVIEWED');
}

export type ReviewValidationResult =
  | { ok: true; record: HumanMediaReviewRecord }
  | { ok: false; errors: string[] };

/**
 * বাইরের (UI/ফাইল/ডিবি) ইনপুট থেকে আসা রেকর্ড যাচাই। প্রত্যাখ্যান হয়:
 *  - artifactId অনুপস্থিত/খালি
 *  - অজানা মাত্রিক-কী, বা ১৩টির কোনোটি অনুপস্থিত (আংশিক রেকর্ড দিয়ে
 *    সারাংশ সাজানো অসৎ)
 *  - ৪টির বাইরের অবস্থা-মান
 *  - reviewer/তারিখ-বিহীন রেকর্ড (একটি বৈধ রেকর্ড মানুষের সেশনের দলিল;
 *    বিশেষত বানানো ফলাফল: কোনো PASS/PASS_WITH_LIMITATIONS/FAIL রায়
 *    খালি reviewer বা অনুপস্থিত/অবৈধ reviewedAt-সহ = উদ্ভাবিত)
 *  - অসঙ্গতি: সব মাত্রিক NOT_REVIEWED অথচ overallStatus রায়-দাবি
 *    (উদ্ভাবিত), বা মাত্রিক-রায় আছে অথচ overallStatus NOT_REVIEWED
 *
 * লক্ষ করুন (ইচ্ছাকৃত): overallStatus-কে মাত্রিক-সারাংশের সমান হতে
 * বাধ্য করা হয় না — একজন পর্যালোচক blockerNote-সহ সামগ্রিকভাবে FAIL
 * করতে পারেন যদিও মাত্রিকগুলো পাস করেছে। উপরের দুটি স্পষ্ট অসঙ্গতি
 * ছাড়া রায়টি মানুষেরই।
 */
export function validateReviewRecord(input: unknown): ReviewValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['record must be a plain object'] };
  }
  const rec = input as Record<string, unknown>;

  // --- artifactId / productionId ---
  if (typeof rec.artifactId !== 'string' || rec.artifactId.trim() === '') {
    errors.push('artifactId: required non-empty string (missing artifactId is rejected)');
  }
  if (
    rec.productionId !== undefined &&
    (typeof rec.productionId !== 'string' || rec.productionId.trim() === '')
  ) {
    errors.push('productionId: when present must be a non-empty string');
  }

  // --- reviewer / reviewedAt (প্রমাণ-ক্ষেত্র) ---
  // একটি বৈধ রেকর্ড সবসময় প্রমাণ বহন করে (রেকর্ড = মানুষের পর্যালোচনা-
  // সেশনের দলিল)। "খালি" অবস্থার প্রতিনিধিত্ব করে UnreviewedMediaReview
  // (createEmptyReview) — সেটি কখনো বাইরের ইনপুট থেকে বানানো হয় না।
  const reviewer =
    typeof rec.reviewer === 'string' && rec.reviewer.trim() !== '' ? rec.reviewer : null;
  const reviewedAtRaw = typeof rec.reviewedAt === 'string' ? rec.reviewedAt : null;
  const reviewedAtIsValidDate =
    reviewedAtRaw !== null && !Number.isNaN(Date.parse(reviewedAtRaw));

  // --- dimensions ---
  const dims = rec.dimensions;
  if (typeof dims !== 'object' || dims === null || Array.isArray(dims)) {
    errors.push('dimensions: required object of the 13 dimension keys');
  } else {
    const known = new Set<string>(HUMAN_REVIEW_DIMENSIONS as readonly string[]);
    for (const key of Object.keys(dims)) {
      if (!known.has(key)) {
        errors.push(`dimensions["${key}"]: unknown dimension key (must be one of the 13 B7 dimensions)`);
      }
    }
    for (const key of HUMAN_REVIEW_DIMENSIONS) {
      if (!(key in dims)) {
        errors.push(`dimensions["${key}"]: missing required dimension (all 13 must be present; unreviewed ones carry NOT_REVIEWED)`);
        continue;
      }
      const val = (dims as Record<string, unknown>)[key];
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        errors.push(`dimensions["${key}"]: must be { status, note? }`);
        continue;
      }
      const status = (val as Record<string, unknown>).status;
      if (typeof status !== 'string' || !ALLOWED_STATUSES.includes(status as HumanReviewStatus)) {
        errors.push(`dimensions["${key}"].status: invalid status ${JSON.stringify(status)} (allowed: NOT_REVIEWED, PASS, PASS_WITH_LIMITATIONS, FAIL)`);
      }
      const note = (val as Record<string, unknown>).note;
      if (note !== undefined && typeof note !== 'string') {
        errors.push(`dimensions["${key}"].note: when present must be a string`);
      }
    }
  }

  // --- overallStatus ---
  const overall = rec.overallStatus;
  if (typeof overall !== 'string' || !ALLOWED_STATUSES.includes(overall as HumanReviewStatus)) {
    errors.push(`overallStatus: invalid status ${JSON.stringify(overall)} (allowed: NOT_REVIEWED, PASS, PASS_WITH_LIMITATIONS, FAIL)`);
  }

  // --- blockerNote ---
  if (rec.blockerNote !== undefined && typeof rec.blockerNote !== 'string') {
    errors.push('blockerNote: when present must be a string');
  }

  // --- বানানো-ফলাফল / অসঙ্গতি যাচাই (কেবল আকৃতি-ঠিক হলে অর্থপূর্ণ) ---
  const dimensionStatuses: HumanReviewStatus[] = [];
  if (typeof dims === 'object' && dims !== null && !Array.isArray(dims)) {
    for (const key of HUMAN_REVIEW_DIMENSIONS) {
      const val = (dims as Record<string, unknown>)[key];
      const status =
        typeof val === 'object' && val !== null && !Array.isArray(val)
          ? (val as Record<string, unknown>).status
          : undefined;
      if (typeof status === 'string' && ALLOWED_STATUSES.includes(status as HumanReviewStatus)) {
        dimensionStatuses.push(status as HumanReviewStatus);
      }
    }
  }
  const anyReviewed = dimensionStatuses.some((s) => s !== 'NOT_REVIEWED');
  const overallIsClaimed =
    typeof overall === 'string' &&
    (overall === 'PASS' || overall === 'PASS_WITH_LIMITATIONS' || overall === 'FAIL');

  if (reviewer === null) {
    errors.push(
      anyReviewed || overallIsClaimed
        ? 'reviewer: a record claiming PASS/PASS_WITH_LIMITATIONS/FAIL must name a real reviewer (empty reviewer = invented outcome)'
        : 'reviewer: required non-empty string (a validated record documents a human review session; use createEmptyReview() for the unreviewed state)'
    );
  }
  if (!reviewedAtIsValidDate) {
    errors.push(
      anyReviewed || overallIsClaimed
        ? 'reviewedAt: a record claiming PASS/PASS_WITH_LIMITATIONS/FAIL must carry a valid review date (missing/invalid reviewedAt = invented outcome)'
        : 'reviewedAt: required valid date string (a validated record documents a human review session; use createEmptyReview() for the unreviewed state)'
    );
  }
  if (overallIsClaimed && dimensionStatuses.length === HUMAN_REVIEW_DIMENSIONS.length && !anyReviewed) {
    errors.push('overallStatus claims a verdict but every dimension is NOT_REVIEWED — invented outcome (a real human review checks at least one dimension)');
  }
  if (!overallIsClaimed && anyReviewed && overall === 'NOT_REVIEWED') {
    errors.push('overallStatus is NOT_REVIEWED but some dimensions are reviewed — inconsistent (finish the review or reset the dimensions)');
  }

  if (errors.length > 0) return { ok: false, errors };

  // --- সফল রূপান্তর: নিরাপদ, সংকুচিত আকৃতি ---
  const cleanDims = {} as Record<DimensionKey, HumanReviewDimensionResult>;
  for (const key of HUMAN_REVIEW_DIMENSIONS) {
    const raw = (dims as Record<string, { status: unknown; note?: unknown }>)[key];
    cleanDims[key] = {
      status: raw.status as HumanReviewStatus,
      ...(typeof raw.note === 'string' && raw.note !== '' ? { note: raw.note } : {}),
    };
  }
  const record: HumanMediaReviewRecord = {
    artifactId: (rec.artifactId as string).trim(),
    ...(typeof rec.productionId === 'string' && rec.productionId.trim() !== ''
      ? { productionId: rec.productionId.trim() }
      : {}),
    reviewer: (rec.reviewer as string).trim(),
    reviewedAt: (rec.reviewedAt as string).trim(),
    dimensions: cleanDims,
    overallStatus: overall as HumanReviewStatus,
    ...(typeof rec.blockerNote === 'string' && rec.blockerNote.trim() !== ''
      ? { blockerNote: rec.blockerNote }
      : {}),
  };
  return { ok: true, record };
}

/** UI-লেবেল (বাংলা) — ৪টি অবস্থার জন্য স্থির অনুবাদ। */
export function reviewStatusLabel(status: HumanReviewStatus): string {
  switch (status) {
    case 'NOT_REVIEWED':
      return 'পর্যালোচিত হয়নি';
    case 'PASS':
      return 'উত্তীর্ণ';
    case 'PASS_WITH_LIMITATIONS':
      return 'সীমাবদ্ধতাসহ উত্তীর্ণ';
    case 'FAIL':
      return 'অনুত্তীর্ণ';
  }
}
