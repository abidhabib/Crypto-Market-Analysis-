import type { HeatCol, Level, Trade } from './types'

/** Nearby fills share one bubble; opposite aggressors remain separately counted. */
export function groupTrades(trades: readonly Trade[], start: number, end: number, timeStep: number, priceStep: number, minimum: number) {
  const groups = new Map<string, { t: number; p: number; usd: number; buy: number; sell: number; count: number }>()
  if (timeStep <= 0 || priceStep <= 0) return []
  for (const tr of trades) {
    const usd = tr.p * tr.q
    if (tr.t < start || tr.t > end || !Number.isFinite(usd) || tr.p <= 0 || tr.q <= 0) continue
    const key = `${Math.floor(tr.t / timeStep)}:${Math.round(tr.p / priceStep)}`
    const g = groups.get(key) ?? { t: 0, p: 0, usd: 0, buy: 0, sell: 0, count: 0 }
    const total = g.usd + usd
    g.t += (tr.t - g.t) * usd / total
    g.p += (tr.p - g.p) * usd / total
    g.usd = total
    if (tr.m) g.sell += usd; else g.buy += usd
    g.count++
    groups.set(key, g)
  }
  return [...groups.values()].filter(g => g.usd >= minimum).sort((a, b) => a.usd - b.usd)
}

/** Area is proportional to notional between the visibility and maximum-size caps. */
export function bubbleRadius(usd: number, scale = 1.35) {
  return Math.min(48, Math.max(6, 8 * Math.sqrt(Math.max(0, usd) / 10000) * scale))
}

export function binDepth(levels: readonly Level[], step: number) {
  const bins = new Map<number, number>()
  if (!Number.isFinite(step) || step <= 0) return bins
  for (const { p, q } of levels) {
    if (!Number.isFinite(p * q) || p <= 0 || q <= 0) continue
    const price = Math.round(p / step) * step
    bins.set(price, (bins.get(price) ?? 0) + p * q)
  }
  return bins
}

/** Never substitute the present order book for a historical cursor position. */
export function columnAt(columns: readonly HeatCol[], time: number, maxGap = 3000): HeatCol | null {
  let lo = 0, hi = columns.length - 1, found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (columns[mid].t <= time) { found = mid; lo = mid + 1 } else hi = mid - 1
  }
  return found >= 0 && time - columns[found].t <= maxGap ? columns[found] : null
}

export function summarizeFlow(trades: readonly Trade[], start: number, end: number, step: number) {
  let buy = 0, sell = 0, count = 0, first: number | null = null
  const volume = new Map<number, number>()
  for (const tr of trades) {
    if (tr.t < start || tr.t > end || tr.p <= 0 || tr.q <= 0 || !Number.isFinite(tr.p * tr.q)) continue
    const usd = tr.p * tr.q
    if (tr.m) sell += usd; else buy += usd
    count++
    first = first === null ? tr.t : Math.min(first, tr.t)
    const price = Math.round(tr.p / step) * step
    volume.set(price, (volume.get(price) ?? 0) + usd)
  }
  let poc: number | null = null, largest = 0
  for (const [price, usd] of volume) if (usd > largest) { poc = price; largest = usd }
  return { buy, sell, delta: buy - sell, count, first, poc, buyShare: buy + sell > 0 ? buy / (buy + sell) : null }
}

export function nearbyLiquidity(col: HeatCol | null, step: number, halfRange: number) {
  const ranked = (side: 'bids' | 'asks') => {
    if (!col) return []
    return [...binDepth(col[side], step)]
      .filter(([p]) => side === 'bids' ? p < col.mid && p >= col.mid - halfRange : p > col.mid && p <= col.mid + halfRange)
      .map(([price, usd]) => ({ price, usd, distance: Math.abs(price / col.mid - 1) * 100 }))
      .sort((a, b) => b.usd - a.usd).slice(0, 3)
  }
  return { bids: ranked('bids'), asks: ranked('asks') }
}
