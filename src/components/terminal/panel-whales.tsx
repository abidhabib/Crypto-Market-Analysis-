'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CircleHelp, Link2, Link2Off, Maximize2, Minus, Pause, Play, Plus, RotateCcw, Settings2, Waves } from 'lucide-react'
import { useTerminal } from '@/lib/terminal/store'
import { useCanvasSize, useRaf } from '@/lib/terminal/hooks'
import { useWhalesData, type WhalesFeed } from '@/lib/terminal/use-whales-data'
import { metaFor } from '@/lib/terminal/constants'
import TimeframePicker from './timeframe-picker'
import { timeframeMs } from '@/lib/terminal/indicators'
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/terminal/format'
import { cn } from '@/lib/utils'
import { whaleAnalysis, whaleCandles, whaleContext, whaleModes, recentWhaleTrades, type WhaleMode } from '@/lib/terminal/whales-model'
import { drawWhales, drawWhalesCursor, nearestWhale, whaleBubblePoints, whalesGeometry, whaleTooltipPriceChange, WHALE_BUY, WHALE_SELL, type WhalesView, type WhaleBubblePoint } from '@/lib/terminal/whales-renderer'
import { useHeatmapNavigation } from '@/lib/terminal/use-heatmap-navigation'
import { constrainViewport, zoomViewport, type MapViewport } from '@/lib/terminal/heatmap-navigation'
import { gammaLines, liquidationScenarios, planLines, type MapLine } from '@/lib/terminal/heatmap-orderflow'
import type { Candle, GammaData, Trade } from '@/lib/terminal/types'

