// ============================================================
// চ্যাট-মডেল ক্যাটালগ (মাল্টি-প্রোভাইডার) — composer-এর
// মডেল-সিলেক্টর ও সার্ভার-রাউটিং উভয়ের উৎস।
//
// সততার নিয়ম (ব্যাকএন্ড↔ফ্রন্টএন্ড ১:১ — ব্যবহারকারীর স্পষ্ট নির্দেশ):
//  ① লাইভ-প্রোব (২০২৬-১০-১৩) প্রমাণ করেছে: z-ai-web-dev-sdk-র চ্যাট
//     পাইপে model-প্যারামিটার উপেক্ষিত — glm-5.3/4.6/4.5/… যাই চাইুক
//     served-model সবসময় glm-4-plus। তাই SDK-গ্রুপে সেটিই একমাত্র
//     সৎ এন্ট্রি — আগের ১৪টি “ভিন্ন GLM লেবেল” ভুয়া ম্যাপিং ছিল,
//     সরিয়ে দেওয়া হয়েছে (আর কখনো ফেরানো হবে না)।
//  ② এক্সটার্নাল এন্ট্রি = প্রকৃত পাবলিক API-র প্রকৃত model-স্ট্রিং
//     (apiModel ফিল্ডে দৃশ্যমান) — কী দিলেই চলে; কী-সমস্যায় সৎ ত্রুটি।
//  ③ CHAT_MODELS-এর ক্রমই সিরিয়াল-ক্রম — UI ১,২,৩… নম্বর দেখায়।
//  ④ যাচাই-স্ট্যাটাস ডিস্কে ক্যাশ হয় (storage/model-verification.json)
//     — 429 হলে "অনুপলব্ধ" নয়, "অযাচাই/রেট-লিমিট" দেখানো হয়।
//
// এই ফাইল client-safe — কোনো fs/server-only import নয়।
// ============================================================

/**
 * চ্যাট-প্রোভাইডার শনাক্তকারী
 * ('zai-api' = Z.ai-র আন্তর্জাতিক API, নিজের কী;
 *  'custom' = ব্যবহারকারীর নিজের যোগ করা OpenAI-কম্প্যাটিবল প্ল্যাটফর্ম —
 *  Base URL + API Key + মডেল-নির্বাচন, রানটাইমে সংরক্ষিত)
 */
export type ChatProviderId = 'zai' | 'deepseek' | 'zai-api' | 'glm' | 'groq' | 'openrouter' | 'custom';

/**
 * কাস্টম-মডেল আইডির প্রিফিক্স: custom:<providerId>:<apiModel>
 * (client-safe আকার-পরীক্ষা মাত্র — রেজল্যুশন সার্ভারে custom-providers.ts-এ)
 */
export const CUSTOM_MODEL_PREFIX = 'custom:';

/** এই আইডিটি কাস্টম-প্ল্যাটফর্মের মডেল কি না (client-safe শুধু-আকার পরীক্ষা) */
export function isCustomModelId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(CUSTOM_MODEL_PREFIX);
}

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

/** স্ট্যাটিক প্রোভাইডারের আইডি-ইউনিয়ন ('custom' বাদ — সেটি রানটাইমে তালিকাভুক্ত হয়) */
export type StaticProviderId = Exclude<ChatProviderId, 'custom'>;

