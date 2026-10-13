'use client';

// ============================================================
// ফিনিশিং-সিস্টেম — স্ট্রিম শেষ হলে assistant-বার্তার নিচে
// ছোট অ্যাকশন-সারি: কপি · লাইক · ডিসলাইক · রিলোড।
//
//  - কপি: ক্লিপবোর্ডে পুরো বার্তা → ২ সে. টিক-চিহ্ন প্রতিক্রিয়া
//  - লাইক/ডিসলাইক: লোকাল ফিডব্যাক (ব্রাউজারেই সংরক্ষিত, টগলযোগ্য)
//  - রিলোড: আগের user-বার্তাটি আবার পাঠায় (নতুন উত্তর তৈরি)
//  - আইকনগুলো ছোট (size-7 টাচ-টার্গেট, size-3.5 গ্লিফ) ও মিউটেড —
//    উত্তরের ওপর কখনো ভিড় জমায় না; হোভারে মাত্র সামান্য জ্বলে ওঠে
// ============================================================

import { useCallback, useState } from 'react';
import { Check, Copy, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';

import { cn } from '@/lib/utils';

const FEEDBACK_PREFIX = 'amai-feedback:';

type Feedback = 'up' | 'down' | null;

function loadFeedback(messageId: string): Feedback {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(FEEDBACK_PREFIX + messageId);
    return v === 'up' || v === 'down' ? v : null;
  } catch {
    return null;
  }
}

function saveFeedback(messageId: string, value: Feedback): void {
  try {
    if (value === null) window.localStorage.removeItem(FEEDBACK_PREFIX + messageId);
    else window.localStorage.setItem(FEEDBACK_PREFIX + messageId, value);
  } catch {
    // প্রাইভেট-মোড ইত্যাদিতে নীরব
  }
}

function ActionButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors',
        'hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
        active && 'text-emerald-600 dark:text-emerald-400',
      )}
    >
      {children}
    </button>
  );
}

export function MessageActions({
  messageId,
  content,
  onRegenerate,
}: {
  messageId: string;
  content: string;
  onRegenerate: (assistantMessageId: string) => void;
}) {
  // key=message.id দিয়ে মাউন্ট হয় — নতুন বার্তায় নতুন ইনস্ট্যান্স,
  // তাই স্টেট-ইনিশিয়ালাইজারই যথেষ্ট (effect-সেটস্টেট নয়)
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(() => loadFeedback(messageId));

  const handleCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ক্লিপবোর্ড-অনুমতি নেই — নীরব
    }
  }, [content]);

  const toggleFeedback = useCallback(
    (value: Exclude<Feedback, null>) => {
      setFeedback(prev => {
        const next = prev === value ? null : value;
        saveFeedback(messageId, next);
        return next;
      });
    },
    [messageId],
  );

  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label="বার্তা-অ্যাকশন: কপি, পছন্দ, অপছন্দ, রিলোড"
    >
      <ActionButton
        label={copied ? 'কপি হয়েছে' : 'বার্তা কপি করুন'}
        onClick={() => void handleCopy()}
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        ) : (
          <Copy className="size-3.5" aria-hidden="true" />
        )}
      </ActionButton>

      <ActionButton
        label="ভালো উত্তর (লাইক)"
        active={feedback === 'up'}
        onClick={() => toggleFeedback('up')}
      >
        <ThumbsUp className="size-3.5" aria-hidden="true" />
      </ActionButton>

      <ActionButton
        label="ভালো লাগেনি (ডিসলাইক)"
        active={feedback === 'down'}
        onClick={() => toggleFeedback('down')}
      >
        <ThumbsDown className="size-3.5" aria-hidden="true" />
      </ActionButton>

      <ActionButton
        label="আবার উত্তর তৈরি করুন (রিলোড)"
        onClick={() => onRegenerate(messageId)}
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
      </ActionButton>
    </div>
  );
}
