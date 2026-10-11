'use client';

import { useEffect } from 'react';

import { useChatStore } from '@/hooks/use-chat-store';

const ACTIVE_CONVERSATION_KEY = 'agentic-active-conversation';

/**
 * কথোপকথনের তালিকা — মাউন্টে একবার fetch + রিফ্রেশ ফাংশন।
 * পেজ রিলোডের পর localStorage থেকে শেষ সক্রিয় কথোপকথন ফিরিয়ে আনে।
 */
export function useConversations() {
  const conversations = useChatStore((s) => s.conversations);
  const refetchConversations = useChatStore((s) => s.refetchConversations);

  useEffect(() => {
    void (async () => {
      await refetchConversations();
      const store = useChatStore.getState();
      if (store.activeId) return;
      let saved: string | null = null;
      try {
        saved = window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
      } catch {
        saved = null;
      }
      if (saved && store.conversations.some((c) => c.id === saved)) {
        void store.openConversation(saved);
      }
    })();
  }, [refetchConversations]);

  return { conversations, refetchConversations };
}
