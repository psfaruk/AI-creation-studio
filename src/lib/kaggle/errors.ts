// ============================================================
// Kaggle GPU মিউজিক-কর্মী — error types।
//
// নীতি (repo-convention):
//  - প্রতিটি ত্রুটি-বার্তা স্যানিটাইজড — কোনো কী/টোকেন/
//    হেডার-মান কখনো বার্তায় ঢোকে না; শুধু অনুপস্থিত
//    ভেরিয়েবলের *নাম* বলা হয়।
//  - রুট-লেয়ার (route-helpers.ts) এই শ্রেণিগুলো instanceof দিয়ে
//    চিনে HTTP স্ট্যাটাস ম্যাপ করে।
// ============================================================

/** সার্ভারে SUPABASE_URL / SUPABASE_KEY সেট নেই — ফিচারটি বন্ধ (503) */
export class KaggleConfigError extends Error {
  readonly code = 'kaggle_not_configured' as const;

  constructor(message: string) {
    super(message);
    this.name = 'KaggleConfigError';
  }
}

/** Supabase REST/Storage আপস্ট্রিম-ত্রুটি (502/504) — বার্তা স্যানিটাইজড */
export class KaggleUpstreamError extends Error {
  readonly code = 'kaggle_upstream_error' as const;
  /** আপস্ট্রিম HTTP স্ট্যাটাস (timeout-হেতু সংযোগ না হলে 504) */
  readonly upstreamStatus: number;

  constructor(message: string, upstreamStatus: number) {
    super(message);
    this.name = 'KaggleUpstreamError';
    this.upstreamStatus = upstreamStatus;
  }
}

/** ক্লায়েন্ট-ইনপুট যাচাই-ব্যর্থতা (400) — যেমন অবৈধ UUID */
export class KaggleValidationError extends Error {
  readonly code = 'kaggle_invalid_input' as const;

  constructor(message: string) {
    super(message);
    this.name = 'KaggleValidationError';
  }
}
