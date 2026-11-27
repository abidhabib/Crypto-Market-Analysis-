/**
 * shared-metrics — the ONE canonical computation for metrics that several
 * panels display. Every panel must read RSI and CVD from here so the same
 * number appears everywhere on screen.
 *
 * Definitions (stated once, used everywhere):
 *  - RSI: Wilder RSI(14) over the stream's 1m candle closes, computed over
 *    the FULL buffered series (never a short slice — Wilder seeding makes
 *    short windows disagree with each other).
 *  - CVD: cumulative volume delta in USD from the stream's aggTrade buffer.
 *    A trade adds +p·q when the buyer is the aggressor (maker flag m=false)
 *    and −p·q when the seller is the aggressor (m=true).
 *  - Live price/mid: best bid/ask mid from the bookTicker-fed bookTop,
 *    falling back to the 24h ticker close, then the last 1m close.
 */

import { getStream } from './stream-client'
import { rsi as rsiSeries } from './indicators'
import type { Candle, Trade } from './types'

export const RSI_PERIOD = 14
export const RSI_BASIS = 'RSI-14 (Wilder) · stream 1m closes'

/** Last RSI value from a closes series, using the canonical implementation. */
export function rsiFromCloses(closes: number[], period = RSI_PERIOD): number | null {
  if (closes.length < period + 2) return null
  const arr = rsiSeries(closes, period)
  const v = arr[arr.length - 1]
  return v == null || !isFinite(v) ? null : v
}

/** Canonical 1m RSI from the live stream state. */
export function sharedRsi1m(): number | null {
  const klines = getStream().klines
  return rsiFromCloses(klines.map((c) => c.c))
}

/** Canonical RSI for an arbitrary candle series (e.g. aggregated 15m). */
export function sharedRsiFor(candles: Candle[]): number | null {
  return rsiFromCloses(candles.map((c) => c.c))
}

/** Signed USD delta of one trade: buyer-aggressor +, seller-aggressor −. */
export function tradeDeltaUsd(t: Trade): number {
  return t.m ? -t.p * t.q : t.p * t.q
}

/** CVD in USD over trades with t >= sinceMs (all trades when omitted). */
export function cvdUsdFromTrades(trades: readonly Trade[], sinceMs = 0): number {
  let sum = 0
  for (const t of trades) if (t.t >= sinceMs) sum += tradeDeltaUsd(t)
  return sum
}

export interface SharedCvd {
  session: number   // whole buffered window, USD
  m30: number       // last 30 minutes, USD
  m5: number        // last 5 minutes, USD
  trades: number    // trades in the buffer
  from: number      // oldest buffered trade time
  to: number        // newest buffered trade time
}

/** Canonical CVD readings from the live stream state (USD, labelled). */
export function sharedCvd(): SharedCvd | null {
  const trades = getStream().trades
  if (!trades.length) return null
  const to = trades[trades.length - 1].t
  return {
    session: cvdUsdFromTrades(trades),
    m30: cvdUsdFromTrades(trades, to - 1_800_000),
    m5: cvdUsdFromTrades(trades, to - 300_000),
    trades: trades.length,
    from: trades[0].t,
    to,
  }
}

/** Bucketed cumulative CVD series in USD for chart panes (same formula). */
export function cvdSeriesUsd(trades: readonly Trade[], tfMs: number): { t: number; v: number }[] {
  const buckets = new Map<number, number>()
  for (const t of trades) {
    const b = Math.floor(t.t / tfMs) * tfMs
    buckets.set(b, (buckets.get(b) ?? 0) + tradeDeltaUsd(t))
  }
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  let cum = 0
  return sorted.map(([t, v]) => { cum += v; return { t, v: cum } })
}

/** Live last price: last trade, else ticker close, else last candle close. */
export function livePrice(): number | null {
  const st = getStream()
  const lastTrade = st.trades[st.trades.length - 1]
  if (lastTrade) return lastTrade.p
  if (st.ticker?.c) return st.ticker.c
  const k = st.klines[st.klines.length - 1]
  return k ? k.c : null
}

/** Live mid from the single bookTop source (bookTicker feed). */
export function liveMid(): number | null {
  const st = getStream()
  if (st.bookTop && st.bookTop.a > 0 && st.bookTop.b > 0) return (st.bookTop.b + st.bookTop.a) / 2
  return livePrice()
}
