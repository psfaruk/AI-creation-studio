// ============================================================
// চ্যাট-মডেল ক্যাটালগ — composer-এর মডেল-সিলেক্টরের উৎস।
//
// সততার নিয়ম (মাস্টার-প্ল্যান):
//  - এই তালিকায় থাকা = "কাজ করে" নয়; প্রকৃত প্রাপ্যতা শুধু
//    রানটাইম যাচাইয়ের (POST /api/models) ফলাফল থেকে আসে।
//  - যাচাই-স্ট্যাটাস ডিস্কে ক্যাশ হয় (storage/model-verification.json)
//    — 429 (রেট-লিমিট) হলে "অনুপলব্ধ" নয়, "অযাচাই" দেখানো হয়।
//  - ব্যবহারকারী অযাচাই/ব্যর্থ মডেল বেছে নিলে চ্যাট চলাকালীন
//    সৎ ফলব্যাক হয় (ডিফল্ট মডেল) + run_note-এ জানানো হয়।
//  - id '' = SDK ডিফল্ট (কোনো model প্যারামিটার পাঠানো হয় না)।
// ============================================================

export interface ChatModelOption {
  /** SDK-তে পাঠানোর model মান ('' = ডিফল্ট) */
  id: string;
  /** UI-লেবেল */
  label: string;
  /** ছোট বিবরণ (বাংলা) */
  description: string;
  /** ট্যাগ-ব্যাজ */
  tags: Array<'default' | 'fast' | 'vision' | 'reasoning' | 'long-context' | 'legacy' | 'balanced'>;
  /** আনুমানিক কনটেক্সট (হাজার টোকেনে) — ডকুমেন্টেশন-ভিত্তিক */
  contextK: number;
}

/** ক্যাটালগ — GLM পরিবার (Z.ai ব্যাকএন্ডে সেবিত লাইন) */
export const CHAT_MODELS: ChatModelOption[] = [
  {
    id: '',
    label: 'অটো (প্ল্যাটফর্ম ডিফল্ট)',
    description: 'SDK-র ডিফল্ট মডেল — সবচেয়ে নির্ভরযোগ্য পথ',
    tags: ['default'],
    contextK: 128,
  },
  {
    id: 'glm-4.6',
    label: 'GLM-4.6',
    description: 'সর্বশেষ প্রজন্মের ফ্ল্যাগশিপ — সবচেয়ে ভালো যুক্তি ও কোডিং',
    tags: ['reasoning', 'balanced'],
    contextK: 200,
  },
  {
    id: 'glm-4.5',
    label: 'GLM-4.5',
    description: 'প্রজন্ম ৪.৫ — শক্তিশালী সাধারণ-উদ্দেশ্য মডেল',
    tags: ['reasoning', 'balanced'],
    contextK: 128,
  },
  {
    id: 'glm-4.5-air',
    label: 'GLM-4.5-Air',
    description: 'হালকা ৪.৫-সংস্করণ — দ্রুত ও কম-খরচ',
    tags: ['fast', 'balanced'],
    contextK: 128,
  },
  {
    id: 'glm-4.5-flash',
    label: 'GLM-4.5-Flash',
    description: 'সবচেয়ে দ্রুত ৪.৫-ভ্যারিয়েন্ট — ছোট কাজে সস্তা',
    tags: ['fast'],
    contextK: 128,
  },
  {
    id: 'glm-4-flash',
    label: 'GLM-4-Flash',
    description: '৪-প্রজন্মের ফ্ল্যাশ — দ্রুত উত্তর',
    tags: ['fast'],
    contextK: 128,
  },
  {
    id: 'glm-4-plus',
    label: 'GLM-4-Plus',
    description: '৪-প্রজন্মের প্রিমিয়াম — উন্নত যুক্তি',
    tags: ['reasoning'],
    contextK: 128,
  },
  {
    id: 'glm-4-air',
    label: 'GLM-4-Air',
    description: '৪-প্রজন্মের হালকা সংস্করণ',
    tags: ['fast', 'balanced'],
    contextK: 128,
  },
  {
    id: 'glm-4-long',
    label: 'GLM-4-Long',
    description: '১M কনটেক্সট — অনেক বড় ডকুমেন্টের কাজে',
    tags: ['long-context'],
    contextK: 1000,
  },
  {
    id: 'glm-4v',
    label: 'GLM-4V',
    description: 'ভিশন-মূল মডেল — টেক্সট চ্যাটেও চেষ্টা করা যায়',
    tags: ['vision'],
    contextK: 128,
  },
  {
    id: 'glm-4.1v',
    label: 'GLM-4.1V',
    description: 'উন্নত ভিশন প্রজন্ম',
    tags: ['vision'],
    contextK: 128,
  },
  {
    id: 'glm-4v-flash',
    label: 'GLM-4V-Flash',
    description: 'দ্রুত ভিশন ভ্যারিয়েন্ট',
    tags: ['vision', 'fast'],
    contextK: 128,
  },
  {
    id: 'glm-3-turbo',
    label: 'GLM-3-Turbo',
    description: 'পুরোনো প্রজন্মের দ্রুত মডেল',
    tags: ['legacy', 'fast'],
    contextK: 128,
  },
];

/** id → ক্যাটালগ-এন্ট্রি (না পেলে undefined) */
export function findChatModel(id: string): ChatModelOption | undefined {
  return CHAT_MODELS.find(m => m.id === id);
}

/** অনুরোধে আসা model-মান বৈধ কি না ('' বা ক্যাটালগের id) */
export function isValidChatModelId(id: unknown): id is string {
  return typeof id === 'string' && CHAT_MODELS.some(m => m.id === id);
}

// ------------------------------------------------------------
// রানটাইম যাচাই (সার্ভার-সাইড টাইপ)
// ------------------------------------------------------------
export interface ModelVerificationEntry {
  ok: boolean;
  /** সার্ভার জানানো প্রকৃত মডেল-নাম */
  servedModel?: string;
  /** মিলিসেকেন্ড */
  ms?: number;
  /** 429-এর কারণে যাচাই হয়নি */
  rateLimited?: boolean;
  error?: string;
  testedAt: string;
}

export interface ModelVerificationFile {
  /** key = model id ('' → '(default)') */
  [modelId: string]: ModelVerificationEntry;
}
