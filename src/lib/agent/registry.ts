// ============================================================
// Tool Registry — ৮টি টুল, প্রতিটিতে zod validation + timeout +
// execute() → { summary, resultJson, artifacts? }।
// যেকোনো ব্যর্থতা throw হিসেবে ওঠে — orchestrator ধরে structured
// error বানিয়ে LLM-কে ফেরত দেয় (কখনো uncaught নয়)।
// ============================================================

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { z } from 'zod';
import type { ArtifactMeta } from '@/lib/types';
import { db } from '@/lib/db';
import { getZAI } from './llm';
import { readArtifactFile, saveArtifactFile } from './storage';
import { toArtifactMeta } from './serialize';

const execFileAsync = promisify(execFileCb);

export interface ToolContext {
  conversationId: string;
  runId: string;
  toolCallId: string;
}

export interface ToolOutput {
  /** মানুষ-পাঠযোগ্য ফলাফল-সারাংশ (Bengali, UI-তে দেখানো হয়) */
  summary: string;
  /** compact JSON — LLM-এর কাছে ফিরিয়ে দেওয়া হয় */
  resultJson: string;
  /** এই টুল কলে তৈরি হওয়া artifacts */
  artifacts?: ArtifactMeta[];
}

export interface ToolSpec<T = any> {
  name: string;
  parameters: z.ZodType<T>;
  timeoutMs: number;
  /** আর্গুমেন্টের মানুষ-পাঠযোগ্য (Bengali) সারাংশ */
  inputSummary: (input: T) => string | Promise<string>;
  execute: (input: T, ctx: ToolContext) => Promise<ToolOutput>;
}

