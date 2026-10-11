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
    'এই সার্ভারে কোনো লিপ-সিঙ্ক মডেল সংযোজিত নয় এবং GPU-ও নেই (২ CPU কোর, GPU-বিহীন); SDK-তেও লিপ-সিঙ্ক API নেই। মডেল সংযোজন, লাইসেন্স-যাচাই ও বাংলা-সংলাপে বেঞ্চমার্কের আগে এই ফিচার "অবরুদ্ধ" থাকবে।',
  // §৮ ৪-মাত্রিক বাধা-ভাঙন (Sprint-2) — প্রতিটি মাত্রার সৎ রায়:
  license: 'needs_review' as const,
  provider: 'not_exposed_by_sdk' as const,
  hardware: 'unavailable_hardware' as const,
  integration: 'not_integrated' as const,
  benchmark: 'not_done' as const,
};

/** §৮: প্রতিটি বাধা-মাত্রার ব্যাখ্যা (UI/রেজিস্ট্রি/ম্যাট্রিক্সে ব্যবহৃত) */
export const LIP_SYNC_BLOCKAGE_NOTES = {
  license:
    'Wav2Lip-এর ওয়েট একাডেমিক-কেবল শর্তে (non-commercial research); SadTalker/MuseTalk-এর লাইসেন্স আলাদা — ব্যবহারের আগে প্রতিটির শর্ত আলাদাভাবে যাচাই বাধ্যতামূলক (needs_review)।',
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

/**
 * লিপ-সিঙ্ক চালানোর প্রস্তাব এলে সৎ ব্যর্থতা — মিথ্যা সফলতা নয়।
 * বার্তায় ৪-মাত্রিক বাধা + বিকল্প স্পষ্ট থাকে।
 * মডেল-সংযোগের পর এই ফাংশনই প্রকৃত পাইপলাইনে রূপান্তরিত হবে।
 */
export async function runLipSync(_spec: LipSyncJobSpec): Promise<never> {
  const report = lipSyncCapabilityReport();
  const b = report.blockageDimensions;
  throw new Error(
    `লিপ-সিঙ্ক এখন অবরুদ্ধ — ৪টি মাত্রাতেই বাধা: (১) লাইসেন্স ${b.license} (Wav2Lip একাডেমিক-কেবল, SadTalker/MuseTalk শর্ত আলাদা); (২) প্রোভাইডার ${b.provider} (SDK-তে লিপ-সিঙ্ক API নেই); (৩) হার্ডওয়্যার ${b.hardware} (৪–১২GB VRAM দরকার, GPU নেই); (৪) ইন্টিগ্রেশন ${b.integration} (অ্যাডাপ্টার নেই; বাংলা-বেঞ্চমার্কও ${b.benchmark})। বিকল্প: সংলাপের অডিও (TTS) + AI-জেনারেটেড দৃশ্য আলাদাভাবে তৈরি করা যায় — মুখের নড়াচড়ার দাবি করা হয় না।`
  );
}
