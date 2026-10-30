'use client'

import { getStream } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { useTerminal } from '@/lib/terminal/store'
import { symbolMeta, GREEN, RED } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtUsd, fmtTime } from '@/lib/terminal/format'
import { cn } from '@/lib/utils'

/** Persistent right rail: aggregated depth ladder + last trades. */
export default function OrderBookRail() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)

  const data = usePoll(() => {
    const s = getStream()
    const ladder = s.ladder
    if (!ladder || !ladder.bids.length || !ladder.asks.length) return null
    const mid = (ladder.bids[0].p + ladder.asks[0].p) / 2
    const spanPct = 0.0012 // ±12bps window
    const win = (levels: { p: number; q: number }[]) => {
      const rows = new Map<number, number>()
      const bin = meta.bin
      for (const l of levels) {
        if (Math.abs(l.p / mid - 1) > spanPct) continue
        const k = Math.round(l.p / bin) * bin
        rows.set(k, (rows.get(k) ?? 0) + l.q)
      }
      return [...rows.entries()].sort((a, b) => (a[0] > mid ? a[0] - b[0] : b[0] - a[0]))
    }
    const asks = win(ladder.asks).slice(0, 12)
    const bids = win(ladder.bids).slice(0, 12)
    const maxQ = Math.max(...asks.map((r) => r[1]), ...bids.map((r) => r[1]), 0.0001)
    const bidNotional = bids.reduce((a, r) => a + r[1] * r[0], 0)
    const askNotional = asks.reduce((a, r) => a + r[1] * r[0], 0)
    const last = s.trades[s.trades.length - 1] ?? null
    return { mid, spread: ladder.asks[0].p - ladder.bids[0].p, asks, bids, maxQ, bidNotional, askNotional, last }
  }, 400, [])

  const trades = usePoll(() => getStream().trades.slice(-14).reverse(), 500)

  const imbalance = data && data.bidNotional + data.askNotional > 0
    ? (data.bidNotional / (data.bidNotional + data.askNotional)) * 100
    : 50

  return (
    <div className="flex h-full flex-col min-h-0 text-[11px]" data-testid="order-book-rail">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Order book</span>
        <span className="font-mono normal-case">{data ? `spread ${fmtPrice(data.spread, meta.tick)}` : '—'}</span>
      </div>
      {data ? (
        <>
          <div className="flex-1 overflow-hidden px-1 py-1">
            {[...data.asks].reverse().map(([p, q]) => (
              <Row key={`a${p}`} p={p} q={q} maxQ={data.maxQ} side="ask" meta={meta} />
            ))}
            <div className="my-1 flex items-center justify-between rounded bg-muted/50 px-2 py-1">
              <span className="font-mono font-bold" style={{ color: data.last && !data.last.m ? GREEN : RED }}>
                {fmtPrice(data.mid, meta.tick)}
              </span>
              <span className="text-[9px] text-muted-foreground">mid</span>
            </div>
            {data.bids.map(([p, q]) => (
              <Row key={`b${p}`} p={p} q={q} maxQ={data.maxQ} side="bid" meta={meta} />
            ))}
          </div>
          <div className="border-t border-border/60 px-2 py-1.5">
            <div className="mb-1 flex justify-between font-mono text-[9px]">
              <span className="text-[#16c784]">{imbalance.toFixed(0)}% bids</span>
              <span className="text-[#ea3943]">{(100 - imbalance).toFixed(0)}% asks</span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full">
              <div className="bg-[#16c784]" style={{ width: `${imbalance}%` }} />
              <div className="bg-[#ea3943]" style={{ width: `${100 - imbalance}%` }} />
            </div>
            <div className="mt-0.5 text-center text-[9px] text-muted-foreground">±12 bps resting depth</div>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[10px] text-muted-foreground">connecting…</div>
      )}
      <div className="max-h-[38%] min-h-[120px] overflow-y-auto border-t border-border/60">
        <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">Last trades</div>
        {trades.map((t) => (
          <div key={t.a} className="flex items-center justify-between px-3 py-[3px] font-mono">
            <span className={cn('w-8 text-[9px] font-bold', t.m ? 'text-[#ea3943]' : 'text-[#16c784]')}>{t.m ? 'S' : 'B'}</span>
            <span className="flex-1 text-right">{fmtPrice(t.p, meta.tick)}</span>
            <span className="w-14 text-right text-muted-foreground">{fmtCompact(t.q)}</span>
            <span className="w-12 text-right text-[9px] text-muted-foreground">{fmtTime(t.t)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Row({ p, q, maxQ, side, meta }: { p: number; q: number; maxQ: number; side: 'bid' | 'ask'; meta: { tick: number } }) {
  const w = (q / maxQ) * 100
  return (
    <div className="relative flex items-center justify-between px-2 py-[2px] font-mono">
      <div
        className={cn('absolute inset-y-[1px]', side === 'bid' ? 'left-0 bg-[#16c784]/15' : 'left-0 bg-[#ea3943]/15')}
        style={{ width: `${w}%` }}
      />
      <span className={cn('relative z-10', side === 'bid' ? 'text-[#16c784]' : 'text-[#ea3943]')}>{fmtPrice(p, meta.tick)}</span>
      <span className="relative z-10 text-muted-foreground">{fmtCompact(q)}</span>
    </div>
  )
}
