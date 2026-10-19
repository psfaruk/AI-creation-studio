// ============================================================
// চ্যাট-মডেল ক্যাটালগ — composer-এর মডেল-সিলেক্টর ও
// সার্ভার-রাউটিং উভয়ের উৎস।
//
// নীতি:
//  ① GLM-পরিবার + কাস্টম/লোকাল প্রোভাইডার:
//     - zai     = Z.ai SDK বিল্ট-ইন পাইপ (কী লাগে না; served = glm-4-plus)
//     - zai-api = Z.ai আন্তর্জাতিক API (api.z.ai) — নিজের কী
//     - glm     = Zhipu BigModel (open.bigmodel.cn) — নিজের কী
//     - custom  = ব্যবহারকারীর নিজের OpenAI-কম্প্যাটিবল এন্ডপয়েন্ট
//                (Ollama / LM Studio / vLLM / LiteLLM / ngrok-টানেল …)
//                — Base URL + API কী + মডেলের নাম সবই ইউজারের; কী ঐচ্ছিক।
//  ② এন্ডপয়েন্ট-মিশ্রণ নিষিদ্ধ: প্রতিটি প্রোভাইডারের নিজস্ব baseURL,
//     নিজস্ব কী-স্লট, নিজস্ব মডেল-আইডি — কোনো ক্রস-ফলব্যাক নেই।
//  ③ SDK-গ্রুপে একটিই সৎ এন্ট্রি (লাইভ-প্রোব-সত্য: model-প্যারামিটার
//     উপেক্ষিত, served-model সবসময় glm-4-plus)।
//  ④ এক্সটার্নাল এন্ট্রি = প্রকৃত API-র প্রকৃত model-স্ট্রিং
//     (apiModel ফিল্ডে দৃশ্যমান) — কী দিলেই চলে; কী-সমস্যায় সৎ ত্রুটি।
//     custom-এন্ট্রিতে apiModel নেই — মডেলের নাম ইউজারের সেভ-করা
//     কনফিগ থেকে (provider-keys.ts → getCustomConfig) রানটাইমে আসে।
//  ⑤ CHAT_MODELS-এর ক্রমই প্রদর্শন-ক্রম।
//  ⑥ যাচাই-স্ট্যাটাস ডিস্কে ক্যাশ হয় (storage/model-verification.json)।
//  ⑦ পুরনো saved model-id (deepseek-*/groq-*/or-*/custom:*) —
//     sanitizeChatModel() সৎ-ডিফল্টে মাইগ্রেট করে।
//
// এই ফাইল client-safe — কোনো fs/server-only import নয়।
// ============================================================

/**
 * চ্যাট-প্রোভাইডার শনাক্তকরণ:
 *  'zai'     = বিল্ট-ইন Z.ai SDK (কী লাগে না)
 *  'zai-api' = Z.ai আন্তর্জাতিক API (docs.z.ai) — নিজের কী
 *  'glm'     = Zhipu BigModel (open.bigmodel.cn) — নিজের কী
 *  'custom'  = নিজের OpenAI-কম্প্যাটিবল এন্ডপয়েন্ট (লোকাল/টানেল) —
 *              Base URL + মডেলের নাম বাধ্যতামূলক, API কী ঐচ্ছিক
 */
export type ChatProviderId = 'zai' | 'zai-api' | 'glm' | 'custom';

/** প্রোভাইডার-মেটাডেটা (client-safe — কোনো গোপন তথ্য নেই) */
export interface ProviderInfo {
  id: ChatProviderId;
  label: string;
  /** 'builtin' = Z.ai SDK (কী লাগে না), 'external' = নিজের API কী */
  kind: 'builtin' | 'external';
  /** OpenAI-কম্প্যাটিবল বেস URL (external) */
  baseURL?: string;
  /** কোথায় কী পাওয়া যায় (external) */
  keyUrl?: string;
  /** কী-এর আকৃতির ইঙ্গিত (external) */
  keyHint?: string;
  /** process.env ফলব্যাক-নাম (external) */
  envVar?: string;
  /** সৎ বাংলা নোট */
  note: string;
}

/** স্ট্যাটিক প্রোভাইডারের আইডি-ইউনিয়ন */
export type StaticProviderId = ChatProviderId;

