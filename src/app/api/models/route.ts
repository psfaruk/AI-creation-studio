// ============================================================
// GET  /api/models → চ্যাট-মডেল ক্যাটালগ + ক্যাশ-করা যাচাই-স্ট্যাটাস
// POST /api/models → মডেলগুলোর রিয়েল-টাইম যাচাই (ছোট বাজেটে,
//                     429-এ "অযাচাই" লেবেল — মিথ্যা "অনুপলব্ধ" নয়)
//
// সততার নিয়ম:
//  - যাচাই = প্রকৃত API কল (এক-শব্দের প্রম্পট), ফলাফল ডিস্কে ক্যাশ (TTL ৬ ঘণ্টা)
//  - 429 দেখলে ok:false নয়, rateLimited:true — "অযাচাই (রেট-লিমিট)"
//  - ক্যাটালগে থাকা মডেল যাচাই-ব্যর্থ হলেও ব্যবহারকারী বেছে নিতে পারেন;
//    চ্যাট-চলাকালীন সৎ-ফলব্যাক ব্যবস্থা আছে (orchestrator)
// ============================================================
import { NextResponse } from 'next/server';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getZAI } from '@/lib/agent/llm';
import { CHAT_MODELS, type ModelVerificationEntry, type ModelVerificationFile } from '@/lib/agent/chat-models';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERIFY_CACHE_PATH = path.join(process.cwd(), 'storage', 'model-verification.json');
/** যাচাই-ফলাফলের TTL — ৬ ঘণ্টা */
const VERIFY_TTL_MS = 6 * 60 * 60 * 1000;
/** এক যাচাই-কলের টাইমআউট */
const SINGLE_TEST_TIMEOUT_MS = 30_000;
/** মডেলগুলোর মাঝে গ্যাপ (৪২৯ এড়াতে) */
const INTER_MODEL_GAP_MS = 2500;

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

/** একটি মডেলের প্রকৃত প্রাপ্যতা-যাচাই (৪২৯ → rateLimited, অন্যান্য → সৎ ফলাফল) */
async function verifyOne(
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

/** GET → ক্যাটালগ + ক্যাশ-করা যাচাই (নতুন কল করে না) */
export async function GET() {
  const verification = await loadVerification();
  return NextResponse.json({
    models: CHAT_MODELS.map(m => ({
      ...m,
      verification: verification[m.id] ?? null,
    })),
  });
}

/** POST → যাচাই চালাও (ক্যাশ সদ্যিষ্ট না হলে) ও ফলাফল ফেরাও */
export async function POST() {
  const zai = await getZAI();
  const verification = await loadVerification();
  let tested = 0;

  for (const m of CHAT_MODELS) {
    if (isFresh(verification[m.id])) continue; // সদ্যিষ্ট ক্যাশ — আবার খরচ নয়
    verification[m.id] = await verifyOne(zai, m.id);
    tested++;
    await saveVerification(verification);
    if (tested > 0) await new Promise(r => setTimeout(r, INTER_MODEL_GAP_MS));
  }

  return NextResponse.json({
    models: CHAT_MODELS.map(m => ({
      ...m,
      verification: verification[m.id] ?? null,
    })),
    testedCount: tested,
  });
}
