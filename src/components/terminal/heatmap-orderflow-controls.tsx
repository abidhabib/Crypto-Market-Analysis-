'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Columns3 } from 'lucide-react'
import { columnInfo, columnPresets, type FlowRow, type HeatmapColumn, type OrderFlow } from '@/lib/terminal/heatmap-orderflow'
import { fmtCompact, fmtPrice } from '@/lib/terminal/format'
import { cn } from '@/lib/utils'

export function HeatmapColumnsMenu({ selected, onChange, scope, onScope, units, onUnits, tapeMin, onTapeMin, cvd, onCvd }: {
  selected: HeatmapColumn[]; onChange: (c: HeatmapColumn[]) => void
  scope: 'window' | 'recorded'; onScope: (s: 'window' | 'recorded') => void
  units: 'usd' | 'coin'; onUnits: (s: 'usd' | 'coin') => void
  tapeMin: number; onTapeMin: (n: number) => void; cvd: boolean; onCvd: (v: boolean) => void
}) {
  const move = (id: HeatmapColumn, delta: number) => {
    const next = selected.slice(), i = next.indexOf(id), j = i + delta
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]; onChange(next)
  }
  return <details className="relative max-sm:static" data-testid="heatmap-columns-menu">
    <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-neutral-400/20 bg-neutral-400/5 px-2 text-[11px] text-neutral-200 focus-visible:ring-2 focus-visible:ring-neutral-400"><Columns3 size={13} />Columns ({selected.length})</summary>
    <div className="absolute left-3 right-3 top-full z-40 mt-2 max-h-[65vh] w-auto sm:left-0 sm:right-auto sm:w-[360px] space-y-3 overflow-y-auto rounded-lg border border-white/15 bg-[#1b1b1b] p-3 text-[11px] shadow-2xl">
      <p className="text-xs font-semibold">Price-aligned order flow</p>
      <div className="flex flex-wrap gap-1">{columnPresets.map(p => <button type="button" key={p.label} onClick={() => onChange(p.columns.slice())} className="rounded border border-white/10 px-2 py-1 text-neutral-300 hover:bg-white/10">{p.label}</button>)}</div>
      <p className="text-[10px] text-neutral-500">Order below = left to right. Columns that cannot fit beside the chart appear underneath it.</p>
      <div className="space-y-1">{[...selected, ...(Object.keys(columnInfo) as HeatmapColumn[]).filter(id => !selected.includes(id))].map(id => <div key={id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-white/5">
        <label className="flex min-w-0 flex-1 items-center gap-2" title={columnInfo[id].help}><input type="checkbox" aria-label={`Show ${columnInfo[id].label} column`} checked={selected.includes(id)} onChange={e => onChange(e.target.checked ? [...selected, id] : selected.filter(c => c !== id))} className="accent-neutral-400" /><span>{columnInfo[id].label}</span></label>
        {selected.includes(id) && <><button type="button" aria-label={`Move ${columnInfo[id].label} left`} disabled={selected.indexOf(id) === 0} onClick={() => move(id, -1)} className="rounded p-1 text-neutral-400 hover:bg-white/10 disabled:opacity-20"><ArrowUp size={12} /></button><button type="button" aria-label={`Move ${columnInfo[id].label} right`} disabled={selected.indexOf(id) === selected.length - 1} onClick={() => move(id, 1)} className="rounded p-1 text-neutral-400 hover:bg-white/10 disabled:opacity-20"><ArrowDown size={12} /></button></>}
      </div>)}</div>
      <label className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">Volume / delta scope<select aria-label="Order flow scope" value={scope} onChange={e => onScope(e.target.value as typeof scope)} className="rounded border border-white/10 bg-[#111111] p-1.5"><option value="window">Chart window</option><option value="recorded">Recorded buffer</option></select></label>
      <label className="flex items-center justify-between gap-2">SuperDOM units<select aria-label="SuperDOM units" value={units} onChange={e => onUnits(e.target.value as typeof units)} className="rounded border border-white/10 bg-[#111111] p-1.5"><option value="usd">USDT</option><option value="coin">Coin</option></select></label>
      <label className="flex items-center justify-between gap-2">Tape minimum<select aria-label="Tape minimum" value={tapeMin} onChange={e => onTapeMin(Number(e.target.value))} className="rounded border border-white/10 bg-[#111111] p-1.5">{[0, 1000, 10000, 100000].map(n => <option key={n} value={n}>{n ? fmtCompact(n, '$') : 'All prints'}</option>)}</select></label>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="CVD strip" checked={cvd} onChange={e => onCvd(e.target.checked)} className="accent-neutral-400" />CVD strip below chart</label>
    </div>
  </details>
}

/** Also gives keyboard/screen-reader users access to values drawn on canvas. */
export function CompactFlowLadder({ flow, mid, tick, units, expanded = false }: { flow: OrderFlow; mid: number; tick: number; units: 'usd' | 'coin'; expanded?: boolean }) {
  const [view, setView] = useState<'book' | 'fills'>('book')
  const bids = flow.sorted.filter(r => r.bid > 0).sort((a, b) => b.price - a.price).slice(0, 12)
  const asks = flow.sorted.filter(r => r.ask > 0).sort((a, b) => a.price - b.price).slice(0, 12)
  const rows = [...flow.sorted].filter(r => r.buy || r.sell).sort((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid)).slice(0, 20).sort((a, b) => b.price - a.price)
  const max = Math.max(1, ...bids.map(r => r.bid), ...asks.map(r => r.ask))
  const spread = flow.bestAsk !== null && flow.bestBid !== null ? Math.max(0, flow.bestAsk - flow.bestBid) : null
  const amount = (usd: number, price: number) => fmtCompact(units === 'coin' ? usd / price : usd)
  return <details key={String(expanded)} open={expanded || undefined} className="group shrink-0 border-t border-white/10 bg-[#111111] text-[11px]" data-testid="heatmap-compact-ladder">
    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 font-medium text-neutral-200">Order book <span className="text-[10px] font-normal text-neutral-500">{units === 'usd' ? 'USDT' : 'Coin'} · <span className="group-open:hidden">Show</span><span className="hidden group-open:inline">Hide</span></span></summary>
    <div className="flex flex-wrap items-center justify-between gap-2 border-y border-white/[0.06] px-3 py-2">
      <div role="group" aria-label="Order book view" className="flex gap-1 rounded bg-black/30 p-0.5">{(['book', 'fills'] as const).map(id => <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)} className={cn('min-h-8 rounded px-3 text-[11px]', view === id ? 'bg-neutral-700/70 text-white' : 'text-neutral-500 hover:text-neutral-200')}>{id === 'book' ? 'Resting orders' : 'Executed trades'}</button>)}</div>
      <span className="whitespace-nowrap font-mono text-[10px] text-neutral-500">{spread !== null ? `Spread ${fmtPrice(spread, tick)}` : 'Awaiting book'}</span>
    </div>
    {view === 'book' ? <>
      <div className="grid grid-cols-2 divide-x divide-white/[0.07]">
        {([{ side: 'bid', label: 'Buy orders', rows: bids, color: 'text-emerald-400' }, { side: 'ask', label: 'Sell orders', rows: asks, color: 'text-rose-400' }] as const).map(book => <div key={book.side} className="min-w-0 px-2 pb-2">
          <div className={cn('px-1 pt-3 text-[11px] font-medium', book.color)}>{book.label}</div>
          <table className="w-full table-fixed text-right font-mono text-[11px] tabular-nums" aria-label={book.label}>
            <thead className="text-[10px] text-neutral-500"><tr><th className="w-[56%] px-1 py-2 text-left font-normal" title="Prices grouped into heatmap bins">Price bin</th><th className="px-1 font-normal">Size</th></tr></thead>
            <tbody>{book.rows.map(r => <tr key={r.price} className="h-6" style={{ backgroundImage: `linear-gradient(to left, ${book.side === 'bid' ? '#16c7841f' : '#ea39431f'} ${r[book.side] / max * 100}%, transparent ${r[book.side] / max * 100}%)` }}><td className={cn('overflow-hidden px-1 text-left', book.color)}>{fmtPrice(r.price, tick)}</td><td className="px-1 text-neutral-300">{amount(r[book.side], r.price)}</td></tr>)}</tbody>
          </table>
          {!book.rows.length && <p className="py-6 text-center text-[10px] text-neutral-500">Waiting for depth</p>}
        </div>)}
      </div>
      <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2"><span className="text-[10px] text-neutral-500">Grouped depth · waiting orders</span><span className="font-mono text-xs text-neutral-200">{mid ? fmtPrice(mid, tick) : '—'} <span className="text-[9px] text-neutral-500">MID</span></span></div>
    </> : <div className="px-2 pb-2">
      <p className="px-1 py-2 text-[10px] text-neutral-500">Filled orders · delta = buys − sells</p>
      <div className="max-h-72 overflow-y-auto"><table className="w-full table-fixed text-right font-mono text-[10px] tabular-nums" aria-label="Executed buyer seller flow"><thead className="sticky top-0 bg-[#111111] text-neutral-500"><tr>{['Sell fills', 'Price', 'Buy fills', 'Delta $'].map(label => <th key={label} className="px-1 py-2 font-normal">{label}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.price} className="h-7 border-t border-white/[0.03]"><td className="px-1 text-rose-400">{fmtCompact(units === 'coin' ? r.sellQty : r.sell)}</td><td className="px-1 text-neutral-300">{fmtPrice(r.price, tick)}</td><td className="px-1 text-emerald-400">{fmtCompact(units === 'coin' ? r.buyQty : r.buy)}</td><td className={cn('px-1', r.delta >= 0 ? 'text-emerald-400' : 'text-rose-400')}>{r.delta > 0 ? '+' : ''}{fmtCompact(r.delta)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="py-6 text-center text-neutral-500">Waiting for executions</p>}
    </div>}
  </details>
}

