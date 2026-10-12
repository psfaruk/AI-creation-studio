// ============================================================
// Agent Orchestrator — Execution Loop (মাস্টার প্ল্যান §৫)।
// LLM ↔ Tools JSON প্রোটোকল, প্রতি ধাপে DB persist + SSE emit,
// attachment pre-steps (vision/ear), finalize/fail, stale-run sweep।
// ============================================================

import type { AgentRun } from '@prisma/client';
import { db } from '@/lib/db';
import { TOOL_CATALOG } from '@/lib/types';
import { emit } from './events';
import { chatComplete, parseToolCall, type LLMMessage } from './llm';
import { TemporarilyUnavailableError, isRateLimitErrorText } from './retry';
import { isChannelBlocked } from './rate-limit-coordinator';
import { SYSTEM_PROMPT } from './prompts';
import { validateToolCall, type ToolOutput, type ToolSpec } from './registry';
import { buildMessageView } from './serialize';
import { createProduction } from './production/create';
import type { CreativeJobSpec } from '@/lib/types';

const MAX_STEPS = 12;
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

/** টেক্সটটি কি ভাঙা টুল-কল JSON-এর মতো দেখাচ্ছে? (কাটা আউটপুট শনাক্তকরণ) */
function looksLikeToolCall(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{')) return false;
  return /"tool"\s*:/.test(t.slice(0, 200)) || /"arguments"\s*:/.test(t.slice(0, 300));
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

// ------------------------------------------------------------
// S9: রেট-লিমিট-সৎ-অপেক্ষাসহ chatComplete + নিয়ম-ভিত্তিক ইন্টেন্ট-ফলব্যাক
// ------------------------------------------------------------

/**
 * chatComplete + প্রতিটি রেট-লিমিট-অপেক্ষায় SSE run_note —
 * ব্যবহারকারী দেখে "অপেক্ষা চলছে", নিঃশব্দ আটকে থাকা নয়।
 */
async function chatCompleteWithNotes(runId: string, context: LLMMessage[]): Promise<string> {
  return chatComplete(context, {
    onRateLimitWait: info => {
      const sec = Math.max(1, Math.round(info.delayMs / 1000));
      emit(runId, {
        type: 'run_note',
        runId,
        level: 'waiting',
        note:
          `ক্লাউড LLM রেট-লিমিটেড (৪২৯ — সাময়িক, লাইসেন্স-সমস্যা নয়)। ` +
          `পুনঃচেষ্টা ${info.attempt}/৬ — ${sec} সেকেন্ড অপেক্ষা করা হচ্ছে…`,
      });
    },
  });
}

/** ইন্টেন্ট-ফলব্যাকের চেনা কাজের ধরন */
type FallbackIntentType = 'music_video' | 'short_film' | 'motion_video';

interface FallbackIntent {
  type: FallbackIntentType;
  title: string;
  spec: CreativeJobSpec;
}

/** ব্যবহারকারীর বার্তা থেকে শিরোনাম-সদৃশ ছোট অংশ */
function titleFromMessage(message: string, fallback: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  return flat.slice(0, 40) + (flat.length > 40 ? '…' : '');
}

/**
 * নিয়ম-ভিত্তিক ইন্টেন্ট-শনাক্তকরণ (LLM অনুপলব্ধ হলে ব্যবহৃত)।
 * সততা: এটি সাধারণ প্যাটার্ন-ম্যাচ — "AI বোঝাপড়া" নয়; চূড়ান্ত
 * বার্তায় স্পষ্ট বলা হয় নিয়ম-ভিত্তিক পরিকল্পনা ব্যবহৃত হয়েছে।
 */
export function detectProductionIntent(message: string): FallbackIntent | null {
  const msg = (message ?? '').trim();
  if (msg.length < 3) return null;
  // ক্লাউড (ইমেজ/ভিডিও) ব্লকড থাকলে লোকাল-বান্ধব ইঞ্জিন — AI-সাবমিটে
  // মিনিট পোড়ানো নয়, স্টোরিবোর্ড+ক্যামেরা-মোশন পথ (লোকাল-ফ্রেম-ফলব্যাকসহ)।
  // এই ফলব্যাক-পথে আসার মানেই চ্যাট-চ্যানেল ব্লকড ছিল — স্যান্ডবক্স-ব্যাপী
  // উইন্ডোর সম্ভাবনাই বেশি, তাই chat-ব্লকও লোকাল-ইঞ্জিনের সংকেত।
  const cloudVisualsBlocked =
    isChannelBlocked('chat') || isChannelBlocked('image') || isChannelBlocked('video');
  const engine: 'ai_diffusion' | 'cinematic_motion' = cloudVisualsBlocked ? 'cinematic_motion' : 'ai_diffusion';

  // মিউজিক ভিডিও — সবচেয়ে নির্দিষ্ট, তাই আগে
  if (
    /মিউজিক\s*ভিডিও|মিউজিকভিডিও|গানে?র?\s*(ভিডিও|ভিডও|video)|music\s*video|\bmv\b/i.test(msg)
  ) {
    return {
      type: 'music_video',
      title: titleFromMessage(msg, 'মিউজিক ভিডিও'),
      spec: {
        type: 'music_video',
        title: titleFromMessage(msg, 'মিউজিক ভিডিও'),
        idea: msg.slice(0, 2000),
        durationSec: 40,
        aspect: '9:16',
        quality: 'standard',
        videoEngine: engine,
        musicSource: 'procedural',
      } as CreativeJobSpec,
    };
  }
  // শর্ট ফিল্ম / সিনেমা / চলচ্চিত্র
  if (
    /শর্ট\s*ফিল্ম|শর্টফিল্ম|ছোট\s*ফিল্ম|ফিল্ম|ফ্লিম|সিনেমা|চলচ্চিত্র|ছবি\s*বানাও|short\s*film|movie\b|film\b/i.test(
      msg
    )
  ) {
    return {
      type: 'short_film',
      title: titleFromMessage(msg, 'শর্ট ফিল্ম'),
      spec: {
        type: 'short_film',
        title: titleFromMessage(msg, 'শর্ট ফিল্ম'),
        story: msg.slice(0, 4000),
        durationSec: 40,
        aspect: '16:9',
        quality: 'standard',
        videoEngine: engine,
      } as CreativeJobSpec,
    };
  }
  // মোশন ভিডিও
  if (/মোশন\s*ভিডিও|motion\s*video|ভিডিও\s*বানাও|এনিমেট/i.test(msg)) {
    return {
      type: 'motion_video',
      title: titleFromMessage(msg, 'মোশন ভিডিও'),
      spec: {
        type: 'motion_video',
        title: titleFromMessage(msg, 'মোশন ভিডিও'),
        idea: msg.slice(0, 2000),
        durationSec: 12,
        aspect: '16:9',
        quality: 'standard',
        videoEngine: engine,
      } as CreativeJobSpec,
    };
  }
  return null;
}

/**
 * S9 ইন্টেন্ট-ফলব্যাক: LLM পুরোপুরি অনুপলব্ধ হলেও মিউজিক-ভিডিও/
 * ফিল্ম-অনুরোধ চিনে সরাসরি প্রোডাকশন-প্রস্তাব তৈরি করা হয় —
 * সৎ লেবেলসহ (নিয়ম-ভিত্তিক পরিকল্পনা, ক্লাউড-ব্লকড হলে লোকাল-ইঞ্জিন)।
 * @returns productionId — সফল হলে; null — ইন্টেন্ট মেলেনি
 */
async function tryIntentFallback(
  run: AgentRun,
  lastUserMessage: string,
  stepsDone: number,
  stats: { toolCalls: number }
): Promise<string | null> {
  if (stepsDone > 0) return null; // মাঝপথে নয় — শুধু প্রথম-সিদ্ধান্তে অনুপলব্ধ হলে
  const intent = detectProductionIntent(lastUserMessage);
  if (!intent) return null;

  emit(run.id, {
    type: 'run_note',
    runId: run.id,
    level: 'warn',
    note:
      'LLM সাময়িকভাবে অনুপলব্ধ (রেট-লিমিট) — তবু অনুরোধ চেনা গেছে; ' +
      'নিয়ম-ভিত্তিক পরিকল্পনায় প্রস্তাব তৈরি করা হচ্ছে…',
  });

  const created = await createProduction(intent.spec, run.conversationId);
  if (!created.ok) return null;

  const caps = created.caps;
  const typeLabel: Record<FallbackIntentType, string> = {
    music_video: 'মিউজিক ভিডিও',
    short_film: 'শর্ট ফিল্ম',
    motion_video: 'মোশন ভিডিও',
  };
  const finalText =
    `⚠️ ক্লাউড LLM এখন রেট-লিমিটেড (৪২৯ — সাময়িক অবস্থা, লাইসেন্স-সমস্যা নয়)। ` +
    `তাই এই প্রস্তাবটি **নিয়ম-ভিত্তিক পরিকল্পনাকারী** দিয়ে তৈরি — AI-সহায়ক সেটিংস-বাছাই নয়।\n\n` +
    `🎬 **${typeLabel[intent.type]}**: ${caps.spec.title}\n` +
    `- মোট দৈর্ঘ্য: ${caps.spec.durationSec ?? '?'} সেকেন্ড\n` +
    `- আনুপাতিক মাধ্যম: ${caps.spec.aspect ?? '16:9'}\n` +
    `- ইঞ্জিন: ${caps.spec.videoEngine === 'cinematic_motion' ? 'স্টোরিবোর্ড+ক্যামেরা-মোশন (ক্লাউড ব্লকড থাকায় লোকাল-বান্ধব)' : 'AI ডিফিউশন'}\n` +
    (caps.notes.length > 0 ? `- নোট: ${caps.notes.slice(0, 3).join(' | ')}\n` : '') +
    `\n` +
    `নিচের কার্ডে **নিশ্চিত করুন** চাপলেই তৈরি শুরু হবে। ` +
    `গান আপলোড করে থাকলে সেটি স্বয়ংক্রিয়ভাবে যুক্ত হয়েছে। ` +
    `ক্লাউড প্রাপ্যতা ফিরলে পরে আরও উন্নত AI-সংস্করণ চাইলে আবার বলুন।`;

  // প্রস্তাব-কার্ড যুক্ত চূড়ান্ত উত্তর
  await finalizeRun(
    run.id,
    finalText,
    { steps: 1, toolCalls: stats.toolCalls, durationMs: Date.now() - run.startedAt.getTime(), seq: 1000 },
    created.productionId
  );
  return created.productionId;
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
  let proposedProductionId: string | null = null;

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
      if (upload.kind === 'video') {
        // ভিডিও প্রি-স্টেপ নেই — উপস্থিতি জানিয়ে দাও, LLM দরকার হলে inspect_media কল করবে
        context.push({
          role: 'user',
          content: `ব্যবহারকারী একটি ভিডিও আপলোড করেছেন (artifact আইডি: ${upload.id}, নাম: ${upload.fileName})। দরকার হলে inspect_media টুল দিয়ে মেটাডেটা দেখো।`,
        });
        continue;
      }
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
  /** S9: রেট-লিমিট-নিঃশেষে লুপ ভাঙা হয়েছে কি না */
  let rateLimitExhausted = false;

  loop: for (let step = 1; step <= MAX_STEPS; step++) {
    const t0 = Date.now();
    let text: string;
    try {
      text = await chatCompleteWithNotes(runId, context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof TemporarilyUnavailableError || isRateLimitErrorText(msg)) {
        // S9: ৪২৯-উইন্ডো রিট্রাই-বাজেটও ছাড়িয়ে গেছে — লুপ ভাঙো;
        // নিচে ইন্টেন্ট-ফলব্যাক/সৎ-ব্যর্থতা-পথ দেখবে
        rateLimitExhausted = true;
        break loop;
      }
      throw err;
    }
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
      // টুল-কলের মতো দেখাচ্ছে কিন্তু পার্স হয়নি (প্রায়ই আউটপুট-টোকেনে কাটা) →
      // চূড়ান্ত উত্তর হিসেবে নয়, সংশোধন-অনুরোধ হিসেবে ফেরত দাও
      if (looksLikeToolCall(text)) {
        logStep(runId, decisionSeq, 'llm', 'malformed-tool-call', Date.now() - t0);
        context.push({
          role: 'user',
          content:
            'তোমার শেষ উত্তরটি একটি ভাঙা/অসম্পূর্ণ JSON টুল কলের মতো। অনুগ্রহ করে ঠিক এই ফরম্যাটে পুরো, বৈধ, কমপ্যাক্ট JSON দিয়ে আবার পাঠাও: {"tool": "...", "arguments": {...}} — arguments সংক্ষিপ্ত রাখো (দীর্ঘ টেক্সট নয়)।',
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
      // propose_job সফল হলে চূড়ান্ত বার্তার সাথে production কার্ড লিংক হবে
      if (validation.tool.name === 'propose_job' && outcome.resultJson) {
        try {
          const parsedResult = JSON.parse(outcome.resultJson) as { productionId?: string };
          if (parsedResult.productionId) proposedProductionId = parsedResult.productionId;
        } catch {
          // উপেক্ষা
        }
      }
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

  // ---- ৪. S9: রেট-লিমিট-নিঃশেষ → ইন্টেন্ট-ফলব্যাক / সৎ-ব্যর্থতা ----
  if (rateLimitExhausted && finalText === null) {
    // মিউজিক-ভিডিও/ফিল্ম-অনুরোধ হলে নিয়ম-ভিত্তিক পরিকল্পনায় প্রস্তাব তৈরি
    const fallbackProductionId = await tryIntentFallback(
      run,
      trigger?.content ?? '',
      llmSteps,
      stats
    );
    if (fallbackProductionId) {
      proposedProductionId = fallbackProductionId;
      return; // tryIntentFallback ইতিমধ্যে finalize করেছে
    }
    // ইন্টেন্ট মেলেনি — সৎ-ব্যর্থতা (৪২৯ সাময়িক, লাইসেন্স-সমস্যা নয়)
    throw new TemporarilyUnavailableError(
      'LLM (চ্যাট) — রেট-লিমিট-উইন্ডো রিট্রাই-বাজেটও পার করেছে। ' +
        'এটি সাময়িক (কয়েক মিনিট পরে আবার পাঠালেই চলবে); লাইসেন্স-সমস্যা নয়। ' +
        'তাড়াহুড়ো থাকলে স্টুডিও-ভিউ থেকে সরাসরি মিউজিক ভিডিও/শর্ট ফিল্ম তৈরি করা যায়।'
    );
  }

  // ---- ৫. MAX_STEPS ছাড়িয়ে গেলে বাধ্যতামূলক চূড়ান্ত উত্তর ----
  if (finalText === null) {
    forced = true;
    context.push({ role: 'user', content: 'আর কোনো টুল ছাড়া এখনই চূড়ান্ত উত্তর দাও।' });
    const t0 = Date.now();
    const text = await chatCompleteWithNotes(runId, context);
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
        : 'দুঃখিত, এই কাজটি সম্পূর্ণ করতে অনুমোদিত ধাপের সীমা (১২) শেষ হয়ে গেছে। অনুগ্রহ করে প্রশ্নটি ছোট ছোট অংশে ভাগ করে আবার জিজ্ঞাসা করুন।';
  }

  await finalizeRun(runId, finalText, {
    steps: forced ? MAX_STEPS : llmSteps,
    toolCalls: stats.toolCalls,
    durationMs: Date.now() - startedAt,
    seq: nextSeq(),
  }, proposedProductionId);
}

/**
 * চূড়ান্ত উত্তর: assistant Message + run completed — ট্রানজেকশনে
 * (race-free), তারপর 'message' + 'run_finished' emit।
 */
async function finalizeRun(
  runId: string,
  content: string,
  stats: { steps: number; toolCalls: number; durationMs: number; seq: number },
  productionId: string | null = null
): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'running') return;
  const finishedAt = new Date();

  const [message] = await db.$transaction([
    db.message.create({
      data: {
        conversationId: run.conversationId,
        role: 'assistant',
        content,
        runId: run.id,
        productionId: productionId ?? undefined,
      },
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
  // S9: ৪২৯ = সাময়িক অবস্থা — ব্যবহারকারীকে পরিষ্কার বোঝাও ও বিকল্প-পথ বলো
  const isTemporarilyUnavailable = /TEMPORARILY_UNAVAILABLE|429|rate.?limit/i.test(errorMessage);
  const content = isTemporarilyUnavailable
    ? `দুঃখিত, এই মুহূর্তে কাজটি সম্পন্ন করা যায়নি।\n\n` +
      `ত্রুটি: ${errorMessage.slice(0, 400)}\n\n` +
      `**এটি সাময়িক** — ক্লাউড API-র রেট-লিমিট (৪২৯); লাইসেন্স বা অনুমতির সমস্যা নয়।\n\n` +
      `- কয়েক মিনিট পর একই বার্তা আবার পাঠালে সাধারণত কাজ করবে।\n` +
      `- তাড়াহুড়ো থাকলে **স্টুডিও** ভিউ থেকে সরাসরি মিউজিক ভিডিও / শর্ট ফিল্ম তৈরি করা যায় (LLM ছাড়াই)।\n` +
      `- রেট-লিমিট-উইন্ডোতেও লোকাল প্রসিডিউরাল গান + ভিজ্যুয়াল দিয়ে ভিডিও তৈরি হবে (সৎ লেবেলসহ)।`
    : `দুঃখিত, কাজটি সম্পন্ন করা যায়নি।\n\nত্রুটি: ${errorMessage.slice(0, 500)}`;

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
