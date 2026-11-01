'use client'

import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp, Pause, Play, Settings2, Plus, Minus, RotateCcw, Maximize2 } from 'lucide-react'
import { useTerminal } from '@/lib/terminal/store'
import { metaFor } from '@/lib/terminal/constants'
import { fmtCompact, fmtPrice } from '@/lib/terminal/format'
import { buildFootprint, footprintReading } from '@/lib/terminal/footprint-model'
import { useFootprintData } from '@/lib/terminal/use-footprint-data'
import { useCanvasSize, useRaf } from '@/lib/terminal/hooks'
import { useHeatmapNavigation } from '@/lib/terminal/use-heatmap-navigation'
import { panViewport, zoomViewport, type MapViewport } from '@/lib/terminal/heatmap-navigation'
import { drawFootprintChart, drawFootprintCursor, footprintGeometry, footprintHit, type FootprintChartView } from '@/lib/terminal/footprint-chart'
import OrderBookRail from './order-book-rail'
import { cn } from '@/lib/utils'

const control = 'inline-flex min-h-8 items-center justify-center gap-1 rounded border border-white/10 bg-[#191919] px-2 text-[11px] text-neutral-300 outline-none hover:bg-neutral-800 focus-visible:ring-1 focus-visible:ring-amber-400 disabled:opacity-30'
const utc = (t: number) => new Date(t).toISOString().slice(11, 19)
const volume = (n: number) => n === 0 ? '0' : Math.abs(n) < 0.01 ? n.toPrecision(2) : fmtCompact(n)
const signed = (n: number) => `${n > 0 ? '+' : ''}${volume(n)}`

export default function FootprintPanel() {
  const symbol = useTerminal(s => s.symbol)
  return <FootprintWorkspace key={symbol} symbol={symbol} />
}