/** Columns that do not fit alongside the canvas remain readable below it. */
export function StackedFlowColumns({ selected, flow, mid, tick, tapeMin }: {
  selected: HeatmapColumn[]; flow: OrderFlow; mid: number; tick: number; tapeMin: number
}) {
  const rows = [...flow.sorted].sort((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid)).slice(0, 31).sort((a, b) => b.price - a.price)
  const fields: Record<Exclude<HeatmapColumn, 'dom' | 'tape'>, { labels: string[]; values: (r: FlowRow) => number[] }> = {
    book: { labels: ['Bid $', 'Ask $'], values: r => [r.bid, r.ask] },
    size: { labels: ['Resting size $'], values: r => [r.bid + r.ask] },
    depth: { labels: ['Bid depth $', 'Ask depth $'], values: r => [r.bidCum, r.askCum] },
    volume: { labels: ['Buy $', 'Sell $'], values: r => [r.buy, r.sell] },
    delta: { labels: ['Delta $'], values: r => [r.delta] },
    cumDelta: { labels: ['Cumulative delta $'], values: r => [r.cumDelta] },
    svp: { labels: ['Recorded buy $', 'Recorded sell $'], values: r => [r.recordedBuy, r.recordedSell] },
    quotes: { labels: ['Bid changes', 'Ask changes'], values: r => [r.bidChanges, r.askChanges] },
  }
  return <div className="grid shrink-0 gap-0 bg-[#111111] sm:grid-cols-2" data-testid="heatmap-stacked-columns">
    {selected.filter(id => id !== 'dom').map(id => {
      const tape = id === 'tape'
      const config = !tape ? fields[id as keyof typeof fields] : null
      const prints = tape ? flow.tape.filter(t => t.p * t.q >= tapeMin).slice(0, 40) : []
      return <section key={id} className="min-w-0 border-t border-white/10 bg-[#111111] p-3" aria-label={`${columnInfo[id].label} below chart`}>
        <h2 className="text-xs font-semibold text-neutral-200">{columnInfo[id].label}</h2>
        <p className="mb-2 mt-1 text-[10px] text-neutral-500">{tape ? 'Observed last 60s · newest first · USDT' : `${id === 'quotes' ? 'Observed snapshot changes' : 'USDT'} · nearest ${rows.length} price levels`}</p>
        <div className="max-h-64 overflow-auto">
          <table className="w-full table-fixed text-right font-mono text-[10px] tabular-nums" aria-label={columnInfo[id].label}>
            <thead className="sticky top-0 bg-[#151515] text-neutral-400"><tr>{(tape ? ['Time UTC', 'Price', 'Side', 'Value $'] : ['Price', ...config!.labels]).map(label => <th key={label} className="px-1 py-2 font-normal">{label}</th>)}</tr></thead>
            <tbody>{tape ? prints.map((t, i) => <tr key={`${t.t}-${i}`} className={t.m ? 'text-rose-300' : 'text-emerald-300'}><td className="px-1 py-1.5">{new Date(t.t).toISOString().slice(11, 19)}</td><td className="px-1">{fmtPrice(t.p, tick)}</td><td className="px-1">{t.m ? 'Sell' : 'Buy'}</td><td className="px-1">{fmtCompact(t.p * t.q)}</td></tr>) : rows.map(r => <tr key={r.price} className={cn('text-neutral-300', Math.abs(r.price - mid) < tick * 2 && 'bg-white/5')}><td className="px-1 py-1.5">{fmtPrice(r.price, tick)}</td>{config!.values(r).map((value, i) => <td key={i} className={cn('px-1', value < 0 || (i === 1 && ['book', 'depth', 'volume', 'svp', 'quotes'].includes(id)) ? 'text-rose-300' : 'text-emerald-300')}>{id === 'quotes' ? value : fmtCompact(value)}</td>)}</tr>)}</tbody>
          </table>
          {(tape ? !prints.length : !rows.length) && <p className="py-4 text-center text-[11px] text-neutral-500">{tape ? 'No matching recorded trades yet.' : 'Waiting for recorded depth and trades.'}</p>}
        </div>
      </section>
    })}
  </div>
}
