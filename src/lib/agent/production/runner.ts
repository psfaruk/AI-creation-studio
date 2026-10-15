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
import { logProductionMetrics } from '../run-metrics';
import { cleanupWorkingDir, makeWorkingDir, killProductionFfmpeg, runWithFfmpegTracking } from '@/lib/media/ffmpeg';
import { validateSpec } from '../capabilities';

const STALE_PRODUCTION_MS = 20 * 60 * 1000; // ২০ মিনিট
/** AI-ভিডিও প্রোডাকশন (CogVideoX-3) প্রতি শটে মিনিট নেয় — দীর্ঘ সময়সীমা */
const STALE_AI_VIDEO_MS = 60 * 60 * 1000; // ৬০ মিনিট
/** সর্বোচ্চ সমান্তরাল চলমান প্রোডাকশন (§১২ ধাপ ৮ — কনকারেন্সি সীমা) */
const MAX_CONCURRENT = 2;

const g = globalThis as any;
interface ProductionQueueState {
  running: Set<string>;
  queue: string[];
}
function queueState(): ProductionQueueState {
  if (!g.__productionQueue) g.__productionQueue = { running: new Set(), queue: [] } as ProductionQueueState;
  return g.__productionQueue;
}

/** সারি থেকে খালি স্লটে পরের প্রোডাকশন চালু করা */
function drainQueue(): void {
  const state = queueState();
  while (state.running.size < MAX_CONCURRENT && state.queue.length > 0) {
    const nextId = state.queue.shift()!;
    if (state.running.has(nextId)) continue;
    state.running.add(nextId);
    console.log(`[production] ${nextId.slice(-6)} সারি থেকে চালু (${state.running.size}/${MAX_CONCURRENT})`);
    runProduction(nextId).catch(async err => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[production] ${nextId.slice(-6)} fatal:`, message);
      try {
        await failProduction(nextId, message);
      } catch (failErr) {
        console.error(`[production] ${nextId.slice(-6)} fail error:`, failErr);
      }
    });
  }
}

export class CancelledError extends Error {
  constructor() {
    super('প্রোডাকশন বাতিল করা হয়েছে');
  }
}

/**
 * §3-D নাম-চুক্তি: ai_video/ffmpeg-ট্র্যাকার থেকে আসা বাতিল-ত্রুটি
 * (VideoAbortedError / ffmpeg-kill) instanceof ছাড়াই চেনার সাধারণ পথ —
 * আমদানি-চক্র (runner ↔ pipelines ↔ ai_video) এড়াতে নাম-মিলিয়ে চেক।
 */
function isCancellationError(err: unknown): boolean {
  return err instanceof CancelledError || (err instanceof Error && err.name === 'CancelledError');
}

/** ধাপের সময়সীমা অতিক্রমণ (S10) — fail-soft: ধাপ failed-চিহ্ত হয়,
 *  সৎ partialNote যোগ হয়, প্রোডাকশন পরের ধাপে চলে যায় */
export class StepTimeoutError extends Error {
  constructor(key: string, timeoutMs: number) {
    super(`ধাপ "${key}" সময়সীমা (${Math.round(timeoutMs / 1000)} সে.) অতিক্রান্ত — অবনমিত/বাদ পথে চলছে`);
    this.name = 'StepTimeoutError';
  }
}

export interface RunStepOptions {
  /** ধাপের সর্বোচ্চ সময়সীমা (মি.সে.)। অতিক্রান্ত হলে ধাপ failed +
   *  সৎ নোট + প্রোডাকশন চলতে থাকে (fail-soft)। 0/undefined = সীমা নেই।
   *  শুধু রিটার্ন-ভ্যালু-অব্যবহৃত কল-সাইটে দিন (টাইমআউটে undefined ফেরে)। */
  timeoutMs?: number;
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
  /** ধাপ চালাও — row তৈরি, ইভেন্ট, অগ্রগতি, ত্রুটি হ্যান্ডলিং;
   *  opts.timeoutMs দিলে সময়সীমা-অতিক্রমে fail-soft (S10) */
  runStep<T>(
    key: string,
    title: string,
    fn: (step: StepHandle) => Promise<T>,
    opts?: RunStepOptions
  ): Promise<T>;
  /** দুটি ধাপের মাঝে বাতিল-অনুরোধ পরীক্ষা (CancelledError ছুড়ে) */
  checkCancelled(): Promise<void>;
  /** §3-D: নিক্ষেপ-বিহীন বাতিল-অনুরোধ পরীক্ষা — ai_video-র পোল-লুপ ও
   *  দীর্ঘ অপেক্ষাগুলোতে ২ সে. টিকে জিজ্ঞাসা করে */
  isCancelled(): Promise<boolean>;
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

/** confirm API থেকে ডাকা হয় — fire-and-forget শুরু (কনকারেন্সি-সীমাসহ) */
export function startProduction(productionId: string): void {
  const state = queueState();
  if (state.running.has(productionId)) return;
  if (state.running.size >= MAX_CONCURRENT) {
    state.queue.push(productionId);
    console.log(`[production] ${productionId.slice(-6)} সারিতে যোগ (চলমান ${state.running.size}/${MAX_CONCURRENT})`);
    return;
  }
  state.running.add(productionId);
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
      if (fresh?.status === 'cancelling') {
        // §3-D: এই প্রোডাকশনের সক্রিয় ffmpeg-সন্তান তৎক্ষণাৎ মেরে ফেলো —
        // চলমান এনকোড প্রক্রিয়া বাতিলকরণের পরেও মিনিটখানেক চলতে পারে
        try {
          const killed = killProductionFfmpeg(productionId);
          if (killed > 0) console.log(`[production] ${productionId.slice(-6)} বাতিল: ${killed}টি ffmpeg প্রক্রিয়া বন্ধ`);
        } catch {
          // সর্বোচেষ্ট
        }
        throw new CancelledError();
      }
    },
    async isCancelled() {
      try {
        const fresh = await db.production.findUnique({ where: { id: productionId }, select: { status: true } });
        return fresh?.status === 'cancelling';
      } catch {
        return false;
      }
    },
    async runStep<T>(
      key: string,
      title: string,
      fn: (step: StepHandle) => Promise<T>,
      stepOpts?: RunStepOptions
    ): Promise<T> {
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
      // S10: জম্বি-প্রহরী — সময়সীমার পরে চলতে থাকা কল-বডির লেখা নিষ্ক্রিয়
      let zombie = false;
      const handle: StepHandle = {
        id: step.id,
        async setDetail(detail: string) {
          if (zombie) return; // ধাপ বন্ধের পরে বিস্তারিত উপরে লিখবে না
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
      };
      const timeoutMs = Math.max(0, stepOpts?.timeoutMs ?? 0);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = fn(handle);
        // জম্বি-নীরবতা: টাইমআউটের পরেও চলা কল-বডির ত্রুটি আনহ্যান্ডেলড হবে না
        work.catch(() => undefined);
        const raced =
          timeoutMs > 0
            ? Promise.race([
                work,
                new Promise<never>((_, reject) => {
                  timer = setTimeout(() => {
                    zombie = true;
                    reject(new StepTimeoutError(key, timeoutMs));
                  }, timeoutMs);
                }),
              ])
            : work;
        const result = await raced;
        if (timer) clearTimeout(timer);
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
        if (timer) clearTimeout(timer);
        if (isCancellationError(err)) {
          // বাতিল — ধাপটি failed নয়, skipped হিসেবে সৎভাবে চিহ্নিত
          await db.productionStep.update({
            where: { id: step.id },
            data: { status: 'skipped', finishedAt: new Date() },
          }).catch(() => undefined);
          emitProduction(productionId, {
            type: 'step_end',
            productionId,
            stepId: step.id,
            key,
            status: 'skipped',
            // (অডিট §A3) বাতিল-ধাপেও সময় — সারি-সেলাই হওয়া ধাপগুলোর খরচ দৃশ্যমান
            durationMs: step.startedAt ? Date.now() - step.startedAt.getTime() : undefined,
          });
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        // S10 fail-soft: সময়সীমা-অতিক্রম ধাপ প্রোডাকশন মারবে না —
        // ধাপ failed + সৎ নোট + undefined রিটার্ন (কল-সাইট-সচেতন চুক্তি)
        if (err instanceof StepTimeoutError) {
          partialNotes.push(err.message);
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
            // (অডিট §A3) ব্যর্থ ধাপেও অতিবাহিত-সময় — সময়সীমায় আটকেছে কিনা স্পষ্ট
            durationMs: step.startedAt ? Date.now() - step.startedAt.getTime() : undefined,
          });
          return undefined as unknown as T;
        }
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
          // (অডিট §A3) ব্যর্থ ধাপেও অতিবাহিত-সময় — কতক্ষণ চেষ্টা করে ব্যর্থ হয়েছে
          durationMs: step.startedAt ? Date.now() - step.startedAt.getTime() : undefined,
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
  const state = queueState();
  try {
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

    // §3-D আক্রমণাত্মক বাতিল-প্রহরী: ৫ সেকেন্ড পর পর অবস্থা দেখে
    // 'cancelling' পেলে সক্রিয় ffmpeg-সন্তান মেরে ফেলে — ধাপ-চেকপয়েন্টের
    // অপেক্ষায় থাকা দীর্ঘ এনকোডও দ্রুত বিরত হয়।
    const cancelWatch = setInterval(() => {
      void (async () => {
        try {
          const fresh = await db.production.findUnique({ where: { id: productionId }, select: { status: true } });
          if (fresh?.status === 'cancelling') killProductionFfmpeg(productionId);
        } catch {
          // নীরব
        }
      })();
    }, 5_000);
    if (typeof (cancelWatch as any).unref === 'function') (cancelWatch as any).unref();

    try {
      // §3-D: ffmpeg-ট্র্যাকিং-সুযোগে পাইপলাইন — এই প্রোডাকশনের সব
      // runFfmpeg-সন্তান বাতিলে kill করা যায় (film-helpers-এর ভেতরেরও)
      const pipelineResult = await runWithFfmpegTracking(productionId, () => pipeline(ctx));
      result = pipelineResult.result;
      if (pipelineResult.statusOverride === 'partial' || ctx.partialNotes.length > 0) {
        finalStatus = 'partial';
        result = { ...result, partialNotes: ctx.partialNotes };
      }
    } catch (err) {
      if (isCancellationError(err)) {
        finalStatus = 'cancelled';
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
        finalStatus = 'failed';
        // §3-D সামঞ্জস্য: ত্রুটি যদি আমাদের বাতিল-kill-এর পার্শ্ব-ফল হয়
        // (যেমন মারা যাওয়া ffmpeg-এর ত্রুটি), ব্যবহারকারী বাতিলই চেয়েছিলেন
        const currentStatus = await db.production
          .findUnique({ where: { id: productionId }, select: { status: true } })
          .then(r => r?.status)
          .catch(() => undefined);
        if (currentStatus === 'cancelling') {
          finalStatus = 'cancelled';
          errorMessage = undefined;
        } else {
          // কিছু আর্টিফ্যাক্ট তৈরি হয়ে থাকলে partial
          const produced = await db.artifact.count({ where: { productionId } });
          if (produced > 0) {
            finalStatus = 'partial';
            result = { partialNotes: [...ctx.partialNotes, `ত্রুটি: ${errorMessage.slice(0, 300)}`] };
          }
        }
      }
    } finally {
      clearInterval(cancelWatch);
      // যা-ই হোক, এই প্রোডাকশনের ঝুলে-থাকা ffmpeg-সন্তান থাকলে পরিষ্কার
      try {
        killProductionFfmpeg(productionId);
      } catch {
        // নীরব
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

    // (Phase-1 অবজারভেবিলিটি) প্রোডাকশন-শেষের এক-লাইন কাঠামোগত মেট্রিকস।
    // সারি-অপেক্ষা (startedAt−createdAt) ও মোট সময় প্রকৃত সারি থেকে;
    // ধাপ/আর্টিফ্যাক্ট-গণনা সেরা-প্রচেষ্টায় (ব্যর্থ হলে null — কাল্পনিক নয়)।
    try {
      const [finalRow, artifacts, steps] = await Promise.all([
        db.production.findUnique({
          where: { id: productionId },
          select: { createdAt: true, startedAt: true, finishedAt: true, type: true },
        }),
        db.artifact.count({ where: { productionId } }),
        db.productionStep.findMany({ where: { productionId }, select: { status: true } }),
      ]);
      const queueWaitMs =
        finalRow?.startedAt && finalRow.createdAt
          ? Math.max(0, finalRow.startedAt.getTime() - finalRow.createdAt.getTime())
          : null;
      const durationMs =
        finalRow?.finishedAt && finalRow.startedAt
          ? finalRow.finishedAt.getTime() - finalRow.startedAt.getTime()
          : null;
      logProductionMetrics({
        productionId,
        type: finalRow?.type ?? ctx.spec.type,
        outcome: finalStatus,
        queueWaitMs,
        durationMs,
        stepsDone: steps ? steps.filter(s => s.status === 'done').length : null,
        stepsFailed: steps ? steps.filter(s => s.status === 'failed').length : null,
        artifacts,
        // শ্রেণি-সংকেত মাত্র — কোনো ত্রুটি-টেক্সট নয় (DB-তে সংরক্ষিত)
        errorCategoryHint: errorMessage ? 'see_error_field' : null,
      });
    } catch {
      // মেট্রিকস-সংগ্রহ ব্যর্থ হলে প্রোডাকশন-ফলাফল অপরিবর্তিত থাকে
    }
  } finally {
    state.running.delete(productionId);
    setImmediate(drainQueue);
  }
}

async function failProduction(productionId: string, message: string): Promise<void> {
  try {
    await db.production.update({
      where: { id: productionId },
      data: { status: 'failed', error: message.slice(0, 1000), finishedAt: new Date() },
    });
    emitProduction(productionId, { type: 'production_finished', productionId, status: 'failed', error: message.slice(0, 400) });
    // (Phase-1 অবজারভেবিলিটি) ব্যর্থ-প্রোডাকশনের মেট্রিকস-লাইন
    const meta = await db.production.findUnique({
      where: { id: productionId },
      select: { createdAt: true, startedAt: true, type: true },
    });
    logProductionMetrics({
      productionId,
      type: meta?.type ?? 'unknown',
      outcome: 'failed',
      queueWaitMs:
        meta?.startedAt && meta.createdAt
          ? Math.max(0, meta.startedAt.getTime() - meta.createdAt.getTime())
          : null,
      durationMs: null, // প্রাথমিক-ব্যর্থতার পথে নির্ভরযোগ্য সময়-সীমা নেই
      stepsDone: null,
      stepsFailed: null,
      artifacts: null,
      errorCategoryHint: 'see_error_field',
    });
  } catch (err) {
    console.error('[production] failProduction error', err);
  }
}

/** >সময়সীমা-অতিক্রম চলমান প্রোডাকশন → failed (AI-ভিডিওতে দীর্ঘ সীমা)।
 *  §2 সততা: ত্রুটি-বার্তা সম্ভাব্য কারণ স্পষ্টভাবে বলে। */
export async function sweepStaleProductions(): Promise<void> {
  try {
    const aiVideoTypes = ['motion_video', 'music_video', 'short_film'];
    const now = Date.now();
    for (const [staleMs, types, message] of [
      [STALE_AI_VIDEO_MS, aiVideoTypes, `সময়সীমা অতিক্রম (৬০ মিনিট) — সাধারণত প্রোভাইডার থ্রটলিং/লম্বা কিউ-এর কারণে; আবার চেষ্টা করুন`] as const,
      [STALE_PRODUCTION_MS, ['image', 'audio'] as string[], `সময়সীমা অতিক্রম (২০ মিনিট) — সম্ভাব্য কারণ: প্রোভাইডার রেট-সীমা বা আটকে যাওয়া কল; আবার চেষ্টা করুন`] as const,
    ] as [number, string[], string][]) {
      const cutoff = new Date(now - staleMs);
      const res = await db.production.updateMany({
        where: { status: { in: ['running', 'validating'] }, type: { in: types }, startedAt: { lt: cutoff } },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
      if (res.count > 0) {
        console.log(`[production] sweep: ${res.count} টি stale প্রোডাকশন failed (${types.join(',')})`);
      }
    }
  } catch (err) {
    console.error('[production] sweep error', err);
  }
}

// ------------------------------------------------------------
// §2 সততা: রিস্টার্টে বাধাগ্রস্ত প্রোডাকশন — মডিউল লোডে একবারই
// 'running'/'queued'/'validating'/'cancelling' সারিগুলো সৎভাবে failed
// করা হয় ("চলছে" দেখানো মিথ্যা হবে — প্রসেস মরে গেছে)। globalThis-
// গার্ডেড; মেমরির running/queue-সেটে থাকা আইডি বাদ যায় (dev HMR-এ
// চলমান কাজ মিথ্যাভাবে বাদ না পড়তে)।
// ------------------------------------------------------------
async function sweepInterruptedOnBoot(): Promise<void> {
  try {
    const state = queueState();
    const rows = await db.production.findMany({
      where: { status: { in: ['running', 'queued', 'validating', 'cancelling'] } },
      select: { id: true },
    });
    const interrupted = rows
      .map(r => r.id)
      .filter(id => !state.running.has(id) && !state.queue.includes(id));
    if (interrupted.length === 0) return;
    const message = 'সার্ভার রিস্টার্টে বাধাগ্রস্ত হয়েছে — আবার চালু করুন (নিচের "আবার চালান" বা "সংশোধন" দিয়ে নতুন প্রস্তাব তৈরি হবে)';
    await db.production.updateMany({
      where: { id: { in: interrupted } },
      data: { status: 'failed', error: message, finishedAt: new Date() },
    });
    for (const id of interrupted) {
      emitProduction(id, { type: 'production_finished', productionId: id, status: 'failed', error: message });
    }
    console.log(`[production] boot-sweep: ${interrupted.length} টি রিস্টার্টে-বাধাগ্রস্ত প্রোডাকশন সৎভাবে failed করা হলো`);
  } catch (err) {
    console.error('[production] boot-sweep error', err);
  }
}

// ------------------------------------------------------------
// S10: পর্যায়ক্রমিক stale-sweep — ট্রাফিক না থাকলেও ঝুলে-থাকা
// প্রোডাকশন সৎভাবে সমাধান পাবে (আগে শুধু GET /api/productions-এ
// চলত; ব্যবহারকারী ট্যাব বন্ধ করলে ঝুলে থাকত)। globalThis-গার্ডেড
// তাই dev hot-reload-এ দ্বৈত টাইমার হবে না।
// ------------------------------------------------------------
{
  const gg = globalThis as any;
  if (!gg.__staleSweepTimer) {
    gg.__staleSweepTimer = setInterval(() => {
      sweepStaleProductions().catch(() => undefined);
    }, 60_000);
    // ইভেন্ট-লুপকে প্রসেস-জীবিত রাখতে বাধ্য করবে না
    if (typeof (gg.__staleSweepTimer as any).unref === 'function') {
      (gg.__staleSweepTimer as any).unref();
    }
  }
  // §2 বুট-সুইপ — একবারই, ৩ সেকেন্ড দেরিতে (মডিউল-গ্রাফ বসন্ত ও
  // চালু-হওয়া কনকারেন্ট কাজ running-সেটে ঢোকার সময় পায়)
  if (!gg.__productionBootSwept) {
    gg.__productionBootSwept = true;
    const bootTimer = setTimeout(() => {
      sweepInterruptedOnBoot().catch(() => undefined);
    }, 3_000);
    if (typeof (bootTimer as any).unref === 'function') (bootTimer as any).unref();
  }
}
