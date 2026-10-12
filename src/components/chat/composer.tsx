'use client';

import { useCallback, useEffect, useRef, type ChangeEvent, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { FileAudio, FileImage, FileVideo, Paperclip, SendHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';

import { PulsingDots } from '@/components/chat/pulsing-dots';
import { ModelSelector } from '@/components/chat/model-selector';
import { useAgentRun } from '@/hooks/use-agent-run';
import { useChatStore, type PendingAttachment } from '@/hooks/use-chat-store';
import { toast } from '@/hooks/use-toast';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // ৫MB
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // ১০MB
const MAX_VIDEO_BYTES = 25 * 1024 * 1024; // ২৫MB
const TEXTAREA_MAX_HEIGHT_PX = 160; // ≈ ৫ সারি

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** ইনডেটারমিনেট পাতলা এমারেল্ড প্রোগ্রেস বার */
function IndeterminateBar() {
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-emerald-600/10"
      role="progressbar"
      aria-label="এজেন্ট কাজ করছে"
    >
      <motion.div
        className="h-full w-1/3 rounded-full bg-emerald-600"
        animate={{ x: ['-100%', '300%'] }}
        transition={{ repeat: Infinity, duration: 1.3, ease: 'easeInOut' }}
      />
    </div>
  );
}

/** কম্পোজার — সংযুক্তি চিপস, অটো-রিসাইজ টেক্সটেরিয়া, অ্যাটাচ ও সেন্ড */
export function Composer() {
  const draft = useChatStore((s) => s.draft);
  const setDraft = useChatStore((s) => s.setDraft);
  const attachments = useChatStore((s) => s.pendingAttachments);
  const removeAttachment = useChatStore((s) => s.removeAttachment);
  const addAttachments = useChatStore((s) => s.addAttachments);
  const isRunActive = useChatStore((s) => s.isRunActive);
  const focusSignal = useChatStore((s) => s.composerFocusSignal);

  const { send } = useAgentRun();

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  // অটো-রিসাইজ (সর্বোচ্চ ~৫ সারি)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`;
  }, [draft]);

  // কুইক-স্টার্ট চিপ ইত্যাদি থেকে ফোকাস রিকোয়েস্ট
  useEffect(() => {
    if (focusSignal > 0) textareaRef.current?.focus();
  }, [focusSignal]);

  const canSend = !isRunActive && (draft.trim().length > 0 || attachments.length > 0);

  const handleSend = useCallback(() => {
    if (!canSend) return;
    void send();
  }, [canSend, send]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter = পাঠানো, Shift+Enter = নতুন সারি (IME কম্পোজিশন চলাকালীন বাদ)
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFiles = (kind: 'image' | 'audio' | 'video') => async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // একই ফাইল দুবার বাছাই করা যায় সেজন্য রিসেট
    const maxBytes = kind === 'image' ? MAX_IMAGE_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;
    const accepted: PendingAttachment[] = [];

    for (const file of files) {
      if (file.size > maxBytes) {
        toast({
          title:
            kind === 'image'
              ? 'ছবিটি খুব বড় — সর্বোচ্চ ৫MB আকারের হতে পারে'
              : kind === 'video'
                ? 'ভিডিওটি খুব বড় — সর্বোচ্চ ২৫MB আকারের হতে পারে'
                : 'অডিওটি খুব বড় — সর্বোচ্চ ১০MB আকারের হতে পারে',
          variant: 'destructive',
        });
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        accepted.push({ kind, name: file.name, dataUrl });
      } catch {
        toast({ title: 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।', variant: 'destructive' });
      }
    }
    if (accepted.length > 0) addAttachments(accepted);
  };

  return (
    <div className="shrink-0 border-t bg-background">
      {isRunActive && (
        <div className="mx-auto w-full max-w-3xl space-y-1.5 px-3 pt-3 sm:px-6">
          <IndeterminateBar />
          <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
            এজেন্ট কাজ করছে…
            <PulsingDots />
          </p>
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {attachments.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <span
                key={`${a.name}-${i}`}
                className="flex items-center gap-1.5 rounded-full border bg-card py-1 pl-2.5 pr-1 text-xs shadow-sm"
              >
                {a.kind === 'image' ? (
                  <FileImage className="size-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                ) : a.kind === 'video' ? (
                  <FileVideo className="size-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <FileAudio className="size-3.5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
                )}
                <span className="max-w-36 truncate">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40"
                  aria-label="সংযুক্তি সরান"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1 rounded-2xl border bg-card p-1 shadow-sm transition-shadow focus-within:ring-2 focus-within:ring-emerald-600/25">
          <ModelSelector disabled={isRunActive} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
                aria-label="ফাইল সংযুক্ত করুন"
                disabled={isRunActive}
              >
                <Paperclip className="size-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem onClick={() => imageInputRef.current?.click()}>
                <FileImage aria-hidden="true" />
                ছবি আপলোড
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => audioInputRef.current?.click()}>
                <FileAudio aria-hidden="true" />
                অডিও আপলোড (গান/ভয়েস)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => videoInputRef.current?.click()}>
                <FileVideo aria-hidden="true" />
                ভিডিও আপলোড
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="আপনার নির্দেশ লিখুন… (Enter দিয়ে পাঠান)"
            rows={1}
            disabled={isRunActive}
            aria-label="আপনার বার্তা লিখুন"
            className="field-sizing-fixed max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent px-2.5 py-2.5 text-base shadow-none outline-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent md:text-sm"
          />

          <Button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="size-11 shrink-0 rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            aria-label="পাঠান"
          >
            <SendHorizontal className="size-5" aria-hidden="true" />
          </Button>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void handleFiles('image')(e);
            }}
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void handleFiles('audio')(e);
            }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska,video/*"
            multiple
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(e) => {
              void handleFiles('video')(e);
            }}
          />
        </div>
      </div>
    </div>
  );
}
