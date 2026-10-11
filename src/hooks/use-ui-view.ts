'use client';

// UI ভিউ-সুইচিং (চ্যাট / স্টুডিও / গ্যালারি / প্রোডাকশন / রেজিস্ট্রি / গাইড)
// 'studio' — AppView-এ ইতিমধ্যে সংজ্ঞায়িত (types.ts), তাই zustand-স্টোরে
// আলাদা কিছু যোগ করা লাগে না; লেবেল/আইকন-ম্যাপ sidebar.tsx-এর VIEWS-এ।
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