export const PROVIDERS: Record<StaticProviderId, ProviderInfo> = {
  zai: {
    id: 'zai',
    label: 'Z.ai SDK (বিল্ট-ইন)',
    kind: 'builtin',
    note: 'কী লাগে না, তবে সব মডেল একই ব্যাকএন্ড পাইপ ভাগ করে — রেট-লিমিট (৪২৯) শেয়ার্ড।',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'external',
    // অফিসিয়াল বেস URL (api-docs.deepseek.com — Models & Pricing পেজ)
    baseURL: 'https://api.deepseek.com',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyHint: 'sk-... আকারের কী',
    envVar: 'DEEPSEEK_API_KEY',
    note: 'প্রকৃত DeepSeek API (api.deepseek.com) — লেটেস্ট V4-Pro ও V4.1-Flash। অফিসিয়াল পথ: OpenAI SDK + DeepSeek baseURL (npm-এর ভাঙা "deepseek-sdk" প্যাকেজ নয়); পে-অ্যাজ-ইউ-গো।',
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
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'external',
    baseURL: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_... আকারের কী',
    envVar: 'GROQ_API_KEY',
    note: 'অতি-দ্রুত ইনফারেন্স; ফ্রি টিয়ারে Llama/GPT-OSS/Qwen চলে।',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'external',
    baseURL: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyHint: 'sk-or-v1-... আকারের কী',
    envVar: 'OPENROUTER_API_KEY',
    note: 'এক কীতে বহু মডেল; ":free" মডেলগুলো খরচ ছাড়া (তালিকা সময়ে সময়ে বদলায়)।',
  },
};

/** এক্সটার্নাল প্রোভাইডারের প্রদর্শন-ক্রম */
export const EXTERNAL_PROVIDER_ORDER: ChatProviderId[] = ['deepseek', 'zai-api', 'glm', 'groq', 'openrouter'];

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
  tags: Array<
    'default' | 'fast' | 'vision' | 'reasoning' | 'long-context' | 'legacy' | 'balanced' | 'open-source' | 'free-tier'
  >;
  /** আনুমানিক কনটেক্সট (হাজার টোকেনে) — ডকুমেন্টেশন-ভিত্তিক */
  contextK: number;
  /** কোন প্রোভাইডারের পাইপে যাবে */
  provider: ChatProviderId;
  /** এক্সটার্নাল API-তে পাঠানোর প্রকৃত model-স্ট্রিং */
  apiModel?: string;
  /**
   * DeepSeek V4-র প্রকৃত থিংকিং-মোড টগল (অফিসিয়াল extra_body: thinking.type)।
   * উল্লেখ না থাকলে বন্ধ ধরা হয় (দ্রুত + সস্তা)।
   */
  thinking?: 'enabled' | 'disabled';
  /** থিংকিং চালু হলে reasoning_effort (DeepSeek V4: low/high/max, ডিফল্ট high) */
  reasoningEffort?: 'low' | 'high' | 'max';
  /**
   * কাস্টম-প্ল্যাটফর্মের তথ্য (provider === 'custom' হলেই থাকে) —
   * UI-গ্রুপিং ও সৎ প্রদর্শনের জন্য; কোনো গোপন তথ্য নেই।
   */
  customProvider?: {
    id: string;
    name: string;
    host: string;
    language: 'auto' | 'bn' | 'en';
  };
}

