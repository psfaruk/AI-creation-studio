'use client';

import { motion } from 'framer-motion';
import { AlertTriangle, AudioLines, Cpu, Film, Loader2, RotateCcw } from 'lucide-react';

import type { ChatMessage, RunErrorCategory, RunEndReason } from '@/lib/types';
import { RUN_END_REASON_LABELS_BN, RUN_ERROR_CATEGORY_LABELS_BN } from '@/lib/types';

import { formatRunStatsBn, formatTimeBn } from '@/components/chat/bn-format';
import { withStudioToken } from '@/components/auth/security-gate';
import { ActivityCard } from '@/components/chat/activity-card';
import { ArtifactList } from '@/components/chat/artifact-view';
import { Markdown } from '@/components/chat/markdown';
import { MessageActions } from '@/components/chat/message-actions';
import { PulsingDots } from '@/components/chat/pulsing-dots';
import { ProductionCard } from '@/components/studio/production-card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

function UserBubble({ message }: { message: ChatMessage }) {
  const images = (message.attachments ?? []).filter((a) => a.kind === 'image');
  const audios = (message.attachments ?? []).filter((a) => a.kind === 'audio');
  const videos = (message.attachments ?? []).filter((a) => a.kind === 'video');

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex justify-end"
    >
      <div className="flex max-w-[85%] flex-col items-end gap-1.5 sm:max-w-[75%]">
        {images.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {images.map((a, i) => (
               
              <img
                key={`${a.name}-${i}`}
                src={withStudioToken(a.url)}
                alt={a.name}
                className="size-16 rounded-lg border object-cover"
              />
            ))}
          </div>
        )}

        {message.content && (
          <div className="rounded-2xl rounded-br-md border border-emerald-600/20 bg-emerald-600/10 px-4 py-2.5 shadow-sm">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {message.content}
            </p>
          </div>
        )}

        {audios.map((a, i) => (
          <div
            key={`${a.name}-${i}`}
            className="flex max-w-full items-center gap-2 rounded-xl border bg-card px-3 py-1.5 shadow-sm"
          >
            <AudioLines
              className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
              aria-hidden="true"
            />
            <span className="max-w-28 truncate text-xs text-muted-foreground">{a.name}</span>
            { }
            <audio controls src={withStudioToken(a.url)} className="h-8 w-40 max-w-[45vw]" aria-label={a.name} />
          </div>
        ))}

        {videos.length > 0 && (
          <div className="flex max-w-full flex-col gap-1.5">
            {videos.map((a, i) => (
              <div
                key={`${a.name}-${i}`}
                className="flex max-w-full items-center gap-2 rounded-xl border bg-card px-3 py-1.5 shadow-sm"
              >
                <Film
                  className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span className="max-w-36 truncate text-xs text-muted-foreground">{a.name}</span>
                <video controls preload="metadata" src={withStudioToken(a.url)} className="h-16 w-28 rounded-md bg-black" aria-label={a.name} />
              </div>
            ))}
          </div>
        )}

        <span className="text-[11px] text-muted-foreground">{formatTimeBn(message.createdAt)}</span>
      </div>
    </motion.div>
  );
}

/** স্ট্রিমিং-কার্সর — টাইপরাইটার-ড্রেন চলাকালীন প্রান্তে জ্বলে-নেভে */
function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-4 w-[7px] translate-y-[2px] animate-pulse rounded-[2px] bg-emerald-600 dark:bg-emerald-400"
    />
  );
}

/**
 * (অডিট §১-E) রান-ব্যর্থতার স্ট্যাটাস-চিপ — বাংলা শ্রেণি-লেবেল +
 * ত্রুটি-বার্তা + "আবার চেষ্টা" (শেষ user-বার্তা আবার পাঠায়)।
 */
function RunFailureChip({
  message,
  onRegenerate,
}: {
  message: ChatMessage;
  onRegenerate: (assistantMessageId: string) => void;
}) {
  const runEnd = message.runEnd;
  if (!runEnd || (runEnd.status !== 'failed' && runEnd.status !== 'interrupted')) return null;

  const statusLabel = runEnd.status === 'interrupted' ? 'বিঘ্নিত' : 'ব্যর্থ';
  const categoryLabel = runEnd.errorCategory
    ? RUN_ERROR_CATEGORY_LABELS_BN[runEnd.errorCategory as RunErrorCategory]
    : runEnd.endReason
      ? RUN_END_REASON_LABELS_BN[runEnd.endReason as RunEndReason]
      : 'অজানা ত্রুটি';
  const endReasonLabel = runEnd.endReason
    ? RUN_END_REASON_LABELS_BN[runEnd.endReason as RunEndReason]
    : null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-1.5 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle
          className="size-4 shrink-0 text-red-600 dark:text-red-400"
          aria-hidden="true"
        />
        <span className="text-xs font-semibold text-red-700 dark:text-red-400">
          {statusLabel} — {categoryLabel}
        </span>
        {endReasonLabel && endReasonLabel !== categoryLabel && (
          <span className="text-[11px] text-muted-foreground">({endReasonLabel})</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRegenerate(message.id)}
          className="ml-auto h-7 gap-1.5 rounded-full border-red-500/30 px-2.5 text-xs font-medium text-red-700 hover:bg-red-500/10 hover:text-red-800 focus-visible:ring-red-500/40 dark:text-red-400 dark:hover:text-red-300"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          আবার চেষ্টা
        </Button>
      </div>
      {runEnd.error && (
        <p className="break-words text-[11px] leading-relaxed text-red-600/90 dark:text-red-400/90">
          {runEnd.error}
        </p>
      )}
    </div>
  );
}