export const PROVIDERS: Record<StaticProviderId, ProviderInfo> = {
  zai: {
    id: 'zai',
    label: 'Z.ai SDK (বিল্ট-ইন)',
    kind: 'builtin',
    note: 'কী লাগে না, তবে সব মডেল একই ব্যাকএন্ড পাইপ ভাগ করে — রেট-লিমিট (৪২৯) শেয়ার্ড।',
  },
  'zai-api': {
    id: 'zai-api',
    label: 'Z.ai API (GLM)',
    kind: 'external',
    // docs.z.ai-র অফিসিয়াল OpenAI-কম্প্যাটিবল endpoint
    baseURL: 'https://api.z.ai/api/paas/v4',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    keyHint: '{id}.{secret} আকারের কী',
    envVar: 'ZAI_API_KEY',
    note: 'Z.ai-এর আন্তর্জাতিক প্ল্যাটফর্ম (docs.z.ai) — glm-5.3 ও glm-5.3-flash নিজের কীতে আলাদা কোটায়; বিল্ট-ইন SDK-র শেয়ার্ড ৪২৯-উইন্ডোর বাইরের পথ।',
  },
  glm: {
    id: 'glm',
    label: 'GLM · BigModel',
    kind: 'external',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    keyHint: 'xxxxxxxx....xxxxxxxx.YYYY আকারের কী',
    envVar: 'GLM_API_KEY',
    note: 'Zhipu-র প্রকৃত ওপেন প্ল্যাটফর্ম; glm-4-flash মডেলটি ফ্রি টিয়ার।',
  },
  custom: {
    id: 'custom',
    label: 'কাস্টম / লোকাল মডেল',
    kind: 'external',
    // কোনো ডিফল্ট baseURL নেই — ইউজারের নিজের এন্ডপয়েন্টই এখানে কনফিগ
    // (provider-keys.ts → getCustomConfig)। env-ফলব্যাক: CUSTOM_BASE_URL।
    envVar: 'CUSTOM_API_KEY',
    note: 'নিজের OpenAI-কম্প্যাটিবল এন্ডপয়েন্ট (Ollama, LM Studio, vLLM, LiteLLM, টানেল…)। Base URL ও মডেলের নাম বাধ্যতামূলক, API কী ঐচ্ছিক। মনে রাখুন: কল দেয় এই অ্যাপের সার্ভার — তাই এন্ডপয়েন্টটি সার্ভার থেকে পৌঁছানো যায় এমন ঠিকানা হতে হবে (localhost শুধু তখনই যদি অ্যাপ নিজ মেশিনে চলে)।',
  },
};

/** এক্সটার্নাল প্রোভাইডারের প্রদর্শন-ক্রম (GLM ×২ + কাস্টম) */
export const EXTERNAL_PROVIDER_ORDER: ChatProviderId[] = ['zai-api', 'glm', 'custom'];

/** কাস্টম-প্রোভাইডারের একমাত্র ক্যাটালগ-মডেল-আইডি (apiModel রানটাইমে সেভ-কনফিগ থেকে) */
export const CUSTOM_MODEL_ID = 'custom-model';

export function isExternalProvider(p: ChatProviderId): boolean {
  return PROVIDERS[p]?.kind === 'external';
}

export interface ChatModelOption {
  /** অ্যাপ-জুড়ে অনন্য id ('' = SDK ডিফল্ট) */
  id: string;
  /** UI-লেবেল */
  label: string;
  /** ছোট বিবরণ (বাংলা) */
  description: string;
  /** ট্যাগ-ব্যাজ */
  tags: Array<'default' | 'fast' | 'vision' | 'reasoning' | 'balanced' | 'free-tier'>;
  /** আনুমানিক কনটেক্সট (হাজার টোকেনে) — ডকুমেন্টেশন-ভিত্তিক */
  contextK: number;
  /** কোন প্রোভাইডারের পাইপে যাবে */
  provider: ChatProviderId;
  /** এক্সটার্নাল API-তে পাঠানোর প্রকৃত model-স্ট্রিং */
  apiModel?: string;
}

