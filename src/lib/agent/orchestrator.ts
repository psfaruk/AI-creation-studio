// ============================================================
// Agent Orchestrator — Execution Loop (মাস্টার প্ল্যান §৫)।
// LLM ↔ Tools JSON প্রোটোকল, প্রতি ধাপে DB persist + SSE emit,
// attachment pre-steps (vision/ear), finalize/fail, stale-run sweep।
// ============================================================

import type { AgentRun } from '@prisma/client';
import { db } from '@/lib/db';
import { TOOL_CATALOG } from '@/lib/types';
import { emit } from './events';
import { chatComplete, parseToolCall, SYSTEM_PROMPT, type LLMMessage } from './llm';
import { validateToolCall, type ToolOutput, type ToolSpec } from './registry';
import { buildMessageView } from './serialize';

const MAX_STEPS = 8;
const HISTORY_LIMIT = 20;
const STALE_RUN_MS = 10 * 60 * 1000; // ১০ মিনিট

function logStep(runId: string, step: number, tool: string, status: string, ms: number): void {
  console.log(`[agent] run=${runId.slice(-6)} step=${step} tool=${tool} status=${status} ms=${ms}`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`টুল টাইমআউট (${label}, ${Math.round(ms / 1000)}s)`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      err => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    );
  });
}

/**
 * Fire-and-forget রান শুরু। POST /api/chat response ফেরানোর আগেই ডাকা হয়;
 * ভেতরের সব ব্যর্থতা failRun দিয়ে ধরা হয় — কখনো uncaught নয়।
 */
