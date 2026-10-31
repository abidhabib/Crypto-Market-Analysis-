import type { Candle, GammaData, HeatCol, Liq, Trade } from './types'
import { binnedBook, columnAt } from './heatmap-model'

export type HeatmapColumn = 'dom' | 'book' | 'size' | 'depth' | 'volume' | 'delta' | 'cumDelta' | 'svp' | 'quotes' | 'tape'
export const columnInfo: Record<HeatmapColumn, { label: string; width: number; help: string }> = {
  dom: { label: 'SuperDOM', width: 320, help: 'Sold | bid | price | ask | bought. Resting orders and executed trades are separate. Header totals sum visible price rows, in the selected units.' },
  book: { label: 'Book', width: 116, help: 'Resting bids and asks in USDT. Brighter additions / faint removals compare snapshots five seconds apart.' },
  size: { label: 'Size $', width: 74, help: 'Resting bid plus ask notional in each price bin.' },
  depth: { label: 'Depth Σ', width: 86, help: 'Cumulative resting depth, added from each side of the spread outward.' },
  volume: { label: 'Volume', width: 82, help: 'Executed buy (green) and sell (red) volume at each price in the selected scope.' },
  delta: { label: 'Delta', width: 74, help: 'Executed buy minus sell notional at each price. Right = positive; left = negative.' },
  cumDelta: { label: 'Delta Σ', width: 82, help: 'Signed executed delta accumulated from the mid price outward on each side.' },
  svp: { label: 'Recorded VP', width: 94, help: 'All retained executions through the playhead. POC outlined; contiguous 70% value area shaded. This is a rolling buffer, not a complete session.' },
  quotes: { label: 'Quote changes', width: 82, help: 'Observed binned bid/ask size changes between snapshots. Gaps and book rebuilds are excluded; this is not an individual-order count.' },
  tape: { label: 'Tape', width: 176, help: 'Newest recorded trades first; green = buy aggressor, red = sell aggressor. Totals cover the observed last 60 seconds.' },
}
export const columnPresets: { label: string; columns: HeatmapColumn[] }[] = [
  { label: 'SuperDOM + tape', columns: ['dom', 'tape'] },
  { label: 'Book + delta', columns: ['delta', 'book', 'tape'] },
  { label: 'Order flow', columns: ['volume', 'delta', 'cumDelta', 'tape'] },
  { label: 'Depth ladder', columns: ['size', 'depth', 'tape'] },
  { label: 'Profile + quotes', columns: ['book', 'svp', 'quotes', 'tape'] },
]
export interface FlowRow {
  price: number; bid: number; ask: number; buy: number; sell: number; buyQty: number; sellQty: number
  delta: number; volume: number; bidCum: number; askCum: number; cumDelta: number
  recordedBuy: number; recordedSell: number; bidChanges: number; askChanges: number
  addedBid: number; addedAsk: number; removedBid: number; removedAsk: number
}
const validTrade = (t: Trade) => t.p > 0 && t.q > 0 && Number.isFinite(t.p * t.q) && Number.isFinite(t.t)

