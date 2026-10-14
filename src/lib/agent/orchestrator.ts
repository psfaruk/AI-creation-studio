// ============================================================
// Agent Orchestrator — Execution Loop (মাস্টার প্ল্যান §৫)।
// LLM ↔ Tools JSON প্রোটোকল, প্রতি ধাপে DB persist + SSE emit,
// attachment pre-steps (vision/ear), finalize/fail, stale-run sweep।
// ============================================================

import type { AgentRun } from '@prisma/client';
import { db } from '@/lib/db';
import { RUN_ERROR_CATEGORY_LABELS_BN, TOOL_CATALOG } from '@/lib/types';
import type {
  ChatMode,
  RunCacheStatus,
  RunEndReason,
  RunErrorCategory,
} from '@/lib/types';
import { emit } from './events';
import { chatComplete, parseToolCall, type ChatCallMeta, type LLMMessage } from './llm';
import { TemporarilyUnavailableError, isRateLimitErrorText } from './retry';
import { isChannelBlocked } from './rate-limit-coordinator';
import { CHAT_ONLY_DIRECTIVE, SYSTEM_PROMPT } from './prompts';
import { describeChatModel, findChatModel, type ChatModelOption } from './chat-models';
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

/** ইংরেজি সংখ্যা → বাংলা সংখ্যা (সার্ভার-পাশের সামান্য সহায়ক) */
function bnNum(n: number | string): string {
  const digits = '০১২৩৪৫৬৭৮৯';
  return String(n).replace(/\d/g, d => digits[Number(d)]);
}

// ------------------------------------------------------------
// (অডিট §১-B) ত্রুটি-শ্রেণি ও সমাপ্তির কারণ — প্রতিটি টার্মিনাল
// পথ AgentRun-এ errorCategory + endReason লেখে; ব্যর্থতায় বাংলা
// শ্রেণি-লেবেলও ব্যবহারকারীকে দেখানো হয়।
// ------------------------------------------------------------

/**
 * ত্রুটির বার্তা/স্ট্যাটাস পরীক্ষা করে স্পষ্ট শ্রেণি ঠিক করে।
 * ক্রম গুরুত্বপূর্ণ: কী → রেট-লিমিট → মডেল → টাইমআউট →
 * ffmpeg → স্টোরেজ → ৫xx → অজানা।
 */
export function categorizeError(err: unknown): RunErrorCategory {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const s = msg.toLowerCase();
  const status = (err as { status?: unknown } | null)?.status;
  const statusNum = typeof status === 'number' ? status : undefined;

  // কী-সমস্যা (এক্সটার্নাল/কাস্টম প্রোভাইডার)
  if (/কী যোগ করা হয়নি|api key পাওয়া যায়নি|missing.+key|no api key|কী-বিহীন/i.test(msg)) {
    return 'missing_key';
  }
  if (
    statusNum === 401 ||
    statusNum === 403 ||
    /কী অবৈধ|invalid api key|unauthorized|forbidden|permission/i.test(s)
  ) {
    return 'invalid_key';
  }
  // রেট-লিমিট / সাময়িক অনুপলব্ধতা (৪২৯ কখনোই লাইসেন্স-সমস্যা নয়)
  if (isRateLimitErrorText(msg)) return 'rate_limited';
  // মডেল-সমস্যা (আইডি বদলেছে / এই ব্যাকএন্ডে নেই)
  if (
    /মডেল-আইডি|মডেলটি আর তালিকায় নেই|model.{0,24}(not found|not exist|does not exist)|invalid model|model_not_found/i.test(
      msg
    )
  ) {
    return 'invalid_model';
  }
  // টাইমআউট (ইংরেজি + বাংলা বার্তা দুটোই)
  if (/etimedout|timed? ?out|timeout|aborterror|abort was|সময়শেষ|টাইমআউট|টুল টাইমআউট/i.test(s)) {
    return 'timeout';
  }
  // ffmpeg / মিডিয়া-পাইপলাইন
  if (/ffmpeg|ffprobe/i.test(s)) return 'ffmpeg_error';
  // স্টোরেজ / ফাইল-সিস্টেম
  if (/enoent|eacces|eperm|enospc|eisdir|disk quota|readonly database|স্টোরেজ|storage path/i.test(s)) {
    return 'storage_error';
  }
  // প্রোভাইডার-সার্ভার (৫xx) / সাধারণ প্রোভাইডার-ত্রুটি
  if (
    (statusNum != null && statusNum >= 500) ||
    /\b5\d{2}\b|সার্ভার-ত্রুটি|internal server|bad gateway|service unavailable/i.test(s)
  ) {
    return 'provider_error';
  }
  return 'unknown';
}

