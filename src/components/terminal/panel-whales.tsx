'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart, CandlestickSeries, ColorType, CrosshairMode, createSeriesMarkers, type UTCTimestamp, type ISeriesApi,
} from 'lightweight-charts'
import { useTerminal } from '@/lib/terminal/store'
import { getStream } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { aggregate, timeframeMs } from '@/lib/terminal/indicators'
import { symbolMeta, GREEN, RED, GRID, TEXT_DIM } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtTime, fmtUsd } from '@/lib/terminal/format'
import { PanelHeader, StatCard } from './panel-kit'
import { cn } from '@/lib/utils'
import type { Trade } from '@/lib/terminal/types'

const BG = '#0b0d12'
const THRESHOLDS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000]

export default function WhalesPanel() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)
  const [threshold, setThreshold] = useState(50_000)
  const [tf, setTf] = useState('1m')
  const [liveOnly, setLiveOnly] = useState(false)
  const [backfill, setBackfill] = useState<Trade[]>([])

  const chartWrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null)
  const baseRef = useRef<{ t: number; o: number; h: number; l: number; c: number; v: number }[]>([])
  const syncedRef = useRef('')

  useEffect(() => {
    let alive = true
    fetch(`/api/footprint-history?symbol=${symbol}&pages=6`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive && j.trades) setBackfill(j.trades.map((t: number[]) => ({ a: t[0], p: t[1], q: t[2], t: t[3], m: t[4] }))) })
      .catch(() => {})
    return () => { alive = false }
  }, [symbol])

  // build chart once
  useEffect(() => {
    const el = chartWrapRef.current
    if (!el) return
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: BG } as const, textColor: TEXT_DIM, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: CrosshairMode.Normal },
      autoSize: false,
    })
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: GREEN, downColor: RED, borderVisible: false, wickUpColor: GREEN, wickDownColor: RED,
    })
    chartRef.current = chart
    candleRef.current = cs
    markersRef.current = createSeriesMarkers(cs, [])
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      markersRef.current = null
      syncedRef.current = ''
    }
  }, [])

  // fetch 1m base candles on symbol change
  useEffect(() => {
    let alive = true
    fetch(`/api/klines?symbol=${symbol}&interval=1m&limit=500`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j.candles) return
        baseRef.current = j.candles.map((r: number[]) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
        syncedRef.current = ''
      })
      .catch(() => {})
    return () => { alive = false }
  }, [symbol])

  const tick = usePoll(() => getStream().trades.length, 600)

  // merge + redraw + whale markers
  useEffect(() => {
    const cs = candleRef.current
    const markers = markersRef.current
    if (!cs || !markers || !baseRef.current.length) return
    const tfMs = timeframeMs(tf)
    let candles = tfMs <= 60_000 ? [...baseRef.current] : aggregate(baseRef.current, tfMs)
    const live = getStream().klines
    if (live.length) {
      const agg = tfMs <= 60_000 ? live : aggregate(live, tfMs)
      const lastAgg = agg[agg.length - 1]
      const last = candles[candles.length - 1]
      if (lastAgg && last) {
        if (lastAgg.t === last.t) candles = [...candles.slice(0, -1), lastAgg]
        else if (lastAgg.t > last.t) candles = [...candles, lastAgg]
      }
    }
    const key = `${symbol}|${tf}|${candles.length}|${candles[0]?.t}`
    if (key !== syncedRef.current) {
      cs.setData(candles.map((c) => ({ time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })))
      syncedRef.current = key
    } else {
      const last = candles[candles.length - 1]
      cs.update({ time: (last.t / 1000) as UTCTimestamp, open: last.o, high: last.h, low: last.l, close: last.c })
    }
    const trades = liveOnly ? getStream().trades : mergeTrades(backfill, getStream().trades)
    const cutoff = Date.now() - tfMs * 200
    const buckets = new Map<number, { buy: number; sell: number }>()
    for (const t of trades) {
      if (t.t < cutoff) continue
      const n = t.p * t.q
      if (n < threshold) continue
      const b = Math.floor(t.t / tfMs) * tfMs
      const cur = buckets.get(b) ?? { buy: 0, sell: 0 }
      if (t.m) cur.sell += n
      else cur.buy += n
      buckets.set(b, cur)
    }
    markers.setMarkers(
      [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => {
        const buy = v.buy >= v.sell
        return {
          time: (t / 1000) as UTCTimestamp,
          position: buy ? ('belowBar' as const) : ('aboveBar' as const),
          color: buy ? GREEN : RED,
          shape: buy ? ('arrowUp' as const) : ('arrowDown' as const),
          text: fmtUsd(buy ? v.buy : v.sell),
        }
      }),
    )
  }, [tick, symbol, tf, threshold, backfill, liveOnly])

  const trades = usePoll<Trade[]>(() => (liveOnly ? getStream().trades : mergeTrades(backfill, getStream().trades)), 700)

  const whales = useMemo(
    () => trades.filter((t) => t.p * t.q >= threshold).slice(-400).reverse(),
    [trades, threshold],
  )
  const stats = useMemo(() => {
    const cutoff = Date.now() - 30 * 60_000
    const recent = whales.filter((t) => t.t >= cutoff)
    let buy = 0, sell = 0
    for (const t of recent) {
      const n = t.p * t.q
      if (t.m) sell += n
      else buy += n
    }
    return { buy, sell, net: buy - sell, count: recent.length }
  }, [whales])

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-whales">
      <PanelHeader
        title="Whale candles"
        sub="Prints above the threshold are marked on the candles · the list below shows each whale print"
        source="Binance aggTrades"
        right={
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-muted-foreground">≥</span>
            {THRESHOLDS.map((th) => (
              <button key={th} onClick={() => setThreshold(th)}
                className={cn('rounded border px-1.5 py-1 font-mono text-[10px]', threshold === th ? 'border-[#f0b90b]/60 bg-[#f0b90b]/15 text-[#f0b90b]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {fmtUsd(th)}
              </button>
            ))}
            {['1m', '5m', '15m'].map((t) => (
              <button key={t} onClick={() => setTf(t)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', tf === t ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {t}
              </button>
            ))}
            <button onClick={() => setLiveOnly((v) => !v)}
              className={cn('rounded border px-1.5 py-1 text-[10px]', liveOnly ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground')}>
              live only
            </button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-4">
        <StatCard label="Whale prints (30m)" value={stats.count} />
        <StatCard label="Whale buys (30m)" value={fmtUsd(stats.buy)} tone="up" />
        <StatCard label="Whale sells (30m)" value={fmtUsd(stats.sell)} tone="down" />
        <StatCard label="Net whale flow (30m)" value={fmtUsd(stats.net)} tone={stats.net >= 0 ? 'up' : 'down'} />
      </div>
      <div ref={chartWrapRef} className="h-[42%] min-h-[180px] w-full" />
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/60">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="sticky top-0 bg-[#0d1017] text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Time</th>
              <th className="px-2 py-1.5 font-medium">Side</th>
              <th className="px-2 py-1.5 font-medium text-right">Price</th>
              <th className="px-2 py-1.5 font-medium text-right">Qty</th>
              <th className="px-3 py-1.5 font-medium text-right">Notional</th>
            </tr>
          </thead>
          <tbody>
            {whales.slice(0, 120).map((t) => (
              <tr key={t.a} className="border-t border-border/40 hover:bg-muted/30">
                <td className="px-3 py-1 text-muted-foreground">{fmtTime(t.t)}</td>
                <td className={cn('px-2 py-1 font-semibold', t.m ? 'text-[#ea3943]' : 'text-[#16c784]')}>{t.m ? 'SELL' : 'BUY'}</td>
                <td className="px-2 py-1 text-right">{fmtPrice(t.p, meta.tick)}</td>
                <td className="px-2 py-1 text-right">{fmtCompact(t.q)}</td>
                <td className="px-3 py-1 text-right">{fmtUsd(t.p * t.q)}</td>
              </tr>
            ))}
            {whales.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No prints ≥ {fmtUsd(threshold)} in the current window — lower the threshold or wait.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function mergeTrades(a: Trade[], b: Trade[]): Trade[] {
  if (!a.length) return b
  if (!b.length) return a
  const extra = b.filter((t) => t.a > a[a.length - 1].a)
  return extra.length ? [...a, ...extra] : a
}
