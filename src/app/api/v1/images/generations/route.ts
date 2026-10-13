// ============================================================
// POST /api/v1/images/generations — OpenAI-কম্প্যাটিবল ইমেজ
//
// model: cogview-3 (একমাত্র ইমেজ-মডেল)। প্রতিক্রিয়া:
//  { created, data: [{ b64_json, size }] }
// প্রকৃত ব্যাকেন্ড কল ~৬০-৯০ সেকেন্ড নেয় — ক্লায়েন্টের
// টাইমআউট সেই অনুযায়ী রাখুন।
// ============================================================

import { NextResponse } from 'next/server';
import { authenticateApiKey, logApiCall } from '@/lib/platform/api-keys';
import { findPlatformModel } from '@/lib/platform/platform-models';
import { bearerFrom, callPlatformImage, openAIError } from '@/lib/platform/gateway';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const t0 = Date.now();
  const endpoint = '/api/v1/images/generations';

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return openAIError(400, 'invalid_json', 'অনুরোধ-বডি বৈধ JSON নয়');
  }

  const modelId = typeof body.model === 'string' ? body.model : 'cogview-3';
  const model = findPlatformModel(modelId);
  if (!model || model.kind !== 'image') {
    return openAIError(
      404,
      'model_not_found',
      `ইমেজ-মডেল "${modelId}" নেই — একমাত্র ইমেজ-মডেল: cogview-3`,
      'model'
    );
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return openAIError(400, 'missing_prompt', '"prompt" ক্ষেত্র দিন', 'prompt');
  }
  const size = typeof body.size === 'string' ? body.size : undefined;

  const auth = await authenticateApiKey(bearerFrom(req), modelId);
  if (!auth.ok) {
    return openAIError(auth.status, auth.code, auth.message);
  }

  const result = await callPlatformImage({ model, prompt, size });
  if ('error' in result) {
    await logApiCall({
      keyId: auth.key.id,
      endpoint,
      model: modelId,
      status: result.status,
      latencyMs: Date.now() - t0,
      error: result.error.message,
    });
    return openAIError(result.status, result.error.code, result.error.message);
  }
  await logApiCall({
    keyId: auth.key.id,
    endpoint,
    model: modelId,
    status: 200,
    latencyMs: Date.now() - t0,
  });
  return NextResponse.json(result.json);
}