/**
 * এরর-শ্রেণি → রান-সমাপ্তির কারণ (coarse)।
 * সূক্ষ্ম কারণ errorCategory-তে থাকে; এখানে RunEndReason-ইউনিয়নের
// মধ্যে সবচেয়ে সৎ মোটা-বালতি বেছে নেওয়া হয়।
 */
function endReasonFromCategory(cat: RunErrorCategory): RunEndReason {
  switch (cat) {
    case 'rate_limited':
      return 'rate_limit';
    case 'timeout':
      return 'timeout';
    case 'malformed_tool_json':
    case 'unknown_tool':
    case 'tool_error':
    case 'ffmpeg_error':
    case 'storage_error':
      // টুল-ডোমেনে রান ভেঙেছে — সূক্ষ্ম কারণ errorCategory-তে সংরক্ষিত
      return 'invalid_tool_call';
    case 'aborted':
      return 'cancelled';
    default:
      // provider_error / invalid_key / missing_key / invalid_model / unknown / max_steps
      return 'provider_error';
  }
}

/** রান-সারির সমাপ্তি-তথ্য থেকে run_finished SSE-পেলোডের ঐচ্ছিক অংশ */
function runEndPayloadOf(run: {
  endReason: string | null;
  errorCategory: string | null;
  cacheStatus: string | null;
  requestedMode: string | null;
  usedModel: string | null;
}) {
  return {
    ...(run.endReason ? { endReason: run.endReason as RunEndReason } : {}),
    ...(run.errorCategory ? { errorCategory: run.errorCategory as RunErrorCategory } : {}),
    ...(run.cacheStatus ? { cacheStatus: run.cacheStatus as RunCacheStatus } : {}),
    ...(run.requestedMode ? { requestedMode: run.requestedMode as ChatMode } : {}),
    ...(run.usedModel ? { usedModel: run.usedModel } : {}),
  };
}

/** টেক্সটটি কি ভাঙা টুল-কল JSON-এর মতো দেখাচ্ছে? (কাটা আউটপুট শনাক্তকরণ) */
function looksLikeToolCall(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith('{')) return false;
  return /"tool"\s*:/.test(t.slice(0, 200)) || /"arguments"\s*:/.test(t.slice(0, 300));
}

/** ```json ফেন্সে মোড়া টুল-কলও প্রথাগত (parseToolCall ফেন্স গ্রহণ করে) */
function looksLikeFencedToolCall(text: string): boolean {
  const t = text.trimStart();
  if (!t.startsWith('```')) return false;
  const head = t.slice(0, 320);
  return /"tool"\s*:/.test(head) || /"arguments"\s*:/.test(head);
}

// ------------------------------------------------------------
// লাইভ টোকেন-স্ট্রিমার — স্মুথ স্ট্রিমিংয়ের হৃদয়।
//
// নীতি: টুল-কল JSON কখনো ব্যবহারকারী-দৃশ্যমান নয়; শুধু সত্যিকারের
// চূড়ান্ত-উত্তর টেক্সটই টোকেন-ধারায় ছড়ানো হয়। সিদ্ধান্ত-জানালা:
//  - প্রথম অ-হোয়াইটস্পেস অক্ষর '{' বা '`' হলে টুল-কল-প্রার্থী —
//    "tool":/"arguments": দেখা দিলে সাথে সাথেই দমন
//  - অন্যথা (বা >২৪০ অক্ষর/নতুন-লাইন পেরিয়ে গেলে) — টেক্সট-মোড
// কোয়ালেসিং: ~৪০ms ব্যাচে ইভেন্ট — SSE-চ্যাটার কম, ক্লায়েন্টের
// টাইপরাইটার-ড্রেন স্মুথনেস বজায় রাখে।
// ------------------------------------------------------------

interface DeltaStreamer {
  onDelta: (delta: string) => void;
  onAttemptBegin: () => void;
  /** স্ট্রিম শেষে অবশিষ্ট বাফার ফ্লাশ */
  finish: () => void;
  /** এই কলে কিছু টেক্সট ইতিমধ্যে ছড়ানো হয়েছে কি না */
  emittedAny: () => boolean;
}

const DELTA_FLUSH_MS = 40;
/** সিদ্ধান্ত-জানালা — এর বেশি অক্ষর/নতুন-লাইন পেরিলে টেক্সট-মোডে যাও */
const DECIDE_MAX_CHARS = 240;

