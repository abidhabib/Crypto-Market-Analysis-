/**
 * analytics — derived market intelligence computed client-side from the
 * live stream state. Pure functions, called at ~1Hz by the Signals and
 * Insights panels. All original implementations of standard TA/order-flow
 * heuristics (EMA, RSI, ATR, VPIN-style toxicity, trend consistency).
 */

import { getStream, now } from './stream-client'
import type { Candle, Trade, WallRec } from './types'
import { metaFor } from './constants'

// ---------------------------------------------------------------- helpers

export function agg(candles: Candle[], tfMs: number): Candle[] {
  if (!candles.length) return []
  const out: Candle[] = []
  let cur: Candle | null = null
  for (const c of candles) {
    const b = Math.floor(c.t / tfMs) * tfMs
    if (!cur || cur.t !== b) {
      if (cur) out.push(cur)
      cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }
    } else {
      cur.h = Math.max(cur.h, c.h)
      cur.l = Math.min(cur.l, c.l)
      cur.c = c.c
      cur.v += c.v
    }
  }
  if (cur) out.push(cur)
  return out
}

export function ema(values: number[], period: number): number {
  if (!values.length) return NaN
  const k = 2 / (period + 1)
  let e = values[0]
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k)
  return e
}

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN
  let gain = 0, loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d; else loss -= d
  }
  gain /= period; loss /= period
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + Math.max(0, d)) / period
    loss = (loss * (period - 1) + Math.max(0, -d)) / period
  }
  if (loss === 0) return 100
  return 100 - 100 / (1 + gain / loss)
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return NaN
  let sum = 0
  for (let i = candles.length - period; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].h - candles[i].l,
      Math.abs(candles[i].h - candles[i - 1].c),
      Math.abs(candles[i].l - candles[i - 1].c),
    )
    sum += tr
  }
  return sum / period
}