export type ToolValidation =
  | { ok: true; tool: ToolSpec; input: any }
  | { ok: false; error: string; hint: string };

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

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function createToolArtifact(params: {
  conversationId: string;
  runId: string;
  kind: 'image' | 'audio' | 'text';
  mimeType: string;
  fileName: string;
  size: number;
  storagePath?: string | null;
  sourceUrl?: string | null;
}): Promise<ArtifactMeta> {
  const row = await db.artifact.create({
    data: {
      conversationId: params.conversationId,
      runId: params.runId,
      origin: 'tool',
      kind: params.kind,
      mimeType: params.mimeType,
      fileName: params.fileName,
      size: params.size,
      storagePath: params.storagePath ?? null,
      sourceUrl: params.sourceUrl ?? null,
    },
  });
  return toArtifactMeta(row);
}

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
  inputSummary: i => `খোঁজ: ${i.query}`,
  execute: async input => {
    const zai = await getZAI();
    const raw = await zai.functions.invoke('web_search', { query: input.query, num: input.num ?? 6 });
    // SDK-রিটার্ন array; তবে defensive চেক
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
// ৪. search_images (CLI-only — z-ai image-search)
// ------------------------------------------------------------
const searchImagesSpec: ToolSpec<{ query: string }> = {
  name: 'search_images',
  parameters: z.object({ query: z.string().min(1).max(400) }),
  timeoutMs: 150_000,
  inputSummary: i => `খোঁজ: ${i.query}`,
  execute: async (input, ctx) => {
    const cliPath = path.join(process.cwd(), 'node_modules', '.bin', 'z-ai');
    let stdout = '';
    try {
      const res = await execFileAsync(
        cliPath,
        ['image-search', '-q', input.query, '-c', '4', '--gl', 'us', '--no-rank'],
        { timeout: 150_000, maxBuffer: 10 * 1024 * 1024 }
      );
      stdout = res.stdout;
    } catch (err: any) {
      const detail = String(err?.stderr || err?.stdout || err?.message || '').slice(0, 300);
      throw new Error(`ছবি সার্চ CLI ব্যর্থ: ${detail}`);
    }
    // stdout-এ অতিরিক্ত লাইন থাকতে পারে — প্রথম { থেকে শেষ } পর্যন্ত নাও
    const first = stdout.indexOf('{');
    const last = stdout.lastIndexOf('}');
    if (first === -1 || last <= first) throw new Error('ছবি সার্চের ফলাফল পার্স করা যায়নি');
    let parsed: any;
    try {
      parsed = JSON.parse(stdout.slice(first, last + 1));
    } catch {
      throw new Error('ছবি সার্চের ফলাফল পার্স করা যায়নি');
    }
    if (!parsed?.success || !Array.isArray(parsed.results) || parsed.results.length === 0) {
      throw new Error(`কোনো ছবি পাওয়া যায়নি${parsed?.error ? ` (${String(parsed.error).slice(0, 200)})` : ''}`);
    }
    const metas: ArtifactMeta[] = [];
    const resultItems: { url: string; caption: string; source: string }[] = [];
    for (const r of parsed.results) {
      if (!r?.original_url) continue;
      const caption = String(r.caption ?? '');
      const source = String(r.source ?? '');
      const meta = await createToolArtifact({
        conversationId: ctx.conversationId,
        runId: ctx.runId,
        kind: 'image',
        mimeType: 'image/jpeg',
        fileName: truncate(caption || 'external image', 120),
        size: 0,
        storagePath: null,
        sourceUrl: String(r.original_url),
      });
      metas.push(meta);
      resultItems.push({ url: String(r.original_url), caption, source });
    }
    if (metas.length === 0) throw new Error('কোনো ব্যবহারযোগ্য ছবি পাওয়া যায়নি');
    return {
      summary: `${metas.length} টি ছবি পাওয়া গেছে`,
      resultJson: JSON.stringify(resultItems),
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
  inputSummary: i => i.question,
  execute: async input => {
    let url = input.image.trim();
    const isHttp = /^https?:\/\//i.test(url);
    if (!isHttp && !url.startsWith('data:')) {
      // artifact আইডি → লোকাল ফাইল → base64 data URL (VLM localhost ফেচ করতে পারে না)
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
  inputSummary: i => truncate(i.text, 80),
  execute: async (input, ctx) => {
    const zai = await getZAI();
    // চুক্তি অনুযায়ী mp3 চেষ্টা; সার্ভার বর্তমানে mp3 সমর্থন না করলে (400/1214)
    // স্বয়ংক্রিয়ভাবে wav-এ fallback করে প্রকৃত ফরম্যাট অনুযায়ী artifact সেভ হয়।
    const attempt = async (format: 'mp3' | 'wav') => {
      const res = await zai.audio.tts.create({
        input: input.text,
        voice: input.voice ?? 'tongtong',
        speed: 1,
        response_format: format,
        stream: false,
      });
      if (!res || typeof res.arrayBuffer !== 'function') {
        throw new Error('TTS প্রতিক্রিয়া পড়া যায়নি');
      }
      return Buffer.from(new Uint8Array(await res.arrayBuffer()));
    };
    let buf: Buffer;
    let ext = 'mp3';
    let mimeType = 'audio/mpeg';
    try {
      buf = await attempt('mp3');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/response_format|1214/i.test(msg)) throw err;
      buf = await attempt('wav');
      ext = 'wav';
      mimeType = 'audio/wav';
    }
    if (buf.length === 0) throw new Error('অডিও ডেটা খালি এসেছে');
    // ফরম্যাট যাচাই: RIFF হেডার পেলে সঠিক wav হিসেবে সেভ করো
    if (ext === 'mp3' && buf.length > 12 && buf.slice(0, 4).toString('ascii') === 'RIFF') {
      ext = 'wav';
      mimeType = 'audio/wav';
    }
    const { storagePath, relName } = await saveArtifactFile(buf, ext);
    const meta = await createToolArtifact({
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      kind: 'audio',
      mimeType,
      fileName: relName,
      size: buf.length,
      storagePath,
    });
    return {
      summary: 'অডিও তৈরি হয়েছে',
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
// ৭. transcribe_audio
// ------------------------------------------------------------
const transcribeAudioSpec: ToolSpec<{ audio: string }> = {
  name: 'transcribe_audio',
  parameters: z.object({ audio: z.string().min(1) }),
  timeoutMs: 180_000,
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
    const zai = await getZAI();
    const r = await zai.audio.asr.create({ file_base64: buf.toString('base64') });
    const text = String(r?.text ?? '').trim();
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
export const TOOLS: ToolSpec[] = [
  webSearchSpec,
  readWebPageSpec,
  generateImageSpec,
  searchImagesSpec,
  analyzeImageSpec,
  textToSpeechSpec,
  transcribeAudioSpec,
  searchConversationsSpec,
];

export function getToolSpec(name: string): ToolSpec | undefined {
  return TOOLS.find(t => t.name === name);
}