function createDeltaStreamer(runId: string): DeltaStreamer {
  let mode: 'deciding' | 'text' | 'suppressed' = 'deciding';
  let pending = '';
  let emitted = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    clearTimer();
    if (mode !== 'text' || pending.length === 0) return;
    const out = pending;
    pending = '';
    emitted = true;
    emit(runId, { type: 'text_delta', runId, delta: out });
  };

  const evaluate = () => {
    const lead = pending.trimStart();
    if (lead.length === 0) return; // এখনো শুধু হোয়াইটস্পেস
    const head = lead[0];
    if (head !== '{' && head !== '`') {
      mode = 'text';
      return;
    }
    if (looksLikeToolCall(pending) || looksLikeFencedToolCall(pending)) {
      mode = 'suppressed';
      pending = '';
      clearTimer();
      return;
    }
    if (lead.length > DECIDE_MAX_CHARS || lead.includes('\n')) {
      mode = 'text'; // লম্বা/মাল্টি-লাইন — আমাদের কমপ্যাক্ট প্রোটোকল নয়
      return;
    }
  };

  return {
    onDelta(delta) {
      if (mode === 'suppressed' || delta.length === 0) return;
      pending += delta;
      if (mode === 'deciding') evaluate();
      if (mode === 'text' && !timer) timer = setTimeout(flush, DELTA_FLUSH_MS);
    },
    onAttemptBegin() {
      // রিট্রাই — পুরোনো আংশিক টেক্সট বাতিলের সৎ সংকেত
      clearTimer();
      pending = '';
      mode = 'deciding';
      if (emitted) {
        emitted = false;
        emit(runId, { type: 'text_delta', runId, delta: '', reset: true });
      }
    },
    finish: flush,
    emittedAny: () => emitted,
  };
}

