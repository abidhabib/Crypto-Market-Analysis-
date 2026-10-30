import { test } from 'node:test'
import assert from 'node:assert/strict'
import { binDepth, bubbleRadius, columnAt, groupTrades, nearbyLiquidity, summarizeFlow } from '../src/lib/terminal/heatmap-model.ts'

test('bubbles combine small fills before filtering, preserving both aggressor sides and weighted price', () => {
  const trades = [{ a: 1, t: 100, p: 100, q: 20, m: false }, { a: 2, t: 200, p: 101, q: 30, m: true }, { a: 3, t: 2000, p: 100, q: 10, m: false }]
  const groups = groupTrades(trades, 0, 500, 1000, 10, 5000)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].usd, 5030)
  assert.equal(groups[0].buy, 2000)
  assert.equal(groups[0].sell, 3030)
  assert.equal(groups[0].count, 2)
  assert.ok(Math.abs(groups[0].p - (100 * 2000 + 101 * 3030) / 5030) < 1e-10)
})

test('bubble area scales with notional and large clusters have a visible size cap', () => {
  assert.ok(Math.abs(bubbleRadius(40000) ** 2 / bubbleRadius(10000) ** 2 - 4) < 1e-10)
  assert.ok(bubbleRadius(100000) > 30)
  assert.equal(bubbleRadius(1e9), 48)
})

test('depth adds all orders in a price bin and rejects invalid levels', () => {
  const bins = binDepth([{ p: 100, q: 2 }, { p: 101, q: 3 }, { p: 100, q: -1 }, { p: NaN, q: 1 }], 5)
  assert.equal(bins.get(100), 503)
  assert.equal(bins.size, 1)
})

test('historical inspection uses the column at that time, including a full rolling buffer', () => {
  const cols = Array.from({ length: 2900 }, (_, i) => ({ t: i * 250, mid: i, bids: [], asks: [] }))
  assert.equal(columnAt(cols, 1025)?.mid, 4)
  assert.equal(columnAt(cols, -1), null)
  assert.equal(columnAt(cols, 800000), null)
  cols.shift(); cols.push({ t: 725000, mid: 2900, bids: [], asks: [] })
  assert.equal(columnAt(cols, 725000)?.mid, 2900)
})

test('flow counts all trades in the observed interval and respects aggressor side', () => {
  const trades = [
    { a: 1, t: 10, p: 100, q: 2, m: false },
    { a: 2, t: 20, p: 100, q: 1, m: true },
    { a: 3, t: 30, p: 110, q: 10, m: false },
  ]
  const flow = summarizeFlow(trades, 10, 20, 5)
  assert.equal(flow.delta, 100)
  assert.equal(flow.buyShare, 2 / 3)
  assert.equal(flow.count, 2)
  assert.equal(flow.poc, 100)
  assert.equal(summarizeFlow([], 0, 20, 5).buyShare, null)
})

test('ranked liquidity excludes levels on the wrong side and outside the visible range', () => {
  const col = { t: 0, mid: 100, bids: [{ p: 98, q: 2 }, { p: 99, q: 1 }, { p: 80, q: 100 }, { p: 102, q: 99 }], asks: [{ p: 102, q: 3 }] }
  const levels = nearbyLiquidity(col, 1, 5)
  assert.deepEqual(levels.bids.map(x => x.price), [98, 99])
  assert.equal(levels.asks[0].price, 102)
  assert.deepEqual(nearbyLiquidity(null, 1, 5), { bids: [], asks: [] })
})