const control = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400'
const field = 'rounded-md border border-white/10 bg-[#161616] px-2 py-1.5 text-[11px] text-neutral-200 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400'
const utc = (time: number) => new Date(time).toISOString().slice(11, 19)
const duration = (ms: number) => ms >= 3600000 ? `${(ms / 3600000).toFixed(1)}h` : ms >= 60000 ? `${Math.floor(ms / 60000)}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
interface FrozenWhales { feed: WhalesFeed; trades: Trade[]; candles: Candle[] }

export default function WhalesPanel() {
  const symbol = useTerminal(s => s.symbol)
  return <WhalesWorkspace key={symbol} symbol={symbol} />
}

function WhalesWorkspace({ symbol }: { symbol: string }) {
  const sharedTf = useTerminal(s => s.timeframe), setSharedTf = useTerminal(s => s.setTimeframe)
  const [mobileTools, setMobileTools] = useState(false)
  const [ownTf, setOwnTf] = useState<string | null>(null)
  const timeframe = ownTf ?? sharedTf, tfMs = timeframeMs(timeframe)
  const recording = useWhalesData(symbol, timeframe)
  const [frozen, setFrozen] = useState<FrozenWhales | null>(null)
  const feed = frozen?.feed ?? recording.feed, trades = frozen?.trades ?? recording.trades, rawCandles = frozen?.candles ?? recording.candles
  const [mode, setMode] = useState<WhaleMode>('print'), [threshold, setThreshold] = useState<number | 'auto'>('auto')
  const [windowMs, setWindowMs] = useState(500), [minLevels, setMinLevels] = useState(2)
  const [averages, setAverages] = useState(true), [zones, setZones] = useState(true)
  const [profile, setProfile] = useState(true), [allProfile, setAllProfile] = useState(false)
  const [showEma, setShowEma] = useState(true), [cvd, setCvd] = useState(true)
  const [showPlan, setShowPlan] = useState(false), [showGamma, setShowGamma] = useState(false), [showLiq, setShowLiq] = useState(false)
  const [gamma, setGamma] = useState<GammaData | null>(null), [gammaError, setGammaError] = useState('')
  const [maxBubbles, setMaxBubbles] = useState(200), [maxRadius, setMaxRadius] = useState(36)
  const [opacity, setOpacity] = useState(0.45), [labels, setLabels] = useState(8)
  const [viewport, setViewport] = useState<MapViewport | null>(null), [span, setSpan] = useState(2 * 3600000)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null), [selectedId, setSelectedId] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null), wrapRef = useRef<HTMLDivElement>(null)
  const gestureStart = useRef<{ x: number; y: number } | null>(null)
  const scene = useRef<{ view: WhalesView; canvas: HTMLCanvasElement } | null>(null)
  const size = useCanvasSize(canvasRef)
  const candles = useMemo(() => whaleCandles(rawCandles, feed.klines, tfMs), [rawCandles, feed.klines, tfMs])
  const liveEnd = feed.observedAt + 2 * tfMs, end = Math.min(viewport?.end ?? liveEnd, liveEnd), start = end - span, cutoff = Math.min(feed.observedAt, end)
  const historical = cutoff < feed.observedAt - 2000
  const meta = metaFor(symbol, feed.mid ?? candles.at(-1)?.c)
  const visibleCandles = useMemo(() => candles.filter(c => c.t <= cutoff && (!historical || c.t + tfMs <= cutoff)), [candles, cutoff, historical, tfMs])
  const analysis = useMemo(() => whaleAnalysis(trades, start, cutoff, tfMs, { mode, threshold, step: meta.bin, windowMs: mode === 'level' ? Math.max(5000, windowMs) : windowMs, minLevels }), [trades, start, cutoff, tfMs, mode, threshold, meta.bin, windowMs, minLevels])
  const currentPrice = analysis.observed.at(-1)?.p ?? visibleCandles.at(-1)?.c ?? feed.mid ?? 0
  const priceBounds = useMemo(() => {
    const prices = visibleCandles.filter(c => c.t + tfMs >= start).flatMap(c => [c.l, c.h])
    if (!prices.length) prices.push(...analysis.observed.map(t => t.p))
    if (!prices.length) prices.push(currentPrice || 1)
    const low = Math.min(...prices), high = Math.max(...prices), pad = Math.max((high - low) * 0.12, low * 0.00025, meta.tick * 10)
    return { low: Math.max(meta.tick, low - pad), high: high + pad }
  }, [visibleCandles, start, tfMs, analysis.observed, currentPrice, meta.tick])
  const center = viewport?.center ?? (priceBounds.high + priceBounds.low) / 2, halfRange = viewport?.halfRange ?? (priceBounds.high - priceBounds.low) / 2
  const navigation: MapViewport = { end, span, center, halfRange }
  const bounds = { earliest: candles[0]?.t ?? trades[0]?.t ?? feed.observedAt - span, latest: liveEnd, mid: Math.max(currentPrice, 1),
    minSpan: Math.max(60000, tfMs * 5), maxSpan: Math.max(86400000, tfMs * 500), minCenter: meta.tick, maxCenter: Math.max(priceBounds.high * 2, currentPrice * 2, 1),
    minHalfRange: Math.max(meta.tick * 5, currentPrice * 0.00001), maxHalfRange: Math.max(priceBounds.high, currentPrice, 1) }
  const geometry = whalesGeometry(size.w, size.h, profile, cvd)
  const navigate = (next: MapViewport) => { const constrained = constrainViewport(next, bounds); setSpan(constrained.span); setViewport(constrained); setSelectedId(null) }
  const dragging = useHeatmapNavigation(canvasRef, navigation, bounds, { left: geometry.left, right: geometry.right, top: geometry.top, bottom: geometry.mainBottom }, navigate)
  const resetView = () => { setViewport(null); setSpan(Math.max(2 * 3600000, tfMs * 90)); setSelectedId(null) }
  const currency = symbol.replace(/USDT$/, ''), gammaSupported = ['BTC', 'ETH', 'SOL'].includes(currency)
  useEffect(() => {
    if (!showGamma || !gammaSupported) return
    let active = true
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch(`/api/gamma?currency=${currency}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
        const data = await response.json()
        if (!response.ok || data.error) throw new Error('Options source unavailable')
        if (active) { setGamma(data); setGammaError('') }
      } catch { if (active) { setGamma(null); setGammaError('Options source unavailable; retrying') } }
    }
    refresh(); const timer = setInterval(refresh, 120000)
    return () => { active = false; controller.abort(); clearInterval(timer) }
  }, [showGamma, gammaSupported, currency])
  const lines = useMemo(() => {
    const result: MapLine[] = []
    if (showPlan && !historical && feed.plan) result.push(...planLines(feed.plan.buyAbove, feed.plan.sellBelow))
    if (showGamma && !historical && !frozen) result.push(...gammaLines(gamma, cutoff))
    if (showLiq) result.push(...liquidationScenarios(feed.klines, cutoff, currentPrice, meta.bin))
    return result
  }, [showPlan, showGamma, showLiq, historical, frozen, feed.plan, feed.klines, gamma, cutoff, currentPrice, meta.bin])
  const displayLimit = size.w > 0 && size.w < 600 ? Math.min(40, maxBubbles) : maxBubbles
  const view: WhalesView = useMemo(() => ({ width: size.w, height: size.h, start, end, low: Math.max(meta.tick, center - halfRange), high: center + halfRange, timeframe: tfMs, tick: meta.tick, step: meta.bin,
    candles: visibleCandles, analysis, averages, zones, profile, allProfile, ema: showEma, cvd, maxBubbles: displayLimit, minRadius: 5, maxRadius, opacity, labels, lines }),
  [size.w, size.h, start, end, meta.tick, meta.bin, center, halfRange, tfMs, visibleCandles, analysis, averages, zones, profile, allProfile, showEma, cvd, displayLimit, maxRadius, opacity, labels, lines])
  const points = useMemo(() => whaleBubblePoints(view), [view])
  const inspected = (selectedId ? points.find(p => p.event.id === selectedId) : null) ?? nearestWhale(points, pointer)
  useRaf(() => {
    const canvas = canvasRef.current, ctx = canvas?.getContext('2d')
    if (!ctx || !canvas || size.w < 10 || size.h < 10) return
    if (!scene.current || scene.current.view !== view) {
      const background = document.createElement('canvas'); background.width = canvas.width; background.height = canvas.height
      const backgroundCtx = background.getContext('2d')
      if (!backgroundCtx) return
      backgroundCtx.setTransform(canvas.width / size.w, 0, 0, canvas.height / size.h, 0, 0)
      drawWhales(backgroundCtx, view); scene.current = { view, canvas: background }
    }
    ctx.clearRect(0, 0, size.w, size.h); ctx.drawImage(scene.current.canvas, 0, 0, size.w, size.h)
    drawWhalesCursor(ctx, view, pointer, inspected)
  }, true, 16)
  const hoverTime = pointer ? start + (pointer.x - geometry.left) / (geometry.right - geometry.left) * (end - start) : null
  const candle = hoverTime === null ? null : visibleCandles.find(c => c.t <= hoverTime && c.t + tfMs > hoverTime) ?? null
  const hoveredBar = candle ? analysis.bars.find(b => b.t === candle.t) : null
  const coverage = analysis.first === null || analysis.last === null ? 0 : analysis.last - analysis.first
  const live = recentWhaleTrades(feed.status, feed.lastTradeReceivedAt, feed.clientObservedAt) && !historical && !frozen
  const outside = lines.filter(l => l.price < view.low || l.price > view.high)
  const toggle = (label: string, value: boolean, set: (value: boolean) => void, help: string) => <button key={label} type="button" title={help} aria-label={`Toggle whale ${label}`} aria-pressed={value} onClick={() => set(!value)} className={cn(control, value ? 'border-white/15 bg-white/[0.06] text-neutral-200' : 'border-transparent text-neutral-500 hover:text-neutral-300')}><span className={cn('size-1.5 rounded-full', value ? 'bg-neutral-300' : 'border border-neutral-600')} />{label}</button>

  return <div ref={wrapRef} className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#0c0c0c] text-neutral-200 [color-scheme:dark]" data-testid="panel-whales">
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.07] px-3 py-2">
      <Waves size={16} className="text-emerald-400" /><h1 className="mr-1 text-sm font-semibold">Whale flow</h1><span className="hidden text-[10px] text-neutral-500 sm:inline">{meta.label} · Binance spot executions</span>
      <span className={cn('ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px]', live ? 'border-emerald-400/20 text-emerald-300' : 'border-amber-300/20 text-amber-300')}><span className={cn('size-1.5 rounded-full', live ? 'bg-emerald-400' : 'bg-amber-300')} />{frozen ? 'Paused snapshot' : historical ? 'Historical view' : live ? 'Live executions' : feed.status === 'live' ? 'Waiting for trades' : 'Feed reconnecting'}</span>
      <button type="button" aria-label="Expand whale chart" title="Fullscreen whale workspace" onClick={() => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else wrapRef.current?.requestFullscreen().catch(() => {}) }} className={cn(control, 'border-white/10 text-neutral-400')}><Maximize2 size={13} /></button>
    </div>
    <div className="relative flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-white/[0.07] px-3 py-2" data-testid="whales-toolbar">
      <span className="hidden text-[10px] text-neutral-500 sm:inline">Detect</span>
      <select aria-label="Whale detection mode" value={mode} onChange={e => { setMode(e.target.value as WhaleMode); setSelectedId(null) }} className={cn(field, "sm:hidden")}>{whaleModes.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
      <div className="hidden rounded-md border border-white/10 bg-[#171717] sm:inline-flex p-0.5" role="group" aria-label="Whale detection mode">{whaleModes.map(m => <button type="button" key={m.id} title={m.help} aria-pressed={mode === m.id} onClick={() => { setMode(m.id); setSelectedId(null) }} className={cn('min-h-7 rounded px-2 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-emerald-400', mode === m.id ? 'bg-white/10 font-medium text-white' : 'text-neutral-500 hover:text-neutral-200')}>{m.label}</button>)}</div>
      <label className="ml-1 flex items-center gap-1.5 text-[10px] text-neutral-500">Size ≥<select aria-label="Whale minimum notional" value={threshold} onChange={e => setThreshold(e.target.value === 'auto' ? 'auto' : Number(e.target.value))} className={field}><option value="auto">Auto ({fmtCompact(analysis.threshold, '$')})</option>{[1000, 10000, 50000, 100000, 250000, 1000000, 5000000].map(n => <option key={n} value={n}>{fmtCompact(n, '$')}</option>)}</select></label>
      <button type="button" aria-expanded={mobileTools} aria-controls="whales-extra-controls" onClick={() => setMobileTools(v => !v)} className={cn(control, 'ml-auto border-white/10 text-neutral-300 sm:hidden')}><Settings2 size={12} />Tools</button>
      <TimeframePicker value={timeframe} label="Whale candle interval" onChange={(id, ms) => { if (ownTf === null) setSharedTf(id); else setOwnTf(id); setFrozen(null); setViewport(null); setSpan(Math.max(2 * 3600000, ms * 90)) }} />
      <button type="button" aria-label="Link whale timeframe" aria-pressed={ownTf === null} title={ownTf === null ? 'Linked to shared timeframe; click to use its own' : 'Independent timeframe; click to link'} onClick={() => { setOwnTf(ownTf === null ? timeframe : null); setFrozen(null); setViewport(null) }} className={cn(control, 'border-transparent text-neutral-500')}>{ownTf === null ? <Link2 size={13} /> : <Link2Off size={13} />}</button>
      <div className="hidden gap-2 font-mono text-[10px] sm:flex"><span className="text-emerald-400">buy {fmtCompact(analysis.buy, '$')}</span><span className="text-rose-400">sell {fmtCompact(analysis.sell, '$')}</span></div>
      <div id="whales-extra-controls" className={cn("flex flex-wrap items-center gap-0.5 xl:ml-auto", !mobileTools && "max-sm:hidden")}>
        {toggle('Whale avg', averages, setAverages, 'Quantity-weighted execution prices for detected buyers and sellers in view')}
        {toggle('Zones', zones, setZones, 'Two largest traded price bins per aggressor side; these are executions, not resting orders')}
        {toggle('Profile', profile, setProfile, 'Price-aligned buy/sell volume from actual executions')}
        <button type="button" aria-label={frozen ? 'Resume whale feed' : 'Pause whale feed'} onClick={() => { if (frozen) { setFrozen(null); resetView() } else setFrozen({ feed, trades: trades.slice(), candles: rawCandles.map(c => ({ ...c })) }) }} className={cn(control, frozen ? 'border-amber-300/25 text-amber-300' : 'border-transparent text-neutral-400')}>{frozen ? <Play size={12} /> : <Pause size={12} />}{frozen ? 'Resume' : 'Pause'}</button>
        <details className="relative max-sm:static" data-testid="whales-settings"><summary className={cn(control, 'cursor-pointer list-none border-white/10 text-neutral-400')}><Settings2 size={12} />Settings</summary><div className="absolute right-0 top-full z-40 mt-2 max-h-[70vh] w-[min(330px,calc(100vw-24px))] space-y-3 overflow-y-auto rounded-lg border border-white/15 bg-[#181818] p-4 text-[11px] shadow-2xl">
          <p className="font-semibold text-neutral-100">Bubble detection & display</p><p className="leading-relaxed text-neutral-500">{whaleModes.find(m => m.id === mode)?.help}</p>
          <label className="flex items-center justify-between gap-2">Burst / level window<select aria-label="Whale detection window" disabled={mode === 'print'} value={windowMs} onChange={e => setWindowMs(Number(e.target.value))} className={field}>{[250, 500, 1000, 5000, 15000, 60000].map(n => <option value={n} key={n}>{n < 1000 ? `${n}ms` : `${n / 1000}s`}{mode === 'level' && n < 5000 ? ' (level min 5s)' : ''}</option>)}</select></label>
          <label className="flex items-center justify-between gap-2">Sweep price levels ≥<select aria-label="Minimum swept levels" disabled={mode !== 'sweep'} value={minLevels} onChange={e => setMinLevels(Number(e.target.value))} className={field}>{[2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="flex items-center justify-between gap-2">Largest bubble<span className="font-mono text-neutral-500">{maxRadius}px</span><input type="range" min="18" max="56" step="2" aria-label="Whale bubble size" value={maxRadius} onChange={e => setMaxRadius(Number(e.target.value))} className="w-24 accent-emerald-400" /></label>
          <label className="flex items-center justify-between gap-2">Bubble opacity<span className="font-mono text-neutral-500">{Math.round(opacity * 100)}%</span><input type="range" min="0.2" max="0.85" step="0.05" aria-label="Whale bubble opacity" value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="w-24 accent-emerald-400" /></label>
          <label className="flex items-center justify-between gap-2">Labels on largest<select aria-label="Whale bubble labels" value={labels} onChange={e => setLabels(Number(e.target.value))} className={field}>{[0, 4, 8, 15, 30].map(n => <option key={n} value={n}>{n ? n : 'Off'}</option>)}</select></label>
          <label className="flex items-center justify-between gap-2">Maximum drawn bubbles<select aria-label="Whale bubble display limit" value={maxBubbles} onChange={e => setMaxBubbles(Number(e.target.value))} className={field}>{[20, 40, 100, 200, 400, 1000].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="flex items-center justify-between gap-2">Side profile<select aria-label="Whale profile scope" value={allProfile ? 'all' : 'large'} onChange={e => setAllProfile(e.target.value === 'all')} className={field}><option value="large">Detected executions</option><option value="all">All recorded trades</option></select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={showEma} onChange={e => setShowEma(e.target.checked)} className="accent-amber-300" />EMA 20 / 50</label>
          <label className="flex items-center gap-2"><input type="checkbox" aria-label="Whale net flow pane" checked={cvd} onChange={e => setCvd(e.target.checked)} className="accent-emerald-400" />Net flow / CVD pane</label>
          {size.w < 600 && <p className="text-neutral-500">Mobile draws up to 40 bubbles with a 20px radius cap for readability. Totals include every detection.</p>}
          <p className="border-t border-white/10 pt-2 leading-relaxed text-neutral-500">Aggressor side comes from the exchange maker flag. Account identities, iceberg ownership and historical DOM pressure cannot be established from these executions.</p>
          <button type="button" onClick={() => { setMode('print'); setThreshold('auto'); setWindowMs(500); setMinLevels(2); setMaxBubbles(200); setMaxRadius(36); setOpacity(0.45); setLabels(8); setAverages(true); setZones(true); setProfile(true); setAllProfile(false); setShowEma(true); setCvd(true); resetView() }} className="flex items-center gap-1.5 text-neutral-300"><RotateCcw size={12} />Reset whale display</button>
        </div></details>
        <details className="relative max-sm:static" data-testid="whales-methodology"><summary aria-label="Whales methodology" className={cn(control, 'cursor-pointer list-none border-transparent text-neutral-500')}><CircleHelp size={14} /></summary><div className="absolute right-0 top-full z-40 mt-2 max-h-[65vh] w-[min(400px,calc(100vw-24px))] space-y-3 overflow-y-auto rounded-lg border border-white/15 bg-[#181818] p-4 text-xs leading-relaxed shadow-2xl"><h2 className="font-semibold text-neutral-100">How to read whale flow</h2><p>Every bubble comes from recorded Binance spot executions. Green = buyer aggressor, red = seller aggressor; split bubbles contain both. Area scales with dollars between the minimum and maximum display sizes. Hover or tap for exact values.</p><p>Big print is one exchange aggregate-trade ID. Sweep and Aggressive group observed bursts; Level groups a price/time bin. Groups do not identify individual people or prove one order.</p><p>Auto selects the top 0.5% of the current mode’s candidate sizes in view, with a $1K floor. A small recording gives a small calibration sample.</p><p>Average lines are execution VWAP: dollars divided by coin quantity. Zones are the largest traded price bins, not outstanding orders, verified cost bases or support guarantees.</p><p>Volume and CVD use actual recorded trades only. Other trades are the remaining observed executions after removing detections. CVD lines each use their own scale; compare direction, and use the dollar totals for magnitude.</p><p>History is bounded to 40,000 aggregate trades. Yellow marks missing earlier coverage and ID gaps. Candles do not create missing whale executions.</p><p>Wheel: time zoom · Shift / price axis: price zoom · pinch: both · drag / trackpad: pan · double-click / Home: live. Thresholds and totals refer to the visible window.</p></div></details>
      </div>
    </div>
    <div className={cn("flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.07] px-3 py-1.5 text-[10px] text-neutral-500", !mobileTools && "max-sm:hidden")}>
      <span>Lines</span>{[{ label: 'Plan', active: showPlan, set: setShowPlan, help: 'Signals trigger levels; hidden in historical exploration' }, { label: 'Γ', active: showGamma, set: setShowGamma, help: 'Fresh computed Deribit options levels; BTC/ETH/SOL only' }, { label: 'Liq', active: showLiq, set: setShowLiq, help: 'Leverage scenarios, not known liquidation positions' }].map(item => <button type="button" key={item.label} aria-label={`Whale ${item.label} lines`} aria-pressed={item.active} title={item.help} onClick={() => item.set(!item.active)} className={cn('rounded border px-2 py-1 focus-visible:ring-2 focus-visible:ring-neutral-400', item.active ? 'border-neutral-400/25 text-neutral-200' : 'border-white/10 text-neutral-500')}>{item.label}</button>)}
      <span className="hidden sm:inline"><span className="text-[#e5be35]">— EMA20</span> · <span className="text-[#a18bd6]">— EMA50</span> · <span className="text-emerald-400">▲ buy</span> / <span className="text-rose-400">▼ sell</span></span>
      {showLiq && <span className="text-pink-300">Liq: modeled 25×/50×/100× leverage, assumed 0.5% maintenance; actual positions unknown.</span>}
      {showGamma && <span>{!gammaSupported ? 'Γ supports BTC, ETH and SOL.' : historical || frozen ? 'Γ hidden: no historical options recording.' : gammaError || (!gamma ? 'Loading options…' : gammaLines(gamma, cutoff).length ? 'Computed Deribit snapshot; ≤30d expiry.' : 'No fresh eligible options levels.')}</span>}
      {historical && showPlan && <span>Live Plan hidden while inspecting earlier history.</span>}{outside.length > 0 && <span>{outside.length} overlay levels outside the price range.</span>}
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.07] px-3 py-2 text-[11px]" data-testid="whales-context">
      <span className="hidden text-neutral-500 sm:inline">In view{analysis.first !== null ? ` since ${utc(analysis.first)} UTC` : ''}:</span><span className={analysis.priceChange !== null && analysis.priceChange < 0 ? 'text-rose-300' : 'text-emerald-300'}>price {fmtPct(analysis.priceChange)}</span>
      <span className={analysis.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}>large net {analysis.net >= 0 ? '+' : ''}{fmtCompact(analysis.net, '$')}</span><span className="text-neutral-400">{analysis.events.length.toLocaleString()} bubbles{analysis.events.length > displayLimit ? ` · largest ${displayLimit} drawn` : ''}</span><span className="hidden text-neutral-500 sm:inline">{whaleContext(analysis)}</span>
    </div>
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.07] px-3 py-1.5 text-[10px] text-neutral-500" data-testid="whales-data-quality">
      <span className={analysis.gaps || recording.history.error ? 'text-amber-300' : 'text-neutral-400'}>Recorded {analysis.observed.length.toLocaleString()} aggTrades · observed span {duration(coverage)} / {duration(span)} chart</span><span>{analysis.gaps ? `${analysis.gaps} ID gaps · ${analysis.missingIds.toLocaleString()} missing IDs` : analysis.observed.length ? 'No ID gaps within recorded trades' : 'No execution coverage yet'}</span>
      {recording.history.loading ? <><span className="text-neutral-300">Loading history · {recording.history.count.toLocaleString()} / 40K</span><button type="button" onClick={recording.stopHistory} className="text-neutral-400 underline underline-offset-2">Stop backfill</button></> : <button type="button" onClick={recording.retryHistory} className="text-neutral-300 hover:underline">{recording.history.error ? 'Retry history' : 'Refresh history'}</button>}
      {recording.history.error && <span className="text-amber-300">History incomplete · live recording continues</span>}{recording.candleError && <span className="text-amber-300">{recording.candleError}</span>}<span className="ml-auto hidden md:inline">Measured exchange activity · wallet identity unavailable</span>
    </div>
    <div className="relative min-h-[360px] flex-1 overflow-hidden sm:min-h-[430px]" data-testid="whales-chart" data-mode={mode} data-bubbles={analysis.events.length} data-drawn-bubbles={points.length} data-threshold={analysis.threshold} data-recorded-trades={analysis.observed.length} data-view-start={start} data-view-end={end} data-view-span={span} data-view-center={center} data-view-range={halfRange} data-plot-right={geometry.right} data-plot-top={geometry.top} data-plot-bottom={geometry.mainBottom} data-net={analysis.net} data-buy={analysis.buy} data-sell={analysis.sell} data-buy-average={analysis.buyVwap ?? ''} data-sell-average={analysis.sellVwap ?? ''}>
      <canvas ref={canvasRef} tabIndex={0} aria-label="Whale execution chart. Hover or tap bubbles; plus and minus zoom, arrows pan, Home returns live." className="block h-full w-full outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-neutral-400" style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'crosshair' }}
        onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setPointer({ x: e.clientX - r.left, y: e.clientY - r.top }) }} onPointerLeave={() => setPointer(null)}
        onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); gestureStart.current = { x: e.clientX - r.left, y: e.clientY - r.top } }}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(), point = { x: e.clientX - r.left, y: e.clientY - r.top }; if (gestureStart.current && Math.hypot(point.x - gestureStart.current.x, point.y - gestureStart.current.y) > 6) return; setSelectedId(nearestWhale(points, point)?.event.id ?? null); setPointer(point) }}
        onDoubleClick={() => { setFrozen(null); resetView() }} onKeyDown={e => { if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'Home', 'Escape'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (e.key === 'Home' || e.key === 'Escape') { setFrozen(null); resetView() } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') navigate({ ...navigation, end: Math.max(bounds.earliest + span, Math.min(liveEnd, end + (e.key === 'ArrowLeft' ? -1 : 1) * span * 0.15)) }); else navigate(zoomViewport(navigation, bounds, e.key === '-' ? 1.25 : 0.8, 0.5, 0.5, 'time')) } }} />
      {!candles.length && !trades.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="max-w-xs space-y-2 text-center"><Waves size={28} className="mx-auto text-emerald-400/70" /><p className="text-sm">Waiting for recorded market activity</p><p className="text-xs leading-relaxed text-neutral-500">Actual candles and executions will appear when the sources respond. Candle history does not create whale prints.</p></div></div>}
      {inspected && <WhaleInspector bubble={inspected} current={analysis.observed.at(-1)?.p ?? null} tick={meta.tick} pointer={pointer} width={size.w} height={size.h} mode={mode} pinned={!!selectedId} />}
      {!inspected && candle && pointer && pointer.y < geometry.mainBottom && pointer.x >= geometry.left && pointer.x <= geometry.right && <div data-testid="whales-candle-inspector" className="pointer-events-none absolute z-20 max-w-[calc(100%-16px)] rounded border border-neutral-600/50 bg-[#101925]/95 px-2 py-1.5 font-mono text-[10px] text-neutral-300 shadow-lg" style={{ left: Math.max(8, Math.min(pointer.x + 14, size.w - 340)), top: Math.min(size.h - 80, pointer.y + 18) }}><div>{utc(candle.t)} UTC · O {fmtPrice(candle.o, meta.tick)} H {fmtPrice(candle.h, meta.tick)}</div><div>L {fmtPrice(candle.l, meta.tick)} C {fmtPrice(candle.c, meta.tick)}</div><div className="mt-1 text-neutral-500">Recorded buy {fmtCompact(hoveredBar?.buy ?? 0, '$')} / sell {fmtCompact(hoveredBar?.sell ?? 0, '$')} · {hoveredBar ? 'observed executions' : 'no trade coverage'}</div></div>}
      <div className="absolute bottom-9 left-3 flex items-center gap-1 rounded-md border border-white/10 bg-[#0b131f]/95 p-1 shadow-lg" role="group" aria-label="Whale chart navigation"><button type="button" aria-label="Zoom whale chart in" onClick={() => navigate(zoomViewport(navigation, bounds, 0.8, 0.5, 0.5, 'time'))} className="rounded p-1 text-neutral-300 hover:bg-white/10"><Plus size={14} /></button><button type="button" aria-label="Zoom whale chart out" onClick={() => navigate(zoomViewport(navigation, bounds, 1.25, 0.5, 0.5, 'time'))} className="rounded p-1 text-neutral-300 hover:bg-white/10"><Minus size={14} /></button><span className="px-1 font-mono text-[10px] text-neutral-500">{duration(span)}</span><button type="button" aria-label="Reset whale chart" title="Return to live / auto price range" onClick={() => { setFrozen(null); resetView() }} className="rounded p-1 text-neutral-400 hover:bg-white/10"><RotateCcw size={12} /></button></div>
      {(viewport || frozen) && <button type="button" onClick={() => { setFrozen(null); resetView() }} className={cn(control, 'absolute right-24 top-2 border-neutral-400/25 bg-[#101b29] text-neutral-200')}><ArrowLeft size={12} />Back to live</button>}
      <span className="sr-only">Price range {fmtPrice(view.low, meta.tick)} to {fmtPrice(view.high, meta.tick)}.</span>
    </div>
    <details className="shrink-0 border-t border-white/[0.07] px-3 py-2 text-[10px]" data-testid="whales-execution-table"><summary className="cursor-pointer text-neutral-400">Detected executions · exact values <span className="text-neutral-600">({analysis.events.length.toLocaleString()} groups, newest first)</span></summary><p className="my-2 text-neutral-500">One row per bubble. Dollars and quantities are measured executions; grouping does not identify an account. Up to 100 rows shown; totals include every detected group.</p><div className="max-h-64 overflow-auto"><table className="w-full min-w-[580px] text-right font-mono" aria-label="Whale detected execution values"><thead className="sticky top-0 bg-[#101925] text-neutral-500"><tr>{['Time UTC', 'Price / VWAP', 'Buy $', 'Sell $', 'Coin qty', 'Agg IDs', 'Levels'].map(s => <th key={s} className="px-2 py-1 font-normal">{s}</th>)}</tr></thead><tbody>{analysis.events.slice(-100).reverse().map(e => <tr key={e.id} className="border-t border-white/[0.04]"><td className="px-2 py-1">{utc(e.t)}</td><td className="px-2">{fmtPrice(e.price, meta.tick)}</td><td className="px-2 text-emerald-300">{fmtCompact(e.buy, '$')}</td><td className="px-2 text-rose-300">{fmtCompact(e.sell, '$')}</td><td className="px-2">{e.qty.toLocaleString('en-US', { maximumFractionDigits: 8 })}</td><td className="px-2" title={`First ${e.firstId} · last ${e.lastId}`}>{e.count}</td><td className="px-2">{e.levels}</td></tr>)}</tbody></table>{!analysis.events.length && <p className="py-3 text-center text-neutral-500">No detections at this threshold in view. Lower Size ≥ or wait for recorded trades.</p>}</div></details>
    <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.07] px-3 py-1.5 text-[10px] text-neutral-600"><span>Scroll: time zoom · Shift / price axis: price zoom · drag / pinch: navigate</span><span className="ml-auto">UTC · USDT · CVD lines separately scaled · No wallet identity</span></div>
  </div>
}

