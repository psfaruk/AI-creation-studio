// ============================================================
// চ্যাট-মডেল ক্যাটালগ (মাল্টি-প্রোভাইডার) — composer-এর
// মডেল-সিলেক্টর ও সার্ভার-রাউটিং উভয়ের উৎস।
//
// সততার নিয়ম:
//  ① এই তালিকায় থাকা = "কাজ করে" নয়; প্রকৃত প্রাপ্যতা শুধু
//     রানটাইম যাচাইয়ের (POST /api/models) ফলাফল থেকে আসে।
//  ② Z.ai SDK-গ্রুপের ১৩টি মডেল সবাই একই ব্যাকএন্ড পাইপ ভাগ
//     করে (SDK-তে model-রাউটিং নেই) — তাই তাদের রেট-লিমিটও
//     শেয়ার্ড। মডেল বদলে ৪২৯ এড়ানো যায় না; আলাদা কোটা চাইলে
//     নিজের API কী-র এক্সটার্নাল প্রোভাইডার ব্যবহার করুন।
//  ③ এক্সটার্নাল প্রোভাইডার (DeepSeek/GLM/Groq/OpenRouter) —
//     প্রকৃত পাবলিক API, নিজের কী লাগে; কী ছাড়া মডেল নির্বাচন
//     করলে সৎভাবে কী-ডায়ালগ খোলে, নীরব ফলব্যাক নয়।
//  ④ যাচাই-স্ট্যাটাস ডিস্কে ক্যাশ হয় (storage/model-verification.json)
//     — 429 হলে "অনুপলব্ধ" নয়, "অযাচাই/রেট-লিমিট" দেখানো হয়।
//
// এই ফাইল client-safe — কোনো fs/server-only import নয়।
// ============================================================

/** চ্যাট-প্রোভাইডার শনাক্তকারী ('zai-api' = Z.ai-র আন্তর্জাতিক API, নিজের কী) */
export type ChatProviderId = 'zai' | 'deepseek' | 'zai-api' | 'glm' | 'groq' | 'openrouter';

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

export const PROVIDERS: Record<ChatProviderId, ProviderInfo> = {
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
}

/** ক্যাটালগ — Z.ai SDK (শেয়ার্ড পাইপ) + প্রকৃত ওপেন-সোর্স প্রোভাইডার */
export const CHAT_MODELS: ChatModelOption[] = [
  // ---------- Z.ai SDK (বিল্ট-ইন; সবাই একই পাইপ, রেট-লিমিট শেয়ার্ড) ----------
  {
    id: '',
    label: 'অটো (প্ল্যাটফর্ম ডিফল্ট)',
    description: 'SDK-র ডিফল্ট মডেল — সবচেয়ে নির্ভরযোগ্য পথ',
    tags: ['default'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-5.3',
    label: 'GLM-5.3',
    description: 'সর্বশেষ প্রজন্মের ফ্ল্যাগশিপ (docs.z.ai-এ "Hot") — ২০০K কনটেক্সট; একই SDK পাইপ',
    tags: ['reasoning', 'balanced'],
    contextK: 200,
    provider: 'zai',
  },
  {
    id: 'glm-5.3-flash',
    label: 'GLM-5.3-Flash',
    description: 'দ্রুত ৫.৩-ভ্যারিয়েন্ট (docs.z.ai-এ "New", ১২৮K, ভিশন-সক্ষম মডেল) — একই SDK পাইপ',
    tags: ['fast', 'vision'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4.6',
    label: 'GLM-4.6',
    description: 'পূর্ববর্তী প্রজন্মের ফ্ল্যাগশিপ লেবেল — একই SDK পাইপ',
    tags: ['reasoning', 'balanced'],
    contextK: 200,
    provider: 'zai',
  },
  {
    id: 'glm-4.5',
    label: 'GLM-4.5',
    description: 'প্রজন্ম ৪.৫ লেবেল — একই SDK পাইপ',
    tags: ['reasoning', 'balanced'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4.5-air',
    label: 'GLM-4.5-Air',
    description: 'হালকা ৪.৫-লেবেল — একই SDK পাইপ',
    tags: ['fast', 'balanced'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4.5-flash',
    label: 'GLM-4.5-Flash',
    description: 'দ্রুত ৪.৫-লেবেল — একই SDK পাইপ',
    tags: ['fast'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4-flash',
    label: 'GLM-4-Flash',
    description: '৪-প্রজন্মের ফ্ল্যাশ-লেবেল — একই SDK পাইপ',
    tags: ['fast'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4-plus',
    label: 'GLM-4-Plus',
    description: '৪-প্রজন্মের প্রিমিয়াম-লেবেল — একই SDK পাইপ',
    tags: ['reasoning'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4-air',
    label: 'GLM-4-Air',
    description: '৪-প্রজন্মের হালকা-লেবেল — একই SDK পাইপ',
    tags: ['fast', 'balanced'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4-long',
    label: 'GLM-4-Long',
    description: '১M-কনটেক্সট লেবেল — একই SDK পাইপ',
    tags: ['long-context'],
    contextK: 1000,
    provider: 'zai',
  },
  {
    id: 'glm-4v',
    label: 'GLM-4V',
    description: 'ভিশন-লেবেল — টেক্সট চ্যাটেও একই SDK পাইপ',
    tags: ['vision'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4.1v',
    label: 'GLM-4.1V',
    description: 'উন্নত ভিশন-লেবেল — একই SDK পাইপ',
    tags: ['vision'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-4v-flash',
    label: 'GLM-4V-Flash',
    description: 'দ্রুত ভিশন-লেবেল — একই SDK পাইপ',
    tags: ['vision', 'fast'],
    contextK: 128,
    provider: 'zai',
  },
  {
    id: 'glm-3-turbo',
    label: 'GLM-3-Turbo',
    description: 'পুরোনো প্রজন্মের লেবেল — একই SDK পাইপ',
    tags: ['legacy', 'fast'],
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
  if (id == null || id === '') return '(default)';
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
