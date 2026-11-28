import { randomUUID } from 'node:crypto'
import { analyze, barsValid, closedBars, indicators, zones } from './engine.ts'
import { eligibleMarket, liquidationHeatmap, mapConcurrent, provider } from './providers.ts'
import { repository } from './repository.ts'
import { createSignal, failureSummary, performance, periodStats, trackSignal } from './tracking.ts'
import { DEFAULT_POLICY, INTERVAL_MS } from './types.ts'
import type { AnalysisInput, Exchange, Policy, ScanReport, SignalDashboard } from './types.ts'

export function getPolicy(): Policy {
  const equity = Number(process.env.SIGNALS_PAPER_EQUITY ?? DEFAULT_POLICY.equity)
  return { ...DEFAULT_POLICY, equity: Number.isFinite(equity) && equity > 0 ? equity : DEFAULT_POLICY.equity,
    requireHeatmap: process.env.SIGNALS_REQUIRE_HEATMAP === '1' }
}
export const enabled = () => process.env.SIGNALS_ENABLED !== '0'
const message = (e: unknown) => e instanceof Error ? e.message : 'Unknown market-data error'

export async function runCycle() {
  const repo = repository(), owner = randomUUID()
  if (!await repo.acquire(owner, Date.now())) return
  let leaseLost = false
  const heartbeat = setInterval(() => { void repo.acquire(owner, Date.now()).then(ok => { if (!ok) leaseLost = true }).catch(() => { leaseLost = true }) }, 30_000)
  const checkLease = () => { if (leaseLost) throw new Error('Scanner lease lost; work stopped') }
  try {
    // Tracking keeps using each signal's original exchange, including after provider failover.
    const active = await repo.active()
    await mapConcurrent(active, 3, async s => {
      checkLease()
      try {
        const start = s.lastBarAt + INTERVAL_MS['5m']
        if (start + INTERVAL_MS['5m'] > Date.now()) return
        const end = Math.min(Date.now(), start + 1000 * INTERVAL_MS['5m'] - 1)
        const bars = await provider(s.exchange).bars(s.symbol, '5m', start, end)
        const updated = trackSignal(s, bars, Date.now())
        if (updated.lastBarAt === s.lastBarAt && !updated.trackingError) updated.trackingError = 'No new closed candles available; tracking waits for exchange coverage'
        checkLease(); await repo.save(updated)
      } catch (e) { s.trackingError = message(e); checkLease(); await repo.save(s) }
    })
    const previous = await repo.lastScan()
    if (previous && Date.now() - previous.startedAt < 300_000) return
    const startedAt = Date.now(), policy = getPolicy()
    policy.equity = Math.max(0, policy.equity + await repo.realizedPnl())
    const report: ScanReport = { id: randomUUID(), startedAt, finishedAt: null, exchange: null, status: 'running', universe: 0,
      eligible: 0, analyzed: 0, emitted: 0, filtered: 0, errors: 0, message: 'Loading markets', candidates: [] }
    await repo.saveScan(report)
    try {
      const setting = process.env.SIGNALS_EXCHANGE ?? 'auto'
      const exchanges: Exchange[] = setting === 'bybit' ? ['bybit'] : setting === 'binance' ? ['binance'] : ['binance', 'bybit']
      let selection: { feed: ReturnType<typeof provider>; markets: Awaited<ReturnType<ReturnType<typeof provider>['markets']>>; btc: AnalysisInput['btc']; eth: AnalysisInput['eth'] } | null = null
      const failures: string[] = []
      for (const exchange of exchanges) {
        try {
          const feed = provider(exchange)
          const [markets, btc, eth] = await Promise.all([feed.markets(), feed.bars('BTCUSDT', '4h'), feed.bars('ETHUSDT', '4h')])
          if (!markets.length) throw new Error('Empty market universe')
          if (![btc, eth].every(b => barsValid(closedBars(b, INTERVAL_MS['4h'], Date.now()), INTERVAL_MS['4h'], Date.now(), 220))) throw new Error('BTC/ETH context stale or incomplete')
          selection = { feed, markets, btc, eth }; break
        } catch (e) { failures.push(`${exchange}: ${message(e)}`) }
      }
      if (!selection) throw new Error(failures.join('; '))
      const { feed, markets, btc, eth } = selection
      report.exchange = feed.exchange; report.universe = markets.length
      const eligible = markets.filter(m => eligibleMarket(m, policy.minTurnover)).sort((a, b) => b.turnover - a.turnover)
      report.eligible = eligible.length; report.filtered = markets.length - eligible.length
      report.message = failures.length ? `Failover to ${feed.exchange}. ${failures.join('; ')}` : 'Scanning eligible markets'
      await repo.saveScan(report)
      let lastSaved = Date.now()
      const positions = await repo.active()
      // Reserved capital includes pending orders. A fixed paper account cannot spend the same cash twice.
      const capital = (p: { notional: number; feeBps: number; slippageBps: number }) => p.notional * (1 + p.feeBps / 10000) * (1 + p.slippageBps / 10000)
      let reserved = positions.reduce((s, p) => s + capital(p.plan), 0)
      let risk = positions.reduce((s, p) => s + p.plan.riskUsd, 0)
      const occupied = new Set(positions.map(s => s.symbol))
      await mapConcurrent(eligible, 4, async market => {
        checkLease()
        try {
          const h4 = await feed.bars(market.symbol, '4h'), closed = closedBars(h4, INTERVAL_MS['4h'], Date.now())
          report.analyzed++
          if (!barsValid(closed, INTERVAL_MS['4h'], Date.now(), 220)) { report.filtered++; report.errors++; return }
          const h = indicators(closed), last = closed.at(-1)!
          // Cheap first stage avoids four more timeframes/derivatives requests for obvious non-candidates.
          const near = [...zones(closed.slice(-120, -3), h.atr * 0.35, 'support'), ...zones(closed.slice(-120, -3), h.atr * 0.35, 'resistance')]
            .some(z => z.touches >= 2 && Math.abs(last.c - z.price) <= 2 * h.atr)
          if (last.c < h.ema200 || h.ema20 < h.ema50 || !near) { report.filtered++; return }
          const [h1, m15, m5] = await Promise.all([feed.bars(market.symbol, '1h'), feed.bars(market.symbol, '15m'), feed.bars(market.symbol, '5m')])
          const [book, derivatives, heatmap] = await Promise.allSettled([feed.book(market.symbol), feed.derivatives(market.symbol), liquidationHeatmap(feed.exchange, market.symbol)])
          const input: AnalysisInput = { exchange: feed.exchange, market: { ...market, price: m5.at(-1)?.c ?? market.price }, at: Date.now(),
            bars: { '4h': h4, '1h': h1, '15m': m15, '5m': m5 }, btc, eth,
            book: book.status === 'fulfilled' ? book.value : undefined,
            derivatives: derivatives.status === 'fulfilled' ? derivatives.value : undefined,
            heatmap: heatmap.status === 'fulfilled' ? heatmap.value : undefined }
          const analysis = analyze(input, policy)
          const dataErrors = [book, derivatives, heatmap].filter(r => r.status === 'rejected')
          if (dataErrors.length) report.errors++
          analysis.coverage.push(...dataErrors.map(r => `Unavailable: ${message((r as PromiseRejectedResult).reason)}`))
          const plan = analysis.plan
          if (analysis.decision === 'BUY' && plan) {
            const fits = !occupied.has(market.symbol) && reserved + capital(plan) <= policy.equity && risk + plan.riskUsd <= policy.equity * 0.03
            if (fits) {
              // Reserve synchronously before await so concurrent candidates cannot exceed the cap.
              reserved += capital(plan); risk += plan.riskUsd; occupied.add(market.symbol)
              checkLease()
              if (await repo.insert(createSignal(analysis, policy))) report.emitted++
            } else {
              analysis.decision = 'NO SIGNAL'; analysis.blockers.push('Existing position or paper account capital / 3% portfolio risk limit')
            }
          }
          report.candidates.push(analysis)
          report.candidates.sort((a, b) => b.score - a.score)
          report.candidates = report.candidates.slice(0, 30)
          if (Date.now() - lastSaved > 10_000) { lastSaved = Date.now(); checkLease(); await repo.saveScan(report) }
        } catch (e) { report.errors++; report.message = message(e) }
      })
      checkLease()
      report.status = report.errors ? 'partial' : 'complete'
      report.message = `${report.analyzed}/${report.eligible} eligible markets screened; ${report.emitted} new paper signals. ${report.errors ? `${report.errors} markets had data errors.` : ''}${failures.length ? ` Provider failover: ${failures.join('; ')}` : ''}`
    } catch (e) { report.status = 'error'; report.message = message(e) }
    report.finishedAt = Date.now()
    checkLease(); await repo.saveScan(report)
  } finally { clearInterval(heartbeat); await repo.release(owner) }
}

