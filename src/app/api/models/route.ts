// ============================================================
// GET  /api/models → চ্যাট-মডেল ক্যাটালগ + ক্যাশ-করা যাচাই-স্ট্যাটাস
//                      + এক্সটার্নাল প্রোভাইডারের কী-অবস্থা (মাস্কড)
// POST /api/models → মডেলগুলোর রিয়েল-টাইম যাচাই
//
// সততার নিয়ম:
//  - যাচাই = প্রকৃত API কল (এক-শব্দের প্রম্পট), ফলাফল ডিস্কে ক্যাশ (TTL ৬ ঘণ্টা)
//  - 429 দেখলে ok:false নয়, rateLimited:true — "অযাচাই (রেট-লিমিট)"
//  - Z.ai SDK-গ্রুপ: সব মডেল একই পাইপ → টানা ২টি ৪২৯ এলে বাকিগুলোকে
//    ডাক ছাড়াই skippedBySharedWindow দেখানো হয় (বাজেট নষ্ট না করে সৎ)
//  - এক্সটার্নাল: কী নেই → needsKey (কোনো ডাক নয়); কী থাকলে প্রকৃত
//    প্রোভাইডারে ছোট কল — প্রতিটি মডেল আলাদাভাবে সত্যায়িত হয়
// ============================================================
import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { requireOwner } from '@/lib/security';
import { getZAI } from '@/lib/agent/llm';
import { getProviderKey, providerKeyStatuses, type ProviderKeyStatus } from '@/lib/agent/provider-keys';
import { verifyExternalModel } from '@/lib/agent/external-llm';
import {
  CHAT_MODELS,
  EXTERNAL_PROVIDER_ORDER,
  type ModelVerificationEntry,
  type ModelVerificationFile,
} from '@/lib/agent/chat-models';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFY_CACHE_PATH = path.join(process.cwd(), 'storage', 'model-verification.json');
/** যাচাই-ফলাফলের TTL — ৬ ঘণ্টা */
const VERIFY_TTL_MS = 6 * 60 * 60 * 1000;
/** এক যাচাই-কলের টাইমআউট */
const SINGLE_TEST_TIMEOUT_MS = 30_000;
/** Z.ai মডেলগুলোর মাঝে গ্যাপ (৪২৯ এড়াতে) */
const INTER_MODEL_GAP_MS = 2500;
/** Z.ai-গ্রুপে টানা কতটি ৪২9-এর পরে বাকিগুলো স্কিপ হবে (শেয়ার্ড পাইপ) */
const ZAI_429_EARLY_STOP = 2;

