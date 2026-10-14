'use client';

// ============================================================
// এজেন্ট-রান লাইফসাইকেল:
// 1. POST /api/chat → optimistic user msg + pending assistant turn
// 2. EventSource /api/runs/{runId}/events → লাইভ টুল-অ্যাক্টিভিটি
//    (সার্ভার শুধু unnamed message পাঠায় — onmessage-ই যথেষ্ট)
// 3. SSE ছিঁড়লে ব্যাকঅফে পুনঃসংযোগ: ২ → ৪ → ৮ → ১৬ → ৩০ সে.
//    (সর্বোচ্চ ৫ চেষ্টা; সার্ভার রিকানেক্টে ডিবি-রিপ্লে পাঠায়, ক্লায়েন্ট
//    activityId/message দিয়ে ডুপ্লিকেট আটকায়)
// 4. ৫ চেষ্টায় ব্যর্থ হলে GET /api/conversations/{id} দিয়ে 2s পোলিং (180s টাইমআউট)
// ============================================================

import { useCallback, useEffect, useRef } from 'react';

import { withStudioToken } from '@/components/auth/security-gate';
import { GENERIC_ERROR, useChatStore } from '@/hooks/use-chat-store';
import { toast } from '@/hooks/use-toast';
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ConversationDetail,
  RunEvent,
} from '@/lib/types';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000;

/** (অডিট §C5) পুনঃসংযোগ-ব্যাকঅফ — প্রতি সফল সংযোগে গণনা রিসেট হয় */
const RECONNECT_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;

// ------------------------------------------------------------
// টাইপরাইটার-ড্রেন — স্মুথ স্ট্রিমিংয়ের হৃদয়।
// নেটওয়ার্ক-চাঙ্ক জোরে/ছড়িয়ে এলেও এখানে জমা হয়, তারপর সমান গতিতে
// (ব্যাকলগ বড় হলে স্বয়ংক্রিয়-দ্রুত) অল্প অল্প করে বার্তায় বসে —
// থেমে-থেমে লাগে না, টানা প্রবাহিত টাইপিং দেখায়।
// ------------------------------------------------------------

const DRAIN_INTERVAL_MS = 24; // ~৪২ টিক/সে.
/** ব্যাকলগ-অ্যাডাপটিভ: জমা যত বড়, প্রতি টিকে তত বেশি অক্ষর বসে */
function drainChunkSize(backlog: number): number {
  return Math.max(1, Math.ceil(backlog / 26));
}

interface DrainState {
  buffer: string;
  conversationId: string;
  pendingId: string;
}

