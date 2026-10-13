'use client';

import { useEffect, useRef } from 'react';

import type { ChatMessage } from '@/lib/types';

import { MessageBubble } from '@/components/chat/message-bubble';
import { Skeleton } from '@/components/ui/skeleton';

const NEAR_BOTTOM_PX = 140;

function LoadingConversation() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="কথোপকথন লোড হচ্ছে">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/5 rounded-2xl rounded-br-md" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-24 w-5/6 rounded-2xl rounded-bl-md" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/3 rounded-2xl rounded-br-md" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-16 w-11/12 rounded-xl" />
        <Skeleton className="h-24 w-2/3 rounded-2xl rounded-bl-md" />
      </div>
    </div>
  );
}

/**
 * বার্তা-স্ক্রল এলাকা। নতুন কনটেন্টে স্বয়ংক্রিয় নিচে স্ক্রল —
 * শুধু তখনই যখন ব্যবহারকারী নিচের কাছাকাছি আছেন।
 */
export function MessageList({
  messages,
  isLoadingDetail,
  onRegenerate,
}: {
  messages: ChatMessage[];
  isLoadingDetail: boolean;
  onRegenerate: (assistantMessageId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const scrollToBottom = (behavior: ScrollBehavior) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  };

  // মাউন্ট (কথোপকথন খোলা) — সরাসরি একদম নিচে
  useEffect(() => {
    nearBottomRef.current = true;
    scrollToBottom('auto');
  }, []);

  // নতুন কনটেন্ট — near-bottom হলে smooth স্ক্রল
  useEffect(() => {
    if (nearBottomRef.current) scrollToBottom('smooth');
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto"
      role="log"
      aria-label="কথোপকথনের বার্তাসমূহ"
      aria-live="polite"
    >
      <div className="mx-auto w-full max-w-3xl space-y-6 px-3 py-4 sm:px-6 sm:py-6">
        {isLoadingDetail && messages.length === 0 ? (
          <LoadingConversation />
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              isPending={message.id.startsWith('pending-')}
              onRegenerate={onRegenerate}
            />
          ))
        )}
      </div>
    </div>
  );
}
