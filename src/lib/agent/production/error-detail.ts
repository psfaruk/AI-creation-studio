// ============================================================
// (PART G) ব্যর্থ প্রোডাকশনের কাঠামোগত ত্রুটি-বিবরণ —
// resultJson.errorDetail ব্লকের একমাত্র উৎস।
//
// সততা-চুক্তি:
//  - বিদ্যমান সাধারণ `error` স্ট্রিং (runner failProduction :606) অপরিবর্তিত
//    থাকে — errorDetail যোগাত্মক, পেছনের-সামঞ্জস্যপূর্ণ।
//  - যা জানা নেই → null/অনুপস্থিত; কখনো বানানো হয় না।
//  - শ্রেণি-ট্যাক্সোনমি RunErrorCategory-র (orchestrator categorizeError-এর
//    আয়না — নিচের মন্তব্য দেখুন)।
// ============================================================

import type { RunErrorCategory } from '@/lib/types';
import type { ProductionErrorDetail } from '@/lib/types';
import { isRateLimitErrorText } from '../retry';

/**
 * orchestrator.ts-এর categorizeError-এর সচেতন আয়না। আমদানি করা হয়নি
 * কারণ রানার থেকে orchestrator-আমদানি পুরো চ্যাট-গ্রাফ (llm/registry/
 * intent/create → language_controller) প্রোডাকশন-রানারে টেনে আনে —
 * ভারী ও ভঙ্গুর যুগ্ম-সংযোগ। ড্রিফট-ঝুঁকি এর বদলে REG-23-এর সমতা-
 * পরীক্ষায় আটকে: এই আয়না প্রকৃত categorizeError-এর বিরুদ্ধে একই
 * কর্পাসে লক করা।
 *
 * ক্রম গুরুত্বপূর্ণ (orchestrator-এর মতোই): কী → রেট-লিমিট → মডেল →
 * টাইমআউট → ffmpeg → স্টোরেজ → ৫xx → অজানা।
 */
export function classifyProductionError(err: unknown): RunErrorCategory {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const s = msg.toLowerCase();
  const status = (err as { status?: unknown } | null)?.status;
  const statusNum = typeof status === 'number' ? status : undefined;

  if (/কী যোগ করা হয়নি|api key পাওয়া যায়নি|missing.+key|no api key|কী-বিহীন/i.test(msg)) {
    return 'missing_key';
  }
  if (
    statusNum === 401 ||
    statusNum === 403 ||
    /কী অবৈধ|invalid api key|unauthorized|forbidden|permission/i.test(s)
  ) {
    return 'invalid_key';
  }
  if (isRateLimitErrorText(msg)) return 'rate_limited';
  if (
    /মডেল-আইডি|মডেলটি আর তালিকায় নেই|model.{0,24}(not found|not exist|does not exist)|invalid model|model_not_found/i.test(
      msg
    )
  ) {
    return 'invalid_model';
  }
  if (/etimedout|timed? ?out|timeout|aborterror|abort was|সময়শেষ|টাইমআউট|টুল টাইমআউট/i.test(s)) {
    return 'timeout';
  }
  if (/ffmpeg|ffprobe/i.test(s)) return 'ffmpeg_error';
  if (/enoent|eacces|eperm|enospc|eisdir|disk quota|readonly database|স্টোরেজ|storage path/i.test(s)) {
    return 'storage_error';
  }
  if (
    (statusNum != null && statusNum >= 500) ||
    /\b5\d{2}\b|সার্ভার-ত্রুটি|internal server|bad gateway|service unavailable/i.test(s)
  ) {
    return 'provider_error';
  }
  return 'unknown';
}

/**
 * পুনঃচেষ্টা সমীচ্ছা কি না — TemporarilyUnavailableError-শ্রেণির সাময়িক
 * ত্রুটি (রেট-লিমিট/টাইমআউট/প্রোভাইডার-৫xx) হলে true। বাকি সব (ভুল কী,
 * মডেল, স্টোরেজ, অজানা) নির্ণায়ক/স্থায়ী — প্রমাণ না থাকায় রক্ষণশীল false।
 */