async function loadVerification(): Promise<ModelVerificationFile> {
  try {
    const raw = await readFile(VERIFY_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as ModelVerificationFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveVerification(file: ModelVerificationFile): Promise<void> {
  try {
    await mkdir(path.dirname(VERIFY_CACHE_PATH), { recursive: true });
    await writeFile(VERIFY_CACHE_PATH, JSON.stringify(file, null, 2), 'utf8');
  } catch {
    // নীরব — ক্যাশ-লেখা ব্যর্থ হলে যাচাই তবুও ফেরে
  }
}

function isFresh(entry: ModelVerificationEntry | undefined): boolean {
  if (!entry) return false;
  const age = Date.now() - Date.parse(entry.testedAt);
  return Number.isFinite(age) && age >= 0 && age < VERIFY_TTL_MS;
}

/** একটি Z.ai SDK-মডেলের প্রকৃত প্রাপ্যতা-যাচাই (৪২৯ → rateLimited) */
async function verifyZaiOne(
  zai: Awaited<ReturnType<typeof getZAI>>,
  model: string
): Promise<ModelVerificationEntry> {
  const t0 = Date.now();
  try {
    const body = {
      messages: [{ role: 'user' as const, content: 'Reply with exactly one word: ok' }],
      thinking: { type: 'disabled' as const },
      ...(model ? { model } : {}),
    };
    const res = await Promise.race([
      zai.chat.completions.create(body),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('যাচাই-টাইমআউট')), SINGLE_TEST_TIMEOUT_MS)
      ),
    ]);
    const content = res?.choices?.[0]?.message?.content ?? '';
    const ok = typeof content === 'string' && content.trim().length > 0;
    return {
      ok,
      servedModel: res?.model ?? res?.choices?.[0]?.model ?? undefined,
      ms: Date.now() - t0,
      testedAt: new Date().toISOString(),
      ...(ok ? {} : { error: 'খালি উত্তর' }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/429|Too many requests/i.test(msg)) {
      return {
        ok: false,
        rateLimited: true,
        error: 'রেট-লিমিট (৪২৯) — সাময়িক; পরে আবার যাচাই করুন',
        testedAt: new Date().toISOString(),
      };
    }
    return { ok: false, error: msg.slice(0, 150), testedAt: new Date().toISOString() };
  }
}

/** একটি এক্সটার্নাল মডেলের প্রকৃত প্রাপ্যতা-যাচাই (রিয়েল OpenAI SDK দিয়ে প্রোভাইডারের আসল API-তে) — external-llm.ts */

async function buildResponse(verification: ModelVerificationFile, testedCount: number) {
  const providers = await providerKeyStatuses();
  return NextResponse.json({
    models: CHAT_MODELS.map(m => ({
      ...m,
      verification: verification[m.id] ?? null,
    })),
    providers,
    testedCount,
  });
}

/** GET → ক্যাটালগ + ক্যাশ-করা যাচাই + কী-অবস্থা (নতুন কল করে না) */
export async function GET(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const verification = await loadVerification();
  return buildResponse(verification, 0);
}

/** POST → যাচাই চালাও (ক্যাশ সদ্যিষ্ট না হলে) ও ফলাফল ফেরাও */
export async function POST(req: Request) {
  const auth = await requireOwner(req);
  if (!auth.ok) return auth.response;

  const zai = await getZAI();
  const verification = await loadVerification();
  const keyStatuses = await providerKeyStatuses();
  let tested = 0;

  // ---- ১. Z.ai SDK-গ্রুপ: সিরিয়াল + শেয়ার্ড-৪২৯ আর্লি-স্টপ ----
  const zaiModels = CHAT_MODELS.filter(m => m.provider === 'zai');
  let consecutive429 = 0;
  let sharedWindowHit = false;
  for (const m of zaiModels) {
    if (isFresh(verification[m.id])) continue;
    if (sharedWindowHit) {
      // একই পাইপে টানা ৪২৯ — বাকিদের ডাক ছাড়াই সৎ-স্কিপ (বাজেট বাঁচাও)
      verification[m.id] = {
        ok: false,
        rateLimited: true,
        skippedBySharedWindow: true,
        error: 'Z.ai SDK-র সব মডেল একই ব্যাকএন্ড পাইপ ভাগ করে — শেয়ার্ড ৪২৯-উইন্ডোতে এই মডেলটি আলাদাভাবে ডাকা হয়নি',
        testedAt: new Date().toISOString(),
      };
      continue;
    }
    verification[m.id] = await verifyZaiOne(zai, m.id);
    tested++;
    await saveVerification(verification);
    if (verification[m.id].rateLimited) {
      consecutive429++;
      if (consecutive429 >= ZAI_429_EARLY_STOP) sharedWindowHit = true;
    } else {
      consecutive429 = 0;
    }
    await new Promise(r => setTimeout(r, INTER_MODEL_GAP_MS));
  }

  // ---- ২. এক্সটার্নাল প্রোভাইডার: কী অনুযায়ী ----
  for (const provider of EXTERNAL_PROVIDER_ORDER) {
    const models = CHAT_MODELS.filter(m => m.provider === provider);
    const status: ProviderKeyStatus | undefined = keyStatuses[provider];
    if (!status?.hasKey) {
      // কী নেই — প্রতিটি মডেলে সৎ needsKey (কোনো ডাক নয়)
      for (const m of models) {
        if (isFresh(verification[m.id]) && !verification[m.id]?.needsKey) continue;
        verification[m.id] = await verifyExternalModel(m, null);
      }
      continue;
    }
    // কী আছে — প্রতিটি মডেলে প্রকৃত ছোট কল (রিয়েল OpenAI SDK দিয়ে;
    // প্রতিটি মডেল আলাদাভাবে সত্যায়িত হয়)
    const key = await getProviderKey(provider);
    const pending = models.filter(m => !isFresh(verification[m.id]));
    if (pending.length === 0) continue;
    const keyResults = await Promise.all(
      pending.map(async m => {
        const entry = await verifyExternalModel(m, key);
        return [m.id, entry] as const;
      })
    );
    for (const [id, entry] of keyResults) {
      verification[id] = entry;
      tested++;
    }
    await saveVerification(verification);
  }

  await saveVerification(verification);
  return buildResponse(verification, tested);
}
