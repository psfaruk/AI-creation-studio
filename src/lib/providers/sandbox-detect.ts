// ============================================================
// Provider Adapter Layer — sandbox প্রমাণীকরণ-সনাক্তকরণ (Phase 1)
//
// z-ai-web-dev-sdk (v0.0.18) কীভাবে প্রমাণীকরণ করে (SDK-সোর্স থেকে
// যাচাইকৃত, dist/index.js loadConfig): অগ্রাধিকার-ক্রমে তিনটি পথে
// JSON কনফিগ { baseUrl, apiKey, ... } খোঁজে —
//   ১. process.cwd()/.z-ai-config
//   ২. ~/.z-ai-config (home ডিরেক্টরি)
//   ৩. /etc/.z-ai-config
// কোনোটি বৈধ না পেলে ZAI.create() তৎক্ষণাৎ থ্রো করে
// ("Configuration file not found or invalid ...")।
//
// এই স্যান্ডবক্সে /etc/.z-ai-config আছে (গিট-ইগনোরড, GitHub-রিপোতে নেই —
// Phase 0 নিরাপত্তা-যাচাই)। Railway-ধরনের পরিবেশে থাকবে না → সব SDK-কল
// getZAI()-র প্রিফ্লাইট-গার্ডে সৎ ProviderUnavailableError পাবে।
//
// নিরাপত্তা-নিয়ম: এই মডিউল কখনো কনফিগের *বিষয়বস্তু* পড়ে না/লগ করে না —
// শুধু অস্তিত্ব ও আকৃতি (baseUrl+apiKey স্ট্রিং) যাচাই করে।
// ============================================================

import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { ProviderUnavailableError } from './errors';

/** SDK-র অগ্রাধিকার-ক্রম অনুযায়ী ডিফল্ট কনফিগ-পথ (আপেক্ষিক নয়) */
export function defaultZaiConfigPaths(): string[] {
  return [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ];
}

interface ZaiConfigShape {
  baseUrl: unknown;
  apiKey: unknown;
}

/** একটি ফাইল বৈধ SDK-কনফিগ কি না — বিষয়বস্তু প্রকাশ ছাড়াই আকৃতি-যাচাই */
function isValidZaiConfigFile(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as ZaiConfigShape;
    return typeof parsed?.baseUrl === 'string' && parsed.baseUrl.length > 0 &&
      typeof parsed?.apiKey === 'string' && parsed.apiKey.length > 0;
  } catch {
    return false;
  }
}

const g = globalThis as unknown as {
  __zaiConfigDetected?: boolean;
};

/**
 * z-ai-web-dev-sdk-র প্রমাণীকরণ এই প্রসেসে উপলব্ধ কি না।
 * ডিফল্ট-পথে সনাক্তকরণ প্রসেসে একবার মেমোয়াইজ হয় (কনফিগ রানটাইমে
 * বদলায় না; SDK-সিঙ্গেলটনের আচরণেরই সামঞ্জস্য)।
 *
 * @param explicitPaths টেস্ট-বিচ্ছিন্নতার জন্য — দিলে মেমো বাদে ওই
 *   পথগুলোতেই সনাক্তকরণ চলে (ক্রমানুসারে প্রথম বৈধটি জয়ী — SDK-সমান)।
 */
export function zAiConfigured(explicitPaths?: string[]): boolean {
  const paths = explicitPaths ?? defaultZaiConfigPaths();
  if (explicitPaths) {
    return paths.some(isValidZaiConfigFile);
  }
  if (typeof g.__zaiConfigDetected !== 'boolean') {
    g.__zaiConfigDetected = paths.some(isValidZaiConfigFile);
  }
  return g.__zaiConfigDetected;
}

/** টেস্ট-সহায়ক: মেমো-ক্যাশ রিসেট (প্রোডাকশন-কোডে ব্যবহার নিষিদ্ধ) */
export function __resetZaiConfigDetectionCache(): void {
  delete g.__zaiConfigDetected;
}

/**
 * প্রিফ্লাইট-গার্ড: কনফিপ না থাকলে সৎ ProviderUnavailableError।
 * explicitPaths টেস্টে দেওয়া যায় (নির্দিষ্ট পথে সনাক্তকরণ)।
 */
export function assertZaiConfiguredOrThrow(label: string, explicitPaths?: string[]): void {
  if (!zAiConfigured(explicitPaths)) {
    throw new ProviderUnavailableError(zaiUnavailableMessage(label));
  }
}

/**
 * ZAI.create()-এর ত্রুটি শ্রেণিবিভাগ — কনফিপ-অনুপস্থিতি জাতীয় ত্রুটিকে
 * সৎ ProviderUnavailableError-এ মোড়ে; বাকি সব অপরিবর্তিত পুনঃনিক্ষেপ।
 * (খাঁটি ফাংশন — mock ছাড়াই টেস্টযোগ্য।)
 */
export function classifyZaiCreateError(err: unknown, label: string): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Configuration file not found|\.z-ai-config/i.test(msg)) {
    return new ProviderUnavailableError(zaiUnavailableMessage(label));
  }
  return err instanceof Error ? err : new Error(msg);
}

/** অনুপলব্ধ-হলে সৎ, কার্যকর বার্তা (UI-তে সরাসরি দেখায়) */
export function zaiUnavailableMessage(label: string): string {
  return (
    `${label} — এই পরিবেশে z-ai-web-dev-sdk-র প্রমাণীকরণ নেই ` +
    `(.z-ai-config কনফিগ-ফাইল অনুপস্থিত; এটি এই স্যান্ডবক্সের অভ্যন্তরীণ ক্রেডেনশিয়াল, ` +
    `প্রোডাকশনে বহনযোগ্য নয়)। বিকল্প: চ্যাটে ইউজার-কীসহ external GLM (Z.ai API/BigModel), ` +
    `অথবা Phase 3-এ Hugging Face রাউটার-অ্যাডাপ্টার যুক্ত হবে ` +
    `(docs/audit/railway-hf-deployment/)`
  );
}
