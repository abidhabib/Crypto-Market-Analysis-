import type { Trade } from './types'

export interface FootprintRow {
  index: number; price: number; buy: number; sell: number; buyUsd: number; sellUsd: number
  buyImbalance: boolean; sellImbalance: boolean
}
export interface FootprintBar {
  t: number; end: number; o: number; h: number; l: number; c: number
  rows: Map<number, FootprintRow>; buy: number; sell: number; buyUsd: number; sellUsd: number
  count: number; delta: number; deltaPct: number; poc: number; buyStack: number; sellStack: number
  forming: boolean; partial: boolean; gaps: number; complete: boolean
}
export interface FootprintOptions { interval: number; tick: number; rowTicks: number; ratio: number; minQty: number; end: number }

export function mergeFootprintTrades(...sources: readonly (readonly Trade[])[]): Trade[] {
  const ids = new Map<number, Trade>()
  for (const source of sources) for (const t of source) {
    if (Number.isSafeInteger(t.a) && t.a >= 0 && Number.isFinite(t.p) && Number.isFinite(t.q) && Number.isFinite(t.t) && t.p > 0 && t.q > 0 && t.t > 0 && Number.isFinite(t.p * t.q) && typeof t.m === 'boolean') ids.set(t.a, t)
  }
  return [...ids.values()].sort((a, b) => a.t - b.t || a.a - b.a)
}

/** Fixed integer-tick bins; no viewport-dependent rebucketing or candle-derived flow. */
export function buildFootprint(source: readonly Trade[], options: FootprintOptions): FootprintBar[] {
  const { interval, tick, ratio, minQty, end } = options
  if (!(interval > 0 && tick > 0 && options.rowTicks >= 1 && ratio > 1 && minQty >= 0) || !Number.isFinite(interval + tick + options.rowTicks + ratio + minQty + end)) return []
  const rowTicks = Math.round(options.rowTicks), step = rowTicks * tick
  const trades = mergeFootprintTrades(source).filter(t => t.t <= end)
  const bars = new Map<number, FootprintBar>()
  for (const tr of trades) {
    const time = Math.floor(tr.t / interval) * interval
    let bar = bars.get(time)
    if (!bar) {
      bar = { t: time, end: time + interval, o: tr.p, h: tr.p, l: tr.p, c: tr.p, rows: new Map(), buy: 0, sell: 0, buyUsd: 0, sellUsd: 0, count: 0, delta: 0, deltaPct: 0, poc: 0, buyStack: 0, sellStack: 0, forming: time + interval > end, partial: time <= trades[0].t && trades[0].t < time + interval, gaps: 0, complete: false }
      bars.set(time, bar)
    }
    bar.h = Math.max(bar.h, tr.p); bar.l = Math.min(bar.l, tr.p); bar.c = tr.p; bar.count++
    const index = Math.floor(Math.round(tr.p / tick) / rowTicks)
    const row = bar.rows.get(index) ?? { index, price: Number((index * step).toPrecision(14)), buy: 0, sell: 0, buyUsd: 0, sellUsd: 0, buyImbalance: false, sellImbalance: false }
    if (tr.m) { row.sell += tr.q; row.sellUsd += tr.p * tr.q; bar.sell += tr.q; bar.sellUsd += tr.p * tr.q }
    else { row.buy += tr.q; row.buyUsd += tr.p * tr.q; bar.buy += tr.q; bar.buyUsd += tr.p * tr.q }
    bar.rows.set(index, row)
  }
  // Missing aggregate IDs taint every intersecting bar, including boundary gaps.
  for (let i = 1; i < trades.length; i++) {
    const a = trades[i - 1], b = trades[i]
    if (b.a <= a.a + 1) continue
    for (const bar of bars.values()) if (bar.t <= b.t && bar.end > a.t) bar.gaps += b.a - a.a - 1
  }
  for (const bar of bars.values()) {
    // A timestamp after the close is needed to establish the recording's right boundary.
    if (!bar.forming && trades.at(-1)!.t < bar.end) bar.partial = true
    bar.delta = bar.buy - bar.sell
    bar.deltaPct = bar.buy + bar.sell ? bar.delta / (bar.buy + bar.sell) * 100 : 0
    bar.complete = !bar.forming && !bar.partial && !bar.gaps
    let pocVolume = -1, buyRun = 0, sellRun = 0, previous: number | null = null
    for (const row of [...bar.rows.values()].sort((a, b) => a.index - b.index)) {
      const lower = bar.rows.get(row.index - 1), upper = bar.rows.get(row.index + 1)
      // Buy at ask compares with sells one bin LOWER. Sell at bid compares with buys one bin HIGHER.
      // Missing/zero opposing volume is deliberately not an infinite-ratio imbalance.
      row.buyImbalance = !!lower && lower.sell > 0 && row.buy >= minQty && row.buy >= ratio * lower.sell
      row.sellImbalance = !!upper && upper.buy > 0 && row.sell >= minQty && row.sell >= ratio * upper.buy
      if (previous === null || row.index !== previous + 1) { buyRun = 0; sellRun = 0 }
      buyRun = row.buyImbalance ? buyRun + 1 : 0; sellRun = row.sellImbalance ? sellRun + 1 : 0
      bar.buyStack = Math.max(bar.buyStack, buyRun); bar.sellStack = Math.max(bar.sellStack, sellRun); previous = row.index
      const volume = row.buy + row.sell
      if (volume > pocVolume) { pocVolume = volume; bar.poc = row.price }
    }
  }
  return [...bars.values()].sort((a, b) => a.t - b.t)
}

export function footprintReading(bar: FootprintBar | undefined) {
  if (!bar) return { title: 'Waiting for executions', note: 'Footprints require actual trade-by-price data.', tone: 'neutral' }
  if (!bar.complete) return { title: bar.gaps ? 'Incomplete recording' : bar.forming ? 'Candle still forming' : 'Partial candle recording', note: bar.gaps ? `${bar.gaps} aggregate IDs missing; directional reading withheld.` : 'Wait for a fully recorded closed candle before assessing pressure.', tone: 'neutral' }
  if (bar.count < 20) return { title: 'Small execution sample', note: `${bar.count} aggregate IDs; at least 20 required by this reading filter.`, tone: 'neutral' }
  if (bar.deltaPct >= 15 && bar.c < bar.o) return { title: 'Buying did not lift price', note: 'Positive delta with a lower close. Possible opposing selling; absorption is not proven.', tone: 'caution' }
  if (bar.deltaPct <= -15 && bar.c > bar.o) return { title: 'Selling did not lower price', note: 'Negative delta with a higher close. Possible opposing buying; absorption is not proven.', tone: 'caution' }
  if (bar.buyStack >= 3 && bar.deltaPct >= 15 && bar.c > bar.o) return { title: 'Buyer initiative observed', note: 'Buy stack, positive delta and higher close align. Watch whether later closes hold above this candle’s high.', tone: 'buy' }
  if (bar.sellStack >= 3 && bar.deltaPct <= -15 && bar.c < bar.o) return { title: 'Seller initiative observed', note: 'Sell stack, negative delta and lower close align. Watch whether later closes hold below this candle’s low.', tone: 'sell' }
  return { title: 'No aligned directional setup', note: 'Price response, delta and a three-level stack do not align. No trade trigger inferred.', tone: 'neutral' }
}
