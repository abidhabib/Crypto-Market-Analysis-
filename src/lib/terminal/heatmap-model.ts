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

export type ReactionKind = 'touch' | 'rejection' | 'withdrawn' | 'consumed' | 'replenished' | 'absorption'
export const reactionLabels: Record<ReactionKind, string> = {
  touch: 'Zone touched', rejection: 'Observed rejection', withdrawn: 'Possible withdrawal',
  consumed: 'Possible consumption', replenished: 'Size replenished', absorption: 'Possible absorption',
}
export const reactionColors: Record<ReactionKind, string> = {
  touch: '#94a3b8', rejection: '#7dd3fc', withdrawn: '#fbbf24',
  consumed: '#fb923c', replenished: '#2dd4bf', absorption: '#c4b5fd',
}
export const reactionCodes: Record<ReactionKind, string> = {
  touch: 'T', rejection: 'R', withdrawn: 'W', consumed: 'C', replenished: '+', absorption: 'A',
}
export interface HeatmapReaction {
  id: string; t: number; price: number; side: 'bid' | 'ask'; kind: ReactionKind
  usd: number; note: string
}
export interface LiquidityZone {
  price: number; side: 'bid' | 'ask'; usd: number; firstSeen: number; lastSeen: number
  replenishments: number; trough: number; armed: boolean; touchedAt: number | null; lastTouch: number; lastChange: number
}

export function depthQuality(columns: readonly HeatCol[], start: number, end: number) {
  const visible = columns.filter(c => c.t >= start && c.t <= end)
  const last = visible[visible.length - 1] ?? null
  let gaps = 0, resets = 0, missingMs = 0
  for (let i = 1; i < visible.length; i++) {
    const a = visible[i - 1], b = visible[i]
    if (b.t - a.t > 3000) { gaps++; missingMs += b.t - a.t }
    if (a.bookEpoch !== undefined && b.bookEpoch !== undefined && a.bookEpoch !== b.bookEpoch) resets++
  }
  return {
    mode: last?.bookMode ?? 'unknown', ageMs: last ? Math.max(0, end - (last.sourceAt ?? last.t)) : null,
    gaps, resets, sampled: visible.some(c => c.sampled),
    recordedMs: last ? Math.max(0, last.t - visible[0].t - missingMs) : 0,
    last,
  }
}

/** Reconstruct only the recorded past; the playhead is a hard data boundary. */
export function replayFrame(columns: readonly HeatCol[], trades: readonly Trade[], end: number) {
  return { heatCols: columns.filter(c => c.t <= end), trades: trades.filter(t => t.t <= end) }
}

// Stream columns are immutable snapshots. Reuse their price bins during live
// polling and replay; new columns and changed bin sizes get fresh calculations.
const analysisBooks = new WeakMap<HeatCol, { step: number; bid: Map<number, number>; ask: Map<number, number>; threshold: number }>()
export function binnedBook(col: HeatCol, step: number) {
  const cached = analysisBooks.get(col)
  if (cached?.step === step) return cached
  const bid = binDepth(col.bids, step), ask = binDepth(col.asks, step)
  const sizes = [...bid.values(), ...ask.values()].sort((a, b) => a - b)
  const threshold = Math.max(25000, Math.min((sizes[Math.floor(sizes.length / 2)] ?? 0) * 1.8, (sizes[sizes.length - 1] ?? 0) * 0.7))
  const result = { step, bid, ask, threshold }
  analysisBooks.set(col, result)
  return result
}

