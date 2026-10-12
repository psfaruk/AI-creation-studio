// ============================================================
// scripts/verify-chat-models.ts
// স্লো ব্যাকগ্রাউন্ড মডেল-যাচাই — 429-উইন্ডোর মধ্যেও বেঁচে থাকে।
//
// চালানো: bun scripts/verify-chat-models.ts
// আউটপুট: storage/model-verification.json — ঠিক যে ফাইলটা
//          GET/POST /api/models পড়ে, তাই উইন্ডো খুললেই UI-ব্যাজ
//          স্বয়ংক্রিয়ভাবে সত্য হয়ে যায়।
//
// নিয়ম:
//  - ok=true এন্ট্রি আর ছুঁয়ে না (নিশ্চিত উত্তর)।
//  - 429 হলে ৯০ সে. অপেক্ষা (মোট ৬ চেষ্টা), উইন্ডো খুলতেই যাচাই।
//  - 429-বিহীন ত্রুটি = চূড়ান্ত উত্তর (যেমন "model not found")।
//  - মডেলগুলোর মাঝে ৩০ সে. গ্যাপ — সার্ভারে চাপ না দিয়ে।
// ============================================================
import ZAI from 'z-ai-web-dev-sdk';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'storage', 'model-verification.json');
const CANDIDATES = [
  '', // SDK default
  'glm-4.6',
  'glm-4.5',
  'glm-4.5-air',
  'glm-4.5-flash',
  'glm-4-flash',
  'glm-4-plus',
  'glm-4-air',
  'glm-4-long',
  'glm-4v',
  'glm-4.1v',
  'glm-4v-flash',
  'glm-3-turbo',
];

const MAX_ATTEMPTS = 6;
const RETRY_WAIT_MS = 90_000;
const INTER_MODEL_GAP_MS = 30_000;

interface Entry {
  ok: boolean;
  servedModel?: string;
  ms?: number;
  rateLimited?: boolean;
  error?: string;
  testedAt: string;
}

function load(): Record<string, Entry> {
  try {
    if (!existsSync(OUT)) return {};
    const parsed = JSON.parse(readFileSync(OUT, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function save(results: Record<string, Entry>) {
  try {
    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(results, null, 2));
  } catch {
    // নীরব
  }
}

const zai = await ZAI.create();
const results = load();

for (const model of CANDIDATES) {
  const key = model; // ফাইলের কী = মডেল id ('' সহ)
  if (results[key]?.ok) {
    console.log(`↷ ${key || '(default)'} — ইতিমধ্যে যাচাইকৃত, বাদ`);
    continue;
  }

  let done = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
    const t0 = Date.now();
    try {
      const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
        thinking: { type: 'disabled' },
      };
      if (model) body.model = model;
      const res = await zai.chat.completions.create(body as never);
      const content = res?.choices?.[0]?.message?.content ?? '';
      const servedModel = res?.model ?? res?.choices?.[0]?.model ?? '?';
      const ok = typeof content === 'string' && content.trim().length > 0;
      results[key] = {
        ok,
        ...(servedModel ? { servedModel: String(servedModel) } : {}),
        ms: Date.now() - t0,
        ...(ok ? {} : { error: 'খালি উত্তর' }),
        testedAt: new Date().toISOString(),
      };
      console.log(
        `${ok ? '✅' : '⚠️ '} ${key || '(default)'} served=${servedModel} ${Date.now() - t0}ms`
      );
      done = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is429 = /status 429|Too many requests/i.test(msg);
      if (!is429) {
        results[key] = { ok: false, error: msg.slice(0, 150), testedAt: new Date().toISOString() };
        console.log(`❌ ${key || '(default)'}: ${msg.slice(0, 100)}`);
        done = true; // 429-নয় = চূড়ান্ত উত্তর
      } else if (attempt < MAX_ATTEMPTS) {
        console.log(`⏳ ${key || '(default)'} 429 (চেষ্টা ${attempt}/${MAX_ATTEMPTS}) — ৯০ সে. অপেক্ষা…`);
        await new Promise(r => setTimeout(r, RETRY_WAIT_MS));
      } else {
        results[key] = {
          ok: false,
          rateLimited: true,
          error: 'রেট-লিমিট (৪২৯) — সাময়িক; পরে আবার যাচাই করুন',
          testedAt: new Date().toISOString(),
        };
        console.log(`⏳ ${key || '(default)'} — এই রাউন্ডে 429-ই থাকল, পরে আবার চালান`);
      }
    }
  }
  save(results);
  await new Promise(r => setTimeout(r, INTER_MODEL_GAP_MS));
}

const okCount = Object.values(results).filter(r => r.ok).length;
console.log(`\nসারসংক্ষেপ: ${okCount}/${CANDIDATES.length} মডেল যাচাইকৃত কাজ করছে → ${OUT}`);
