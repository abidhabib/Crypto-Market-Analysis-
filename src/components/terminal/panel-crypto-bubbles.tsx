'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fmtCompact, fmtPct, fmtPrice } from '@/lib/terminal/format'
import { normalizeMarketRows, bubbleDiameter, type BubbleRow } from '@/lib/terminal/bubbles-model'
import { cn } from '@/lib/utils'

/**
 * Crypto Bubbles — native panel fed by /api/market (Binance spot 24h stats).
 * The previous version embedded cryptobubbles.net in an iframe; that site
 * refuses framing, so the tab rendered permanently blank. Bubble area is
 * proportional to 24h quote volume; colour encodes 24h % change.
 *
 * The panel always shows one of: loading, error (with retry), empty, or
 * the bubbles — never a silent black box. Rows are normalized through
 * bubbles-model (any payload shape, NaN-guarded sizes). A timed-out fetch
 * is retried once automatically; a payload the route marks stale
 * (x-market-stale) is rendered with a "stale" note, not as fresh data.
 */

export default function CryptoBubblesPanel() {
  const [rows, setRows] = useState<BubbleRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [asOf, setAsOf] = useState(0)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)

  const load = useCallback(async () => {
    setLoading(true)
    const attempt = async () => {
      const res = await fetch('/api/market', { cache: 'no-store', signal: AbortSignal.timeout(25_000) })
      const json: unknown = await res.json().catch(() => null)
      if (!res.ok) {
        const msg = (json as { error?: string } | null)?.error
        throw new Error(msg ?? `HTTP ${res.status}`)
      }
      const normalized = normalizeMarketRows(json)
      if (!normalized.length) throw new Error('market route returned no usable pairs')
      const asOfHdr = Number(res.headers.get('x-market-as-of'))
      return {
        rows: normalized,
        stale: res.headers.get('x-market-stale') === '1',
        asOf: isFinite(asOfHdr) && asOfHdr > 0 ? asOfHdr : Date.now(),
      }
    }
    try {
      let out: Awaited<ReturnType<typeof attempt>>
      try {
        out = await attempt()
      } catch (e) {
        // A slow route gets exactly one automatic retry after a short pause
        // before the error state is shown; other failures surface at once.
        if (!(e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError'))) throw e
        await new Promise((r) => setTimeout(r, 1_500))
        if (!alive.current) return
        out = await attempt()
      }
      if (!alive.current) return
      setRows(out.rows)
      setStale(out.stale)
      setErr(null)
      setAsOf(out.asOf)
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
    <div className="flex h-full min-h-0 flex-col bg-[#111318]" data-testid="panel-bubbles" data-count={rows?.length ?? 0}>
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
        {stale && rows && (
          <div className="mb-2 rounded border border-[#f0b90b]/40 bg-[#f0b90b]/10 px-3 py-1.5 text-[11px] text-muted-foreground" role="status">
            Stale snapshot — live refresh is struggling; showing market data from {new Date(asOf).toISOString().slice(11, 19)} UTC.
          </div>
        )}
        {!rows && !err && (
          <div className="mt-10 text-center text-xs text-muted-foreground" role="status">
            <RefreshCw className="mr-1.5 inline size-3 animate-spin" /> Loading market bubbles…
          </div>
        )}
        {rows && rows.length === 0 && !err && (
          <div className="mt-10 text-center text-xs text-muted-foreground" role="status">No pairs returned by the market route.</div>
        )}
        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {rows.map((r) => {
              const d = bubbleDiameter(r.q, maxQ)
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