/** টুল-কল চালু হলে আংশিক-স্ট্রিম পরিষ্কারের রিসেট-সংকেত */
function emitTextReset(runId: string): void {
  emit(runId, { type: 'text_delta', runId, delta: '', reset: true });
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
// S9 + অডিট §C: রেট-লিমিট-সৎ-অপেক্ষা + ক্যাশ-অবজারভেবিলিটিসহ chatComplete
// ------------------------------------------------------------

/**
 * chatComplete + প্রতিটি রেট-লিমিট-অপেক্ষায় SSE run_note +
 * (অডিট §C) প্রতিটি সফল কলের ক্যাশ-মেটা: AgentRun.cacheStatus আপডেট +
 * "ক্যাশ: হিট/মিস/বাইপাস" নোট (ডায়াগনস্টিক-মোডে প্রোভাইডার+লেটেন্সিসহ
 * ভার্বোস + skipCache বাইপাস)। মেটা ফেরায় — কলার AgentStep-এর
 * payload-তে সংরক্ষণ করে।
 */
async function chatCompleteWithNotes(
  runId: string,
  context: LLMMessage[],
  callOpts: {
    model?: string;
    streamer?: DeltaStreamer;
    /** ডায়াগনস্টিক-মোড: ডিস্ক-ক্যাশ বাইপাস + ভার্বোস ক্যাশ-নোট */
    diagnostic?: boolean;
  }
): Promise<{ text: string; meta: ChatCallMeta | null }> {
  let meta: ChatCallMeta | null = null;
  const text = await chatComplete(context, {
    ...(callOpts.model ? { model: callOpts.model } : {}),
    ...(callOpts.diagnostic ? { skipCache: true } : {}),
    ...(callOpts.streamer
      ? { onDelta: callOpts.streamer.onDelta, onAttemptBegin: callOpts.streamer.onAttemptBegin }
      : {}),
    onRateLimitWait: info => {
      const sec = Math.max(1, Math.round(info.delayMs / 1000));
      emit(runId, {
        type: 'run_note',
        runId,
        level: 'waiting',
        note:
          `ক্লাউড LLM রেট-লিমিটেড (৪২৯ — সাময়িক, লাইসেন্স-সমস্যা নয়)। ` +
          `পুনঃচেষ্টা ${bnNum(info.attempt)}/${bnNum(6)} — ${bnNum(sec)} সেকেন্ড অপেক্ষা করা হচ্ছে…`,
      });
    },
    onMeta: m => {
      meta = m;
      // AgentRun.cacheStatus — প্রতিটি LLM-কলে একবার (অডিট §C)
      db.agentRun
        .update({ where: { id: runId }, data: { cacheStatus: m.cache } })
        .catch(() => undefined);
      const cacheLabel = m.cache === 'hit' ? 'হিট' : m.cache === 'miss' ? 'মিস' : 'বাইপাস';
      emit(runId, {
        type: 'run_note',
        runId,
        level: 'info',
        note: callOpts.diagnostic
          ? `ডায়াগনস্টিক: ক্যাশ ${cacheLabel} · প্রোভাইডার ${m.providerLabel ?? m.provider}` +
              `${m.model ? ` · মডেল ${m.model}` : ''} · সময় ${bnNum((m.latencyMs / 1000).toFixed(1))} সে.`
          : `ক্যাশ: ${cacheLabel}`,
      });
    },
  });
  return { text, meta };
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

  // ---- ০. মোড ও মডেল-নির্বাচন (অডিট §১-A) ----
  // requestedMode: 'chat_only' = টুল ছাড়া এক-কল সরাসরি উত্তর;
  // 'diagnostic' = ক্যাশ-বাইপাস + ভার্বোস ক্যাশ/লেটেন্সি-নোট; 'normal' = এজেন্ট-লুপ।
  const requestedMode: ChatMode =
    run.requestedMode === 'chat_only' || run.requestedMode === 'diagnostic'
      ? run.requestedMode
      : 'normal';
  const chatOnly = requestedMode === 'chat_only';
  const diagnostic = requestedMode === 'diagnostic';

  // ব্যবহারকারীর অনুরোধকৃত মডেল — ব্যর্থ হলে (৪২৯-ব্যতীত কারণে) একবার ডিফল্টে
  // সৎ ফলব্যাক হয় + run_note-এ জানানো হয়; usedModel-এ প্রকৃত মডেল থাকে।
  const requestedModel = run.model ?? '';
  let usedModel = requestedModel;
  let modelFallbackDone = false;

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
      // শুধু-আলাপ মোডে কোনো টুলই চলে না — আপলোডের উপস্থিতি জানিয়ে
      // context-এ সৎ নোট যোগ হয় (অডিট §১-A)
      if (chatOnly) {
        if (upload.kind !== 'video') {
          context.push({
            role: 'user',
            content: `ব্যবহারকারী একটি ${upload.kind === 'image' ? 'ছবি' : 'অডিও'} আপলোড করেছেন (${upload.fileName})। শুধু-আলাপ মোডে বিশ্লেষণ-টুল চালানো হয়নি — ফাইলের বিষয়বস্তু দেখা যাচ্ছে না।`,
          });
        }
        continue;
      }
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

  // ---- ২ক. (অডিট §১-A) শুধু-আলাপ মোড: একটিই LLM-কল, কোনো টুল-লুপ নেই ----
  // context-এর শেষ user-বার্তায় মোড-নির্দেশ জোড়া হয়; ফেরত আসা টেক্সটই
  // চূড়ান্ত উত্তর — parseToolCall-চেকও হয় না (নির্দেশটিই তা নিষেধ করে)।
  if (chatOnly) {
    emit(runId, {
      type: 'run_note',
      runId,
      level: 'info',
      note: 'শুধু-আলাপ মোড — কোনো টুল ছাড়াই সরাসরি উত্তর লেখা হচ্ছে…',
    });
    const lastIdx = context.length - 1;
    if (lastIdx >= 0 && context[lastIdx].role === 'user') {
      context[lastIdx] = { role: 'user', content: context[lastIdx].content + CHAT_ONLY_DIRECTIVE };
    } else {
      context.push({ role: 'user', content: CHAT_ONLY_DIRECTIVE.trim() });
    }

    const t0 = Date.now();
    const streamer = createDeltaStreamer(runId);
    let chatOnlyText = '';
    let chatOnlyMeta: ChatCallMeta | null = null;
    try {
      const r = await chatCompleteWithNotes(runId, context, {
        model: usedModel,
        streamer,
        diagnostic,
      });
      chatOnlyText = r.text;
      chatOnlyMeta = r.meta;
    } catch (err) {
      streamer.finish();
      throw err; // failRun সৎ শ্রেণিসহ (rate_limited ইত্যাদি) ধরবে
    }
    streamer.finish();

    const decisionSeq = nextSeq();
    await db.agentStep.create({
      data: {
        runId,
        seq: decisionSeq,
        kind: 'llm_decision',
        name: 'llm_chat_only',
        payloadJson: safeJson({
          mode: 'chat_only',
          text: chatOnlyText.slice(0, 4000),
          ...(chatOnlyMeta
            ? {
                cache: chatOnlyMeta.cache,
                provider: chatOnlyMeta.provider,
                ...(chatOnlyMeta.providerLabel ? { providerLabel: chatOnlyMeta.providerLabel } : {}),
                ...(chatOnlyMeta.model ? { model: chatOnlyMeta.model } : {}),
                latencyMs: chatOnlyMeta.latencyMs,
              }
            : {}),
        }),
      },
    });
    logStep(runId, decisionSeq, 'llm', 'chat-only-final', Date.now() - t0);

    const finalChatOnlyText = chatOnlyText.trim()
      ? chatOnlyText
      : 'দুঃখিত, এই মুহূর্তে উত্তর তৈরি করা যায়নি — শুধু-আলাপ মোডে খালি উত্তর এসেছে। অনুগ্রহ করে আবার চেষ্টা করুন।';

    await db.agentRun
      .update({ where: { id: runId }, data: { usedModel: describeChatModel(usedModel) } })
      .catch(() => undefined);
    await finalizeRun(
      runId,
      finalChatOnlyText,
      {
        steps: 1,
        toolCalls: stats.toolCalls,
        durationMs: Date.now() - startedAt,
        seq: nextSeq(),
      },
      null,
      { endReason: 'final_answer' }
    );
    return;
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
    let stepMeta: ChatCallMeta | null = null;
    const streamer = createDeltaStreamer(runId);
    try {
      const r = await chatCompleteWithNotes(runId, context, { model: usedModel, streamer, diagnostic });
      text = r.text;
      stepMeta = r.meta;
      streamer.finish();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // কী-সমস্যায় (কী নেই/অবৈধ/ব্যালান্স শেষ) স্বয়ংক্রিয় GLM-ফলব্যাক নয় —
      // ব্যবহারকারী স্পষ্টভাবে এক্সটার্নাল GLM-মডেল বেছেছেন; নীরব
      // ক্রস-ফলব্যাক নিষিদ্ধ — সৎ ব্যর্থতাই একমাত্র পথ।
      const selectedEntry: ChatModelOption | undefined = usedModel !== '' ? findChatModel(usedModel) : undefined;
      const isKeyProblem =
        !!selectedEntry &&
        selectedEntry.provider !== 'zai' &&
        /কী যোগ করা হয়নি|কী অবৈধ|ব্যালান্স শেষ|কী গৃহীত হয়নি/.test(msg);
      if (isKeyProblem) {
        emit(runId, {
          type: 'run_note',
          runId,
          level: 'warn',
          note: `নির্বাচিত মডেল "${describeChatModel(requestedModel)}" ব্যবহার করা যায়নি: ${msg.slice(0, 160)} — অন্য মডেলে স্বয়ংক্রিয় ফলব্যাক করা হয়নি; মডেল-তালিকা থেকে কী যোগ করুন বা অন্য মডেল বেছে নিন।`,
        });
        throw err;
      }
      if (
        !modelFallbackDone &&
        usedModel !== '' &&
        !isRateLimitErrorText(msg) &&
        !(err instanceof TemporarilyUnavailableError)
      ) {
        // নির্বাচিত মডেলটি এই ব্যাকএন্ডে নেই/চলছে না (৪২৯ নয়) →
        // একবার ডিফল্ট মডেলে সৎ ফলব্যাক + নোট
        modelFallbackDone = true;
        usedModel = '';
        await db.agentRun.update({
          where: { id: runId },
          data: { usedModel: '(default)' },
        });
        emit(runId, {
          type: 'run_note',
          runId,
          level: 'warn',
          note: `নির্বাচিত মডেল "${describeChatModel(requestedModel)}" এই মুহূর্তে ব্যবহার করা যায়নি (${msg.slice(0, 120)})। ডিফল্ট মডেলে চালিয়ে যাওয়া হচ্ছে — সৎ-ফলব্যাক।`,
        });
        try {
          const retryStreamer = createDeltaStreamer(runId);
          const r2 = await chatCompleteWithNotes(runId, context, {
            model: '',
            streamer: retryStreamer,
            diagnostic,
          });
          text = r2.text;
          stepMeta = r2.meta;
          retryStreamer.finish();
        } catch (err2) {
          const msg2 = err2 instanceof Error ? err2.message : String(err2);
          if (err2 instanceof TemporarilyUnavailableError || isRateLimitErrorText(msg2)) {
            rateLimitExhausted = true;
            break loop;
          }
          throw err2;
        }
      } else if (err instanceof TemporarilyUnavailableError || isRateLimitErrorText(msg)) {
        // S9: ৪২৯-উইন্ডো রিট্রাই-বাজেটও ছাড়িয়ে গেছে — লুপ ভাঙো;
        // নিচে ইন্টেন্ট-ফলব্যাক/সৎ-ব্যর্থতা-পথ দেখবে
        rateLimitExhausted = true;
        break loop;
      } else {
        throw err;
      }
    }
    llmSteps++;
    const decisionSeq = nextSeq();
    await db.agentStep.create({
      data: {
        runId,
        seq: decisionSeq,
        kind: 'llm_decision',
        name: 'llm',
        // (অডিট §C) ক্যাশ-মেটা প্রতিটি llm_decision-ধাপের পেলোডে সংরক্ষিত
        payloadJson: safeJson({
          text: text.slice(0, 4000),
          ...(stepMeta
            ? {
                cache: stepMeta.cache,
                provider: stepMeta.provider,
                ...(stepMeta.providerLabel ? { providerLabel: stepMeta.providerLabel } : {}),
                ...(stepMeta.model ? { model: stepMeta.model } : {}),
                latencyMs: stepMeta.latencyMs,
              }
            : {}),
        }),
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

    // LLM-এর নিজের টুল কল context-এ রাখো; আংশিক-স্ট্রিম হয়ে থাকলে
    // (শিরোনাম-টেক্সট + JSON-মিশ্রণ) ক্লায়েন্টের টেক্সট রিসেট
    if (streamer.emittedAny()) emitTextReset(runId);
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

  // ---- ৫. MAX_STEPS ছাড়িয়ে গেলে বাধ্যতামূলক মোড়ক-উত্তর (অডিট §১-B: সৎ) ----
  // সততা: ধাপ-সীমা শেষ হলে endReason সবসময় 'max_steps'। মোড়ক-কল থেকে
  // সত্যিকারের উত্তর এলে status 'completed' + সৎ ফুটনোট; নইলে/মোড়ক-কল
  // ব্যর্থ হলে status 'failed' + errorCategory ('max_steps' বা প্রকৃত কারণ) +
  // আংশিক অগ্রগতির বাংলা সারাংশ।
  if (finalText === null) {
    forced = true;
    context.push({ role: 'user', content: 'আর কোনো টুল ছাড়া এখনই চূড়ান্ত উত্তর দাও।' });
    const t0 = Date.now();
    const forcedStreamer = createDeltaStreamer(runId);
    let forcedText = '';
    let forcedMeta: ChatCallMeta | null = null;
    try {
      const r = await chatCompleteWithNotes(runId, context, {
        model: usedModel,
        streamer: forcedStreamer,
        diagnostic,
      });
      forcedText = r.text;
      forcedMeta = r.meta;
    } catch (err) {
      forcedStreamer.finish();
      const msg = err instanceof Error ? err.message : String(err);
      const errorCategory = categorizeError(err);
      logStep(runId, nextSeq(), 'llm', 'forced-final-failed', Date.now() - t0);
      await db.agentRun
        .update({ where: { id: runId }, data: { usedModel: describeChatModel(usedModel) } })
        .catch(() => undefined);
      await failRun(
        runId,
        `ধাপ-সীমা (${bnNum(MAX_STEPS)}) শেষ হওয়ার পর চূড়ান্ত-উত্তরের কলও ব্যর্থ: ${msg}`,
        { errorCategory, endReason: 'max_steps' }
      );
      return;
    }
    forcedStreamer.finish();
    const forcedSeq = nextSeq();
    await db.agentStep.create({
      data: {
        runId,
        seq: forcedSeq,
        kind: 'final_answer',
        name: 'llm_forced',
        payloadJson: safeJson({
          text: forcedText.slice(0, 4000),
          maxSteps: true,
          ...(forcedMeta
            ? {
                cache: forcedMeta.cache,
                provider: forcedMeta.provider,
                ...(forcedMeta.providerLabel ? { providerLabel: forcedMeta.providerLabel } : {}),
                ...(forcedMeta.model ? { model: forcedMeta.model } : {}),
                latencyMs: forcedMeta.latencyMs,
              }
            : {}),
        }),
      },
    });
    logStep(runId, forcedSeq, 'llm', 'forced-final', Date.now() - t0);
    const stillToolCall = parseToolCall(forcedText);
    if (forcedText.trim() && !stillToolCall) {
      // সৎ মোড়ক: উত্তর আসল, কিন্তু কেন থামল তা ব্যবহারকারী জানবেন
      finalText =
        forcedText.trimEnd() +
        `\n\n---\n*নোট: অনুমোদিত ধাপ-সীমা (${bnNum(MAX_STEPS)}) শেষ হওয়ায় টুল-চালানো এখানে থামিয়ে এই সারাংশটি দেওয়া হলো — আংশিক অগ্রগতির সৎ মোড়ক।*`;
    } else {
      // মোড়ক-কলও ব্যবহারযোগ্য উত্তর দেয়নি — সৎ ব্যর্থতা + আংশিক-অগ্রগতির সারাংশ
      await db.agentRun
        .update({ where: { id: runId }, data: { usedModel: describeChatModel(usedModel) } })
        .catch(() => undefined);
      await failRun(
        runId,
        `ধাপ-সীমা (${bnNum(MAX_STEPS)}) শেষ হয়েছে — এই মুহূর্তে ব্যবহারযোগ্য চূড়ান্ত উত্তর তৈরি করা যায়নি।`,
        {
          errorCategory: 'max_steps',
          endReason: 'max_steps',
          content:
            `দুঃখিত, কাজটি সম্পূর্ণ করা যায়নি — **অনুমোদিত ধাপ-সীমা (${bnNum(MAX_STEPS)}) শেষ হয়ে গেছে**।\n\n` +
            `এ পর্যন্ত যা হয়েছে: ${bnNum(llmSteps)}টি সিদ্ধান্ত-ধাপ, ${bnNum(stats.toolCalls)}টি টুল-কল ` +
            `(${bnNum(Math.round((Date.now() - startedAt) / 1000))} সেকেন্ড ধরে কাজ চেয়েছে)।\n\n` +
            `কাজটি ছোট ছোট অংশে ভাগ করে আবার পাঠালে প্রতিটি অংশ ধাপ-সীমার মধ্যে সম্পূর্ণ হওয়ার সম্ভাবনা বেশি।`,
        }
      );
      return;
    }
  }

  // প্রকৃতপক্ষে ব্যবহৃত মডেল রেকর্ড (ফলব্যাক হলে আলাদা) — সৎ-লেবেলিং
  // (এক্সটার্নাল মডেলে "প্রোভাইডার · apiModel" আকারে স্পষ্ট)
  await db.agentRun
    .update({
      where: { id: runId },
      data: { usedModel: describeChatModel(usedModel) },
    })
    .catch(() => undefined);

  await finalizeRun(
    runId,
    finalText,
    {
      steps: forced ? MAX_STEPS : llmSteps,
      toolCalls: stats.toolCalls,
      durationMs: Date.now() - startedAt,
      seq: nextSeq(),
    },
    proposedProductionId,
    // সৎ সমাপ্তির কারণ: ধাপ-সীমায় থামা মোড়ক হলে 'max_steps', নইলে চূড়ান্ত উত্তর
    { endReason: forced ? 'max_steps' : 'final_answer' }
  );
}

/**
 * চূড়ান্ত উত্তর: assistant Message + run completed — ট্রানজেকশনে
 * (race-free), তারপর 'message' + 'run_finished' emit।
 * (অডিট §১-B/§১-E) endReason সবসময় লেখা হয়; run_finished-পেলোডে
 * সমাপ্তির বিস্তারিত তথ্য (endReason/cacheStatus/requestedMode/usedModel) যায়।
 */
async function finalizeRun(
  runId: string,
  content: string,
  stats: { steps: number; toolCalls: number; durationMs: number; seq: number },
  productionId: string | null = null,
  end?: { endReason?: RunEndReason }
): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'running') return;
  const finishedAt = new Date();
  const endReason: RunEndReason = end?.endReason ?? 'final_answer';

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
        endReason,
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
        payloadJson: safeJson({ length: content.length, endReason }),
      },
    }),
  ]);

  logStep(runId, stats.seq, 'final', `completed (${endReason})`, stats.durationMs);

  const view = await buildMessageView(message);
  emit(runId, { type: 'message', conversationId: run.conversationId, message: view });
  // ট্রানজেকশন-পরের সদ্য-সদ্য সারি থেকে সমাপ্তির বিস্তারিত তথ্য (§১-E)
  const finalRun = await db.agentRun.findUnique({ where: { id: runId } });
  emit(runId, {
    type: 'run_finished',
    runId,
    conversationId: run.conversationId,
    status: 'completed',
    ...(finalRun ? runEndPayloadOf(finalRun) : { endReason }),
  });
}