/** Descriptive snapshot heuristics, never predictions or order-identity claims. */
export function analyzeHeatmap(columns: readonly HeatCol[], trades: readonly Trade[], start: number, end: number, step: number) {
  const cols = columns.filter(c => c.t <= end)
  const prints = trades.filter(t => t.t <= end && t.p > 0 && t.q > 0 && Number.isFinite(t.p * t.q)).sort((a, b) => a.t - b.t)
  const reactions: HeatmapReaction[] = []
  let zones = new Map<string, LiquidityZone>(), previous: HeatCol | null = null, tradeIndex = 0
  const add = (kind: ReactionKind, z: Pick<LiquidityZone, 'price' | 'side'>, t: number, usd: number, note: string) => {
    if (t >= start) reactions.push({ id: `${kind}:${z.side}:${z.price}:${t}`, kind, t, price: z.price, side: z.side, usd, note })
  }
  if (!Number.isFinite(step) || step <= 0) return { zones: [], reactions }
  for (const col of cols) {
    const breakInBook = previous && (col.t - previous.t > 3000 || (previous.bookEpoch !== undefined && col.bookEpoch !== previous.bookEpoch))
    const fresh = col.t - (col.sourceAt ?? col.t) <= 5000
    if (breakInBook || !fresh) zones.clear()
    if (!fresh) { previous = col; continue }
    const current = binnedBook(col, step), threshold = current.threshold
    const executed = new Map<number, { buy: number; sell: number }>()
    while (tradeIndex < prints.length && prints[tradeIndex].t <= col.t) {
      const tr = prints[tradeIndex++]
      if (!previous || tr.t <= previous.t) continue
      const price = Math.round(tr.p / step) * step, totals = executed.get(price) ?? { buy: 0, sell: 0 }
      if (tr.m) totals.sell += tr.p * tr.q; else totals.buy += tr.p * tr.q
      executed.set(price, totals)
    }
    const old = zones, next = new Map<string, LiquidityZone>()
    const reliable = !breakInBook && previous?.bookMode === 'synced' && col.bookMode === 'synced'
    for (const side of ['bid', 'ask'] as const) {
      const prices = [...current[side].keys()]
      const low = Math.min(...prices), high = Math.max(...prices)
      for (const [price, usd] of current[side]) {
        const key = `${side}:${price}`, prior = old.get(key)
        if (!prior && usd < threshold) continue
        const z: LiquidityZone = prior ? { ...prior, usd, lastSeen: col.t } : {
          price, side, usd, firstSeen: col.t, lastSeen: col.t, replenishments: 0,
          trough: usd, armed: false, touchedAt: null, lastTouch: -Infinity, lastChange: -Infinity,
        }
        if (prior && reliable) {
          if (usd < prior.usd * 0.75) { z.armed = true; z.trough = Math.min(prior.trough, usd) }
          if (z.armed && usd >= z.trough * 1.5 && usd - z.trough >= threshold * 0.25 && col.t - z.lastChange > 2000) {
            const restored = usd - z.trough
            z.replenishments++; z.armed = false; z.trough = usd; z.lastChange = col.t
            add('replenished', z, col.t, restored, 'Resting size recovered after an observed drawdown; this does not identify the same order or trader.')
          }
        }
        if (usd >= threshold && Math.abs(col.mid - price) <= step * 1.5 && col.t - z.lastTouch > 10000) {
          z.touchedAt = col.t; z.lastTouch = col.t
          add('touch', z, col.t, usd, 'Recorded mid price reached within 1.5 price bins of this liquidity zone.')
        }
        if (usd >= threshold && z.touchedAt !== null && col.t - z.touchedAt >= 2000 && (side === 'bid' ? col.mid - price : price - col.mid) >= step * 2) {
          add('rejection', z, col.t, usd, 'After a recorded touch, mid price moved at least two bins away while liquidity remained. This is an observed reaction, not a forecast.')
          z.touchedAt = null; z.lastTouch = col.t
        }
        next.set(key, z)
      }
      for (const z of old.values()) {
        if (z.side !== side || !reliable || z.usd < threshold) continue
        const remaining = current[side].get(z.price) ?? 0, removed = z.usd - remaining
        if (removed < z.usd * 0.6 || col.t - z.lastChange < 5000) continue
        const matched = executed.get(z.price)?.[side === 'bid' ? 'sell' : 'buy'] ?? 0
        const covered = side === 'bid' ? z.price >= low && z.price <= col.mid : z.price >= col.mid && z.price <= high
        const crossed = side === 'bid' ? col.mid <= z.price : col.mid >= z.price
        if (matched >= removed * 0.5 && (covered || crossed)) {
          add('consumed', z, col.t, removed, `${Math.round(matched / removed * 100)}% of the observed size reduction was accompanied by matching aggressive volume. Possible consumption, not order-level attribution.`)
        } else if (covered && matched < removed * 0.1 && prints[0]?.t <= (previous?.t ?? 0) && (prints[tradeIndex - 1]?.t ?? -Infinity) > (previous?.t ?? 0)) {
          add('withdrawn', z, col.t, removed, 'Resting size fell at least 60% with little matching recorded execution. Possible withdrawal; cancellations cannot be proven from snapshots.')
        } else continue
        const updated = next.get(`${side}:${z.price}`)
        if (updated) updated.lastChange = col.t
      }
    }
    zones = next; previous = col
  }

  // Closed five-second windows only: no use of trades or price reactions after the playhead.
  const windows = new Map<number, Trade[]>()
  for (const tr of prints) {
    const t = Math.floor(tr.t / 5000) * 5000
    if (t + 5000 > end || t + 5000 < start) continue
    const group = windows.get(t) ?? []; group.push(tr); windows.set(t, group)
  }
  for (const [t, group] of windows) {
    if (group.length < 3 || group[group.length - 1].t - group[0].t < 1000) continue
    const path = cols.filter(c => c.t >= t && c.t <= t + 5000)
    if (path.length < 2 || path[0].t > group[0].t || path[path.length - 1].t < group[group.length - 1].t) continue
    if (path.some((c, i) => c.bookMode !== 'synced' || c.t - (c.sourceAt ?? c.t) > 3000 || (i > 0 && (c.t - path[i - 1].t > 3000 || c.bookEpoch !== path[i - 1].bookEpoch)))) continue
    const first = path[0], last = path[path.length - 1]
    const mids = path.map(c => c.mid)
    if (Math.abs(last.mid - first.mid) > step * 0.75 || Math.max(...mids) - Math.min(...mids) > step * 2) continue
    const localized = group.filter(tr => Math.abs(tr.p - last.mid) <= step * 2)
    if (localized.length < 3) continue
    const buy = localized.reduce((n, tr) => n + (tr.m ? 0 : tr.p * tr.q), 0)
    const sell = localized.reduce((n, tr) => n + (tr.m ? tr.p * tr.q : 0), 0)
    const side = buy >= sell ? 'ask' : 'bid', dominant = Math.max(buy, sell)
    if (dominant / (buy + sell) < 0.75) continue
    const candidates = [...binnedBook(last, step)[side]].filter(([price, usd]) => Math.abs(price - last.mid) <= step * 1.5 && usd >= 25000).sort((a, b) => b[1] - a[1])
    const zone = candidates[0]
    if (!zone || dominant < Math.max(50000, zone[1] * 0.5)) continue
    add('absorption', { side, price: zone[0] }, t + 5000, dominant, `Possible ${side} absorption: at least 75% one-sided executed flow over 5s, with no more than 0.75 bin net mid-price movement near resting liquidity. Snapshot heuristic, not proof of a hidden order.`)
  }
  return {
    zones: [...zones.values()].filter(z => z.usd >= 25000).sort((a, b) => b.usd - a.usd).slice(0, 24),
    reactions: reactions.sort((a, b) => a.t - b.t).slice(-100),
  }
}