function FootprintWorkspace({ symbol }: { symbol: string }) {
  const { data, history, loadMore } = useFootprintData(symbol)
  const [frozen, setFrozen] = useState<typeof data | null>(null)
  const feed = frozen ?? data
  const meta = metaFor(symbol, feed.trades.at(-1)?.p)
  const baseTicks = Math.max(1, Math.round(meta.bin / meta.tick))
  const [rowTicks, setRowTicks] = useState(baseTicks)
  const [interval, setIntervalMs] = useState(60000)
  const [ratio, setRatio] = useState(3)
  const [minQty, setMinQty] = useState(0)
  const [units, setUnits] = useState<'coin' | 'usd'>('coin')
  const [viewport, setViewport] = useState<MapViewport | null>(null)
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [showPoc, setShowPoc] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const scene = useRef<HTMLCanvasElement | null>(null)
  const painted = useRef<{ view: FootprintChartView; key: string } | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)
  const size = useCanvasSize(canvasRef)
  const all = useMemo(() => buildFootprint(feed.trades, { interval, tick: meta.tick, rowTicks, ratio, minQty, end: feed.asOf }), [feed.trades, feed.asOf, interval, meta.tick, rowTicks, ratio, minQty])
  const span = viewport?.span ?? interval * (size.w < 600 ? 5 : 18)
  const end = viewport?.end ?? feed.asOf + interval * 2, start = end - span
  const bars = all.filter(b => b.end > start && b.t < end)
  const selected = bars.find(b => b.t === selectedTime) ?? bars.findLast(b => !b.forming) ?? bars.at(-1)
  const reading = footprintReading(selected)
  const step = rowTicks * meta.tick
  const observedLow = bars.length ? Math.min(...bars.map(b => b.l)) : feed.trades.at(-1)?.p ?? 1
  const observedHigh = bars.length ? Math.max(...bars.map(b => b.h)) : observedLow
  const autoHalfRange = Math.max(step * 4, (observedHigh - observedLow + step * 2) * 0.6)
  const center = viewport?.center ?? (observedHigh + observedLow) / 2
  const halfRange = viewport?.halfRange ?? autoHalfRange
  const bounds = { earliest: all[0]?.t ?? feed.asOf - interval, latest: feed.asOf + interval * 2,
    mid: Math.max(meta.tick, feed.trades.at(-1)?.p ?? center), minSpan: interval * 1.8,
    maxSpan: Math.max(interval * 18, feed.asOf - (all[0]?.t ?? feed.asOf) + interval * 2),
    minCenter: meta.tick, maxCenter: Math.max(center * 10, meta.tick * 100), minHalfRange: step * 1.5, maxHalfRange: Math.max(autoHalfRange * 10, step * 100) }
  const navigation = { end, span, center, halfRange }
  const resetView = () => { setViewport(null); setSelectedTime(null); setPointer(null) }
  const navigate = (next: MapViewport) => {
    if (!frozen) setFrozen({ ...data, trades: data.trades.slice() })
    setViewport(next); setPointer(null)
  }
  const selectedBarTime = selected?.t ?? null
  const view: FootprintChartView = { width: size.w, height: size.h, start, end, low: center - halfRange, high: center + halfRange,
    interval, step, bars: all, selected: selectedBarTime, units, showPoc, formatPrice: n => fmtPrice(n, meta.tick) }
  const paintKey = [size.w, size.h, start, end, center, halfRange, interval, step, selectedBarTime, units, showPoc, meta.tick].join('|')
  const geometry = footprintGeometry(view)
  const dragging = useHeatmapNavigation(canvasRef, navigation, bounds, geometry, navigate, 'both')
  const hover = footprintHit(view, pointer)
  useRaf(() => {
    const el = canvasRef.current, ctx = el?.getContext('2d')
    if (!el || !ctx || !size.w || !size.h) return
    if (!scene.current) scene.current = document.createElement('canvas')
    const off = scene.current
    if (!painted.current || painted.current.view.bars !== all || painted.current.key !== paintKey || off.width !== el.width || off.height !== el.height) {
      off.width = el.width; off.height = el.height
      const base = off.getContext('2d')!
      base.setTransform(el.width / size.w, 0, 0, el.height / size.h, 0, 0)
      drawFootprintChart(base, view); painted.current = { view, key: paintKey }
    }
    ctx.clearRect(0, 0, size.w, size.h); ctx.drawImage(off, 0, 0, size.w, size.h)
    drawFootprintCursor(ctx, view, pointer)
  }, true, 16)
  const totals = bars.reduce((v, b) => ({ buy: v.buy + b.buy, sell: v.sell + b.sell, usd: v.usd + b.buyUsd + b.sellUsd, count: v.count + b.count }), { buy: 0, sell: 0, usd: 0, count: 0 })
  const live = !frozen && feed.status === 'live' && feed.receivedAt > 0 && feed.clientNow - feed.receivedAt < 15000
  const next = selected && all.find(b => b.t === selected.end)
  const previous = selected && all.find(b => b.end === selected.t)
  const followThrough = selected?.complete && next?.complete ? next.c > selected.h ? 'Next candle closed above this high' : next.c < selected.l ? 'Next candle closed below this low' : 'Next candle closed inside this range' : 'Next closed candle not available'
  const tone = reading.tone === 'buy' ? 'text-emerald-400' : reading.tone === 'sell' ? 'text-rose-400' : reading.tone === 'caution' ? 'text-amber-300' : 'text-neutral-300'

  return <div ref={workspaceRef} className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#0c0c0c] text-neutral-200" data-testid="panel-footprint">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
      <div><h1 className="text-sm font-semibold">Footprint <span className="ml-2 text-[10px] font-normal text-neutral-500">{meta.label} · spot</span></h1><p className="mt-1 text-[10px] text-neutral-500"><span className="text-rose-400">Sell at bid</span> × <span className="text-emerald-400">Buy at ask</span> · executed volume</p></div>
      <span role="status" className={cn('rounded border px-2 py-1 text-[10px]', live ? 'border-emerald-500/20 text-emerald-400' : 'border-amber-400/20 text-amber-300')}>{frozen ? viewport ? 'Exploring snapshot' : 'Paused snapshot' : live ? 'Live executions' : 'Waiting for fresh trades'}</span>
    </div>
    <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.08] px-3 py-2">
      <div role="group" aria-label="Footprint interval" className="flex gap-0.5 rounded border border-white/10 bg-[#171717] p-0.5">{[[15000, '15s'], [60000, '1m'], [300000, '5m'], [900000, '15m']].map(([ms, label]) => <button type="button" key={ms} aria-pressed={interval === ms} onClick={() => { setIntervalMs(Number(ms)); resetView() }} className={cn('min-h-8 rounded px-2 text-[11px]', interval === ms ? 'bg-white/10 text-white' : 'text-neutral-500')}>{label}</button>)}</div>
      <label className="flex items-center gap-1 text-[10px] text-neutral-500">Row<select aria-label="Footprint row size" value={rowTicks} onChange={e => setRowTicks(Number(e.target.value))} className={control}>{[...new Set([rowTicks, ...[0.5, 1, 2, 5, 10, 25, 100].map(m => Math.max(1, Math.round(baseTicks * m)))])].sort((a, b) => a - b).map(t => <option key={t} value={t}>{fmtPrice(t * meta.tick, meta.tick)}</option>)}</select></label>
      <button type="button" aria-label={frozen ? 'Resume footprint' : 'Pause footprint'} onClick={() => { if (frozen) { setFrozen(null); resetView() } else setFrozen({ ...data, trades: data.trades.slice() }) }} className={control}>{frozen ? <Play size={12} /> : <Pause size={12} />}</button>
      <details className="relative max-sm:static"><summary className={cn(control, 'cursor-pointer list-none')}><Settings2 size={12} /><span className="hidden sm:inline">Settings</span></summary><div className="absolute right-3 top-full z-30 mt-1 w-[min(300px,calc(100vw-24px))] space-y-3 rounded border border-white/15 bg-[#181818] p-3 text-[11px] shadow-xl">
        <label className="flex items-center gap-2"><input type="checkbox" checked={showPoc} onChange={e => setShowPoc(e.target.checked)} />Per-candle POC levels</label>
        <label className="flex items-center justify-between">Display units<select aria-label="Footprint units" value={units} onChange={e => setUnits(e.target.value as typeof units)} className={control}><option value="coin">{symbol.replace(/USDT$/, '')}</option><option value="usd">USDT</option></select></label>
        <label className="flex items-center justify-between">Diagonal ratio<select aria-label="Footprint imbalance ratio" value={ratio} onChange={e => setRatio(Number(e.target.value))} className={control}>{[2, 3, 4, 5].map(r => <option key={r}>{r}</option>)}</select></label>
        <label className="flex items-center justify-between gap-2">Min dominant coin volume<input aria-label="Minimum imbalance quantity" type="number" min="0" step="any" value={minQty} onChange={e => setMinQty(Math.max(0, Number(e.target.value) || 0))} className={cn(control, 'w-24')} /></label>
        <p className="text-neutral-500">Imbalances and POC always use coin volume. Zero/missing diagonal opponents are excluded. Three adjacent imbalances form a stack.</p>
      </div></details>
      <details className="relative hidden sm:block"><summary aria-label="Footprint methodology" className={cn(control, 'cursor-pointer list-none')}><CircleHelp size={13} /></summary><div className="absolute right-3 top-full z-30 mt-1 w-[min(340px,calc(100vw-24px))] space-y-2 rounded border border-white/15 bg-[#181818] p-3 text-[11px] leading-relaxed text-neutral-400 shadow-xl"><p>Numbers are actual Binance aggregate executions, not outstanding orders or trader identities. An aggregate ID can contain multiple fills.</p><p>Left = sell aggressors; right = buy aggressors. Buy imbalance compares with sells one price bin lower; sell imbalance with buys one bin higher. Gold = largest coin-volume row (POC).</p><p>Read filter: closed, fully bracketed recording, no ID gaps, at least 20 aggregate IDs. Initiative also requires ±15% delta, a three-level stack and price movement in the same direction. These are explicit heuristics, not backtested probabilities.</p><p>First/last partial bars and gaps suppress directional readings. Missing data is never reconstructed from candles. CVD starts at the leftmost visible candle. Zoom does not change row grouping.</p><a href="https://www.sierrachart.com/index.php?page=doc/NumbersBars.php#DiagonalComparisonOfBidVolumeAndAskVolume" target="_blank" rel="noreferrer" className="text-amber-300 underline">Diagonal comparison reference</a></div></details>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-white/[0.07] px-3 py-2 text-[10px] text-neutral-500" data-testid="footprint-coverage">
      <span>{feed.trades.length.toLocaleString()} recorded agg IDs</span><span>{bars.length} bars in view · {totals.count.toLocaleString()} IDs</span><span className={bars.some(b => !b.complete && !b.forming) ? 'text-amber-300' : ''}>{bars.filter(b => b.gaps).length} gapped bars · {bars.filter(b => b.partial).length} partial</span>
      <button type="button" onClick={loadMore} disabled={!!frozen || history.loading || history.exhausted} className="text-neutral-300 underline decoration-neutral-700 underline-offset-2 disabled:text-neutral-600">{frozen ? 'Resume to load history' : history.loading ? 'Loading history…' : history.exhausted ? 'History limit reached' : history.error ? 'Retry history' : 'Load older trades'}</button>
      {history.error && <span role="status" className="text-amber-300">{history.error}</span>}
    </div>
    <div className="grid shrink-0 grid-cols-3 divide-x divide-white/[0.06] border-b border-white/[0.08] text-[10px]">
      <Metric label="Visible volume · USDT" value={fmtCompact(totals.usd, '$')} />
      <Metric label="Visible CVD · coin" value={signed(totals.buy - totals.sell)} tone={totals.buy >= totals.sell ? 'text-emerald-400' : 'text-rose-400'} />
      <Metric label="Buy share · coin" value={totals.buy + totals.sell ? `${(totals.buy / (totals.buy + totals.sell) * 100).toFixed(1)}%` : '—'} />
    </div>
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-2 text-[10px] text-neutral-500">
      <span><span className="text-rose-400">SELL</span> × <span className="text-emerald-400">BUY</span> · {units === 'usd' ? 'USDT' : symbol.replace(/USDT$/, '')} · <span className="text-amber-300">POC</span></span>
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Earlier footprint candles" disabled={!all.length} onClick={() => navigate(panViewport(navigation, bounds, 0.3, 0))} className={control}><ChevronLeft size={12} /></button>
        <button type="button" aria-label="Later footprint candles" disabled={!viewport} onClick={() => navigate(panViewport(navigation, bounds, -0.3, 0))} className={control}><ChevronRight size={12} /></button>
        <button type="button" aria-label="Fit footprint chart" onClick={resetView} className={control}><RotateCcw size={12} /></button>
        {viewport && <button type="button" onClick={() => { setFrozen(null); resetView() }} className={control}>Live</button>}
        <button type="button" aria-label="Fullscreen footprint" onClick={() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else workspaceRef.current?.requestFullscreen().catch(() => {}) }} className={control}><Maximize2 size={12} /></button>
      </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <div className="flex min-w-0 shrink-0 flex-col xl:flex-1">
        <div className="relative h-[50dvh] min-h-[360px] overflow-hidden xl:h-auto xl:min-h-[480px] xl:flex-1" data-testid="footprint-chart" data-view-start={start} data-view-end={end} data-view-span={span} data-price-low={view.low} data-price-high={view.high} data-bars={bars.length} data-selected={selected?.t ?? ''}>
          <canvas ref={canvasRef} role="img" tabIndex={0} aria-label="Price-aligned sell by buy footprint chart. Scroll or pinch to zoom, drag to pan, tap a candle to inspect. Plus/minus zoom and Home resets." className="absolute inset-0 block h-full w-full outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-amber-400/50" style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'crosshair' }}
            onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setPointer({ x: e.clientX - r.left, y: e.clientY - r.top }) }}
            onPointerLeave={e => { if (e.pointerType !== 'touch') setPointer(null) }}
            onPointerDown={e => { down.current = { x: e.clientX, y: e.clientY } }}
            onPointerUp={e => { const p = down.current; down.current = null; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) { const r = e.currentTarget.getBoundingClientRect(), point = { x: e.clientX - r.left, y: e.clientY - r.top }; const hit = footprintHit(view, point); if (hit) { setSelectedTime(hit.bar.t); setPointer(point) } } }}
            onDoubleClick={resetView}
            onKeyDown={e => { if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'Home', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (e.key === 'Home' || e.key === 'Escape') { setFrozen(null); resetView() } else if (e.key.startsWith('Arrow')) navigate(panViewport(navigation, bounds, e.key === 'ArrowLeft' ? 0.2 : -0.2, 0)); else navigate(zoomViewport(navigation, bounds, e.key === '-' ? 1.25 : 0.8, 0.5, 0.5)) } }} />
          {!all.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-neutral-500">Waiting for recorded trade-by-price executions…</div>}
          <div className="absolute left-2 top-7 flex gap-1 rounded border border-white/10 bg-[#111111]/95 p-1">
            <button type="button" aria-label="Zoom footprint in" disabled={!all.length} onClick={() => navigate(zoomViewport(navigation, bounds, 0.75, 0.7, 0.5))} className="rounded p-1.5 hover:bg-white/10"><Plus size={12} /></button>
            <button type="button" aria-label="Zoom footprint out" disabled={!all.length} onClick={() => navigate(zoomViewport(navigation, bounds, 1.3, 0.7, 0.5))} className="rounded p-1.5 hover:bg-white/10"><Minus size={12} /></button>
          </div>
          {hover && pointer && !dragging && <div data-testid="footprint-inspector" className="pointer-events-none absolute z-10 w-56 max-w-[calc(100%-16px)] rounded border border-white/15 bg-[#191919]/95 p-3 font-mono text-[10px] shadow-xl" style={{ left: Math.max(8, Math.min(pointer.x + 16, size.w - 232)), top: Math.max(8, Math.min(pointer.y + 16, size.h - 190)) }}>
            <div className="mb-2 flex justify-between text-neutral-400"><span>{utc(hover.bar.t)} UTC</span><span>{hover.bar.forming ? 'Forming' : hover.bar.complete ? 'Closed' : 'Partial / gaps'}</span></div>
            <p>O {fmtPrice(hover.bar.o, meta.tick)} · C {fmtPrice(hover.bar.c, meta.tick)}</p>
            <p className="mt-1 text-neutral-500">H {fmtPrice(hover.bar.h, meta.tick)} · L {fmtPrice(hover.bar.l, meta.tick)}</p>
            {hover.row ? <><p className="mt-2 border-t border-white/10 pt-2">Bin {fmtPrice(hover.row.price, meta.tick)}–{fmtPrice(hover.row.price + step, meta.tick)}</p><div className="mt-1 flex justify-between"><span className="text-rose-400">Sell {volume(units === 'coin' ? hover.row.sell : hover.row.sellUsd)}</span><span className="text-emerald-400">Buy {volume(units === 'coin' ? hover.row.buy : hover.row.buyUsd)}</span></div><p className="mt-1 text-neutral-400">{units === 'coin' ? symbol.replace(/USDT$/, '') : 'USDT'} · {hover.row.price === hover.bar.poc ? 'POC · ' : ''}{hover.row.buyImbalance && hover.row.sellImbalance ? 'Buy + sell imbalances' : hover.row.buyImbalance ? 'Buy imbalance' : hover.row.sellImbalance ? 'Sell imbalance' : 'No diagonal imbalance'}</p></> : <p className="mt-2 text-neutral-500">Hover an observed price bin for row values.</p>}
            <p className="mt-2 text-neutral-400">Candle Δ {signed(hover.bar.delta)} coin · {hover.bar.deltaPct.toFixed(1)}%</p>
          </div>}
        </div>
        <div className="flex shrink-0 flex-wrap justify-between gap-1 border-t border-white/[0.07] px-3 py-1.5 text-[9px] text-neutral-500"><span>Scroll / pinch: zoom · Drag: pan · Tap: inspect</span><span>Stats: {symbol.replace(/USDT$/, '')} · CVD*: visible sum · UTC · row {fmtPrice(step, meta.tick)}</span></div>
      </div>
      <aside className="shrink-0 space-y-3 bg-[#111111] p-3 text-[11px] xl:w-[280px] xl:overflow-y-auto xl:border-l xl:border-white/10" aria-label="Selected footprint candle analysis">
        <div className="flex items-center justify-between text-[10px] text-neutral-500"><span>Selected candle</span><span>{selected ? `${utc(selected.t)} UTC` : '—'}</span></div>
        <h2 className={cn('font-medium', tone)}>{reading.title}</h2><p className="leading-relaxed text-neutral-500">{reading.note}</p>
        {selected && <><div className="grid grid-cols-2 gap-3 border-y border-white/[0.07] py-3"><Metric label="POC · coin volume" value={fmtPrice(selected.poc, meta.tick)} /><Metric label="Delta · coin" value={signed(selected.delta)} /><Metric label="Buy stack" value={`${selected.buyStack} levels`} /><Metric label="Sell stack" value={`${selected.sellStack} levels`} /></div>
          <div className="space-y-2 text-[10px]"><ReadRow label="High / low" value={`${fmtPrice(selected.h, meta.tick)} / ${fmtPrice(selected.l, meta.tick)}`} /><ReadRow label="Buy / sell coin" value={`${fmtCompact(selected.buy)} / ${fmtCompact(selected.sell)}`} /><ReadRow label="POC migration" value={selected.complete && previous?.complete ? selected.poc > previous.poc ? 'Higher than previous' : selected.poc < previous.poc ? 'Lower than previous' : 'Unchanged' : 'Incomplete comparison'} /><ReadRow label="Observed follow-through" value={followThrough} /></div></>}
        <p className="border-t border-white/[0.07] pt-2 text-[10px] text-neutral-500">Observed order flow · no calibrated probability or trade recommendation.</p>
        <details className="border-t border-white/10 pt-3"><summary className="cursor-pointer text-[11px] text-neutral-300">Live order book</summary>{frozen ? <p className="mt-2 text-[10px] text-neutral-500">Return live to view the current book.</p> : <div className="mt-2 h-[330px] overflow-hidden"><OrderBookRail /></div>}</details>
      </aside>
    </div>
  </div>
}

function Metric({ label, value, tone = 'text-neutral-200' }: { label: string; value: string; tone?: string }) { return <div className="min-w-0 px-2 py-2"><div className="text-[9px] text-neutral-500">{label}</div><div className={cn('mt-1 break-words font-mono text-xs tabular-nums', tone)}>{value}</div></div> }
function ReadRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><span className="text-neutral-500">{label}</span><span className="max-w-[60%] text-right text-neutral-300">{value}</span></div> }
