import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forecast, trackForecast, applyFunding, bucketStats, forecastStats, STEP, HOUR } from '../src/lib/forecasts/engine.ts'
import { INTERVAL_MS } from '../src/lib/signals/types.ts'
import { SignalRepository } from '../src/lib/signals/repository.ts'
import { provider } from '../src/lib/signals/providers.ts'

const at = 300 * INTERVAL_MS['4h'] + 1000
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 100000 })
function input(down = false, marketType = 'futures') {
  const series = (tf, fn) => Array.from({ length: 260 }, (_, i) => {
    const c = fn(i); return bar(at - 1000 - (260 - i) * INTERVAL_MS[tf], c - .1, c + .15, c - .2, c)
  })
  const h4 = series('4h', i => i < 140 ? 60 + i * .25 : 100 + (i - 140) * .002)
  for (const b of h4) { b.h = b.c + .35; b.l = b.c - .35 }
  for (const i of [180, 210, 240]) h4[i].l = 99.4
  const h1 = series('1h', i => 95 + i * .01 + i * i * .00003)
  const m15 = series('15m', i => 96 + i * .01 + i * i * .00002)
  Object.assign(m15[259], { l: 99.3, v: 200000 })
  const btc = series('4h', i => 100 + i * .1 + i * i * .0001)
  if (down) for (const rows of [h4, h1, m15, btc]) for (const b of rows) {
    const { o, h, l, c } = b; Object.assign(b, { o: 200 - o, h: 200 - l, l: 200 - h, c: 200 - c })
  }
  const p = m15.at(-1).c
  return { at, exchange: 'binance', marketType, market: { symbol: 'TESTUSDT', base: 'TEST', price: p, tick: .01, step: .001, minNotional: 5, turnover: 1e8, change: .01 },
    bars: { '4h': h4, '1h': h1, '15m': m15 }, btc,
    book: { at, bid: p - .01, ask: p + .01, bidUsd: 100000, askUsd: 100000 },
    derivatives: { at, funding: .0001, oi: 1e6, oiChange: 1, longShortRatio: 1 } }
}
function planned(side = 'LONG', marketType = 'futures') {
  const f = forecast(input(side === 'SHORT', marketType))
  f.plan = { side, entryLow: 99, entryHigh: 101, stop: side === 'LONG' ? 98 : 102, target: side === 'LONG' ? 106 : 94,
    feeBps: 5, slippageBps: 5, step: .001, minNotional: 5, riskBudget: 100, maxNotional: 1000 }
  f.tracking.trade.status = 'PENDING'
  return f
}

