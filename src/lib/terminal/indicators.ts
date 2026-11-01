import type { Candle } from './types'
import { TIMEFRAMES } from './constants'
import { candleBucket } from './candle-bucket.js'

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    out.push(i >= period - 1 ? sum / period : null)
  }
  return out
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = []
  const k = 2 / (period + 1)
  let prev: number | null = null
  let seed = 0
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { seed += values[i]; out.push(null); continue }
    if (i === period - 1) { seed += values[i]; prev = seed / period; out.push(prev); continue }
    prev = values[i] * k + (prev as number) * (1 - k)
    out.push(prev)
  }
  return out
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period)
  const upper: (number | null)[] = [], lower: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); continue }
    let s = 0
    for (let j = i - period + 1; j <= i; j++) s += (values[j] - (mid[i] as number)) ** 2
    const sd = Math.sqrt(s / period)
    upper.push((mid[i] as number) + mult * sd)
    lower.push((mid[i] as number) - mult * sd)
  }
  return { mid, upper, lower }
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null]
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1]
    const gain = Math.max(0, ch), loss = Math.max(0, -ch)
    if (i <= period) {
      avgGain += gain / period
      avgLoss += loss / period
      out.push(i === period ? 100 - 100 / (1 + avgGain / (avgLoss || 1e-12)) : null)
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
      out.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-12)))
    }
  }
  return out
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const trs: number[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const pc = i > 0 ? candles[i - 1].c : c.o
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc)))
  }
  const out: (number | null)[] = []
  let prev: number | null = null
  for (let i = 0; i < trs.length; i++) {
    if (i < period - 1) { out.push(null); continue }
    if (i === period - 1) {
      prev = trs.slice(0, period).reduce((a, b) => a + b, 0) / period
      out.push(prev); continue
    }
    prev = ((prev as number) * (period - 1) + trs[i]) / period
    out.push(prev)
  }
  return out
}

/** Aggregate 1m candles into a higher timeframe bucket. */
export function aggregate(candles: Candle[], tfMs: number): Candle[] {
  if (tfMs <= 60_000) return candles
  const out: Candle[] = []
  let cur: Candle | null = null
  for (const c of candles) {
    const bucket = candleBucket(c.t, tfMs)
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur)
      cur = { t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }
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

export function timeframeMs(tf: string): number {
  return TIMEFRAMES.find((t) => t.id === tf)?.ms ?? 60_000
}

/** VWAP from UTC midnight over 1m candles. */
export function sessionVwap(candles: Candle[]): (number | null)[] {
  const out: (number | null)[] = []
  let day = -1, cumPV = 0, cumV = 0
  for (const c of candles) {
    const d = new Date(c.t).getUTCDate()
    if (d !== day) { day = d; cumPV = 0; cumV = 0 }
    const tp = (c.h + c.l + c.c) / 3
    cumPV += tp * c.v
    cumV += c.v
    out.push(cumV > 0 ? cumPV / cumV : null)
  }
  return out
}

/** 70% value area around the POC from a price-binned volume profile. */
export function valueArea(bins: { price: number; buy: number; sell: number }[]) {
  if (!bins.length) return null
  let pocIdx = 0
  for (let i = 1; i < bins.length; i++) if (bins[i].buy + bins[i].sell > bins[pocIdx].buy + bins[pocIdx].sell) pocIdx = i
  const total = bins.reduce((a, b) => a + b.buy + b.sell, 0)
  let acc = bins[pocIdx].buy + bins[pocIdx].sell
  let lo = pocIdx, hi = pocIdx
  while (acc < total * 0.7 && (lo > 0 || hi < bins.length - 1)) {
    const down = lo > 0 ? bins[lo - 1].buy + bins[lo - 1].sell : -1
    const up = hi < bins.length - 1 ? bins[hi + 1].buy + bins[hi + 1].sell : -1
    if (up >= down) { hi++; acc += up } else { lo--; acc += down }
  }
  return { poc: bins[pocIdx].price, vah: bins[hi].price, val: bins[lo].price, total }
}
