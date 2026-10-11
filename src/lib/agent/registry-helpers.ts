// ============================================================
// Registry helpers — ToolSpec/ToolContext/ToolOutput-এর শেয়ার্ড
// টাইপ + সাধারণ হেল্পার। registry.ts ও tools/* উভয়ে ব্যবহার করে
// (circular import এড়াতে আলাদা মডিউলে)।
// ============================================================

import type { z } from 'zod';
import type { ArtifactMeta } from '@/lib/types';
import { db } from '@/lib/db';
import { readArtifactFile } from './storage';
import { toArtifactMeta } from './serialize';

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
  /** LLM-এর জন্য বাংলা ব্যবহার-নির্দেশিকা (arguments-সহ) — system prompt-এ যায় */
  usage: string;
  /** আর্গুমেন্টের মানুষ-পাঠযোগ্য (Bengali) সারাংশ */
  inputSummary: (input: T) => string | Promise<string>;
  execute: (input: T, ctx: ToolContext) => Promise<ToolOutput>;
}

export type ToolValidation =
  | { ok: true; tool: ToolSpec; input: any }
  | { ok: false; error: string; hint: string };

// ------------------------------------------------------------
// হেল্পার — টুল আর্টিফ্যাক্ট তৈরি ও ছবি রিজলভ
// ------------------------------------------------------------

/** টুল-আউটপুট আর্টিফ্যাক্ট DB-তে নিবন্ধন → ArtifactMeta */
export async function createToolArtifact(params: {
  conversationId: string;
  runId: string;
  kind: 'image' | 'audio' | 'video' | 'text';
  mimeType: string;
  fileName: string;
  size: number;
  storagePath?: string | null;
  sourceUrl?: string | null;
  metaJson?: Record<string, unknown>;
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
      metaJson: params.metaJson ? JSON.stringify(params.metaJson) : undefined,
    },
  });
  return toArtifactMeta(row);
}

/** artifact আইডি → base64 data URL (এডিট/VLM ইনপুটের জন্য) */
export async function artifactToDataUrl(artifactId: string): Promise<{ dataUrl: string; fileName: string; mimeType: string }> {
  const artifact = await db.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact || !artifact.storagePath) {
    throw new Error(`চিহ্নিত ফাইল (artifact) পাওয়া যায়নি: ${artifactId.slice(0, 60)}`);
  }
  if (artifact.kind !== 'image') {
    throw new Error(`artifact টি ছবি নয় (${artifact.kind})`);
  }
  const buf = await readArtifactFile(artifact.storagePath);
  return {
    dataUrl: `data:${artifact.mimeType};base64,${buf.toString('base64')}`,
    fileName: artifact.fileName,
    mimeType: artifact.mimeType,
  };
}

/** artifact আইডি → লোকাল ফাইল-পাথ (ffmpeg ইনপুটের জন্য) */
export async function artifactFilePath(artifactId: string): Promise<{ path: string; fileName: string; mimeType: string; kind: string }> {
  const artifact = await db.artifact.findUnique({ where: { id: artifactId } });
  if (!artifact || !artifact.storagePath) {
    throw new Error(`চিহ্নিত ফাইল (artifact) পাওয়া যায়নি: ${artifactId.slice(0, 60)}`);
  }
  return { path: artifact.storagePath, fileName: artifact.fileName, mimeType: artifact.mimeType, kind: artifact.kind };
}
