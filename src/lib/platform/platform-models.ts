// ============================================================
// platform-models.ts — প্ল্যাটফর্ম API-গেটওয়ের মডেল-রেজিস্ট্রি
//
// নীতি (ব্যবহারকারীর নিজ-প্ল্যাটফর্মের মতোই):
//  "This platform only lists models verified with live API
//   calls — no fake labels."
//
// ব্যাকেন্ড-সত্য (লাইভ-প্রোব দিয়ে যাচাইকৃত, ২০২৬-১০-১৩):
//  ① z-ai-web-dev-sdk-র চ্যাট এন্ডপয়েন্টে model-প্যারামিটার উপেক্ষিত —
//     glm-5.3 চাইলেও served-model = glm-4-plus (২ বার নিশ্চিত)।
//     তাই চ্যাট-মডেল হিসেবে শুধুই glm-4-plus সৎ-ভাবে তালিকাভুক্ত।
//  ② createVision প্রকৃত routing করে — glm-5v-turbo চাইলেই
//     served-model = glm-5v-turbo (উত্তর: "Blue") — প্রকৃত ভিশন-মডেল।
//  ③ images.generations (cogview-3) প্রকৃত PNG দেয় (৪০KB b64,
//     ~৬৬ সে.)।
//
// যাচাই-অবস্থা storage/platform-verification.json-এ স্থায়ী থাকে;
// /api/v1/models কেবল যাচাইকৃত মডেলই তালিকাভুক্ত করে।
// ============================================================

import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

/** প্ল্যাটফর্ম-মডেলের ধরন */
export type PlatformModelKind = 'chat' | 'vision' | 'image';

export interface PlatformModel {
  /** API-তে ব্যবহারযোগ্য model-স্ট্রিং (এটাই ব্যাকেন্ডে যায়) */
  id: string;
  /** প্রদর্শন-নাম */
  name: string;
  kind: PlatformModelKind;
  /** বাংলা বিবরণ */
  description: string;
  /** আনুমানিক কনটেক্সট (হাজার টোকেন) */
  contextK?: number;
  /** ইমেজ-সাইজ সমর্থন (kind='image') */
  sizes?: string[];
  /** ব্যাকেন্ড এন্ডপয়েন্ট-নোট (স্বচ্ছতার জন্য UI-তে দেখানো) */
  backend: string;
}

export const PLATFORM_MODELS: PlatformModel[] = [
  {
    id: 'glm-4-plus',
    name: 'GLM-4-Plus',
    kind: 'chat',
    description:
      'Z.ai SDK পাইপের প্রকৃত চ্যাট-মডেল — লাইভ-প্রোবে নিশ্চিত যে এটিই সার্ভ হয় (model-প্যারামিটার যাই হোক)। স্ট্রিমিং সমর্থিত।',
    contextK: 128,
    backend: 'zai.chat.completions.create',
  },
  {
    id: 'glm-5v-turbo',
    name: 'GLM-5V-Turbo',
    kind: 'vision',
    description:
      'প্রকৃত ভিশন-মডেল — চিত্র+টেক্সট মাল্টিমোডাল বার্তা গ্রহণ করে (served-model যাচাইকৃত)। চ্যাট-কমপ্লিশনে image_url-কনটেন্ট পাঠান।',
    contextK: 128,
    backend: 'zai.chat.completions.createVision',
  },
  {
    id: 'cogview-3',
    name: 'CogView-3',
    kind: 'image',
    description: 'টেক্সট→ছবি জেনারেশন (১০২৪² পর্যন্ত; ~৬০-৯০ সেকেন্ড)।',
    sizes: [
      '1024x1024',
      '768x1344',
      '864x1152',
      '1344x768',
      '1152x864',
      '1440x720',
      '720x1440',
    ],
    backend: 'zai.images.generations.create',
  },
];

export function findPlatformModel(id: string): PlatformModel | undefined {
  return PLATFORM_MODELS.find(m => m.id === id);
}

// ------------------------------------------------------------
// যাচাই-স্টেট — storage/platform-verification.json
// ------------------------------------------------------------

export interface PlatformVerificationEntry {
  ok: boolean;
  /** প্রকৃত সার্ভ-করা মডেল (সম্ভব হলে) */
  servedModel?: string;
  ms?: number;
  rateLimited?: boolean;
  error?: string;
  testedAt: string;
}

interface PlatformVerificationFile {
  [modelId: string]: PlatformVerificationEntry;
}

const VERIFICATION_PATH = path.join(process.cwd(), 'storage', 'platform-verification.json');

export async function readPlatformVerification(): Promise<PlatformVerificationFile> {
  try {
    const raw = await readFile(VERIFICATION_PATH, 'utf8');
    const parsed = JSON.parse(raw) as PlatformVerificationFile;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // নেই — খালি
  }
  return {};
}

export async function writePlatformVerificationEntry(
  modelId: string,
  entry: PlatformVerificationEntry
): Promise<void> {
  const all = await readPlatformVerification();
  all[modelId] = entry;
  await mkdir(path.dirname(VERIFICATION_PATH), { recursive: true });
  await writeFile(VERIFICATION_PATH, JSON.stringify(all, null, 2), 'utf8');
}

/** কেবল লাইভ-যাচাইকৃত মডেল — /api/v1/models-এর ভিত্তি */
export function verifiedPlatformModels(
  verifications: PlatformVerificationFile
): Array<{ model: PlatformModel; verification: PlatformVerificationEntry }> {
  const out: Array<{ model: PlatformModel; verification: PlatformVerificationEntry }> = [];
  for (const model of PLATFORM_MODELS) {
    const v = verifications[model.id];
    if (v?.ok) out.push({ model, verification: v });
  }
  return out;
}
