// ============================================================
// Tool Registry — সব টুলের কেন্দ্রীয় তালিকা।
// - মূল ৮টি এজেন্ট টুল (নিচেই সংজ্ঞায়িত)
// - স্টুডিও টুলগুলো tools/{image,audio,video,production}.ts থেকে
// প্রতিটি টুলে zod validation + timeout + usage (LLM-নির্দেশিকা)।
// যেকোনো ব্যর্থতা throw হিসেবে ওঠে — orchestrator ধরে structured
// error বানিয়ে LLM-কে ফেরত দেয় (কখনো uncaught নয়)।
// ============================================================

import { z } from 'zod';
import { db } from '@/lib/db';
import { getZAI } from './llm';
import { detectLanguage, synthesizeVerifiedSpeech, verdictLabel, type SpeechLanguage } from './audio/language_controller';
import { imageSearchSdkFirst, transcribeBuffer } from './sdk-helpers';
import { readArtifactFile, saveArtifactFile } from './storage';
import { toArtifactMeta } from './serialize';
import { createToolArtifact } from './registry-helpers';
import type { ToolContext, ToolOutput, ToolSpec, ToolValidation } from './registry-helpers';
import { IMAGE_TOOLS } from './tools/image';
import { AUDIO_TOOLS } from './tools/audio';
import { VIDEO_TOOLS } from './tools/video';
import { PRODUCTION_TOOLS } from './tools/production';

export type { ToolContext, ToolOutput, ToolSpec, ToolValidation } from './registry-helpers';
export { createToolArtifact, artifactToDataUrl, artifactFilePath } from './registry-helpers';

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

/** HTML → পরিষ্কার টেক্সট (script/style বাদ, entities ডিকোড, whitespace সংকোচন) */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** ম্যাচের চারপাশে ≤maxLen অক্ষরের snippet */
function makeSnippet(content: string, query: string, maxLen = 200): string {
  const idx = content.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return truncate(content.replace(/\s+/g, ' '), maxLen);
  const flat = content.replace(/\s+/g, ' ');
  const start = Math.max(0, idx - Math.floor(maxLen / 3));
  const end = Math.min(flat.length, start + maxLen);
  let s = flat.slice(start, end);
  if (start > 0) s = '…' + s;
  if (end < flat.length) s = s + '…';
  return s;
}

// ------------------------------------------------------------
// ১. web_search
// ------------------------------------------------------------
const webSearchSpec: ToolSpec<{ query: string; num?: number }> = {
  name: 'web_search',
  parameters: z.object({
    query: z.string().min(1).max(400),
    num: z.number().int().min(3).max(8).optional().default(6),
  }),
  timeoutMs: 60_000,
  usage: 'web_search — ইন্টারনেটে সর্বশেষ তথ্য খুঁজে আনে। arguments: {"query": string (১–৪০০ অক্ষর), "num"?: number (৩–৮, ডিফল্ট ৬)}',
  inputSummary: i => `খোঁজ: ${i.query}`,
  execute: async input => {
    const zai = await getZAI();
    const raw = await zai.functions.invoke('web_search', { query: input.query, num: input.num ?? 6 });
    const list: any[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.results)
        ? (raw as any).results
        : [];
    const items = list.slice(0, input.num ?? 6).map(r => ({
      title: String(r?.name ?? r?.title ?? ''),
      url: String(r?.url ?? ''),
      snippet: truncate(String(r?.snippet ?? ''), 500),
      date: r?.date ? String(r.date) : '',
    }));
    return {
      summary: `${items.length} টি ফলাফল পাওয়া গেছে`,
      resultJson: JSON.stringify(items),
    };
  },
};

// ------------------------------------------------------------
// ২. read_web_page
// ------------------------------------------------------------
const readWebPageSpec: ToolSpec<{ url: string }> = {
  name: 'read_web_page',
  parameters: z.object({ url: z.string().url() }),
  timeoutMs: 90_000,
  usage: 'read_web_page — নির্দিষ্ট ওয়েবপেজের পুরো বিষয়বস্তু পড়ে। arguments: {"url": string (সম্পূর্ণ http/https URL)}',
  inputSummary: i => i.url,
  execute: async input => {
    const zai = await getZAI();
    const r = await zai.functions.invoke('page_reader', { url: input.url });
    const data = (r as any)?.data ?? {};
    const html = String(data.html ?? '');
    const title = String(data.title || input.url);
    const text = truncate(stripHtml(html), 6000);
    if (!text) throw new Error('পেজ থেকে কোনো লেখা পাওয়া যায়নি');
    return {
      summary: title,
      resultJson: JSON.stringify({ title, url: String(data.url || input.url), text }),
    };
  },
};

