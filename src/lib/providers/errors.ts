// ============================================================
// Provider Adapter Layer — errors (Phase 1)
//
// ProviderUnavailableError — "এই পরিবেশে প্রদানকারী নেই" (যেমন:
// Railway-তে .z-ai-config অনুপস্থিত)। স্পষ্ট পার্থক্য:
//   - unsupported: ক্ষমতাটির কোনো যাচাইকৃত প্রদানকারীই নেই (গাওয়া-গান/লিপ-সিঙ্ক)
//   - unavailable (এই ক্লাস): ইমপ্লিমেন্টেশন আছে, কিন্তু এই পরিবেশে
//     প্রমাণীকরণ/নেটওয়ার্ক-পাশ খোলা নয়
//   - error: কল চেষ্টা করে ব্যর্থ হলো (retry.ts-র withRetry-এর এজায়াস)
//
// TemporarilyUnavailableError-কে extend করা হয়েছে ইচ্ছাকৃতভাবে: রেট-লিমিট-
// নিঃশেষের মতোই পাইপলাইনগুলোর সৎ-ফলব্যাক পথ (লোকাল-ফ্রেম/প্রসিডিউরাল,
// সবশেষে সৎ-ব্যর্থতা) এই ক্ষেত্রেও প্রযোজ্য — কোনো ভুয়া AI-আউটপুট নয়।
// orchestrator-এর instanceof-TemporarilyUnavailableError শাখাও এতে ধরা পড়ে।
// ============================================================

import { TemporarilyUnavailableError } from '../agent/retry';

export class ProviderUnavailableError extends TemporarilyUnavailableError {
  constructor(message: string) {
    // TUE-প্রিফিক্স (TEMPORARILY_UNAVAILABLE) + নিজস্ব মার্কার — টেক্সট-ভিত্তিক
    // isRateLimitErrorText ও instanceof-উভয় সনাক্তকরণই কাজ করবে।
    super(`PROVIDER_UNAVAILABLE: ${message}`);
    this.name = 'ProviderUnavailableError';
  }
}

/** এই ত্রুটি "প্রদানকারী-অনুপলব্ধ" শ্রেনির কি না (টেক্সট-ভিত্তিক, সীমান্ত-নিরাপদ) */
export function isProviderUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /PROVIDER_UNAVAILABLE/i.test(msg);
}