export function useAgentRun() {
  const isRunActive = useChatStore((s) => s.isRunActive);

  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishedRef = useRef(false);
  const drainTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drainRef = useRef<DrainState | null>(null);

  const stopDrain = useCallback(() => {
    if (drainTimerRef.current) {
      clearInterval(drainTimerRef.current);
      drainTimerRef.current = null;
    }
    drainRef.current = null;
  }, []);

  const stopRunWatchers = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    stopDrain();
  }, [stopDrain]);

  useEffect(() => stopRunWatchers, [stopRunWatchers]);

  /** SSE ব্যর্থ হলে পোলিং-ফলব্যাক: সার্ভার-সত্য থেকে in-flight টার্ন আপডেট */
  const startPolling = useCallback(
    (conversationId: string, userMessageId: string, pendingId: string) => {
      const startedAt = Date.now();

      const tick = async () => {
        if (finishedRef.current) return;
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          stopRunWatchers();
          useChatStore.getState().setIsRunActive(false);
          toast({ title: GENERIC_ERROR, variant: 'destructive' });
          return;
        }

        let detail: ConversationDetail | null = null;
        try {
          const res = await fetch(`/api/conversations/${conversationId}`);
          if (res.ok) detail = (await res.json()) as ConversationDetail;
        } catch {
          detail = null;
        }
        if (!detail || finishedRef.current) return;

        const store = useChatStore.getState();
        const messages = detail.messages ?? [];
        // রানের user বার্তার পরের প্রথম assistant বার্তাই এই রানের ফলাফল
        const userIdx = messages.findIndex((m) => m.id === userMessageId);
        const tail = userIdx >= 0 ? messages.slice(userIdx + 1) : [];
        const assistant = tail.find((m) => m.role === 'assistant');
        if (!assistant) return;

        if (assistant.runStats != null) {
          // রান শেষ — সার্ভার-সত্য দিয়ে চূড়ান্ত বার্তা বসাও
          finishedRef.current = true;
          stopRunWatchers();
          store.setIsRunActive(false);
          if (store.activeId === conversationId) {
            store.replaceMessage(pendingId, assistant);
          }
          void store.refetchConversations();
        } else if (store.activeId === conversationId) {
          // মাঝপথের অবস্থা — pending id ধরে রেখে আপডেট
          store.replaceMessage(pendingId, { ...assistant, id: pendingId });
        }
      };

      pollTimerRef.current = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    },
    [stopRunWatchers],
  );

  const openStream = useCallback(
    (runId: string, conversationId: string, userMessageId: string, pendingId: string) => {
      finishedRef.current = false;
      // পুনঃসংযোগ জুড়ে বাঁচা অবস্থা — dispatch-ক্লোজার একই থাকে, তাই
      // finalMessageSeen / settledAssistantId / ড্রেন-বাফার রিকানেক্টে হারায় না
      /** 'message' ইভেন্টে বসে যাওয়া প্রকৃত assistant-বার্তার id —
       *  run_finished-এ সমাপ্তি-তথ্য (runEnd) ওখানে বসাতে হয় (অডিট §১-E) */
      let finalMessageSeen = false;
      let settledAssistantId: string | null = null;
      let reconnectAttempt = 0;

      /** ড্রেন-লুপ চালু রাখো — বাফার ফাঁকা হলে নিজেই থামে */
      const ensureDrain = () => {
        if (drainTimerRef.current || !drainRef.current) return;
        drainTimerRef.current = setInterval(() => {
          const state = drainRef.current;
          if (!state) {
            stopDrain();
            return;
          }
          if (state.buffer.length === 0) {
            // সাময়িক ফাঁকা — নতুন ডেল্টার অপেক্ষায় টিক চলতে থাকুক
            // (রান-শেষে নিচের ক্লিনআপ থামায়)
            return;
          }
          const store = useChatStore.getState();
          if (store.activeId !== state.conversationId) {
            stopDrain();
            return;
          }
          const take = drainChunkSize(state.buffer.length);
          const chunk = state.buffer.slice(0, take);
          state.buffer = state.buffer.slice(take);
          store.updateMessage(state.pendingId, (m) => ({
            ...m,
            content: (m.content ?? '') + chunk,
          }));
        }, DRAIN_INTERVAL_MS);
      };

      const dispatch = (raw: string) => {
        let evt: RunEvent;
        try {
          evt = JSON.parse(raw) as RunEvent;
        } catch {
          return; // malformed payload — উপেক্ষা
        }
        const store = useChatStore.getState();
        const inView = store.activeId === conversationId;

        switch (evt.type) {
          case 'tool_start': {
            if (!inView) return;
            store.updateMessage(pendingId, (m) => {
              // SSE রিকানেক্ট-রিপ্লে-তে একই activity দ্বিতীয়বার যোগ হওয়া আটকাও
              if ((m.activities ?? []).some((a) => a.id === evt.activityId)) return m;
              return {
                ...m,
                activities: [
                  ...(m.activities ?? []),
                  {
                    id: evt.activityId,
                    tool: evt.tool,
                    title: evt.title,
                    icon: evt.icon,
                    status: 'running' as const,
                    input: evt.input,
                    // (অডিট §C2) শুরুর সময় — কার্ডে লাইভ অতিবাহিত-সময় দেখাতে
                    startedAt: evt.startedAt,
                  },
                ],
              };
            });
            return;
          }
          case 'tool_end': {
            if (!inView) return;
            store.updateMessage(pendingId, (m) => ({
              ...m,
              activities: (m.activities ?? []).map((a) =>
                a.id === evt.activityId
                  ? {
                      ...a, // startedAt সহ আগের ফিল্ডগুলো অক্ষত থাকে
                      status: evt.status,
                      output: evt.output,
                      error: evt.error,
                      artifacts: evt.artifacts ?? a.artifacts,
                      durationMs: evt.durationMs ?? a.durationMs,
                    }
                  : a,
              ),
            }));
            return;
          }
          case 'message': {
            if (!inView || evt.conversationId !== conversationId) return;
            // চূড়ান্ত কর্তৃত্বপূর্ণ টেক্সট — ড্রেন-বাফার বাদ দিয়ে একবারে বসে;
            // এর পরের কোনো পিছল-ডেল্টা আর নেওয়া হয় না
            finalMessageSeen = true;
            settledAssistantId = evt.message.id;
            stopDrain();
            store.replaceMessage(pendingId, evt.message);
            return;
          }
          case 'text_delta': {
            // লাইভ টোকেন-স্ট্রিম — টাইপরাইটার-বাফারে জমা, ড্রেন-লুপ স্মুথ করে বসায়
            if (!inView || finalMessageSeen) return;
            if (evt.reset) {
              if (drainRef.current) drainRef.current.buffer = '';
              store.updateMessage(pendingId, (m) => ({ ...m, content: '' }));
              return;
            }
            if (!drainRef.current) {
              drainRef.current = { buffer: '', conversationId, pendingId };
            }
            drainRef.current.buffer += evt.delta;
            ensureDrain();
            return;
          }
          case 'run_note': {
            // S9: রান-স্ট্যাটাস নোট (যেমন রেট-লিমিট-অপেক্ষা) — pending bubble-এ অ্যাম্বার লাইন
            if (!inView) return;
            store.updateMessage(pendingId, (m) => ({ ...m, statusNote: evt.note }));
            return;
          }
          case 'run_finished': {
            finishedRef.current = true;
            stopDrain(); // রান শেষ — অবশিষ্ট ড্রেন বাতিল (সার্ভার-সত্য আসছে)
            stopRunWatchers();
            const s = useChatStore.getState();
            s.setIsRunActive(false);
            void s.refetchConversations(); // শিরোনাম আপডেট হতে পারে
            // (অডিট §১-E) সমাপ্তির বিস্তারিত তথ্য — বসে-যাওয়া assistant বার্তায়
            // (বা না বসলে pending-এ) runEnd হিসেবে জমা; UI এটি দিয়ে ব্যর্থতা-চিপ
            // (শ্রেণি-লেবেল + "আবার চেষ্টা") দেখায়।
            const targetId = settledAssistantId ?? pendingId;
            if (s.activeId === conversationId) {
              s.updateMessage(targetId, (m) => ({
                ...m,
                runEnd: {
                  status: evt.status,
                  ...(evt.endReason ? { endReason: evt.endReason } : {}),
                  ...(evt.errorCategory ? { errorCategory: evt.errorCategory } : {}),
                  ...(evt.cacheStatus ? { cacheStatus: evt.cacheStatus } : {}),
                  ...(evt.requestedMode ? { requestedMode: evt.requestedMode } : {}),
                  ...(evt.usedModel ? { usedModel: evt.usedModel } : {}),
                  ...(evt.error ? { error: evt.error.slice(0, 300) } : {}),
                },
                content:
                  m.content ||
                  (evt.status === 'failed' || evt.status === 'interrupted'
                    ? `⚠️ ${evt.error || 'রানটি সম্পূর্ণ করা যায়নি। আবার চেষ্টা করুন।'}`
                    : m.content),
              }));
            }
            if (evt.status === 'failed' || evt.status === 'interrupted') {
              toast({ title: GENERIC_ERROR, variant: 'destructive' });
            } else if (s.activeId === conversationId && !finalMessageSeen) {
              // 'message' ইভেন্ট মিস হলেও সার্ভার-সত্য দিয়ে রিকভার
              void s.refreshActiveConversation();
            }
            return;
          }
          case 'run_started':
          case 'ping':
          default:
            return;
        }
      };

      // (অডিট §C5) EventSource ব্যাকঅফে পুনরায় খোলে — একই dispatch/
      // ড্রেন-অবস্থা ধরে থাকে; সার্ভার রিকানেক্টে ডিবি-রিপ্লে পাঠায়,
      // ক্লায়েন্ট আগেই activityId/message-ডুপ্লিকেট আটকায় (উপরের লজিক)
      const connect = () => {
        esRef.current?.close();
        const es = new EventSource(withStudioToken(`/api/runs/${runId}/events`));
        esRef.current = es;

        es.onopen = () => {
          // সংযোগ ফিরেছে — ব্যাকঅফ-গণনা রিসেট
          reconnectAttempt = 0;
        };
        // সার্ভার শুধু unnamed message পাঠায় — onmessage-ই সব কভার করে
        es.onmessage = (e) => dispatch(e.data);

        es.onerror = () => {
          if (finishedRef.current) {
            stopRunWatchers();
            return;
          }
          // রান চলাকালীন সংযোগ ছিঁড়েছে → ব্যাকঅফে পুনঃসংযোগ
          // (ব্রাউজারের স্বয়ংক্রিয় রিকানেক্ট বন্ধ করে হাতে নিয়ন্ত্রণ)
          es.close();
          if (esRef.current === es) esRef.current = null;
          const delay = RECONNECT_DELAYS_MS[reconnectAttempt];
          if (delay === undefined) {
            // ৫ বার ব্যর্থ → পুরোনো পোলিং-ফলব্যাক (180s সার্বিক-গার্ডসহ)
            startPolling(conversationId, userMessageId, pendingId);
            return;
          }
          reconnectAttempt += 1;
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (finishedRef.current) return;
            connect();
          }, delay);
        };
      };

      connect();
    },
    [startPolling, stopDrain, stopRunWatchers],
  );

  const send = useCallback(async (contentOverride?: string, opts?: { skipAttachments?: boolean }) => {
    const store = useChatStore.getState();
    if (store.isRunActive) return;

    const content = (contentOverride ?? store.draft).trim();
    const attachments = opts?.skipAttachments ? [] : [...store.pendingAttachments];
    const chatModel = store.chatModel;
    const chatMode = store.chatMode;
    if (!content && attachments.length === 0) return;

    const conversationIdAtSend = store.activeId ?? '';
    const optimisticId = `local-user-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: optimisticId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      attachments: attachments.map((a) => ({ kind: a.kind, name: a.name, url: a.dataUrl })),
    };
    store.appendMessage(optimistic);
    store.setIsRunActive(true);
    store.resetComposerInput();

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationIdAtSend,
          content,
          model: chatModel,
          mode: chatMode,
          attachments: attachments.map(({ kind, name, dataUrl }) => ({ kind, name, dataUrl })),
        } satisfies ChatRequest),
      });
      // (অডিট §২.৩) প্রকৃত ব্যর্থতার কারণ বের করা — generic "চ্যাট ব্যর্থ"
      // নয়: HTTP status + সার্ভারের সুরক্ষিত বার্তা (data.error) দেখানো হয়।
      // সার্ভার-বার্তাগুলি ইতিমধ্যে স্যানিটাইজড (কোনো stack-trace/কী নয়)।
      if (!res.ok) {
        let serverMessage: string | null = null;
        try {
          const errBody = (await res.json()) as { error?: unknown } | null;
          if (errBody && typeof errBody.error === 'string' && errBody.error.trim() !== '') {
            serverMessage = errBody.error;
          }
        } catch {
          // বডি JSON নয় — status-ই যথেষ্ট
        }
        const statusText = `HTTP ${res.status}`;
        throw new Error(
          serverMessage ? `${serverMessage} (${statusText})` : `চ্যাট-অনুরোধ ব্যর্থ (${statusText})`
        );
      }
      const data = (await res.json().catch(() => null)) as ChatResponse | null;
      if (!data || typeof data.runId !== 'string' || typeof data.conversationId !== 'string') {
        throw new Error('সার্ভার থেকে অবৈধ উত্তর এসেছে — আবার চেষ্টা করুন');
      }

      const st = useChatStore.getState();
      // নতুন কথোপকথন হলে active হিসেবে সেট করো
      if (!st.activeId) st.setActiveId(data.conversationId);
      // (অডিট §B1) viewOk সবসময় সদ্য-সেট হওয়া সত্যকারের activeId দিয়ে বোঝাও —
      // নতুন কথোপকথনের প্রথম বার্তায় সাময়িক-স্ন্যাপশট (st) এখনো null দেখায়,
      // ফলে pending-বাবল আসত না এবং ব্যবহারকারী দীর্ঘ নীরবতা দেখতেন।
      const activeNow = useChatStore.getState().activeId;
      const viewOk = activeNow === conversationIdAtSend || activeNow === data.conversationId;
      if (viewOk) {
        st.replaceMessage(optimisticId, data.userMessage);
        const pendingId = `pending-${data.runId}`;
        st.appendMessage({
          id: pendingId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString(),
          activities: [],
        });
        void st.refetchConversations();
        openStream(data.runId, data.conversationId, data.userMessage.id, pendingId);
      } else {
        // পাঠানোর মাঝে ব্যবহারকারী অন্য কথোপকথনে চলে গেছেন —
        // রান চলবে, ফিরে এলে সার্ভার-সত্য লোড হবে
        void st.refetchConversations();
        openStream(data.runId, data.conversationId, data.userMessage.id, `pending-${data.runId}`);
      }
    } catch (err) {
      const st = useChatStore.getState();
      st.removeMessage(optimisticId);
      st.setIsRunActive(false);
      st.setDraft(content);
      st.addAttachments(attachments);
      // (অডিট §২.৩) নেটওয়ার্ক-ব্যর্থতা বনাম HTTP-ব্যর্থতা আলাদা করে দেখানো —
      // উপরের পাথ থ্রো করা বার্তা বহন করে (সার্ভারের স্যানিটাইজড বার্তা +
      // HTTP status); fetch নিজে ব্যর্থ হলে সেটি নেটওয়ার্ক-সমস্যা।
      // ড্রাফট ও অ্যাটাচমেন্ট অক্ষত ফিরে এসেছে — আবার পাঠানো যাবে।
      const isNetworkError = err instanceof TypeError;
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: isNetworkError ? 'নেটওয়ার্ক সমস্যা — সার্ভারে পৌঁছানো যায়নি' : 'বার্তা পাঠানো যায়নি',
        description: isNetworkError
          ? 'ইন্টারনেট-সংযোগ পরীক্ষা করে আবার চেষ্টা করুন। আপনার লেখা অক্ষত আছে।'
          : `${message.slice(0, 220)} — আপনার লেখা অক্ষত আছে, আবার চেষ্টা করতে পারেন।`,
        variant: 'destructive',
      });
    }
  }, [openStream]);

  /**
   * রিলোড — এই assistant-বার্তার আগের user-বার্তাটি আবার পাঠায়
   * (নতুন সৎ টার্ন হিসেবে; অ্যাটাচমেন্ট ছাড়া, টেক্সট-প্রম্পট হুবহু)।
   */
  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      const store = useChatStore.getState();
      if (store.isRunActive) return;
      const messages = store.messages;
      const idx = messages.findIndex((m) => m.id === assistantMessageId);
      if (idx < 0) return;
      let userIdx = idx - 1;
      while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--;
      if (userIdx < 0) return;
      const userContent = (messages[userIdx].content ?? '').trim();
      if (!userContent) return;
      await send(userContent, { skipAttachments: true });
    },
    [send],
  );

  return { send, regenerate, isRunActive };
}