/** রান ব্যর্থ: run failed + fallback assistant message + events। */
async function failRun(
  runId: string,
  errorMessage: string,
  opts?: {
    /** কলার জানলে স্পষ্ট শ্রেণি; নইলে categorizeError বার্তা থেকে ঠিক করে */
    errorCategory?: RunErrorCategory;
    endReason?: RunEndReason;
    /** ব্যবহারকারীমুখী চূড়ান্ত বার্তা-ওভাররাইড (যেমন max_steps-সারাংশ) */
    content?: string;
  }
): Promise<void> {
  const run = await db.agentRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'running') return;

  const errorCategory = opts?.errorCategory ?? categorizeError(errorMessage);
  const endReason = opts?.endReason ?? endReasonFromCategory(errorCategory);
  const categoryLabel = RUN_ERROR_CATEGORY_LABELS_BN[errorCategory];
  const durationMs = Date.now() - run.startedAt.getTime();
  const stepCount = await db.agentStep.count({ where: { runId } });
  const toolCallCount = await db.toolCall.count({ where: { runId } });
  const existing = await db.message.findFirst({ where: { runId } });
  const finishedAt = new Date();
  // S9: ৪২৯ = সাময়িক অবস্থা — ব্যবহারকারীকে পরিষ্কার বোঝাও ও বিকল্প-পথ বলো
  const isTemporarilyUnavailable = /TEMPORARILY_UNAVAILABLE|429|rate.?limit/i.test(errorMessage);
  const categoryLine = `**কারণ-শ্রেণি: ${categoryLabel}**`;
  const content =
    opts?.content ??
    (isTemporarilyUnavailable
      ? `দুঃখিত, এই মুহূর্তে কাজটি সম্পন্ন করা যায়নি। ${categoryLine}\n\n` +
        `ত্রুটি: ${errorMessage.slice(0, 400)}\n\n` +
        `**এটি সাময়িক** — ক্লাউড API-র রেট-লিমিট (৪২৯); লাইসেন্স বা অনুমতির সমস্যা নয়।\n\n` +
        `- কয়েক মিনিট পর একই বার্তা আবার পাঠালে সাধারণত কাজ করবে।\n` +
        `- তাড়াহুড়ো থাকলে **স্টুডিও** ভিউ থেকে সরাসরি মিউজিক ভিডিও / শর্ট ফিল্ম তৈরি করা যায় (LLM ছাড়াই)।\n` +
        `- রেট-লিমিট-উইন্ডোতেও লোকাল প্রসিডিউরাল গান + ভিজ্যুয়াল দিয়ে ভিডিও তৈরি হবে (সৎ লেবেলসহ)।`
      : `দুঃখিত, কাজটি সম্পন্ন করা যায়নি। ${categoryLine}\n\nত্রুটি: ${errorMessage.slice(0, 500)}`);

  const ops: any[] = [
    db.agentRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        error: errorMessage.slice(0, 1000),
        errorCategory,
        endReason,
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

  logStep(runId, stepCount, 'final', `failed (${errorCategory}/${endReason})`, durationMs);

  if (!existing && message) {
    const view = await buildMessageView(message);
    emit(runId, { type: 'message', conversationId: run.conversationId, message: view });
  }
  // ট্রানজেকশন-পরের সারি থেকে সমাপ্তির বিস্তারিত তথ্য (§১-E)
  const finalRun = await db.agentRun.findUnique({ where: { id: runId } });
  emit(runId, {
    type: 'run_finished',
    runId,
    conversationId: run.conversationId,
    status: 'failed',
    error: errorMessage.slice(0, 500),
    ...(finalRun
      ? runEndPayloadOf(finalRun)
      : { errorCategory, endReason }),
  });
}

/** ১০ মিনিটের বেশি 'running' থাকা রান → 'interrupted' (GET conversations-এ ডাকা হয়)। */
export async function sweepStaleRuns(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_RUN_MS);
    const res = await db.agentRun.updateMany({
      where: { status: 'running', startedAt: { lt: cutoff } },
      data: {
        status: 'interrupted',
        error: 'রানটি অসম্পূর্ণ অবস্থায় আটকে গিয়েছিল (stale sweep)',
        // (অডিট §১-B) সমাপ্তির কারণও সৎভাবে লেখা হয় — ১০ মিনিটে শেষ হয়নি
        endReason: 'timeout',
        errorCategory: 'timeout',
        finishedAt: new Date(),
      },
    });
    if (res.count > 0) {
      console.log(`[agent] sweep: ${res.count} টি stale রান interrupted করা হয়েছে`);
    }
  } catch (err) {
    console.error('[agent] sweepStaleRuns error', err);
  }
}
