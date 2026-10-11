// ============================================================
// Production Runner — Creative Job execution framework
// (মাস্টার প্ল্যান §৯ background processing)।
//
// জীবনচক্র: awaiting_confirmation → (confirm) → queued →
// running → validating → completed | failed | partial | cancelled
//
// পাইপলাইনগুলো pipelines/ ফোল্ডারে প্রকারভেদে থাকে; এই runner
// step-ট্র্যাকিং, অগ্রগতি, বাতিলকরণ, artifact নিবন্ধন ও পরিচ্ছন্নতা
// সামলায়। LLM কখনো সরাসরি কোড চালায় না — সব টাইপড পাইপলাইনই
// সার্ভারে যাচাই হয়ে চলে।
// ============================================================

import type { Artifact } from '@prisma/client';
import type { ArtifactMeta, CreativeJobSpec, ValidatedSpec } from '@/lib/types';
import { db } from '@/lib/db';
import { saveArtifactFile, readArtifactFile } from '../storage';
import { toArtifactMeta } from '../serialize';
import { emitProduction } from './bus';
import { cleanupWorkingDir, makeWorkingDir } from '@/lib/media/ffmpeg';
import { validateSpec } from '../capabilities';

const STALE_PRODUCTION_MS = 20 * 60 * 1000; // ২০ মিনিট

export class CancelledError extends Error {
  constructor() {
    super('প্রোডাকশন বাতিল করা হয়েছে');
  }
}

export interface StepHandle {
  id: string;
  /** মাঝপথের অগ্রগতি ("৩/৬ শট তৈরি") — step detail আপডেট করে emit করে */
  setDetail(detail: string): Promise<void>;
}

export interface PipelineContext {
  productionId: string;
  conversationId: string;
  spec: CreativeJobSpec;
  caps: ValidatedSpec;
  /** মোট পরিকল্পিত ধাপ (অগ্রগতি হিসাবের ভিত্তি) */
  totalSteps: number;
  /** ধাপ চালাও — row তৈরি, ইভেন্ট, অগ্রগতি, ত্রুটি হ্যান্ডলিং */
  runStep<T>(key: string, title: string, fn: (step: StepHandle) => Promise<T>): Promise<T>;
  /** দুটি ধাপের মাঝে বাতিল-অনুরোধ পরীক্ষা (CancelledError ছুড়ে) */
  checkCancelled(): Promise<void>;
  /** চূড়ান্ত artifact সংরক্ষণ + DB নিবন্ধন */
  registerArtifact(params: {
    buffer: Buffer;
    kind: 'image' | 'audio' | 'video' | 'text';
    mimeType: string;
    fileName: string;
    metaJson?: Record<string, unknown>;
  }): Promise<ArtifactMeta>;
  /** ইন্টারমিডিয়েট ফাইলের জন্য প্রোডাকশন-ডিরেক্টরি */
  workingDir: string;
  /** আংশিক সফলতার তালিকা (partial স্ট্যাটাসের ভিত্তি) */
  partialNotes: string[];
  /** আর্টিফ্যাক্ট আইডি থেকে ফাইল-পাথ (source ছবি/গান ইত্যাদি) */
  resolveArtifactFile(artifactId: string): Promise<string>;
}

export interface PipelineResult {
  /** resultJson-এ রাখার সারসংক্ষেপ (quality report ইত্যাদি) */
  result: Record<string, unknown>;
  /** চূড়ান্ত স্ট্যাটাস ওভাররাইড (partial) */
  statusOverride?: 'partial';
}

export type PipelineFn = (ctx: PipelineContext) => Promise<PipelineResult>;

// ------------------------------------------------------------
// পাইপলাইন রেজিস্ট্রি — pipelines/index.ts থেকে আসে
// ------------------------------------------------------------

import { PIPELINES } from './pipelines';

// ------------------------------------------------------------
// Runner
// ------------------------------------------------------------