function WhaleInspector({ bubble, current, tick, pointer, width, height, mode, pinned }: { bubble: WhaleBubblePoint; current: number | null; tick: number; pointer: { x: number; y: number } | null; width: number; height: number; mode: WhaleMode; pinned: boolean }) {
  const e = bubble.event, move = whaleTooltipPriceChange(e, current)
  return <div data-testid="whales-bubble-inspector" className="pointer-events-none absolute z-30 w-[250px] max-w-[calc(100%-16px)] space-y-2 rounded-lg border border-neutral-500/40 bg-[#111b29]/95 p-3 text-[11px] shadow-2xl" style={{ left: Math.max(8, Math.min((pointer?.x ?? bubble.x) + 18, width - 260)), top: Math.max(8, Math.min((pointer?.y ?? bubble.y) + 18, height - 250)) }}>
    <div className="flex items-center justify-between gap-2"><strong className={e.buy >= e.sell ? 'text-emerald-300' : 'text-rose-300'}>{fmtCompact(e.total, '$')} {e.buy && e.sell ? 'mixed' : e.buy ? 'buy' : 'sell'}</strong><span className="text-[9px] text-neutral-500">{pinned ? 'Pinned · tap to change' : 'Tap to pin'}</span></div>
    <p className="font-mono text-neutral-300">{fmtPrice(e.price, tick)} · {utc(e.start)} UTC{e.end !== e.start ? `–${utc(e.end)}` : ''}</p>
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono"><span style={{ color: WHALE_BUY }}>Buy {fmtCompact(e.buy, '$')}</span><span style={{ color: WHALE_SELL }}>Sell {fmtCompact(e.sell, '$')}</span><span>Qty {e.qty.toLocaleString('en-US', { maximumFractionDigits: 8 })}</span><span>{e.count} agg IDs</span><span>Levels {e.levels}</span><span>{Math.round(e.buy / e.total * 100)}% buyer-led</span></div>
    <p className="text-neutral-500">ID {e.firstId}{e.lastId !== e.firstId ? `–${e.lastId}` : ''} · {mode === 'print' ? 'exchange aggregate print' : 'observed execution group'}</p><p className="border-t border-white/10 pt-2 text-neutral-400">Recorded price since: <span className={move !== null && move < 0 ? 'text-rose-300' : 'text-emerald-300'}>{fmtPct(move)}</span> · price change, not account P&amp;L.</p>
  </div>
}
