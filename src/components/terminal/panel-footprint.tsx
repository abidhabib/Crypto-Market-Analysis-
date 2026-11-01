'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp, Pause, Play, Settings2 } from 'lucide-react'
import { useTerminal } from '@/lib/terminal/store'
import { metaFor } from '@/lib/terminal/constants'
import { fmtCompact, fmtPrice } from '@/lib/terminal/format'
import { buildFootprint, footprintReading, type FootprintBar, type FootprintRow } from '@/lib/terminal/footprint-model'
import { useFootprintData } from '@/lib/terminal/use-footprint-data'
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
  const [offset, setOffset] = useState(0)
  const [selectedTime, setSelectedTime] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const all = useMemo(() => buildFootprint(feed.trades, { interval, tick: meta.tick, rowTicks, ratio, minQty, end: feed.asOf }), [feed.trades, feed.asOf, interval, meta.tick, rowTicks, ratio, minQty])
  const endIndex = Math.max(0, all.length - offset)
  const bars = all.slice(Math.max(0, endIndex - 6), endIndex)
  const lastVisibleTime = bars.at(-1)?.t
  useEffect(() => {
    const el = scrollRef.current
    if (offset || !el) return
    const follow = () => { el.scrollLeft = el.scrollWidth }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [lastVisibleTime, offset])
  const selected = bars.find(b => b.t === selectedTime) ?? [...bars].reverse().find(b => !b.forming) ?? bars.at(-1)
  const reading = footprintReading(selected)
  const step = rowTicks * meta.tick
  const indexes = bars.flatMap(b => [...b.rows.keys()])
  const low = indexes.length ? Math.min(...indexes) : 0, high = indexes.length ? Math.max(...indexes) : 0
  const rowCount = indexes.length ? high - low + 1 : 0
  const rows = rowCount <= 160 ? Array.from({ length: rowCount }, (_, i) => high - i) : []
  const totals = bars.reduce((v, b) => ({ buy: v.buy + b.buy, sell: v.sell + b.sell, usd: v.usd + b.buyUsd + b.sellUsd, count: v.count + b.count }), { buy: 0, sell: 0, usd: 0, count: 0 })
  const live = !frozen && feed.status === 'live' && feed.receivedAt > 0 && feed.clientNow - feed.receivedAt < 15000
  const next = selected && all.find(b => b.t === selected.end)
  const previous = selected && all.find(b => b.end === selected.t)
  const followThrough = selected?.complete && next?.complete ? next.c > selected.h ? 'Next candle closed above this high' : next.c < selected.l ? 'Next candle closed below this low' : 'Next candle closed inside this range' : 'Next closed candle not available'
  const tone = reading.tone === 'buy' ? 'text-emerald-400' : reading.tone === 'sell' ? 'text-rose-400' : reading.tone === 'caution' ? 'text-amber-300' : 'text-neutral-300'
  const amount = (row: FootprintRow | undefined, side: 'buy' | 'sell') => row ? volume(units === 'usd' ? row[side === 'buy' ? 'buyUsd' : 'sellUsd'] : row[side]) : '·'
  const changeView = (delta: number) => {
    if (delta > 0 && !frozen) setFrozen({ ...data, trades: data.trades.slice() })
    setOffset(Math.max(0, Math.min(Math.max(0, all.length - 1), offset + delta))); setSelectedTime(null)
  }

  return <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-[#0c0c0c] text-neutral-200" data-testid="panel-footprint">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
      <div><h1 className="text-sm font-semibold">Footprint <span className="ml-2 text-[10px] font-normal text-neutral-500">{meta.label} · spot</span></h1><p className="mt-1 text-[10px] text-neutral-500"><span className="text-rose-400">Sell at bid</span> × <span className="text-emerald-400">Buy at ask</span> · executed volume</p></div>
      <span role="status" className={cn('rounded border px-2 py-1 text-[10px]', live ? 'border-emerald-500/20 text-emerald-400' : 'border-amber-400/20 text-amber-300')}>{frozen ? offset ? 'Historical snapshot' : 'Paused snapshot' : live ? 'Live executions' : 'Waiting for fresh trades'}</span>
    </div>
    <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[0.08] px-3 py-2">
      <div role="group" aria-label="Footprint interval" className="flex gap-0.5 rounded border border-white/10 bg-[#171717] p-0.5">{[[15000, '15s'], [60000, '1m'], [300000, '5m'], [900000, '15m']].map(([ms, label]) => <button type="button" key={ms} aria-pressed={interval === ms} onClick={() => { setIntervalMs(Number(ms)); setOffset(0); setSelectedTime(null) }} className={cn('min-h-8 rounded px-2 text-[11px]', interval === ms ? 'bg-white/10 text-white' : 'text-neutral-500')}>{label}</button>)}</div>
      <label className="flex items-center gap-1 text-[10px] text-neutral-500">Row<select aria-label="Footprint row size" value={rowTicks} onChange={e => setRowTicks(Number(e.target.value))} className={control}>{[...new Set([rowTicks, ...[0.5, 1, 2, 5, 10, 25, 100].map(m => Math.max(1, Math.round(baseTicks * m)))])].sort((a, b) => a - b).map(t => <option key={t} value={t}>{fmtPrice(t * meta.tick, meta.tick)}</option>)}</select></label>
      <button type="button" aria-label={frozen ? 'Resume footprint' : 'Pause footprint'} onClick={() => { if (frozen) { setFrozen(null); setOffset(0); setSelectedTime(null) } else setFrozen({ ...data, trades: data.trades.slice() }) }} className={control}>{frozen ? <Play size={12} /> : <Pause size={12} />}</button>
      <details className="relative max-sm:static"><summary className={cn(control, 'cursor-pointer list-none')}><Settings2 size={12} />Settings</summary><div className="absolute right-3 top-full z-30 mt-1 w-[min(300px,calc(100vw-24px))] space-y-3 rounded border border-white/15 bg-[#181818] p-3 text-[11px] shadow-xl">
        <label className="flex items-center justify-between">Display units<select aria-label="Footprint units" value={units} onChange={e => setUnits(e.target.value as typeof units)} className={control}><option value="coin">{symbol.replace(/USDT$/, '')}</option><option value="usd">USDT</option></select></label>
        <label className="flex items-center justify-between">Diagonal ratio<select aria-label="Footprint imbalance ratio" value={ratio} onChange={e => setRatio(Number(e.target.value))} className={control}>{[2, 3, 4, 5].map(r => <option key={r}>{r}</option>)}</select></label>
        <label className="flex items-center justify-between gap-2">Min dominant coin volume<input aria-label="Minimum imbalance quantity" type="number" min="0" step="any" value={minQty} onChange={e => setMinQty(Math.max(0, Number(e.target.value) || 0))} className={cn(control, 'w-24')} /></label>
        <p className="text-neutral-500">Imbalances and POC always use coin volume. Zero/missing diagonal opponents are excluded. Three adjacent imbalances form a stack.</p>
      </div></details>
      <details className="relative max-sm:static"><summary aria-label="Footprint methodology" className={cn(control, 'cursor-pointer list-none')}><CircleHelp size={13} /></summary><div className="absolute right-3 top-full z-30 mt-1 w-[min(340px,calc(100vw-24px))] space-y-2 rounded border border-white/15 bg-[#181818] p-3 text-[11px] leading-relaxed text-neutral-400 shadow-xl"><p>Numbers are actual Binance aggregate executions, not outstanding orders or trader identities. An aggregate ID can contain multiple fills.</p><p>Left = sell aggressors; right = buy aggressors. Buy imbalance compares with sells one price bin lower; sell imbalance with buys one bin higher. Gold = largest coin-volume row (POC).</p><p>Read filter: closed, fully bracketed recording, no ID gaps, at least 20 aggregate IDs. Initiative also requires ±15% delta, a three-level stack and price movement in the same direction. These are explicit heuristics, not backtested probabilities.</p><p>First/last partial bars and gaps suppress directional readings. Missing data is never reconstructed from candles. Visible-bar CVD is not session CVD.</p><a href="https://www.sierrachart.com/index.php?page=doc/NumbersBars.php#DiagonalComparisonOfBidVolumeAndAskVolume" target="_blank" rel="noreferrer" className="text-amber-300 underline">Diagonal comparison reference</a></div></details>
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
      <div className="flex items-center gap-1"><button type="button" aria-label="Earlier footprint candles" disabled={endIndex <= 1} onClick={() => changeView(3)} className={control}><ChevronLeft size={12} /></button><button type="button" aria-label="Later footprint candles" disabled={!offset} onClick={() => changeView(-3)} className={control}><ChevronRight size={12} /></button>{offset > 0 && <button type="button" onClick={() => { setOffset(0); setFrozen(null); setSelectedTime(null) }} className={control}>Latest</button>}</div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <div ref={scrollRef} className="min-h-[320px] flex-1 overflow-auto border-b border-white/10 xl:border-b-0" data-testid="footprint-grid">
        {!bars.length ? <p className="p-8 text-center text-xs text-neutral-500">Waiting for recorded trade-by-price executions…</p> : rowCount > 160 ? <div className="p-8 text-center text-xs text-neutral-400"><p>{rowCount.toLocaleString()} price rows. Increase Row size for a readable footprint.</p><button type="button" onClick={() => setRowTicks(Math.max(1, Math.ceil((high - low + 1) * rowTicks / 60)))} className={cn(control, 'mt-3')}>Fit about 60 rows</button></div> : <div className="grid w-max min-w-full font-mono text-[10px] tabular-nums" style={{ gridTemplateColumns: `76px repeat(${bars.length}, minmax(130px, 1fr))` }} role="table" aria-label="Footprint sell by buy volume at price">
          <div className="sticky left-0 top-0 z-30 border-b border-r border-white/10 bg-[#171717] p-2 text-neutral-500">Price bin</div>
          {bars.map(bar => <button type="button" key={bar.t} onClick={() => setSelectedTime(bar.t)} aria-pressed={selected?.t === bar.t} className={cn('sticky top-0 z-20 border-b border-r border-white/10 bg-[#171717] p-2 text-center', selected?.t === bar.t && 'border-b-amber-400')}><span className={bar.c >= bar.o ? 'text-emerald-400' : 'text-rose-400'}>{utc(bar.t)} UTC</span><span className={cn('mt-1 block text-[9px]', bar.gaps || bar.partial ? 'text-amber-300' : 'text-neutral-500')}>{bar.forming ? 'Forming' : bar.gaps ? 'ID gaps' : bar.partial ? 'Partial' : 'Closed'}</span></button>)}
          {rows.map(index => <PriceRow key={index} index={index} step={step} tick={meta.tick} bars={bars} selected={selected?.t} amount={amount} />)}
          <div className="sticky bottom-0 left-0 z-30 border-t border-r border-white/10 bg-[#171717] p-2 text-neutral-500">Delta<br />coin</div>
          {bars.map(bar => <div key={bar.t} className={cn('sticky bottom-0 z-10 border-r border-t border-white/10 bg-[#171717] p-2 text-center', bar.delta >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{signed(bar.delta)}<span className="mt-1 block text-[9px] text-neutral-500">{bar.deltaPct.toFixed(1)}%</span></div>)}
        </div>}
      </div>
      <aside className="shrink-0 space-y-3 bg-[#111111] p-3 text-[11px] xl:w-[258px] xl:overflow-y-auto xl:border-l xl:border-white/10" aria-label="Selected footprint candle analysis">
        <div className="flex items-center justify-between text-[10px] text-neutral-500"><span>Selected candle</span><span>{selected ? `${utc(selected.t)} UTC` : '—'}</span></div>
        <h2 className={cn('font-medium', tone)}>{reading.title}</h2><p className="leading-relaxed text-neutral-500">{reading.note}</p>
        {selected && <><div className="grid grid-cols-2 gap-3 border-y border-white/[0.07] py-3"><Metric label="POC · coin volume" value={fmtPrice(selected.poc, meta.tick)} /><Metric label="Delta · coin" value={signed(selected.delta)} /><Metric label="Buy stack" value={`${selected.buyStack} levels`} /><Metric label="Sell stack" value={`${selected.sellStack} levels`} /></div>
          <div className="space-y-2 text-[10px]"><ReadRow label="High / low" value={`${fmtPrice(selected.h, meta.tick)} / ${fmtPrice(selected.l, meta.tick)}`} /><ReadRow label="Buy / sell coin" value={`${fmtCompact(selected.buy)} / ${fmtCompact(selected.sell)}`} /><ReadRow label="POC migration" value={selected.complete && previous?.complete ? selected.poc > previous.poc ? 'Higher than previous' : selected.poc < previous.poc ? 'Lower than previous' : 'Unchanged' : 'Incomplete comparison'} /><ReadRow label="Observed follow-through" value={followThrough} /></div></>}
        <p className="border-t border-white/[0.07] pt-2 text-[10px] text-neutral-500">Observed order flow · no calibrated probability or trade recommendation.</p>
      </aside>
    </div>
  </div>
}

function PriceRow({ index, step, tick, bars, selected, amount }: { index: number; step: number; tick: number; bars: FootprintBar[]; selected?: number; amount: (r: FootprintRow | undefined, side: 'buy' | 'sell') => string }) {
  const price = Number((index * step).toPrecision(14))
  return <>
    <div role="rowheader" title={`${fmtPrice(price, tick)} to below ${fmtPrice(price + step, tick)}`} className="sticky left-0 z-10 flex h-7 items-center justify-end border-b border-r border-white/[0.05] bg-[#111111] px-2 text-neutral-500">{fmtPrice(price, tick)}</div>
    {bars.map(bar => {
      const row = bar.rows.get(index), poc = row && row.price === bar.poc
      return <div key={bar.t} role="cell" title={row ? `Sell ${row.sell} coin / ${row.sellUsd} USDT; buy ${row.buy} coin / ${row.buyUsd} USDT${poc ? '; coin-volume POC' : ''}` : 'No recorded executions in this bin'} className={cn('grid h-7 grid-cols-2 border-b border-r border-white/[0.04] text-center', selected === bar.t && 'bg-white/[0.025]', poc && 'outline outline-1 -outline-offset-1 outline-amber-400/50')}>
        <span className={cn('flex items-center justify-center text-rose-400/80', row?.sellImbalance && 'bg-rose-500/20 font-semibold text-rose-300')}>{amount(row, 'sell')}{row?.sellImbalance && <span className="ml-1 text-[8px]">▼</span>}</span>
        <span className={cn('flex items-center justify-center text-emerald-400/80', row?.buyImbalance && 'bg-emerald-500/20 font-semibold text-emerald-300')}>{amount(row, 'buy')}{row?.buyImbalance && <span className="ml-1 text-[8px]">▲</span>}</span>
      </div>
    })}
  </>
}
function Metric({ label, value, tone = 'text-neutral-200' }: { label: string; value: string; tone?: string }) { return <div className="min-w-0 px-2 py-2"><div className="text-[9px] text-neutral-500">{label}</div><div className={cn('mt-1 break-words font-mono text-xs tabular-nums', tone)}>{value}</div></div> }
function ReadRow({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><span className="text-neutral-500">{label}</span><span className="max-w-[60%] text-right text-neutral-300">{value}</span></div> }