/** confirm API থেকে ডাকা হয় — fire-and-forget শুরু */
export function startProduction(productionId: string): void {
  setImmediate(() => {
    runProduction(productionId).catch(async err => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[production] ${productionId.slice(-6)} fatal:`, message);
      try {
        await failProduction(productionId, message);
      } catch (failErr) {
        console.error(`[production] ${productionId.slice(-6)} fail error:`, failErr);
      }
    });
  });
}

async function loadCtx(productionId: string): Promise<{ ctx: PipelineContext; pipeline: PipelineFn; run: { id: string; conversationId: string; spec: CreativeJobSpec } } | null> {
  const run = await db.production.findUnique({ where: { id: productionId } });
  if (!run || !['queued', 'running'].includes(run.status)) return null;

  let spec: CreativeJobSpec;
  try {
    spec = JSON.parse(run.specJson);
  } catch {
    throw new Error('specJson পড়া যায়নি');
  }
  const validation = validateSpec(spec);
  if (!validation.ok || !validation.validated) {
    throw new Error(`spec যাচাই ব্যর্থ: ${validation.errors.join('; ')}`);
  }
  const caps = validation.validated;
  const pipeline = PIPELINES[spec.type];
  if (!pipeline) throw new Error(`"${spec.type}" পাইপলাইন এখনো নেই`);

  const workingDir = await makeWorkingDir(productionId);
  const partialNotes: string[] = [];
  let completedSteps = 0;

  const ctx: PipelineContext = {
    productionId,
    conversationId: run.conversationId,
    spec: caps.spec,
    caps,
    totalSteps: Math.max(1, caps.plannedSteps.length),
    workingDir,
    partialNotes,
    async checkCancelled() {
      const fresh = await db.production.findUnique({ where: { id: productionId }, select: { status: true } });
      if (fresh?.status === 'cancelling') throw new CancelledError();
    },
    async runStep<T>(key: string, title: string, fn: (step: StepHandle) => Promise<T>): Promise<T> {
      await ctx.checkCancelled();
      const seq = completedSteps + 1;
      const step = await db.productionStep.create({
        data: { productionId, seq, key, title, status: 'running', startedAt: new Date() },
      });
      const progressNow = Math.min(96, Math.round((completedSteps / ctx.totalSteps) * 100));
      await db.production.update({
        where: { id: productionId },
        data: { currentStepKey: key, status: 'running', progress: progressNow },
      });
      emitProduction(productionId, {
        type: 'step_start',
        productionId,
        stepId: step.id,
        seq,
        key,
        title,
      });
      const progress = Math.min(96, Math.round((completedSteps / ctx.totalSteps) * 100));
      emitProduction(productionId, { type: 'production_progress', productionId, progress, currentStepKey: key });
      try {
        const result = await fn({
          id: step.id,
          async setDetail(detail: string) {
            await db.productionStep.update({ where: { id: step.id }, data: { detail: detail.slice(0, 500) } });
            // মাঝ-ধাপে অগ্রগতি (step-অর্ধেক হিসেবে) — পোলিং-ভিউতেও সঠিক দেখাবে
            const midProgress = Math.min(96, Math.round(((completedSteps + 0.5) / ctx.totalSteps) * 100));
            try {
              await db.production.update({ where: { id: productionId }, data: { progress: midProgress } });
            } catch {
              // নীরব
            }
            emitProduction(productionId, { type: 'production_progress', productionId, progress: midProgress, currentStepKey: key });
          },
        });
        await db.productionStep.update({
          where: { id: step.id },
          data: { status: 'done', finishedAt: new Date() },
        });
        completedSteps++;
        emitProduction(productionId, {
          type: 'step_end',
          productionId,
          stepId: step.id,
          key,
          status: 'done',
          durationMs: step.startedAt
            ? Date.now() - step.startedAt.getTime()
            : undefined,
        });
        return result;
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        await db.productionStep.update({
          where: { id: step.id },
          data: { status: 'failed', error: message.slice(0, 800), finishedAt: new Date() },
        });
        completedSteps++;
        emitProduction(productionId, {
          type: 'step_end',
          productionId,
          stepId: step.id,
          key,
          status: 'failed',
          error: message.slice(0, 400),
        });
        throw err;
      }
    },
    async registerArtifact(params) {
      const { storagePath, relName } = await saveArtifactFile(params.buffer, extOf(params.mimeType, params.fileName));
      const row: Artifact = await db.artifact.create({
        data: {
          conversationId: run.conversationId,
          productionId,
          origin: 'production',
          kind: params.kind,
          mimeType: params.mimeType,
          fileName: params.fileName || relName,
          size: params.buffer.length,
          storagePath,
          metaJson: params.metaJson ? JSON.stringify(params.metaJson) : undefined,
        },
      });
      return toArtifactMeta(row);
    },
    async resolveArtifactFile(artifactId: string) {
      const artifact = await db.artifact.findUnique({ where: { id: artifactId } });
      if (!artifact || !artifact.storagePath) {
        throw new Error(`নির্দেশিত ফাইল (artifact) পাওয়া যায়নি: ${artifactId.slice(0, 24)}`);
      }
      return artifact.storagePath;
    },
  };

  return { ctx, pipeline, run: { id: run.id, conversationId: run.conversationId, spec } };
}

function extOf(mimeType: string, fileName: string): string {
  const byMime: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'video/mp4': 'mp4',
    'text/plain': 'txt',
    'application/x-subrip': 'srt',
  };
  if (byMime[mimeType]) return byMime[mimeType];
  const m = /\.([a-z0-9]{1,5})$/i.exec(fileName);
  return m ? m[1].toLowerCase() : 'bin';
}

async function runProduction(productionId: string): Promise<void> {
  const loaded = await loadCtx(productionId);
  if (!loaded) return;
  const { ctx, pipeline } = loaded;

  const startedAt = new Date();
  await db.production.update({
    where: { id: productionId },
    data: { status: 'running', startedAt, progress: 1 },
  });
  emitProduction(productionId, { type: 'production_started', productionId });
  console.log(`[production] ${productionId.slice(-6)} started (${ctx.spec.type})`);

  let finalStatus: 'completed' | 'failed' | 'partial' | 'cancelled' = 'completed';
  let errorMessage: string | undefined;
  let result: Record<string, unknown> = {};

  try {
    const pipelineResult = await pipeline(ctx);
    result = pipelineResult.result;
    if (pipelineResult.statusOverride === 'partial' || ctx.partialNotes.length > 0) {
      finalStatus = 'partial';
      result = { ...result, partialNotes: ctx.partialNotes };
    }
  } catch (err) {
    if (err instanceof CancelledError) {
      finalStatus = 'cancelled';
    } else {
      errorMessage = err instanceof Error ? err.message : String(err);
      finalStatus = 'failed';
      // কিছু আর্টিফ্যাক্ট তৈরি হয়ে থাকলে partial
      const produced = await db.artifact.count({ where: { productionId } });
      if (produced > 0) {
        finalStatus = 'partial';
        result = { partialNotes: [...ctx.partialNotes, `ত্রুটি: ${errorMessage.slice(0, 300)}`] };
      }
    }
  }

  // validating অবস্থা দেখিয়ে চূড়ান্ত নিবন্ধন
  try {
    await db.production.update({ where: { id: productionId }, data: { status: 'validating' } });
    emitProduction(productionId, {
      type: 'production_progress',
      productionId,
      progress: 98,
      currentStepKey: 'finalizing',
    });

    await db.production.update({
      where: { id: productionId },
      data: {
        status: finalStatus,
        progress: finalStatus === 'failed' ? undefined : 100,
        error: errorMessage?.slice(0, 1000),
        resultJson: Object.keys(result).length > 0 ? JSON.stringify(result).slice(0, 8000) : undefined,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    console.error(`[production] ${productionId.slice(-6)} finalize error:`, err);
  }

  await cleanupWorkingDir(ctx.workingDir);
  emitProduction(productionId, { type: 'production_finished', productionId, status: finalStatus, error: errorMessage?.slice(0, 400) });
  console.log(`[production] ${productionId.slice(-6)} finished: ${finalStatus}`);
}

async function failProduction(productionId: string, message: string): Promise<void> {
  try {
    await db.production.update({
      where: { id: productionId },
      data: { status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() },
    });
    emitProduction(productionId, { type: 'production_finished', productionId, status: 'failed', error: message.slice(0, 400) });
  } catch (err) {
    console.error('[production] failProduction error', err);
  }
}

/** >২০ মিনিট ধরে চলমান প্রোডাকশন → failed (GET /api/productions-এ ডাকা হয়) */
export async function sweepStaleProductions(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_PRODUCTION_MS);
    const res = await db.production.updateMany({
      where: { status: { in: ['running', 'validating'] }, startedAt: { lt: cutoff } },
      data: { status: 'failed', error: 'সময়সীমা অতিক্রম করেছে (stale sweep)', finishedAt: new Date() },
    });
    if (res.count > 0) {
      console.log(`[production] sweep: ${res.count} টি stale প্রোডাকশন failed`);
    }
  } catch (err) {
    console.error('[production] sweep error', err);
  }
}
