// ============================================================
// সক্রিয়-রান পরিচয় localStorage-এ টিকিয়ে রাখা (P0-BUG-03 fix,
// Phase 2)। use-agent-run.ts এই সাহায্যকারীগুলো ব্যবহার করে:
//  - রান শুরু হলে saveActiveRun
//  - run_finished (terminal SSE) এ clearActiveRun
//  - মাউন্ট/কথোপকথন-পরিবর্তনে readActiveRun + shouldReattach দিয়ে
//    চলমান রানে পুনঃসংযোগ (সার্ভারের pure-DB replay — REG-2/REG-4-এ
//    প্রমাণিত — রান চলমান বা সদ্য-সমাপ্ত দুই ক্ষেত্রেই কাজ করে)।
//
// এই ফাইলটি ইচ্ছাকৃতভাবে React-নিরপেক্ষ — REG-7 একক-পরীক্ষায়
// নকল localStorage-সহ সরাসরি আমদানি করা যায়।
// ============================================================

export interface PersistedActiveRun {
  runId: string;
  conversationId: string;
  /** রানের user-বার্তার id ('' = অজানা — পোলিং-ফলব্যাকের জন্য) */
  userMessageId: string;
  /** সংরক্ষণের সময় (epoch ms) — বাসি-কাটঅফের ভিত্তি */
  savedAt: number;
}

const ACTIVE_RUN_KEY = 'agentic-active-run';

/**
 * সার্ভারের stale-run sweep ১০ মিনিটে 'running' রানকে interrupted করে
 * (orchestrator) — ১২ মিনিটের পুরোনো এন্ট্রি নিশ্চিতভাবে মৃত, পুনঃসংযোগের
 * চেষ্টা নিষ্প্রয়োজন।
 */
export const ACTIVE_RUN_STALE_MS = 12 * 60 * 1000;

function safeStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveActiveRun(entry: PersistedActiveRun): void {
  const st = safeStorage();
  if (!st) return;
  try {
    st.setItem(ACTIVE_RUN_KEY, JSON.stringify(entry));
  } catch {
    // নীরব — পুনঃসংযোগ-সুবিধা ঐচ্ছিক, মূল কার্যকারিতা নয়
  }
}

/**
 * runId দিলে শুধু সেই রানের এন্ট্রিই মুছে (ভিন্ন ট্যাবের নতুন রান
 * অকস্মাৎ মুছে ফেলা এড়াতে); runId ছাড়া দিলে নিরঙ্কুশ মুছে।
 */
export function clearActiveRun(runId?: string): void {
  const st = safeStorage();
  if (!st) return;
  try {
    if (runId === undefined) {
      st.removeItem(ACTIVE_RUN_KEY);
      return;
    }
    const raw = st.getItem(ACTIVE_RUN_KEY);
    if (!raw) return;
    const entry = JSON.parse(raw) as Partial<PersistedActiveRun> | null;
    if (entry?.runId === runId) st.removeItem(ACTIVE_RUN_KEY);
  } catch {
    // নীরব
  }
}

/**
 * বৈধ, বাসি-নয় এন্ট্রি — নেই/বিকৃত/অসম্পূর্ণ/বাসি হলে null।
 * (now প্যারামিটার পরীক্ষায় নির্দিষ্ট সময় ঢোকানোর জন্য।)
 */
export function readActiveRun(now: number = Date.now()): PersistedActiveRun | null {
  const st = safeStorage();
  if (!st) return null;
  try {
    const raw = st.getItem(ACTIVE_RUN_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<PersistedActiveRun> | null;
    if (!entry || typeof entry.runId !== 'string' || typeof entry.conversationId !== 'string') {
      return null;
    }
    if (typeof entry.savedAt !== 'number' || now - entry.savedAt > ACTIVE_RUN_STALE_MS) {
      return null;
    }
    return {
      runId: entry.runId,
      conversationId: entry.conversationId,
      userMessageId: typeof entry.userMessageId === 'string' ? entry.userMessageId : '',
      savedAt: entry.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * পুনঃসংযোগ-সিদ্ধান্ত: এন্ট্রিটি বর্তমানে খোলা কথোপকথনের, এবং বাসি নয়।
 */
export function shouldReattach(
  entry: PersistedActiveRun | null,
  conversationId: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!entry) return false;
  if (!conversationId || entry.conversationId !== conversationId) return false;
  if (now - entry.savedAt > ACTIVE_RUN_STALE_MS) return false;
  return true;
}
