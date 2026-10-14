// ============================================================
// GET /api/v1/models — OpenAI-কম্প্যাটিবল মডেল-তালিকা।
//
// বাইরের OpenAI-ক্লায়েন্ট (Chatbox, Open WebUI, curl, …) এই
// অ্যাপটিকে Base URL হিসেবে ব্যবহার করতে পারে:
//   Base URL: https://<এই-অ্যাপ>/api/v1
//   API Key:  amai_sk_… (স্টুডিওর কী-ডায়ালগ থেকে)
// ============================================================

import { V1_CORS_HEADERS, V1_MODEL_CATALOG, v1RequireBearer, v1Error } from '@/lib/platform/v1-shared';
import { checkRateLimit } from '@/lib/limits';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** CORS প্রি-ফ্লাইট */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: V1_CORS_HEADERS });
}

export async function GET(req: Request) {
  const auth = await v1RequireBearer(req);
  if (!auth.ok) return auth.response ?? v1Error(401, 'অননুমোদিত', 'authentication_error');

  const rl = checkRateLimit(`v1:${auth.fingerprint ?? 'anon'}`, 60, 60_000);
  if (!rl.allowed) {
    return v1Error(429, `রেট-লিমিট — ${rl.retryAfterSec ?? 60} সেকেন্ড পরে আবার`, 'rate_limit_error');
  }

  const created = Math.floor(Date.now() / 1000);
  return Response.json(
    {
      object: 'list',
      data: V1_MODEL_CATALOG.map(m => ({
        id: m.id,
        object: 'model',
        created,
        owned_by: m.ownedBy,
      })),
    },
    { headers: V1_CORS_HEADERS }
  );
}
