import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFootprint, mergeFootprintTrades, footprintReading } from '../src/lib/terminal/footprint-model.ts'
const trade = (a, t, p, q, m = false) => ({ a, t, p, q, m })
const options = { interval: 60000, tick: 1, rowTicks: 1, ratio: 3, minQty: 0, end: 240000 }
const build = (ts, overrides = {}) => buildFootprint(ts, { ...options, ...overrides })

test('maker flag, coin/quote conservation and duplicate IDs are handled exactly', () => {
  const a = trade(1, 61000, 100, 2), b = trade(2, 62000, 101, 3, true)
  const bars = build([b, a, a, trade(3, 121000, 100, 1)])
  assert.equal(bars[0].count, 2); assert.equal(bars[0].buy, 2); assert.equal(bars[0].sell, 3)
  assert.equal(bars[0].delta, -1); assert.equal(bars[0].buyUsd + bars[0].sellUsd, 503)
  assert.equal(bars[0].rows.get(100).buy, 2); assert.equal(bars[0].rows.get(101).sell, 3)
  assert.equal(mergeFootprintTrades([a, { ...a, q: NaN }, { ...b, m: 1 }]).length, 1)
})
test('fixed tick bins do not repaint past rows when a distant future trade arrives', () => {
  const ts = [trade(1, 61000, 100.01, 1), trade(2, 62000, 100.04, 2)]
  const a = build(ts, { tick: 0.01, rowTicks: 5 })[0]
  const b = build([...ts, trade(3, 180000, 90000, 100)], { tick: 0.01, rowTicks: 5 })[0]
  assert.deepEqual([...a.rows], [...b.rows]); assert.equal(a.rows.size, 1); assert.equal(a.poc, 100)
})
test('buy imbalance compares down, sell imbalance compares up; side highlights do not reverse', () => {
  const ts = [trade(1, 61000, 100, 9, true), trade(2, 62000, 101, 2), trade(3, 63000, 102, 1, true), trade(4, 64000, 103, 4)]
  const rows = build(ts)[0].rows
  assert.equal(rows.get(100).sellImbalance, true)
  assert.equal(rows.get(101).buyImbalance, false)
  assert.equal(rows.get(103).buyImbalance, true)
  assert.equal(rows.get(102).sellImbalance, false)
})
test('missing/zero diagonal opponents and minimum-size filters never manufacture imbalances', () => {
  const ts = [trade(1, 61000, 100, 20), trade(2, 62000, 102, 20, true), trade(3, 63000, 103, 1)]
  const rows = build(ts, { minQty: 30 })[0].rows
  assert.equal(rows.get(100).buyImbalance, false); assert.equal(rows.get(102).sellImbalance, false)
})
test('stacking requires three consecutive price bins, never a jump over a missing row', () => {
  const ts = []; let id = 1
  for (let p = 99; p <= 103; p++) { ts.push(trade(id++, 61000 + id, p, 1, true)); if (p > 99) ts.push(trade(id++, 61000 + id, p, 4)) }
  const b = build(ts)[0]; assert.equal(b.buyStack, 4)
  const hole = build(ts.filter(t => t.p !== 101))[0]; assert.ok(hole.buyStack < 3)
})
test('POC is maximum combined coin volume; it is not maximum quote value or delta', () => {
  const b = build([trade(1, 61000, 100, 3, true), trade(2, 62000, 100, 2), trade(3, 63000, 200, 4)])[0]
  assert.equal(b.poc, 100); assert.equal(b.delta, 3)
})
test('first/tail partial bars, forming bars and ID gaps cannot produce directional readings', () => {
  const ts = [trade(1, 59000, 100, 1), trade(2, 61000, 101, 1), trade(4, 121000, 102, 1), trade(5, 181000, 103, 1)]
  const bars = build(ts, { end: 190000 })
  assert.equal(bars[0].partial, true); assert.equal(bars[1].gaps, 1); assert.equal(bars[2].gaps, 1)
  assert.equal(bars.at(-1).forming, true)
  for (const b of bars) assert.equal(footprintReading(b).tone, 'neutral')
  const tail = build([trade(1, 59000, 100, 1), trade(2, 61000, 101, 30)])
  assert.equal(tail.at(-1).complete, false)
})
test('only fully bracketed closed bars are complete; observations beyond end cannot alter a replay', () => {
  const ts = [trade(1, 59000, 100, 1), trade(2, 61000, 101, 1), trade(3, 121000, 102, 1)]
  const bars = build(ts, { end: 130000 }); assert.equal(bars[1].complete, true)
  assert.deepEqual(build([...ts, trade(4, 240000, 9000, 100)], { end: 130000 }), bars)
})
test('initiative and divergence are conditional observations, gated by sample size and recording quality', () => {
  const b = build([trade(1, 59000, 100, 1), trade(2, 61000, 100, 1), trade(3, 121000, 100, 1)])[1]
  const ready = { ...b, count: 20, deltaPct: 30, buyStack: 3, o: 100, c: 102 }
  assert.equal(footprintReading(ready).tone, 'buy')
  assert.equal(footprintReading({ ...ready, c: 99 }).tone, 'caution')
  assert.equal(footprintReading({ ...ready, count: 19 }).tone, 'neutral')
  assert.equal(footprintReading({ ...ready, complete: false, gaps: 1 }).tone, 'neutral')
  assert.equal(footprintReading({ ...ready, deltaPct: -30, buyStack: 0, sellStack: 3, c: 99 }).tone, 'sell')
})
