'use client'

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
  return <details className="relative" data-testid="heatmap-columns-menu">
    <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border border-sky-400/20 bg-sky-400/5 px-2 text-[11px] text-sky-200 focus-visible:ring-2 focus-visible:ring-sky-400"><Columns3 size={13} />Columns ({selected.length})</summary>
    <div className="absolute left-0 top-full z-40 mt-2 max-h-[70vh] w-[min(360px,calc(100vw-24px))] space-y-3 overflow-y-auto rounded-lg border border-white/15 bg-[#101927] p-3 text-[11px] shadow-2xl">
      <p className="text-xs font-semibold">Price-aligned order flow</p>
      <div className="flex flex-wrap gap-1">{columnPresets.map(p => <button type="button" key={p.label} onClick={() => onChange(p.columns.slice())} className="rounded border border-white/10 px-2 py-1 text-slate-300 hover:bg-white/10">{p.label}</button>)}</div>
      <p className="text-[10px] text-slate-500">Order below = left to right. Columns that cannot fit beside the chart appear underneath it.</p>
      <div className="space-y-1">{[...selected, ...(Object.keys(columnInfo) as HeatmapColumn[]).filter(id => !selected.includes(id))].map(id => <div key={id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-white/5">
        <label className="flex min-w-0 flex-1 items-center gap-2" title={columnInfo[id].help}><input type="checkbox" aria-label={`Show ${columnInfo[id].label} column`} checked={selected.includes(id)} onChange={e => onChange(e.target.checked ? [...selected, id] : selected.filter(c => c !== id))} className="accent-sky-400" /><span>{columnInfo[id].label}</span></label>
        {selected.includes(id) && <><button type="button" aria-label={`Move ${columnInfo[id].label} left`} disabled={selected.indexOf(id) === 0} onClick={() => move(id, -1)} className="rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-20"><ArrowUp size={12} /></button><button type="button" aria-label={`Move ${columnInfo[id].label} right`} disabled={selected.indexOf(id) === selected.length - 1} onClick={() => move(id, 1)} className="rounded p-1 text-slate-400 hover:bg-white/10 disabled:opacity-20"><ArrowDown size={12} /></button></>}
      </div>)}</div>
      <label className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">Volume / delta scope<select aria-label="Order flow scope" value={scope} onChange={e => onScope(e.target.value as typeof scope)} className="rounded border border-white/10 bg-[#0a111c] p-1.5"><option value="window">Chart window</option><option value="recorded">Recorded buffer</option></select></label>
      <label className="flex items-center justify-between gap-2">SuperDOM units<select aria-label="SuperDOM units" value={units} onChange={e => onUnits(e.target.value as typeof units)} className="rounded border border-white/10 bg-[#0a111c] p-1.5"><option value="usd">USDT</option><option value="coin">Coin</option></select></label>
      <label className="flex items-center justify-between gap-2">Tape minimum<select aria-label="Tape minimum" value={tapeMin} onChange={e => onTapeMin(Number(e.target.value))} className="rounded border border-white/10 bg-[#0a111c] p-1.5">{[0, 1000, 10000, 100000].map(n => <option key={n} value={n}>{n ? fmtCompact(n, '$') : 'All prints'}</option>)}</select></label>
      <label className="flex items-center gap-2"><input type="checkbox" aria-label="CVD strip" checked={cvd} onChange={e => onCvd(e.target.checked)} className="accent-sky-400" />CVD strip below chart</label>
    </div>
  </details>
}

/** Also gives keyboard/screen-reader users access to values drawn on canvas. */
export function CompactFlowLadder({ flow, mid, tick, units, expanded = false }: { flow: OrderFlow; mid: number; tick: number; units: 'usd' | 'coin'; expanded?: boolean }) {
  const rows = [...flow.sorted].sort((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid)).slice(0, 21).sort((a, b) => b.price - a.price)
  return <details key={String(expanded)} open={expanded || undefined} className="shrink-0 border-t border-white/10 px-3 py-2 text-[10px]" data-testid="heatmap-compact-ladder">
    <summary className="cursor-pointer text-slate-400">Buyer / seller ladder · exact row values <span className="text-slate-600">(expand)</span></summary>
    <p className="mt-2 text-slate-500">Sold and bought are executed trades; bid and ask are resting orders. {units === 'usd' ? 'Values in USDT.' : 'Values in coin units.'}</p>
    <div className="mt-2 max-h-64 overflow-auto"><table className="w-full font-mono tabular-nums" aria-label="Buyer seller price ladder"><thead className="sticky top-0 bg-[#0c1420] text-right text-slate-500"><tr>{['Sold', 'Bid', 'Price', 'Ask', 'Bought', 'Delta $'].map(s => <th key={s} className="px-1 py-1 font-normal">{s}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={r.price} className={cn('text-right', Math.abs(r.price - mid) < tick * 2 && 'bg-white/5')}><td className="px-1 py-1 text-rose-300">{fmtCompact(units === 'coin' ? r.sellQty : r.sell)}</td><td className="px-1 text-emerald-300">{fmtCompact(units === 'coin' ? r.bid / r.price : r.bid)}</td><td className="px-1 text-slate-300">{fmtPrice(r.price, tick)}</td><td className="px-1 text-rose-300">{fmtCompact(units === 'coin' ? r.ask / r.price : r.ask)}</td><td className="px-1 text-emerald-300">{fmtCompact(units === 'coin' ? r.buyQty : r.buy)}</td><td className={cn('px-1', r.delta >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{r.delta > 0 ? '+' : ''}{fmtCompact(r.delta)}</td></tr>)}</tbody></table></div>
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
  return <div className="grid shrink-0 gap-3 bg-[#0c1420] p-3 sm:grid-cols-2" data-testid="heatmap-stacked-columns">
    {selected.filter(id => id !== 'dom').map(id => {
      const tape = id === 'tape'
      const config = !tape ? fields[id as keyof typeof fields] : null
      const prints = tape ? flow.tape.filter(t => t.p * t.q >= tapeMin).slice(0, 40) : []
      return <section key={id} className="min-w-0 rounded-lg border border-white/10 bg-[#101b2b] p-3" aria-label={`${columnInfo[id].label} below chart`}>
        <h2 className="text-xs font-semibold text-slate-200">{columnInfo[id].label}</h2>
        <p className="mb-2 mt-1 text-[10px] text-slate-500">{tape ? 'Observed last 60s · newest first · USDT' : `${id === 'quotes' ? 'Observed snapshot changes' : 'USDT'} · nearest ${rows.length} price levels`}</p>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-right font-mono text-[10px] tabular-nums" aria-label={columnInfo[id].label}>
            <thead className="sticky top-0 bg-[#101b2b] text-slate-400"><tr>{(tape ? ['Time UTC', 'Price', 'Side', 'Value $'] : ['Price', ...config!.labels]).map(label => <th key={label} className="px-1 py-2 font-normal">{label}</th>)}</tr></thead>
            <tbody>{tape ? prints.map((t, i) => <tr key={`${t.t}-${i}`} className={t.m ? 'text-rose-300' : 'text-emerald-300'}><td className="px-1 py-1.5">{new Date(t.t).toISOString().slice(11, 19)}</td><td className="px-1">{fmtPrice(t.p, tick)}</td><td className="px-1">{t.m ? 'Sell' : 'Buy'}</td><td className="px-1">{fmtCompact(t.p * t.q)}</td></tr>) : rows.map(r => <tr key={r.price} className={cn('text-slate-300', Math.abs(r.price - mid) < tick * 2 && 'bg-white/5')}><td className="px-1 py-1.5">{fmtPrice(r.price, tick)}</td>{config!.values(r).map((value, i) => <td key={i} className={cn('px-1', value < 0 ? 'text-rose-300' : 'text-emerald-300')}>{id === 'quotes' ? value : fmtCompact(value)}</td>)}</tr>)}</tbody>
          </table>
          {(tape ? !prints.length : !rows.length) && <p className="py-4 text-center text-[11px] text-slate-500">{tape ? 'No matching recorded trades yet.' : 'Waiting for recorded depth and trades.'}</p>}
        </div>
      </section>
    })}
  </div>
}