test('symmetric confirmed setups produce futures LONG and SHORT, spot has no borrowed short', () => {
  for (const down of [false, true]) {
    const f = forecast(input(down))
    assert.equal(f.direction, down ? 'DOWN' : 'UP'); assert.equal(f.score, down ? -7 : 7)
    assert.deepEqual(f.blockers, []); assert.equal(f.action, 'PAPER ENTRY'); assert.equal(f.plan.side, down ? 'SHORT' : 'LONG')
    assert.ok(down ? f.plan.stop > f.referencePrice && f.plan.target < f.referencePrice : f.plan.stop < f.referencePrice && f.plan.target > f.referencePrice)
  }
  const bearish = forecast(input(true, 'spot'))
  assert.equal(bearish.stance, 'SELL / AVOID'); assert.equal(bearish.action, 'AVOID'); assert.equal(bearish.plan, null)
  assert.equal(forecast(input(false, 'spot')).stance, 'BUY')
})
test('missing auxiliaries block entries without inventing neutral or suppressing a valid direction forecast', () => {
  const x = input(); delete x.book; delete x.derivatives
  const f = forecast(x)
  assert.equal(f.direction, 'UP'); assert.equal(f.action, 'WAIT'); assert.equal(f.plan, null)
  assert.ok(f.blockers.some(b => b.includes('order book'))); assert.ok(f.blockers.some(b => b.includes('positioning')))
  assert.equal(forecast({ ...input(), requireHeatmap: true }).plan, null)
})
test('future and forming candles are ignored; incomplete and stale data do not become predictions', () => {
  const x = input(), expected = forecast(x)
  for (const rows of [...Object.values(x.bars), x.btc]) rows.push(bar(at + HOUR, 1, 1e6, .1, 1e5))
  assert.deepEqual(forecast(x), expected)
  x.bars['1h'].splice(100, 1); assert.throws(() => forecast(x), /candles/)
  assert.throws(() => forecast({ ...input(), at: at + 5 * HOUR }), /candles/)
})
test('mixed and flat data creates a recorded NEUTRAL forecast', () => {
  const x = input()
  for (const rows of [...Object.values(x.bars), x.btc]) for (const b of rows) Object.assign(b, { o: 100, h: 101, l: 99, c: 100 })
  const f = forecast(x); assert.equal(f.direction, 'NEUTRAL'); assert.equal(f.score, 0); assert.equal(f.plan, null)
})
test('forecast baseline starts strictly after issue; no pre-issue or forming bar entry', () => {
  const f = planned(), t = f.startsAt
  assert.ok(t > f.issuedAt)
  const result = trackForecast(f, [bar(t - STEP, 100, 110, 90, 100), bar(t, 100, 101, 99, 100)], t + STEP - 1)
  assert.deepEqual(result, f)
})
test('LONG and SHORT both profit on targets and lose on stops, with exact cost accounting', () => {
  for (const side of ['LONG', 'SHORT']) {
    const f = planned(side), t = f.startsAt
    const rows = [bar(t, 100, 101, 99, 100), bar(t + STEP, 100, side === 'LONG' ? 107 : 101, side === 'SHORT' ? 93 : 99, side === 'LONG' ? 106 : 94)]
    const target = trackForecast(f, rows, t + 2 * STEP)
    assert.equal(target.tracking.trade.status, 'TARGET'); assert.ok(target.tracking.trade.beforeFundingPct > 0)
    assert.equal(target.tracking.trade.netPct, null)
    const sign = side === 'LONG' ? 1 : -1, tr = target.tracking.trade
    const expected = 100 * (sign * (tr.exit - tr.entry) - .0005 * (tr.exit + tr.entry)) / tr.entry
    assert.equal(tr.beforeFundingPct, expected)
    const stop = trackForecast(f, [bar(t, 100, 103, 97, 100)], t + STEP)
    assert.equal(stop.tracking.trade.status, 'STOP'); assert.ok(stop.tracking.trade.beforeFundingPct < 0)
  }
})
test('same-bar ambiguity is stop-first for both directions and gaps worsen the stop', () => {
  for (const side of ['LONG', 'SHORT']) {
    const f = planned(side), t = f.startsAt
    const collision = trackForecast(f, [bar(t, 100, 110, 90, 100)], t + STEP)
    assert.equal(collision.tracking.trade.status, 'STOP'); assert.match(collision.tracking.trade.detail, /stop-first/)
    const rows = [bar(t, 100, 101, 99, 100), side === 'LONG' ? bar(t + STEP, 95, 97, 94, 96) : bar(t + STEP, 105, 106, 103, 104)]
    const gap = trackForecast(f, rows, t + 2 * STEP)
    assert.ok(gap.tracking.trade.beforeFundingPct < collision.tracking.trade.beforeFundingPct)
  }
})
test('chasing an out-of-range open is skipped; direction still evaluated', () => {
  const f = planned(), t = f.startsAt
  const rows = Array.from({ length: 48 }, (_, i) => bar(t + i * STEP, 104, 105, 103, 104.5))
  const result = trackForecast(f, rows, f.endsAt)
  assert.equal(result.tracking.trade.status, 'SKIPPED'); assert.equal(result.tracking.baseline, 104)
  assert.equal(result.tracking.actual, 'UP'); assert.equal(result.tracking.correct, true)
  assert.equal(result.tracking.trade.netPct, null)
})
test('missing bars pause and recover without changing the forecast; evaluation stops exactly at horizon', () => {
  const f = planned(), t = f.startsAt
  const rows = Array.from({ length: 48 }, (_, i) => bar(t + i * STEP, 100, 101, 99, i === 47 ? 101 : 100))
  const gap = trackForecast(f, rows.slice(1), f.endsAt)
  assert.ok(gap.tracking.error); assert.equal(gap.tracking.correct, null)
  const recovered = trackForecast(gap, [...rows, bar(f.endsAt, 1, 10, .1, 1)], f.endsAt + STEP)
  assert.deepEqual(recovered, trackForecast(f, rows, f.endsAt)); assert.equal(recovered.tracking.endPrice, 101)
  assert.equal(recovered.tracking.trade.status, 'TIMEOUT')
  assert.deepEqual(trackForecast(recovered, rows, f.endsAt + HOUR), recovered)
})
test('funding debits LONG and credits SHORT; unknown mark is explicitly estimated', () => {
  for (const side of ['LONG', 'SHORT']) {
    const f = planned(side), t = f.startsAt
    const closed = trackForecast(f, [bar(t, 100, 110, 90, 100)], t + STEP)
    const funded = applyFunding(closed, [{ at: t + STEP, rate: .001, mark: 100 }, { at: t - 1, rate: 10, mark: 100 }])
    const trade = funded.tracking.trade
    assert.equal(trade.fundingStatus, 'RECORDED')
    assert.ok(side === 'LONG' ? trade.netPct < trade.beforeFundingPct : trade.netPct > trade.beforeFundingPct)
    assert.equal(applyFunding(closed, [{ at: t, rate: .001, mark: null }]).tracking.trade.fundingStatus, 'ESTIMATED')
    assert.deepEqual(applyFunding(funded, [{ at: t + STEP, rate: .001, mark: 100 }]), funded)
    assert.throws(() => applyFunding(closed, [{ at: t, rate: NaN, mark: 100 }]), /Invalid/)
  }
})
test('accuracy excludes pending outcomes and separates neutral from directional calls and trade returns', () => {
  const win = planned(); win.tracking.correct = true; win.tracking.actual = 'UP'
  const loss = planned('SHORT'); loss.tracking.correct = false; loss.tracking.actual = 'UP'
  const neutral = planned(); neutral.direction = 'NEUTRAL'; neutral.tracking.correct = true; neutral.tracking.actual = 'NEUTRAL'
  const pending = planned()
  const s = forecastStats([win, loss, neutral, pending])
  assert.equal(s.directionalAccuracy, 50); assert.ok(Math.abs(s.accuracy - 200 / 3) < 1e-10); assert.equal(s.pending, 1)
  assert.equal(s.confusion.DOWN.UP, 1); assert.equal(s.neutralTotal, 1); assert.equal(s.tradeWinRate, null)
  assert.equal(forecastStats([]).accuracy, null)
})
test('forecast ledger survives restart, separates spot/futures, deduplicates hourly issues and freezes evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forecasts-test-')), url = `file:${join(dir, 'test.db')}`
  const a = new SignalRepository(url), b = new SignalRepository(url)
  try {
    const f = forecast(input()), spot = forecast(input(false, 'spot'))
    assert.ok(await a.insertForecast(f)); assert.equal(await a.insertForecast({ ...f, exchange: 'bybit', direction: 'DOWN' }), false)
    assert.ok(await a.insertForecast(spot)); await a.close()
    const updated = structuredClone(f); updated.direction = 'DOWN'; updated.tracking.error = 'test pause'
    await b.saveForecast(updated)
    const saved = (await b.forecasts('futures', 0))[0]
    assert.equal(saved.direction, 'UP'); assert.equal(saved.tracking.error, 'test pause')
    assert.equal((await b.pendingForecasts()).length, 2)
    assert.equal((await b.forecasts('spot', 0)).length, 1)
    assert.deepEqual(bucketStats(await b.forecastBuckets('futures', 0)), forecastStats([saved]))
    assert.equal((await b.forecastPage('spot', 0, 0)).length, 1)
    assert.equal((await b.forecastPage('spot', 0, 1)).length, 0)
    assert.equal((await b.latestForecasts('futures'))[0].id, f.id)
    const settled = structuredClone(saved)
    settled.tracking.actual = 'UP'; settled.tracking.correct = true; settled.tracking.settledAt = f.endsAt
    settled.tracking.trade.beforeFundingPct = 1; settled.tracking.trade.netPct = .9; settled.tracking.error = null
    await b.saveForecast(settled)
    assert.deepEqual(bucketStats(await b.forecastBuckets('futures', 0)), forecastStats([settled]))
    assert.equal((await b.pendingForecasts()).length, 1)
    assert.ok(await b.acquire('spot-worker', at)); assert.ok(await a.acquire('forecast-worker', at, 'forecasts'))
    assert.equal(await b.acquire('other', at, 'forecasts'), false)
  } finally { await a.close(); await b.close(); await rm(dir, { recursive: true, force: true }) }
})
test('futures and spot candles use separate endpoints/cache keys; Bybit futures book uses linear category', async () => {
  const original = globalThis.fetch, urls = []
  try {
    globalThis.fetch = async url => {
      const u = new URL(url); urls.push(u)
      if (u.pathname.endsWith('orderbook')) return Response.json({ retCode: 0, result: { b: [['100', '1000']], a: [['101', '1000']], ts: at } })
      return Response.json([[0, '100', '101', '99', u.host.startsWith('fapi') ? '100.5' : '100', '10', 0, '1000', 0, '5']])
    }
    const spot = await provider('binance').bars('FORECASTUSDT', '5m', 0, STEP)
    const futures = await provider('binance', 'futures').bars('FORECASTUSDT', '5m', 0, STEP)
    assert.equal(spot[0].c, 100); assert.equal(futures[0].c, 100.5)
    assert.equal(urls[0].pathname, '/api/v3/klines'); assert.equal(urls[1].pathname, '/fapi/v1/klines')
    await provider('bybit', 'futures').book('FORECASTUSDT')
    assert.equal(urls.at(-1).searchParams.get('category'), 'linear')
  } finally { globalThis.fetch = original }
})
test('funding adapters preserve timestamps and mark coverage', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async url => new URL(url).host.startsWith('fapi')
      ? Response.json([{ fundingTime: at, fundingRate: '.001', markPrice: '100' }])
      : Response.json({ retCode: 0, result: { list: [{ fundingRateTimestamp: String(at), fundingRate: '-.001' }] } })
    assert.deepEqual(await provider('binance', 'futures').fundingHistory('TESTUSDT', at, at + STEP), [{ at, rate: .001, mark: 100 }])
    assert.deepEqual(await provider('bybit', 'futures').fundingHistory('TESTUSDT', at, at + STEP), [{ at, rate: -.001, mark: null }])
  } finally { globalThis.fetch = original }
})