type Worker = { timer: ReturnType<typeof setInterval>; busy: boolean; error: string | null }
const globals = globalThis as typeof globalThis & { signalWorker?: Worker }
export function startSignalWorker() {
  if (!enabled() || globals.signalWorker) return
  const state: Worker = { timer: undefined as unknown as ReturnType<typeof setInterval>, busy: false, error: null }
  const tick = async () => {
    if (state.busy) return
    state.busy = true
    try { await runCycle(); state.error = null }
    catch (e) { state.error = message(e); console.error('[signals]', state.error) }
    finally { state.busy = false }
  }
  state.timer = setInterval(() => { void tick() }, 30_000)
  state.timer.unref()
  globals.signalWorker = state
  void tick()
}

export async function dashboard(days = 30, grouping: 'day' | 'week' | 'month' = 'day', page = 0): Promise<SignalDashboard> {
  const repo = repository(), now = Date.now()
  const since = Math.floor(now / 86400_000) * 86400_000 - (days - 1) * 86400_000
  const [all, active, lastScan, backtests] = await Promise.all([repo.history(since), repo.active(), repo.lastScan(), repo.backtests()])
  return { enabled: enabled(), serverAt: now, lastScan, policy: getPolicy(), active,
    history: all.slice(page * 25, (page + 1) * 25), historyTotal: all.length,
    performance: performance(all), periods: periodStats(all, grouping), failures: failureSummary(all), backtests, error: globals.signalWorker?.error ?? null }
}
