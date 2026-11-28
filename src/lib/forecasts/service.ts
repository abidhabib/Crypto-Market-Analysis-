import { randomUUID } from 'node:crypto'
import { barsValid, closedBars } from '../signals/engine.ts'
import { eligibleMarket, liquidationHeatmap, mapConcurrent, provider } from '../signals/providers.ts'
import { repository } from '../signals/repository.ts'
import { applyFunding, bucketStats, forecast, HOUR, STEP, trackForecast } from './engine.ts'
import type { Exchange } from '../signals/types.ts'
import type { Forecast, ForecastBucket, ForecastDashboard, ForecastScan, MarketType } from './types.ts'

const message = (e: unknown) => e instanceof Error ? e.message : 'Forecast data unavailable'
export const forecastsEnabled = () => process.env.SIGNALS_ENABLED !== '0' && process.env.FORECASTS_ENABLED !== '0'
const globals = globalThis as typeof globalThis & { forecastWorker?: { busy: boolean; timer: ReturnType<typeof setInterval>; error: string | null } }

export async function runForecastCycle() {
  const repo = repository(), owner = randomUUID(), lease = 'forecasts'
  if (!await repo.acquire(owner, Date.now(), lease)) return
  let lost = false
  const heartbeat = setInterval(() => { void repo.acquire(owner, Date.now(), lease).then(ok => { if (!ok) lost = true }).catch(() => { lost = true }) }, 30_000)
  const check = () => { if (lost) throw new Error('Forecast lease lost') }
  try {
    const pending = await repo.pendingForecasts()
    // Coalesce overlapping hourly forecasts into a single bounded candle request per instrument.
    const groups = new Map<string, Forecast[]>()
    for (const f of pending) { const key = `${f.exchange}:${f.marketType}:${f.symbol}`; groups.set(key, [...(groups.get(key) ?? []), f]) }
    await mapConcurrent([...groups.values()], 3, async records => {
      check()
      const feed = provider(records[0].exchange, records[0].marketType)
      const unsettled = records.filter(f => f.tracking.settledAt == null)
      const start = Math.min(...unsettled.map(f => f.tracking.lastBarAt + STEP))
      let bars: Awaited<ReturnType<typeof feed.bars>> = [], candleError: string | null = null
      if (unsettled.length && start + STEP <= Date.now()) {
        try { bars = await feed.bars(records[0].symbol, '5m', start, Math.min(Date.now(), start + 1000 * STEP - 1)) }
        catch (e) { candleError = message(e) }
      }
      for (const original of records) {
        let f = original
        try {
          if (f.tracking.settledAt == null) {
            if (candleError) throw new Error(candleError)
            f = trackForecast(f, bars, Date.now())
          }
          const t = f.tracking.trade
          // Allow exchange publication lag before finalizing funding. Failures remain pending.
          if (f.marketType === 'futures' && t.beforeFundingPct != null && t.netPct == null && t.exitAt != null && Date.now() >= t.exitAt + 300_000) {
            f = applyFunding(f, await feed.fundingHistory(f.symbol, t.entryAt!, t.exitAt))
            if (f.tracking.settledAt != null) f.tracking.error = null
          }
        } catch (e) { f.tracking.error = message(e) }
        check(); await repo.saveForecast(f)
      }
    })
    for (const marketType of ['spot', 'futures'] as const) {
      check()
      const now = Date.now(), slot = Math.floor(now / HOUR) * HOUR, previous = await repo.forecastScan(marketType)
      if (previous?.slot === slot && (previous.status === 'complete' || now - previous.startedAt < 300_000)) continue
      const report: ForecastScan = { marketType, slot, startedAt: now, finishedAt: null, exchange: null, status: 'running', eligible: 0, selected: 0, saved: 0, errors: [] }
      await repo.saveForecastScan(report)
      try {
        const setting = process.env.SIGNALS_EXCHANGE ?? 'auto'
        const exchanges: Exchange[] = setting === 'binance' ? ['binance'] : setting === 'bybit' ? ['bybit'] : ['binance', 'bybit']
        let selection: { feed: ReturnType<typeof provider>; markets: Awaited<ReturnType<ReturnType<typeof provider>['markets']>>; btc: Awaited<ReturnType<ReturnType<typeof provider>['bars']>> } | null = null
        const failures: string[] = []
        for (const exchange of exchanges) {
          try {
            const feed = provider(exchange, marketType)
            const [markets, btc] = await Promise.all([feed.markets(), feed.bars('BTCUSDT', '4h')])
            if (!markets.length) throw new Error('Empty instrument universe')
            if (!barsValid(closedBars(btc, 4 * HOUR, Date.now()), 4 * HOUR, Date.now(), 220)) throw new Error('BTC context stale or incomplete')
            selection = { feed, markets, btc }; break
          } catch (e) { failures.push(`${exchange}: ${message(e)}`) }
        }
        if (!selection) throw new Error(failures.join('; '))
        const { feed, markets, btc } = selection
        report.exchange = feed.exchange
        const eligible = markets.filter(m => eligibleMarket(m, 5_000_000)).sort((a, b) => b.turnover - a.turnover || a.symbol.localeCompare(b.symbol))
        report.eligible = eligible.length
        const configured = Number(process.env.FORECASTS_MARKET_LIMIT ?? 20)
        const limit = Number.isInteger(configured) && configured > 0 ? Math.min(50, configured) : 20
        const selected = eligible.slice(0, limit); report.selected = selected.length
        const existing = new Set((await repo.forecasts(marketType, slot)).filter(f => f.slot === slot).map(f => f.symbol))
        await mapConcurrent(selected, 3, async market => {
          check()
          if (existing.has(market.symbol)) { report.saved++; return }
          try {
            const [h4, h1, m15] = await Promise.all([feed.bars(market.symbol, '4h'), feed.bars(market.symbol, '1h'), feed.bars(market.symbol, '15m')])
            const [book, derivatives, heatmap] = await Promise.allSettled([feed.book(market.symbol), marketType === 'futures' ? feed.derivatives(market.symbol) : Promise.resolve(undefined), liquidationHeatmap(feed.exchange, market.symbol)])
            // Never backdate a forecast into the scheduled hour if fetching crossed its boundary.
            const f = forecast({ exchange: feed.exchange, marketType, market, at: Date.now(), bars: { '4h': h4, '1h': h1, '15m': m15 }, btc,
              book: book.status === 'fulfilled' ? book.value : undefined, derivatives: derivatives.status === 'fulfilled' ? derivatives.value : undefined,
              heatmap: heatmap.status === 'fulfilled' ? heatmap.value : undefined, requireHeatmap: process.env.SIGNALS_REQUIRE_HEATMAP === '1' })
            for (const result of [book, derivatives, heatmap]) if (result.status === 'rejected') {
              const error = `${market.symbol}: ${message(result.reason)}`; f.coverage.push(error); report.errors.push(error)
            }
            check(); if (await repo.insertForecast(f)) report.saved++
          } catch (e) { report.errors.push(`${market.symbol}: ${message(e)}`) }
        })
        report.status = report.errors.length || !selected.length ? 'partial' : 'complete'
      } catch (e) { report.status = 'error'; report.errors.push(message(e)) }
      report.finishedAt = Date.now(); check(); await repo.saveForecastScan(report)
    }
  } finally { clearInterval(heartbeat); await repo.release(owner, lease) }
}

