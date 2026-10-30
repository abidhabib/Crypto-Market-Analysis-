import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeHeatmap, binDepth, bubbleRadius, columnAt, depthQuality, groupTrades, nearbyLiquidity, replayFrame, summarizeFlow } from '../src/lib/terminal/heatmap-model.ts'

const book = (t, extra = {}) => ({ t, sourceAt: t, bookMode: 'synced', bookEpoch: 1, mid: 100,
  bids: [{ p: 99, q: 1000 }, { p: 98, q: 1 }, { p: 97, q: 1 }],
  asks: [{ p: 101, q: 1000 }, { p: 102, q: 1 }, { p: 103, q: 1 }], ...extra })
const executedBuys = [500, 2000, 3500].map((t, i) => ({ a: i, t, p: 101, q: 300, m: false }))

test('persistence counts an observed refill and resets age across gaps and book rebuilds', () => {
  const cols = [book(0), book(1000, { bids: [{ p: 99, q: 400 }, { p: 98, q: 1 }] }), book(2000), book(3000), book(4000)]
  const a = analyzeHeatmap(cols, [], 0, 4000, 1)
  const z = a.zones.find(z => z.side === 'bid' && z.price === 99)
  assert.equal(z.firstSeen, 0)
  assert.equal(z.lastSeen, 4000)
  assert.equal(z.replenishments, 1)
  assert.ok(a.reactions.some(e => e.kind === 'replenished' && e.usd > 0))
  const afterGap = analyzeHeatmap([...cols, book(10000)], [], 0, 10000, 1)
  assert.ok(afterGap.zones.every(z => z.firstSeen === 10000))
  const afterReset = analyzeHeatmap([...cols, book(4500, { bookEpoch: 2 })], [], 0, 4500, 1)
  assert.ok(afterReset.zones.every(z => z.firstSeen === 4500))
})

test('a rejection is emitted only after price has moved away from a touched zone', () => {
  const cols = [book(0), book(1000), book(2000, { mid: 102 })]
  assert.equal(analyzeHeatmap(cols, [], 0, 1000, 1).reactions.some(e => e.kind === 'rejection'), false)
  assert.ok(analyzeHeatmap(cols, [], 0, 2000, 1).reactions.some(e => e.kind === 'rejection' && e.side === 'bid'))
})

test('absorption requires one-sided execution, stalled price, and a closed synced-book window', () => {
  const cols = Array.from({ length: 7 }, (_, i) => book(i * 1000))
  assert.equal(analyzeHeatmap(cols, executedBuys, 0, 4999, 1).reactions.some(e => e.kind === 'absorption'), false)
  const events = analyzeHeatmap(cols, executedBuys, 0, 5000, 1).reactions.filter(e => e.kind === 'absorption')
  assert.equal(events.length, 1)
  assert.equal(events[0].side, 'ask')
  assert.equal(events[0].t, 5000)
  assert.equal(analyzeHeatmap(cols.map(c => ({ ...c, bookMode: 'partial' })), executedBuys, 0, 5000, 1).reactions.some(e => e.kind === 'absorption'), false)
  assert.equal(analyzeHeatmap(cols.map(c => ({ ...c, mid: 100 + c.t / 1000 })), executedBuys, 0, 5000, 1).reactions.some(e => e.kind === 'absorption'), false)
})

test('replay and reactions cannot read future snapshots or trades', () => {
  const past = Array.from({ length: 6 }, (_, i) => book(i * 1000))
  const future = book(10000, { mid: 999, bookEpoch: 7 })
  const futureTrade = { a: 900, t: 9000, p: 999, q: 1e6, m: true }
  assert.deepEqual(analyzeHeatmap([...past, future], [...executedBuys, futureTrade], 0, 5000, 1), analyzeHeatmap(past, executedBuys, 0, 5000, 1))
  const frame = replayFrame([...past, future], [...executedBuys, futureTrade], 1000)
  assert.equal(frame.heatCols.length, 2)
  assert.equal(frame.trades.length, 1)
  assert.ok(frame.heatCols.every(c => c.t <= 1000))
})

test('quality exposes partial books, source age, sampling, missing intervals and resets', () => {
  const q = depthQuality([book(0), book(1000), book(10000, { sourceAt: 9000, bookMode: 'partial', bookEpoch: 2, sampled: true })], 0, 12000)
  assert.equal(q.mode, 'partial'); assert.equal(q.ageMs, 3000)
  assert.equal(q.gaps, 1); assert.equal(q.resets, 1)
  assert.equal(q.recordedMs, 1000); assert.equal(q.sampled, true)
  assert.equal(depthQuality([], 0, 1000).ageMs, null)
  assert.equal(depthQuality([book(0, { bookMode: undefined })], 0, 1000).mode, 'unknown')
})

test('possible withdrawal and consumption are distinguished using recorded executions', () => {
  const cols = [book(0), book(1000, { bids: [{ p: 98, q: 1 }, { p: 97, q: 1 }] })]
  const unrelated = [{ a: 1, t: 0, p: 100, q: 1, m: false }, { a: 2, t: 1000, p: 100, q: 1, m: false }]
  assert.ok(analyzeHeatmap(cols, unrelated, 0, 1000, 1).reactions.some(e => e.kind === 'withdrawn' && e.side === 'bid'))
  const matched = [...unrelated, { a: 3, t: 500, p: 99, q: 800, m: true }]
  assert.ok(analyzeHeatmap(cols, matched, 0, 1000, 1).reactions.some(e => e.kind === 'consumed' && e.side === 'bid'))
  assert.equal(analyzeHeatmap(cols, [], 0, 1000, 1).reactions.some(e => e.kind === 'withdrawn'), false)
  const laterOnly = [{ a: 1, t: 0, p: 100, q: 1, m: false }, { a: 2, t: 1001, p: 100, q: 1, m: false }]
  assert.equal(analyzeHeatmap(cols, laterOnly, 0, 1001, 1).reactions.some(e => e.kind === 'withdrawn'), false, 'A later trade must not retroactively prove coverage at an earlier snapshot')
  assert.equal(analyzeHeatmap(cols.map(c => ({ ...c, bookMode: 'partial' })), matched, 0, 1000, 1).reactions.some(e => e.kind === 'consumed' || e.kind === 'withdrawn'), false)
})

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
