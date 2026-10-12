'use client';

import { motion } from 'framer-motion';
import { AudioLines, Film, Loader2 } from 'lucide-react';

import type { ChatMessage } from '@/lib/types';

import { formatRunStatsBn, formatTimeBn } from '@/components/chat/bn-format';
import { ActivityCard } from '@/components/chat/activity-card';
import { ArtifactList } from '@/components/chat/artifact-view';
import { Markdown } from '@/components/chat/markdown';
import { PulsingDots } from '@/components/chat/pulsing-dots';
import { ProductionCard } from '@/components/studio/production-card';
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
                src={a.url}
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
            <audio controls src={a.url} className="h-8 w-40 max-w-[45vw]" aria-label={a.name} />
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
                <video controls preload="metadata" src={a.url} className="h-16 w-28 rounded-md bg-black" aria-label={a.name} />
              </div>
            ))}
          </div>
        )}

        <span className="text-[11px] text-muted-foreground">{formatTimeBn(message.createdAt)}</span>
      </div>
    </motion.div>
  );
}

function AssistantTurn({ message, isPending }: { message: ChatMessage; isPending: boolean }) {
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
            এজেন্ট কাজ করছে…
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
          </div>
        )
      )}

      {extraArtifacts.length > 0 && <ArtifactList artifacts={extraArtifacts} />}

      {message.productionId && <ProductionCard productionId={message.productionId} />}

      {message.runStats && (
        <p className="text-xs text-muted-foreground">{formatRunStatsBn(message.runStats)}</p>
      )}
    </motion.div>
  );
}

export function MessageBubble({
  message,
  isPending,
}: {
  message: ChatMessage;
  isPending: boolean;
}) {
  if (message.role === 'user') return <UserBubble message={message} />;
  return <AssistantTurn message={message} isPending={isPending} />;
}
