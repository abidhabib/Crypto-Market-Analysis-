import type { Candle, Trade } from './types'

export type WhaleMode = 'print' | 'sweep' | 'aggressive' | 'level'
export const whaleModes: { id: WhaleMode; label: string; help: string }[] = [
  { id: 'sweep', label: 'Sweep', help: 'Consecutive same-side executions across multiple actual prices within the burst window. A possible sweep, not a verified single order.' },
  { id: 'aggressive', label: 'Aggressive', help: 'Consecutive same-side executions at exactly the same price within the burst window. This does not prove absorption or unchanged quotes.' },
  { id: 'level', label: 'Level', help: 'Buy and sell executions grouped into a price bin and fixed time window. Mixed colours show the actual split.' },
  { id: 'print', label: 'Big print', help: 'One Binance aggregate-trade ID per bubble. An aggregate trade combines same-price fills; it does not identify an account or an entire multi-price order.' },
]
export interface WhaleOptions {
  mode: WhaleMode; threshold: number | 'auto'; step: number; windowMs: number; minLevels: number
}
export interface WhaleEvent {
  id: string; start: number; end: number; t: number; price: number; low: number; high: number
  buy: number; sell: number; buyQty: number; sellQty: number; total: number; qty: number
  count: number; levels: number; firstId: number; lastId: number; tradeIds: number[]
}
export interface WhaleRow { price: number; buy: number; sell: number; buyQty: number; sellQty: number }
export interface WhaleBar { t: number; buy: number; sell: number; largeBuy: number; largeSell: number; largeNet: number; otherNet: number; largeCvd: number; otherCvd: number }

export function validWhaleTrade(t: Trade) {
  return Number.isSafeInteger(t.a) && t.a >= 0 && Number.isFinite(t.t) && t.t > 0 && t.p > 0 && t.q > 0 && Number.isFinite(t.p * t.q) && typeof t.m === 'boolean'
}

/** Later sources replace overlapping IDs, including partial REST/live overlap. */
export function mergeWhaleTrades(...sources: readonly (readonly Trade[])[]): Trade[] {
  const byId = new Map<number, Trade>()
  for (const source of sources) for (const t of source) if (validWhaleTrade(t)) byId.set(t.a, t)
  return [...byId.values()].sort((a, b) => a.t - b.t || a.a - b.a)
}

function eventFrom(trades: readonly Trade[], mode: WhaleMode): WhaleEvent {
  let buy = 0, sell = 0, buyQty = 0, sellQty = 0, timeValue = 0, low = Infinity, high = -Infinity
  const prices = new Set<number>()
  const origin = trades[0].t
  for (const t of trades) {
    const usd = t.p * t.q
    if (t.m) { sell += usd; sellQty += t.q } else { buy += usd; buyQty += t.q }
    timeValue += (t.t - origin) * usd
    low = Math.min(low, t.p); high = Math.max(high, t.p); prices.add(t.p)
  }
  const total = buy + sell, qty = buyQty + sellQty
  return { id: `${mode}:${trades[0].a}:${trades.at(-1)!.a}`, start: origin, end: trades.at(-1)!.t,
    t: origin + timeValue / total, price: total / qty, low, high, buy, sell, buyQty, sellQty, total, qty,
    count: trades.length, levels: prices.size, firstId: trades[0].a, lastId: trades.at(-1)!.a, tradeIds: trades.map(t => t.a) }
}

