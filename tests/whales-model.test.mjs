import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeWhaleTrades, detectWhaleEvents, whaleAnalysis, whaleRadius, whaleCandles, recentWhaleTrades } from '../src/lib/terminal/whales-model.ts'

const trade = (a, t, p, q, m = false) => ({ a, t, p, q, m })
const options = { mode: 'print', threshold: 1000, step: 1, windowMs: 500, minLevels: 2 }
test('live trade status uses client receipts even when the VPS/exchange clock differs', () => {
  const clientNow = 100000, receivedAt = 99500
  assert.equal(recentWhaleTrades('live', receivedAt, clientNow), true)
  assert.equal(recentWhaleTrades('live', receivedAt, clientNow + 20000), false)
  assert.equal(recentWhaleTrades('offline', receivedAt, clientNow), false)
  assert.equal(recentWhaleTrades('live', 0, clientNow), false)
})
test('overlapping history/live pages are deduplicated by exchange ID; invalid values are rejected', () => {
  const a = trade(1, 1000, 100, 2), b = trade(2, 1100, 101, 3)
  assert.deepEqual(mergeWhaleTrades([b, a], [a, { ...b, q: 4 }, trade(3, 1200, 0, 1)]), [a, { ...b, q: 4 }])
})
test('big print retains each aggregate-trade ID and never invents a full taker order', () => {
  const ts = [trade(1, 1000, 100, 20), trade(2, 1000, 101, 30)]
  const r = detectWhaleEvents(ts, 500, 2000, options)
  assert.equal(r.events.length, 2); assert.deepEqual(r.events.map(e => e.tradeIds), [[1], [2]])
})
test('sweeps require multiple prices, one aggressor side, consecutive IDs and a bounded duration', () => {
  const ts = [trade(1, 1000, 100, 20), trade(2, 1100, 101, 20), trade(4, 1150, 102, 20), trade(5, 1200, 103, 20, true), trade(6, 1250, 103, 20, true)]
  const r = detectWhaleEvents(ts, 500, 2000, { ...options, mode: 'sweep' })
  assert.equal(r.events.length, 1); assert.deepEqual(r.events[0].tradeIds, [1, 2]); assert.equal(r.events[0].levels, 2)
})
test('aggressive runs do not merge different prices or opposite sides', () => {
  const ts = [trade(1, 1000, 100, 20), trade(2, 1100, 100, 20), trade(3, 1200, 101, 20), trade(4, 1250, 101, 20, true)]
  const r = detectWhaleEvents(ts, 500, 2000, { ...options, mode: 'aggressive' })
  assert.deepEqual(r.events.map(e => e.count), [2, 1, 1])
})
test('mixed level bubbles preserve exact buyer/seller dollars, quantities, VWAP and conservation', () => {
  const ts = [trade(1, 1000, 100, 20), trade(2, 1100, 100, 10, true), trade(3, 1200, 101, 1), trade(4, 1300, 102, 1, true)]
  const a = whaleAnalysis(ts, 1000, 2000, 60000, { ...options, mode: 'level', windowMs: 5000 })
  assert.equal(a.events.length, 1); assert.equal(a.buy, 2000); assert.equal(a.sell, 1000)
  assert.equal(a.buyVwap, 100); assert.equal(a.sellVwap, 100)
  assert.equal(a.events[0].price, 100); assert.equal(a.bars[0].largeCvd + a.bars[0].otherCvd, a.allBuy - a.allSell)
  assert.equal(a.profile.reduce((n, r) => n + r.buy + r.sell, 0), a.buy + a.sell)
})
test('future trades cannot change auto sizing, statistics, profile or zones in a historical view', () => {
  const ts = [trade(1, 1000, 100, 20), trade(2, 1100, 100, 10, true)]
  const args = [1000, 2000, 60000, { ...options, threshold: 'auto' }]
  assert.deepEqual(whaleAnalysis([...ts, trade(3, 3000, 100000, 1e8)], ...args), whaleAnalysis(ts, ...args))
})
test('ID gaps are reported and never reconstructed as zero-volume coverage', () => {
  const a = whaleAnalysis([trade(1, 1000, 100, 20), trade(6, 2000, 101, 20)], 500, 2500, 60000, options)
  assert.equal(a.gaps, 1); assert.equal(a.missingIds, 4); assert.deepEqual(a.gapRanges, [{ from: 1000, to: 2000, missing: 4 }])
})
test('bubble area is proportional to dollars before the explicit display caps', () => {
  assert.equal(whaleRadius(100, 10000, 0, 40) ** 2 * 4, whaleRadius(400, 10000, 0, 40) ** 2)
  assert.equal(whaleRadius(100000, 100, 5, 40), 40)
})
test('a partial higher-timeframe update preserves the actual earlier open, high and low', () => {
  const rest = [{ t: 0, o: 100, h: 120, l: 90, c: 110, v: 1000 }]
  const live = [{ t: 120000, o: 110, h: 112, l: 105, c: 111, v: 10 }]
  const [c] = whaleCandles(rest, live, 300000)
  assert.equal(c.o, 100); assert.equal(c.h, 120); assert.equal(c.l, 90); assert.equal(c.c, 111); assert.equal(c.v, 1000)
  assert.equal(rest[0].c, 110)
})