export function startAgentRun(runId: string): void {
  setImmediate(() => {
    runAgentLoop(runId).catch(async err => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[agent] run=${runId.slice(-6)} fatal:`, message);
      try {
        await failRun(runId, message);
      } catch (failErr) {
        console.error(`[agent] run=${runId.slice(-6)} failRun error:`, failErr);
      }
    });
  });
}

interface RunStatsAccumulator {
  toolCalls: number;
}

interface ToolOutcome {
  ok: boolean;
  resultJson?: string;
  summary?: string;
  error?: string;
  durationMs: number;
}

/**
 * একটি টুল সত্যিকারের করে চালায়: ToolCall row + AgentStep row + tool_start/tool_end
 * emit + timeout-সহ execute + DB আপডেট। ব্যর্থ হলেও throw করে না — outcome ফেরায়।
 */
async function executeToolCall(
  run: AgentRun,
  toolName: string,
  spec: ToolSpec,
  args: Record<string, unknown>,
  nextSeq: () => number,
  stats: RunStatsAccumulator
): Promise<ToolOutcome> {
  const inputSummary = await Promise.resolve(
    spec.inputSummary(args) as string | Promise<string>
  ).catch(() => toolName);

  const catalog = TOOL_CATALOG.find(t => t.name === toolName);
  const toolCall = await db.toolCall.create({
    data: {
      runId: run.id,
      tool: toolName,
      argsJson: safeJson(args),
      inputSummary,
      status: 'running',
    },
  });
  stats.toolCalls++;

  const stepSeq = nextSeq();
  await db.agentStep.create({
    data: {
      runId: run.id,
      seq: stepSeq,
      kind: 'tool_execution',
      name: toolName,
      payloadJson: safeJson({ toolCallId: toolCall.id, inputSummary }),
    },
  });

  emit(run.id, {
    type: 'tool_start',
    activityId: toolCall.id,
    tool: toolName,
    title: catalog?.title ?? toolName,
    icon: catalog?.icon ?? 'Wrench',
    input: inputSummary,
  });

  const t0 = Date.now();
  try {
    const output: ToolOutput = await withTimeout(
      spec.execute(args, {
        conversationId: run.conversationId,
        runId: run.id,
        toolCallId: toolCall.id,
      }),
      spec.timeoutMs,
      toolName
    );
    const durationMs = Date.now() - t0;
    await db.toolCall.update({
      where: { id: toolCall.id },
      data: {
        status: 'done',
        resultJson: output.resultJson,
        outputSummary: output.summary,
        durationMs,
      },
    });
    emit(run.id, {
      type: 'tool_end',
      activityId: toolCall.id,
      status: 'done',
      output: output.summary,
      artifacts: output.artifacts,
      durationMs,
    });
    logStep(run.id, stepSeq, toolName, 'done', durationMs);
    return { ok: true, resultJson: output.resultJson, summary: output.summary, durationMs };
  } catch (err) {
    const durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    await db.toolCall.update({
      where: { id: toolCall.id },
      data: { status: 'failed', error: message.slice(0, 1000), durationMs },
    });
    emit(run.id, {
      type: 'tool_end',
      activityId: toolCall.id,
      status: 'failed',
      error: message.slice(0, 500),
      durationMs,
    });
    logStep(run.id, stepSeq, toolName, 'failed', durationMs);
    return { ok: false, error: message, durationMs };
  }
}

async function runAgentLoop(runId: string): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'running') return;

  const startedAt = Date.now();

  // ---- ১. context তৈরি: system prompt + সর্বশেষ ~২০টি বার্তা ----
  const history = await db.message.findMany({
    where: { conversationId: run.conversationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 300,
  });
  const recent = history.slice(-HISTORY_LIMIT);
  const context: LLMMessage[] = [
    { role: 'assistant', content: SYSTEM_PROMPT },
    ...recent.map(m => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as LLMMessage['role'],
      content: m.content,
    })),
  ];

  let seq = 0;
  const nextSeq = () => ++seq;
  const stats: RunStatsAccumulator = { toolCalls: 0 };

  emit(runId, { type: 'run_started', runId, conversationId: run.conversationId });

  // ---- ২. attachment pre-steps: ছবি → analyze_image, অডিও → transcribe_audio ----
  const trigger = await db.message.findFirst({
    where: { conversationId: run.conversationId, role: 'user' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  if (trigger) {
    const uploads = await db.artifact.findMany({
      where: { messageId: trigger.id, origin: 'user_upload' },
      orderBy: { createdAt: 'asc' },
    });
    for (const upload of uploads) {
      const isAudio = upload.kind === 'audio';
      const toolName = isAudio ? 'transcribe_audio' : 'analyze_image';
      const validation = validateToolCall(
        toolName,
        isAudio ? { audio: upload.id } : { image: upload.id, question: 'ছবিটির বিস্তারিত বর্ণনা দাও' }
      );
      if (!validation.ok) continue;
      const outcome = await executeToolCall(run, toolName, validation.tool, validation.input, nextSeq, stats);
      const prefix = `ব্যবহারকারীর অ্যাটাচমেন্ট (${upload.fileName}) বিশ্লেষণ: `;
      context.push({
        role: 'user',
        content: outcome.ok ? prefix + (outcome.resultJson ?? '') : `ব্যবহারকারীর অ্যাটাচমেন্ট (${upload.fileName}) বিশ্লেষণ করা যায়নি: ${outcome.error ?? ''}`,
      });
    }
  }

  // ---- ৩. execution loop (MAX_STEPS পর্যন্ত) ----
  let llmSteps = 0;
  let finalText: string | null = null;
  let forced = false;

  for (let step = 1; step <= MAX_STEPS; step++) {
    const t0 = Date.now();
    const text = await chatComplete(context);
    llmSteps++;
    const decisionSeq = nextSeq();
    await db.agentStep.create({
      data: {
        runId,
        seq: decisionSeq,
        kind: 'llm_decision',
        name: 'llm',
        payloadJson: safeJson({ text: text.slice(0, 4000) }),
      },
    });
    logStep(runId, decisionSeq, 'llm', 'decision', Date.now() - t0);

    const parsed = parseToolCall(text);
    if (!parsed) {
      if (!text.trim()) {
        context.push({
          role: 'user',
          content: 'তোমার উত্তর খালি এসেছে। অনুগ্রহ করে প্রশ্নের সরাসরি উত্তর দাও।',
        });
        continue;
      }
      finalText = text;
      break;
    }

    // LLM-এর নিজের টুল কল context-এ রাখো
    context.push({ role: 'assistant', content: text });

    const validation = validateToolCall(parsed.tool, parsed.arguments);
    if (!validation.ok) {
      // unknown tool / zod fail → structured error ফেরত (ToolCall row নয়, তবে ধাপ গণনা হয়)
      logStep(runId, decisionSeq, parsed.tool, 'invalid', 0);
      context.push({
        role: 'user',
        content: `[TOOL_RESULT] name: ${parsed.tool}\nstatus: error\n${safeJson({ error: validation.error, hint: validation.hint })}`,
      });
      continue;
    }

    const outcome = await executeToolCall(run, validation.tool.name, validation.tool, validation.input, nextSeq, stats);
    if (outcome.ok) {
      context.push({
        role: 'user',
        content: `[TOOL_RESULT] name: ${validation.tool.name}\nstatus: success\n${outcome.resultJson ?? ''}`,
      });
    } else {
      context.push({
        role: 'user',
        content: `[TOOL_RESULT] name: ${validation.tool.name}\nstatus: error\n${safeJson({ error: (outcome.error ?? '').slice(0, 500), hint: 'আর্গুমেন্ট ঠিক করো বা অন্য উপায়ে চেষ্টা করো।' })}`,
      });
    }
  }

  // ---- ৪. MAX_STEPS ছাড়িয়ে গেলে বাধ্যতামূলক চূড়ান্ত উত্তর ----
  if (finalText === null) {
    forced = true;
    context.push({ role: 'user', content: 'আর কোনো টুল ছাড়া এখনই চূড়ান্ত উত্তর দাও।' });
    const t0 = Date.now();
    const text = await chatComplete(context);
    const forcedSeq = nextSeq();
    await db.agentStep.create({
      data: {
        runId,
        seq: forcedSeq,
        kind: 'final_answer',
        name: 'llm_forced',
        payloadJson: safeJson({ text: text.slice(0, 4000) }),
      },
    });
    logStep(runId, forcedSeq, 'llm', 'forced-final', Date.now() - t0);
    const stillToolCall = parseToolCall(text);
    finalText =
      text.trim() && !stillToolCall
        ? text
        : 'দুঃখিত, এই কাজটি সম্পূর্ণ করতে অনুমোদিত ধাপের সীমা (৮) শেষ হয়ে গেছে। অনুগ্রহ করে প্রশ্নটি ছোট ছোট অংশে ভাগ করে আবার জিজ্ঞাসা করুন।';
  }

  await finalizeRun(runId, finalText, {
    steps: forced ? MAX_STEPS : llmSteps,
    toolCalls: stats.toolCalls,
    durationMs: Date.now() - startedAt,
    seq: nextSeq(),
  });
}

/**
 * চূড়ান্ত উত্তর: assistant Message + run completed — ট্রানজেকশনে
 * (race-free), তারপর 'message' + 'run_finished' emit।
 */
async function finalizeRun(
  runId: string,
  content: string,
  stats: { steps: number; toolCalls: number; durationMs: number; seq: number }
): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'running') return;
  const finishedAt = new Date();

  const [message] = await db.$transaction([
    db.message.create({
      data: { conversationId: run.conversationId, role: 'assistant', content, runId: run.id },
    }),
    db.agentRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        stepCount: stats.steps,
        toolCallCount: stats.toolCalls,
        durationMs: stats.durationMs,
        finishedAt,
      },
    }),
    db.conversation.update({
      where: { id: run.conversationId },
      data: { updatedAt: finishedAt },
    }),
    db.agentStep.create({
      data: {
        runId,
        seq: stats.seq,
        kind: 'final_answer',
        name: 'final',
        payloadJson: safeJson({ length: content.length }),
      },
    }),
  ]);

  logStep(runId, stats.seq, 'final', 'completed', stats.durationMs);

  const view = await buildMessageView(message);
  emit(runId, { type: 'message', conversationId: run.conversationId, message: view });
  emit(runId, { type: 'run_finished', runId, conversationId: run.conversationId, status: 'completed' });
}

/** রান ব্যর্থ: run failed + fallback assistant message + events। */
async function failRun(runId: string, errorMessage: string): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'running') return;

  const durationMs = Date.now() - run.startedAt.getTime();
  const stepCount = await db.agentStep.count({ where: { runId } });
  const toolCallCount = await db.toolCall.count({ where: { runId } });
  const existing = await db.message.findFirst({ where: { runId } });
  const finishedAt = new Date();
  const content = `দুঃখিত, কাজটি সম্পন্ন করা যায়নি।\n\nত্রুটি: ${errorMessage.slice(0, 500)}`;

  const ops: any[] = [
    db.agentRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: errorMessage.slice(0, 1000),
        stepCount,
        toolCallCount,
        durationMs,
        finishedAt,
      },
    }),
    db.conversation.update({ where: { id: run.conversationId }, data: { updatedAt: finishedAt } }),
  ];
  if (!existing) {
    ops.unshift(
      db.message.create({
        data: { conversationId: run.conversationId, role: 'assistant', content, runId },
      })
    );
  }
  const results = await db.$transaction(ops);
  const message = existing ?? results[0];

  logStep(runId, stepCount, 'final', 'failed', durationMs);

  if (!existing && message) {
    const view = await buildMessageView(message);
    emit(runId, { type: 'message', conversationId: run.conversationId, message: view });
  }
  emit(runId, {
    type: 'run_finished',
    runId,
    conversationId: run.conversationId,
    status: 'failed',
    error: errorMessage.slice(0, 500),
  });
}

/** ১০ মিনিটের বেশি 'running' থাকা রান → 'interrupted' (GET conversations-এ ডাকা হয়)। */
export async function sweepStaleRuns(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_RUN_MS);
    const res = await db.agentRun.updateMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      data: { status: 'interrupted', error: 'রানটি অসম্পূর্ণ অবস্থায় আটকে গিয়েছিল (stale sweep)', finishedAt: new Date() },
    });
    if (res.count > 0) {
      console.log(`[agent] sweep: ${res.count} টি stale রান interrupted করা হয়েছে`);
    }
  } catch (err) {
    console.error('[agent] sweepStaleRuns error', err);
  }
}
