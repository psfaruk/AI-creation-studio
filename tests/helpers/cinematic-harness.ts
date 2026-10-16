// ============================================================
// Phase-5 টেস্ট-হার্নেস — সিনেম্যাটিক পরীক্ষার সাধারণ সরঞ্জাম।
//
// এই ফাইল কোনো মক করা মডিউল (llm/sdk-helpers/db) আমদানি করে না —
// টেস্ট-ফাইলের mock.module নির্ভরতার ক্রম নষ্ট করে না। কেবল:
//  - ফিক্সচার-নির্মাণ (প্রকৃত ffmpeg — MP4 ক্লিপ / WAV কথা / PNG ছবি)
//  - নকল PipelineContext (রেকর্ডিং + বাতিল-নিয়ন্ত্রণসহ) — পাইপলাইন
//    ফাংশনকে ডাবল-টাইপ ctx দিয়ে সরাসরি চালানো যায় (runner/DB ছাড়া)।
// ============================================================

import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { PipelineContext, PipelineResult } from '@/lib/agent/production/runner';
import type { StepHandle } from '@/lib/agent/production/runner';
import type { ValidatedSpec } from '@/lib/types';
import { validateSpec } from '@/lib/agent/capabilities';
import { runFfmpeg } from '@/lib/media/ffmpeg';
import type { CreativeJobSpec } from '@/lib/types';

export const ROOTS: string[] = [];

export async function freshDir(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  ROOTS.push(d);
  return d;
}

export async function cleanupRoots(): Promise<void> {
  await Promise.all(ROOTS.map(d => rm(d, { recursive: true, force: true }).catch(() => undefined)));
  ROOTS.length = 0;
}

/** প্রকৃত, যাচাই-উত্তীর্ণ MP4 ক্লিপ (≥3 সে., ≥360px প্রস্থ, অডিও-স্ট্রিমসহ) */
export async function buildFixtureMp4(dir: string, name = 'fixture-clip.mp4'): Promise<Buffer> {
  const p = path.join(dir, name);
  await runFfmpeg(
    [
      '-f', 'lavfi', '-i', 'testsrc2=duration=3.5:size=480x270:rate=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3.5',
      '-c:v', 'libx264', '-b:v', '200k', '-minrate', '200k', '-maxrate', '200k',
      '-c:a', 'aac', '-b:a', '64k', '-shortest',
      '-pix_fmt', 'yuv420p', p,
    ],
    { label: 'Phase-5 ফিক্সচার MP4' },
  );
  const buf = await readFile(p);
  if (buf.length < 50_000) throw new Error(`ফিক্সচার MP4 খুব ছোট (${buf.length}B < 50KB)`);
  return buf;
}

/** সংলাপ-লাইনের প্রকৃত WAV (১.২ সে. — mediaInfo-দৈর্ঘ্য > 0 যাচাই পাস) */
export async function buildSpeechWav(dir: string, name = 'fixture-line.wav'): Promise<Buffer> {
  const p = path.join(dir, name);
  await runFfmpeg(
    ['-f', 'lavfi', '-i', 'sine=frequency=320:duration=1.2', '-c:a', 'pcm_s16le', '-ar', '24000', p],
    { label: 'Phase-5 ফিক্সচার WAV' },
  );
  return readFile(p);
}

/** ছোট প্রকৃত PNG (স্টোরিবোর্ড-ফ্রেম/পোর্ট্রেট-ফিক্সচার) */
export async function buildPng(dir: string, name = 'fixture-frame.png'): Promise<Buffer> {
  const p = path.join(dir, name);
  await runFfmpeg(
    ['-f', 'lavfi', '-i', 'testsrc2=duration=0.04:size=360x202:rate=25', '-frames:v', '1', p],
    { label: 'Phase-5 ফিক্সচার PNG' },
  );
  return readFile(p);
}

// ------------------------------------------------------------
// নকল PipelineContext — রেকর্ডিং + বাতিল-নিয়ন্ত্রণসহ
// ------------------------------------------------------------

export interface FakeCtxOptions {
  productionId: string;
  conversationId?: string;
  spec: CreativeJobSpec;
  workingDir: string;
  /** এতগুলি সফল checkCancelled-কলের পরে "ব্যবহারকারী বাতিল করলেন" —
   * পরের কল থেকে CancelledError (§9-J: পরবর্তী সাবমিট আটকায়) */
  cancelAfterChecks?: number;
}

