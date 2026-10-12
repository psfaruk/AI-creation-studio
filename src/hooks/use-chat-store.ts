'use client';

// ============================================================
// চ্যাট গ্লোবাল স্টেট (zustand) — কথোপকথন, বার্তা, কম্পোজার ড্রাফট,
// সংযুক্তি ও রান-অ্যাক্টিভ ফ্ল্যাগ। ডেটা-ফেচ অ্যাকশনগুলোও এখানে।
// ============================================================

import { create } from 'zustand';

import { toast } from '@/hooks/use-toast';
import type { ChatMessage, ConversationDetail, ConversationSummary } from '@/lib/types';

export const GENERIC_ERROR = 'কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।';

const ACTIVE_CONVERSATION_KEY = 'agentic-active-conversation';
const CHAT_MODEL_KEY = 'agentic-chat-model';

/** শেষ সক্রিয় কথোপকথন localStorage-এ মনে রাখা (রিলোডে ফিরিয়ে আনার জন্য) */
function rememberActiveConversation(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    // localStorage অনুপলব্ধ হলে নীরবে এড়িয়ে যাও
  }
}

/** নির্বাচিত চ্যাট-মডেল localStorage-এ মনে রাখা */
function loadChatModel(): string {
  try {
    return window.localStorage.getItem(CHAT_MODEL_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberChatModel(id: string): void {
  try {
    if (id) window.localStorage.setItem(CHAT_MODEL_KEY, id);
    else window.localStorage.removeItem(CHAT_MODEL_KEY);
  } catch {
    // নীরব
  }
}

/** কম্পোজারে যোগ হওয়া ফাইল (dataURL আকারে) */
export interface PendingAttachment {
  kind: 'image' | 'audio' | 'video';
  name: string;
  dataUrl: string;
}

interface ChatStore {
  conversations: ConversationSummary[];
  activeId: string | null;
  messages: ChatMessage[];
  isLoadingDetail: boolean;
  isRunActive: boolean;

  draft: string;
  pendingAttachments: PendingAttachment[];
  composerFocusSignal: number;
  /** নির্বাচিত চ্যাট-মডেল ('' = ডিফল্ট) — composer-এর সিলেক্টর থেকে সেট */
  chatModel: string;

  setDraft: (value: string) => void;
  setChatModel: (id: string) => void;
  addAttachments: (files: PendingAttachment[]) => void;
  removeAttachment: (index: number) => void;
  resetComposerInput: () => void;
  focusComposer: () => void;

  setActiveId: (id: string | null) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setIsRunActive: (value: boolean) => void;
  appendMessage: (message: ChatMessage) => void;
  removeMessage: (id: string) => void;
  /** oldId খুঁজে বদলায়; না পেলে upsert (duplicate-id গার্ডসহ) */
  replaceMessage: (oldId: string, message: ChatMessage) => void;
  updateMessage: (id: string, updater: (message: ChatMessage) => ChatMessage) => void;

  refetchConversations: () => Promise<void>;
  openConversation: (id: string | null) => Promise<void>;
  refreshActiveConversation: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
}

export const useChatStore = create<ChatStore>()((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  isLoadingDetail: false,
  isRunActive: false,

  draft: '',
  pendingAttachments: [],
  composerFocusSignal: 0,
  chatModel: typeof window !== 'undefined' ? loadChatModel() : '',

  setDraft: (value) => set({ draft: value }),
  setChatModel: (id) => {
    rememberChatModel(id);
    set({ chatModel: id });
  },
  addAttachments: (files) =>
    set((state) => ({ pendingAttachments: [...state.pendingAttachments, ...files] })),
  removeAttachment: (index) =>
    set((state) => ({
      pendingAttachments: state.pendingAttachments.filter((_, i) => i !== index),
    })),
  resetComposerInput: () => set({ draft: '', pendingAttachments: [] }),
  focusComposer: () => set((state) => ({ composerFocusSignal: state.composerFocusSignal + 1 })),

  setActiveId: (id) => {
    rememberActiveConversation(id);
    set({ activeId: id });
  },
  setMessages: (messages) => set({ messages }),
  setIsRunActive: (value) => set({ isRunActive: value }),
  appendMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  removeMessage: (id) =>
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
  replaceMessage: (oldId, message) =>
    set((state) => {
      const hasOld = state.messages.some((m) => m.id === oldId);
      if (hasOld) {
        return { messages: state.messages.map((m) => (m.id === oldId ? message : m)) };
      }
      // oldId নেই (কথোপকথন বদলানো/রিফ্রেশ হয়েছে) — duplicate হলে আপডেট, নাহলে append
      const hasNew = state.messages.some((m) => m.id === message.id);
      if (hasNew) {
        return { messages: state.messages.map((m) => (m.id === message.id ? message : m)) };
      }
      return { messages: [...state.messages, message] };
    }),
  updateMessage: (id, updater) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? updater(m) : m)),
    })),

  refetchConversations: async () => {
    try {
      const res = await fetch('/api/conversations');
      if (!res.ok) return;
      const data = (await res.json()) as ConversationSummary[];
      if (Array.isArray(data)) set({ conversations: data });
    } catch {
      // নীরব — সাইডবার সাময়িকভাবে খালি/পুরোনো থাকবে
    }
  },

  openConversation: async (id) => {
    rememberActiveConversation(id);
    set({ activeId: id, messages: [], isLoadingDetail: id != null });
    if (!id) return;
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) throw new Error('conversation fetch failed');
      const detail = (await res.json()) as ConversationDetail;
      if (get().activeId === id) set({ messages: detail.messages ?? [] });
    } catch {
      toast({ title: GENERIC_ERROR, variant: 'destructive' });
    } finally {
      if (get().activeId === id) set({ isLoadingDetail: false });
    }
  },

  refreshActiveConversation: async () => {
    const id = get().activeId;
    if (!id) return;
    try {
      const res = await fetch(`/api/conversations/${id}`);
      if (!res.ok) return;
      const detail = (await res.json()) as ConversationDetail;
      if (get().activeId === id) set({ messages: detail.messages ?? [] });
    } catch {
      // নীরব
    }
  },

  deleteConversation: async (id) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      set((state) => {
        if (state.activeId === id) rememberActiveConversation(null);
        return {
          conversations: state.conversations.filter((c) => c.id !== id),
          ...(state.activeId === id ? { activeId: null, messages: [] } : {}),
        };
      });
      void get().refetchConversations();
    } catch {
      toast({ title: GENERIC_ERROR, variant: 'destructive' });
    }
  },
}));
