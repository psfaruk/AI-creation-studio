// ============================================================
// Lip-Sync Module — নতুন মাস্টার প্ল্যান §৫ + §৮ (Sprint-2)
//
// সৎ অবস্থা-ঘোষণা — ৪-মাত্রিক বাধা-ভাঙন (প্রতিটি মাত্রা আলাদা সত্য):
//  - লাইসেন্স: needs_review — Wav2Lip-এর ওয়েট একাডেমিক-কেবল শর্তে
//    (non-commercial research); SadTalker/MuseTalk-এর শর্ত আলাদা
//  - প্রোভাইডার: not_exposed_by_sdk — SDK-তে (v0.0.18) লিপ-সিঙ্ক API নেই
//  - হার্ডওয়্যার: unavailable_hardware — ৪–১২GB VRAM দরকার, GPU নেই
//  - ইন্টিগ্রেশন: not_integrated — কোনো অ্যাডাপ্টার নেই
//  - বেঞ্চমার্ক: not_done — বাংলা সংলাপে বেঞ্চমার্ক হয়নি
//  - গান গাওয়ার লিপ-সিঙ্কের জন্য আলাদা বেঞ্চমার্ক বাধ্যতামূলক
//
// অতএব:
//  - কথা বলার লিপ-সিঙ্ক: অবরুদ্ধ (unavailable)
//  - গান গাওয়ার লিপ-সিঙ্ক: অবরুদ্ধ — কথার লিপ-সিঙ্ক চালু হলেও
//    গানের জন্য আলাদা বেঞ্চমার্ক লাগবে (মুখের নড়াচড়া আলাদা)
//  - লিপ-সিঙ্ক ছাড়া কখনো "চরিত্রের মুখ নড়ছে/গায়ক গাইছে" দাবি করা
//    হয় না (মাস্টার প্ল্যানের নিয়ম)
//
// অবস্থা-হালনাগাদ (LF-4-R, ২০২৬-১০-১৭ ওয়েব-গবেষণা — প্রতিটি দাবির প্রমাণ-লিংক
// docs/audit/latest-fix/lipsync-provider-research.md):
//  - লাইসেন্স-মাত্রা আংশিক বদলেছে: Wav2Lip-এর একাডেমিক-কেবল শর্ত এখনও
//    সঠিক; তবে MuseTalk 1.5 এখন MIT (ওজন-সহ বাণিজ্যিক-অনুমোদিত) এবং
//    SadTalker Apache-2.0 — লাইসেন্স আর প্রধান বাধা নয়; প্রোভাইডার-
//    প্রমাণীকরণ (key) ও GPU-ই প্রকৃত বাধা।
//  - প্রোভাইডার-মাত্রা অপরিবর্তিত: SDK v0.0.18-এ লিপ-সিঙ্ক API নেই;
//    যাবতীয় হোস্টেড API (sync.so/HeyGen/Replicate/fal/D-ID/Hedra)
//    অ্যাকাউন্ট+key+পেমেন্ট চায় — এই পরিবেশে BLOCKED।
//  - হার্ডওয়্যার-মাত্রা অপরিবর্তিত: সব বর্তমান মডেল CUDA GPU চায়
//    (MuseTalk সর্বনিম্ন ৪GB VRAM); এই sandbox-এ GPU নেই।
//  - ইন্টিগ্রেশন-মাত্রা অপরিবর্তিত: কোনো অ্যাডাপ্টার নেই।
//
// মডিউলটি সম্পূর্ণ ওয়ার্কফ্লো-স্থাপত্য বহন করে — মডেল যুক্ত হলে
// ধাপগুলোই বাস্তবায়িত হবে।
// ============================================================

export const LIP_SYNC_STATUS = {
  available: false,
  talkingStatus: 'unavailable' as const,
  singingStatus: 'unavailable' as const,
  candidate: 'MuseTalk',
  candidateUrl: 'https://github.com/TMElyralab/MuseTalk',
  reason:
    'এই সার্ভারে কোনো লিপ-সিঙ্ক মডেল সংযোজিত নয় এবং GPU-ও নেই (২ CPU কোর, GPU-বিহীন); SDK-তেও লিপ-সিঙ্ক API নেই। (LF-4-R হালনাগাদ: MuseTalk 1.5/SadTalker-এর লাইসেন্স এখন বাণিজ্যিক-মৈত্রীপূর্ণ হলেও প্রোভাইডার-key ও GPU-বাধা বহাল।) মডেল সংযোজন, লাইসেন্স-যাচাই ও বাংলা-সংলাপে বেঞ্চমার্কের আগে এই ফিচার "অবরুদ্ধ" থাকবে।',
  // §৮ ৪-মাত্রিক বাধা-ভাঙন (Sprint-2) — প্রতিটি মাত্রার সৎ রায়
  // (LF-4-R: license-মাত্রার ব্যাখ্যা হালনাগাদকৃত — নিচের notes দেখুন):
  license: 'needs_review' as const,
  provider: 'not_exposed_by_sdk' as const,
  hardware: 'unavailable_hardware' as const,
  integration: 'not_integrated' as const,
  benchmark: 'not_done' as const,
};

