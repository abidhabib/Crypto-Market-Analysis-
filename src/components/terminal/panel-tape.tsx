'use client'

import { useMemo, useState } from 'react'
import { getStream } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { useTerminal } from '@/lib/terminal/store'
import { symbolMeta, GREEN, RED } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtTime, fmtUsd } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge } from './panel-kit'
import { cn } from '@/lib/utils'
import type { Trade } from '@/lib/terminal/types'

const MIN_FILTERS = [0, 5_000, 25_000, 100_000]

export default function TapePanel() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)
  const [side, setSide] = useState<'all' | 'buy' | 'sell'>('all')
  const [minN, setMinN] = useState(0)
  const [bigN, setBigN] = useState(100_000)

  const data = usePoll(() => {
    const s = getStream()
    const t = Date.now()
    const recent = s.trades.filter((x) => x.t >= t - 10_000)
    const rate = recent.length / 10
    const notional = recent.reduce((a, x) => a + x.p * x.q, 0) / 10
    const buys = recent.filter((x) => !x.m).reduce((a, x) => a + x.p * x.q, 0)
    const sell = recent.reduce((a, x) => a + x.p * x.q, 0) - buys
    return { trades: s.trades, rate, notional, buyPct: buys + sell > 0 ? (buys / (buys + sell)) * 100 : 50 }
  }, 400)

  const rows = useMemo(() => {
    let list: Trade[] = data.trades.slice(-500).reverse()
    if (side !== 'all') list = list.filter((t) => (side === 'buy' ? !t.m : t.m))
    if (minN > 0) list = list.filter((t) => t.p * t.q >= minN)
    return list.slice(0, 150)
  }, [data.trades, side, minN])

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-tape">
      <PanelHeader
        title="Time & sales"
        sub="Aggressive prints: BUY lifted the ask · SELL hit the bid · rows flash when ≥ big-print size"
        source="Binance aggTrades · live"
        right={
          <>
            <SourceBadge label="stream" />
            <div className="flex overflow-hidden rounded-md border border-border">
              {(['all', 'buy', 'sell'] as const).map((s) => (
                <button key={s} onClick={() => setSide(s)}
                  className={cn('px-2 py-1 text-[10px] capitalize', side === s ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {s}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-md border border-border">
              {MIN_FILTERS.map((m) => (
                <button key={m} onClick={() => setMinN(m)}
                  className={cn('px-2 py-1 font-mono text-[10px]', minN === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {m === 0 ? 'all' : `≥${fmtUsd(m)}`}
                </button>
              ))}
            </div>
            <select value={bigN} onChange={(e) => setBigN(+e.target.value)}
              className="rounded border border-border bg-background px-1 py-1 text-[10px]">
              {[50_000, 100_000, 250_000, 500_000].map((v) => <option key={v} value={v}>big ≥ {fmtUsd(v)}</option>)}
            </select>
          </>
        }
      />
      <div className="grid grid-cols-3 gap-2 border-b border-border/60 px-3 py-2">
        <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Print rate (10s)</div>
          <div className="font-mono text-sm font-semibold">{data.rate.toFixed(1)}/s</div>
        </div>
        <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Notional rate</div>
          <div className="font-mono text-sm font-semibold">{fmtUsd(data.notional)}/s</div>
        </div>
        <div className="rounded-md border border-border/60 bg-card/60 px-3 py-2">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Aggressive split (10s)</div>
          <div className="mt-1.5 flex h-2 overflow-hidden rounded-full">
            <div className="bg-[#16c784]" style={{ width: `${data.buyPct}%` }} />
            <div className="bg-[#ea3943]" style={{ width: `${100 - data.buyPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[9px]">
            <span className="text-[#16c784]">{data.buyPct.toFixed(0)}% buy</span>
            <span className="text-[#ea3943]">{(100 - data.buyPct).toFixed(0)}% sell</span>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#0d1017] text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Time</th>
              <th className="px-2 py-1.5 font-medium">Side</th>
              <th className="px-2 py-1.5 font-medium text-right">Price</th>
              <th className="px-2 py-1.5 font-medium text-right">Size</th>
              <th className="px-3 py-1.5 font-medium text-right">Notional</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const n = t.p * t.q
              const big = n >= bigN
              return (
                <tr key={`${t.a}-${t.t}`} className={cn('border-t border-border/40', big ? (t.m ? 'bg-[#ea3943]/10' : 'bg-[#16c784]/10') : 'hover:bg-muted/30')}>
                  <td className="px-3 py-1 text-muted-foreground">{fmtTime(t.t)}</td>
                  <td className={cn('px-2 py-1 font-semibold', t.m ? 'text-[#ea3943]' : 'text-[#16c784]')}>{t.m ? 'SELL' : 'BUY'}</td>
                  <td className="px-2 py-1 text-right">{fmtPrice(t.p, meta.tick)}</td>
                  <td className="px-2 py-1 text-right">{fmtCompact(t.q)}</td>
                  <td className={cn('px-3 py-1 text-right', big && 'font-bold')}>{fmtUsd(n)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No prints match the filter yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