export function startForecastWorker() {
  if (!forecastsEnabled() || globals.forecastWorker) return
  const state = { busy: false, timer: undefined as unknown as ReturnType<typeof setInterval>, error: null as string | null }
  const tick = async () => {
    if (state.busy) return
    state.busy = true
    try { await runForecastCycle(); state.error = null } catch (e) { state.error = message(e); console.error('[forecasts]', state.error) }
    finally { state.busy = false }
  }
  state.timer = setInterval(() => { void tick() }, 30_000); state.timer.unref()
  globals.forecastWorker = state; void tick()
}

export async function forecastDashboard(marketType: MarketType, days = 30, page = 0): Promise<ForecastDashboard> {
  const repo = repository(), now = Date.now(), since = Math.floor(now / 86400_000) * 86400_000 - (days - 1) * 86400_000
  const [buckets, history, latest, scan] = await Promise.all([repo.forecastBuckets(marketType, since), repo.forecastPage(marketType, since, page), repo.latestForecasts(marketType), repo.forecastScan(marketType)])
  const groups = new Map<string, ForecastBucket[]>()
  for (const row of buckets) groups.set(row.day, [...(groups.get(row.day) ?? []), row])
  const stats = bucketStats(buckets)
  return { enabled: forecastsEnabled(), serverAt: now, marketType, scan, latest, history, historyTotal: stats.total, stats,
    periods: [...groups.entries()].map(([day, list]) => ({ day, stats: bucketStats(list) })), error: globals.forecastWorker?.error ?? null }
}