/** Inputs are deduplicated and clipped before detection: no future trades or overlapping groups. */
export function detectWhaleEvents(trades: readonly Trade[], start: number, end: number, options: WhaleOptions) {
  const observed = mergeWhaleTrades(trades).filter(t => t.t >= start && t.t <= end)
  const step = Math.max(Number.EPSILON, options.step), windowMs = Math.max(1, options.windowMs)
  const sizeThreshold = (sizes: number[]) => {
    if (options.threshold !== 'auto') return Math.max(1, options.threshold)
    sizes.sort((a, b) => a - b)
    return Math.max(1000, sizes[Math.min(sizes.length - 1, Math.floor(sizes.length * 0.995))] ?? 1000)
  }
  // Build detailed objects only for detections, not for every small print on every live tick.
  if (options.mode === 'print') {
    const threshold = sizeThreshold(observed.map(t => t.p * t.q))
    return { observed, candidateCount: observed.length, events: observed.filter(t => t.p * t.q >= threshold).map(t => eventFrom([t], options.mode)), threshold }
  }
  const groups: Trade[][] = []
  if (options.mode === 'level') {
    const bins = new Map<string, Trade[]>()
    for (const t of observed) {
      const key = `${Math.floor(t.t / windowMs)}:${Math.round(t.p / step)}`
      const bucket = bins.get(key) ?? []; bucket.push(t); bins.set(key, bucket)
    }
    groups.push(...bins.values())
  } else {
    let burst: Trade[] = []
    const flush = () => {
      if (!burst.length) return
      if (options.mode !== 'sweep' || new Set(burst.map(t => t.p)).size >= Math.max(2, options.minLevels)) groups.push(burst)
      burst = []
    }
    for (const t of observed) {
      const previous = burst.at(-1)
      if (previous && (t.m !== previous.m || t.a !== previous.a + 1 || t.t - burst[0].t > windowMs || (options.mode === 'aggressive' && t.p !== previous.p))) flush()
      burst.push(t)
    }
    flush()
  }
  const sizes = groups.map(ts => ts.reduce((n, t) => n + t.p * t.q, 0))
  // Auto is the upper 0.5% of this mode's observed candidate sizes, with a $1K floor.
  const threshold = sizeThreshold([...sizes])
  const events = groups.filter((_, i) => sizes[i] >= threshold).map(ts => eventFrom(ts, options.mode)).sort((a, b) => a.t - b.t || a.firstId - b.firstId)
  return { observed, candidateCount: groups.length, events, threshold }
}

export function whaleAnalysis(trades: readonly Trade[], start: number, end: number, timeframe: number, options: WhaleOptions) {
  const detected = detectWhaleEvents(trades, start, end, options)
  const { observed, events } = detected
  const selected = new Set(events.flatMap(e => e.tradeIds))
  const profile = new Map<number, WhaleRow>(), allProfile = new Map<number, WhaleRow>(), buckets = new Map<number, WhaleBar>()
  let buy = 0, sell = 0, buyQty = 0, sellQty = 0, allBuy = 0, allSell = 0, gaps = 0, missingIds = 0
  const gapRanges: { from: number; to: number; missing: number }[] = []
  const addRow = (rows: Map<number, WhaleRow>, t: Trade) => {
    const price = Math.round(t.p / options.step) * options.step
    const row = rows.get(price) ?? { price, buy: 0, sell: 0, buyQty: 0, sellQty: 0 }
    row[t.m ? 'sell' : 'buy'] += t.p * t.q; row[t.m ? 'sellQty' : 'buyQty'] += t.q
    rows.set(price, row)
  }
  for (let i = 0; i < observed.length; i++) {
    const t = observed[i], usd = t.p * t.q, large = selected.has(t.a)
    if (t.m) allSell += usd; else allBuy += usd
    addRow(allProfile, t)
    if (large) {
      if (t.m) { sell += usd; sellQty += t.q } else { buy += usd; buyQty += t.q }
      addRow(profile, t)
    }
    const bucket = Math.floor(t.t / timeframe) * timeframe
    const bar = buckets.get(bucket) ?? { t: bucket, buy: 0, sell: 0, largeBuy: 0, largeSell: 0, largeNet: 0, otherNet: 0, largeCvd: 0, otherCvd: 0 }
    bar[t.m ? 'sell' : 'buy'] += usd
    if (large) bar[t.m ? 'largeSell' : 'largeBuy'] += usd
    buckets.set(bucket, bar)
    const previous = observed[i - 1]
    if (previous && t.a > previous.a + 1) {
      gaps++; missingIds += t.a - previous.a - 1
      gapRanges.push({ from: previous.t, to: t.t, missing: t.a - previous.a - 1 })
    }
  }
  let largeCvd = 0, otherCvd = 0
  const bars = [...buckets.values()].sort((a, b) => a.t - b.t).map(b => {
    b.largeNet = b.largeBuy - b.largeSell; b.otherNet = b.buy - b.sell - b.largeNet
    largeCvd += b.largeNet; otherCvd += b.otherNet
    return { ...b, largeCvd, otherCvd }
  })
  const rows = [...profile.values()].sort((a, b) => a.price - b.price)
  const zones = (side: 'buy' | 'sell') => rows.filter(r => r[side] > 0).sort((a, b) => b[side] - a[side]).slice(0, 2)
  const priceChange = observed.length > 1 ? (observed.at(-1)!.p / observed[0].p - 1) * 100 : null
  return { ...detected, buy, sell, net: buy - sell, allBuy, allSell, otherNet: allBuy - allSell - buy + sell,
    buyVwap: buyQty ? buy / buyQty : null, sellVwap: sellQty ? sell / sellQty : null, bars, profile: rows,
    allProfile: [...allProfile.values()].sort((a, b) => a.price - b.price), buyZones: zones('buy'), sellZones: zones('sell'),
    first: observed[0]?.t ?? null, last: observed.at(-1)?.t ?? null, gaps, missingIds, gapRanges, priceChange }
}
export type WhaleAnalysis = ReturnType<typeof whaleAnalysis>