/** §৮: প্রতিটি বাধা-মাত্রার ব্যাখ্যা (UI/রেজিস্ট্রি/ম্যাট্রিক্সে ব্যবহৃত) */
export const LIP_SYNC_BLOCKAGE_NOTES = {
  license:
    'LF-4-R (২০২৬-১০-১৭ হালনাগাদ): Wav2Lip-এর ওয়েট একাডেমিক-কেবল (নন-কমার্শিয়াল — পুনঃনিশ্চিত); কিন্তু MuseTalk 1.5 এখন MIT (ওজন-সহ বাণিজ্যিক-অনুমোদিত) ও SadTalker Apache-2.0 — প্রার্থীভেদে লাইসেন্স আর ব্লকার নয়। প্রকৃত ব্লকার: হোস্টেড API-গুলোর সবই key+পেমেন্ট চায় (এই পরিবেশে অনুমোদিত credential নেই) এবং স্ব-হোস্টিংয়ের জন্য GPU দরকার — প্রমাণ: docs/audit/latest-fix/lipsync-provider-research.md।',
  provider:
    'z-ai-web-dev-sdk-তে (v0.0.18) কোনো লিপ-সিঙ্ক API নেই — প্রকাশিত ১০টি মেথডের কোনোটিই লিপ-সিঙ্ক নয় (not_exposed_by_sdk)।',
  hardware:
    'লিপ-সিঙ্ক মডেলগুলোর (Wav2Lip/SadTalker/MuseTalk) জন্য আনুমানিক ৪–১২GB VRAM দরকার — এই পরিবেশে GPU নেই, ২টি CPU কোর (unavailable_hardware)।',
  integration: 'কোনো লিপ-সিঙ্ক অ্যাডাপ্টার/র‍্যাপার এই প্রজেক্টে সংযোজিত হয়নি (not_integrated)।',
  benchmark:
    'বাংলা সংলাপে লিপ-সিঙ্ক বেঞ্চমার্ক হয়নি; গান গাওয়ার মুখ-নড়াচড়ার জন্য কথার লিপ-সিঙ্ক সফল হলেও আলাদা বেঞ্চমার্ক বাধ্যতামূলক (not_done)।',
};

/** §৮: বাধার ৪+১ মাত্রা — টাইপড কাঠামো */
export interface LipSyncBlockageDimensions {
  license: 'needs_review';
  provider: 'not_exposed_by_sdk';
  hardware: 'unavailable_hardware';
  integration: 'not_integrated';
  benchmark: 'not_done';
  notes: typeof LIP_SYNC_BLOCKAGE_NOTES;
}

export interface LipSyncJobSpec {
  /** চরিত্রের রেফারেন্স পোর্ট্রেট/ভিডিও (artifact আইডি) */
  characterImageArtifactId: string;
  /** সংলাপের অডিও (artifact আইডি) — সঠিক ভাষার TTS থেকে আসা */
  dialogueAudioArtifactId: string;
  language: string;
  /** গান গাওয়ার ক্ষেত্রে আলাদা প্রক্রিয়া */
  isSinging: boolean;
}

/** §৫.১ — কথা বলার লিপ-সিঙ্কের পরিকল্পিত ৭ ধাপ (মডেল যুক্ত হলে) */
export const TALKING_LIP_SYNC_STEPS: string[] = [
  '১. চরিত্রের রেফারেন্স পোর্ট্রেট/ভিডিও নির্বাচন',
  '২. চরিত্রের সংলাপ প্রস্তুত',
  '৩. সঠিক ভাষায় TTS অডিও তৈরি (ভাষা-নিয়ন্ত্রক দিয়ে যাচাইকৃত)',
  '৪. মুখ ও ঠোঁটের অঞ্চল শনাক্তকরণ',
  '৫. লিপ-সিঙ্ক মডেল দিয়ে সংলাপের সাথে মুখের নড়াচড়া তৈরি',
  '৬. মূল চরিত্রের মুখ ও পরিচয় অক্ষুণ্ণ আছে কি না পরীক্ষা',
  '৭. অডিও-ভিডিও টাইমিং যাচাই',
];

