'use client'

import { useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownLeft, ArrowUpRight, CircleHelp, Crosshair, Pause, Play, RotateCcw, Settings2 } from 'lucide-react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, now } from '@/lib/terminal/stream-client'
import { usePoll, useRaf, useCanvasSize } from '@/lib/terminal/hooks'
import { metaFor } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact } from '@/lib/terminal/format'
import { binDepth, bubbleRadius, columnAt, nearbyLiquidity, summarizeFlow } from '@/lib/terminal/heatmap-model'
import { ASK_COLOR, BID_COLOR, drawHeatmap, getTradeBubbles, heatmapGeometry, type HeatmapView } from '@/lib/terminal/heatmap-renderer'
import { cn } from '@/lib/utils'

const WINDOWS = [{ label: '2m', ms: 120000 }, { label: '5m', ms: 300000 }, { label: '10m', ms: 600000 }]
const fieldClass = 'rounded-lg border border-white/10 bg-[#111c2c] px-2.5 py-2 text-xs text-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
const buttonClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400'
const duration = (ms: number) => ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : `${Math.max(0, Math.floor(ms / 1000))}s`
const clock = (ts: number) => new Date(ts).toISOString().slice(11, 19)

function captureFeed() {
  const s = getStream()
  return { ...s, heatCols: s.heatCols.slice(), trades: s.trades.slice(), observedAt: now() }
}

export default function HeatmapPanel() {
  const symbol = useTerminal(s => s.symbol)
  return <HeatmapWorkspace key={symbol} symbol={symbol} />
}

