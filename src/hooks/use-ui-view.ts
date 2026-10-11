'use client';

// UI ভিউ-সুইচিং (চ্যাট / গ্যালারি / প্রোডাকশন / রেজিস্ট্রি / গাইড)
import { create } from 'zustand';
import type { AppView } from '@/lib/types';

interface UiViewStore {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
}

export const useUiView = create<UiViewStore>()(set => ({
  activeView: 'chat',
  setActiveView: view => set({ activeView: view }),
}));
