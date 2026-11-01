'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { useTerminal } from '@/lib/terminal/store'
import { setStreamSymbol, getStream } from '@/lib/terminal/stream-client'
import { usePoll, useNow } from '@/lib/terminal/hooks'
import { metaFor } from '@/lib/terminal/constants'
import { fmtPrice, fmtPct, fmtCompact } from '@/lib/terminal/format'
import { cn } from '@/lib/utils'
import { PanelRight, ChevronDown } from 'lucide-react'

export default function TopBar({ status }: { status: 'connecting' | 'live' | 'offline' }) {
  const { symbol, setSymbol, toggleRail, railOpen, setScannerOpen, tab } = useTerminal()
  const meta = metaFor(symbol)

  useEffect(() => { setStreamSymbol(symbol) }, [symbol])

  const ticker = usePoll(() => getStream().ticker, 400)
  const bookTop = usePoll(() => getStream().bookTop, 200)
  const mid = bookTop ? (bookTop.b + bookTop.a) / 2 : ticker?.c ?? null
  const up = (ticker?.P ?? 0) >= 0
  const tickUp = bookTop ? bookTop.a >= (ticker?.c ?? 0) : up
  const spreadTicks = bookTop && bookTop.a > bookTop.b ? Math.max(1, Math.round((bookTop.a - bookTop.b) / meta.tick)) : null
  const clock = useNow(1000)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-[#111111] px-2 sm:gap-3 sm:px-3" role="banner">
      <div className="flex shrink-0 items-center gap-2" aria-label="FlowLens market terminal">
        <Image src="/flowlens.svg" alt="" width={28} height={28} className="size-7 shrink-0" />
        <div className="leading-none">
          <div className="text-sm font-semibold tracking-tight text-neutral-100">FlowLens</div>
          <div className="mt-1 text-[8px] uppercase tracking-[0.14em] text-neutral-500">Market terminal</div>
        </div>
      </div>

      <button
        onClick={() => setScannerOpen(true)}
        aria-label="Pick a market"
        title="Pick a market — all USDT pairs, 24h stats"
        className="ml-1 flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 font-mono text-xs font-semibold hover:border-[#4da3ff]/60"
      >
        {meta.label}
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </button>

      <div className="hidden items-baseline gap-2 sm:flex" aria-live="polite">
        <span className={cn('font-mono text-lg font-bold tabular-nums', tickUp ? 'text-[#16c784]' : 'text-[#ea3943]')}>
          {fmtPrice(mid, meta.tick)}
        </span>
        <span className={cn('rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold',
          up ? 'bg-[#16c784]/15 text-[#16c784]' : 'bg-[#ea3943]/15 text-[#ea3943]')}>
          {fmtPct(ticker?.P)}
        </span>
      </div>

      <div className="hidden gap-4 font-mono text-[10px] text-muted-foreground lg:flex">
        <span>bid <span className="text-[#16c784]">{fmtPrice(bookTop?.b, meta.tick)}</span></span>
        <span>ask <span className="text-[#ea3943]">{fmtPrice(bookTop?.a, meta.tick)}</span></span>
        <span>spread <span className="text-foreground/90">{spreadTicks != null ? `${spreadTicks} tick${spreadTicks === 1 ? '' : 's'}` : '—'}</span></span>
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
          title={status === 'connecting' ? 'Connecting to market feed' : undefined}
        >
          <span className={cn('size-1.5 rounded-full',
            status === 'live' ? 'animate-pulse bg-[#16c784]' : status === 'connecting' ? 'animate-pulse bg-[#f0b90b]' : 'bg-muted-foreground')} />
          {status === 'connecting' ? <><span className="sm:hidden">SYNC</span><span className="hidden sm:inline">CONNECTING</span></> : status === 'live' ? 'LIVE' : 'OFFLINE'}
        </span>
        <span className="hidden font-mono text-[11px] text-muted-foreground md:block">
          {clock ? new Date(clock).toISOString().slice(11, 19) + ' UTC' : '—'}
        </span>
        {tab !== 'footprint' && tab !== 'heatmap' && tab !== 'whales' && tab !== 'bubbles' && <button
          onClick={toggleRail}
          aria-label="Toggle order book rail"
          title="Toggle order book rail (B)"
          className={cn('hidden rounded-md border p-1.5 hover:bg-muted xl:inline-flex',
            railOpen ? 'border-[#4da3ff]/50 text-[#4da3ff]' : 'border-border text-muted-foreground')}
        >
          <PanelRight className="size-4" />
        </button>}
      </div>
    </header>
  )
}
