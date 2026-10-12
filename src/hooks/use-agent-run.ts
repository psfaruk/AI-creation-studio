'use client';

// ============================================================
// এজেন্ট-রান লাইফসাইকেল:
// 1. POST /api/chat → optimistic user msg + pending assistant turn
// 2. EventSource /api/runs/{runId}/events → লাইভ টুল-অ্যাক্টিভিটি
// 3. SSE ছিঁড়লে GET /api/conversations/{id} দিয়ে 2s পোলিং (180s টাইমআউট)
// ============================================================

import { useCallback, useEffect, useRef } from 'react';

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

/** SSE ইভেন্টের সম্ভাব্য নাম — নামযুক্ত ইভেন্ট ও unnamed message দুটোই শোনা হয় */
const SSE_EVENT_NAMES = [
  'run_started',
  'tool_start',
  'tool_end',
  'message',
  'run_note',
  'run_finished',
] as const;

export function useAgentRun() {
  const isRunActive = useChatStore((s) => s.isRunActive);

  const esRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishedRef = useRef(false);

  const stopRunWatchers = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

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
      const es = new EventSource(`/api/runs/${runId}/events`);
      esRef.current = es;
      finishedRef.current = false;

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
                      ...a,
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
            store.replaceMessage(pendingId, evt.message);
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
            stopRunWatchers();
            const s = useChatStore.getState();
            s.setIsRunActive(false);
            void s.refetchConversations(); // শিরোনাম আপডেট হতে পারে
            if (evt.status === 'failed' || evt.status === 'interrupted') {
              toast({ title: GENERIC_ERROR, variant: 'destructive' });
              if (s.activeId === conversationId) {
                // placeholder-এ ত্রুটি-নোট রেখে দাও
                s.updateMessage(pendingId, (m) => ({
                  ...m,
                  content:
                    m.content ||
                    `⚠️ ${evt.error || 'রানটি সম্পূর্ণ করা যায়নি। আবার চেষ্টা করুন।'}`,
                }));
              }
            } else if (s.activeId === conversationId) {
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

      es.onmessage = (e) => dispatch(e.data);
      // সার্ভার যদি নামযুক্ত SSE ইভেন্ট (event: tool_start) পাঠায়
      for (const name of SSE_EVENT_NAMES) {
        es.addEventListener(name, (e) => dispatch((e as MessageEvent).data));
      }

      es.onerror = () => {
        if (finishedRef.current) {
          stopRunWatchers();
          return;
        }
        // রান চলাকালীন সংযোগ ছিঁড়েছে → পোলিং-ফলব্যাক
        stopRunWatchers();
        startPolling(conversationId, userMessageId, pendingId);
      };
    },
    [startPolling, stopRunWatchers],
  );

  const send = useCallback(async () => {
    const store = useChatStore.getState();
    if (store.isRunActive) return;

    const content = store.draft.trim();
    const attachments = [...store.pendingAttachments];
    const chatModel = store.chatModel;
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
          attachments: attachments.map(({ kind, name, dataUrl }) => ({ kind, name, dataUrl })),
        } satisfies ChatRequest),
      });
      if (!res.ok) throw new Error('chat request failed');
      const data = (await res.json()) as ChatResponse;

      const st = useChatStore.getState();
      // নতুন কথোপকথন হলে active হিসেবে সেট করো
      if (!st.activeId) st.setActiveId(data.conversationId);
      const viewOk =
        st.activeId === conversationIdAtSend || st.activeId === data.conversationId;
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
    } catch {
      const st = useChatStore.getState();
      st.removeMessage(optimisticId);
      st.setIsRunActive(false);
      st.setDraft(content);
      st.addAttachments(attachments);
      toast({ title: GENERIC_ERROR, variant: 'destructive' });
    }
  }, [openStream]);

  return { send, isRunActive };
}
