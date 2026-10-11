'use client';

import { useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { ConversationSummary, ToolCategory, ToolInfo } from '@/lib/types';

import { relativeTimeBn, toBnDigits } from '@/components/chat/bn-format';
import { ToolIcon } from '@/components/chat/tool-icon';
import { useChatStore } from '@/hooks/use-chat-store';
import { useTools } from '@/hooks/use-tools';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  research: 'রিসার্চ',
  media: 'মিডিয়া',
  vision: 'ভিশন',
  audio: 'অডিও',
  memory: 'স্মৃতি',
};

const CATEGORY_ORDER: ToolCategory[] = ['research', 'media', 'vision', 'audio', 'memory'];

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const deleteConversation = useChatStore((s) => s.deleteConversation);

  return (
    <li className="group/item relative">
      <button
        type="button"
        onClick={() => onSelect(conversation.id)}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'min-h-14 w-full rounded-lg border px-3 py-2 pr-11 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/40',
          isActive
            ? 'border-emerald-600/40 bg-emerald-600/10'
            : 'border-transparent hover:border-border hover:bg-muted',
        )}
      >
        <span className="block truncate text-sm font-medium">{conversation.title}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {relativeTimeBn(conversation.lastMessageAt)} · {toBnDigits(conversation.messageCount)}টি
          বার্তা
        </span>
      </button>

      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
              aria-label={`কথোপকথন "${conversation.title}" মুছে ফেলুন`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>কথোপকথন মুছে ফেলবেন?</AlertDialogTitle>
              <AlertDialogDescription>এটি ফিরিয়ে আনা যাবে না।</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>বাতিল</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
                onClick={() => void deleteConversation(conversation.id)}
              >
                মুছে ফেলুন
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}

function ToolsSection({ tools }: { tools: ToolInfo[] }) {
  const grouped = useMemo(() => {
    const map = new Map<ToolCategory, ToolInfo[]>();
    for (const tool of tools) {
      const list = map.get(tool.category) ?? [];
      list.push(tool);
      map.set(tool.category, list);
    }
    return CATEGORY_ORDER.map((category) => ({
      category,
      tools: map.get(category) ?? [],
    })).filter((g) => g.tools.length > 0);
  }, [tools]);

  return (
    <div
      className="max-h-[38vh] overflow-y-auto pr-1
        [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent]
        [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
    >
      {grouped.map(({ category, tools: items }) => (
        <div key={category} className="mb-3 last:mb-0">
          <p className="mb-1.5 px-1 text-[11px] font-medium tracking-wide text-muted-foreground">
            {CATEGORY_LABELS[category]}
          </p>
          <ul className="space-y-0.5">
            {items.map((tool) => (
              <li key={tool.name}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex min-h-10 cursor-default items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                        <ToolIcon name={tool.icon} className="size-3.5" />
                      </span>
                      <span className="truncate text-sm">{tool.title}</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-56 text-balance">
                    {tool.description}
                  </TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * সাইডবার কনটেন্ট — ডেস্কটপ aside ও মোবাইল Sheet দুই জায়গাতেই ব্যবহৃত।
 */
export function SidebarContent({ onAfterSelect }: { onAfterSelect?: () => void }) {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const openConversation = useChatStore((s) => s.openConversation);
  const tools = useTools();

  const handleNewChat = () => {
    void openConversation(null);
    onAfterSelect?.();
  };

  const handleSelect = (id: string) => {
    void openConversation(id);
    onAfterSelect?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 p-3 pb-0">
        <Button
          type="button"
          onClick={handleNewChat}
          className="h-11 w-full rounded-xl bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700"
        >
          <Plus className="size-4" aria-hidden="true" />
          নতুন কথোপকথন
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        <section aria-label="সাম্প্রতিক কথোপকথন">
          <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
            সাম্প্রতিক কথোপকথন
          </h3>
          {conversations.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
              কোনো কথোপকথন নেই
            </p>
          ) : (
            <ScrollArea className="max-h-[32vh] min-h-16" aria-label="কথোপকথন তালিকা">
              <ul className="space-y-1 pr-1.5">
                {conversations.map((conversation) => (
                  <ConversationItem
                    key={conversation.id}
                    conversation={conversation}
                    isActive={conversation.id === activeId}
                    onSelect={handleSelect}
                  />
                ))}
              </ul>
            </ScrollArea>
          )}
        </section>

        <Separator className="shrink-0" />

        <section aria-label="টুল রেজিস্ট্রি">
          <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">টুল রেজিস্ট্রি</h3>
          <ToolsSection tools={tools} />
        </section>
      </div>
    </div>
  );
}