function HeatmapWorkspace({ symbol }: { symbol: string }) {
  const feed = usePoll(captureFeed, 500)
  const [frozen, setFrozen] = useState<ReturnType<typeof captureFeed> | null>(null)
  const data = frozen ?? feed
  const [span, setSpan] = useState(120000)
  const [rangeSetting, setRangeSetting] = useState('auto')
  const [contrast, setContrast] = useState(1)
  const [minTrade, setMinTrade] = useState(10000)
  const [bubbleScale, setBubbleScale] = useState(1.35)
  const [showTrades, setShowTrades] = useState(true)
  const [showProfile, setShowProfile] = useState(true)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastDraw = useRef('')
  const size = useCanvasSize(canvasRef)
  const last = data.heatCols[data.heatCols.length - 1] ?? null
  const mid = last?.mid ?? data.ticker?.c ?? 0
  const meta = metaFor(symbol, mid)
  const end = data.observedAt
  const start = end - span
  const range = useMemo(() => {
    if (rangeSetting !== 'auto') return Number(rangeSetting)
    if (!last || !mid) return 0.15
    const prices = [...last.bids.slice(0, 80), ...last.asks.slice(0, 80)].map(l => Math.abs(l.p / mid - 1) * 100).sort((a, b) => a - b)
    return Math.max(0.08, Math.min(0.6, (prices[Math.floor(prices.length * 0.9)] ?? 0.12) * 1.3))
  }, [last, mid, rangeSetting])
  const step = meta.bin * Math.max(1, Math.ceil(mid * range / 100 * 2 / 80 / meta.bin))
  const flow = useMemo(() => summarizeFlow(data.trades, start, end, step), [data.trades, start, end, step])
  const liquidity = useMemo(() => nearbyLiquidity(last, step, mid * range / 100), [last, step, mid, range])
  const totals = useMemo(() => {
    const sum = (side: 'bids' | 'asks') => last?.[side].reduce((n, l) => Math.abs(l.p - mid) <= mid * range / 100 ? n + l.p * l.q : n, 0) ?? 0
    const bid = sum('bids'), ask = sum('asks')
    return { bid, ask, share: bid + ask > 0 ? bid / (bid + ask) : null }
  }, [last, mid, range])
  const stale = !last || end - last.t > 5000 || data.status !== 'live'
  const observed = data.heatCols.find(c => c.t >= start)
  const historyMs = observed && last ? Math.min(span, Math.max(0, last.t - observed.t)) : 0
  const tradeMs = flow.first === null ? 0 : Math.min(span, end - flow.first)
  const view: HeatmapView = {
    width: size.w, height: size.h, end, span, mid, range, step, contrast, minTrade, bubbleScale,
    showTrades, showProfile, columns: data.heatCols, trades: data.trades,
    formatPrice: p => fmtPrice(p, meta.tick), pointer,
  }
  const bubbles = useMemo(() => getTradeBubbles(view), [data.trades, start, end, mid, range, step, minTrade, bubbleScale, size.w, size.h, showProfile])
  useRaf(() => {
    const key = `${end}:${size.w}:${size.h}:${span}:${range}:${contrast}:${minTrade}:${bubbleScale}:${showTrades}:${showProfile}:${pointer?.x}:${pointer?.y}`
    if (lastDraw.current === key) return
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) { drawHeatmap(ctx, { ...view, bubbles }); lastDraw.current = key }
  }, true, 100)

  const geometry = heatmapGeometry(view)
  const inside = pointer && pointer.x >= geometry.left && pointer.x <= geometry.right && pointer.y >= geometry.top && pointer.y <= geometry.bottom
  const hoverTime = inside ? start + (pointer.x - geometry.left) / (geometry.right - geometry.left) * span : null
  const hoverPrice = inside ? geometry.high - (pointer.y - geometry.top) / (geometry.bottom - geometry.top) * (geometry.high - geometry.low) : null
  const hoverColumn = hoverTime === null ? null : columnAt(data.heatCols, hoverTime)
  const hoverBucket = hoverPrice === null ? 0 : Math.round(hoverPrice / step) * step
  const hoverBid = hoverColumn ? binDepth(hoverColumn.bids, step).get(hoverBucket) ?? 0 : null
  const hoverAsk = hoverColumn ? binDepth(hoverColumn.asks, step).get(hoverBucket) ?? 0 : null
  const hoverBubble = pointer && showTrades ? bubbles
    .map(b => ({ bubble: b, distance: Math.hypot(b.x - pointer.x, b.y - pointer.y) }))
    .filter(b => b.distance <= b.bubble.r + 3).sort((a, b) => a.distance - b.distance)[0]?.bubble : null
  const readyFlow = flow.count > 0
  const context = stale ? 'Waiting for fresh depth'
    : flow.buyShare === null ? 'Waiting for recorded trades'
      : flow.buyShare > 0.55 ? 'Buy aggressors are more active'
        : flow.buyShare < 0.45 ? 'Sell aggressors are more active' : 'Aggressive flow is balanced'

  function reset() {
    setRangeSetting('auto'); setContrast(1); setMinTrade(10000); setBubbleScale(1.35); setShowTrades(true); setShowProfile(true); setSpan(120000); setFrozen(null); setPointer(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#090f18] text-slate-200 [color-scheme:dark]" data-testid="panel-heatmap">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-4">
        <div>
          <div className="mb-1 flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-sky-400/10 text-sky-400"><Activity size={15} /></span>
            <h1 className="text-base font-semibold tracking-tight text-slate-100">Liquidity map</h1>
            <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{meta.label}</span>
          </div>
          <p className="text-xs text-slate-400">Where orders sit. Where trades happen. How price responds.</p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1.5', frozen ? 'border-amber-400/20 bg-amber-400/5 text-amber-300' : stale ? 'border-white/10 text-slate-400' : 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300')} role="status">
            <span className={cn('size-1.5 rounded-full', frozen ? 'bg-amber-300' : stale ? 'bg-slate-500' : 'bg-emerald-400')} />
            {frozen ? `Paused · ${clock(end)} UTC` : stale ? 'Awaiting fresh depth' : 'Live depth'}
          </span>
          <span className="hidden text-slate-500 sm:inline">Binance spot</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.07] px-4 py-2.5">
        <div className="flex rounded-lg border border-white/10 bg-[#0d1623] p-0.5" role="group" aria-label="Time window">
          {WINDOWS.map(w => <button key={w.ms} type="button" aria-pressed={span === w.ms} onClick={() => setSpan(w.ms)} className={cn('min-h-8 rounded-md px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-sky-400', span === w.ms ? 'bg-slate-700/60 text-white shadow-sm' : 'text-slate-400 hover:text-white')}>{w.label}</button>)}
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <span className="hidden sm:inline">Price range</span>
          <select aria-label="Price range" value={rangeSetting} onChange={e => setRangeSetting(e.target.value)} className={fieldClass}>
            <option value="auto">Auto range</option><option value="0.1">±0.1%</option><option value="0.3">±0.3%</option><option value="0.6">±0.6%</option>
          </select>
        </label>
        <button type="button" aria-pressed={showTrades} onClick={() => setShowTrades(v => !v)} className={cn(buttonClass, showTrades ? 'border-sky-400/25 bg-sky-400/[0.07] text-sky-300' : 'border-white/10 text-slate-400')}><span className="size-3 rounded-full border border-current bg-emerald-400/30" /> Big bubbles</button>
        <button type="button" aria-pressed={!!frozen} onClick={() => { setFrozen(frozen ? null : captureFeed()); setPointer(null) }} className={cn(buttonClass, frozen ? 'border-amber-400/25 text-amber-300' : 'border-white/10 text-slate-300 hover:bg-white/5')}>
          {frozen ? <Play size={13} /> : <Pause size={13} />}{frozen ? 'Resume live' : 'Pause'}
        </button>
        <details className="relative ml-auto">
          <summary className={cn(buttonClass, 'cursor-pointer list-none border-white/10 text-slate-400 hover:bg-white/5 [&::-webkit-details-marker]:hidden')}><Settings2 size={14} /><span className="hidden sm:inline">Display</span></summary>
          <div className="absolute right-0 top-full z-30 mt-2 w-64 space-y-4 rounded-xl border border-white/10 bg-[#111c2c] p-4 text-xs shadow-2xl">
            <label className="block space-y-2"><span className="flex justify-between text-slate-300">Depth intensity <span className="font-mono text-slate-500">{contrast.toFixed(1)}×</span></span><input aria-label="Depth intensity" type="range" min="0.5" max="1.8" step="0.1" value={contrast} onChange={e => setContrast(Number(e.target.value))} className="w-full accent-sky-400" /></label>
            <label className="block space-y-2"><span className="flex justify-between text-slate-300">Bubble size<span className="font-mono text-slate-500">{bubbleScale.toFixed(2)}×</span></span><input aria-label="Bubble size" type="range" min="0.8" max="1.8" step="0.05" value={bubbleScale} onChange={e => setBubbleScale(Number(e.target.value))} className="w-full accent-emerald-400" /></label>
            <label className="flex items-center justify-between gap-2">Min bubble total<select value={minTrade} onChange={e => setMinTrade(Number(e.target.value))} className={fieldClass}><option value="1000">$1,000</option><option value="10000">$10,000</option><option value="50000">$50,000</option></select></label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showProfile} onChange={e => setShowProfile(e.target.checked)} className="accent-sky-400" />Current depth profile</label>
            <button type="button" onClick={reset} className="flex items-center gap-2 text-sky-300 hover:text-sky-200"><RotateCcw size={12} />Reset view</button>
          </div>
        </details>
      </div>

      <div className="grid shrink-0 grid-cols-2 divide-x divide-y divide-white/[0.07] border-b border-white/[0.07] bg-[#0c1420] md:grid-cols-4 md:divide-y-0">
        <Metric label="Mid price" value={mid ? fmtPrice(mid, meta.tick) : '—'} note={data.bookTop ? `Spread ${fmtPrice(Math.max(0, data.bookTop.a - data.bookTop.b), meta.tick)} USDT` : 'Waiting for best bid / ask'} />
        <Metric label="Resting bid share" value={totals.share === null ? '—' : `${(totals.share * 100).toFixed(0)}%`} note={`Within ±${range.toFixed(2)}% · ${fmtCompact(totals.bid + totals.ask, '$')} depth`} color={BID_COLOR} />
        <Metric label="Aggressive buy share" value={flow.buyShare === null ? '—' : `${(flow.buyShare * 100).toFixed(0)}%`} note={readyFlow ? `${flow.count.toLocaleString()} recorded trades` : 'Waiting for trades'} color="#6ee7b7" />
        <Metric label="Executed volume delta" value={readyFlow ? `${flow.delta > 0 ? '+' : ''}${fmtCompact(flow.delta, '$')}` : '—'} note={readyFlow ? `Buy minus sell · observed ${duration(tradeMs)}` : 'Buy minus sell notional'} color={!readyFlow ? undefined : flow.delta >= 0 ? '#6ee7b7' : '#fda4af'} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col min-[1400px]:flex-row">
        <div className="flex min-h-[350px] min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[10px] text-slate-400">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><KeyDot color={BID_COLOR} label="Bid liquidity" /><KeyDot color={ASK_COLOR} label="Ask liquidity" /><span className="flex items-center gap-1.5"><span className="h-px w-4 bg-slate-200" />Mid price</span>{showTrades && <><KeyDot color="#6ee7b7" label="Buy trades" /><KeyDot color="#fda4af" label="Sell trades" /></>}</div>
            <span className="text-slate-500">Bubble area = executed USDT · nearby fills grouped</span>
          </div>
          <div className="relative min-h-[280px] flex-1" data-testid="heatmap-chart">
            <canvas ref={canvasRef} aria-label={`${meta.label} liquidity history. Blue bands are resting bids, amber bands are resting asks; the white line is mid price. Use Pause to inspect a fixed snapshot.`} role="img" className="block h-full w-full" onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setPointer({ x: e.clientX - r.left, y: e.clientY - r.top }) }} onPointerLeave={() => setPointer(null)} onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); setPointer({ x: e.clientX - r.left, y: e.clientY - r.top }) }} />
            {!last && <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"><div className="max-w-xs text-center"><Crosshair className="mx-auto mb-3 size-7 text-sky-400/60" /><p className="text-sm font-medium">Waiting for order book snapshots</p><p className="mt-2 text-xs leading-relaxed text-slate-500">The map starts recording when market depth arrives. Historical liquidity is shown only where it was observed.</p>{data.lastError && <p className="mt-2 text-xs text-amber-300">{data.lastError}</p>}</div></div>}
            {last && historyMs < span * 0.7 && !inside && <div className="pointer-events-none absolute left-5 top-10 max-w-[180px] rounded-lg border border-white/[0.06] bg-[#090f18]/80 p-3"><div className="text-[10px] font-medium text-slate-400">Recording liquidity history</div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{duration(historyMs)} observed of {span / 60000}m selected. Earlier depth isn’t available.</p></div>}
            {inside && hoverTime !== null && hoverPrice !== null && <div data-testid="heatmap-inspector" className="pointer-events-none absolute z-20 w-52 rounded-xl border border-slate-600/50 bg-[#101b2b]/95 p-3 text-[11px] shadow-2xl" style={{ left: Math.max(8, Math.min(pointer.x + 16, size.w - 216)), top: Math.max(8, Math.min(pointer.y + 16, size.h - (hoverBubble ? 230 : 130))) }}>
              <div className="mb-2 flex justify-between gap-3"><span className="font-mono font-semibold text-white">{fmtPrice(hoverBucket, meta.tick)}</span><span className="text-slate-500">{clock(hoverTime)} UTC</span></div>
              {hoverBubble && <div className="mb-3 space-y-1 border-b border-white/10 pb-2"><div className="flex justify-between font-semibold text-white"><span>Executed cluster</span><span>{fmtCompact(hoverBubble.usd, '$')}</span></div><div className="flex justify-between text-emerald-300"><span>Buy aggressors</span><span>{fmtCompact(hoverBubble.buy, '$')}</span></div><div className="flex justify-between text-red-300"><span>Sell aggressors</span><span>{fmtCompact(hoverBubble.sell, '$')}</span></div><div className="text-[10px] text-slate-400">{hoverBubble.count} fills · avg {fmtPrice(hoverBubble.p, meta.tick)}</div></div>}
              {hoverColumn ? <><div className="flex justify-between text-sky-300"><span>Resting bids</span><span className="font-mono">{fmtCompact(hoverBid, '$')}</span></div><div className="mt-1 flex justify-between text-amber-300"><span>Resting asks</span><span className="font-mono">{fmtCompact(hoverAsk, '$')}</span></div><div className="mt-2 border-t border-white/10 pt-2 text-[10px] text-slate-500">Snapshot {clock(hoverColumn.t)} · {fmtPrice(step, meta.tick)} price bin</div></> : <p className="text-slate-400">No recorded snapshot at this time.</p>}
            </div>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2 text-[10px] text-slate-500"><span className="flex items-center gap-1.5"><Crosshair size={11} />Hover or tap to inspect · Pause holds the full view</span><span>Time: UTC · Depth: USDT notional · {frozen ? 'Frozen snapshot' : last ? `Last depth ${Math.max(0, (end - last.t) / 1000).toFixed(1)}s ago` : 'No depth yet'}</span></div>
        </div>

        <aside className="shrink-0 space-y-5 border-t border-white/[0.07] bg-[#0c1420] p-4 min-[1400px]:w-[250px] min-[1400px]:overflow-y-auto min-[1400px]:border-l min-[1400px]:border-t-0" aria-label="Liquidity analysis">
          {showTrades && <div className="rounded-xl border border-white/[0.07] bg-[#111c2c]/60 p-3"><h2 className="text-xs font-semibold">Trade bubbles</h2><div className="mt-3 flex items-end justify-between gap-1">{[10000, 50000, 100000].map(n => <div key={n} className="flex flex-col items-center gap-2"><span className="inline-block shrink-0 rounded-full border border-emerald-400 bg-emerald-500/50" style={{ width: bubbleRadius(n, bubbleScale) * 2, height: bubbleRadius(n, bubbleScale) * 2 }} /><span className="font-mono text-[10px] text-slate-400">{fmtCompact(n, '$')}</span></div>)}</div><p className="mt-3 text-[10px] leading-relaxed text-slate-500"> </p></div>}
          <div><div className="mb-1 flex items-center justify-between"><h2 className="text-xs font-semibold text-slate-100">Nearby liquidity</h2><Crosshair size={13} className="text-slate-500" /></div><p className="text-[10px] leading-relaxed text-slate-500">Largest visible price bins, ranked by resting size.</p></div>
          <LiquidityList title="Ask liquidity above" color={ASK_COLOR} levels={liquidity.asks} tick={meta.tick} />
          <div className="flex items-center gap-2 text-[10px] text-slate-500"><span className="h-px flex-1 bg-white/10" />MID<span className="font-mono text-slate-300">{mid ? fmtPrice(mid, meta.tick) : '—'}</span><span className="h-px flex-1 bg-white/10" /></div>
          <LiquidityList title="Bid liquidity below" color={BID_COLOR} levels={liquidity.bids} tick={meta.tick} />
          <div className="rounded-xl border border-white/[0.07] bg-[#111c2c]/60 p-3"><h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-slate-300"><Activity size={12} className="text-sky-400" />Flow context</h2><p className="text-xs font-medium leading-relaxed text-slate-200">{context}</p><p className="mt-2 text-[11px] leading-relaxed text-slate-500">{readyFlow ? `${fmtCompact(flow.buy, '$')} buy-initiated vs ${fmtCompact(flow.sell, '$')} sell-initiated in the recorded trade window.` : 'Executed trades will show which side is crossing the spread.'}</p>{flow.poc !== null && <div className="mt-3 flex justify-between border-t border-white/[0.07] pt-2 text-[10px] text-slate-400"><span title="Price bin with the most executed notional in recorded trades">Most traded price</span><span className="font-mono text-slate-200">{fmtPrice(flow.poc, meta.tick)}</span></div>}</div>
          <details className="group text-[11px]"><summary className="flex cursor-pointer list-none items-center gap-1.5 text-slate-400 outline-none focus-visible:text-sky-300"><CircleHelp size={13} />How to read this map<span className="ml-auto text-slate-600">+</span></summary><div className="mt-3 space-y-2 leading-relaxed text-slate-500"><p>Brighter bands contain more resting orders. Persistent bands show liquidity that stayed available.</p><p>Nearby executions are grouped by time and price. Bubbles appear when their combined volume exceeds {fmtCompact(minTrade, '$')}. Green = buy aggressors, red = sell aggressors. Mixed clusters show both as proportional slices. Hover a bubble for its total, fills and average price.</p><p>Compare the price reaction with executed flow. Resting orders can be cancelled; a large band alone doesn’t establish a breakout or reversal.</p><p>Depth is sampled to screen resolution. Flow metrics include all recorded trades, regardless of the bubble filter.</p></div></details>
        </aside>
      </div>
    </div>
  )
}

