export type Exchange = 'binance' | 'bybit'
export type Timeframe = '5m' | '15m' | '1h' | '4h'
export const INTERVAL_MS: Record<Timeframe, number> = { '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 }
export interface Bar { t: number; o: number; h: number; l: number; c: number; v: number; quote?: number; buy?: number }
export interface Market { symbol: string; base: string; price: number; turnover: number; change: number; tick: number; step: number; minNotional: number }
export interface Derivatives { at: number; funding: number; oi: number; oiChange: number; longShortRatio: number }
export interface Book { at: number; bid: number; ask: number; bidUsd: number; askUsd: number }
export interface Heatmap { at: number; source: string; clusters: { price: number; usd: number; side: 'long' | 'short' }[] }
export interface AnalysisInput {
  exchange: Exchange; market: Market; at: number
  bars: Record<Timeframe, Bar[]>; btc: Bar[]; eth: Bar[]
  derivatives?: Derivatives; book?: Book; heatmap?: Heatmap
}
export interface Policy {
  version: string; minScore: number; minTurnover: number; maxSpreadBps: number
  feeBps: number; slippageBps: number; riskPct: number; equity: number
  minRR: number; requireHeatmap: boolean; mode: 'paper' | 'technical-backtest'
}
export const DEFAULT_POLICY: Policy = {
  version: 'spot-confluence-v1', minScore: 85, minTurnover: 5_000_000, maxSpreadBps: 15,
  feeBps: 10, slippageBps: 5, riskPct: 1, equity: 10_000, minRR: 2,
  requireHeatmap: false, mode: 'paper',
}
export interface Check { key: string; label: string; pass: boolean; required: boolean; points: number; max: number; detail: string }
export interface Zone { price: number; low: number; high: number; touches: number }
export interface Plan {
  entry: number; stop: number; targets: [number, number, number]; rr: number
  quantity: number; notional: number; riskUsd: number; equity: number; riskPct: number
  feeBps: number; slippageBps: number; expiresAt: number; closeBy: number
}
export interface Analysis {
  exchange: Exchange; symbol: string; at: number; candleAt: number; price: number
  decision: 'BUY' | 'NO SIGNAL'; setup: 'support-reclaim' | 'breakout-retest' | null
  score: number; checks: Check[]; blockers: string[]; support: Zone | null; resistance: Zone | null
  metrics: Record<string, number | string | null>; coverage: string[]; plan: Plan | null; version: string
}
export type TradeStatus = 'PENDING' | 'OPEN' | 'WON' | 'LOST' | 'BREAKEVEN' | 'EXPIRED' | 'INVALIDATED'
export interface TradeEvent { at: number; kind: string; price: number | null; detail: string }
export interface SignalRecord {
  id: string; mode: Policy['mode']; exchange: Exchange; symbol: string; generatedAt: number
  status: TradeStatus; analysis: Analysis; plan: Plan; filledAt: number | null; fill: number | null
  closedAt: number | null; lastBarAt: number; remaining: number; proceeds: number; pnl: number | null
  r: number | null; targetsHit: number; events: TradeEvent[]; trackingError: string | null
}
export interface ScanReport {
  id: string; startedAt: number; finishedAt: number | null; exchange: Exchange | null
  status: 'running' | 'complete' | 'partial' | 'error'; universe: number; eligible: number; analyzed: number
  emitted: number; filtered: number; errors: number; message: string; candidates: Analysis[]
}
export interface Performance {
  total: number; won: number; lost: number; breakeven: number; pending: number; open: number
  expired: number; invalidated: number; winRate: number | null; profitFactor: number | null
  netPnl: number; expectancyR: number | null; maxDrawdown: number; closed: number
}
export interface SignalDashboard {
  enabled: boolean; serverAt: number; lastScan: ScanReport | null; policy: Policy
  active: SignalRecord[]; history: SignalRecord[]; historyTotal: number
  performance: Performance; periods: { period: string; stats: Performance }[]
  failures: { reason: string; count: number }[]; error: string | null
  backtests: import('./backtest.ts').BacktestSummary[]
}
