'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries, AreaSeries,
  ColorType, CrosshairMode, LineStyle, createSeriesMarkers,
  type IChartApi, type ISeriesApi, type UTCTimestamp, type IPriceLine,
} from 'lightweight-charts'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, setStreamSymbol, now as streamNow } from '@/lib/terminal/stream-client'
import { usePoll, useHotkeys } from '@/lib/terminal/hooks'
import { candleBucket } from '@/lib/terminal/candle-bucket.js'
import TimeframePicker from './timeframe-picker'
import { aggregate, timeframeMs, ema, bollinger, rsi, sessionVwap } from '@/lib/terminal/indicators'
import { cvdSeriesUsd, useSharedRsi1m, liveMid } from '@/lib/terminal/shared-metrics'
import { levels as keyLevels } from '@/lib/terminal/analytics'
import { metaFor, GREEN, RED, GRID, TEXT_DIM } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtPct } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge } from './panel-kit'
import { cn } from '@/lib/utils'
import type { Candle } from '@/lib/terminal/types'

const BG = '#0c0c0c'

interface HLine { id: number; price: number }

/**
 * Module-level candle history cache (symbol|timeframe). The panel unmounts
 * on every tab switch; without this, each return blocked on a fresh
 * /api/klines fetch behind a "Loading candles…" overlay for tens of
 * seconds. With it, a remount renders the cached candles immediately and
 * refreshes them in the background.
 */
const historyCache = new Map<string, Candle[]>()

