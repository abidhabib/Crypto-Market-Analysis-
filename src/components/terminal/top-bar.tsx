'use client'

import { useEffect } from 'react'
import { useTerminal } from '@/lib/terminal/store'
import { setStreamSymbol, getStream } from '@/lib/terminal/stream-client'
import { usePoll, useNow } from '@/lib/terminal/hooks'
import { SYMBOLS, symbolMeta } from '@/lib/terminal/constants'
import { fmtPrice, fmtPct, fmtCompact } from '@/lib/terminal/format'
import { cn } from '@/lib/utils'
import { PanelRight, Activity } from 'lucide-react'

export default function TopBar({ status }: { status: 'connecting' | 'live' | 'offline' }) {
  const { symbol, setSymbol, toggleRail, railOpen } = useTerminal()
  const meta = symbolMeta(symbol)

  useEffect(() => { setStreamSymbol(symbol) }, [symbol])

  const ticker = usePoll(() => getStream().ticker, 400)
  const up = (ticker?.P ?? 0) >= 0
  const clock = useNow(1000)

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/60 bg-[#0d1017] px-3" role="banner">
      <div className="flex items-center gap-2">
        <div className="flex size-6 items-center justify-center rounded bg-[#f0b90b]/15">
          <Activity className="size-4 text-[#f0b90b]" />
        </div>
        <div className="leading-none">
          <div className="text-sm font-bold tracking-tight">OrderFlow <span className="text-[#f0b90b]">Terminal</span></div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">live market analysis</div>
        </div>
      </div>

      <div className="ml-1 flex items-center gap-1.5">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          aria-label="Symbol"
          className="h-8 rounded-md border border-border bg-background px-2 font-mono text-xs font-semibold"
        >
          {SYMBOLS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      <div className="hidden items-baseline gap-2 sm:flex" aria-live="polite">
        <span className={cn('font-mono text-lg font-bold tabular-nums', up ? 'text-[#16c784]' : 'text-[#ea3943]')}>
          {fmtPrice(ticker?.c, meta.tick)}
        </span>
        <span className={cn('rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold',
          up ? 'bg-[#16c784]/15 text-[#16c784]' : 'bg-[#ea3943]/15 text-[#ea3943]')}>
          {fmtPct(ticker?.P)}
        </span>
      </div>

      <div className="hidden gap-4 font-mono text-[10px] text-muted-foreground lg:flex">
        <span>24h high <span className="text-foreground/90">{fmtPrice(ticker?.h, meta.tick)}</span></span>
        <span>24h low <span className="text-foreground/90">{fmtPrice(ticker?.l, meta.tick)}</span></span>
        <span>24h vol <span className="text-foreground/90">{fmtCompact(ticker?.q, '$')}</span></span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
            status === 'live' && 'border-[#16c784]/40 bg-[#16c784]/10 text-[#16c784]',
            status === 'connecting' && 'border-[#f0b90b]/40 bg-[#f0b90b]/10 text-[#f0b90b]',
            status === 'offline' && 'border-border bg-muted text-muted-foreground')}
          role="status"
        >
          <span className={cn('size-1.5 rounded-full',
            status === 'live' ? 'animate-pulse bg-[#16c784]' : status === 'connecting' ? 'animate-pulse bg-[#f0b90b]' : 'bg-muted-foreground')} />
          {status === 'live' ? 'LIVE' : status.toUpperCase()}
        </span>
        <span className="hidden font-mono text-[11px] text-muted-foreground md:block">
          {clock ? new Date(clock).toISOString().slice(11, 19) + ' UTC' : '—'}
        </span>
        <button
          onClick={toggleRail}
          aria-label="Toggle order book rail"
          title="Toggle order book rail (B)"
          className={cn('rounded-md border p-1.5 hover:bg-muted',
            railOpen ? 'border-[#4da3ff]/50 text-[#4da3ff]' : 'border-border text-muted-foreground')}
        >
          <PanelRight className="size-4" />
        </button>
      </div>
    </header>
  )
}
