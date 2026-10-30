'use client'

/**
 * Insights — auto-generated market analysis.
 * A rolling feed of plain-language observations pulled from the live event
 * streams (spoof pulls, sweeps, icebergs, walls, whales, liquidations,
 * regime shifts) plus a summary paragraph and the key levels card.
 */

import { useState } from 'react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { metaFor } from '@/lib/terminal/constants'
import { insights, marketSummary, levels, regime, type Insight, type InsightCat } from '@/lib/terminal/analytics'
import { fmtPrice, fmtCompact } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge, StatCard } from './panel-kit'
import { cn } from '@/lib/utils'
import { Lightbulb, MapPin } from 'lucide-react'

const CATS: { id: InsightCat | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'flow', label: 'Flow' },
  { id: 'liquidity', label: 'Liquidity' },
  { id: 'whales', label: 'Whales' },
  { id: 'derivs', label: 'Derivs' },
  { id: 'regime', label: 'Regime' },
]

const CAT_STYLE: Record<InsightCat, string> = {
  flow: 'border-[#4da3ff]/40 bg-[#4da3ff]/10 text-[#4da3ff]',
  liquidity: 'border-[#16c784]/40 bg-[#16c784]/10 text-[#16c784]',
  whales: 'border-[#f0b90b]/40 bg-[#f0b90b]/10 text-[#f0b90b]',
  derivs: 'border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#a78bfa]',
  regime: 'border-border bg-muted text-muted-foreground',
}

export default function InsightsPanel() {
  const { symbol } = useTerminal()
  const meta = metaFor(symbol)
  const beat = usePoll(() => getStream().lastMsgAt, 1500)
  const [cat, setCat] = useState<InsightCat | 'all'>('all')

  const feed: Insight[] = insights()
  const summary = marketSummary()
  const l = levels()
  const r = regime()
  const mid = r?.price ?? 0
  const filtered = cat === 'all' ? feed : feed.filter((i) => i.cat === cat)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="panel-insights">
      <PanelHeader
        title="Insights — market analysis feed"
        sub="Auto-generated observations from every live stream · plain language, no guessing what a number means"
        source="computed live"
        right={<SourceBadge label={beat ? 'LIVE' : 'SYNCING'} tone={beat ? 'live' : 'est'} />}
      />

      {/* summary */}
      <section className="mx-3 mt-3 rounded-lg border border-[#f0b90b]/30 bg-[#f0b90b]/5 p-4" aria-label="Market summary">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#f0b90b]">
          <Lightbulb className="size-3.5" /> What the tape says right now
        </div>
        <p className="mt-2 text-sm leading-relaxed text-foreground/95">
          {summary ?? 'Collecting candles, prints and book depth — the first summary lands within a minute of connecting.'}
        </p>
      </section>

      {/* key levels */}
      <section className="mx-3 mt-3 rounded-lg border border-border/60 bg-card/40 p-4" aria-label="Key levels">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <MapPin className="size-3.5" /> Key levels
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <StatCard label="Buy above" value={fmtPrice(l.buyAbove, meta.tick)} tone="up" sub={l.buyAbove ? `${(((l.buyAbove - mid) / mid) * 10000).toFixed(0)} bp` : '—'} />
          <StatCard label="Sell below" value={fmtPrice(l.sellBelow, meta.tick)} tone="down" sub={l.sellBelow ? `${(((mid - l.sellBelow) / mid) * 10000).toFixed(0)} bp` : '—'} />
          <StatCard label="POC (4h)" value={fmtPrice(l.poc, meta.tick)} sub="fair price magnet" />
          <StatCard label="Value area" value={`${fmtPrice(l.val, meta.tick)} – ${fmtPrice(l.vah, meta.tick)}`} sub="edges of 70% volume" />
          <StatCard label="24h high" value={fmtPrice(l.sessionHigh, meta.tick)} />
          <StatCard label="24h low" value={fmtPrice(l.sessionLow, meta.tick)} />
          <StatCard label="Regime" value={r?.label ?? '—'} sub={r ? `strength ${r.strength}/100` : undefined} />
        </div>
        {(l.wallsAbove.length || l.wallsBelow.length) ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {l.wallsBelow.slice(0, 4).map((w) => (
              <span key={`b${w.p}`} className="rounded border border-[#16c784]/30 bg-[#16c784]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#16c784]">
                bid wall {fmtCompact(w.q, '$')} @ {fmtPrice(w.p, meta.tick)}
              </span>
            ))}
            {l.wallsAbove.slice(0, 4).map((w) => (
              <span key={`a${w.p}`} className="rounded border border-[#ea3943]/30 bg-[#ea3943]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#ea3943]">
                ask wall {fmtCompact(w.q, '$')} @ {fmtPrice(w.p, meta.tick)}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        {CATS.map((c) => (
          <button
            key={c.id}
            onClick={() => setCat(c.id)}
            className={cn('rounded border px-2 py-1 text-[10px]',
              cat === c.id ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}
          >
            {c.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted-foreground">{filtered.length} events</span>
      </div>

      {/* feed */}
      <section className="mx-3 mb-3 flex-1 space-y-1.5" aria-label="Insight feed">
        {filtered.map((i) => (
          <article
            key={i.id}
            className={cn('flex items-start gap-2.5 rounded-md border px-3 py-2',
              i.sev === 'hot' ? 'border-[#ea3943]/40 bg-[#ea3943]/5'
                : i.sev === 'warn' ? 'border-[#f0b90b]/30 bg-[#f0b90b]/5'
                  : 'border-border/50 bg-card/30')}
          >
            <span className={cn('mt-0.5 shrink-0 rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide', CAT_STYLE[i.cat])}>
              {i.cat}
            </span>
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground/90">{i.text}</p>
            <time className="shrink-0 font-mono text-[10px] text-muted-foreground">
              {new Date(i.t).toLocaleTimeString('en-GB', { hour12: false })}
            </time>
          </article>
        ))}
        {!filtered.length && (
          <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
            listening to the tape — pulls, sweeps, whales and regime shifts will appear here as they happen
          </div>
        )}
      </section>
    </div>
  )
}
