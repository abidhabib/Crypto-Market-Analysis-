import { analyze, closedBars } from './engine.ts'
import { createSignal, isActive, performance, periodStats, trackSignal } from './tracking.ts'
import { DEFAULT_POLICY, INTERVAL_MS } from './types.ts'
import type { AnalysisInput, Bar, Market, Policy, SignalRecord, Timeframe } from './types.ts'

export interface HistoricalDataset {
  exchange: AnalysisInput['exchange']; market: Market; from: number; to: number
  bars: AnalysisInput['bars']; btc: Bar[]; eth: Bar[]
}

/** Binary search keeps a year's replay from repeatedly filtering a year's candles. */
export function windowAt(bars: Bar[], interval: number, at: number, limit = 260): Bar[] {
  let lo = 0, hi = bars.length
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].t + interval <= at) lo = mid + 1; else hi = mid }
  return bars.slice(Math.max(0, lo - limit), lo)
}

export function backtest(dataset: HistoricalDataset, overrides: Partial<Policy> = {}) {
  const policy: Policy = { ...DEFAULT_POLICY, ...overrides, mode: 'technical-backtest', requireHeatmap: false }
  // Positioning contributes no historical points. 85 remains the threshold out of the original 100.
  const trades: SignalRecord[] = []
  const seen = new Set<string>()
  let open: SignalRecord | null = null, evaluations = 0, dataFailures = 0
  const bars = Object.fromEntries(Object.entries(dataset.bars).map(([tf, rows]) => [tf, closedBars(rows, INTERVAL_MS[tf as Timeframe], dataset.to)])) as AnalysisInput['bars']
  const btc = closedBars(dataset.btc, INTERVAL_MS['4h'], dataset.to), eth = closedBars(dataset.eth, INTERVAL_MS['4h'], dataset.to)
  for (const bar of bars['5m']) {
    const at = bar.t + INTERVAL_MS['5m']
    if (at < dataset.from || at > dataset.to) continue
    if (open) {
      open = trackSignal(open, [bar], at)
      if (!isActive(open)) { trades.push(open); open = null }
    }
    if (open || at % INTERVAL_MS['15m']) continue
    const frames = Object.fromEntries(Object.entries(bars).map(([tf, rows]) => [tf, windowAt(rows, INTERVAL_MS[tf as Timeframe], at)])) as AnalysisInput['bars']
    // Historical turnover/change come exclusively from candles known at the playhead.
    const day = windowAt(bars['5m'], INTERVAL_MS['5m'], at, 288)
    const market: Market = { ...dataset.market, price: bar.c, turnover: day.reduce((s, b) => s + (b.quote ?? b.c * b.v), 0), change: day.length ? bar.c / day[0].o - 1 : 0 }
    const analysis = analyze({ exchange: dataset.exchange, market, at, bars: frames,
      btc: windowAt(btc, INTERVAL_MS['4h'], at), eth: windowAt(eth, INTERVAL_MS['4h'], at) }, policy)
    evaluations++
    if (!analysis.checks[0]?.pass) dataFailures++
    if (analysis.decision === 'BUY') {
      const signal = createSignal(analysis, policy)
      if (!seen.has(signal.id)) { seen.add(signal.id); open = signal }
    }
  }
  if (open) trades.push(open) // Open positions remain unsettled at the end of the requested range.
  return {
    id: `technical:${dataset.exchange}:${dataset.market.symbol}:${dataset.from}:${dataset.to}:${Date.now()}`,
    generatedAt: Date.now(), mode: 'technical-backtest' as const, exchange: dataset.exchange, symbol: dataset.market.symbol,
    from: dataset.from, to: dataset.to, policy, evaluations, dataFailures,
    performance: performance(trades), periods: periodStats(trades, 'month'), trades,
    limitations: [
      'Technical-only historical baseline; not verification of the full live scanner.',
      'No historical order book, OI, funding, account ratio, liquidation heatmap, news or BTC dominance.',
      'Current instrument tick/lot rules; selected-symbol survivorship bias. Not a historical whole-universe study.',
      'OHLC paper execution with conservative stop-first ambiguity, fees and slippage. No real executions.',
      'Fixed reference account per trade; no compounding. Drawdown uses settled equity only.',
    ],
  }
}
export type BacktestSummary = Omit<ReturnType<typeof backtest>, 'trades'>