test('Bybit paginates futures instruments and excludes delivery/pre-market/USDC contracts', async () => {
  const original = globalThis.fetch, cursors = []
  const instrument = (symbol, extra = {}) => ({ symbol, status: 'Trading', quoteCoin: 'USDT', settleCoin: 'USDT', baseCoin: symbol.replace('USDT', ''),
    contractType: 'LinearPerpetual', lotSizeFilter: { qtyStep: '.001', minNotionalValue: '5' }, priceFilter: { tickSize: '.01' }, ...extra })
  const all = [instrument('AAAUSDT'), instrument('BBBUSDT'), instrument('BADUSDT', { contractType: 'LinearFutures' }), instrument('PREUSDT', { isPreListing: true }), instrument('USDCUSDT', { settleCoin: 'USDC' })]
  try {
    globalThis.fetch = async url => {
      const u = new URL(url)
      if (u.pathname.endsWith('tickers')) return Response.json({ retCode: 0, result: { list: all.map(i => ({ symbol: i.symbol, lastPrice: '100', turnover24h: '10000000', price24hPcnt: '.01' })) } })
      assert.equal(u.searchParams.get('category'), 'linear')
      const cursor = u.searchParams.get('cursor'); cursors.push(cursor)
      return Response.json({ retCode: 0, result: { list: cursor ? all.slice(1) : all.slice(0, 1), nextPageCursor: cursor ? '' : 'next' } })
    }
    const markets = await provider('bybit', 'futures').markets()
    assert.deepEqual(cursors, ['', 'next']); assert.deepEqual(markets.map(m => m.symbol), ['AAAUSDT', 'BBBUSDT'])
    assert.equal(markets[0].step, .001); assert.equal(markets[0].minNotional, 5)
  } finally { globalThis.fetch = original }
})