/** §৫.২ — গান গাওয়ার লিপ-সিঙ্কের অতিরিক্ত প্রয়োজনীয়তা */
export const SINGING_LIP_SYNC_EXTRA: string[] = [
  'সম্পূর্ণ গানের vocal ট্র্যাক',
  'vocal-এর টাইমিং ও প্রয়োজনে syllable/phoneme অ্যালাইনমেন্ট',
  'শিল্পীর মুখের রেফারেন্স',
  'দীর্ঘ ক্লিপে মুখ ও চরিত্রের পরিচয়ের ধারাবাহিকতা',
  'ফলাফলের প্রিভিউ ও সিঙ্ক-পরীক্ষা',
  'নোট: কথার লিপ-সিঙ্ক সফল হলেও গানের মুখের নড়াচড়া আলাদা — পৃথক বেঞ্চমার্ক বাধ্যতামূলক',
];

/** §৫.২ — সম্মতি ও অনুমতির নিয়ম */
export const CONSENT_RULES: string[] = [
  'বাস্তব গায়ক-গায়িকা বা ব্যক্তির মুখ/কণ্ঠ ব্যবহারে অবশ্যই সেই ব্যক্তির অনুমতি থাকতে হবে।',
  'ব্যবহারকারীর অনুমতি ছাড়া বাস্তব ব্যক্তির কণ্ঠ বা চেহারা নকল করার কোনো workflow চালু করা যাবে না।',
  'AI-নির্মিত কাল্পনিক চরিত্রের ক্ষেত্রেও ফলাফলে "AI-নির্মিত" লেবেল থাকবে।',
];

export interface LipSyncCapabilityReport {
  available: false;
  talking: { status: 'unavailable'; steps: string[] };
  singing: { status: 'unavailable'; steps: string[]; extra: string[] };
  consentRules: string[];
  reason: string;
  candidate: { name: string; url: string; note: string };
  /** §৮ (Sprint-2): ৪-মাত্রিক বাধা-ভাঙন + বেঞ্চমার্ক-স্ট্যাটাস */
  blockageDimensions: LipSyncBlockageDimensions;
}

/** §৮: ৪-মাত্রিক বাধা-ভাঙন — একই কাঠামো রেজিস্ট্রি/ম্যাট্রিক্সেও ব্যবহারযোগ্য */
export function lipSyncBlockageDimensions(): LipSyncBlockageDimensions {
  return {
    license: LIP_SYNC_STATUS.license,
    provider: LIP_SYNC_STATUS.provider,
    hardware: LIP_SYNC_STATUS.hardware,
    integration: LIP_SYNC_STATUS.integration,
    benchmark: LIP_SYNC_STATUS.benchmark,
    notes: LIP_SYNC_BLOCKAGE_NOTES,
  };
}

/** সম্পূর্ণ সৎ-ক্ষমতা প্রতিবেদন (টুল ফলাফল ও UI-তে) */
export function lipSyncCapabilityReport(): LipSyncCapabilityReport {
  return {
    available: false,
    talking: { status: 'unavailable', steps: TALKING_LIP_SYNC_STEPS },
    singing: { status: 'unavailable', steps: TALKING_LIP_SYNC_STEPS, extra: SINGING_LIP_SYNC_EXTRA },
    consentRules: CONSENT_RULES,
    reason: LIP_SYNC_STATUS.reason,
    candidate: {
      name: LIP_SYNC_STATUS.candidate,
      url: LIP_SYNC_STATUS.candidateUrl,
      note: 'ভাষা-সমর্থন, মডেল ও ডিপেন্ডেন্সির লাইসেন্স এবং বাংলা সংলাপের ফলাফল আলাদাভাবে পরীক্ষা করা হয়নি — প্রকল্পের লাইসেন্স দেখেই ডিপেন্ডেন্সিকে অনুমোদিত ধরা যাবে না।',
    },
    blockageDimensions: lipSyncBlockageDimensions(),
  };
}

// ------------------------------------------------------------
// §৫/§৮ — LipSyncProvider: প্রোভাইডার-নিরপেক্ষ চুক্তি + সৎ-অসমর্থিত
// অ্যাডাপ্টার (D-5/B5)। আজ একমাত্র নিবন্ধিত প্রোভাইডার = অসমর্থিত;
// ভবিষ্যতের প্রকৃত অ্যাডাপ্টারও এই একই চুক্তিতে বসবে — মিথ্যা
// সফলতা/বানানো সংখ্যা চুক্তিতেই নিষিদ্ধ।
// ------------------------------------------------------------