/** Radius uses square root so circle area is proportional to notional, until the display cap. */
export function whaleRadius(total: number, reference: number, min = 5, max = 38) {
  return Math.min(max, Math.max(min, max * Math.sqrt(Math.max(0, total) / Math.max(1, reference))))
}

export function whaleContext(a: WhaleAnalysis): string {
  if (!a.observed.length) return 'Waiting for recorded executions. Candle history alone does not contain individual large prints.'
  if (!a.events.length) return 'No executions meet this detection threshold in the visible window.'
  const flow = Math.abs(a.net) < (a.buy + a.sell) * 0.1 ? 'Large buying and selling are balanced' : a.net > 0 ? 'Net large buying' : 'Net large selling'
  const price = a.priceChange === null ? '' : Math.abs(a.priceChange) < 0.01 ? '; recorded price is nearly unchanged' : a.priceChange > 0 ? '; recorded price rose' : '; recorded price fell'
  return flow + price + '. Observed flow, not a prediction.'
}

/** Merge real 1m updates into REST candles without replacing a higher-TF open/high/low with an incomplete slice. */
export function whaleCandles(history: readonly Candle[], live: readonly Candle[], timeframe: number): Candle[] {
  const byTime = new Map(history.filter(c => c.o > 0 && c.l > 0 && Number.isFinite(c.h + c.c + c.v)).map(c => [c.t, { ...c }]))
  const buckets = new Map<number, Candle[]>()
  for (const c of live) {
    if (!(c.o > 0 && c.l > 0 && Number.isFinite(c.h + c.c + c.v))) continue
    const t = Math.floor(c.t / timeframe) * timeframe, rows = buckets.get(t) ?? []; rows.push(c); buckets.set(t, rows)
  }
  for (const [t, rows] of buckets) {
    rows.sort((a, b) => a.t - b.t)
    const previous = byTime.get(t), completeStart = rows[0].t === t
    byTime.set(t, { t, o: completeStart ? rows[0].o : previous?.o ?? rows[0].o,
      h: Math.max(previous?.h ?? 0, ...rows.map(c => c.h)), l: Math.min(previous?.l ?? Infinity, ...rows.map(c => c.l)),
      c: rows.at(-1)!.c, v: completeStart ? rows.reduce((n, c) => n + c.v, 0) : previous?.v ?? rows.reduce((n, c) => n + c.v, 0) })
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t)
}
