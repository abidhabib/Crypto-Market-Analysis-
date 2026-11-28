import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('worker records both markets, resumes persisted outcomes, and never rewrites or duplicates forecasts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forecast-worker-'))
  const originalFetch = globalThis.fetch, originalNow = Date.now
  const oldEnv = { database: process.env.SIGNALS_DATABASE_URL, exchange: process.env.SIGNALS_EXCHANGE, limit: process.env.FORECASTS_MARKET_LIMIT }
  process.env.SIGNALS_DATABASE_URL = `file:${join(dir, 'test.db')}`
  process.env.SIGNALS_EXCHANGE = 'binance'; process.env.FORECASTS_MARKET_LIMIT = '1'
  let now = 500 * 14400000 + 1000
  const initial = now
  Date.now = () => now
  globalThis.fetch = async url => {
    const u = new URL(url), p = u.pathname, futures = u.host.startsWith('fapi'), price = futures ? 200 : 100
    if (p.endsWith('/exchangeInfo')) return Response.json({ symbols: [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', marginAsset: 'USDT', contractType: 'PERPETUAL', status: 'TRADING',
      filters: [{ filterType: 'PRICE_FILTER', tickSize: '.01' }, { filterType: 'LOT_SIZE', stepSize: '.001' }, { filterType: futures ? 'MIN_NOTIONAL' : 'NOTIONAL', notional: '5', minNotional: '5' }] }] })
    if (p.endsWith('/ticker/24hr')) return Response.json([{ symbol: 'BTCUSDT', lastPrice: String(price), quoteVolume: '100000000', priceChangePercent: '1' }])
    if (p.endsWith('/klines')) {
      const step = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 }[u.searchParams.get('interval')]
      const start = u.searchParams.has('startTime') ? Number(u.searchParams.get('startTime')) : Math.floor(now / step) * step - 260 * step
      const end = u.searchParams.has('endTime') ? Number(u.searchParams.get('endTime')) : now
      const count = Math.min(1000, Math.floor((end - start) / step))
      return Response.json(Array.from({ length: count }, (_, i) => {
        const c = u.searchParams.has('startTime') ? price + 2 : price - 3 + i * .01
        return [start + i * step, String(c - .05), String(c + .1), String(c - .1), String(c), '100000', 0, '10000000', 0, '60000']
      }))
    }
    if (p.endsWith('/depth')) return Response.json({ bids: [[String(price - .01), '100000']], asks: [[String(price + .01), '100000']] })
    if (p.endsWith('/premiumIndex')) return Response.json({ time: now, lastFundingRate: '.0001' })
    if (p.endsWith('/openInterestHist')) return Response.json([{ timestamp: now - 300000, sumOpenInterest: '100000' }, { timestamp: now, sumOpenInterest: '101000' }])
    if (p.endsWith('/globalLongShortAccountRatio')) return Response.json([{ timestamp: now, longShortRatio: '1' }])
    throw new Error(`Unexpected endpoint ${p}`)
  }
  const { runForecastCycle, forecastDashboard } = await import('../src/lib/forecasts/service.ts')
  const { repository } = await import('../src/lib/signals/repository.ts')
  try {
    await runForecastCycle()
    const originals = {}
    for (const type of ['spot', 'futures']) {
      const d = await forecastDashboard(type, 1)
      assert.equal(d.scan.status, 'complete'); assert.equal(d.latest.length, 1); assert.equal(d.stats.pending, 1)
      originals[type] = d.latest[0]
    }
    assert.notEqual(originals.spot.referencePrice, originals.futures.referencePrice)
    await runForecastCycle()
    assert.equal((await repository().pendingForecasts()).length, 2)
    // A process restart reconnects to the ledger; a later cycle catches up all original bars.
    await repository().close(); delete globalThis.signalRepository
    now = initial + 5 * 3600000
    await runForecastCycle()
    for (const type of ['spot', 'futures']) {
      const records = await repository().forecasts(type, 0)
      assert.equal(records.length, 2)
      const old = records.find(f => f.id === originals[type].id)
      assert.ok(old.tracking.settledAt); assert.equal(old.tracking.error, null)
      const { tracking: _old, ...prediction } = old
      const { tracking: _original, ...expected } = originals[type]
      assert.deepEqual(prediction, expected)
      const d = await forecastDashboard(type, 1)
      assert.equal(d.stats.settled, 1); assert.equal(d.stats.pending, 1); assert.equal(d.historyTotal, 2)
    }
  } finally {
    await repository().close(); delete globalThis.signalRepository
    globalThis.fetch = originalFetch; Date.now = originalNow
    for (const [key, value] of [['SIGNALS_DATABASE_URL', oldEnv.database], ['SIGNALS_EXCHANGE', oldEnv.exchange], ['FORECASTS_MARKET_LIMIT', oldEnv.limit]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    await rm(dir, { recursive: true, force: true })
  }
})
