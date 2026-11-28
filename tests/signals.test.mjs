import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyze, barsValid, closedBars, indicators, makePlan, rsiSeries, zones } from '../src/lib/signals/engine.ts'
import { DEFAULT_POLICY, INTERVAL_MS } from '../src/lib/signals/types.ts'
import { createSignal, failureSummary, performance, periodStats, trackSignal } from '../src/lib/signals/tracking.ts'
import { backtest, windowAt } from '../src/lib/signals/backtest.ts'
import { SignalRepository } from '../src/lib/signals/repository.ts'
import { eligibleMarket, provider, publicJson } from '../src/lib/signals/providers.ts'

const at = 300 * INTERVAL_MS['4h']
function series(tf, fn) {
  return Array.from({ length: 260 }, (_, i) => { const c = fn(i); return { t: at - (260 - i) * INTERVAL_MS[tf], o: c - .1, h: c + .15, l: c - .2, c, v: 100000 } })
}
function fixture() {
  const h4 = series('4h', i => i < 140 ? 60 + i * .25 : 100 + (i - 140) * .002)
  for (const i of [180, 210, 240]) h4[i].l = 99.4
  h4[259] = { ...h4[259], o: 99, h: 100.4, l: 98.5, c: 100, v: 160000 }
  const h1 = series('1h', i => 95 + i * .01 + i * i * .00003)
  const m15 = series('15m', i => 100 + .3 * Math.sin(i * .45 + 3.3) + i * .0005)
  Object.assign(m15[259], { v: 200000, o: m15[259].c - .25, l: m15[259].c - .3, h: m15[259].c + .05 })
  const m5 = series('5m', i => 97 + i * .01 + i * i * .000005)
  const btc = series('4h', i => 100 + i * .1 + i * i * .0001)
  return { exchange: 'binance', market: { symbol: 'TESTUSDT', base: 'TEST', price: 100, turnover: 1e8, change: .01, tick: .01, step: .001, minNotional: 5 }, at,
    bars: { '4h': h4, '1h': h1, '15m': m15, '5m': m5 }, btc, eth: btc,
    book: { at, bid: 99.99, ask: 100, bidUsd: 100000, askUsd: 90000 }, derivatives: { at, funding: .0001, oi: 1e6, oiChange: 1, longShortRatio: 1 } }
}
function signal(time = at) {
  const analysis = analyze(fixture())
  analysis.at = time
  analysis.plan = { ...analysis.plan, expiresAt: time + 3600000, closeBy: time + 72 * 3600000 }
  return createSignal(analysis, DEFAULT_POLICY)
}
const candle = (t, o, h, l, c) => ({ t, o, h, l, c, v: 100 })