/** ক্যাটালগ — ক্রমই সিরিয়াল; প্রতিটি এন্ট্রি = প্রকৃত ব্যাকএন্ড-মডেল */
export const CHAT_MODELS: ChatModelOption[] = [
  // ---------- ১. প্ল্যাটফর্ম-ব্যাকএন্ড: Z.ai SDK (বিল্ট-ইন পাইপ) ----------
  // লাইভ-প্রোব-সত্য: এই পাইপে একটিই চ্যাট-মডেল সার্ভ হয় — glm-4-plus
  // (model-প্যারামিটার যাই হোক)। আগের ১৪টি ভিন্ন GLM-লেবেল ছিল ভুয়া
  // ম্যাপিং — সরানো। SDK-গ্রুপে কী লাগে না, তবে রেট-লিমিট (৪২৯) শেয়ার্ড;
  // আলাদা কোটায় GLM চাইলে “Z.ai API”-গ্রুপে নিজের কী দিন।
  {
    id: '',
    label: 'GLM-4-Plus (Z.ai SDK)',
    description:
      'বিল্ট-ইন পাইপের একমাত্র প্রকৃত চ্যাট-মডেল — লাইভ-প্রোবে নিশ্চিত (served-model সব সময় glm-4-plus)',
    tags: ['default', 'balanced'],
    contextK: 128,
    provider: 'zai',
  },

  // ---------- DeepSeek (প্রকৃত api.deepseek.com — নিজের কী; V4-সিরিজ, অক্টোবর ২০২৬-এ লেটেস্ট) ----------
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro (থিংকিং)',
    description: 'deepseek-v4-pro — V4-Pro-0813 (GA আগস্ট ২০২৬), ১M কনটেক্সট, চেইন-অব-থট যুক্তি (effort: high)',
    tags: ['reasoning', 'long-context', 'open-source'],
    contextK: 1000,
    provider: 'deepseek',
    apiModel: 'deepseek-v4-pro',
    thinking: 'enabled',
    reasoningEffort: 'high',
  },
  {
    id: 'deepseek-v4-pro-fast',
    label: 'DeepSeek V4 Pro (দ্রুত)',
    description: 'একই deepseek-v4-pro মডেল, থিংকিং-মোড বন্ধ — দ্রুত ও সস্তা প্রতিটি উত্তর',
    tags: ['balanced', 'open-source'],
    contextK: 1000,
    provider: 'deepseek',
    apiModel: 'deepseek-v4-pro',
    thinking: 'disabled',
  },
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4.1 Flash (থিংকিং)',
    description: 'deepseek-flash অ্যালায়েস — V4.1-Flash (সেপ্টেম্বর ২০২৬), ১M কনটেক্সট, ভিশন-ইনপুট সক্ষম',
    tags: ['reasoning', 'fast', 'vision', 'long-context', 'open-source'],
    contextK: 1000,
    provider: 'deepseek',
    apiModel: 'deepseek-flash',
    thinking: 'enabled',
    reasoningEffort: 'high',
  },
  {
    id: 'deepseek-v4-flash-fast',
    label: 'DeepSeek V4.1 Flash (দ্রুত)',
    description: 'একই deepseek-flash মডেল, থিংকিং-মোড বন্ধ — সবচেয়ে দ্রুত DeepSeek পথ',
    tags: ['fast', 'vision', 'open-source'],
    contextK: 1000,
    provider: 'deepseek',
    apiModel: 'deepseek-flash',
    thinking: 'disabled',
  },

  // ---------- Z.ai API · GLM-5.3 (docs.z.ai-র প্রকৃত endpoint — নিজের কী) ----------
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

  // ---------- GLM · BigModel (প্রকৃত API — নিজের কী) ----------
  {
    id: 'glm-flash-free',
    label: 'GLM-4-Flash (ফ্রি টিয়ার)',
    description: 'Zhipu BigModel-এর ফ্রি glm-4-flash — খরচ ছাড়াই আলাদা কোটা',
    tags: ['fast', 'free-tier', 'open-source'],
    contextK: 128,
    provider: 'glm',
    apiModel: 'glm-4-flash',
  },
  {
    id: 'glm-air-cn',
    label: 'GLM-4-Air (BigModel)',
    description: 'Zhipu-র glm-4-air — হালকা ও সস্তা',
    tags: ['fast', 'balanced', 'open-source'],
    contextK: 128,
    provider: 'glm',
    apiModel: 'glm-4-air',
  },
  {
    id: 'glm-plus-cn',
    label: 'GLM-4-Plus (BigModel)',
    description: 'Zhipu-র প্রিমিয়াম glm-4-plus — উন্নত যুক্তি',
    tags: ['reasoning', 'open-source'],
    contextK: 128,
    provider: 'glm',
    apiModel: 'glm-4-plus',
  },

  // ---------- Groq (ফ্রি টিয়ার — নিজের কী) ----------
  {
    id: 'groq-llama-3.3-70b',
    label: 'Llama 3.3 70B (Groq)',
    description: 'Meta-র ওপেন-ওয়েট Llama 3.3 — Groq-র অতি-দ্রুত হার্ডওয়্যারে',
    tags: ['fast', 'balanced', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'groq',
    apiModel: 'llama-3.3-70b-versatile',
  },
  {
    id: 'groq-gpt-oss-120b',
    label: 'GPT-OSS 120B (Groq)',
    description: 'OpenAI-র ওপেন-ওয়েট 120B মডেল — Groq-তে ফ্রি টিয়ার',
    tags: ['reasoning', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'groq',
    apiModel: 'openai/gpt-oss-120b',
  },
  {
    id: 'groq-gpt-oss-20b',
    label: 'GPT-OSS 20B (Groq)',
    description: 'হালকা ওপেন-ওয়েট 20B — খুব দ্রুত',
    tags: ['fast', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'groq',
    apiModel: 'openai/gpt-oss-20b',
  },
  {
    id: 'groq-qwen3-32b',
    label: 'Qwen3 32B (Groq)',
    description: 'Alibaba-র Qwen3 — বহুভাষিক (বাংলাসহ) ভালো',
    tags: ['balanced', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'groq',
    apiModel: 'qwen/qwen3-32b',
  },
  {
    id: 'groq-r1-distill-70b',
    label: 'R1-Distill 70B (Groq)',
    description: 'DeepSeek-R1-এর লামা-ডিস্টিল — দ্রুত গভীর যুক্তি',
    tags: ['reasoning', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'groq',
    apiModel: 'deepseek-r1-distill-llama-70b',
  },

  // ---------- OpenRouter (":free" মডেল — নিজের কী) ----------
  {
    id: 'or-nemotron-super-120b',
    label: 'Nemotron Super 120B (ফ্রি)',
    description: 'NVIDIA-র ওপেন মডেল — OpenRouter :free তালিকা থেকে',
    tags: ['balanced', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'openrouter',
    apiModel: 'nvidia/nemotron-3-super-120b-a12b:free',
  },
  {
    id: 'or-nemotron-ultra-550b',
    label: 'Nemotron Ultra 550B (ফ্রি)',
    description: 'NVIDIA-র বৃহত্ মোয়ে মডেল — OpenRouter :free',
    tags: ['reasoning', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'openrouter',
    apiModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  },
  {
    id: 'or-gemma-4-31b',
    label: 'Gemma 4 31B (ফ্রি)',
    description: 'Google-এর Gemma-4 — OpenRouter :free তালিকা থেকে',
    tags: ['balanced', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'openrouter',
    apiModel: 'google/gemma-4-31b-it:free',
  },
  {
    id: 'or-gemma-4-26b-a4b',
    label: 'Gemma 4 26B A4B (ফ্রি)',
    description: 'হালকা Gemma-4 ভ্যারিয়েন্ট — OpenRouter :free',
    tags: ['fast', 'open-source', 'free-tier'],
    contextK: 128,
    provider: 'openrouter',
    apiModel: 'google/gemma-4-26b-a4b-it:free',
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

/** সৎ প্রদর্শন-নাম: এক্সটার্নাল হলে "প্রোভাইডার · apiModel" */
export function describeChatModel(id: string | null | undefined): string {
  if (id == null || id === '') return 'GLM-4-Plus (Z.ai SDK ডিফল্ট)';
  // কাস্টম-প্ল্যাটফর্ম মডেল — স্ট্যাটিক ক্যাটালগে নেই; আইডি থেকেই সৎ বর্ণনা
  if (isCustomModelId(id)) {
    const rest = id.slice(CUSTOM_MODEL_PREFIX.length);
    const colon = rest.indexOf(':');
    const apiModel = colon > 0 ? rest.slice(colon + 1) : rest;
    return `কাস্টম প্ল্যাটফর্ম · ${apiModel}`;
  }
  const entry = findChatModel(id);
  if (!entry) return id;
  if (entry.provider === 'zai' || !entry.apiModel) return entry.label;
  return `${PROVIDERS[entry.provider].label} · ${entry.apiModel}`;
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
