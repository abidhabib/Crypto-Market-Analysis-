'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, CircleHelp, Crosshair, Pause, Play, RotateCcw, Settings2, Minus, Plus, PanelRight } from 'lucide-react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, now } from '@/lib/terminal/stream-client'
import { usePoll, useRaf, useCanvasSize } from '@/lib/terminal/hooks'
import { metaFor } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact } from '@/lib/terminal/format'
import { analyzeHeatmap, binDepth, bubbleRadius, columnAt, depthQuality, nearbyLiquidity, reactionColors, reactionLabels, replayFrame, summarizeFlow, type LiquidityZone } from '@/lib/terminal/heatmap-model'
import { ASK_COLOR, BID_COLOR, drawHeatmap, drawHeatmapCursor, getReactionMarkers, getTradeBubbles, heatmapGeometry, type HeatmapView } from '@/lib/terminal/heatmap-renderer'
import { DataQualityStrip, ReactionFeed, ReplayControls } from './heatmap-insights'
import { cn } from '@/lib/utils'
import { zoomViewport, type MapViewport } from '@/lib/terminal/heatmap-navigation'
import { levels as decisionLevels } from '@/lib/terminal/analytics'
import { columnLayout } from '@/lib/terminal/heatmap-columns-renderer'
import { orderFlowAt, planLines, liquidationScenarios, gammaLines, recordedLiquidations, type HeatmapColumn, type MapLine } from '@/lib/terminal/heatmap-orderflow'
import type { GammaData } from '@/lib/terminal/types'
import { HeatmapColumnsMenu, CompactFlowLadder, StackedFlowColumns } from './heatmap-orderflow-controls'
import { useHeatmapNavigation } from '@/lib/terminal/use-heatmap-navigation'

const WINDOWS = [{ label: '1m', ms: 60000 }, { label: '2m', ms: 120000 }, { label: '5m', ms: 300000 }, { label: '10m', ms: 600000 }]
const fieldClass = 'rounded-lg border border-white/10 bg-[#111c2c] px-2.5 py-2 text-xs text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
const buttonClass = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
const duration = (ms: number) => ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
const clock = (ts: number) => new Date(ts).toISOString().slice(11, 19)

function captureFeed() {
  const s = getStream()
  return { ...s, heatCols: s.heatCols.slice(), trades: s.trades.slice(), klines: s.klines.map(c => ({ ...c })), liqs: s.liqs.slice(), walls: s.walls.slice(), plan: decisionLevels(), observedAt: now() }
}

export default function HeatmapPanel() {
  const symbol = useTerminal(s => s.symbol)
  return <HeatmapWorkspace key={symbol} symbol={symbol} />
}

