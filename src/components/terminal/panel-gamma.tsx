'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTerminal } from '@/lib/terminal/store'
import { symbolMeta } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtUsd, fmtClock } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge, StatCard, AsOf } from './panel-kit'
import { cn } from '@/lib/utils'
import type { GammaData } from '@/lib/terminal/types'

export default function GammaPanel() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)
  const currency = symbol.replace('USDT', '')
  const [data, setData] = useState<GammaData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [expiryIdx, setExpiryIdx] = useState(0)
  const [mode, setMode] = useState<'per' | 'cum'>('per')

  const unsupported = !['BTC', 'ETH', 'SOL'].includes(currency)

  useEffect(() => {
    if (unsupported) return
    let alive = true
    fetch(`/api/gamma?currency=${currency}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive) { if (j.error) setErr(j.error); else { setData(j); setErr(null); setExpiryIdx(0) } } })
      .catch(() => alive && setErr('fetch failed'))
    const id = setInterval(() => {
      fetch(`/api/gamma?currency=${currency}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (alive && !j.error) { setData(j); setErr(null) } })
        .catch(() => {})
    }, 120_000)
    return () => { alive = false; clearInterval(id) }
  }, [currency, unsupported])

  const detail = useMemo(() => data?.details?.[Math.min(expiryIdx, (data?.details?.length ?? 1) - 1)], [data, expiryIdx])

  const maxAbs = useMemo(() => {
    if (!detail) return 1
    if (mode === 'per') return Math.max(...detail.strikes.map((s) => Math.abs(s.gex)), 0.0001)
    return Math.max(...detail.cum.map((c) => Math.abs(c.cum)), 0.0001)
  }, [detail, mode])

  if (unsupported) {
    return (
      <Shell>
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Options gamma data (Deribit) is available for BTC, ETH and SOL. Switch the symbol selector to one of those.
        </div>
      </Shell>
    )
  }

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-gamma">
      <PanelHeader
        title="Gamma levels"
        sub="Dealer gamma exposure from Deribit options OI · calls shaded green, puts red · flip = zero-gamma level"
        source="Deribit · computed"
        right={
          <>
            <div className="flex overflow-hidden rounded-md border border-border">
              {(['per', 'cum'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={cn('px-2 py-1 text-[10px]', mode === m ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {m === 'per' ? 'GEX / strike' : 'Cumulative'}
                </button>
              ))}
            </div>
            {data && (
              <select value={expiryIdx} onChange={(e) => setExpiryIdx(+e.target.value)}
                className="rounded border border-border bg-background px-1.5 py-1 text-[10px]">
                {data.expiries.slice(0, 3).map((e, i) => (
                  <option key={e.expiry} value={i}>{new Date(e.expiry).toUTCString().slice(5, 11)} · {e.dte.toFixed(1)}d</option>
                ))}
              </select>
            )}
            <AsOf ts={data?.asOf} />
          </>
        }
      />
      {!data && !err && (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">Loading option chain…</div>
      )}
      {err && err !== 'unsupported' && (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-sm rounded-md border border-[#ea3943]/40 bg-[#ea3943]/10 p-4 text-center text-xs text-muted-foreground">
            Options data unavailable: {err}. The panel retries on the next refresh — no simulated numbers are shown here.
          </div>
        </div>
      )}
      {detail && data && (
        <>
          <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Spot (underlying)" value={fmtPrice(data.spot, meta.tick)} />
            <StatCard label="Max pain" value={detail.maxPain != null ? fmtPrice(detail.maxPain, meta.tick) : '—'} sub="min payout to holders" />
            <StatCard label="Zero-gamma flip" value={detail.flip != null ? fmtPrice(detail.flip, meta.tick) : '—'} sub={detail.netGex >= 0 ? 'net positive gamma' : 'net negative gamma'} tone={detail.netGex >= 0 ? 'up' : 'down'} />
            <StatCard label="Top wall" value={detail.walls[0] ? `${fmtPrice(detail.walls[0].strike, meta.tick)} ${detail.walls[0].side}` : '—'} sub={detail.walls[0] ? fmtUsd(detail.walls[0].gex) : undefined} />
            <StatCard label="Net GEX / 1%" value={fmtUsd(detail.netGex)} tone={detail.netGex >= 0 ? 'up' : 'down'} />
            <StatCard label="PCR (OI)" value={detail.totalPutOi > 0 ? (detail.totalCallOi / detail.totalPutOi).toFixed(2) : '—'} sub={`C ${fmtCompact(detail.totalCallOi)} · P ${fmtCompact(detail.totalPutOi)}`} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            <div className="space-y-1.5">
              {[...detail.strikes].reverse().map((s) => {
                const val = mode === 'per' ? s.gex : (detail.cum.find((c) => c.strike === s.strike)?.cum ?? 0)
                const pct = (Math.abs(val) / maxAbs) * 50
                const isSpot = Math.abs(s.strike - data.spot) < (detail.strikes[1]?.strike ?? 1000) / 2
                const isFlip = detail.flip === s.strike
                const isPain = detail.maxPain === s.strike
                const isWall = detail.walls.some((w) => w.strike === s.strike)
                return (
                  <div key={s.strike} className="relative flex h-[18px] items-center">
                    <div className="flex h-full w-[calc(50%-4.5rem)] items-center justify-end">
                      {val < 0 && (
                        <div className="h-[12px] rounded-l bg-[#ea3943]/70" style={{ width: `${pct}%` }} />
                      )}
                    </div>
                    <div className="z-10 w-24 shrink-0 text-center font-mono text-[10px]">
                      <span className={cn('rounded px-1 py-0.5', isSpot ? 'bg-[#4da3ff]/20 font-bold text-[#4da3ff]' : 'text-muted-foreground')}>
                        {fmtPrice(s.strike, meta.tick)}
                      </span>
                      {isFlip && <span className="ml-1 rounded bg-[#f0b90b]/20 px-1 text-[8px] font-bold text-[#f0b90b]">FLIP</span>}
                      {isPain && <span className="ml-1 rounded bg-muted px-1 text-[8px] font-bold">PAIN</span>}
                      {isWall && !isFlip && !isPain && <span className="ml-1 rounded bg-muted px-1 text-[8px] font-bold text-foreground">WALL</span>}
                    </div>
                    <div className="flex h-full w-[calc(50%-4.5rem)] items-center">
                      {val > 0 && (
                        <div className="h-[12px] rounded-r bg-[#16c784]/70" style={{ width: `${pct}%` }} />
                      )}
                      <span className="ml-2 font-mono text-[9px] text-muted-foreground">
                        C {fmtCompact(s.callGex)} · P {fmtCompact(s.putGex)} · OI {fmtCompact(s.callOi + s.putOi)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 rounded-md border border-border/60 bg-card/50 p-2.5 text-[10px] leading-relaxed text-muted-foreground">
              <div className="mb-1 font-semibold text-foreground">Method & assumptions</div>
              Gamma per option = Black-76 gamma on the Deribit forward, σ = mark IV, T = time to 08:00 UTC settlement.
              GEX per 1% spot move = γ × OI × F² × 0.01. Dealer positioning assumes customers net-long calls / net-short puts
              (dealers +gamma on calls, −gamma on puts). Zero-gamma flip is the strike where cumulative GEX changes sign.
              Max pain is the settlement strike minimising total option payout at this expiry. Not investment advice.
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-gamma">
      <PanelHeader title="Gamma levels" sub="Options walls, zero-gamma flip, max pain" source="Deribit · computed" />
      {children}
    </div>
  )
}