test('Binance futures universe uses perpetual status and its notional filter', async () => {
  const original = globalThis.fetch
  try {
    const symbol = (name, extra = {}) => ({ symbol: name, status: 'TRADING', quoteAsset: 'USDT', marginAsset: 'USDT', baseAsset: name.replace('USDT', ''), contractType: 'PERPETUAL',
      filters: [{ filterType: 'PRICE_FILTER', tickSize: '.01' }, { filterType: 'LOT_SIZE', stepSize: '.001' }, { filterType: 'MIN_NOTIONAL', notional: '5' }], ...extra })
    const symbols = [symbol('AAAUSDT'), symbol('DELIVERYUSDT', { contractType: 'CURRENT_QUARTER' }), symbol('CLOSEDUSDT', { status: 'SETTLING' })]
    globalThis.fetch = async url => {
      const u = new URL(url); assert.equal(u.host, 'fapi.binance.com')
      return Response.json(u.pathname.endsWith('exchangeInfo') ? { symbols } : symbols.map(i => ({ symbol: i.symbol, lastPrice: '100', quoteVolume: '10000000', priceChangePercent: '1' })))
    }
    const markets = await provider('binance', 'futures').markets()
    assert.deepEqual(markets.map(m => m.symbol), ['AAAUSDT']); assert.equal(markets[0].minNotional, 5)
  } finally { globalThis.fetch = original }
})