function HeatmapWorkspace({ symbol }: { symbol: string }) {
  const feed = usePoll(captureFeed, 500)
  const [frozen, setFrozen] = useState<ReturnType<typeof captureFeed> | null>(null)
  const [replaySource, setReplaySource] = useState<ReturnType<typeof captureFeed> | null>(null)
  const [replayAt, setReplayAt] = useState(0)
  const [replayPlaying, setReplayPlaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(2)
  const source = replaySource ?? frozen ?? feed
  const data = useMemo(() => replaySource ? {
    ...source, ...replayFrame(source.heatCols, source.trades, replayAt), observedAt: replayAt,
    bookTop: null, ticker: null, lastError: null, status: 'live' as const,
    klines: source.klines.filter(c => c.t + 60000 <= replayAt), liqs: source.liqs.filter(l => l.t <= replayAt), mark: null, oi: null,
  } : source, [source, replaySource, replayAt])
  useEffect(() => {
    if (!replaySource || !replayPlaying) return
    const timer = setTimeout(() => {
      const next = Math.min(replaySource.observedAt, replayAt + 250 * replaySpeed)
      setReplayAt(next)
      if (next >= replaySource.observedAt) setReplayPlaying(false)
    }, 250)
    return () => clearTimeout(timer)
  }, [replaySource, replayPlaying, replayAt, replaySpeed])
  const [span, setSpan] = useState(120000)
  const [viewport, setViewport] = useState<MapViewport | null>(null)
  const [showInsights, setShowInsights] = useState(false)
  const [selectedColumns, setSelectedColumns] = useState<HeatmapColumn[]>(['dom', 'tape'])
  const [flowScope, setFlowScope] = useState<'window' | 'recorded'>('window')
  const [domUnits, setDomUnits] = useState<'usd' | 'coin'>('usd')
  const [tapeMin, setTapeMin] = useState(0)
  const [showCvd, setShowCvd] = useState(false)
  const [showQuotes, setShowQuotes] = useState(true)
  const [showPlan, setShowPlan] = useState(true)
  const [showAverages, setShowAverages] = useState(false)
  const [showLiq, setShowLiq] = useState(false)
  const [showGamma, setShowGamma] = useState(false)
  const [showCandles, setShowCandles] = useState(false)
  const [bubbleMode, setBubbleMode] = useState<'auto' | 'trades' | 'steps'>('auto')
  const [bubbleInterval, setBubbleInterval] = useState(0)
  const [manualPlan, setManualPlan] = useState({ entry: '', stop: '', target: '' })
  const [gamma, setGamma] = useState<GammaData | null>(null)
  const [gammaError, setGammaError] = useState('')
  const currency = symbol.replace(/USDT$/, '')
  const gammaSupported = ['BTC', 'ETH', 'SOL'].includes(currency)
  useEffect(() => {
    if (!showGamma || !gammaSupported) return
    let alive = true
    const refresh = () => fetch(`/api/gamma?currency=${currency}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
      .then(r => r.json()).then(j => { if (!alive) return; if (j.error) { setGamma(null); setGammaError(j.error) } else { setGamma(j); setGammaError('') } })
      .catch(() => { if (alive) { setGamma(null); setGammaError('Options source unavailable; retrying') } })
    refresh(); const timer = setInterval(refresh, 120000)
    return () => { alive = false; clearInterval(timer) }
  }, [showGamma, gammaSupported, currency])
  const [rangeSetting, setRangeSetting] = useState('auto')
  const [contrast, setContrast] = useState(1)
  const [minTrade, setMinTrade] = useState(1000)
  const [bubbleScale, setBubbleScale] = useState(1.35)
  const [showTrades, setShowTrades] = useState(true)
  const [showProfile, setShowProfile] = useState(true)
  const [showReactions, setShowReactions] = useState(true)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastDraw = useRef('')
  const lastPresentation = useRef('')
  const sceneRef = useRef<HTMLCanvasElement | null>(null)
  const size = useCanvasSize(canvasRef)
  const end = Math.min(viewport?.end ?? data.observedAt, data.observedAt)
  const last = viewport || replaySource ? columnAt(data.heatCols, end) : data.heatCols.at(-1) ?? null
  const mid = last?.mid ?? (!viewport && !replaySource ? data.ticker?.c : null) ?? 0
  const meta = metaFor(symbol, mid)
  const start = end - span
  const autoRange = useMemo(() => {
    if (rangeSetting !== 'auto') return Number(rangeSetting)
    if (!last || !mid) return 0.15
    const history = data.heatCols.filter(c => c.t >= start && c.t <= end)
    const excursion = Math.max(0, ...history.map(c => Math.abs(c.mid / mid - 1) * 100))
    const prices = [...last.bids.slice(0, 80), ...last.asks.slice(0, 80)].map(l => Math.abs(l.p / mid - 1) * 100).sort((a, b) => a - b)
    return Math.max(0.04, Math.min(2, Math.max(excursion * 1.25, (prices[Math.floor(prices.length * 0.9)] ?? 0.08) * 0.8)))
  }, [last, mid, rangeSetting, data.heatCols, start, end])
  const range = viewport && mid ? viewport.halfRange / mid * 100 : autoRange
  const center = viewport?.center ?? mid
  const step = meta.bin * Math.max(1, Math.ceil(mid * range / 100 * 2 / 80 / meta.bin))
  const flow = useMemo(() => summarizeFlow(data.trades, start, end, step), [data.trades, start, end, step])
  const liquidity = useMemo(() => nearbyLiquidity(last, step, mid * range / 100), [last, step, mid, range])
  const analysis = useMemo(() => analyzeHeatmap(data.heatCols, data.trades, start, end, step), [data.heatCols, data.trades, start, end, step])
  const quality = useMemo(() => depthQuality(data.heatCols, data.observedAt - span, data.observedAt), [data.heatCols, data.observedAt, span])
  const totals = useMemo(() => {
    const sum = (side: 'bids' | 'asks') => last?.[side].reduce((n, l) => Math.abs(l.p - mid) <= mid * range / 100 ? n + l.p * l.q : n, 0) ?? 0
    const bid = sum('bids'), ask = sum('asks')
    return { bid, ask, share: bid + ask > 0 ? bid / (bid + ask) : null }
  }, [last, mid, range])
  const stale = !last || (quality.ageMs ?? Infinity) > 5000 || data.status !== 'live'
  const historyMs = quality.recordedMs
  const tradeMs = flow.first === null ? 0 : Math.min(span, end - flow.first)
  const orderFlow = useMemo(() => orderFlowAt(data.heatCols, data.trades, start, end, step, flowScope, selectedColumns.includes('quotes')), [data.heatCols, data.trades, start, end, step, flowScope, selectedColumns])
  const historical = !!replaySource || !!viewport
  const liqLevels = useMemo(() => showLiq ? liquidationScenarios(data.klines, end, mid, step) : [], [showLiq, data.klines, end, mid, step])
  const liqPrints = useMemo(() => showLiq ? recordedLiquidations(data.liqs, start, end) : [], [showLiq, data.liqs, start, end])
  const lines = useMemo(() => {
    const result: MapLine[] = []
    if (showPlan) {
      const manual = (['entry', 'stop', 'target'] as const).filter(k => Number(manualPlan[k]) > 0 && Number.isFinite(Number(manualPlan[k])))
      if (manual.length) for (const k of manual) result.push({ id: `manual-${k}`, price: Number(manualPlan[k]), label: `My ${k}`, kind: 'custom', color: k === 'stop' ? '#fb7185' : k === 'target' ? '#34d399' : '#7dd3fc', note: 'Manually entered planning level. It does not place an order.' })
      else if (!historical) result.push(...planLines(data.plan.buyAbove, data.plan.sellBelow))
      else {
        const ask = analysis.zones.filter(z => z.side === 'ask' && z.price > mid).sort((a, b) => a.price - b.price)[0]
        const bid = analysis.zones.filter(z => z.side === 'bid' && z.price < mid).sort((a, b) => b.price - a.price)[0]
        result.push(...planLines(ask?.price ?? null, bid?.price ?? null).map(l => ({ ...l, label: `Recorded ${l.label.toLowerCase()}`, note: 'Nearest significant wall in the historical snapshot, recalculated without the present Signals state. This is a reference level, not a validated setup.' })))
      }
    }
    if (showAverages) {
      if (orderFlow.buyVwap) result.push({ id: 'buy-average', price: orderFlow.buyVwap, label: 'Buy VWAP', kind: 'average', color: '#34d399', note: 'Coin-volume-weighted average price of recorded buy-initiated executions in the selected scope; not buyer positions or cost basis.' })
      if (orderFlow.sellVwap) result.push({ id: 'sell-average', price: orderFlow.sellVwap, label: 'Sell VWAP', kind: 'average', color: '#fb7185', note: 'Coin-volume-weighted average price of recorded sell-initiated executions in the selected scope; not seller positions or cost basis.' })
    }
    if (showLiq) result.push(...liqLevels)
    if (showGamma && !historical) result.push(...gammaLines(gamma, end))
    return result
  }, [showPlan, manualPlan, historical, data.plan, analysis.zones, mid, showAverages, orderFlow.buyVwap, orderFlow.sellVwap, showLiq, liqLevels, showGamma, gamma, end])
  const visibleCandles = useMemo(() => showCandles ? data.klines.filter(c => c.t <= end && c.t + 60000 >= start && (!historical || c.t + 60000 <= end)) : [], [showCandles, data.klines, start, end, historical])
  const view: HeatmapView = {
    width: size.w, height: size.h, end, span, mid, priceCenter: center, range, step, contrast, minTrade, bubbleScale,
    showTrades, showProfile, columns: data.heatCols, trades: data.trades,
    selectedColumns, flowData: orderFlow, flowScope, domUnits, tapeMin, showCvd, showQuotes, lines, liquidations: liqPrints, candles: visibleCandles,
    bubbleMode: bubbleMode === 'auto' ? span <= 300000 ? 'trades' : 'steps' : bubbleMode, bubbleInterval,
    formatPrice: p => fmtPrice(p, meta.tick), pointer,
    zones: showReactions ? analysis.zones : [], reactions: showReactions ? analysis.reactions : [],
  }
  const bubbles = useMemo(() => getTradeBubbles(view), [data.trades, start, end, mid, center, range, step, minTrade, bubbleScale, size.w, size.h, showProfile, selectedColumns, showCvd, bubbleMode, bubbleInterval])
  const geometry = heatmapGeometry(view)
  const bounds = { earliest: data.heatCols[0]?.t ?? end, latest: data.observedAt, mid: data.heatCols.at(-1)?.mid ?? mid, maxSpan: Math.max(600000, historyMs) }
  const navigation = { end, span, center, halfRange: mid * range / 100 }
  function navigate(next: MapViewport) {
    if (!replaySource && !frozen) setFrozen(captureFeed())
    setReplayPlaying(false); setSpan(next.span); setViewport(next); setPointer(null)
  }
  const dragging = useHeatmapNavigation(canvasRef, navigation, bounds, geometry, navigate)
  useRaf(() => {
    const el = canvasRef.current, ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const key = `${end}:${size.w}:${size.h}:${span}:${center}:${range}:${contrast}:${minTrade}:${bubbleScale}:${showTrades}:${showProfile}:${showReactions}:${selectedColumns.join()}:${flowScope}:${domUnits}:${tapeMin}:${showCvd}:${showQuotes}:${showPlan}:${showAverages}:${showLiq}:${showGamma}:${showCandles}:${bubbleMode}:${bubbleInterval}:${JSON.stringify(lines)}`
    let scene = sceneRef.current
    if (!scene) { scene = document.createElement('canvas'); sceneRef.current = scene }
    const dpr = size.w ? el.width / size.w : 1
    const changed = lastDraw.current !== key || scene.width !== el.width || scene.height !== el.height
    if (changed) {
      scene.width = el.width; scene.height = el.height
      const cached = scene.getContext('2d')
      if (!cached) return
      cached.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawHeatmap(cached, { ...view, pointer: null, bubbles }); lastDraw.current = key
    }
    const presentation = `${key}:${pointer?.x}:${pointer?.y}:${dragging}`
    if (!changed && lastPresentation.current === presentation) return
    lastPresentation.current = presentation
    // Hover only composites the cached scene; it never rebins the order book.
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(scene, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (!dragging) drawHeatmapCursor(ctx, view)
  }, true, 16)

  const columnUnderPointer = pointer ? columnLayout(size.w, selectedColumns).shown.find(c => pointer.x >= geometry.right + 86 + c.offset && pointer.x <= geometry.right + 86 + c.offset + c.width) : null
  const overColumn = !!columnUnderPointer && columnUnderPointer.id !== 'tape'
  const inside = !dragging && pointer && pointer.x >= geometry.left && (pointer.x <= geometry.right || overColumn) && pointer.y >= geometry.top && pointer.y <= geometry.bottom
  const hoverTime = inside ? overColumn ? end : start + (pointer.x - geometry.left) / (geometry.right - geometry.left) * span : null
  const hoverPrice = inside ? geometry.high - (pointer.y - geometry.top) / (geometry.bottom - geometry.top) * (geometry.high - geometry.low) : null
  const hoverColumn = hoverTime === null ? null : columnAt(data.heatCols, hoverTime)
  const hoverBucket = hoverPrice === null ? 0 : Math.round(hoverPrice / step) * step
  const hoverBid = hoverColumn ? binDepth(hoverColumn.bids, step).get(hoverBucket) ?? 0 : null
  const hoverAsk = hoverColumn ? binDepth(hoverColumn.asks, step).get(hoverBucket) ?? 0 : null
  const hoverBubble = pointer && showTrades && !overColumn ? bubbles
    .map(b => ({ bubble: b, distance: Math.hypot(b.x - pointer.x, b.y - pointer.y) }))
    .filter(b => b.distance <= b.bubble.r + 3).sort((a, b) => a.distance - b.distance)[0]?.bubble : null
  const hoverRow = hoverPrice === null ? null : orderFlow.rows.get(hoverBucket)
  const hoverLine = inside && pointer && !overColumn ? lines.find(l => Math.abs(geometry.y(l.price) - pointer.y) < 5) : null
  const hoverLiq = inside && pointer && !overColumn ? liqPrints.find(l => Math.hypot(geometry.x(l.t) - pointer.x, geometry.y(l.p) - pointer.y) < 12) : null
  const hoverReaction = pointer && !overColumn ? getReactionMarkers(view).find(e => Math.hypot(e.x - pointer.x, e.y - pointer.y) <= 12) : null
  const readyFlow = flow.count > 0
  const context = stale ? 'Waiting for fresh depth'
    : flow.buyShare === null ? 'Waiting for recorded trades'
      : flow.buyShare > 0.55 ? 'Buy aggressors are more active'
        : flow.buyShare < 0.45 ? 'Sell aggressors are more active' : 'Aggressive flow is balanced'

  function reset() {
    setRangeSetting('auto'); setContrast(1); setMinTrade(1000); setBubbleScale(1.35); setShowTrades(true); setShowProfile(true); setShowReactions(true); setSpan(120000); setSelectedColumns(['dom', 'tape']); setShowQuotes(true); setShowPlan(true); setShowCvd(false); setShowAverages(false); setShowLiq(false); setShowGamma(false); setShowCandles(false); setBubbleMode('auto'); setBubbleInterval(0); returnLive()
  }

  function returnLive() { setViewport(null); setReplayPlaying(false); setReplaySource(null); setFrozen(null); setPointer(null) }
  function beginReplay(at?: number) {
    const recording = replaySource ?? frozen ?? captureFeed()
    const min = recording.heatCols[0]?.t
    if (min === undefined) return
    setViewport(null); setReplaySource(recording); setFrozen(null); setReplayPlaying(false); setPointer(null)
    setReplayAt(Math.max(min, Math.min(recording.observedAt, at ?? recording.observedAt - span * 0.75)))
  }
  function stepReplay(direction: number) {
    if (!replaySource) return
    const times = replaySource.heatCols.map(c => c.t)
    const next = direction > 0 ? times.find(t => t > replayAt) ?? replaySource.observedAt : times.filter(t => t < replayAt).pop() ?? times[0]
    setViewport(null); setReplayAt(next); setReplayPlaying(false); setPointer(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#090f18] text-slate-200 [color-scheme:dark]" data-testid="panel-heatmap">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-sky-400/10 text-sky-400"><Activity size={15} /></span>
            <h1 className="text-sm font-semibold tracking-tight text-slate-100">Liquidity map</h1>
            <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{meta.label}</span>
          </div>

        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1.5', replaySource ? 'border-violet-400/25 bg-violet-400/5 text-violet-300' : frozen ? 'border-amber-400/20 bg-amber-400/5 text-amber-300' : stale ? 'border-white/10 text-slate-400' : 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300')} role="status">
            <span className={cn('size-1.5 rounded-full', replaySource ? 'bg-violet-300' : frozen ? 'bg-amber-300' : stale ? 'bg-slate-500' : 'bg-emerald-400')} />
            {replaySource ? <>Replay<span className="hidden sm:inline"> · {clock(end)} UTC</span></> : viewport ? <>Exploring<span className="hidden sm:inline"> history</span></> : frozen ? <>Paused<span className="hidden sm:inline"> · {clock(end)} UTC</span></> : stale ? 'Awaiting fresh depth' : quality.mode === 'partial' ? 'Partial depth' : 'Live depth'}
          </span>
          <span className="hidden text-slate-500 sm:inline">Binance spot</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.07] px-3 py-2">
        <div className="flex rounded-lg border border-white/10 bg-[#0d1623] p-0.5" role="group" aria-label="Time window">
          {WINDOWS.map(w => <button key={w.ms} type="button" aria-pressed={span === w.ms} onClick={() => { setSpan(w.ms); setViewport(null) }} className={cn('min-h-7 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-400', span === w.ms ? 'bg-slate-700/60 text-white shadow-sm' : 'text-slate-400 hover:text-white')}>{w.label}</button>)}
          <button type="button" disabled={!historyMs} title={`Show all ${duration(historyMs)} of retained liquidity history`} onClick={() => { setSpan(Math.max(60000, historyMs)); setViewport(null) }} className="min-h-7 rounded-md px-2 text-[11px] text-sky-300 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-40">Recorded</button>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline">Price range</span>
          <select aria-label="Price range" value={rangeSetting} onChange={e => { setRangeSetting(e.target.value); setViewport(null) }} className={fieldClass}>
            <option value="auto">Auto range</option><option value="0.1">±0.1%</option><option value="0.3">±0.3%</option><option value="0.6">±0.6%</option><option value="1">±1%</option><option value="2">±2%</option>
          </select>
        </label>
        <button type="button" aria-pressed={showTrades} onClick={() => setShowTrades(v => !v)} className={cn(buttonClass, showTrades ? 'border-sky-400/25 bg-sky-400/[0.07] text-sky-300' : 'border-white/10 text-slate-400')}><span className="size-3 rounded-full border border-current bg-emerald-400/30" /> Big bubbles</button>
        <button type="button" aria-pressed={!!frozen || !!replaySource} onClick={() => { if (replaySource || viewport) returnLive(); else { setFrozen(frozen ? null : captureFeed()); setPointer(null) } }} className={cn(buttonClass, frozen || replaySource ? 'border-amber-400/25 text-amber-300' : 'border-white/10 text-slate-300 hover:bg-white/5')}>
          {frozen || replaySource ? <Play size={13} /> : <Pause size={13} />}{replaySource || viewport ? 'Return to live' : frozen ? 'Resume live' : 'Pause'}
        </button>
        {!replaySource && <button type="button" onClick={() => beginReplay()} disabled={data.heatCols.length < 2} className={cn(buttonClass, 'border-violet-400/25 text-violet-300 hover:bg-violet-400/5 disabled:cursor-not-allowed disabled:opacity-40')}><RotateCcw size={12} />Replay history</button>}
        <button type="button" title="Show or hide reaction markers and persistence outlines" aria-pressed={showReactions} onClick={() => setShowReactions(v => !v)} className={cn(buttonClass, showReactions ? 'border-violet-400/25 bg-violet-400/5 text-violet-300' : 'border-white/10 text-slate-400')}>Reactions</button>
        <HeatmapColumnsMenu selected={selectedColumns} onChange={setSelectedColumns} scope={flowScope} onScope={setFlowScope} units={domUnits} onUnits={setDomUnits} tapeMin={tapeMin} onTapeMin={setTapeMin} cvd={showCvd} onCvd={setShowCvd} />
        <button type="button" aria-label="Toggle liquidity insights" aria-pressed={showInsights} onClick={() => setShowInsights(v => !v)} className={cn(buttonClass, 'ml-auto border-white/10 text-slate-400')}><PanelRight size={13} /><span className="hidden sm:inline">Insights</span></button>
        <details className="relative">
          <summary className={cn(buttonClass, 'cursor-pointer list-none border-white/10 text-slate-400 hover:bg-white/5 [&::-webkit-details-marker]:hidden')}><Settings2 size={14} /><span className="hidden sm:inline">Display</span></summary>
          <div className="absolute right-0 top-full z-30 mt-2 w-64 space-y-4 rounded-xl border border-white/10 bg-[#111c2c] p-4 text-xs shadow-2xl">
            <label className="block space-y-2"><span className="flex justify-between text-slate-300">Depth intensity <span className="font-mono text-slate-500">{contrast.toFixed(1)}×</span></span><input aria-label="Depth intensity" type="range" min="0.5" max="1.8" step="0.1" value={contrast} onChange={e => setContrast(Number(e.target.value))} className="w-full accent-sky-400" /></label>
            <label className="block space-y-2"><span className="flex justify-between text-slate-300">Bubble size<span className="font-mono text-slate-500">{bubbleScale.toFixed(2)}×</span></span><input aria-label="Bubble size" type="range" min="0.8" max="1.8" step="0.05" value={bubbleScale} onChange={e => setBubbleScale(Number(e.target.value))} className="w-full accent-emerald-400" /></label>
            <label className="flex items-center justify-between gap-2">Min bubble total<select value={minTrade} onChange={e => setMinTrade(Number(e.target.value))} className={fieldClass}><option value="0">All clusters</option><option value="1000">$1,000</option><option value="10000">$10,000</option><option value="50000">$50,000</option></select></label>
            <label className="flex items-center justify-between gap-2">Bubble mode<select aria-label="Bubble mode" value={bubbleMode} onChange={e => setBubbleMode(e.target.value as typeof bubbleMode)} className={fieldClass}><option value="auto">Auto</option><option value="trades">Price clusters</option><option value="steps">Time steps</option></select></label>
            <label className="flex items-center justify-between gap-2">Step length<select aria-label="Bubble step length" value={bubbleInterval} onChange={e => setBubbleInterval(Number(e.target.value))} className={fieldClass}>{[0, 1000, 5000, 15000, 60000].map(n => <option key={n} value={n}>{n ? `${n / 1000}s` : 'Auto'}</option>)}</select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showProfile} onChange={e => setShowProfile(e.target.checked)} className="accent-sky-400" />Legacy depth profile (when columns hidden)</label>
            <button type="button" onClick={reset} className="flex items-center gap-2 text-sky-300 hover:text-sky-200"><RotateCcw size={12} />Reset view</button>
          </div>
        </details>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.07] px-3 py-2 text-[10px]" data-testid="heatmap-lines-controls">
        <span className="text-slate-500">Lines</span>
        {([{ label: 'Plan', value: showPlan, set: setShowPlan, help: 'Signals buy/sell triggers, or your manually entered entry / stop / target' }, { label: 'Bid / ask', value: showQuotes, set: setShowQuotes, help: 'Actual best bid and ask stepped paths from recorded snapshots' }, { label: 'Averages', value: showAverages, set: setShowAverages, help: 'Recorded buyer / seller execution VWAP in the selected scope' }, { label: 'Γ', value: showGamma, set: setShowGamma, help: 'Computed Deribit gamma walls / flip / max pain; BTC, ETH, SOL only' }, { label: 'Liq', value: showLiq, set: setShowLiq, help: 'Modeled leverage scenarios plus actual reported futures liquidation prints; not known future liquidation positions' }, { label: 'Candles', value: showCandles, set: setShowCandles, help: 'Recorded 1m spot candles; only completed candles in history/replay' }]).map(item => <button key={item.label} type="button" title={item.help} aria-label={`Toggle ${item.label} overlay`} aria-pressed={item.value} onClick={() => item.set(v => !v)} className={cn('rounded border px-2 py-1 focus-visible:ring-2 focus-visible:ring-sky-400', item.value ? 'border-sky-400/25 bg-sky-400/5 text-sky-200' : 'border-white/10 text-slate-500')}>{item.label}</button>)}
        <details className="relative"><summary className="cursor-pointer text-slate-400">Edit plan</summary><div className="absolute right-0 top-full z-40 mt-2 w-56 space-y-2 rounded-lg border border-white/15 bg-[#101927] p-3 shadow-xl"><p className="text-slate-500">Optional manual levels; no orders are placed. Leave blank for Signals triggers.</p>{(['entry', 'stop', 'target'] as const).map(k => <label key={k} className="flex items-center justify-between gap-2 capitalize">{k}<input type="number" min="0" step="any" aria-label={`Plan ${k} price`} value={manualPlan[k]} onChange={e => setManualPlan(p => ({ ...p, [k]: e.target.value }))} className="w-32 rounded border border-white/10 bg-[#0a111c] p-1.5 font-mono" /></label>)}<button type="button" onClick={() => setManualPlan({ entry: '', stop: '', target: '' })} className="text-sky-300">Use Signals triggers</button></div></details>
        <span className="ml-auto font-mono text-slate-500">Sold | bid | price | ask | bought · {domUnits === 'usd' ? 'USDT' : 'coin'}</span>
      </div>
      {(showLiq || showGamma || lines.some(l => l.price < geometry.low || l.price > geometry.high)) && <div className="shrink-0 space-y-1 border-b border-white/[0.07] px-3 py-1.5 text-[10px] text-slate-500" data-testid="heatmap-overlay-status">
        {showLiq && <p><span className="text-pink-300">Liq: {liqLevels.length} modeled levels · {liqPrints.length} reported prints.</span> Scenarios use completed spot candles, assumed leverage and maintenance margin; actual positions are unknown.</p>}
        {showGamma && <p>Γ: {!gammaSupported ? 'Options overlays available for BTC / ETH / SOL only.' : historical ? 'Hidden in historical exploration: no options recording at this playhead.' : gammaError || (!gamma ? 'Loading Deribit options…' : gammaLines(gamma, end).length ? `Deribit snapshot ${clock(gamma.asOf)} UTC · computed positioning convention.` : 'No fresh eligible options snapshot / expiry available.')}</p>}
        {lines.some(l => l.price < geometry.low || l.price > geometry.high) && <p>{lines.filter(l => l.price < geometry.low || l.price > geometry.high).length} levels outside this price range. Widen the range to inspect them.</p>}
      </div>}

      <DataQualityStrip quality={quality} connected={data.status === 'live'} span={span} historical={!!replaySource || !!frozen} tradeMs={tradeMs} tradeCount={flow.count} />
      {replaySource && <ReplayControls min={replaySource.heatCols[0].t} max={replaySource.observedAt} at={replayAt} playing={replayPlaying} speed={replaySpeed}
        onAt={at => { setViewport(null); setReplayAt(at); setReplayPlaying(false); setPointer(null) }}
        onPlay={() => { setViewport(null); if (replayAt >= replaySource.observedAt) setReplayAt(replaySource.heatCols[0].t); setReplayPlaying(v => !v) }}
        onSpeed={setReplaySpeed} onLive={returnLive} onStep={stepReplay} />}

      <div className="grid shrink-0 grid-cols-2 divide-x divide-y divide-white/[0.07] border-b border-white/[0.07] bg-[#0c1420] md:grid-cols-4 md:divide-y-0">
        <Metric label="Mid price" value={mid ? fmtPrice(mid, meta.tick) : '—'} note={replaySource || viewport ? `Recorded snapshot · ${clock(end)} UTC` : data.bookTop ? `Spread ${fmtPrice(Math.max(0, data.bookTop.a - data.bookTop.b), meta.tick)} USDT` : 'Waiting for best bid / ask'} />
        <Metric className={replaySource ? 'hidden md:block' : ''} label="Resting bid share" value={totals.share === null ? '—' : `${(totals.share * 100).toFixed(0)}%`} note={`Within ±${range.toFixed(2)}% · ${fmtCompact(totals.bid + totals.ask, '$')} depth`} color={BID_COLOR} />
        <Metric className={replaySource ? 'hidden md:block' : ''} label="Aggressive buy share" value={flow.buyShare === null ? '—' : `${(flow.buyShare * 100).toFixed(0)}%`} note={readyFlow ? `${flow.count.toLocaleString()} recorded trades` : 'Waiting for trades'} color="#6ee7b7" />
        <Metric label="Executed volume delta" value={readyFlow ? `${flow.delta > 0 ? '+' : ''}${fmtCompact(flow.delta, '$')}` : '—'} note={readyFlow ? `Buy minus sell · observed ${duration(tradeMs)}` : 'Buy minus sell notional'} color={!readyFlow ? undefined : flow.delta >= 0 ? '#6ee7b7' : '#fda4af'} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col min-[1400px]:flex-row">
        <div className="flex min-h-[410px] min-w-0 shrink-0 flex-col min-[1400px]:flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[10px] text-slate-400">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><KeyDot color={BID_COLOR} label="Bid liquidity" /><KeyDot color={ASK_COLOR} label="Ask liquidity" /><span className="flex items-center gap-1.5"><span className="h-px w-4 bg-slate-200" />Mid price</span>{showTrades && <><KeyDot color="#6ee7b7" label="Buy trades" /><KeyDot color="#fda4af" label="Sell trades" /></>}</div>
            <span className="text-slate-500" title="T: touch · C: possible consumption · W: possible withdrawal. Hover any marker for evidence.">{showReactions ? 'A possible absorption · R rejection · + refill · hover markers' : 'Bubble area = executed USDT · nearby fills grouped'}</span>
          </div>
          <div className="relative min-h-[340px] flex-1 overflow-hidden" data-testid="heatmap-chart" data-view-end={end} data-view-span={span} data-view-center={center} data-view-range={range} data-plot-right={geometry.right} data-plot-top={geometry.top} data-plot-bottom={geometry.bottom} data-candles={visibleCandles.length} data-bubbles={bubbles.length} data-columns={columnLayout(size.w, selectedColumns).shown.map(c => c.id).join()} data-visible-lines={lines.filter(l => l.price >= geometry.low && l.price <= geometry.high).map(l => l.id).join()}>
            <canvas ref={canvasRef} aria-label={`${meta.label} liquidity history. Blue bands are resting bids, amber bands are resting asks; the white line is mid price. Use Pause to inspect a fixed snapshot.`} role="img" style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'crosshair' }} tabIndex={0} onDoubleClick={() => { setViewport(null); setRangeSetting('auto'); setSpan(120000); returnLive() }} onKeyDown={e => { if (e.key === '+' || e.key === '=' || e.key === '-') { e.preventDefault(); e.stopPropagation(); navigate(zoomViewport(navigation, bounds, e.key === '-' ? 1.25 : 0.8, 0.5, 0.5)) } else if (e.key === 'Escape' || e.key === '0') { e.preventDefault(); e.stopPropagation(); setSpan(120000); setRangeSetting('auto'); returnLive() } }} className="block h-full w-full outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sky-400/50" onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setPointer({ x: e.clientX - r.left, y: e.clientY - r.top }) }} onPointerLeave={() => setPointer(null)} onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); setPointer({ x: e.clientX - r.left, y: e.clientY - r.top }) }} />
            <div className="absolute bottom-10 left-4 z-10 flex items-center gap-0.5 rounded-md border border-white/10 bg-[#0b121c]/95 p-1 shadow-lg" role="group" aria-label="Chart navigation">
              <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={!mid} onClick={() => navigate(zoomViewport(navigation, bounds, 0.8, 0.5, 0.5))} className="rounded p-1.5 text-slate-300 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400"><Plus size={14} /></button>
              <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={!mid} onClick={() => navigate(zoomViewport(navigation, bounds, 1.25, 0.5, 0.5))} className="rounded p-1.5 text-slate-300 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400"><Minus size={14} /></button>
              <span className="px-1.5 font-mono text-[10px] text-slate-500">{Math.round(span / 1000)}s</span>
              <button type="button" aria-label="Reset chart view" title="Reset chart (double-click / 0)" onClick={() => { setSpan(120000); setRangeSetting('auto'); returnLive() }} className="rounded p-1.5 text-slate-400 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-sky-400"><RotateCcw size={12} /></button>
            </div>
            {!last && <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"><div className="max-w-xs text-center"><Crosshair className="mx-auto mb-3 size-7 text-sky-400/60" /><p className="text-sm font-medium">{historical ? 'No recorded depth at this time' : 'Waiting for order book snapshots'}</p><p className="mt-2 text-xs leading-relaxed text-slate-500">The map shows only observed market depth. A gap in the recording is not reconstructed from the current book.</p>{data.lastError && <p className="mt-2 text-xs text-amber-300">{data.lastError}</p>}</div></div>}
            {last && historyMs < span * 0.7 && !inside && <div className="pointer-events-none absolute left-5 top-10 max-w-[180px] rounded-lg border border-white/[0.06] bg-[#090f18]/80 p-3"><div className="text-[10px] font-medium text-slate-400">Recording liquidity history</div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{duration(historyMs)} observed of {span / 60000}m selected. Earlier depth isn’t available.</p></div>}
            {inside && hoverTime !== null && hoverPrice !== null && <div data-testid="heatmap-inspector" className="pointer-events-none absolute z-20 w-48 rounded-md border border-slate-600/50 bg-[#101b2b]/95 p-3 text-[11px] shadow-2xl" style={{ left: Math.max(8, Math.min(pointer.x + 16, size.w - 200)), top: Math.max(8, Math.min(pointer.y + 16, size.h - (hoverReaction ? 290 : hoverLine || hoverLiq || overColumn ? 250 : hoverBubble ? 230 : 130))) }}>
              <div className="mb-2 flex justify-between gap-3"><span className="font-mono font-semibold text-white">{fmtPrice(hoverBucket, meta.tick)}</span><span className="text-slate-500">{clock(hoverTime)} UTC</span></div>
              {hoverLine && !hoverReaction && !hoverLiq && <div className="mb-2 border-b border-white/10 pb-2"><strong style={{ color: hoverLine.color }}>{hoverLine.label}</strong><p className="mt-1 text-[10px] text-slate-400">{hoverLine.note}</p></div>}
              {hoverLiq && <div className="mb-2 text-pink-300">Reported futures {hoverLiq.position} liquidation · {fmtCompact(hoverLiq.usd, '$')}<p className="text-[10px] text-slate-500">Forced-order event reported by Binance futures, not an estimate or spot trade.</p></div>}
              {overColumn && hoverRow && <div className="mb-2 space-y-1 border-b border-white/10 pb-2"><div className="flex justify-between text-rose-300"><span>Sold</span><span>{fmtCompact(domUnits === 'coin' ? hoverRow.sellQty : hoverRow.sell)}</span></div><div className="flex justify-between text-emerald-300"><span>Bought</span><span>{fmtCompact(domUnits === 'coin' ? hoverRow.buyQty : hoverRow.buy)}</span></div><div className="flex justify-between"><span>Delta USDT</span><span>{fmtCompact(hoverRow.delta, '$')}</span></div><p className="text-[10px] text-slate-500">Scope: {flowScope === 'window' ? 'visible chart window' : 'retained trade buffer'}.</p></div>}
              {hoverReaction && <div className="mb-2 border-b border-white/10 pb-2"><div className="font-semibold" style={{ color: reactionColors[hoverReaction.kind] }}>{reactionLabels[hoverReaction.kind]}</div><div className="mt-1 font-mono text-[10px] text-slate-400">{clock(hoverReaction.t)} · {fmtPrice(hoverReaction.price, meta.tick)}</div><p className="mt-1 text-[10px] leading-relaxed text-slate-400">{hoverReaction.note}</p></div>}
              {hoverBubble && !hoverReaction && !hoverLiq && <div className="mb-3 space-y-1 border-b border-white/10 pb-2"><div className="flex justify-between font-semibold text-white"><span>Executed cluster</span><span>{fmtCompact(hoverBubble.usd, '$')}</span></div><div className="flex justify-between text-emerald-300"><span>Buy aggressors</span><span>{fmtCompact(hoverBubble.buy, '$')}</span></div><div className="flex justify-between text-red-300"><span>Sell aggressors</span><span>{fmtCompact(hoverBubble.sell, '$')}</span></div><div className="text-[10px] text-slate-400">{hoverBubble.count} fills · avg {fmtPrice(hoverBubble.p, meta.tick)}</div></div>}
              {hoverColumn ? <><div className="flex justify-between text-sky-300"><span>Resting bids</span><span className="font-mono">{fmtCompact(hoverBid, '$')}</span></div><div className="mt-1 flex justify-between text-amber-300"><span>Resting asks</span><span className="font-mono">{fmtCompact(hoverAsk, '$')}</span></div><div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-slate-500">Snapshot {clock(hoverColumn.t)} · {fmtPrice(step, meta.tick)} price bin</div></> : <p className="text-slate-400">No recorded snapshot at this time.</p>}
            </div>}
          </div>
          <CompactFlowLadder flow={orderFlow} mid={mid} tick={meta.tick} units={domUnits} expanded={columnLayout(size.w, selectedColumns).hidden.includes('dom')} />
          {columnLayout(size.w, selectedColumns).hidden.some(id => id !== 'dom') && <StackedFlowColumns selected={columnLayout(size.w, selectedColumns).hidden} flow={orderFlow} mid={mid} tick={meta.tick} tapeMin={tapeMin} />}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2 text-[10px] text-slate-500"><span className="flex items-center gap-1.5"><Crosshair size={11} />Scroll to zoom · Pinch to zoom both axes · Drag to pan</span><span title="Shift + scroll: price zoom. Horizontal swipe: pan time. Double-click: reset.">Time: UTC · USDT · {frozen ? 'Frozen snapshot' : last ? `Last depth ${Math.max(0, (end - last.t) / 1000).toFixed(1)}s ago` : 'No depth yet'}</span></div>
        </div>

        {showInsights && <aside className="shrink-0 space-y-5 border-t border-white/[0.07] bg-[#0c1420] p-4 min-[1400px]:w-[230px] min-[1400px]:overflow-y-auto min-[1400px]:border-l min-[1400px]:border-t-0" aria-label="Liquidity analysis">
          {showTrades && <div className="rounded-xl border border-white/[0.07] bg-[#111c2c]/60 p-3"><h2 className="text-xs font-semibold">Trade bubbles</h2><div className="mt-3 flex items-end justify-between gap-1">{[10000, 50000, 100000].map(n => <div key={n} className="flex flex-col items-center gap-2"><span className="inline-block shrink-0 rounded-full border border-emerald-400 bg-emerald-500/50" style={{ width: bubbleRadius(n, bubbleScale) * 2, height: bubbleRadius(n, bubbleScale) * 2 }} /><span className="font-mono text-[10px] text-slate-400">{fmtCompact(n, '$')}</span></div>)}</div><p className="mt-3 text-[10px] leading-relaxed text-slate-500"> </p></div>}
          <div><div className="mb-1 flex items-center justify-between"><h2 className="text-xs font-semibold text-slate-100">Nearby liquidity</h2><Crosshair size={13} className="text-slate-500" /></div><p className="text-[10px] leading-relaxed text-slate-500">Largest visible price bins, ranked by resting size.</p></div>
          <LiquidityList title="Ask liquidity above" color={ASK_COLOR} levels={liquidity.asks} tick={meta.tick} zones={analysis.zones} />
          <div className="flex items-center gap-2 text-[10px] text-slate-500"><span className="h-px flex-1 bg-white/10" />MID<span className="font-mono text-slate-300">{mid ? fmtPrice(mid, meta.tick) : '—'}</span><span className="h-px flex-1 bg-white/10" /></div>
          <LiquidityList title="Bid liquidity below" color={BID_COLOR} levels={liquidity.bids} tick={meta.tick} zones={analysis.zones} />
          <ReactionFeed events={analysis.reactions} tick={meta.tick} onInspect={beginReplay} />
          <div className="rounded-xl border border-white/[0.07] bg-[#111c2c]/60 p-3"><h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-300"><Activity size={12} className="text-sky-400" />Flow context</h2><p className="text-xs font-medium leading-relaxed text-slate-200">{context}</p><p className="mt-2 text-[11px] leading-relaxed text-slate-500">{readyFlow ? `${fmtCompact(flow.buy, '$')} buy-initiated vs ${fmtCompact(flow.sell, '$')} sell-initiated in the recorded trade window.` : 'Executed trades will show which side is crossing the spread.'}</p>{flow.poc !== null && <div className="mt-3 flex justify-between border-t border-white/[0.07] pt-2 text-[10px] text-slate-400"><span title="Price bin with the most executed notional in recorded trades">Most traded price</span><span className="font-mono text-slate-200">{fmtPrice(flow.poc, meta.tick)}</span></div>}</div>
          <details className="group text-[11px]"><summary className="flex cursor-pointer list-none items-center gap-1.5 text-slate-400 outline-none focus-visible:text-sky-300"><CircleHelp size={13} />How to read this map<span className="ml-auto text-slate-600">+</span></summary><div className="mt-3 space-y-2 leading-relaxed text-slate-500"><p>Brighter bands contain more resting orders. Persistent bands show liquidity that stayed available.</p><p>Nearby executions are grouped by time and price. Bubbles appear when their combined volume exceeds {fmtCompact(minTrade, '$')}. Green = buy aggressors, red = sell aggressors. Mixed clusters show both as proportional slices. Hover a bubble for its total, fills and average price.</p><p>Compare the price reaction with executed flow. Resting orders can be cancelled; a large band alone doesn’t establish a breakout or reversal.</p><p>Gold rings highlight the largest displayed execution clusters; they do not identify individual whales. Pink diamonds are reported futures liquidations. Liq lines are explicit leverage scenarios, and Γ uses computed Deribit options levels.</p><p>Depth is sampled to screen resolution. Flow metrics include all recorded trades, regardless of the bubble filter.</p></div></details>
        </aside>}
      </div>
    </div>
  )
}

function Metric({ label, value, note, color, className }: { label: string; value: string; note: string; color?: string; className?: string }) {
  return <div className={cn('min-w-0 px-4 py-2', className)}><div className="mb-1 text-[10px] text-slate-400">{label}</div><div className="truncate font-mono text-base font-medium tracking-tight text-slate-100" style={{ color }}>{value}</div><div className="mt-1 hidden truncate text-[10px] text-slate-500 sm:block" title={note}>{note}</div></div>
}

function KeyDot({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />{label}</span>
}

function LiquidityList({ title, color, levels, tick, zones }: { title: string; color: string; levels: { price: number; usd: number; distance: number }[]; tick: number; zones: readonly LiquidityZone[] }) {
  const max = levels[0]?.usd || 1
  const side = title.startsWith('Ask') ? 'ask' : 'bid'
  return <div><h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium" style={{ color }}>{side === 'ask' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}{title}</h3>{levels.length ? <ol className="space-y-1.5">{levels.map((l, i) => {
    const z = zones.find(z => z.side === side && z.price === l.price)
    const persistence = z ? `Seen ≥${duration(z.lastSeen - z.firstSeen)}${z.replenishments ? ` · ${z.replenishments} refills` : ''}` : 'Collecting persistence'
    return <li key={l.price} title={`${persistence}. Age is a lower bound from recorded snapshots; refills do not identify individual orders.`} className="relative overflow-hidden rounded-md bg-white/[0.02] px-2.5 py-2"><span className="absolute inset-y-0 left-0 opacity-[0.08]" style={{ backgroundColor: color, width: `${l.usd / max * 100}%` }} /><div className="relative flex items-center justify-between gap-2 font-mono text-[11px]"><span><span className="mr-2 text-[9px] text-slate-600">{i + 1}</span>{fmtPrice(l.price, tick)}</span><span style={{ color }}>{fmtCompact(l.usd, '$')}</span></div><div className="relative mt-1 pl-4 text-[9px] text-slate-500">{l.distance.toFixed(3)}% from mid</div><div className="relative mt-1 pl-4 text-[9px] text-slate-400" data-testid="zone-persistence">{persistence}</div></li>
  })}</ol> : <p className="rounded-lg border border-dashed border-white/10 p-3 text-[10px] text-slate-500">No resting levels recorded in this range.</p>}</div>
}
