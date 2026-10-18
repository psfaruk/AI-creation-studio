// ============================================================
// Kaggle GPU API-রুট — শেয়ারড সাহায্যী (auth-গার্ড রেসপন্স-ম্যাপিং)।
//
// requireOwner-র নিজস্ব 401/403 প্রতিক্রিয়া রুটে সরাসরি ফেরত যায়;
// এখানে শুধু jobs-ক্লায়েন্টের ত্রুটিশ্রেণি → HTTP স্ট্যাটাস ম্যাপ হয়।
// ============================================================

import { NextResponse } from 'next/server';

import { KaggleConfigError, KaggleUpstreamError, KaggleValidationError } from './errors';

/** productions/route.ts-এর clientKey-নথির অনুলিপি (রুট-স্থানীয় রীতি) */
export function kaggleClientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return (fwd ? fwd.split(',')[0].trim() : 'local').slice(0, 60);
}

const NO_STORE = { 'Cache-Control': 'no-store' };

/** জানা ত্রুটিশ্রেণি → স্ট্যাটাস-কোডেড JSON; অজানা → সাধারণ 500 */
export function toKaggleErrorResponse(e: unknown): NextResponse {
  if (e instanceof KaggleConfigError) {
    return NextResponse.json(
      { error: e.message, code: 'kaggle_not_configured' },
      { status: 503, headers: NO_STORE },
    );
  }
  if (e instanceof KaggleUpstreamError) {
    return NextResponse.json(
      { error: e.message, code: 'kaggle_upstream_error' },
      { status: 502, headers: NO_STORE },
    );
  }
  if (e instanceof KaggleValidationError) {
    return NextResponse.json(
      { error: e.message, code: 'kaggle_invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }
  return NextResponse.json(
    { error: 'Kaggle জব-অনুরোধ প্রসেস করা যায়নি (অপ্রত্যাশিত সার্ভার-ত্রুটি)।' },
    { status: 500, headers: NO_STORE },
  );
}