export default function ChartPanel() {
  const { symbol, timeframe, setTimeframe } = useTerminal()
  const meta = metaFor(symbol)
  const [mobileIndicators, setMobileIndicators] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const rsiWrapRef = useRef<HTMLDivElement>(null)
  const cvdWrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const lineRefs = useRef<Record<string, ISeriesApi<'Line'>>>({})
  const rsiRef = useRef<ISeriesApi<'Line'> | null>(null)
  const cvdRef = useRef<ISeriesApi<'Area'> | null>(null)
  const cvdChartRef = useRef<IChartApi | null>(null)
  const priceLineObjs = useRef<IPriceLine[]>([])
  const levelLineObjs = useRef<IPriceLine[]>([])
  const markersApi = useRef<ReturnType<typeof createSeriesMarkers> | null>(null)
  const baseRef = useRef<Candle[]>([])
  const syncedRef = useRef('')
  const hModeRef = useRef(false)
  const hoverRef = useRef(false)

  const [ind, setInd] = useState({ ema20: true, ema50: true, bb: false, vwap: false, vol: true, rsi: true, whales: false, cvd: true, levels: false })
  const [hMode, setHMode] = useState(false)
  const [hLines, setHLines] = useState<HLine[]>([])
  const [legend, setLegend] = useState<{ o: number; h: number; l: number; c: number; v: number } | null>(null)
  const [ready, setReady] = useState(false)
  const [histVersion, setHistVersion] = useState(0)

  useEffect(() => { hModeRef.current = hMode }, [hMode])
  useHotkeys((k) => { if (k === 'escape') setHMode(false) })

  useEffect(() => { setStreamSymbol(symbol) }, [symbol])

  // ---- fetch history on symbol/timeframe change (cache-first: a remount
  // after a tab switch renders cached candles instantly, `ready` starts
  // true, and the network refresh lands in the background)
  useEffect(() => {
    let alive = true
    const cacheKey = `${symbol}|${timeframe}`
    const cached = historyCache.get(cacheKey)
    if (cached?.length) {
      baseRef.current = cached
      syncedRef.current = ''
      setReady(true)
    } else {
      setReady(false)
    }
    ;(async () => {
      try {
        const res = await fetch(`/api/klines?symbol=${symbol}&interval=${timeframe}&limit=600`, { cache: 'no-store' })
        const json = await res.json()
        if (!alive) return
        if (json.candles) {
          const rows = json.candles.map((r: number[]) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
          historyCache.set(cacheKey, rows)
          baseRef.current = rows
          syncedRef.current = ''
          setHistVersion((v) => v + 1)
        }
      } finally { if (alive) setReady(true) }
    })()
    return () => { alive = false }
  }, [symbol, timeframe])

  // ---- build charts once
  useEffect(() => {
    const main = mainRef.current
    if (!main) return
    const common = {
      layout: { background: { type: ColorType.Solid, color: BG } as const, textColor: TEXT_DIM, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false, rightOffset: 6 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#3a4150', labelBackgroundColor: '#2a2f3a' },
        horzLine: { color: '#3a4150', labelBackgroundColor: '#2a2f3a' },
      },
    }
    const chart = createChart(main, { ...common, autoSize: false })
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: GREEN, downColor: RED, borderVisible: false, wickUpColor: GREEN, wickDownColor: RED,
      priceLineVisible: true, lastValueVisible: true,
    })
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
    chartRef.current = chart
    candleRef.current = cs
    volRef.current = vol
    lineRefs.current = {
      ema20: chart.addSeries(LineSeries, { color: '#4da3ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      ema50: chart.addSeries(LineSeries, { color: '#c792ea', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      bbU: chart.addSeries(LineSeries, { color: 'rgba(240,185,11,0.55)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      bbL: chart.addSeries(LineSeries, { color: 'rgba(240,185,11,0.55)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      vwap: chart.addSeries(LineSeries, { color: '#f0b90b', lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    }
    const markers = createSeriesMarkers(cs, [])
    markersApi.current = markers

    let rchart: IChartApi | null = null
    if (rsiWrapRef.current) {
      rchart = createChart(rsiWrapRef.current, {
        ...common,
        autoSize: false,
        // no own time axis — it is slaved to the main chart BY TIME RANGE
        timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false, visible: false },
      })
      // lastValueVisible off: the pane's displayed current value is the
      // canonical "RSI-14 (1m)" label in the pane header (shared-metrics),
      // not this series' timeframe-based last point.
      const rs = rchart.addSeries(LineSeries, { color: '#7dd3fc', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      rs.createPriceLine({ price: 70, color: 'rgba(234,57,67,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' })
      rs.createPriceLine({ price: 30, color: 'rgba(22,199,132,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' })
      rsiRef.current = rs
      // Sync BY TIME RANGE (like the CVD pane). The old logical-range sync
      // misaligned whenever the RSI series had a different data length
      // than the candle series — its axis read hours away from the main
      // chart's at the same moment.
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        if (!rchart) return
        const vr = chart.timeScale().getVisibleRange()
        if (vr) { try { rchart.timeScale().setVisibleRange(vr) } catch { /* data not ready yet */ } }
      })
    }

    let cchart: IChartApi | null = null
    if (cvdWrapRef.current) {
      cchart = createChart(cvdWrapRef.current, {
        ...common,
        rightPriceScale: { borderColor: GRID },
        timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false, visible: false },
      })
      const cvdSeries = cchart.addSeries(AreaSeries, {
        lineColor: '#4da3ff', topColor: 'rgba(77,163,255,0.25)', bottomColor: 'rgba(77,163,255,0.02)',
        lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
      })
      cvdRef.current = cvdSeries
      cvdChartRef.current = cchart
      // time-based sync so the live CVD window aligns to the right edge of the main chart
      chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
        if (!cchart) return
        const vr = chart.timeScale().getVisibleRange()
        if (vr) { try { cchart.timeScale().setVisibleRange(vr) } catch { /* data not ready yet */ } }
      })
    }

    chart.subscribeCrosshairMove((param) => {
      const bar = param.seriesData.get(cs) as { open: number; high: number; low: number; close: number } | undefined
      const volBar = param.seriesData.get(vol) as { value: number } | undefined
      if (bar && param.time) {
        hoverRef.current = true
        setLegend({ o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: volBar?.value ?? 0 })
      } else {
        hoverRef.current = false
        const all = baseRef.current
        const last = all[all.length - 1]
        if (last) setLegend({ o: last.o, h: last.h, l: last.l, c: last.c, v: last.v })
      }
    })

    chart.subscribeClick((param) => {
      if (!hModeRef.current) return
      const y = param.point?.y
      if (y == null) return
      const price = cs.coordinateToPrice(y)
      if (price == null || !isFinite(price)) return
      setHLines((ls) => [...ls, { id: Date.now(), price: price as number }])
    })

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: main.clientWidth, height: main.clientHeight })
      if (rsiWrapRef.current && rchart) rchart.applyOptions({ width: rsiWrapRef.current.clientWidth, height: rsiWrapRef.current.clientHeight })
      if (cvdWrapRef.current && cchart) cchart.applyOptions({ width: cvdWrapRef.current.clientWidth, height: cvdWrapRef.current.clientHeight })
    })
    ro.observe(wrapRef.current)
    return () => {
      ro.disconnect()
      chart.remove()
      rchart?.remove()
      cchart?.remove()
      chartRef.current = null
      candleRef.current = null
      volRef.current = null
      rsiRef.current = null
      cvdRef.current = null
      cvdChartRef.current = null
      lineRefs.current = {}
      markersApi.current = null
      priceLineObjs.current = []
      syncedRef.current = ''
    }
  }, [])

  // ---- live merge + redraw driven by a 300ms poll tick.
  // The tick MUST change on every intra-candle update: polling only the
  // klines LENGTH (the old code) meant the forming candle — and the price
  // axis last-price tag — refreshed at most once a minute and looked frozen
  // tens of dollars away from the live ticker.
  const tick = usePoll(() => {
    const s = getStream()
    const k = s.klines
    const l = k[k.length - 1]
    // bookTop/ticker are in the signature too: the forming candle tracks
    // the live price between kline events (item F), so a bookTicker move
    // alone must retrigger the merge/redraw.
    const px = s.bookTop ? `${s.bookTop.b}|${s.bookTop.a}` : `${s.ticker?.c ?? ''}`
    return l ? `${k.length}|${l.t}|${l.c}|${l.h}|${l.l}|${l.v}|${px}` : `empty|${px}`
  }, 300)
  useEffect(() => {
    if (!ready || !candleRef.current) return
    const tfMs = timeframeMs(timeframe)
    const stream = getStream().klines
    const agg = tfMs <= 60_000 ? stream : aggregate(stream, tfMs)
    const base = baseRef.current
    let merged = base
    if (agg.length && base.length) {
      const lastAgg = agg[agg.length - 1]
      const lastBase = base[base.length - 1]
      if (lastAgg.t > lastBase.t) merged = [...base, lastAgg]
      else if (lastAgg.t === lastBase.t) {
        const partial = stream[0].t > lastBase.t
        merged = [...base.slice(0, -1), { ...lastAgg,
          o: partial ? lastBase.o : lastAgg.o,
          h: Math.max(lastBase.h, lastAgg.h), l: Math.min(lastBase.l, lastAgg.l),
          v: partial ? Math.max(lastBase.v, lastAgg.v) : lastAgg.v,
        }]
      }
    }
    if (!merged.length) return
    // Track the live price in the FORMING candle between kline events: the
    // candle series' last value otherwise only moves on kline relays while
    // the header ticker moves on bookTicker, and the axis tag drifts
    // dollars away from the ticker in a fast move. The next real kline
    // event replaces this bar (merge above), so this never rewrites
    // history — it only keeps the still-forming bar honest.
    const livePx = liveMid()
    const lastIdx = merged.length - 1
    const forming = merged[lastIdx]
    if (livePx != null && isFinite(livePx) && livePx > 0 && forming.t + tfMs > streamNow()) {
      merged = [...merged.slice(0, lastIdx), {
        ...forming,
        c: livePx,
        h: Math.max(forming.h, livePx),
        l: Math.min(forming.l, livePx),
      }]
    }
    baseRef.current = merged
    // live OHLC legend for the forming candle (crosshair hover overrides it)
    if (!hoverRef.current) {
      const lastM = merged[merged.length - 1]
      setLegend({ o: lastM.o, h: lastM.h, l: lastM.l, c: lastM.c, v: lastM.v })
    }

    const key = `${symbol}|${timeframe}|${merged[0].t}|${merged.length}`
    const fullSync = key !== syncedRef.current
    const closes = merged.map((c) => c.c)
    const e20 = ema(closes, 20)
    const e50 = ema(closes, 50)
    const bb = bollinger(closes, 20, 2)
    const vw = sessionVwap(merged)
    const R = rsi(closes, 14)
    // At 1m the RSI pane plots the canonical series computed from the stream
    // klines themselves (shared-metrics basis), so its last value is the
    // same number Sentiment / Signals / Insights display.
    const streamK = getStream().klines
    const useStreamRsi = tfMs <= 60_000 && streamK.length > 20
    const RStream = useStreamRsi ? rsi(streamK.map((c) => c.c), 14) : null

    const toBar = (c: Candle) => ({ time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c })
    const toVol = (c: Candle) => ({ time: (c.t / 1000) as UTCTimestamp, value: c.v, color: c.c >= c.o ? 'rgba(22,199,132,0.45)' : 'rgba(234,57,67,0.45)' })
    const lineData = (arr: (number | null)[]) =>
      arr.map((v, i) => (v == null ? null : { time: (merged[i].t / 1000) as UTCTimestamp, value: v })).filter(Boolean) as { time: UTCTimestamp; value: number }[]
    const rsiData = useStreamRsi && RStream
      ? streamK.map((c, i) => (RStream[i] == null ? null : { time: (c.t / 1000) as UTCTimestamp, value: RStream[i] as number })).filter(Boolean) as { time: UTCTimestamp; value: number }[]
      : lineData(R)

    if (fullSync) {
      candleRef.current.setData(merged.map(toBar))
      volRef.current?.setData(ind.vol ? merged.map(toVol) : [])
      const apply = (name: string, arr: (number | null)[], visible: boolean) => {
        const s = lineRefs.current[name]
        if (!s) return
        s.applyOptions({ visible })
        s.setData(lineData(arr))
      }
      apply('ema20', e20, ind.ema20)
      apply('ema50', e50, ind.ema50)
      apply('bbU', bb.upper, ind.bb)
      apply('bbL', bb.lower, ind.bb)
      apply('vwap', vw, ind.vwap)
      if (rsiRef.current) rsiRef.current.setData(rsiData)
      syncedRef.current = key
    } else {
      const last = merged[merged.length - 1]
      candleRef.current.update(toBar(last))
      if (ind.vol) volRef.current?.update(toVol(last))
      const upd = (name: string, arr: (number | null)[], visible: boolean) => {
        const s = lineRefs.current[name]
        const v = arr[arr.length - 1]
        if (s && v != null && visible) s.update({ time: (last.t / 1000) as UTCTimestamp, value: v })
      }
      upd('ema20', e20, ind.ema20)
      upd('ema50', e50, ind.ema50)
      upd('bbU', bb.upper, ind.bb)
      upd('bbL', bb.lower, ind.bb)
      upd('vwap', vw, ind.vwap)
      if (rsiRef.current) {
        if (useStreamRsi && RStream) {
          const sk = streamK[streamK.length - 1]
          const sv = RStream[RStream.length - 1]
          if (sk && sv != null) rsiRef.current.update({ time: (sk.t / 1000) as UTCTimestamp, value: sv })
        } else if (R[R.length - 1] != null) {
          rsiRef.current.update({ time: (last.t / 1000) as UTCTimestamp, value: R[R.length - 1] as number })
        }
      }
    }

    // whale markers from recent stream trades (≥ $250k prints)
    if (markersApi.current) {
      if (ind.whales && merged.length) {
        const cutoff = merged[merged.length - 1].t - tfMs * 120
        const buckets = new Map<number, { buy: number; sell: number }>()
        for (const t of getStream().trades) {
          if (t.t < cutoff) continue
          const notional = t.p * t.q
          if (notional < 250_000) continue
          const b = candleBucket(t.t, tfMs)
          const cur = buckets.get(b) ?? { buy: 0, sell: 0 }
          if (t.m) cur.sell += notional
          else cur.buy += notional
          buckets.set(b, cur)
        }
        markersApi.current.setMarkers(
          [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({
            time: (t / 1000) as UTCTimestamp,
            position: v.buy >= v.sell ? ('belowBar' as const) : ('aboveBar' as const),
            color: v.buy >= v.sell ? GREEN : RED,
            shape: v.buy >= v.sell ? ('arrowUp' as const) : ('arrowDown' as const),
            text: `W ${fmtCompact(v.buy >= v.sell ? v.buy : v.sell)}`,
          })),
        )
      } else markersApi.current.setMarkers([])
    }

    // ---- CVD pane: shared USD computation (shared-metrics), same formula
    // as every other panel — values are USD, not coin units.
    if (cvdRef.current) {
      if (ind.cvd && merged.length) {
        cvdRef.current.setData(cvdSeriesUsd(tfMs)
          .map((p) => ({ time: (p.t / 1000) as UTCTimestamp, value: p.v })))
      } else cvdRef.current.setData([])
    }
  }, [tick, ready, histVersion, symbol, timeframe, ind])

  // ---- horizontal price lines
  useEffect(() => {
    const cs = candleRef.current
    if (!cs) return
    priceLineObjs.current.forEach((pl) => cs.removePriceLine(pl))
    priceLineObjs.current = hLines.map((l) => cs.createPriceLine({
      price: l.price, color: '#f0b90b', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'H',
    }))
  }, [hLines, ready])

  const ticker = usePoll(() => getStream().ticker, 500)
  // The canonical 1m RSI every panel displays (shared-metrics) — shown in
  // the RSI pane header so the chart's stated current RSI is that number,
  // whatever timeframe the pane's line is drawn on.
  const rsiCanon = useSharedRsi1m()
  const flowTick = usePoll(() => getStream().trades.length, 500)

  // ---- key levels as price lines (POC / value area / 24h range)
  useEffect(() => {
    const cs = candleRef.current
    if (!cs) return
    levelLineObjs.current.forEach((pl) => cs.removePriceLine(pl))
    levelLineObjs.current = []
    if (!ind.levels || !ready) return
    const kl = keyLevels()
    const mk = (price: number | null | undefined, color: string, title: string, style: typeof LineStyle.Dotted = LineStyle.Dotted) => {
      if (price == null || !isFinite(price)) return
      levelLineObjs.current.push(cs.createPriceLine({
        price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title,
      }))
    }
    mk(kl?.poc, '#f0b90b', 'POC')
    mk(kl?.vah, 'rgba(240,185,11,0.55)', 'VAH')
    mk(kl?.val, 'rgba(240,185,11,0.55)', 'VAL')
    mk(ticker?.h, 'rgba(139,147,167,0.75)', '24h Hi', LineStyle.Dashed)
    mk(ticker?.l, 'rgba(139,147,167,0.75)', '24h Lo', LineStyle.Dashed)
  }, [ind.levels, ticker, ready])

  // ---- ATR(14) on the active timeframe + last-candle delta
  const atrVal = (() => {
    const all = baseRef.current
    if (all.length < 16) return null
    let sum = 0
    for (let i = all.length - 14; i < all.length; i++) {
      sum += Math.max(all[i].h - all[i].l, Math.abs(all[i].h - all[i - 1].c), Math.abs(all[i].l - all[i - 1].c))
    }
    return sum / 14
  })()
  const lastDelta = (() => {
    if (!flowTick) return null
    const tfMs = timeframeMs(timeframe)
    const cutoff = Date.now() - tfMs
    let d = 0
    for (const t of getStream().trades) { if (t.t >= cutoff) d += t.m ? -t.q : t.q }
    return d
  })()

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-chart">
      <PanelHeader
        title="Chart"
        sub="Candles + indicators · click ＋H-line then the chart to pin a level · Esc exits"
        source="Binance spot"
        right={
          <>
            <TimeframePicker value={timeframe} onChange={id => setTimeframe(id as typeof timeframe)} />
            <button type="button" aria-expanded={mobileIndicators} aria-controls="chart-indicators" onClick={() => setMobileIndicators(v => !v)} className="min-h-8 rounded border border-white/10 bg-neutral-800 px-2 text-[11px] text-neutral-300 sm:hidden">Indicators</button>
            <div id="chart-indicators" className={cn('flex flex-wrap items-center gap-2 sm:contents', !mobileIndicators && 'max-sm:hidden')}>
            {([
              ['ema20', 'EMA20'], ['ema50', 'EMA50'], ['bb', 'BB'], ['vwap', 'VWAP'],
              ['vol', 'Vol'], ['rsi', 'RSI'], ['cvd', 'CVD'], ['whales', 'Whales'], ['levels', 'Levels'],
            ] as const).map(([k, label]) => (
              <button key={k} onClick={() => setInd((s) => ({ ...s, [k]: !s[k] }))}
                className={cn('rounded border px-1.5 py-1 text-[10px] font-medium',
                  ind[k] ? 'border-white/20 bg-white/10 text-neutral-100' : 'border-border text-muted-foreground hover:text-foreground')}>
                {label}
              </button>
            ))}
            <button onClick={() => setHMode((v) => !v)}
              className={cn('rounded border px-1.5 py-1 text-[10px] font-medium',
                hMode ? 'border-[#f0b90b]/60 bg-[#f0b90b]/15 text-[#f0b90b]' : 'border-border text-muted-foreground hover:text-foreground')}>
              ＋H-line
            </button>
            {hLines.length > 0 && (
              <button onClick={() => setHLines([])}
                className="rounded border border-border px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground">
                Clear {hLines.length}
              </button>
            )}
            </div>
          </>
        }
      />
      {hLines.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border/60 px-3 py-1">
          {hLines.map((l) => (
            <span key={l.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              H {fmtPrice(l.price, meta.tick)}
              <button className="text-muted-foreground hover:text-foreground" onClick={() => setHLines((ls) => ls.filter((x) => x.id !== l.id))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded bg-black/40 px-2 py-1 font-mono text-[11px] backdrop-blur-sm">
          <span className="font-semibold" style={{ color: (legend?.c ?? 0) >= (legend?.o ?? 0) ? GREEN : RED }}>
            {meta.label.split('/')[0]} {fmtPrice(ticker?.c, meta.tick)}
            <span className="ml-1.5 text-[10px]">{fmtPct(ticker?.P)}</span>
          </span>
          {legend && (
            <>
              <span className="text-muted-foreground">O <span className="text-foreground/90">{fmtPrice(legend.o, meta.tick)}</span></span>
              <span className="text-muted-foreground">H <span className="text-foreground/90">{fmtPrice(legend.h, meta.tick)}</span></span>
              <span className="text-muted-foreground">L <span className="text-foreground/90">{fmtPrice(legend.l, meta.tick)}</span></span>
              <span className="text-muted-foreground">C <span className="text-foreground/90">{fmtPrice(legend.c, meta.tick)}</span></span>
              <span className="text-muted-foreground">Vol <span className="text-foreground/90">{fmtCompact(legend.v)}</span></span>
              {atrVal != null && <span className="text-muted-foreground">ATR14 <span className="text-foreground/90">{fmtPrice(atrVal, meta.tick)}</span></span>}
              {lastDelta != null && (
                <span className="text-muted-foreground">Δ <span className={lastDelta >= 0 ? 'text-[#16c784]' : 'text-[#ea3943]'}>{lastDelta >= 0 ? '+' : ''}{lastDelta.toFixed(2)} {meta.label.split('/')[0]}</span></span>
              )}
            </>
          )}
        </div>
        <div ref={wrapRef} className="flex h-full flex-col">
          <div ref={mainRef} className="min-h-0 flex-1" />
          {ind.rsi && (
            <>
              <div className="flex items-center gap-2 px-2 pt-1 text-[10px] text-muted-foreground">
                <span>RSI-14 (1m)</span>
                <span className="font-mono text-foreground/90">{rsiCanon != null ? rsiCanon.toFixed(1) : '—'}</span>
                <SourceBadge label="live" />
              </div>
              <div ref={rsiWrapRef} className="h-[12%] min-h-[64px]" />
            </>
          )}
          {ind.cvd && (
            <>
              <div className="flex items-center gap-2 px-2 pt-1 text-[10px] text-muted-foreground">
                <span>CVD (USD) — cumulative volume delta, live window</span>
                <span className="text-muted-foreground/70">rising = aggressive buying dominates</span>
                <SourceBadge label="live" />
              </div>
              <div ref={cvdWrapRef} className="h-[12%] min-h-[64px]" />
            </>
          )}
        </div>
        {!ready && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0c0c0c]/70 text-xs text-muted-foreground">
            Loading candles…
          </div>
        )}
      </div>
    </div>
  )
}