/** লিপ-সিঙ্ক ত্রুটির টাইপড কোড */
export type LipSyncErrorCode = 'LIPSYNC_UNSUPPORTED' | 'LIPSYNC_ALIGNMENT_FAILED' | 'LIPSYNC_INVALID_INPUT';

/** টাইপড লিপ-সিঙ্ক-ত্রুটি (কোডসহ — অস্পষ্ট ব্যর্থতা/মিথ্যা সফলতা নয়) */
export class LipSyncProviderError extends Error {
  readonly code: LipSyncErrorCode;
  constructor(code: LipSyncErrorCode, message: string) {
    super(message);
    this.name = 'LipSyncProviderError';
    this.code = code;
  }
}

/**
 * খরচ/লেটেন্সির সৎ অনুমান — অজানা হলে সংখ্যা বানানো হয় না।
 * (অসমর্থিত প্রোভাইডারের জন্য দুটিই সবসময় false — ডোমেইনে কোনো
 * সংখ্যাসূচক ক্ষেত্রই নেই।)
 */
export interface LipSyncEstimate {
  costKnown: false;
  latencyKnown: false;
  note: string;
}

/** প্রক্রিয়াকরণের বাইট-ইনপুট — প্রকৃত অডিও-বাইট ছাড়া কোনো প্রোভাইডার
 *  সফলতা দাবি করতে পারে না (artifact-আইডি মানেই "অডিও শোনা" নয়)। */
export interface LipSyncProcessOptions {
  /** সংলাপ-অডিওর প্রকৃত বাইট (artifact-লোডার থেকে লোড করা) */
  audioBuffer?: Buffer;
}

/** লিপ-সিঙ্কের সৎ ফল — সফল হলে provenance-লেবেলসহ মিডিয়া-বাইট;
 *  অন্যথা সৎ কারণ (mediaBuffer কখনোই অনুপস্থিত-সাফল্যে থাকে না)। */
export type LipSyncOutput =
  | { processed: true; provenance: string; mediaBuffer: Buffer }
  | { processed: false; reason: string; mediaBuffer?: never };

/**
 * প্রোভাইডার-নিরপেক্ষ লিপ-সিঙ্ক চুক্তি। আজ একমাত্র বাস্তবায়ন
 * অসমর্থিত-অ্যাডাপ্টার; প্রতিটি মেথড সৎ উত্তর দিতে বাধ্য।
 */
export interface LipSyncProvider {
  /** অ্যাডাপ্টারের স্থিতিশীল আইডি (যেমন 'unsupported'; ভবিষ্যতে 'musetalk' ইত্যাদি) */
  readonly id: string;
  /** সৎ ক্ষমতা-প্রতিবেদন — রাউটার/ম্যাট্রিক্স/টুল সব এখান থেকেই পড়ে */
  getCapabilities(): LipSyncCapabilityReport;
  /** স্ট্রাকচারাল যাচাই — প্রকৃত সক্ষমতার দাবি নয়, প্রকৃত সমস্যাগুলোই রিপোর্ট */
  validateInput(spec: LipSyncJobSpec): { ok: true } | { ok: false; reason: string };
  /** খরচ/লেটেন্সির সৎ অনুমান — অজানা হলে costKnown:false, latencyKnown:false */
  estimateCostAndLatency(spec: LipSyncJobSpec): LipSyncEstimate;
  /** প্রকৃত প্রক্রিয়াকরণ — অডিও-বাইট ভোগ না করে সফলতা দেওয়া নিষিদ্ধ */
  process(spec: LipSyncJobSpec, opts?: LipSyncProcessOptions): Promise<LipSyncOutput>;
  /** (ঐচ্ছিক) চাকরির অবস্থা */
  getJobStatus?(jobId: string): Promise<{ status: 'unsupported' }>;
  /** (ঐচ্ছিক) বাতিল — অসমর্থিত প্রোভাইডারে বাতিল-করার চাকরিই নেই */
  cancel?(jobId: string): Promise<{ cancelled: false; reason: string }>;
  /** আউটপুট-যাচাই — অসমর্থিত প্রোভাইডার যাচাইও করতে পারে না */
  validateOutput(buffer: Buffer): Promise<{ ok: false; reason: string }>;
}