/** Everything is bounded by end, including book changes and recorded-buffer profiles. */
export function orderFlowAt(columns: readonly HeatCol[], trades: readonly Trade[], start: number, end: number, step: number, scope: 'window' | 'recorded' = 'window', includeQuoteChanges = true) {
  const rows = new Map<number, FlowRow>()
  const row = (price: number) => {
    let r = rows.get(price)
    if (!r) { r = { price, bid: 0, ask: 0, buy: 0, sell: 0, buyQty: 0, sellQty: 0, delta: 0, volume: 0, bidCum: 0, askCum: 0, cumDelta: 0, recordedBuy: 0, recordedSell: 0, bidChanges: 0, askChanges: 0, addedBid: 0, addedAsk: 0, removedBid: 0, removedAsk: 0 }; rows.set(price, r) }
    return r
  }
  const last = columnAt(columns, end), old = columnAt(columns, end - 5000)
  const currentBook = last ? binnedBook(last, step) : null
  const book = { bids: currentBook?.bid ?? new Map<number, number>(), asks: currentBook?.ask ?? new Map<number, number>() }
  const oldBook = old ? binnedBook(old, step) : null
  const past = { bids: oldBook?.bid ?? new Map<number, number>(), asks: oldBook?.ask ?? new Map<number, number>() }
  const uninterrupted = !!last && !!old && last.bookEpoch === old.bookEpoch && columns.filter(c => c.t > old.t && c.t <= last.t).every((c, i, a) => c.t - (a[i - 1]?.t ?? old.t) <= 3000)
  for (const side of ['bids', 'asks'] as const) {
    const bid = side === 'bids'
    for (const [p, usd] of book[side]) row(p)[bid ? 'bid' : 'ask'] = usd
    if (uninterrupted) for (const p of new Set([...book[side].keys(), ...past[side].keys()])) {
      const diff = (book[side].get(p) ?? 0) - (past[side].get(p) ?? 0)
      row(p)[bid ? 'addedBid' : 'addedAsk'] = Math.max(0, diff)
      row(p)[bid ? 'removedBid' : 'removedAsk'] = Math.max(0, -diff)
    }
  }
  let buy = 0, sell = 0, buyQty = 0, sellQty = 0, oldest: number | null = null
  let tapeBuy = 0, tapeSell = 0
  const tape: Trade[] = []
  for (const t of trades) {
    if (!validTrade(t) || t.t > end || !Number.isFinite(step) || step <= 0) continue
    oldest = oldest === null ? t.t : Math.min(oldest, t.t)
    const r = row(Math.round(t.p / step) * step), usd = t.p * t.q
    r[t.m ? 'recordedSell' : 'recordedBuy'] += usd
    if (t.t >= end - 60000) { tape.push(t); if (t.m) tapeSell += usd; else tapeBuy += usd }
    if (scope === 'recorded' || t.t >= start) {
      r[t.m ? 'sell' : 'buy'] += usd; r[t.m ? 'sellQty' : 'buyQty'] += t.q
      if (t.m) { sell += usd; sellQty += t.q } else { buy += usd; buyQty += t.q }
    }
  }
  let previous: HeatCol | null = null
  if (includeQuoteChanges) for (const c of columns) {
    if (c.t > end) break
    if (c.t < start) { previous = c; continue }
    if (previous && c.t - previous.t <= 3000 && c.bookEpoch === previous.bookEpoch && c.bookMode === previous.bookMode && c.t - (c.sourceAt ?? c.t) <= 5000 && previous.t - (previous.sourceAt ?? previous.t) <= 5000) {
      for (const side of ['bids', 'asks'] as const) {
        const key = side === 'bids' ? 'bid' : 'ask'
        const a = binnedBook(previous, step)[key], b = binnedBook(c, step)[key]
        for (const p of new Set([...a.keys(), ...b.keys()])) if ((a.get(p) ?? 0) !== (b.get(p) ?? 0)) row(p)[side === 'bids' ? 'bidChanges' : 'askChanges']++
      }
    }
    previous = c
  }
  const sorted = [...rows.values()].sort((a, b) => a.price - b.price)
  let bidCum = 0, askCum = 0
  for (const r of [...sorted].reverse()) { bidCum += r.bid; r.bidCum = bidCum }
  for (const r of sorted) { askCum += r.ask; r.askCum = askCum; r.delta = r.buy - r.sell; r.volume = r.buy + r.sell }
  const mid = last?.mid ?? 0
  let above = 0, below = 0
  for (const r of sorted.filter(r => r.price >= mid)) { above += r.delta; r.cumDelta = above }
  for (const r of sorted.filter(r => r.price < mid).reverse()) { below += r.delta; r.cumDelta = below }
  const profile = sorted.filter(r => r.recordedBuy + r.recordedSell > 0)
  const total = profile.reduce((n, r) => n + r.recordedBuy + r.recordedSell, 0)
  let peak = -1
  for (let i = 0; i < profile.length; i++) if (peak < 0 || profile[i].recordedBuy + profile[i].recordedSell > profile[peak].recordedBuy + profile[peak].recordedSell) peak = i
  let lo = peak, hi = peak, accumulated = peak < 0 ? 0 : profile[peak].recordedBuy + profile[peak].recordedSell
  while (peak >= 0 && accumulated < total * 0.7 && (lo > 0 || hi < profile.length - 1)) {
    const lower = lo > 0 ? profile[lo - 1].recordedBuy + profile[lo - 1].recordedSell : -1
    const upper = hi < profile.length - 1 ? profile[hi + 1].recordedBuy + profile[hi + 1].recordedSell : -1
    if (lower > upper) { lo--; accumulated += lower } else { hi++; accumulated += upper }
  }
  return { rows, sorted, buy, sell, buyVwap: buyQty ? buy / buyQty : null, sellVwap: sellQty ? sell / sellQty : null,
    tape: tape.sort((a, b) => b.t - a.t), tapeBuy, tapeSell, oldest,
    bestBid: last?.bids.length ? Math.max(...last.bids.map(l => l.p)) : null,
    bestAsk: last?.asks.length ? Math.min(...last.asks.map(l => l.p)) : null,
    poc: peak < 0 ? null : profile[peak].price, val: peak < 0 ? null : profile[lo].price, vah: peak < 0 ? null : profile[hi].price }
}
export type OrderFlow = ReturnType<typeof orderFlowAt>
export interface MapLine { id: string; price: number; label: string; color: string; note: string; kind: 'plan' | 'average' | 'gamma' | 'liq' | 'custom' }

