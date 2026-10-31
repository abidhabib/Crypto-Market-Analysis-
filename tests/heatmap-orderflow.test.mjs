import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

// Compile the pure modules in memory, resolving their normal app imports.
const urls = new Map()
async function moduleUrl(file) {
  file = resolve(file)
  if (urls.has(file)) return urls.get(file)
  let js = ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const imports = [...js.matchAll(/from ['"]([^'"]+)['"]/g)]
  for (const match of imports) if (match[1].startsWith('.')) js = js.replace(match[0], `from '${await moduleUrl(resolve(dirname(file), match[1] + '.ts'))}'`)
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64'); urls.set(file, url); return url
}
const { orderFlowAt, planLines, liquidationScenarios, gammaLines, recordedLiquidations, cumulativeFlow } = await import(await moduleUrl('src/lib/terminal/heatmap-orderflow.ts'))
const { columnLayout } = await import(await moduleUrl('src/lib/terminal/heatmap-columns-renderer.ts'))
const { heatmapGeometry, getTradeBubbles } = await import(await moduleUrl('src/lib/terminal/heatmap-renderer.ts'))
const col = (t, extra = {}) => ({ t, sourceAt: t, mid: 100, bookMode: 'synced', bookEpoch: 1, bids: [{ p: 99, q: 10 }, { p: 98, q: 20 }], asks: [{ p: 101, q: 30 }, { p: 102, q: 40 }], ...extra })
const trades = [{ a: 1, t: 1000, p: 99, q: 2, m: true }, { a: 2, t: 1500, p: 101, q: 3, m: false }, { a: 3, t: 1800, p: 102, q: 1, m: false }]
const columns = [col(0), col(1000), col(2000)]

test('the ladder separates resting orders from execution, uses USDT notional and correct cumulative sides', () => {
  const f = orderFlowAt(columns, trades, 0, 2000, 1)
  assert.equal(f.rows.get(99).bid, 990); assert.equal(f.rows.get(99).sell, 198)
  assert.equal(f.rows.get(101).ask, 3030); assert.equal(f.rows.get(101).buy, 303)
  assert.equal(f.rows.get(98).bidCum, 2950); assert.equal(f.rows.get(99).bidCum, 990)
  assert.equal(f.rows.get(101).askCum, 3030); assert.equal(f.rows.get(102).askCum, 7110)
  assert.equal(f.rows.get(99).delta, -198); assert.equal(f.rows.get(102).cumDelta, 405)
  assert.equal(f.buyVwap, 101.25); assert.equal(f.sellVwap, 99)
})

test('window scope, recorded-buffer scope, and future boundaries are independent', () => {
  const future = { a: 999, t: 5000, p: 999, q: 1e7, m: false }
  const full = orderFlowAt([...columns, col(5000, { mid: 999 })], [...trades, future], 1400, 2000, 1)
  const past = orderFlowAt(columns, trades, 1400, 2000, 1)
  assert.deepEqual(full, past)
  assert.equal(full.sell, 0); assert.equal(full.rows.get(99).recordedSell, 198)
  assert.equal(orderFlowAt(columns, trades, 1400, 2000, 1, 'recorded').sell, 198)
  assert.deepEqual(full.tape.map(t => t.a), [3, 2, 1])
  assert.equal(full.tapeBuy, 405); assert.equal(full.tapeSell, 198)
})

test('quote counts skip rebuilds and gaps; additions/removals require a continuous baseline', () => {
  const changed = col(1000, { bids: [{ p: 99, q: 5 }] })
  const f = orderFlowAt([col(0), changed, col(2000, { bookEpoch: 2 }), col(6000)], [], 0, 6000, 1)
  assert.equal(f.rows.get(99).bidChanges, 1)
  assert.equal(f.rows.get(99).addedBid, 0, 'a rebuild/gap prevents a misleading five-second change')
  const continuous = Array.from({ length: 6 }, (_, i) => col(i * 1000, { bids: [{ p: 99, q: i === 5 ? 15 : 10 }] }))
  assert.equal(orderFlowAt(continuous, [], 0, 5000, 1).rows.get(99).addedBid, 495)
})