/** §৮ ৪-মাত্রিক বাধার সৎ বার্তা — runLipSync ও অসমর্থিত অ্যাডাপ্টারের
 *  একমাত্র উৎস (বার্তার অক্ষর পরিবর্তন নিষিদ্ধ — LLM/টেস্ট চুক্তি)। */
function lipSyncBlockageMessage(): string {
  const report = lipSyncCapabilityReport();
  const b = report.blockageDimensions;
  return `লিপ-সিঙ্ক এখন অবরুদ্ধ — ৪টি মাত্রাতেই বাধা: (১) লাইসেন্স ${b.license} (Wav2Lip একাডেমিক-কেবল, SadTalker/MuseTalk শর্ত আলাদা); (২) প্রোভাইডার ${b.provider} (SDK-তে লিপ-সিঙ্ক API নেই); (৩) হার্ডওয়্যার ${b.hardware} (৪–১২GB VRAM দরকার, GPU নেই); (৪) ইন্টিগ্রেশন ${b.integration} (অ্যাডাপ্টার নেই; বাংলা-বেঞ্চমার্কও ${b.benchmark})। বিকল্প: সংলাপের অডিও (TTS) + AI-জেনারেটেড দৃশ্য আলাদাভাবে তৈরি করা যায় — মুখের নড়াচড়ার দাবি করা হয় না।`;
}

/**
 * একমাত্র নিবন্ধিত প্রোভাইডার — সৎ-অসমর্থিত। প্রতিটি মেথড সত্য বলে:
 * ক্ষমতা নেই, খরচ/লেটেন্সি অজানা, প্রক্রিয়াকরণ সম্ভব নয়, বাতিল/যাচাইও নয়।
 */
export const unsupportedLipSyncProvider: LipSyncProvider = {
  id: 'unsupported',
  getCapabilities: () => lipSyncCapabilityReport(),
  validateInput: spec => {
    if (!spec || typeof spec !== 'object') {
      return { ok: false, reason: 'LipSyncJobSpec অনুপস্থিত' };
    }
    const problems: string[] = [];
    if (!spec.characterImageArtifactId) problems.push('characterImageArtifactId অনুপস্থিত/খালি');
    if (!spec.dialogueAudioArtifactId) problems.push('dialogueAudioArtifactId অনুপস্থিত/খালি');
    if (!spec.language) problems.push('language অনুপস্থিত/খালি');
    return problems.length > 0 ? { ok: false, reason: problems.join('; ') } : { ok: true };
  },
  estimateCostAndLatency: () => ({
    costKnown: false,
    latencyKnown: false,
    note: 'কোনো লিপ-সিঙ্ক প্রোভাইডার সংযোজিত নয় — খরচ ও লেটেন্সির প্রকৃত সংখ্যা জানা নেই; বানানো সংখ্যা দেওয়া হয় না।',
  }),
  process: async () => {
    throw new LipSyncProviderError('LIPSYNC_UNSUPPORTED', lipSyncBlockageMessage());
  },
  cancel: async () => ({
    cancelled: false,
    reason: 'কোনো লিপ-সিঙ্ক প্রোভাইডার নেই — বাতিল-করার চাকরিও নেই।',
  }),
  validateOutput: async () => ({
    ok: false,
    reason: 'কোনো লিপ-সিঙ্ক প্রোভাইডার নেই — আউটপুট যাচাইয়ের ক্ষমতাও নেই।',
  }),
};

/** সক্রিয় লিপ-সিঙ্ক প্রোভাইডারের একমাত্র সত্যের উৎস — আজ অসমর্থিত;
 *  রাউটার/ম্যাট্রিক্স/টুল সব এখান থেকেই পড়ে (স্টেল-হার্ডকোড নয়)। */
export function activeLipSyncProvider(): LipSyncProvider {
  return unsupportedLipSyncProvider;
}

/**
 * লিপ-সিঙ্ক চালানোর প্রস্তাব এলে সৎ ব্যর্থতা — মিথ্যা সফলতা নয়।
 * বার্তায় ৪-মাত্রিক বাধা + বিকল্প স্পষ্ট থাকে। পাতলা মোড়ক —
 * বার্তার উৎস এখন unsupportedLipSyncProvider.process (অক্ষর অপরিবর্তিত)।
 */
export async function runLipSync(_spec: LipSyncJobSpec): Promise<never> {
  await unsupportedLipSyncProvider.process(_spec);
  throw new Error('unreachable: অসমর্থিত লিপ-সিঙ্ক প্রোভাইডার সবসময়ই ছুড়ে দেয়');
}
