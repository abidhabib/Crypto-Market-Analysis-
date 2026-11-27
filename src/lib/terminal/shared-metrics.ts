/**
 * shared-metrics — the ONE canonical computation for metrics that several
 * panels display. Every panel must read RSI and CVD from here so the same
 * number appears everywhere on screen.
 *
 * Definitions (stated once, used everywhere):
 *  - RSI: Wilder RSI(14) over the stream's 1m candle closes, computed over
 *    the FULL buffered series (never a short slice — Wilder seeding makes
 *    short windows disagree with each other).
 *  - CVD: cumulative volume delta in USD from the stream client's
 *    append-only CVD series (deduped by aggTrade id, never reset by
 *    snapshots). A trade adds +p·q when the buyer is the aggressor (maker
 *    flag m=false) and −p·q when the seller is the aggressor (m=true).
 *  - Live price/mid: best bid/ask mid from the bookTicker-fed bookTop,
 *    falling back to the 24h ticker close, then the last 1m close.
 */

import { useMemo } from 'react'
import { getStream, getCvdCumAt, getCvdLatest, getCvdPoints, getCvdCount, getCvdFirstT } from './stream-client'
import { rsi as rsiSeries } from './indicators'
import { usePoll } from './hooks'
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

/**
 * Input signature for the canonical RSI: everything that can move it —
 * the symbol, the candle count, the forming candle's start and CLOSE,
 * and the newest trade (time + agg id). Panels poll this signature so
 * they all re-read sharedRsi1m() the moment any input moves. (Round-2
 * panels each sampled sharedRsi1m() on their own beat — 500 ms chart,
 * 1 s sentiment/signals, 1.5 s insights — so during a fast move they
 * printed values from different moments, up to ~5 points apart.)
 */
export function rsiInputSignature(): string {
  const st = getStream()
  const k = st.klines[st.klines.length - 1]
  const lt = st.trades[st.trades.length - 1]
  return `${st.symbol}|${st.klines.length}|${k?.t ?? 0}|${k?.c ?? 0}|${lt?.t ?? 0}|${st.lastTradeA}`
}

/** The one cadence every panel uses to display "RSI-14 (1m)". */
export const RSI_POLL_MS = 500

/**
 * The displayed "RSI-14 (1m)" for every panel: sharedRsi1m() re-read on
 * the uniform RSI_POLL_MS poll of rsiInputSignature(), so all panels
 * track the same moving value within ~1 point at any instant.
 */
export function useSharedRsi1m(): number | null {
  const sig = usePoll(rsiInputSignature, RSI_POLL_MS)
  // sharedRsi1m() reads live stream state; the signature IS its input set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => sharedRsi1m(), [sig])
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

/**
 * Canonical CVD readings (USD) from the stream client's append-only CVD
 * series. Windows are cumUsd(now) − cumUsd(now − window) over that series,
 * so a background snapshot replacing the trade buffer can never flip or
 * collapse them (the old buffer-recompute did exactly that).
 */
export function sharedCvd(): SharedCvd | null {
  const latest = getCvdLatest()
  if (!latest) return null
  const to = latest.t
  return {
    session: latest.cum,
    m30: latest.cum - getCvdCumAt(to - 1_800_000),
    m5: latest.cum - getCvdCumAt(to - 300_000),
    trades: getCvdCount(),
    from: getCvdFirstT() ?? to,
    to,
  }
}

/** CVD in USD of trades with fromMs <= t <= toMs, from the append-only series. */
export function cvdUsdBetween(fromMs: number, toMs: number): number {
  return getCvdCumAt(toMs) - getCvdCumAt(fromMs - 1)
}

let cvdSeriesCache: { key: string; out: { t: number; v: number }[] } | null = null

/**
 * Bucketed cumulative CVD series in USD for chart panes, built from the
 * append-only CVD series (last cumulative value per bucket). Values are the
 * session-absolute cumulative, identical in basis to sharedCvd().
 */
export function cvdSeriesUsd(tfMs: number): { t: number; v: number }[] {
  const points = getCvdPoints()
  const last = points[points.length - 1]
  const key = `${tfMs}|${points.length}|${last?.t ?? 0}|${last?.cum ?? 0}`
  if (cvdSeriesCache?.key === key) return cvdSeriesCache.out
  const buckets = new Map<number, number>()
  for (const p of points) {
    const b = Math.floor(p.t / tfMs) * tfMs
    buckets.set(b, p.cum) // points are time-ordered: last write wins per bucket
  }
  const out = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ t, v }))
  cvdSeriesCache = { key, out }
  return out
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

/**
 * Sane live spread in ticks, from the ONE bookTop source (the bookTicker
 * feed) that the header and the order-book rail display — never from a
 * depth snapshot. Returns null when the pair is not displayable: book
 * missing, crossed (ask < bid), or implausibly wide vs the last trade
 * price (>0.5% of price) — a stale/glitched pair, not a real spread.
 * Callers show their last sane value or '—' on null.
 */
export function liveSpreadTicks(tick: number): number | null {
  const st = getStream()
  const bt = st.bookTop
  if (!bt || bt.b <= 0 || bt.a <= 0) return null
  if (bt.a < bt.b) return null
  const spread = bt.a - bt.b
  const px = livePrice()
  if (px && spread > px * 0.005) return null
  return Math.max(1, Math.round(spread / tick))
}