test('recorded POC and contiguous value area come from executions, not order-book size', () => {
  const prints = [98, 99, 100, 101, 102].map((p, i) => ({ a: i, t: 1000, p, q: [1, 2, 10, 3, 1][i], m: false }))
  const f = orderFlowAt(columns, prints, 0, 2000, 1)
  assert.equal(f.poc, 100); assert.equal(f.val, 100); assert.equal(f.vah, 101)
})

test('liquidation scenarios exclude incomplete/future candles and keep long/short sides correct', () => {
  const end = 600000, candle = { t: 0, o: 100, h: 101, l: 99, c: 100, v: 100 }
  const past = liquidationScenarios([candle], end, 100, 0.01)
  assert.equal(past.length, 6)
  assert.ok(past.filter(l => l.id.includes('long')).every(l => l.price < 100))
  assert.ok(past.filter(l => l.id.includes('short')).every(l => l.price > 100))
  assert.deepEqual(liquidationScenarios([candle, { ...candle, t: end - 100, c: 500, v: 1e10 }], end, 100, 0.01), past)
  assert.ok(past.every(l => l.note.includes('No actual positions')))
  const actual = recordedLiquidations([{ t: 1000, p: 101, q: 5, side: 'BUY' }, { t: 2000, p: 99, q: 7, side: 'SELL' }, { t: 3000, p: 1, q: 1, side: 'BUY' }], 0, 2000)
  assert.deepEqual(actual.map(l => l.position), ['short', 'long'])
})

test('gamma overlays reject future/stale observations and expired options; plan levels are explicit', () => {
  const end = 1000000
  const gamma = { asOf: end - 1000, details: [{ expiry: end + 86400000, strikes: [{ strike: 110, callOi: 1, putOi: 0, callGex: 10, putGex: 0 }, { strike: 90, callOi: 0, putOi: 1, callGex: 0, putGex: -20 }], flip: 100, maxPain: 95 }] }
  assert.equal(gammaLines(gamma, end).length, 4)
  assert.deepEqual(gammaLines({ ...gamma, asOf: end + 1 }, end), [])
  assert.deepEqual(gammaLines({ ...gamma, asOf: end - 180001 }, end), [])
  assert.deepEqual(gammaLines({ ...gamma, details: [{ ...gamma.details[0], expiry: end - 1 }] }, end), [])
  assert.deepEqual(planLines(null, -1), [])
  assert.deepEqual(planLines(101, 99).map(l => l.price), [101, 99])
})

test('CVD counts only observed executions inside the chart window', () => {
  const s = cumulativeFlow([...trades, { ...trades[0], t: 3000, q: 1e9 }], 0, 2000, 1000)
  assert.equal(s.length, 1); assert.equal(s[0].delta, 207); assert.equal(s[0].cvd, 207)
})

test('data columns and CVD share the plot projection; step bubbles combine prices within time buckets', () => {
  const v = { width: 1600, height: 700, end: 2000, span: 2000, mid: 100, range: 5, step: 1, selectedColumns: ['dom', 'tape'], columns, trades, minTrade: 0, bubbleScale: 1, showProfile: true, showTrades: true, showCvd: true, bubbleInterval: 1000, bubbleMode: 'steps', pointer: null, formatPrice: String }
  const g = heatmapGeometry(v), layout = columnLayout(v.width, v.selectedColumns)
  assert.equal(g.right + 86 + layout.width, v.width)
  assert.equal(g.cvdHeight, 76)
  assert.equal(columnLayout(390, v.selectedColumns).shown.length, 0)
  const bubbles = getTradeBubbles(v)
  assert.equal(bubbles.length, 1); assert.equal(bubbles[0].buy, 405); assert.equal(bubbles[0].sell, 198)
  assert.equal(bubbles[0].count, 3)
})
