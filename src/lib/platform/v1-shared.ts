// ============================================================
// /api/v1 — অ্যাপের নিজস্ব OpenAI-কম্প্যাটিবল API-র সাঝা সহায়ক।
//
//  - resolveV1Model: OpenAI-ক্লায়েন্টের model-স্ট্রিং → অ্যাপের
//    GLM-ক্যাটালগ-আইডি রাউটিং (সৎ, কোনো নীরব-ফলব্যাক নয়)
//  - V1_MODEL_CATALOG: GET /api/v1/models-এর তালিকা
//  - CORS হেডার-সেট (বাইরের OpenAI-ক্লায়েন্টের জন্য)
//  - Bearer-যাচাই: প্ল্যাটফর্ম-কী বা মালিক-সেশন
// ============================================================

import { CHAT_MODELS, isValidChatModelId } from '@/lib/agent/chat-models';
import { isSessionTokenValid } from '@/lib/security';
import { verifyPlatformKey } from '@/lib/platform/platform-key';

/** /api/v1-এ প্রকাশিত মডেল-আইডি ও মালিক (owned_by) */
export interface V1ModelInfo {
  id: string;
  ownedBy: string;
  /** কী লাগবে কি? */
  needsKey: boolean;
}

/**
 * প্রকাশিত তালিকা — প্রতিটি আইডি প্রকৃত GLM-ব্যাকএন্ডে রাউট হয়:
 *  - glm-4-plus      → Z.ai SDK বিল্ট-ইন পাইপ (কী লাগে না; served = glm-4-plus)
 *  - glm-5.3 / flash → Z.ai API (নিজের কী, আলাদা কোটা)
 *  - glm-4-flash/air, glm-plus-cn → Zhipu BigModel (নিজের কী)
 */
export const V1_MODEL_CATALOG: V1ModelInfo[] = [
  { id: 'glm-4-plus', ownedBy: 'zai-sdk', needsKey: false },
  { id: 'glm-5.3', ownedBy: 'zai-api', needsKey: true },
  { id: 'glm-5.3-flash', ownedBy: 'zai-api', needsKey: true },
  { id: 'glm-4-flash', ownedBy: 'bigmodel', needsKey: true },
  { id: 'glm-4-air', ownedBy: 'bigmodel', needsKey: true },
  { id: 'glm-plus-cn', ownedBy: 'bigmodel', needsKey: true },
  // ইউজারের নিজের কাস্টম/লোকাল এন্ডপয়েন্ট (কী-ডায়ালগে কনফিগ করা)
  { id: 'custom-model', ownedBy: 'custom', needsKey: false },
];

/**
 * ক্লায়েন্টের model-স্ট্রিং → অ্যাপ-ক্যাটালগ আইডি।
 *  - '' / 'default' / 'glm-4-plus' → '' (SDK ডিফল্ট — served glm-4-plus)
 *  - ক্যাটালগ-আইডি (zai-glm-5.3, glm-air-cn, …) → সরাসরি
 *  - এক্সটার্নাল apiModel (glm-5.3, glm-4-flash, …) → সেই এন্ট্রি
 *  - অজানা → null (= 404 model_not_found)
 */
export function resolveV1Model(raw: unknown): string | null {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  const id = raw.trim();
  if (id === '') return '';
  // (type-guard-ন্যারোয়িং এড়াতে lower আগেই হিসাব) 'default' = SDK ডিফল্ট
  const lower = id.toLowerCase();
  if (lower === 'default') return '';
  // 'glm-4-plus' খালি-নাম = SDK বিল্ট-ইন পাইপ (served মডেলই glm-4-plus,
  // কী লাগে না) — BigModel-এর একই-নামের apiModel-এ যাবে না; নিজের কী-কোটায়
  // BigModel-এর glm-4-plus চাইলে 'glm-plus-cn' ব্যবহার করুন।
  if (lower === 'glm-4-plus') return '';
  if (isValidChatModelId(id)) return id;
  // খালি নামের SDK-এন্ট্রি ছাড়া apiModel-মিল (glm-4-plus বাদ — উপরে SDK-তে গেছে)
  const byApiModel = CHAT_MODELS.find(
    m => m.id !== '' && m.apiModel && m.apiModel.toLowerCase() === lower
  );
  if (byApiModel) return byApiModel.id;
  return null;
}

/** /api/v1-এর CORS — বাইরের ক্লায়েন্ট (Chatbox, Open WebUI, curl …) সাপোর্ট */
export const V1_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** OpenAI-স্টাইল ত্রুটি-দেহ */
export function v1Error(
  status: number,
  message: string,
  type: 'invalid_request_error' | 'authentication_error' | 'not_found_error' | 'rate_limit_error' | 'server_error',
  code?: string
): Response {
  return new Response(
    JSON.stringify({ error: { message, type, ...(code ? { code } : {}) } }),
    {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...V1_CORS_HEADERS },
    }
  );
}

export interface V1AuthResult {
  ok: boolean;
  response?: Response;
  /** রেট-লিমিট-কী (কী-এর আঙুলাছাপ — পুরো কী নয়) */
  fingerprint?: string;
}

/** Bearer-যাচাই — প্ল্যাটফর্ম-কী বা মালিক-সেশন-টোকেন */
export async function v1RequireBearer(req: Request): Promise<V1AuthResult> {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) {
    return {
      ok: false,
      response: v1Error(
        401,
        'Missing bearer token — Authorization: Bearer <প্ল্যাটফর্ম-কী বা মালিক-সেশন টোকেন> দিন',
        'authentication_error'
      ),
    };
  }
  const token = m[1].trim();
  if (token.length < 8 || token.length > 500) {
    return { ok: false, response: v1Error(401, 'অবৈধ bearer টোকেন', 'authentication_error') };
  }
  const platformOk = await verifyPlatformKey(token);
  if (platformOk) {
    return { ok: true, fingerprint: token.slice(0, 14) };
  }
  const sessionOk = await isSessionTokenValid(token);
  if (sessionOk) {
    return { ok: true, fingerprint: 'owner-session' };
  }
  return { ok: false, response: v1Error(401, 'অবৈধ বা মেয়াদোত্তীর্ণ টোকেন', 'authentication_error') };
}
