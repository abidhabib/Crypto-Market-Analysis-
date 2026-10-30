'use client'

import { create } from 'zustand'
import type { TabId, TimeframeId } from './constants'

interface TerminalStore {
  symbol: string
  tab: TabId
  timeframe: TimeframeId
  railOpen: boolean
  setSymbol: (s: string) => void
  setTab: (t: TabId) => void
  setTimeframe: (t: TimeframeId) => void
  toggleRail: () => void
}

export const useTerminal = create<TerminalStore>((set) => ({
  symbol: 'BTCUSDT',
  tab: 'chart',
  timeframe: '1m',
  railOpen: true,
  setSymbol: (symbol) => set({ symbol }),
  setTab: (tab) => set({ tab }),
  setTimeframe: (timeframe) => set({ timeframe }),
  toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),
}))