export interface FakeCtxRecording {
  /** runStep-কলের কী-ক্রম (SSE-ধাপ-সামঞ্জস্যের দাবির জন্য) */
  stepKeys: string[];
  stepDetails: Record<string, string[]>;
  artifacts: {
    id: string;
    kind: 'image' | 'audio' | 'video' | 'text';
    mimeType: string;
    fileName: string;
    metaJson?: Record<string, unknown>;
    buffer: Buffer;
  }[];
  /** resolveArtifactFile-ম্যাপ (artifactId → ফাইল-পথ) */
  artifactFiles: Map<string, string>;
  /** বাতিল-পতাকা — টেস্ট যখন-চায় তোলে */
  cancelled: boolean;
  /** ধাপ-ফাংশন থেকে ছুড়ে-পড়া ত্রুটি (বাতিলসহ) — রিথ্রো হয় */
  errors: unknown[];
}

export interface FakeCtxHandle {
  ctx: PipelineContext;
  rec: FakeCtxRecording;
  /** artifact-আইডি → ফাইল-পথ রেজিস্টার (song/পোর্ট্রেট সমাধানের জন্য) */
  registerArtifactFile(id: string, file: string): void;
}

/**
 * পাইপলাইন ফাংশন চালানোর নকল ctx। runStep আসল রানারের মতোই ফাংশনটি
 * চালায় (কোনো swallowing নয় — বাতিল-ত্রুটি/সাধারণ ত্রুটি উপরে ওঠে),
 * কেবল রেকর্ডিং করে। caps প্রকৃত validateSpec থেকে (সার্ভার-যাচাই
 * পথ আড়াল হয় না)।
 */
export function makeFakeCtx(opts: FakeCtxOptions): FakeCtxHandle {
  const validation = validateSpec(opts.spec);
  if (!validation.ok || !validation.validated) {
    throw new Error(`fakeCtx: spec যাচাই ব্যর্থ — ${validation.errors.join('; ')}`);
  }
  const caps: ValidatedSpec = validation.validated;

  const rec: FakeCtxRecording = {
    stepKeys: [],
    stepDetails: {},
    artifacts: [],
    artifactFiles: new Map(),
    cancelled: false,
    errors: [],
  };

  let artifactSeq = 0;
  let checksPassed = 0;
  const cancelErr = () => {
    const err = new Error('নকল-বাতিল: পরবর্তী ধাপ বন্ধ');
    err.name = 'CancelledError';
    return err;
  };

  const ctx: PipelineContext = {
    productionId: opts.productionId,
    conversationId: opts.conversationId ?? 'conv-fake',
    spec: opts.spec,
    caps,
    totalSteps: 8,
    workingDir: opts.workingDir,
    partialNotes: [],
    async runStep<T>(key: string, _title: string, fn: (step: StepHandle) => Promise<T>): Promise<T> {
      rec.stepKeys.push(key);
      rec.stepDetails[key] = [];
      const step: StepHandle = {
        id: key,
        setDetail: async (detail: string) => {
          (rec.stepDetails[key] ??= []).push(detail);
        },
      };
      try {
        return await fn(step);
      } catch (err) {
        rec.errors.push(err);
        throw err;
      }
    },
    async checkCancelled(): Promise<void> {
      if (rec.cancelled) throw cancelErr();
      if (opts.cancelAfterChecks !== undefined && checksPassed >= opts.cancelAfterChecks) {
        rec.cancelled = true; // ব্যবহারকারী এখন বাতিল করলেন
        throw cancelErr();
      }
      checksPassed++;
    },
    async isCancelled(): Promise<boolean> {
      return rec.cancelled;
    },
    async registerArtifact(params: {
      buffer: Buffer;
      kind: 'image' | 'audio' | 'video' | 'text';
      mimeType: string;
      fileName: string;
      metaJson?: Record<string, unknown>;
    }) {
      artifactSeq++;
      const id = `fake-art-${artifactSeq}`;
      rec.artifacts.push({ id, ...params });
      return {
        id,
        conversationId: ctx.conversationId,
        kind: params.kind,
        fileName: params.fileName,
        mimeType: params.mimeType,
        metaJson: params.metaJson ?? null,
        createdAt: new Date(),
      } as never;
    },
    async resolveArtifactFile(artifactId: string): Promise<string> {
      const f = rec.artifactFiles.get(artifactId);
      if (!f) throw new Error(`fakeCtx: artifact পাওয়া যায়নি — ${artifactId}`);
      return f;
    },
  };

  return {
    ctx,
    rec,
    registerArtifactFile: (id, file) => rec.artifactFiles.set(id, file),
  };
}

/** পাইপলাইন-ফলাফল থেকে resultJson অংশ (PipelineResult.result) */
export function resultOf(pr: PipelineResult): Record<string, unknown> {
  return pr.result;
}
