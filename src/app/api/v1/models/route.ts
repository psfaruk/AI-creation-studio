// ============================================================
// GET /api/v1/models — OpenAI-কম্প্যাটিবল মডেল-তালিকা
//
// "This platform only lists models verified with live API calls
//  — no fake labels."
// কেবল লাইভ-যাচাইকৃত মডেলই তালিকাভুক্ত; প্রতিটির সাথে
// served_model (ব্যাকেন্ড সত্যিই যা সার্ভ করে) ও যাচাই-সময়।
//
// Auth: Authorization: Bearer amai_sk_… (নিজের কী; যেকোনো মডেলের
// কী দিয়েই পুরো তালিকা পড়া যায় — কল করা যায় কেবল বাঁধা মডেলে)।
// ============================================================

import { NextResponse } from 'next/server';
import { authenticateApiKey } from '@/lib/platform/api-keys';
import { readPlatformVerification, verifiedPlatformModels } from '@/lib/platform/platform-models';
import { bearerFrom, openAIError } from '@/lib/platform/gateway';
import { logApiCall } from '@/lib/platform/api-keys';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const t0 = Date.now();
  const auth = await authenticateApiKey(bearerFrom(req));
  if (!auth.ok) {
    if (auth.status === 401) return openAIError(401, auth.code, auth.message);
    return openAIError(auth.status, auth.code, auth.message);
  }
  const verifications = await readPlatformVerification();
  const verified = verifiedPlatformModels(verifications);
  await logApiCall({
    keyId: auth.key.id,
    endpoint: '/api/v1/models',
    model: null,
    status: 200,
    latencyMs: Date.now() - t0,
  });
  return NextResponse.json({
    object: 'list',
    data: verified.map(({ model, verification }) => ({
      id: model.id,
      object: 'model',
      created: Math.floor(Date.parse(verification.testedAt) / 1000),
      owned_by: 'platform',
      kind: model.kind,
      served_model: verification.servedModel ?? model.id,
      last_verified_at: verification.testedAt,
      context_window_tokens: model.contextK ? model.contextK * 1000 : undefined,
      ...(model.kind === 'image' ? { sizes: model.sizes } : {}),
    })),
  });
}
