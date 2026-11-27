'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/terminal/format'
import { cn } from '@/lib/utils'

/**
 * Crypto Bubbles — native panel fed by /api/market (Binance spot 24h stats).
 * The previous version embedded cryptobubbles.net in an iframe; that site
 * refuses framing, so the tab rendered permanently blank. Bubble area is
 * proportional to 24h quote volume; colour encodes 24h % change.
 */

interface Row { s: string; c: number; P: number; h: number; l: number; o: number; q: number; v: number }

export default function CryptoBubblesPanel() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [asOf, setAsOf] = useState(0)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/market', { cache: 'no-store' })
      const json = await res.json()
      if (!alive.current) return
      if (!res.ok || !Array.isArray(json)) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setRows(json as Row[])
      setErr(null)
      setAsOf(Date.now())
    } catch (e) {
      if (!alive.current) return
      setErr(e instanceof Error ? e.message : 'market data unavailable')
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    load()
    const id = setInterval(load, 30_000)
    return () => { alive.current = false; clearInterval(id) }
  }, [load])

  const maxQ = rows?.reduce((a, r) => Math.max(a, r.q), 0) ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#111318]" data-testid="panel-bubbles">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-1.5 text-xs">
        <span className="text-muted-foreground">
          Top USDT pairs by 24h volume · bubble size = 24h quote volume · colour = 24h change
          {asOf > 0 && <span className="ml-2 font-mono text-[10px]">updated {new Date(asOf).toISOString().slice(11, 19)} UTC</span>}
        </span>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Reload Crypto Bubbles"
        >
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} /> Reload
        </button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-3">
        {err && !rows && (
          <div className="mx-auto mt-10 max-w-md rounded-md border border-[#ea3943]/40 bg-[#ea3943]/10 p-4 text-center text-xs text-muted-foreground" role="alert">
            Market data unavailable: {err}. Check the connection and press Reload — no placeholder bubbles are shown.
          </div>
        )}
        {err && rows && (
          <div className="mb-2 rounded border border-[#f0b90b]/40 bg-[#f0b90b]/10 px-3 py-1.5 text-[11px] text-muted-foreground" role="alert">
            Refresh failed ({err}) — showing the last good snapshot.
          </div>
        )}
        {!rows && !err && (
          <div className="mt-10 text-center text-xs text-muted-foreground" role="status">Loading market bubbles…</div>
        )}
        {rows && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {rows.map((r) => {
              const d = Math.round(46 + Math.sqrt(r.q / (maxQ || 1)) * 118)
              const up = r.P >= 0
              const intensity = Math.min(0.85, 0.25 + Math.abs(r.P) / 12)
              const base = r.s.replace('USDT', '')
              return (
                <div
                  key={r.s}
                  title={`${base}/USDT · last ${fmtPrice(r.c, r.c >= 1 ? 0.01 : 0.0001)} · 24h vol ${fmtCompact(r.q, '$')} · range ${fmtPrice(r.l, r.c >= 1 ? 0.01 : 0.0001)} – ${fmtPrice(r.h, r.c >= 1 ? 0.01 : 0.0001)}`}
                  className="flex shrink-0 flex-col items-center justify-center rounded-full border text-center"
                  style={{
                    width: d, height: d,
                    background: up ? `rgba(22,199,132,${intensity * 0.35})` : `rgba(234,57,67,${intensity * 0.35})`,
                    borderColor: up ? `rgba(22,199,132,${intensity})` : `rgba(234,57,67,${intensity})`,
                  }}
                >
                  <span className="font-mono font-bold leading-none" style={{ fontSize: Math.max(9, d * 0.16) }}>{base}</span>
                  <span className={cn('font-mono leading-tight', up ? 'text-[#16c784]' : 'text-[#ea3943]')} style={{ fontSize: Math.max(8, d * 0.13) }}>
                    {fmtPct(r.P, 1)}
                  </span>
                  {d >= 92 && <span className="font-mono text-[9px] leading-tight text-muted-foreground">{fmtCompact(r.q, '$')}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