export function retryAppropriateForCategory(category: RunErrorCategory): boolean {
  return category === 'rate_limited' || category === 'timeout' || category === 'provider_error';
}

/** শ্রেণি অনুযায়ী ১–৩টি কার্যকর বাংলা পরবর্তী-পদক্ষেপ (ক্রিয়াযোগ্য পরামর্শ —
 *  কোনো কাল্পনিক কারণ-ব্যাখ্যা নয়)। */
const NEXT_STEPS_BY_CATEGORY: Readonly<Record<RunErrorCategory, string[]>> = {
  rate_limited: ['সাময়িক ত্রুটি (রেট-লিমিট) — কিছুক্ষণ পরে আবার চালান'],
  provider_error: ['সাময়িক ত্রুটি — আবার চালান', 'বারবার হলে সেটিংস কমিয়ে চেষ্টা করুন'],
  timeout: ['সাময়িক ত্রুটি — আবার চালান', 'বারবার হলে সেটিংস কমিয়ে (কম দৈর্ঘ্য/কম শট) চেষ্টা করুন'],
  invalid_key: ['সেটিংস → প্রোভাইডার কী পরীক্ষা করুন — অবৈধ কী ঠিক করুন'],
  missing_key: ['সেটিংস → প্রোভাইডার কী যোগ করুন'],
  invalid_model: ['সেটিংসে ভিন্ন মডেল নির্বাচন করুন'],
  malformed_tool_json: ['আবার চালান', 'বারবার হলে অনুরোধ সহজ করুন'],
  unknown_tool: ['অনুরোধ সহজ করে আবার চালান'],
  tool_error: ['আবার চালান', 'বারবার হলে সেটিংস কমিয়ে চেষ্টা করুন'],
  ffmpeg_error: ['আবার চালান', 'বারবার হলে কম দৈর্ঘ্য/কম রেজোলিউশনে চেষ্টা করুন'],
  storage_error: ['ডিস্ক-স্পেস ও স্টোরেজ অনুমতি পরীক্ষা করুন', 'তারপর আবার চালান'],
  max_steps: ['অনুরোধ ছোট করে আবার চালান'],
  aborted: ['আবার চালান'],
  unknown: ['আবার চালান', 'বারবার হলে সেটিংস কমিয়ে চেষ্টা করুন'],
};

export interface ProductionErrorDetailInput {
  /** মূল ত্রুটি (Error বা বার্তা-স্ট্রিং) — শ্রেণি-নির্ণয়ের ভিত্তি */
  error: unknown;
  /** যে ধাপ-কীতে ব্যর্থ — জানা না থাকলে null (কাল্পনিক নয়) */
  operation: string | null;
  /** ডিগ্রেডেড/ফলব্যাক পথ চালানো হয়েছিল কি না (partialNotes অ-খালি কি না) */
  fallbackAttempted: boolean;
  /** ফলব্যাক-ফলাফলের সৎ সারাংশ — না থাকলে null */
  fallbackResult: string | null;
  /** এই রানে সংরক্ষিত artifact-আইডিগুলো */
  retainedArtifactIds: string[];
}

/**
 * resultJson.errorDetail ব্লক বানাও। সব ক্ষেত্র সৎ: অজানা → null/অনুপস্থিত;
 * শ্রেণি-ট্যাক্সোনমি সবসময় সৎ মান ('unknown'-ও একটি সৎ রায় — "চেনা যায়নি")।
 * retainedArtifactIds/nextSteps সীমিত (স্টোরেজ-প্রশস্তি রোধ)।
 */
export function buildProductionErrorDetail(input: ProductionErrorDetailInput): ProductionErrorDetail {
  const category = classifyProductionError(input.error);
  return {
    operation: input.operation ?? null,
    category,
    retryAppropriate: retryAppropriateForCategory(category),
    fallbackAttempted: input.fallbackAttempted === true,
    fallbackResult: input.fallbackResult ? input.fallbackResult.slice(0, 400) : null,
    retainedArtifactIds: input.retainedArtifactIds.slice(0, 50),
    nextSteps: NEXT_STEPS_BY_CATEGORY[category].slice(0, 3),
  };
}
