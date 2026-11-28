import type { Bar, Book, Derivatives, Exchange, Heatmap, Market } from '../signals/types.ts'

export type MarketType = 'spot' | 'futures'
export type Direction = 'UP' | 'DOWN' | 'NEUTRAL'
export interface ForecastInput {
  exchange: Exchange; marketType: MarketType; market: Market; at: number
  bars: { '4h': Bar[]; '1h': Bar[]; '15m': Bar[] }; btc: Bar[]
  book?: Book; derivatives?: Derivatives; heatmap?: Heatmap; requireHeatmap?: boolean
}
export interface ForecastPlan {
  side: 'LONG' | 'SHORT'; entryLow: number; entryHigh: number; stop: number; target: number
  feeBps: number; slippageBps: number; step: number; minNotional: number
  riskBudget: number; maxNotional: number
}
export interface ForecastTracking {
  lastBarAt: number; baseline: number | null; endPrice: number | null; returnPct: number | null
  actual: Direction | null; correct: boolean | null; settledAt: number | null; error: string | null
  trade: {
    status: 'NONE' | 'PENDING' | 'OPEN' | 'SKIPPED' | 'TARGET' | 'STOP' | 'TIMEOUT'
    entry: number | null; entryAt: number | null; exit: number | null; exitAt: number | null; quantity: number | null
    beforeFundingPct: number | null; fundingPct: number | null; netPct: number | null
    fundingStatus: 'NOT_APPLICABLE' | 'PENDING' | 'RECORDED' | 'ESTIMATED'; detail: string
  }
}
export interface Forecast {
  id: string; version: string; exchange: Exchange; marketType: MarketType; symbol: string
  issuedAt: number; slot: number; startsAt: number; endsAt: number; referencePrice: number
  neutralBandPct: number; direction: Direction; stance: 'BUY' | 'SELL / AVOID' | 'LONG' | 'SHORT' | 'NEUTRAL'
  action: 'PAPER ENTRY' | 'WAIT' | 'AVOID'; score: number; evidence: { label: string; vote: number; detail: string }[]
  blockers: string[]; coverage: string[]; plan: ForecastPlan | null; tracking: ForecastTracking
}
export interface ForecastScan {
  marketType: MarketType; slot: number; startedAt: number; finishedAt: number | null; exchange: Exchange | null
  status: 'running' | 'complete' | 'partial' | 'error'; eligible: number; selected: number; saved: number; errors: string[]
}
export interface ForecastStats {
  total: number; settled: number; pending: number; delayed: number; correct: number
  accuracy: number | null; directionalTotal: number; directionalCorrect: number; directionalAccuracy: number | null
  neutralTotal: number; neutralCorrect: number; baselineAccuracy: number | null
  byDirection: { direction: Direction; total: number; correct: number; accuracy: number | null }[]
  confusion: Record<Direction, Record<Direction, number>>
  trades: number; wins: number; tradeWinRate: number | null; meanNetPct: number | null; pendingFunding: number
}
export interface ForecastBucket {
  day: string; direction: Direction; actual: Direction | null; total: number; delayed: number
  trades: number; wins: number; netSum: number; pendingFunding: number
}
export interface ForecastDashboard {
  enabled: boolean; serverAt: number; marketType: MarketType; scan: ForecastScan | null
  latest: Forecast[]; history: Forecast[]; historyTotal: number; stats: ForecastStats
  periods: { day: string; stats: ForecastStats }[]; error: string | null
}