function AssistantTurn({
  message,
  isPending,
  onRegenerate,
}: {
  message: ChatMessage;
  isPending: boolean;
  onRegenerate: (assistantMessageId: string) => void;
}) {
  const activities = message.activities ?? [];
  const shownArtifactIds = new Set(
    activities.flatMap((a) => (a.artifacts ?? []).map((x) => x.id)),
  );
  // একই আর্টিফ্যাক্ট activity-তে দেখানো হলে বার্তা-লেভেলে আর নয় (duplicate এড়াতে)
  const extraArtifacts = (message.artifacts ?? []).filter((x) => !shownArtifactIds.has(x.id));
  const waiting = isPending && !message.content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex flex-col gap-2"
    >
      {activities.length > 0 && (
        <div className="relative flex flex-col gap-2">
          <span
            aria-hidden="true"
            className="absolute bottom-4 left-[27px] top-4 w-px bg-border"
          />
          {activities.map((activity) => (
            <ActivityCard key={activity.id} activity={activity} />
          ))}
        </div>
      )}

      {waiting ? (
        <div className="rounded-2xl rounded-bl-md border bg-card px-4 py-3 shadow-sm">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2
              className="size-4 animate-spin text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            {/* লাইভ-অবস্থা সৎশব্দে (অডিট §১-E): টুল-চালানো শেষে পরের ধাপের
                সিদ্ধান্ত নিচ্ছে, নইলে LLM চিন্তা করছে */}
            {activities.length > 0 ? 'পরের ধাপ নির্ধারণ করছে…' : 'এজেন্ট চিন্তা করছে…'}
            <PulsingDots />
          </p>
          {/* S9: রান-স্ট্যাটাস নোট (রেট-লিমিট-অপেক্ষা ইত্যাদি) — চূড়ান্ত বার্তা এলে আপনিই সরে যায় */}
          {message.statusNote && (
            <p
              role="status"
              className="mt-2.5 flex items-start gap-2 border-l-2 border-amber-500/70 pl-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
            >
              <span
                className="mt-1 size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
                aria-hidden="true"
              />
              {message.statusNote}
            </p>
          )}
          <div className="mt-3 space-y-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ) : (
        message.content && (
          <div className="rounded-2xl rounded-bl-md border bg-card px-4 py-3 shadow-sm">
            <Markdown content={message.content} />
            {isPending && <StreamingCursor />}
          </div>
        )
      )}

      {/* (অডিট §F) টেক্সট-স্ট্রিমিং চলাকালীনও স্ট্যাটাস-নোট (যেমন
          রেট-লিমিট-পুনঃচেষ্টার অপেক্ষা) স্থায়ীভাবে দৃশ্যমান — শুধু
          খালি-বাবল-অবস্থায় নয় */}
      {!waiting && isPending && message.statusNote && (
        <p
          role="status"
          className="flex items-start gap-2 border-l-2 border-amber-500/70 pl-2.5 text-xs leading-relaxed text-amber-700 dark:text-amber-400"
        >
          <span
            className="mt-1 size-1.5 shrink-0 animate-pulse rounded-full bg-amber-500"
            aria-hidden="true"
          />
          {message.statusNote}
        </p>
      )}

      {/* (অডিট §১-E) রান ব্যর্থ/বিঘ্নিত হলে স্পষ্ট স্ট্যাটাস-চিপ */}
      {!isPending && <RunFailureChip message={message} onRegenerate={onRegenerate} />}

      {extraArtifacts.length > 0 && <ArtifactList artifacts={extraArtifacts} />}

      {message.productionId && <ProductionCard productionId={message.productionId} />}

      {/* ফিনিশিং-সিস্টেম: স্ট্রিম শেষ হলে ছোট অ্যাকশন-সারি */}
      {!isPending && message.content && (
        <MessageActions
          messageId={message.id}
          content={message.content}
          onRegenerate={onRegenerate}
        />
      )}

      {message.runStats && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{formatRunStatsBn(message.runStats)}</span>
          {message.model && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10px]">
              <Cpu className="size-2.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {message.model === '(default)' ? 'ডিফল্ট মডেল' : message.model}
            </span>
          )}
        </p>
      )}
    </motion.div>
  );
}

export function MessageBubble({
  message,
  isPending,
  onRegenerate,
}: {
  message: ChatMessage;
  isPending: boolean;
  onRegenerate: (assistantMessageId: string) => void;
}) {
  if (message.role === 'user') return <UserBubble message={message} />;
  return <AssistantTurn message={message} isPending={isPending} onRegenerate={onRegenerate} />;
}