test('aligned closed multi-timeframe setup yields BUY with transparent graded score', () => {
  const result = analyze(fixture())
  assert.equal(result.decision, 'BUY'); assert.equal(result.score, 97)
  assert.equal(result.setup, 'support-reclaim'); assert.deepEqual(result.blockers, [])
  assert.equal(result.checks.reduce((s, c) => s + c.max, 0), 100)
  assert.ok(result.plan.rr >= 2); assert.ok(result.plan.riskUsd <= 100)
})
test('high score never overrides missing or stale required derivatives', () => {
  for (const derivatives of [undefined, { ...fixture().derivatives, at: at - 900001 }, { ...fixture().derivatives, funding: NaN }]) {
    const result = analyze({ ...fixture(), derivatives })
    assert.ok(result.score >= 85); assert.equal(result.decision, 'NO SIGNAL')
    assert.ok(result.blockers.includes('OI / funding / positioning'))
  }
})
test('breakout BUY requires a separate successful retest and volume on the breakout candle', () => {
  const input = fixture(), h4 = input.bars['4h']
  for (let i = 140; i < 260; i++) { const c = 99 + (i - 140) * .002; h4[i] = { ...h4[i], o: c - .1, h: c + .15, l: c - .2, c } }
  for (const i of [180, 210, 240]) h4[i].h = 99.8
  Object.assign(h4[256], { o: 99.3, h: 99.6, l: 99.2, c: 99.5 })
  Object.assign(h4[257], { o: 99.5, h: 100.2, l: 99.4, c: 100, v: 160000 })
  Object.assign(h4[258], { o: 100, h: 100.3, l: 99.9, c: 100.1 })
  Object.assign(h4[259], { o: 99.8, h: 100.3, l: 99.65, c: 100.2, v: 160000 })
  assert.equal(analyze(input).decision, 'BUY'); assert.equal(analyze(input).setup, 'breakout-retest')
  h4[257].v = 50000
  assert.equal(analyze(input).decision, 'NO SIGNAL')
  h4[257].v = 160000; h4[259].l = 99
  assert.equal(analyze(input).decision, 'NO SIGNAL')
})
test('high score cannot override missing, thin, crossed or wide order book', () => {
  for (const book of [undefined, { ...fixture().book, bidUsd: 500 }, { ...fixture().book, ask: 99 }, { ...fixture().book, ask: 102 }]) {
    assert.equal(analyze({ ...fixture(), book }).decision, 'NO SIGNAL')
  }
})
test('strict heatmap mode fails closed; optional known adverse clusters also block', () => {
  assert.equal(analyze(fixture(), { ...DEFAULT_POLICY, requireHeatmap: true }).decision, 'NO SIGNAL')
  const heatmap = { at, source: 'test provider', clusters: [{ side: 'long', price: 99.8, usd: 20000000 }] }
  assert.equal(analyze({ ...fixture(), heatmap }).decision, 'NO SIGNAL')
  assert.ok(analyze(fixture()).coverage.includes('Liquidation heatmap unavailable'))
})
test('future and forming candles cannot change a historical decision', () => {
  const input = fixture(), expected = analyze(input)
  for (const tf of Object.keys(input.bars)) input.bars[tf].push(candle(at, 100, 1000000, .01, 500000))
  input.btc = [...input.btc, candle(at, 100, 100000, 1, 1)]
  assert.deepEqual(analyze(input), expected)
})
test('missing, malformed and stale history never yields a signal', () => {
  const input = fixture(); input.bars['1h'].splice(200, 1)
  assert.equal(analyze(input).decision, 'NO SIGNAL')
  assert.equal(analyze(input).score, 0)
  const invalid = fixture(); invalid.bars['4h'][100].l = -1
  assert.equal(analyze(invalid).score, 0)
  assert.equal(barsValid(fixture().bars['5m'], 300000, at + 900000, 80), false)
})
test('flat RSI is neutral and monotonic prices have limiting RSI', () => {
  assert.equal(rsiSeries(Array(50).fill(10)).at(-1), 50)
  assert.equal(rsiSeries(Array.from({ length: 50 }, (_, i) => i)).at(-1), 100)
  assert.equal(rsiSeries(Array.from({ length: 50 }, (_, i) => 100 - i)).at(-1), 0)
  assert.ok(Number.isFinite(indicators(fixture().bars['4h']).adx))
})
test('pivot confirmation never treats the unconfirmed last low as support', () => {
  const bars = Array.from({ length: 20 }, (_, i) => candle(i, 100, 101, 99 - i, 100))
  assert.deepEqual(zones(bars, .1, 'support'), [])
})
test('position sizing includes exact fees, slippage, spot capital and tick/lot steps', () => {
  const p = makePlan(100, 97, 1, null, .01, .001, at, DEFAULT_POLICY)
  const entryCost = p.entry * 1.0005 * 1.001, stopNet = p.stop * .9995 * .999
  assert.ok((entryCost - stopNet) * p.quantity <= 100 + 1e-9)
  assert.ok(entryCost * p.quantity <= DEFAULT_POLICY.equity)
  assert.ok((p.targets[0] * .9995 * .999 - entryCost) / (entryCost - stopNet) >= 2)
  assert.equal(makePlan(100, 97, 1, 103, .01, .001, at, DEFAULT_POLICY), null)
  assert.equal(makePlan(100, 97, 1, null, .01, .001, at, { ...DEFAULT_POLICY, riskPct: 2 }), null)
})
test('tracking ignores the candle that already began before generation', () => {
  const s = signal(at + 1000)
  const next = trackSignal(s, [candle(at, 100, 200, 1, 100)], at + 300000)
  assert.equal(next.status, 'PENDING'); assert.equal(next.events.length, 0)
})
test('entry candle cannot claim a target that may have happened before entry', () => {
  const s = signal(), target = s.plan.targets[2]
  const next = trackSignal(s, [candle(at, 101, target + 1, 99.9, 100)], at + 300000)
  assert.equal(next.status, 'OPEN'); assert.equal(next.targetsHit, 0)
})
test('same candle stop and target ambiguity uses the stop first, including gap slippage', () => {
  const s = signal(), p = s.plan
  const next = trackSignal(s, [candle(at, p.entry, p.targets[2] + 1, p.stop - 1, p.entry)], at + 300000)
  assert.equal(next.status, 'LOST'); assert.equal(next.targetsHit, 0)
  assert.ok(next.events.at(-1).detail.includes('stop-first'))
  assert.ok(Math.abs(next.pnl + p.riskUsd) < 1e-8)
})
test('three partial exits settle one win, not three separate wins', () => {
  const s = signal(), p = s.plan
  const rows = [candle(at, p.entry, p.entry + .1, p.entry - .1, p.entry), candle(at + 300000, p.entry, p.targets[2] + 1, p.entry, p.targets[2])]
  const next = trackSignal(s, rows, at + 600000)
  assert.equal(next.status, 'WON'); assert.equal(next.targetsHit, 3)
  assert.ok(next.pnl > 0); assert.equal(performance([next]).won, 1)
  assert.deepEqual(trackSignal(next, rows, at + 900000), next)
})
test('missing bars pause outcomes and recovered coverage resumes deterministically', () => {
  const s = signal(), p = s.plan
  const later = candle(at + 300000, p.entry, p.targets[2] + 1, p.entry, p.targets[2])
  const gap = trackSignal(s, [later], at + 600000)
  assert.equal(gap.status, 'PENDING'); assert.ok(gap.trackingError)
  const rows = [candle(at, p.entry, p.entry + .1, p.entry - .1, p.entry), later]
  assert.deepEqual(trackSignal(gap, rows, at + 600000), trackSignal(s, rows, at + 600000))
})
test('unfilled expiry and pre-entry invalidation do not enter win-rate denominator', () => {
  const s = signal()
  const rows = Array.from({ length: 13 }, (_, i) => candle(at + i * 300000, 105, 106, 104, 105))
  const expired = trackSignal(s, rows, at + 3900000)
  const invalid = trackSignal(signal(), [candle(at, 90, 95, 89, 92)], at + 300000)
  assert.equal(expired.status, 'EXPIRED'); assert.equal(invalid.status, 'INVALIDATED')
  const stats = performance([expired, invalid]); assert.equal(stats.closed, 0); assert.equal(stats.winRate, null)
})
test('UTC cohorts retain late results and failure reasons describe observations', () => {
  const s = signal(Date.UTC(2026, 0, 1, 23, 59))
  s.status = 'LOST'; s.pnl = -20; s.r = -.2; s.closedAt = Date.UTC(2026, 0, 3)
  s.events = [{ kind: 'stop', at: s.closedAt, price: 99, detail: 'Candle closed below recorded support.' }]
  assert.equal(periodStats([s], 'day')[0].period, '2026-01-01')
  assert.equal(periodStats([s], 'week')[0].period, '2025-12-29')
  assert.match(failureSummary([s])[0].reason, /support observed/)
})
test('settled-equity drawdown is ordered by closing time, not creation time', () => {
  const records = [100, -40, -80, 50].map((pnl, i) => ({ ...signal(), id: String(i), pnl, r: pnl / 100, closedAt: at + i, status: pnl > 0 ? 'WON' : 'LOST' }))
  const result = performance(records.reverse())
  assert.equal(result.maxDrawdown, 120); assert.equal(result.netPnl, 30); assert.equal(result.winRate, 50)
  assert.equal(result.profitFactor, 1.25)
})
test('historical windows and replay exclude all future observations', () => {
  const input = fixture()
  assert.equal(windowAt(input.bars['5m'], 300000, at - 300000).at(-1).t, at - 600000)
  const dataset = { ...input, from: at - 900000, to: at }
  const a = backtest(dataset)
  assert.equal(a.mode, 'technical-backtest')
  assert.equal(a.policy.mode, 'technical-backtest')
  for (const tf of Object.keys(input.bars)) input.bars[tf].push(candle(at + 86400000, 1, 100000, .1, 50000))
  const b = backtest(dataset)
  assert.deepEqual(a.trades, b.trades); assert.deepEqual(a.performance, b.performance)
  assert.ok(a.limitations.some(s => s.includes('not verification')))
})
test('market filters reject leveraged tokens, stablecoins and invalid metadata', () => {
  const m = fixture().market
  assert.ok(eligibleMarket(m, 5e6))
  assert.equal(eligibleMarket({ ...m, symbol: 'BTCUPUSDT' }, 5e6), false)
  assert.equal(eligibleMarket({ ...m, base: 'USDC' }, 5e6), false)
  assert.equal(eligibleMarket({ ...m, tick: NaN }, 5e6), false)
})
test('durable repository: restart, deduplication, per-market active guard, and exclusive lease', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signals-test-'))
  const url = `file:${join(dir, 'signals.db')}`, first = new SignalRepository(url), second = new SignalRepository(url)
  try {
    assert.ok(await first.acquire('a', at)); assert.equal(await second.acquire('b', at), false)
    await first.release('wrong'); assert.equal(await second.acquire('b', at + 1), false)
    await first.release('a'); assert.ok(await second.acquire('b', at + 1))
    const s = signal(); assert.ok(await first.insert(s)); assert.equal(await first.insert(s), false)
    assert.equal(await first.insert({ ...s, id: 'different-id' }), false)
    await first.close()
    assert.equal((await second.active()).length, 1); assert.deepEqual((await second.history(0))[0], s)
    s.status = 'EXPIRED'; s.closedAt = at + 1; await second.save(s)
    assert.equal((await second.active()).length, 0)
    assert.ok(await second.insert({ ...signal(), id: 'next-candle' }))
    s.status = 'LOST'; s.pnl = -40; await second.save(s)
    assert.equal(await second.realizedPnl(), -40)
  } finally { await first.close(); await second.close(); await rm(dir, { recursive: true, force: true }) }
})
test('Bybit reversed klines normalize to ascending spot bars; API errors never become empty success', async () => {
  const original = globalThis.fetch
  try {
    let requested
    globalThis.fetch = async url => { requested = new URL(url); return Response.json({ retCode: 0, result: { list: [['300000', '2', '3', '1', '2', '10', '20'], ['0', '1', '2', '1', '2', '9', '18']] } }) }
    const bars = await provider('bybit').bars('TESTUSDT', '5m', 0, 600000)
    assert.equal(requested.searchParams.get('category'), 'spot')
    assert.deepEqual(bars.map(b => b.t), [0, 300000])
    globalThis.fetch = async () => Response.json({ retCode: 10001 })
    await assert.rejects(publicJson('https://api.bybit.com', '/v5/market/test'), /exchange error/)
    globalThis.fetch = async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } })
    await assert.rejects(publicJson('https://rate-limit.test', '/'), /rate limit/)
    await assert.rejects(publicJson('https://rate-limit.test', '/'), /cooldown/)
  } finally { globalThis.fetch = original }
})
