// ============================================================
// Environment validation — Phase 1 (CI/স্টার্টআপ-যাচাই)
//
// উদ্দেশ্য: "মিসিং environment variable" ধরনের ব্যর্থতা রহস্যময়
// রানটাইম-ত্রুটি না হয়ে সাঠামোহীন, সৎ-প্রতিবেদন হোক।
// নীতি:
//  - ক্র্যাশ করা নয় — প্রতিবেদন করা (স্টার্টআপে সতর্ক-লগ, CI-টেস্টে
//    দৃঢ়-যাচাই; প্রোডাকশনে কী-ঐচ্ছিক পরিষেবা চালু রাখার সিদ্ধান্ত
//    মালিকের)।
//  - কোনো মান কখনো লগ/ফলাফলে প্রকাশ করা হয় না — শুধু উপস্থিতি/আকৃতি।
//  - Phase 3-এর ভেরিয়েবল (HF_TOKEN) সংরক্ষিত-স্লট হিসেবে তালিকাভুক্ত —
//    এখনই দাবি করা হয় না।
// ============================================================

export type EnvItemLevel = 'required' | 'recommended' | 'optional';

export interface EnvCheckItem {
  key: string;
  level: EnvItemLevel;
  /** উপস্থিত ও আকৃতি-বৈধ কি না */
  ok: boolean;
  note: string;
}

export interface EnvReport {
  /** true = NODE_ENV=production */
  production: boolean;
  items: EnvCheckItem[];
  /** সব required-আইটেম ঠিক কি না */
  ok: boolean;
}

interface EnvSpec {
  key: string;
  level: EnvItemLevel | ((production: boolean) => EnvItemLevel);
  validate: (value: string | undefined) => boolean;
  note: string;
}

const isNonEmpty = (v: string | undefined): boolean => typeof v === 'string' && v.trim().length > 0;
const isHex64 = (v: string | undefined): boolean => typeof v === 'string' && /^[0-9a-f]{64}$/i.test(v);
const isPasscode = (v: string | undefined): boolean =>
  typeof v === 'string' && v.length >= 8 && v.length <= 200;

/** যাচাইকৃত চুক্তি-তালিকা (ভোক্তা-মডিউলসহ — Phase 0 §4-এর সাথে সামঞ্জস্য) */
const SPECS: EnvSpec[] = [
  {
    key: 'DATABASE_URL',
    level: 'required',
    validate: isNonEmpty,
    note: 'Prisma datasource (SQLite: file:./db/custom.db; Phase 2-এ PostgreSQL: postgresql://…)',
  },
  {
    key: 'STUDIO_OWNER_PASSCODE',
    level: production => (production ? 'required' : 'recommended'),
    validate: isPasscode,
    note: 'পাবলিক ডিপ্লয়ে অবশ্যই আগে-থেকে বসাতে হবে — নাহলে প্রথম ভিজিটর মালিক হয়ে যেতে পারে (security.ts)',
  },
  {
    key: 'STUDIO_SESSION_SECRET',
    level: production => (production ? 'recommended' : 'optional'),
    validate: v => typeof v === 'string' && v.length >= 32,
    note: 'রিডিপ্লয়-জীবিত সেশনের চাবি (৬৪-হেক্স সুপারিশ; না দিলে এফেমেরাল ফাইল-চাবি — প্রতি রিডিপ্লয়ে লগ-আউট)। Phase 1-এ যুক্ত',
  },
  {
    key: 'ZAI_API_KEY',
    level: 'optional',
    validate: isNonEmpty,
    note: 'ঐচ্ছিক external GLM চ্যাট-প্রদানকারী (api.z.ai) — external-llm.ts; UI-সেভ কী প্রাধান্য পায়',
  },
  {
    key: 'GLM_API_KEY',
    level: 'optional',
    validate: isNonEmpty,
    note: 'ঐচ্ছিক external GLM চ্যাট-প্রদানকারী (open.bigmodel.cn) — external-llm.ts',
  },
  {
    key: 'TTS_CACHE_DIR',
    level: 'optional',
    validate: isNonEmpty,
    note: 'টেস্ট-বিচ্ছিন্নতার জন্য TTS-ক্যাশ পথ-ওভাররাইড (tts-cache.ts)',
  },
  {
    key: 'VOICE_VERIFICATION_FILE',
    level: 'optional',
    validate: isNonEmpty,
    note: 'Edge-TTS স্বাস্থ্য-যাচাই-রেকর্ডের পথ-ওভাররাইড (edge_tts.ts)',
  },
  {
    key: 'HF_TOKEN',
    level: 'optional',
    validate: isNonEmpty,
    note: 'সংরক্ষিত (Phase 3) — Hugging Face Inference Providers-এর সার্ভার-সাইড টোকন; যুক্ত হওয়ার আগে কোনো কোড এটি পড়ে না',
  },
];

/**
 * পরিবেশ-যাচাই প্রতিবেদন। required-বাদে কিছুই ক্র্যাশ করায় না —
 * সত্যটাই ফেরত দেয় (instrumentation স্টার্টআপে সতর্ক-লগ করে,
 * t29-টেস্ট দৃঢ়-যাচাই করে)।
 */
export function validateEnv(nodeEnv: string | undefined = process.env.NODE_ENV): EnvReport {
  const production = nodeEnv === 'production';
  const items: EnvCheckItem[] = SPECS.map(spec => {
    const level = typeof spec.level === 'function' ? spec.level(production) : spec.level;
    const value = process.env[spec.key];
    return {
      key: spec.key,
      level,
      ok: spec.validate(value),
      note: spec.note,
    };
  });
  return {
    production,
    items,
    ok: items.every(i => i.level !== 'required' || i.ok),
  };
}

/** স্টার্টআপ-লগের জন্য সংক্ষিপ্ত সতর্ক-সারি (মান প্রকাশ ছাড়াই) */
export function envStartupWarnings(report: EnvReport): string[] {
  return report.items
    .filter(i => !i.ok && (i.level === 'required' || (report.production && i.level === 'recommended')))
    .map(i => `[env] ${i.level === 'required' ? 'অনুপস্থিত/অবৈধ (আবশ্যক)' : 'অনুপস্থিত (প্রোডাকশনে সুপারিশকৃত)'}: ${i.key} — ${i.note}`);
}
