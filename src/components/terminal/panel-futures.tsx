'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, AreaSeries, ColorType, type UTCTimestamp } from 'lightweight-charts'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, now } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { aggregate, timeframeMs } from '@/lib/terminal/indicators'
import { symbolMeta, GREEN, RED, GRID, TEXT_DIM } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtUsd, fmtClock, fmtPct } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge, StatCard, AsOf } from './panel-kit'
import { cn } from '@/lib/utils'
import type { FuturesHistory } from '@/lib/terminal/types'

const BG = '#0b0d12'
const LEVS = [
  { lev: 10, w: 0.45, color: 'rgba(234,57,67,0.75)' },
  { lev: 25, w: 0.30, color: 'rgba(234,57,67,0.55)' },
  { lev: 50, w: 0.15, color: 'rgba(234,57,67,0.35)' },
  { lev: 100, w: 0.10, color: 'rgba(234,57,67,0.22)' },
]

export default function FuturesPanel() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)
  const [hist, setHist] = useState<FuturesHistory | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const oiChartRef = useRef<HTMLDivElement>(null)
  const oiLwRef = useRef<ReturnType<typeof createChart> | null>(null)
  const oiSeriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null)
  const liqMapRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/futures-history?symbol=${symbol}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive) { if (j.error) setErr(j.error); else { setHist(j); setErr(null) } } })
      .catch(() => alive && setErr('fetch failed'))
    const id = setInterval(() => {
      fetch(`/api/futures-history?symbol=${symbol}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (alive && !j.error) setHist(j) })
        .catch(() => {})
    }, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [symbol])

  // OI history chart
  useEffect(() => {
    if (!oiChartRef.current || !hist) return
    if (!oiLwRef.current) {
      const chart = createChart(oiChartRef.current, {
        layout: { background: { type: ColorType.Solid, color: BG } as const, textColor: TEXT_DIM, fontSize: 10, attributionLogo: false },
        grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
        rightPriceScale: { borderColor: GRID },
        timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
        height: 150, autoSize: false,
      })
      oiLwRef.current = chart
      oiSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: '#4da3ff', topColor: 'rgba(77,163,255,0.25)', bottomColor: 'rgba(77,163,255,0.02)', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: true,
      })
    }
    oiSeriesRef.current?.setData(hist.oiHistory.map((o) => ({ time: (o.t / 1000) as UTCTimestamp, value: o.usd })))
  }, [hist])

  useEffect(() => () => { oiLwRef.current?.remove(); oiLwRef.current = null; oiSeriesRef.current = null }, [])

  const mark = usePoll(() => getStream().mark, 1000)
  const oi = usePoll(() => getStream().oi, 2000)
  const liqs = usePoll(() => getStream().liqs.slice(-40).reverse(), 500)
  const candles = usePoll(() => getStream().klines, 2000)
  const liqStats = usePoll(() => {
    const t = now() - 15 * 60_000
    const recent = getStream().liqs.filter((l) => l.t >= t)
    let longs = 0, shorts = 0
    for (const l of recent) { const n = l.p * l.q; if (l.side === 'BUY') longs += n; else shorts += n }
    return { longs, shorts, count: recent.length }
  }, 1000, [])

  // ---- estimated liquidation map from recent 1m candles × leverage buckets
  const liqMap = useMemo(() => {
    if (!candles.length) return null
    const tfMs = timeframeMs('1m')
    const win = aggregate(candles, tfMs).slice(-120)
    const totalV = win.reduce((a, c) => a + c.v, 0)
    if (totalV <= 0) return null
    const last = win[win.length - 1].c
    const binPct = 0.001 // 0.1% bins
    const longBins = new Map<number, number>()
    const shortBins = new Map<number, number>()
    for (const c of win) {
      const entry = (c.h + c.l + c.c) / 3
      const share = c.v / totalV
      for (const { lev, w } of LEVS) {
        const notional = share * w
        const longPx = entry * (1 - 1 / lev)
        const shortPx = entry * (1 + 1 / lev)
        const lb = Math.round(Math.log(longPx / last) / binPct)
        const sb = Math.round(Math.log(shortPx / last) / binPct)
        longBins.set(lb, (longBins.get(lb) ?? 0) + notional)
        shortBins.set(sb, (shortBins.get(sb) ?? 0) + notional)
      }
    }
    return { last, longBins, shortBins, binPct }
  }, [candles])

  // draw liquidation map
  useEffect(() => {
    const el = liqMapRef.current
    if (!el || !liqMap) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const w = el.parentElement!.clientWidth, h = 170
    el.width = w * dpr; el.height = h * dpr
    el.style.width = `${w}px`; el.style.height = `${h}px`
    const ctx = el.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h)
    const maxPct = 0.05 // ±5%
    const xOf = (pct: number) => 56 + ((pct + maxPct) / (2 * maxPct)) * (w - 66)
    const axis = 8
    const rows = 14
    const rowH = (h - axis - 14) / rows
    // grid
    ctx.strokeStyle = '#161a22'; ctx.fillStyle = TEXT_DIM; ctx.font = '9px ui-monospace, monospace'
    for (let i = 0; i <= 8; i++) {
      const pct = -maxPct + (2 * maxPct * i) / 8
      const x = xOf(pct)
      ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, h - 14); ctx.stroke()
      ctx.textAlign = 'center'
      ctx.fillText(`${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`, x, h - 3)
    }
    const maxNotional = Math.max(...[...liqMap.longBins.values(), ...liqMap.shortBins.values()], 0.0001)
    for (const [bins, color, dir] of [[liqMap.shortBins, 'rgba(234,57,67,0.6)', 1], [liqMap.longBins, 'rgba(22,199,132,0.6)', -1]] as const) {
      for (const [b, n] of bins) {
        const pct = b * liqMap.binPct
        if (Math.abs(pct) > maxPct) continue
        const x0 = dir === 1 ? xOf(0) : xOf(pct)
        const wpx = (n / maxNotional) * (w - 66) * 0.48
        const y = 6 + ((pct + maxPct) / (2 * maxPct)) * (h - axis - 18)
        ctx.fillStyle = color
        ctx.fillRect(dir === 1 ? x0 : x0 - wpx, y - 2, wpx, 4)
      }
    }
    // current price
    ctx.strokeStyle = '#f0b90b'; ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(xOf(0), 4); ctx.lineTo(xOf(0), h - 14); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#f0b90b'; ctx.textAlign = 'left'; ctx.font = 'bold 9px ui-monospace, monospace'
    ctx.fillText('MARK', xOf(0) + 3, 12)
    // legend
    ctx.fillStyle = TEXT_DIM; ctx.font = '9px ui-monospace, monospace'
    ctx.fillText('◀ long liqs (below)', 6, 14)
    ctx.textAlign = 'right'; ctx.fillText('short liqs (above) ▶', w - 8, 14)
  }, [liqMap])

  const fundingNow = mark?.funding ?? null
  const fundingHist = hist?.funding ?? []
  const avg7 = fundingHist.length ? fundingHist.slice(-21).reduce((a, f) => a + f.rate, 0) / Math.min(21, fundingHist.length) : null

  return (
    <div className="flex h-full flex-col min-h-0 overflow-y-auto" data-testid="panel-futures">
      <PanelHeader
        title="Futures"
        sub="Funding, open interest and liquidations from Binance USDT-M futures · liquidation map is an estimate"
        source="Binance futures"
        right={<><SourceBadge label="live streams" /><AsOf ts={hist?.asOf} /></>}
      />
      {err && (
        <div className="mx-3 mt-2 rounded border border-[#ea3943]/40 bg-[#ea3943]/10 px-3 py-2 text-[11px] text-muted-foreground">
          Futures history unavailable: {err}. Live funding / OI / liquidations keep streaming regardless.
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Mark price" value={fmtPrice(mark?.p, meta.tick)} sub={mark ? `index ${fmtPrice(mark.index, meta.tick)}` : undefined} />
        <StatCard label="Funding (8h)" value={fundingNow != null ? fmtPct(fundingNow * 100, 4) : '—'} tone={fundingNow != null ? (fundingNow >= 0 ? 'down' : 'up') : undefined} sub={fundingNow != null ? `annualised ≈ ${fmtPct(fundingNow * 3 * 365, 1)} · ${fundingNow >= 0 ? 'longs pay' : 'shorts pay'}` : undefined} />
        <StatCard label="Next funding in" value={mark?.nextFunding ? `${Math.max(0, Math.round((mark.nextFunding - now()) / 60000))}m` : '—'} sub={mark?.nextFunding ? fmtClock(mark.nextFunding) : undefined} />
        <StatCard label="Open interest" value={oi ? fmtCompact(oi.oi) : '—'} sub={oi ? `${fmtUsd(oi.oi * (mark?.p ?? 0))}` : undefined} />
        <StatCard label="Avg funding (7d)" value={avg7 != null ? fmtPct(avg7 * 100, 4) : '—'} />
        <StatCard label="Liqs (15m)" value={liqStats.count} sub={`L ${fmtUsd(liqStats.longs)} · S ${fmtUsd(liqStats.shorts)}`} />
      </div>

      <div className="grid gap-3 px-3 pb-3 xl:grid-cols-2">
        <div className="rounded-md border border-border/60">
          <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-medium">Open interest (5m · last 15h, USD notional)</div>
          <div ref={oiChartRef} className="h-[150px] w-full" />
        </div>
        <div className="rounded-md border border-border/60">
          <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-medium">Estimated liquidation map <SourceBadge label="estimate" tone="est" /></div>
          <canvas ref={liqMapRef} className="block" />
          <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
            Estimated from the last 2h of 1m volume spread across 10×/25×/50×/100× leverage buckets (45/30/15/10% weights).
            Shows where leveraged longs/shorts would be liquidated relative to mark — magnitude, not exact orders.
          </div>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="rounded-md border border-border/60">
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-[11px] font-medium">
            Liquidation feed (real forceOrder stream, newest first) <SourceBadge label="live" />
          </div>
          <div className="max-h-56 overflow-y-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="sticky top-0 bg-[#0d1017] text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-1 font-medium">Time</th>
                  <th className="px-2 py-1 font-medium">Liquidated</th>
                  <th className="px-2 py-1 font-medium text-right">Price</th>
                  <th className="px-2 py-1 font-medium text-right">Qty</th>
                  <th className="px-3 py-1 font-medium text-right">Notional</th>
                </tr>
              </thead>
              <tbody>
                {liqs.map((l, i) => (
                  <tr key={`${l.t}-${i}`} className="border-t border-border/40">
                    <td className="px-3 py-1 text-muted-foreground">{fmtTime(l.t)}</td>
                    <td className={cn('px-2 py-1 font-semibold', l.side === 'SELL' ? 'text-[#ea3943]' : 'text-[#16c784]')}>{l.side === 'SELL' ? 'LONG' : 'SHORT'}</td>
                    <td className="px-2 py-1 text-right">{fmtPrice(l.p, meta.tick)}</td>
                    <td className="px-2 py-1 text-right">{fmtCompact(l.q)}</td>
                    <td className="px-3 py-1 text-right">{fmtUsd(l.p * l.q)}</td>
                  </tr>
                ))}
                {liqs.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-5 text-center text-muted-foreground">No liquidations on {symbol} since the stream connected — quiet market.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