export function planLines(buyAbove: number | null, sellBelow: number | null): MapLine[] {
  return [
    { id: 'plan-buy', price: buyAbove ?? 0, label: 'Buy above', color: '#34d399', note: 'Signals trigger from the nearest tracked ask wall, or the available 24h high. A trigger is not an executed entry.', kind: 'plan' as const },
    { id: 'plan-sell', price: sellBelow ?? 0, label: 'Sell below', color: '#fb7185', note: 'Signals trigger from the nearest tracked bid wall, or the available 24h low. A trigger is not an executed entry.', kind: 'plan' as const },
  ].filter(l => l.price > 0 && Number.isFinite(l.price))
}

/** Leverage scenarios only: candle entry proxy, fixed 0.5% maintenance assumption,
 * no account-level margin, actual positions, leverage distribution or dollar claims. */
export function liquidationScenarios(candles: readonly Candle[], end: number, mid: number, step: number): MapLine[] {
  if (mid <= 0 || step <= 0) return []
  const entries = candles.filter(c => c.t + 60000 <= end && c.t >= end - 120 * 60000 && c.v > 0 && c.l > 0)
  const groups = new Map<string, { price: number; weight: number; side: string; lev: number }>()
  for (const c of entries) for (const lev of [25, 50, 100]) for (const side of ['long', 'short']) {
    const entry = (c.h + c.l + c.c) / 3
    const p = entry * (1 + (side === 'long' ? -1 : 1) * (1 / lev - 0.005))
    if (side === 'long' ? p >= mid : p <= mid) continue
    const price = Math.round(p / step) * step, key = `${side}:${lev}:${price}`
    const g = groups.get(key) ?? { price, weight: 0, side, lev }; g.weight += c.v * entry; groups.set(key, g)
  }
  const picked: MapLine[] = []
  for (const side of ['long', 'short']) for (const g of [...groups.values()].filter(g => g.side === side).sort((a, b) => b.weight - a.weight).slice(0, 3)) picked.push({
    id: `liq-${side}-${g.lev}-${g.price}`, price: g.price, label: `Est ${g.lev}× ${side} liq`, color: side === 'long' ? '#f472b6' : '#c084fc', kind: 'liq',
    note: 'Scenario from completed spot-candle typical prices and volume, with assumed 25×/50×/100× leverage and 0.5% maintenance margin. No actual positions or exchange liquidation map are known; these levels are approximate and differ from futures mark prices.',
  })
  return picked
}

export function gammaLines(data: GammaData | null, end: number): MapLine[] {
  if (!data || data.asOf > end || end - data.asOf > 180000) return []
  const d = data.details.find(d => d.expiry > end && d.expiry - end <= 30 * 86400000)
  if (!d) return []
  const wall = (side: 'call' | 'put') => [...d.strikes].filter(s => (side === 'call' ? s.callOi : s.putOi) > 0).sort((a, b) => Math.abs(side === 'call' ? b.callGex : b.putGex) - Math.abs(side === 'call' ? a.callGex : a.putGex))[0]?.strike
  return [['call', wall('call')], ['put', wall('put')], ['flip', d.flip], ['max pain', d.maxPain]].flatMap(([label, p]) => typeof p === 'number' && p > 0 ? [{ id: `gamma-${label}`, price: p, label: `Γ ${label}`, kind: 'gamma' as const, color: '#fbbf24', note: `Deribit nearest eligible expiry ${new Date(d.expiry).toISOString().slice(0, 10)}. Computed gamma/positioning convention, not a complete view of dealer holdings.` }] : [])
}

export function recordedLiquidations(liqs: readonly Liq[], start: number, end: number) {
  return liqs.filter(l => l.t >= start && l.t <= end && l.p > 0 && l.q > 0).map(l => ({ ...l, usd: l.p * l.q, position: l.side === 'SELL' ? 'long' : 'short' }))
}

export function cumulativeFlow(trades: readonly Trade[], start: number, end: number, interval: number) {
  const buckets = new Map<number, { t: number; buy: number; sell: number }>()
  for (const t of trades) {
    if (!validTrade(t) || t.t < start || t.t > end) continue
    const at = start + Math.floor((t.t - start) / interval) * interval
    const b = buckets.get(at) ?? { t: at, buy: 0, sell: 0 }
    b[t.m ? 'sell' : 'buy'] += t.p * t.q; buckets.set(at, b)
  }
  let cvd = 0
  return [...buckets.values()].sort((a, b) => a.t - b.t).map(b => { cvd += b.buy - b.sell; return { ...b, delta: b.buy - b.sell, cvd } })
}