/** ক্যাটালগ — ক্রমই প্রদর্শন-ক্রম; প্রতিটি এন্ট্রি = প্রকৃত ব্যাকএন্ড-মডেল */
export const CHAT_MODELS: ChatModelOption[] = [
  // ---------- ১. প্ল্যাটফর্ম-ব্যাকএন্ড: Z.ai SDK (বিল্ট-ইন পাইপ, কী লাগে না) ----------
  // লাইভ-প্রোব-সত্য: এই পাইপে একটিই চ্যাট-মডেল সার্ভ হয় — glm-4-plus
  // (model-প্যারামিটার যাই হোক)। আলাদা কোটায় GLM চাইলে নিচের
  // কী-ভিত্তিক গ্রুপগুলোতে নিজের কী দিন।
  {
    id: '',
    label: 'GLM-4-Plus (Z.ai SDK)',
    description:
      'বিল্ট-ইন পাইপের একমাত্র প্রকৃত চ্যাট-মডেল — লাইভ-প্রোবে নিশ্চিত (served-model সব সময় glm-4-plus)',
    tags: ['default', 'balanced'],
    contextK: 128,
    provider: 'zai',
  },

  // ---------- ২. Z.ai API · GLM-5.3 (api.z.ai — নিজের কী) ----------
  {
    id: 'zai-glm-5.3',
    label: 'GLM-5.3 (Z.ai API)',
    description: 'api.z.ai/api/paas/v4 · glm-5.3 — নিজের কীতে আলাদা কোটা (শেয়ার্ড ৪২৯-উইন্ডোর বাইরে)',
    tags: ['reasoning', 'balanced'],
    contextK: 200,
    provider: 'zai-api',
    apiModel: 'glm-5.3',
  },
  {
    id: 'zai-glm-5.3-flash',
    label: 'GLM-5.3-Flash (Z.ai API)',
    description: 'glm-5.3-flash — দ্রুত ভ্যারিয়েন্ট (১২৮K, ভিশন-সক্ষম); নিজের কীতে আলাদা কোটা',
    tags: ['fast', 'vision'],
    contextK: 128,
    provider: 'zai-api',
    apiModel: 'glm-5.3-flash',
  },

  // ---------- ৩. GLM · BigModel (open.bigmodel.cn — নিজের কী) ----------
  {
    id: 'glm-flash-free',
    label: 'GLM-4-Flash (ফ্রি টিয়ার)',
    description: 'Zhipu BigModel-এর ফ্রি glm-4-flash — খরচ ছাড়াই আলাদা কোটা',
    tags: ['fast', 'free-tier'],
    contextK: 128,
    provider: 'glm',
    apiModel: 'glm-4-flash',
  },
  {
    id: 'glm-air-cn',
    label: 'GLM-4-Air (BigModel)',
    description: 'Zhipu-র glm-4-air — হালকা ও সস্তা',
    tags: ['fast', 'balanced'],
    contextK: 128,
    provider: 'glm',
    apiModel: 'glm-4-air',
  },
  {
    id: 'glm-plus-cn',
    label: 'GLM-4-Plus (BigModel)',
    description: 'Zhipu-র প্রিমিয়াম glm-4-plus — উন্নত যুক্তি',
    tags: ['reasoning'],
    contextK: 128,
    provider: 'glm',
    apiModel: 'glm-4-plus',
  },

  // ---------- ৪. কাস্টম / লোকাল মডেল (নিজের OpenAI-কম্প্যাটিবল এন্ডপয়েন্ট) ----------
  // apiModel স্ট্যাটিক নয় — ইউজারের সেভ করা মডেলের নাম রানটাইমে বসে
  // (provider-keys.ts → getCustomConfig)। /api/models কনফিগ থাকলে লেবেলে
  // প্রকৃত মডেল-নাম দেখায়।
  {
    id: CUSTOM_MODEL_ID,
    label: 'কাস্টম মডেল (নিজের এন্ডপয়েন্ট)',
    description: 'নিজের লোকাল/টানেল মডেল — Base URL + API কী + মডেলের নাম দিয়ে কনফিগার করুন (কী-ডায়ালগের "কাস্টম / লোকাল" অংশ)',
    tags: ['balanced'],
    contextK: 128,
    provider: 'custom',
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

/**
 * পুরনো/সরানো model-id-এর সৎ মাইগ্রেশন (অডিট §৭):
 * ক্যাটালগে থাকলে যথার্থ id ফেরে; নাহলে '' (SDK ডিফল্ট GLM-4-Plus)।
 * localStorage-এ সেভ করা পুরনো নির্বাচন (deepseek-* / groq-* / or-* /
 * custom:*) এই পথে নীরবে-নয়, সৎ-ডিফল্টে বসে যায় — চ্যাট আটকে থাকে না।
 */
export function sanitizeChatModel(id: string | null | undefined): string {
  if (id == null) return '';
  if (isValidChatModelId(id)) return id;
  return '';
}

/** সৎ প্রদর্শন-নাম: এক্সটার্নাল হলে "প্রোভাইডার · apiModel" */
export function describeChatModel(id: string | null | undefined): string {
  if (id == null || id === '') return 'GLM-4-Plus (Z.ai SDK ডিফল্ট)';
  const entry = findChatModel(id);
  if (!entry) return id;
  if (entry.provider === 'zai' || !entry.apiModel) return entry.label;
  return `${PROVIDERS[entry.provider].label} · ${entry.apiModel}`;
}

/** এই ক্যাটালগ-এন্ট্রিটি কি কাস্টম-প্রোভাইডারের (নিজের এন্ডপয়েন্ট)? */
export function isCustomProviderModel(entry: ChatModelOption): boolean {
  return entry.provider === 'custom';
}

// ------------------------------------------------------------
// রানটাইম যাচাই (সার্ভার-সাইড টাইপ; ফাইল-ফরম্যাট /api/models-এর সাথে মিল)
// ------------------------------------------------------------
export interface ModelVerificationEntry {
  ok: boolean;
  /** সার্ভার জানানো প্রকৃত মডেল-নাম */
  servedModel?: string;
  /** মিলিসেকেন্ড */
  ms?: number;
  /** 429-এর কারণে যাচাই হয়নি */
  rateLimited?: boolean;
  /** এক্সটার্নাল প্রোভাইডারে API কী যোগ করা হয়নি */
  needsKey?: boolean;
  /** শেয়ার্ড ৪২৯-উইন্ডোর কারণে ডাক ছাড়াই স্কিপ (Z.ai গ্রুপ) */
  skippedBySharedWindow?: boolean;
  error?: string;
  testedAt: string;
}

export interface ModelVerificationFile {
  /** key = model id ('' → '(default)') */
  [modelId: string]: ModelVerificationEntry;
}
