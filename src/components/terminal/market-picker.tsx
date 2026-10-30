'use client'

/**
 * Market picker — "Pick a Market" scanner.
 * All Binance-spot USDT pairs with 24h stats, sortable columns, range bars,
 * sparklines, watchlist and 5s live refresh. Picking a row switches the
 * whole terminal to that symbol.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useTerminal } from '@/lib/terminal/store'
import { metaFor, setTickOverride, heuristicTick } from '@/lib/terminal/constants'
import { fmtPrice, fmtPct, fmtCompact } from '@/lib/terminal/format'
import { cn } from '@/lib/utils'
import { Search, Star, ArrowUpDown, RefreshCw, Loader2 } from 'lucide-react'

interface Row {
  s: string; c: number; P: number; h: number; l: number; o: number
  q: number; v: number; n: number; b: number; a: number
}

type FilterId = 'all' | 'gainers' | 'losers' | 'active' | 'watch'
type SortKey = 'q' | 'c' | 'P' | 'n' | 'spread' | 's'

const WATCH_KEY = 'of.watchlist'

function loadWatch(): string[] {
  try { return JSON.parse(localStorage.getItem(WATCH_KEY) ?? '[]') as string[] } catch { return [] }
}

export default function MarketPicker() {
  const { scannerOpen, setScannerOpen, symbol, setSymbol } = useTerminal()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterId>('all')
  const [sortKey, setSortKey] = useState<SortKey>('q')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [watch, setWatch] = useState<string[]>([])
  const [sparks, setSparks] = useState<Record<string, number[]>>({})
  const [updated, setUpdated] = useState(0)
  const watchRef = useRef<string[]>([])
  watchRef.current = watch

  useEffect(() => { if (scannerOpen) setWatch(loadWatch()) }, [scannerOpen])

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/market', { cache: 'no-store' })
      const data = await res.json()
      if (Array.isArray(data)) { setRows(data); setError(null); setUpdated(Date.now()) }
      else setError(data?.error ?? 'failed to load')
    } catch {
      setError('market data unreachable')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!scannerOpen) return
    void fetchRows()
    const id = setInterval(fetchRows, 5_000)
    return () => clearInterval(id)
  }, [scannerOpen, fetchRows])

  // sparklines for watchlist + top volume rows
  useEffect(() => {
    if (!scannerOpen || !rows.length) return
    const tops = rows.slice(0, 8).map((r) => r.s)
    const syms = [...new Set([...watchRef.current, ...tops])].slice(0, 12)
    const key = syms.join(',')
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/market?sparks=${key}`, { cache: 'no-store' })
        if (res.ok) setSparks(await res.json())
      } catch { /* ignore */ }
    }, 120)
    return () => clearTimeout(id)
  }, [scannerOpen, rows, updated])

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    let list = rows
    if (q) list = list.filter((r) => r.s.includes(q))
    if (filter === 'gainers') list = list.filter((r) => r.P > 0)
    if (filter === 'losers') list = list.filter((r) => r.P < 0)
    if (filter === 'watch') list = list.filter((r) => watch.includes(r.s))
    const dir = sortDir
    const cmp: Record<SortKey, (a: Row, b: Row) => number> = {
      q: (a, b) => (a.q - b.q) * dir,
      c: (a, b) => (a.c - b.c) * dir,
      P: (a, b) => (a.P - b.P) * dir,
      n: (a, b) => (a.n - b.n) * dir,
      spread: (a, b) => (((a.a - a.b) / Math.max(1e-9, a.c)) - ((b.a - b.b) / Math.max(1e-9, b.c))) * dir,
      s: (a, b) => a.s.localeCompare(b.s) * (dir === 1 ? 1 : -1),
    }
    return [...list].sort(cmp[sortKey])
  }, [rows, query, filter, sortKey, sortDir, watch])

  function pick(s: string) {
    setSymbol(s)
    // refine tick size in the background so every panel uses exact precision
    void fetch(`/api/symbol-info?symbol=${s}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.tick) setTickOverride(s, d.tick) })
      .catch(() => { /* heuristic fallback stays */ })
    setScannerOpen(false)
  }

  function toggleWatch(s: string) {
    const next = watch.includes(s) ? watch.filter((x) => x !== s) : [...watch, s]
    setWatch(next)
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  function header(key: SortKey, label: string, cls?: string) {
    return (
      <th className={cn('select-none px-2 py-1.5 text-right font-medium', cls)}>
        <button
          className="inline-flex items-center gap-0.5 hover:text-foreground"
          onClick={() => { if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(key); setSortDir(key === 's' ? 1 : -1) } }}
        >
          {label}
          <ArrowUpDown className={cn('size-3', sortKey === key ? 'text-[#4da3ff]' : 'text-muted-foreground/50')} />
        </button>
      </th>
    )
  }

  const meta = metaFor(symbol)

  return (
    <Dialog open={scannerOpen} onOpenChange={setScannerOpen}>
      <DialogContent
        className="dark flex h-[82vh] flex-col gap-0 overflow-hidden bg-[#0d1017] p-0 text-foreground sm:rounded-lg"
        style={{ width: 'min(96vw, 1080px)', maxWidth: '1080px' }}
      >
        <DialogHeader className="border-b border-border/60 px-4 py-3">
          <DialogTitle className="text-sm">Pick a Market <span className="font-normal text-muted-foreground">— USDT pairs on Binance Spot</span></DialogTitle>
          <DialogDescription className="text-[11px]">
            24h stats for the top 150 pairs by quote volume · refreshes every 5s · click a row to load it across every panel
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pair…"
              className="h-8 w-44 rounded-md border border-border bg-background pl-7 pr-2 font-mono text-xs outline-none focus:border-[#4da3ff]/60"
            />
          </div>
          {([
            ['all', 'All'],
            ['gainers', 'Gainers'],
            ['losers', 'Losers'],
            ['active', 'Most active'],
            ['watch', `Watchlist${watch.length ? ` (${watch.length})` : ''}`],
          ] as [FilterId, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={cn('rounded border px-2 py-1 text-[11px]',
                filter === id ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}
            >
              {label}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
            {loading && <Loader2 className="size-3 animate-spin" />}
            {updated ? `updated ${new Date(updated).toLocaleTimeString('en-GB', { hour12: false })}` : ''}
            <button onClick={fetchRows} className="rounded border border-border p-1 hover:text-foreground" aria-label="Refresh now">
              <RefreshCw className="size-3" />
            </button>
          </span>
        </div>

        {error && (
          <div className="px-4 py-3 text-xs text-[#ea3943]">{error}</div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[960px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-[#10141d] text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/60">
                <th className="w-8 px-2 py-1.5" />
                {header('s', 'Symbol', 'text-left')}
                {header('c', 'Last price')}
                {header('P', '24h %')}
                <th className="px-2 py-1.5 text-left font-medium">24h range</th>
                {header('q', '24h volume')}
                {header('n', 'Trades')}
                {header('spread', 'Spread')}
                <th className="px-2 py-1.5 text-left font-medium">15m ×32</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const base = r.s.slice(0, -4)
                const lo = Math.min(r.l, r.c), hi = Math.max(r.h, r.c)
                const pos = hi > lo ? ((r.c - lo) / (hi - lo)) * 100 : 50
                const spreadBps = r.c > 0 ? ((r.a - r.b) / r.c) * 10_000 : 0
                const spark = sparks[r.s]
                const isCur = r.s === symbol
                return (
                  <tr
                    key={r.s}
                    onClick={() => pick(r.s)}
                    className={cn('cursor-pointer border-b border-border/30 hover:bg-muted/40', isCur && 'bg-[#4da3ff]/10')}
                  >
                    <td className="px-2 py-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleWatch(r.s) }}
                        aria-label={watch.includes(r.s) ? `Remove ${r.s} from watchlist` : `Add ${r.s} to watchlist`}
                      >
                        <Star className={cn('size-3.5', watch.includes(r.s) ? 'fill-[#f0b90b] text-[#f0b90b]' : 'text-muted-foreground/40')} />
                      </button>
                    </td>
                    <td className="px-2 py-1.5 font-mono font-semibold text-foreground">
                      {base}<span className="text-muted-foreground">/USDT</span>
                      {isCur && <span className="ml-1.5 rounded bg-[#4da3ff]/20 px-1 text-[9px] text-[#4da3ff]">active</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">
                      {fmtPrice(r.c, metaFor(r.s, r.c).tick)}
                    </td>
                    <td className={cn('px-2 py-1.5 text-right font-mono font-semibold tabular-nums', r.P >= 0 ? 'text-[#16c784]' : 'text-[#ea3943]')}>
                      {fmtPct(r.P)}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="relative h-1.5 w-20 rounded-full bg-muted">
                        <div className="absolute inset-y-0 left-0 rounded-full bg-[#16c784]/25" style={{ width: `${Math.min(100, pos)}%` }} />
                        <div className="absolute inset-y-0 right-0 rounded-full bg-[#ea3943]/25" style={{ width: `${Math.max(0, 100 - pos)}%` }} />
                        <div className="absolute top-[-2px] h-2.5 w-0.5 bg-foreground" style={{ left: `${Math.min(99, Math.max(0, pos))}%` }} />
                      </div>
                      <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted-foreground">
                        <span>{fmtPrice(r.l, heuristicTick(r.c))}</span>
                        <span>{fmtPrice(r.h, heuristicTick(r.c))}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtCompact(r.q, '$')}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmtCompact(r.n)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{spreadBps.toFixed(1)} bp</td>
                    <td className="px-2 py-1">
                      {spark && spark.length > 2 ? <Spark data={spark} up={spark[spark.length - 1] >= spark[0]} /> : <span className="text-[9px] text-muted-foreground/50">—</span>}
                    </td>
                  </tr>
                )
              })}
              {!visible.length && !loading && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">no pairs match</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
          now viewing <span className="font-mono font-semibold text-foreground">{meta.label}</span> · click any row to switch · star rows to pin them to your watchlist
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Spark({ data, up }: { data: number[]; up: boolean }) {
  const w = 72, h = 20
  const lo = Math.min(...data), hi = Math.max(...data)
  const rng = hi - lo || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - lo) / rng) * (h - 2) - 1}`).join(' ')
  const color = up ? '#16c784' : '#ea3943'
  return (
    <svg width={w} height={h} className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" />
    </svg>
  )
}