function pctileRank(series: number[], v: number): number {
  if (!series.length) return 50
  let below = 0
  for (const x of series) if (x <= v) below++
  return (below / series.length) * 100
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ---------------------------------------------------------------- regime

export interface Regime {
  label: string          // e.g. "15m downtrend"
  dir: -1 | 0 | 1
  strength: number       // 0..100 (50 neutral)
  rsi1m: number
  rsi15m: number
  atrPct: number         // ATR14(1m) as % of price
  volPctile: number      // 0..100
  volLabel: string
  ema21_1m: number
  ema50_1m: number
  price: number
}

export function regime(): Regime | null {
  const st = getStream()
  const k1m = st.klines
  if (k1m.length < 60) return null
  const price = k1m[k1m.length - 1].c
  const closes1m = k1m.map((c) => c.c)
  const e21 = ema(closes1m.slice(-120), 21)
  const e50 = ema(closes1m.slice(-300), 50)

  const k15 = agg(k1m, 900_000)
  const closes15 = k15.map((c) => c.c)
  const e21_15 = ema(closes15.slice(-60), 21)
  const e50_15 = closes15.length >= 50 ? ema(closes15, 50) : e21_15

  // trend direction from 15m structure, confirmed by 1m
  let dir: -1 | 0 | 1 = 0
  if (e21_15 > e50_15 * 1.0004 && price > e21_15) dir = 1
  else if (e21_15 < e50_15 * 0.9996 && price < e21_15) dir = -1
  else if (e21 > e50 && price > e50) dir = 1
  else if (e21 < e50 && price < e50) dir = -1

  // strength: ema spread + consistency of closes vs ema21 on 15m
  const spreadPct = ((e21_15 - e50_15) / e50_15) * 100
  const recent = closes15.slice(-16)
  const cons = recent.filter((c) => (dir >= 0 ? c > e21_15 : c < e21_15)).length / Math.max(1, recent.length)
  const spreadScore = clamp((Math.abs(spreadPct) / 0.5) * 40, 0, 40)
  const consScore = clamp(Math.abs(cons - 0.5) * 2 * 40, 0, 40)
  const strength = clamp(Math.round(20 + spreadScore + consScore), 0, 100)

  // volatility regime from ATR(14) percentile over the last 6h
  const atrs: number[] = []
  for (let i = Math.max(1, k1m.length - 360); i < k1m.length; i++) {
    const tr = Math.max(k1m[i].h - k1m[i].l, Math.abs(k1m[i].h - k1m[i - 1].c), Math.abs(k1m[i].l - k1m[i - 1].c))
    atrs.push(tr)
  }
  const atrNow = atr(k1m.slice(-15), 14) || 0
  const volPctile = pctileRank(atrs, atrNow)
  const volLabel = volPctile >= 85 ? 'Volatile' : volPctile <= 25 ? 'Quiet' : 'Normal'

  const label = `${dir > 0 ? 'uptrend' : dir < 0 ? 'downtrend' : 'range'} · ${volLabel.toLowerCase()} vol`

  return {
    label, dir, strength,
    rsi1m: rsi(closes1m.slice(-60), 14),
    rsi15m: rsi(closes15.slice(-40), 14),
    atrPct: (atrNow / price) * 100,
    volPctile, volLabel,
    ema21_1m: e21, ema50_1m: e50, price,
  }
}

// ---------------------------------------------------------------- flow

export interface Flow {
  cvdSession: number
  cvd30m: number
  cvd5m: number
  buyer1m: number      // 0..1 share of taker-buys last 60s
  driver15m: number    // 0..1 taker-buy share last 15m
  burst10s: number     // buy-notional burst ratio last 10s (1 = average)
  burstUsd: number
  tps: number          // trades per second (10m)
}

export function flow(): Flow | null {
  const st = getStream()
  const trades = st.trades
  if (trades.length < 10) return null
  const tNow = trades[trades.length - 1].t
  const back = (ms: number) => tNow - ms

  let cvdSession = 0, cvd30 = 0, cvd5 = 0
  let buy1 = 0, tot1 = 0, buy15 = 0, tot15 = 0
  let buy10 = 0
  let count10m = 0
  const buckets10s: { t: number; buy: number; sell: number }[] = []
  let curBucket: { t: number; buy: number; sell: number } | null = null

  for (const tr of trades) {
    const n = tr.p * tr.q
    const b = tr.m ? -n : n
    cvdSession += b
    if (tr.t >= back(1_800_000)) { cvd30 += b; count10m++ }
    if (tr.t >= back(300_000)) {
      cvd5 += b
      if (!tr.m) buy15 += n
      tot15 += n
    }
    if (tr.t >= back(60_000)) { if (!tr.m) buy1 += n; tot1 += n }
    if (tr.t >= back(10_000) && !tr.m) buy10 += n
    if (tr.t >= back(600_000)) {
      if (!curBucket || tr.t - curBucket.t >= 10_000) {
        curBucket = { t: tr.t, buy: 0, sell: 0 }
        buckets10s.push(curBucket)
        if (buckets10s.length > 60) buckets10s.shift()
      }
      if (!tr.m) curBucket.buy += n; else curBucket.sell += n
    }
  }

  const last = buckets10s[buckets10s.length - 1]
  const burstUsd = last ? last.buy : 0
  const avgBuy = buckets10s.length > 6
    ? buckets10s.slice(0, -1).reduce((a, b) => a + b.buy, 0) / (buckets10s.length - 1)
    : 0
  const burst10s = avgBuy > 0 ? burstUsd / avgBuy : 1

  return {
    cvdSession, cvd30m: cvd30, cvd5m: cvd5,
    buyer1m: tot1 > 0 ? buy1 / tot1 : 0.5,
    driver15m: tot15 > 0 ? buy15 / tot15 : 0.5,
    burst10s, burstUsd,
    tps: count10m / 1800,
  }
}

// ---------------------------------------------------------------- book

export interface BookRead {
  imbalance: number      // -100..100 within ±0.25%
  bidNot: number
  askNot: number
  spreadTicks: number
  walls: WallRec[]
}

export function book(): BookRead | null {
  const st = getStream()
  const meta = metaFor(st.symbol)
  const col = st.heatCols[st.heatCols.length - 1]
  const bt = st.bookTop
  if (!col && !bt) return null
  const mid = bt ? (bt.b + bt.a) / 2 : col ? col.mid : 0
  let bidNot = 0, askNot = 0
  if (col) {
    for (const lv of col.bids) if (lv.p >= mid * 0.9975) bidNot += lv.q * lv.p
    for (const lv of col.asks) if (lv.p <= mid * 1.0025) askNot += lv.q * lv.p
  }
  const spreadTicks = bt && bt.a > bt.b ? Math.max(1, Math.round((bt.a - bt.b) / meta.tick)) : 0
  return {
    imbalance: bidNot + askNot > 0 ? ((bidNot - askNot) / (bidNot + askNot)) * 100 : 0,
    bidNot, askNot, spreadTicks,
    walls: st.walls,
  }
}

// ---------------------------------------------------------------- toxicity (VPIN-style)

export interface Tox { value: number; pctile: number; label: string }

export function toxicity(): Tox | null {
  const st = getStream()
  const trades = st.trades
  if (trades.length < 400) return null
  const t30 = trades.filter((x) => x.t >= trades[trades.length - 1].t - 1_800_000)
  if (t30.length < 200) return null
  const totV = t30.reduce((a, t) => a + t.q, 0)
  const bucketV = totV / 40
  if (bucketV <= 0) return null
  const scores: number[] = []
  let acc = 0, buyV = 0, sellV = 0
  for (const t of t30) {
    acc += t.q
    if (t.m) sellV += t.q; else buyV += t.q
    if (acc >= bucketV) {
      scores.push(Math.abs(buyV - sellV) / acc)
      acc = 0; buyV = 0; sellV = 0
    }
  }
  if (acc > 0) scores.push(Math.abs(buyV - sellV) / acc)
  if (scores.length < 12) return null
  const value = scores.slice(-12).reduce((a, b) => a + b, 0) / 12
  const pctile = pctileRank(scores.slice(0, -12), value)
  const label = pctile >= 90 ? 'Toxic' : pctile >= 70 ? 'Elevated' : 'Calm'
  return { value, pctile, label }
}

// ---------------------------------------------------------------- levels

export interface Levels {
  poc: number | null
  vah: number | null
  val: number | null
  sessionHigh: number | null
  sessionLow: number | null
  buyAbove: number | null
  sellBelow: number | null
  buyAboveSrc: string
  sellBelowSrc: string
  wallsAbove: WallRec[]
  wallsBelow: WallRec[]
}

export function levels(): Levels {
  const st = getStream()
  const meta = metaFor(st.symbol)
  const col = st.heatCols[st.heatCols.length - 1]
  const mid = st.bookTop ? (st.bookTop.b + st.bookTop.a) / 2 : col ? col.mid : 0

  // volume profile over last 4h of 1m klines
  let poc: number | null = null, vah: number | null = null, val: number | null = null
  const k4 = st.klines.filter((k) => k.t >= now() - 4 * 3_600_000)
  if (k4.length > 30 && mid > 0) {
    const bin = Math.max(meta.bin, mid * 3e-5)
    const vols = new Map<number, number>()
    for (const k of k4) {
      const b = Math.round(((k.h + k.l + k.c) / 3) / bin) * bin
      vols.set(b, (vols.get(b) ?? 0) + k.v * k.c)
    }
    const arr = [...vols.entries()].sort((a, b) => a[0] - b[0])
    const total = arr.reduce((a, b) => a + b[1], 0)
    let best = 0
    for (const [p, v] of arr) if (v > best) { best = v; poc = p }
    let acc = 0
    let lo: number | null = null, hi: number | null = null
    for (const [p, v] of arr) { acc += v; if (acc >= total * 0.15 && lo === null) lo = p }
    acc = 0
    for (let i = arr.length - 1; i >= 0; i--) { acc += arr[i][1]; if (acc >= total * 0.15 && hi === null) hi = arr[i][0] }
    val = lo; vah = hi
  }

  // session = last 24h from 1m klines
  let sessionHigh: number | null = null, sessionLow: number | null = null
  const k24 = st.klines.filter((k) => k.t >= now() - 24 * 3_600_000)
  if (k24.length > 5) {
    sessionHigh = Math.max(...k24.map((k) => k.h))
    sessionLow = Math.min(...k24.map((k) => k.l))
  }

  const wallsAbove = st.walls.filter((w) => w.side === 'ask' && w.p > mid).sort((a, b) => a.p - b.p)
  const wallsBelow = st.walls.filter((w) => w.side === 'bid' && w.p < mid).sort((a, b) => b.p - a.p)
  const buyAbove = wallsAbove[0]?.p ?? sessionHigh
  const sellBelow = wallsBelow[0]?.p ?? sessionLow
  return {
    poc, vah, val, sessionHigh, sessionLow,
    buyAbove, sellBelow,
    buyAboveSrc: wallsAbove[0] ? 'ask wall' : '24h high',
    sellBelowSrc: wallsBelow[0] ? 'bid wall' : '24h low',
    wallsAbove, wallsBelow,
  }
}

// ---------------------------------------------------------------- signal (prediction)

export interface CheckItem {
  label: string
  value: string
  need: string
  pass: boolean
  hint: string
}

export interface Signal {
  state: 'ARMED' | 'WAIT' | 'PAUSED'
  direction: 'long' | 'short' | null
  verdict: string
  checklist: CheckItem[]
  rr: number | null
  targetCost: number | null
  passedCount: number
  total: number
}

export function signal(): Signal | null {
  const st = getStream()
  const r = regime()
  const f = flow()
  const b = book()
  const l = levels()
  const tox = toxicity()
  if (!r || !f || !b || !l || st.status !== 'live') {
    return {
      state: 'PAUSED', direction: null,
      verdict: st.status !== 'live' ? 'waiting for the live stream to connect' : 'order book syncing — metrics arming up',
      checklist: [], rr: null, targetCost: null, passedCount: 0, total: 6,
    }
  }
  const meta = metaFor(st.symbol)
  const mid = r.price
  const long = r.dir >= 0 && f.cvd30m >= 0
  const short = r.dir <= 0 && f.cvd30m <= 0
  const direction: 'long' | 'short' | null = long ? 'long' : short ? 'short' : null

  const target = direction === 'short' ? l.sellBelow : l.buyAbove
  const stop = direction === 'short' ? l.buyAbove : l.sellBelow
  const cost = (b.spreadTicks * meta.tick) + mid * 0.0002
  let rr: number | null = null
  let targetCost: number | null = null
  if (target && stop && direction) {
    const reward = Math.abs(target - mid)
    const risk = Math.abs(stop - mid)
    rr = risk > 0 ? (reward - cost) / risk : null
    targetCost = reward > 0 ? cost / reward : null
  }

  const driverAligned = direction === 'long' ? f.driver15m : direction === 'short' ? 1 - f.driver15m : 0.5
  const checklist: CheckItem[] = [
    {
      label: 'Trend strength', value: `${r.strength}/100`, need: '≥ 22',
      pass: r.strength >= 22,
      hint: 'EMA-structure consistency on the 15m chart — low values mean choppy, directionless tape',
    },
    {
      label: 'Trade driver', value: `${(driverAligned * 100).toFixed(0)}%`, need: '≥ 55%',
      pass: driverAligned >= 0.55,
      hint: 'share of aggressive volume flowing in the signal direction over the last 15m',
    },
    {
      label: 'R/R after costs', value: rr != null ? rr.toFixed(2) : '—', need: '≥ 1.10',
      pass: rr != null && rr >= 1.1,
      hint: 'reward to the decision level vs risk to the opposite level, minus spread + fees',
    },
    {
      label: 'Target cost ratio', value: targetCost != null ? `${(targetCost * 100).toFixed(2)}%` : '—', need: '≤ 0.35%',
      pass: targetCost != null && targetCost <= 0.0035,
      hint: 'round-trip cost as a share of the expected move — high values eat the edge',
    },
    {
      label: 'Volatility regime', value: `${r.volPctile.toFixed(0)}th pctile`, need: '< 92',
      pass: r.volPctile < 92,
      hint: 'extreme ATR percentile = chaotic tape where levels fail',
    },
    {
      label: 'Flow toxicity', value: tox ? `${tox.pctile.toFixed(0)}th pctile` : '—', need: '< 90',
      pass: !tox || tox.pctile < 90,
      hint: 'VPIN-style measure — toxic flow means informed aggressors hunting resting orders',
    },
  ]
  const passedCount = checklist.filter((c) => c.pass).length
  const state: Signal['state'] = passedCount === checklist.length && direction ? 'ARMED' : 'WAIT'

  let verdict: string
  if (state === 'ARMED') {
    verdict = `${direction === 'long' ? 'Bullish' : 'Bearish'} setup armed — ${r.label}, flow aligned, ${passedCount}/6 conditions met`
  } else if (!direction) {
    verdict = `No clean direction — trend and flow disagree (${r.label}, CVD-30m ${f.cvd30m >= 0 ? 'up' : 'down'}) — stay flat and wait`
  } else {
    const unmet = checklist.filter((c) => !c.pass)
    verdict = `Leaning ${direction} (${r.label}) but waiting: ${unmet.slice(0, 2).map((c) => c.label.toLowerCase()).join(' & ')} not confirmed`
  }

  return { state, direction, verdict, checklist, rr, targetCost, passedCount, total: checklist.length }
}

// ---------------------------------------------------------------- insights feed

export type InsightCat = 'flow' | 'liquidity' | 'whales' | 'derivs' | 'regime'
export interface Insight {
  id: string
  t: number
  cat: InsightCat
  sev: 'info' | 'warn' | 'hot'
  text: string
}

const seen = new Set<string>()
const store: Insight[] = []
let lastRegimeLabel = ''
let lastCvdSign = 0
let lastImbalance = 0
let lastFunding = 0
const seenTradeIds = new Set<number>()
let wallKeysPrev = new Set<string>()
const wallEventCooldown = new Map<string, number>()

function push(text: string, cat: InsightCat, sev: Insight['sev'], t: number) {
  const id = `${t}|${cat}|${text.slice(0, 40)}`
  if (seen.has(id)) return
  seen.add(id)
  if (seen.size > 800) {
    // trim old keys
    let n = 0
    for (const k of seen) { seen.delete(k); if (++n > 200) break }
  }
  store.unshift({ id, t, cat, sev, text })
  if (store.length > 80) store.length = 80
}

/** Call at 1–2Hz. Returns the rolling insight feed (newest first). */
export function insights(): Insight[] {
  const st = getStream()
  const meta = metaFor(st.symbol)
  const tNow = now()

  // 1. pull / spoof events
  for (const ev of st.pulls.slice(-8)) {
    if (tNow - ev.t > 8_000) continue
    push(
      `${ev.side === 'ask' ? 'Ask' : 'Bid'} level ${fmtUsd(ev.size)} @ ${fmtP(ev.p, meta.tick)} pulled before trading after ${(ev.lasted / 1000).toFixed(0)}s — possible spoof${ev.count > 1 ? ` (×${ev.count})` : ''}`,
      'liquidity', ev.size > 100_000 ? 'warn' : 'info', ev.t,
    )
  }
  // 2. sweeps
  for (const ev of st.sweeps.slice(-6)) {
    if (tNow - ev.t > 8_000) continue
    push(
      `${ev.side === 'ask' ? 'Sellers swept the bid' : 'Buyers swept the ask'}: ${fmtUsd(ev.size)} level consumed @ ${fmtP(ev.p, meta.tick)} (print ${fmtUsd(ev.trade)})`,
      'flow', ev.trade > 250_000 ? 'hot' : 'info', ev.t,
    )
  }
  // 3. icebergs
  for (const ev of st.icebergs.slice(-4)) {
    if (tNow - ev.t > 10_000) continue
    push(`Iceberg suspicion: ${ev.side} @ ${fmtP(ev.p, meta.tick)} refilled ×${ev.refills} (~${fmtUsd(ev.size)} seen)`, 'liquidity', 'info', ev.t)
  }
  // 4. new walls + vanished walls
  const wallKeys = new Set<string>()
  for (const w of st.walls) {
    const key = `${w.side}:${w.p.toFixed(0)}`
    wallKeys.add(key)
    if (!wallKeysPrev.has(key) && tNow - w.firstSeen < 12_000) {
      const lastEmit = wallEventCooldown.get(key) ?? 0
      if (tNow - lastEmit > 120_000) { // suppress re-appear spam when size oscillates around the threshold
        wallEventCooldown.set(key, tNow)
        if (wallEventCooldown.size > 400) wallEventCooldown.clear()
        push(`New ${w.side} wall ${fmtUsd(w.q)} @ ${fmtP(w.p, meta.tick)} appeared`, 'liquidity', 'info', w.firstSeen)
      }
    }
  }
  wallKeysPrev = wallKeys
  // 5. whale prints ≥ $100K
  const trades = st.trades
  for (let i = trades.length - 1; i >= 0 && i >= trades.length - 400; i--) {
    const tr = trades[i]
    if (seenTradeIds.has(tr.a)) continue
    const n = tr.p * tr.q
    if (n < 100_000) continue
    if (tNow - tr.t > 60_000) continue
    seenTradeIds.add(tr.a)
    if (seenTradeIds.size > 2000) seenTradeIds.clear()
    push(`Whale ${tr.m ? 'SELL' : 'BUY'} ${fmtUsd(n)} @ ${fmtP(tr.p, meta.tick)}`, 'whales', n >= 500_000 ? 'hot' : 'info', tr.t)
  }
  // 6. liquidations
  for (const liq of st.liqs.slice(-4)) {
    if (tNow - liq.t > 10_000) continue
    const n = liq.p * liq.q
    if (n < 10_000) continue
    push(`${liq.side === 'BUY' ? 'Short' : 'Long'} liquidation ${fmtUsd(n)} @ ${fmtP(liq.p, meta.tick)}`, 'derivs', n >= 200_000 ? 'hot' : 'info', liq.t)
  }
  // 7. regime change
  const r = regime()
  if (r && lastRegimeLabel && r.label !== lastRegimeLabel) {
    push(`Regime shift: ${lastRegimeLabel} → ${r.label}`, 'regime', 'warn', tNow)
  }
  if (r) lastRegimeLabel = r.label
  // 8. CVD flip (5m)
  const f = flow()
  if (f) {
    const sign = Math.sign(f.cvd5m)
    if (sign !== 0 && lastCvdSign !== 0 && sign !== lastCvdSign) {
      push(`5m CVD flipped ${sign > 0 ? 'bullish' : 'bearish'} (${fmtUsd(f.cvd5m)})`, 'flow', 'warn', tNow)
    }
    if (sign !== 0) lastCvdSign = sign
    // buy burst
    if (f.burst10s > 3 && f.burstUsd > 80_000) {
      push(`Buy burst: ${fmtUsd(f.burstUsd)} of aggressive buying in 10s (${f.burst10s.toFixed(1)}× average)`, 'flow', 'hot', tNow)
    }
    // book imbalance extreme
    const b = book()
    if (b && Math.abs(b.imbalance) > 55 && Math.sign(b.imbalance) !== Math.sign(lastImbalance)) {
      push(`Book skew: ${b.imbalance > 0 ? 'bids' : 'asks'} dominate ±0.25% (${b.imbalance.toFixed(0)}% imbalance)`, 'liquidity', 'info', tNow)
    }
    if (b) lastImbalance = b.imbalance
  }
  // 9. funding notable
  const mark = st.mark
  if (mark && Math.abs(mark.funding) >= 0.0003 && Math.abs(mark.funding) > Math.abs(lastFunding) * 1.5) {
    push(`Perp funding elevated: ${(mark.funding * 100).toFixed(4)}% — ${mark.funding > 0 ? 'longs pay' : 'shorts pay'}`, 'derivs', 'info', tNow)
  }
  if (mark) lastFunding = mark.funding
  // 10. RSI extremes
  if (r && (r.rsi1m <= 28 || r.rsi1m >= 72)) {
    push(`1m RSI ${r.rsi1m.toFixed(0)} — ${r.rsi1m <= 28 ? 'oversold stretch' : 'overbought stretch'}`, 'regime', 'info', tNow)
  }

  return store
}

/** One-paragraph auto summary of the current market state. */
export function marketSummary(): string | null {
  const r = regime()
  const f = flow()
  const b = book()
  const tox = toxicity()
  if (!r || !f || !b) return null
  const parts: string[] = []
  parts.push(`The 15m tape is in a ${r.label} (strength ${r.strength}/100).`)
  parts.push(`Aggressive flow is ${f.cvd30m >= 0 ? 'net buying' : 'net selling'} — 30m CVD ${fmtUsd(f.cvd30m)}, ${(f.driver15m * 100).toFixed(0)}% of 15m volume is taker-buys.`)
  parts.push(`The book within ±0.25% is ${b.imbalance > 8 ? `bid-heavy (${b.imbalance.toFixed(0)}%)` : b.imbalance < -8 ? `ask-heavy (${Math.abs(b.imbalance).toFixed(0)}%)` : 'balanced'}.`)
  if (tox) parts.push(`Flow toxicity sits in the ${tox.pctile.toFixed(0)}th percentile (${tox.label.toLowerCase()}).`)
  if (r.volPctile >= 85) parts.push('Volatility is in the top decile — expect fast moves and thin breaks.')
  return parts.join(' ')
}

// ---------------------------------------------------------------- small fmt
function fmtUsd(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}
function fmtP(p: number, tick: number): string {
  const dp = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick))))
  return p.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