// ------------------------------------------------------------
// ৩. generate_image
// ------------------------------------------------------------
const generateImageSpec: ToolSpec<{ prompt: string; size?: '1024x1024' | '1344x768' | '768x1344' }> = {
  name: 'generate_image',
  parameters: z.object({
    prompt: z.string().min(1).max(1500),
    size: z.enum(['1024x1024', '1344x768', '768x1344']).optional().default('1024x1024'),
  }),
  timeoutMs: 180_000,
  usage: 'generate_image — টেক্সট বর্ণনা থেকে AI দিয়ে নতুন ছবি আঁকে (প্রম্পট ইংরেজিতে দিলে সেরা)। arguments: {"prompt": string (১–১৫০০), "size"?: "1024x1024"|"1344x768"|"768x1344"}',
  inputSummary: i => truncate(i.prompt, 120),
  execute: async (input, ctx) => {
    const zai = await getZAI();
    const res = await zai.images.generations.create({
      prompt: input.prompt,
      size: input.size ?? '1024x1024',
    });
    const base64 = res?.data?.[0]?.base64;
    if (!base64) throw new Error('ছবি তৈরি হলেও ডেটা পাওয়া যায়নি');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length === 0) throw new Error('ছবির ডেটা খালি');
    const { storagePath, relName } = await saveArtifactFile(buf, 'png');
    const meta = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'image',
      mimeType: 'image/png',
      fileName: relName,
      size: buf.length,
      storagePath,
    });
    return {
      summary: 'ছবি তৈরি হয়েছে',
      resultJson: JSON.stringify({
        artifactId: meta.id,
        url: meta.url,
        fileName: meta.fileName,
        size: meta.size,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৪. search_images — SDK-প্রথম (zai.images.search, প্রোব-যাচাইকৃত
//    ২০২৬-১০-১১), ব্যর্থ হলে CLI ফলব্যাক (z-ai image-search)।
//    resultJson-এ via: 'sdk'|'cli' — কোন পথ ব্যবহৃত হলো।
// ------------------------------------------------------------
const searchImagesSpec: ToolSpec<{ query: string }> = {
  name: 'search_images',
  parameters: z.object({ query: z.string().min(1).max(400) }),
  timeoutMs: 240_000,
  usage: 'search_images — ওয়েব থেকে প্রাসঙ্গিক বাস্তব ছবি খুঁজে আনে। arguments: {"query": string}',
  inputSummary: i => `খোঁজ: ${i.query}`,
  execute: async (input, ctx) => {
    const outcome = await imageSearchSdkFirst(input.query, 4);
    const metas: any[] = [];
    const resultItems: { url: string; caption: string; source: string; width?: number; height?: number }[] = [];
    for (const r of outcome.results) {
      const meta = await createToolArtifact({
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        kind: 'image',
        mimeType: 'image/jpeg',
        fileName: truncate(r.caption || 'external image', 120),
        size: 0,
        storagePath: null,
        sourceUrl: r.url,
      });
      metas.push(meta);
      resultItems.push({
        url: r.url,
        caption: r.caption,
        source: r.source,
        ...(r.width ? { width: r.width } : {}),
        ...(r.height ? { height: r.height } : {}),
      });
    }
    if (metas.length === 0) throw new Error('কোনো ব্যবহারযোগ্য ছবি পাওয়া যায়নি');
    return {
      summary: `${metas.length} টি ছবি পাওয়া গেছে (${outcome.via === 'sdk' ? 'SDK-মেথড' : 'CLI-ফলব্যাক'})`,
      resultJson: JSON.stringify({ via: outcome.via, results: resultItems }),
      artifacts: metas,
    };
  },
};

// ------------------------------------------------------------
// ৫. analyze_image
// ------------------------------------------------------------
const analyzeImageSpec: ToolSpec<{ image: string; question: string }> = {
  name: 'analyze_image',
  parameters: z.object({
    image: z.string().min(1),
    question: z.string().min(1).max(2000),
  }),
  timeoutMs: 120_000,
  usage: 'analyze_image — ছবি দেখে প্রশ্নের উত্তর দেয় (গুণমান পরীক্ষা/বর্ণনা/ধারাবাহিকতা যাচাইসহ)। arguments: {"image": string (artifact আইডি বা পাবলিক URL), "question": string}',
  inputSummary: i => i.question,
  execute: async input => {
    let url = input.image.trim();
    const isHttp = /^https?:\/\//i.test(url);
    if (!isHttp && !url.startsWith('data:')) {
      const artifact = await db.artifact.findUnique({ where: { id: url } });
      if (!artifact || !artifact.storagePath) {
        throw new Error(`চিহ্নিত ছবি (artifact) খুঁজে পাওয়া যায়নি: ${url.slice(0, 60)}`);
      }
      const buf = await readArtifactFile(artifact.storagePath);
      url = `data:${artifact.mimeType};base64,${buf.toString('base64')}`;
    }
    const zai = await getZAI();
    const res = await zai.chat.completions.createVision({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: input.question },
            { type: 'image_url', image_url: { url } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    } as any);
    const description = String(res?.choices?.[0]?.message?.content ?? '').trim();
    if (!description) throw new Error('ছবির বিশ্লেষণ পাওয়া যায়নি');
    const limited = truncate(description, 2000);
    return {
      summary: truncate(description, 160),
      resultJson: JSON.stringify({ description: limited }),
    };
  },
};

// ------------------------------------------------------------
// ৬. text_to_speech
// ------------------------------------------------------------
const textToSpeechSpec: ToolSpec<{ text: string; voice?: 'tongtong' | 'jam' | 'kazi' }> = {
  name: 'text_to_speech',
  parameters: z.object({
    text: z.string().min(1).max(1000),
    voice: z.enum(['tongtong', 'jam', 'kazi']).optional().default('tongtong'),
  }),
  timeoutMs: 120_000,
  usage:
    'text_to_speech — লেখাকে কণ্ঠের অডিওতে রূপ দেয় (উত্তরাধিকার-টুল)। ভাষা স্বয়ংক্রিয় শনাক্ত (bn/en): বাংলা লেখায় Edge-নিউরাল বাংলা কণ্ঠ (Edge অচল হলে সৎ VOICE_UNAVAILABLE ত্রুটি), ইংরেজি লেখায় নির্বাচিত z-ai কণ্ঠ (tongtong/jam/kazi)। ভাষা-নিয়ন্ত্রকের সৎ নোটসহ ফলাফল। নতুন ব্যবহারে speech_synthesis (verify-নিয়ন্ত্রণসহ) পছন্দনীয়। arguments: {"text": string (১–১০০০ অক্ষর), "voice"?: "tongtong"|"jam"|"kazi" (শুধু ইংরেজি-পথে প্রযোজ্য)}',
  inputSummary: i => truncate(i.text, 80),
  execute: async (input, ctx) => {
    // B-F08 (R-FIX-1): আগে এখানে সরাসরি zai.audio.tts.create ডাকা হতো —
    // ভাষা-নিয়ন্ত্রক, ক্ষমতা-ট্যাগ-চেইন ও যাচাই সব বাইপাস হয়ে ভুল-ভাষার
    // অডিও সাধারণ সাফল্য হয়ে যেত। এখন §২-নিয়ন্ত্রকের সুরক্ষিত পথেই।
    const det = detectLanguage(input.text);
    if (det.language !== 'bn' && det.language !== 'en' && det.language !== 'mixed') {
      throw new Error(
        'টেক্সটের ভাষা শনাক্ত করা যায়নি — text_to_speech বাংলা বা ইংরেজি লেখায় কাজ করে (§২ ভাষা-নিয়ন্ত্রক)।'
      );
    }
    const language: SpeechLanguage =
      det.language === 'mixed' ? (det.bnRatio >= det.latinRatio ? 'bn' : 'en') : det.language;
    const result = await synthesizeVerifiedSpeech(
      {
        task: 'speech',
        language,
        script: input.text,
        // bn: z-ai কণ্ঠ বাংলা-অসক্ষম — প্রোফাইল-প্রাথমিক (Edge-নিউরাল) হয়;
        // en: নির্বাচিত z-ai কণ্ঠ বৈধ (en-সক্ষম ট্যাগসহ)
        voiceId: language === 'en' ? (input.voice ?? 'tongtong') : undefined,
        outputFormat: 'wav',
        sampleRate: 24000,
        speed: 1,
      },
      { verify: false }
    );
    const v = result.verification;
    const { storagePath } = await saveArtifactFile(result.buffer, result.ext);
    const meta = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'audio',
      mimeType: result.mimeType,
      fileName: `speech-${language}-${v.voice}.${result.ext}`,
      size: result.buffer.length,
      storagePath,
      metaJson: {
        verification: v,
        languageLabel: language === 'bn' ? 'বাংলা' : 'ইংরেজি',
        voice: v.voice,
        requestedVoice: v.requestedVoice,
        audioType: 'Speech',
      },
    });
    return {
      summary: `${language === 'bn' ? 'বাংলা' : 'ইংরেজি'} অডিও তৈরি (কণ্ঠ=${v.voice}, রায়=${verdictLabel(v.verdict)})। নোট: ${v.notes.join(' ')}`.slice(0, 400),
      resultJson: JSON.stringify({
        artifactId: meta.id,
        url: meta.url,
        fileName: meta.fileName,
        size: meta.size,
        language,
        voice: v.voice,
        verdict: v.verdict,
        notes: v.notes,
      }),
      artifacts: [meta],
    };
  },
};

// ------------------------------------------------------------
// ৭. transcribe_audio
// ------------------------------------------------------------
const transcribeAudioSpec: ToolSpec<{ audio: string }> = {
  name: 'transcribe_audio',
  parameters: z.object({ audio: z.string().min(1) }),
  timeoutMs: 300_000,
  usage: 'transcribe_audio — অডিও শুনে লেখায় রূপ দেয় (বাংলা অডিওতে দুর্বল হতে পারে)। arguments: {"audio": string (artifact আইডি)}',
  inputSummary: async i => {
    const a = await db.artifact.findUnique({ where: { id: i.audio } });
    return a?.fileName ?? i.audio;
  },
  execute: async input => {
    const artifact = await db.artifact.findUnique({ where: { id: input.audio } });
    if (!artifact || !artifact.storagePath) {
      throw new Error(`চিহ্নিত অডিও (artifact) খুঁজে পাওয়া যায়নি: ${input.audio.slice(0, 60)}`);
    }
    const buf = await readArtifactFile(artifact.storagePath);
    // S8-3 সংশোধন (অডিট-ফাইন্ডিং): আগে সরাসরি asr.create ডাকা হত —
    // ৩০ সে.-এর বেশি অডিও ব্যর্থ হতো। এখন transcribeBuffer (২৮-সে. চাঙ্কিং +
    // ৪২৯-ব্যাকঅফসহ) — দীর্ঘ অডিওও খণ্ডে খণ্ডে লিপিবদ্ধ হয়।
    const ext = (artifact.storagePath.split('.').pop() ?? 'wav').toLowerCase();
    const text = (await transcribeBuffer(buf, ext)).trim();
    if (!text) throw new Error('অডিও থেকে কোনো লেখা শনাক্ত করা যায়নি');
    return {
      summary: truncate(text, 160),
      resultJson: JSON.stringify({ text: truncate(text, 6000) }),
    };
  },
};

// ------------------------------------------------------------
// ৮. search_conversations (স্মৃতি)
// ------------------------------------------------------------
const searchConversationsSpec: ToolSpec<{ query: string }> = {
  name: 'search_conversations',
  parameters: z.object({ query: z.string().min(1).max(400) }),
  timeoutMs: 15_000,
  usage: 'search_conversations — পুরনো কথোপকথনের স্মৃতি থেকে প্রাসঙ্গিক তথ্য খুঁজে আনে। arguments: {"query": string}',
  inputSummary: i => `খোঁজ: ${i.query}`,
  execute: async (input, ctx) => {
    const [messages, convs] = await Promise.all([
      db.message.findMany({
        where: { conversationId: { not: ctx.conversationId }, content: { contains: input.query } },
        include: { conversation: true },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      db.conversation.findMany({
        where: { title: { contains: input.query }, id: { not: ctx.conversationId } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);
    const results: { conversationTitle: string; snippet: string; date: string }[] = [];
    const seen = new Set<string>();
    for (const c of convs) {
      if (results.length >= 5) break;
      results.push({ conversationTitle: c.title, snippet: c.title, date: c.updatedAt.toISOString() });
      seen.add(c.id);
    }
    for (const m of messages) {
      if (results.length >= 5) break;
      if (seen.has(m.conversationId)) continue;
      seen.add(m.conversationId);
      results.push({
        conversationTitle: m.conversation.title,
        snippet: makeSnippet(m.content, input.query, 200),
        date: m.createdAt.toISOString(),
      });
    }
    return {
      summary: `${results.length} টি প্রাসঙ্গিক অংশ`,
      resultJson: JSON.stringify(results),
    };
  },
};

// ------------------------------------------------------------
// কেন্দ্রীয় তালিকা — মূল ৮টি + স্টুডিও ডোমেইন
// ------------------------------------------------------------

export const CORE_TOOLS: ToolSpec[] = [
  webSearchSpec,
  readWebPageSpec,
  generateImageSpec,
  searchImagesSpec,
  analyzeImageSpec,
  textToSpeechSpec,
  transcribeAudioSpec,
  searchConversationsSpec,
];

export const TOOLS: ToolSpec[] = [
  ...CORE_TOOLS,
  ...IMAGE_TOOLS,
  ...AUDIO_TOOLS,
  ...VIDEO_TOOLS,
  ...PRODUCTION_TOOLS,
];

// ------------------------------------------------------------
// অডিট §৪-A: TOOLS ↔ TOOL_CATALOG প্যারিটি-চেক — দুই তালিকার
// ড্রিফ্ট যেন নীরবে ঢুকতে না পারে। UI-ক্যাটাগে থাকা কিন্তু রেজিস্ট্রিতে
// নেই এমন নাম "display-only" হতে পারে (সচেতনভাবে রাখা) — তাই সেটি
// সতর্কতা, আর রেজিস্ট্রিতে থাকা কিন্তু ক্যাটালগে নেই সেটি সমস্যা।
// ------------------------------------------------------------
export interface ToolParityReport {
  ok: boolean;
  executableCount: number;
  catalogCount: number;
  /** রেজিস্ট্রিতে আছে, UI-ক্যাটালগে নেই — ব্যবহারকারী জানবে না */
  missingInCatalog: string[];
  /** UI-ক্যাটালগে আছে, রেজিস্ট্রিতে নেই — display-only হলে সচেতন সিদ্ধান্ত */
  missingInRegistry: string[];
  duplicatesInCatalog: string[];
  checkedAt: string;
}

export function toolParityReport(catalog: { name: string }[]): ToolParityReport {
  const execNames = TOOLS.map(t => t.name);
  const catalogNames = catalog.map(t => t.name);
  const duplicatesInCatalog = catalogNames.filter((n, i) => catalogNames.indexOf(n) !== i);
  const missingInCatalog = execNames.filter(n => !catalogNames.includes(n));
  const missingInRegistry = catalogNames.filter(n => !execNames.includes(n));
  return {
    ok: missingInCatalog.length === 0 && duplicatesInCatalog.length === 0,
    executableCount: execNames.length,
    catalogCount: catalogNames.length,
    missingInCatalog,
    missingInRegistry,
    duplicatesInCatalog,
    checkedAt: new Date().toISOString(),
  };
}

/** অজানা টুল / zod validation ব্যর্থ → structured error (কখনো throw নয়) */
export function validateToolCall(toolName: string, args: unknown): ToolValidation {
  const spec = TOOLS.find(t => t.name === toolName);
  if (!spec) {
    return {
      ok: false,
      error: `অজানা টুল: "${toolName}"`,
      hint: `উপলব্ধ টুলসমূহ: ${TOOLS.map(t => t.name).join(', ')}`,
    };
  }
  const parsed = spec.parameters.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map(i => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      error: `টুল "${toolName}"-এর আর্গুমেন্ট যাচাই ব্যর্থ হয়েছে`,
      hint: issues || 'আর্গুমেন্টগুলো সঠিক ফরম্যাটে দাও',
    };
  }
  return { ok: true, tool: spec, input: parsed.data };
}

export function getToolSpec(name: string): ToolSpec | undefined {
  return TOOLS.find(t => t.name === name);
}
