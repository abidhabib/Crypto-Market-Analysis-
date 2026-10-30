'use client'

/**
 * Signals — market prediction & decision panel.
 * Combines trend regime, aggressive flow, book pressure, volatility and
 * flow-toxicity into an ARMED / WAIT / PAUSED decision with a transparent
 * checklist, plus every diagnostic reading behind it.
 */

import { useTerminal } from '@/lib/terminal/store'
import { getStream } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { metaFor } from '@/lib/terminal/constants'
import { signal, regime, flow, book, toxicity, levels, type Signal, type Regime, type Flow, type BookRead, type Tox, type Levels } from '@/lib/terminal/analytics'
import { fmtPrice, fmtCompact, fmtSigned } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge, Meter, StatCard } from './panel-kit'
import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, MinusCircle, Crosshair, TrendingUp, TrendingDown, Scale } from 'lucide-react'

interface Reads { sig: Signal | null; r: Regime | null; f: Flow | null; b: BookRead | null; tox: Tox | null; l: Levels | null }

export default function SignalsPanel() {
  const { symbol } = useTerminal()
  const meta = metaFor(symbol)
  const beat = usePoll(() => getStream().lastMsgAt, 1000)
  const reads: Reads = {
    sig: signal(),
    r: regime(),
    f: flow(),
    b: book(),
    tox: toxicity(),
    l: levels(),
  }
  const { sig, r, f, b, tox, l } = reads
  const mid = r?.price ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="panel-signals">
      <PanelHeader
        title="Signals — market prediction"
        sub="Trend, flow, book pressure and toxicity distilled into one decision · checklist shows exactly what confirms or blocks it"
        source="computed live · 1s"
        right={<SourceBadge label={beat ? 'LIVE' : 'SYNCING'} tone={beat ? 'live' : 'est'} />}
      />

      <div className="grid grid-cols-1 gap-3 p-3 xl:grid-cols-3">
        {/* -------- decision card -------- */}
        <section className="rounded-lg border border-border/60 bg-card/40 p-4 xl:col-span-1" aria-label="Decision">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Decision</span>
            {sig && (
              <span className={cn('rounded px-2 py-0.5 font-mono text-[11px] font-bold',
                sig.state === 'ARMED' && 'bg-[#16c784]/15 text-[#16c784]',
                sig.state === 'WAIT' && 'bg-[#f0b90b]/15 text-[#f0b90b]',
                sig.state === 'PAUSED' && 'bg-muted text-muted-foreground')}>
                {sig.state}
              </span>
            )}
          </div>

          {sig && (
            <>
              <div className="mt-2 flex items-center gap-2">
                {sig.direction === 'long' && <TrendingUp className="size-5 text-[#16c784]" />}
                {sig.direction === 'short' && <TrendingDown className="size-5 text-[#ea3943]" />}
                {!sig.direction && <Scale className="size-5 text-muted-foreground" />}
                <span className={cn('font-mono text-xl font-bold',
                  sig.direction === 'long' && 'text-[#16c784]',
                  sig.direction === 'short' && 'text-[#ea3943]',
                  !sig.direction && 'text-muted-foreground')}>
                  {sig.direction ? sig.direction.toUpperCase() : 'FLAT'}
                </span>
                {sig.state !== 'PAUSED' && (
                  <span className="ml-auto font-mono text-xs text-muted-foreground">{sig.passedCount}/{sig.total} conditions</span>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-foreground/90">{sig.verdict}</p>

              {sig.total > 0 && sig.state !== 'PAUSED' && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500',
                      sig.passedCount === sig.total ? 'bg-[#16c784]' : 'bg-[#f0b90b]')}
                    style={{ width: `${(sig.passedCount / sig.total) * 100}%` }}
                  />
                </div>
              )}

              <div className="mt-3 space-y-2">
                {sig.checklist.map((c) => (
                  <div key={c.label} className="rounded-md border border-border/50 bg-background/40 px-2.5 py-2">
                    <div className="flex items-center gap-2 text-[11px]">
                      {sig.state === 'PAUSED'
                        ? <MinusCircle className="size-3.5 shrink-0 text-muted-foreground" />
                        : c.pass ? <CheckCircle2 className="size-3.5 shrink-0 text-[#16c784]" /> : <XCircle className="size-3.5 shrink-0 text-[#ea3943]" />}
                      <span className="font-medium">{c.label}</span>
                      <span className="ml-auto font-mono tabular-nums">{c.value}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">{c.need}</span>
                    </div>
                    <div className="mt-1 pl-5.5 text-[10px] leading-snug text-muted-foreground">{c.hint}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* -------- regime + volatility -------- */}
        <section className="space-y-3" aria-label="Trend and volatility">
          <div className="rounded-lg border border-border/60 bg-card/40 p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Trend regime</div>
            {r ? (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-lg font-bold">{r.label}</span>
                </div>
                <div className="mt-3">
                  <Meter
                    label="Strength"
                    value={r.strength * 2 - 100}
                    display={`${r.strength}/100`}
                    tone={r.strength >= 60 ? 'up' : r.strength <= 40 ? 'down' : 'neutral'}
                    note="EMA-structure consistency on the 15m chart · ≥22 needed to trust a direction"
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatCard label="RSI · 1m" value={r.rsi1m.toFixed(1)} tone={r.rsi1m >= 70 ? 'up' : r.rsi1m <= 30 ? 'down' : 'neutral'} sub={r.rsi1m >= 70 ? 'overbought stretch' : r.rsi1m <= 30 ? 'oversold stretch' : 'neutral band'} />
                  <StatCard label="RSI · 15m" value={r.rsi15m.toFixed(1)} tone={r.rsi15m >= 70 ? 'up' : r.rsi15m <= 30 ? 'down' : 'neutral'} />
                  <StatCard label="ATR (1m)" value={`${r.atrPct.toFixed(3)}%`} sub={`${r.volPctile.toFixed(0)}th percentile · ${r.volLabel}`} />
                  <StatCard label="Price vs EMA50" value={fmtSigned(((mid - r.ema50_1m) / r.ema50_1m) * 100, 2) + '%'} tone={mid >= r.ema50_1m ? 'up' : 'down'} sub={`EMA21 ${fmtPrice(r.ema21_1m, meta.tick)}`} />
                </div>
              </>
            ) : <p className="mt-2 text-xs text-muted-foreground">warming up — needs ~60 minutes of 1m candles</p>}
          </div>

          {/* toxicity */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Flow toxicity (VPIN-style)</div>
            {tox ? (
              <>
                <div className="mt-1 font-mono text-lg font-bold">{(tox.value * 100).toFixed(1)}% <span className={cn('ml-1 rounded px-1.5 py-0.5 text-[10px]',
                  tox.pctile >= 90 ? 'bg-[#ea3943]/15 text-[#ea3943]' : tox.pctile >= 70 ? 'bg-[#f0b90b]/15 text-[#f0b90b]' : 'bg-[#16c784]/15 text-[#16c784]')}>{tox.label}</span></div>
                <div className="mt-2">
                  <Meter
                    label="Percentile vs last hour"
                    value={tox.pctile * 2 - 100}
                    display={`${tox.pctile.toFixed(0)}th`}
                    tone={tox.pctile >= 90 ? 'down' : tox.pctile >= 70 ? 'neutral' : 'up'}
                    note="order-flow imbalance concentration — toxic flow means informed aggressors hunting resting liquidity"
                  />
                </div>
              </>
            ) : <p className="mt-2 text-xs text-muted-foreground">needs ~200 recent prints</p>}
          </div>
        </section>

        {/* -------- flow + book -------- */}
        <section className="space-y-3" aria-label="Flow and book">
          <div className="rounded-lg border border-border/60 bg-card/40 p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Aggressive flow</div>
            {f ? (
              <>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <StatCard label="CVD session" value={fmtCompact(f.cvdSession, '$')} tone={f.cvdSession >= 0 ? 'up' : 'down'} />
                  <StatCard label="CVD 30m" value={fmtCompact(f.cvd30m, '$')} tone={f.cvd30m >= 0 ? 'up' : 'down'} />
                  <StatCard label="CVD 5m" value={fmtCompact(f.cvd5m, '$')} tone={f.cvd5m >= 0 ? 'up' : 'down'} />
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  <Meter
                    label="Buyer share · 1m" value={(f.buyer1m * 2 - 1) * 100}
                    display={`${(f.buyer1m * 100).toFixed(0)}%`}
                    tone={f.buyer1m >= 0.55 ? 'up' : f.buyer1m <= 0.45 ? 'down' : 'neutral'}
                    note="taker-buys as a share of the last 60s of volume"
                  />
                  <Meter
                    label="Trade driver · 15m" value={(f.driver15m * 2 - 1) * 100}
                    display={`${(f.driver15m * 100).toFixed(0)}%`}
                    tone={f.driver15m >= 0.55 ? 'up' : f.driver15m <= 0.45 ? 'down' : 'neutral'}
                    note="≥55% in one direction is a meaningful tilt"
                  />
                  <StatCard
                    label="Buy burst · 10s"
                    value={`${f.burst10s.toFixed(1)}×`}
                    tone={f.burst10s > 3 ? 'up' : 'neutral'}
                    sub={f.burst10s > 3 ? `${fmtCompact(f.burstUsd, '$')} aggressive buying — burst!` : 'no burst vs 5m average'}
                  />
                </div>
              </>
            ) : <p className="mt-2 text-xs text-muted-foreground">waiting for prints…</p>}
          </div>

          <div className="rounded-lg border border-border/60 bg-card/40 p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Book pressure</div>
            {b ? (
              <>
                <div className="mt-2">
                  <Meter
                    label="Imbalance ±0.25%" value={b.imbalance}
                    display={`${b.imbalance >= 0 ? '+' : ''}${b.imbalance.toFixed(0)}%`}
                    tone={b.imbalance > 8 ? 'up' : b.imbalance < -8 ? 'down' : 'neutral'}
                    note={`bids ${fmtCompact(b.bidNot, '$')} vs asks ${fmtCompact(b.askNot, '$')} resting near mid`}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <StatCard label="Spread" value={`${b.spreadTicks} tick${b.spreadTicks === 1 ? '' : 's'}`} sub={fmtPrice(b.spreadTicks * meta.tick, meta.tick)} />
                  <StatCard label="Walls tracked" value={String(b.walls.length)} sub="levels ≥ adaptive threshold" />
                </div>
              </>
            ) : <p className="mt-2 text-xs text-muted-foreground">order book syncing…</p>}
          </div>
        </section>
      </div>

      {/* -------- levels strip -------- */}
      <section className="mx-3 mb-3 rounded-lg border border-border/60 bg-card/40 p-4" aria-label="Key levels">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Crosshair className="size-3.5" /> Decision levels
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <StatCard label={`Buy above (${l?.buyAboveSrc ?? '—'})`} value={fmtPrice(l?.buyAbove, meta.tick)} tone="up" sub={l?.buyAbove ? `${(((l.buyAbove - mid) / mid) * 10000).toFixed(1)} bp away` : '—'} />
          <StatCard label={`Sell below (${l?.sellBelowSrc ?? '—'})`} value={fmtPrice(l?.sellBelow, meta.tick)} tone="down" sub={l?.sellBelow ? `${(((mid - l.sellBelow) / mid) * 10000).toFixed(1)} bp away` : '—'} />
          <StatCard label="POC (4h)" value={fmtPrice(l?.poc, meta.tick)} sub="highest-volume price" />
          <StatCard label="Value area" value={`${fmtPrice(l?.val, meta.tick)} – ${fmtPrice(l?.vah, meta.tick)}`} sub="70% of 4h volume" />
          <StatCard label="24h high" value={fmtPrice(l?.sessionHigh, meta.tick)} />
          <StatCard label="24h low" value={fmtPrice(l?.sessionLow, meta.tick)} />
          <StatCard label="R/R to levels" value={sig?.rr != null ? sig.rr.toFixed(2) : '—'} tone={(sig?.rr ?? 0) >= 1.1 ? 'up' : 'neutral'} sub="after spread + fees" />
        </div>
        {(l?.wallsAbove.length || l?.wallsBelow.length) ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {l?.wallsBelow.slice(0, 4).map((w) => (
              <span key={`b${w.p}`} className="rounded border border-[#16c784]/30 bg-[#16c784]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#16c784]">
                bid {fmtCompact(w.q, '$')} @ {fmtPrice(w.p, meta.tick)}
              </span>
            ))}
            {l?.wallsAbove.slice(0, 4).map((w) => (
              <span key={`a${w.p}`} className="rounded border border-[#ea3943]/30 bg-[#ea3943]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#ea3943]">
                ask {fmtCompact(w.q, '$')} @ {fmtPrice(w.p, meta.tick)}
              </span>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  )
}
