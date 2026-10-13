// ============================================================
// POST /api/v1/chat/completions — OpenAI-কম্প্যাটিবল চ্যাট
//
// মডেল-রাউটিং (ব্যাকেন্ড-সত্য অনুযায়ী):
//  - glm-4-plus   → SDK চ্যাট-পাইপ (টেক্সট)
//  - glm-5v-turbo → SDK ভিশন-পাইপ (চিত্র+টেক্সট; served-model
//                   glm-5v-turbo হিসেবেই ফেরে)
//
// stream: true → SSE পাসথ্রু (data: {…chat.completion.chunk…})।
// প্রতিটি কল কী-লগে যায়; কী কেবল তার বাঁধা মডেলেই ডাকতে পারে।
// ============================================================

import { NextResponse } from 'next/server';
import { authenticateApiKey, logApiCall } from '@/lib/platform/api-keys';
import { findPlatformModel } from '@/lib/platform/platform-models';
import {
  bearerFrom,
  callPlatformChat,
  openAIError,
  ssePassthroughResponse,
  type GatewayMessage,
} from '@/lib/platform/gateway';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: Request) {
  const t0 = Date.now();
  const endpoint = '/api/v1/chat/completions';

  // ---- বডি-পার্স ----
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return openAIError(400, 'invalid_json', 'অনুরোধ-বডি বৈধ JSON নয়');
  }

  const modelId = typeof body.model === 'string' ? body.model : '';
  if (!modelId) {
    return openAIError(400, 'missing_model', '"model" ক্ষেত্র দিন', 'model');
  }
  const model = findPlatformModel(modelId);
  if (!model || model.kind === 'image') {
    return openAIError(
      404,
      'model_not_found',
      `মডেল "${modelId}" এই প্ল্যাটফর্মে নেই — তালিকা: glm-4-plus, glm-5v-turbo (চ্যাট) · cogview-3 (/api/v1/images/generations)`,
      'model'
    );
  }

  const rawMessages = body.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return openAIError(400, 'missing_messages', '"messages" অবশ্যই অ-খালি অ্যারে', 'messages');
  }
  const messages: GatewayMessage[] = [];
  for (const m of rawMessages) {
    if (!m || typeof m !== 'object') continue;
    const mm = m as Record<string, unknown>;
    const role = mm.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') continue;
    messages.push({ role, content: mm.content });
  }
  if (messages.length === 0) {
    return openAIError(400, 'invalid_messages', 'কোনো বৈধ বার্তা পাওয়া যায়নি', 'messages');
  }

  const stream = body.stream === true;
  const temperature = typeof body.temperature === 'number' ? body.temperature : undefined;
  const maxTokens =
    typeof body.max_tokens === 'number'
      ? body.max_tokens
      : typeof body.max_completion_tokens === 'number'
        ? (body.max_completion_tokens as number)
        : undefined;

  // ---- কী-যাচাই (মডেল-বাইন্ডিংসহ) ----
  // (ব্যর্থ-প্রমাণীকরণ লগ করা হয় না — কী-পরিচয়ই অজানা)
  const auth = await authenticateApiKey(bearerFrom(req), modelId);
  if (!auth.ok) {
    return openAIError(auth.status, auth.code, auth.message);
  }

  // ---- ব্যাকেন্ড কল ----
  const result = await callPlatformChat({
    model,
    messages,
    stream,
    temperature,
    maxTokens,
    defaultLanguage: auth.key.defaultLanguage,
  });

  if (result.status !== 200 || result.error) {
    await logApiCall({
      keyId: auth.key.id,
      endpoint,
      model: modelId,
      status: result.status,
      latencyMs: Date.now() - t0,
      error: result.error?.message ?? 'অজানা ত্রুটি',
    });
    return openAIError(result.status, result.error?.code ?? 'api_error', result.error?.message ?? 'ত্রুটি');
  }

  if (stream && result.streamBody) {
    return ssePassthroughResponse(result.streamBody, auth.key.id, endpoint, modelId);
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