function Metric({ label, value, note, color }: { label: string; value: string; note: string; color?: string }) {
  return <div className="min-w-0 px-4 py-3"><div className="mb-1.5 text-[10px] text-slate-400">{label}</div><div className="truncate font-mono text-lg font-medium tracking-tight text-slate-100" style={{ color }}>{value}</div><div className="mt-1 truncate text-[10px] text-slate-500" title={note}>{note}</div></div>
}

function KeyDot({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />{label}</span>
}

function LiquidityList({ title, color, levels, tick }: { title: string; color: string; levels: { price: number; usd: number; distance: number }[]; tick: number }) {
  const max = levels[0]?.usd || 1
  return <div><h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium" style={{ color }}>{title.startsWith('Ask') ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}{title}</h3>{levels.length ? <ol className="space-y-1.5">{levels.map((l, i) => <li key={l.price} className="relative overflow-hidden rounded-md bg-white/[0.02] px-2.5 py-2"><span className="absolute inset-y-0 left-0 opacity-[0.08]" style={{ backgroundColor: color, width: `${l.usd / max * 100}%` }} /><div className="relative flex items-center justify-between gap-2 font-mono text-[11px]"><span><span className="mr-2 text-[9px] text-slate-600">{i + 1}</span>{fmtPrice(l.price, tick)}</span><span style={{ color }}>{fmtCompact(l.usd, '$')}</span></div><div className="relative mt-1 pl-4 text-[9px] text-slate-500">{l.distance.toFixed(3)}% from mid</div></li>)}</ol> : <p className="rounded-lg border border-dashed border-white/10 p-3 text-[10px] text-slate-500">No resting levels recorded in this range.</p>}</div>
}
