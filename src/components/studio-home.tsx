'use client';

import { useState } from 'react';
import { Menu, Sparkles } from 'lucide-react';

import { Composer } from '@/components/chat/composer';
import { EmptyState } from '@/components/chat/empty-state';
import { MessageList } from '@/components/chat/message-list';
import { RateLimitBanner } from '@/components/chat/rate-limit-banner';
import { SidebarContent } from '@/components/chat/sidebar';
import { GalleryView } from '@/components/studio/gallery-view';
import { GuideView } from '@/components/studio/guide-view';
import { ProductionsView } from '@/components/studio/productions-view';
import { RegistryView } from '@/components/studio/registry-view';
import { StudioView } from '@/components/studio/studio-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { useAgentRun } from '@/hooks/use-agent-run';
import { useConversations } from '@/hooks/use-conversations';
import { useChatStore } from '@/hooks/use-chat-store';
import { useUiView } from '@/hooks/use-ui-view';
import { TOOL_CATALOG } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * মূল স্টুডিও-শেল — SecurityGate খোলা হলেই (মালিক-সেশন সহ) মাউন্ট হয়;
 * ফলে কোনো ডেটা-ফেচ লেখক-হুকও প্রমাণীকরণের আগে চলে না।
 */
export function StudioHome() {
  useConversations();

  const activeId = useChatStore((s) => s.activeId);
  const messages = useChatStore((s) => s.messages);
  const isLoadingDetail = useChatStore((s) => s.isLoadingDetail);
  const isRunActive = useChatStore((s) => s.isRunActive);
  const activeView = useUiView((s) => s.activeView);
  const { regenerate } = useAgentRun();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const showEmpty = !isLoadingDetail && messages.length === 0;

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* ---------- হেডার ---------- */}
      <header className="sticky top-0 z-40 shrink-0 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex h-14 items-center gap-1.5 px-2 sm:gap-2 sm:px-4">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 md:hidden"
            onClick={() => setMobileNavOpen(true)}
            aria-label="মেনু খুলুন"
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>

          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">অ্যাজেন্টিক AI ক্রিয়েটিভ স্টুডিও</span>
              <span className="block text-[11px] text-muted-foreground">
                ছবি · অডিও · ভিডিও · ফিল্ম — টুল-চালানো সহকারী
              </span>
            </span>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="ml-auto flex cursor-default items-center gap-2 rounded-full border bg-card px-2.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40"
                role="status"
              >
                <span
                  className={cn(
                    'size-2 rounded-full transition-colors',
                    isRunActive
                      ? 'animate-pulse bg-emerald-500'
                      : 'bg-muted-foreground/40',
                  )}
                  aria-hidden="true"
                />
                <span className="sr-only">{isRunActive ? 'এজেন্ট সক্রিয়' : 'নিষ্ক্রিয়'}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {isRunActive ? 'এজেন্ট সক্রিয়' : 'নিষ্ক্রিয়'}
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/* ---------- মূল অংশ: সাইডবার + ভিউ ---------- */}
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          className="hidden w-72 shrink-0 flex-col border-r bg-muted/30 md:flex"
          aria-label="সাইডবার"
        >
          <SidebarContent />
        </aside>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent
            side="left"
            className="w-80 max-w-[85vw] gap-0 border-r bg-background p-0"
          >
            <SheetTitle className="sr-only">ন্যাভিগেশন মেনু</SheetTitle>
            <SheetDescription className="sr-only">
              সাম্প্রতিক কথোপকথন, ভিউ ও টুল রেজিস্ট্রি
            </SheetDescription>
            <SidebarContent onAfterSelect={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>

        {activeView === 'chat' && (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="চ্যাট">
            {showEmpty ? (
              <EmptyState />
            ) : (
              <MessageList
                key={activeId ?? 'new'}
                messages={messages}
                isLoadingDetail={isLoadingDetail}
                onRegenerate={regenerate}
              />
            )}
            {/* S9: রেট-লিমিটেড হলে সৎ-অ্যাম্বার ব্যানার (ব্লকড না থাকলে কিছুই রেন্ডার হয় না) */}
            <RateLimitBanner />
            <Composer />
          </section>
        )}

        {activeView === 'studio' && (
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label="স্টুডিও">
            <StudioView />
          </section>
        )}

        {activeView === 'gallery' && (
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label="গ্যালারি">
            <GalleryView />
          </section>
        )}

        {activeView === 'productions' && (
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label="প্রোডাকশন">
            <ProductionsView />
          </section>
        )}

        {activeView === 'registry' && (
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label="রেজিস্ট্রি">
            <RegistryView />
          </section>
        )}

        {activeView === 'guide' && (
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto" aria-label="গাইড">
            <GuideView />
          </section>
        )}
      </main>

      {/* ---------- ফুটার (সবসময় নিচে আটকে থাকে) ---------- */}
      <footer className="mt-auto shrink-0 border-t bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-2.5 text-xs text-muted-foreground">
          <p className="min-w-0 truncate">
            ক্রিয়েটিভ স্টুডিও — Orchestrator · Tool Registry · Productions · Quality Checks
          </p>
          <Badge
            variant="outline"
            className="shrink-0 border-emerald-600/40 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400"
          >
            {TOOL_CATALOG.length}টি টুল · ৫টি স্টুডিও
          </Badge>
        </div>
      </footer>
    </div>
  );
}

