'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getStream } from '@/lib/terminal/stream-client'
import { useTerminal } from '@/lib/terminal/store'
import { symbolMeta, GREEN, RED, AMBER } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtTime, fmtUsd } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge, StatCard } from './panel-kit'
import { cn } from '@/lib/utils'
import type { L3Event, L3Type, Level } from '@/lib/terminal/types'

const WALL_MIN = [50_000, 100_000, 250_000, 1_000_000]
const TYPE_META: Record<L3Type, { label: string; color: string; desc: string }> = {
  wall: { label: 'WALL', color: AMBER, desc: 'large resting order appeared' },
  pull: { label: 'PULL', color: RED, desc: 'large order vanished without being traded (spoof-style)' },
  sweep: { label: 'SWEEP', color: GREEN, desc: 'level consumed at best price (real aggression)' },
  iceberg: { label: 'ICE', color: '#4da3ff', desc: 'level refilled repeatedly (iceberg suspicion)' },
}

interface LevelState { size: number; peak: number; firstSeen: number; peakAt: number; refills: number; lastTop: number }

/** Detect order-book liquidity events from consecutive top-20 book snapshots. */
function detect(prev: Map<string, LevelState>, bids: Level[], asks: Level[], wallMin: number, nowMs: number): { events: L3Event[]; next: Map<string, LevelState> } {
  const events: L3Event[] = []
  const next = new Map<string, LevelState>()
  const scan = (side: 'bid' | 'ask', levels: Level[], best: number | null) => {
    for (const lv of levels) {
      const notional = lv.p * lv.q
      const key = `${side}:${lv.p}`
      const cur = prev.get(key)
      if (!cur) {
        if (notional >= wallMin) {
          events.push({ id: `${key}-${nowMs}`, t: nowMs, type: 'wall', side, price: lv.p, size: lv.q, note: `appeared with ${fmtUsd(notional)}` })
        }
        next.set(key, { size: lv.q, peak: lv.q, firstSeen: nowMs, peakAt: nowMs, refills: 0, lastTop: nowMs })
        continue
      }
      const drop = cur.size > 0 ? 1 - lv.q / cur.size : 1
      const bestTouch = best != null && Math.abs(lv.p - best) < 1e-9
      if (drop >= 0.8 && notional < cur.size * lv.p * 0.2) {
        if (bestTouch) {
          events.push({ id: `${key}-sw-${nowMs}`, t: nowMs, type: 'sweep', side, price: lv.p, size: cur.size, note: `level swept at best ${side === 'bid' ? 'bid' : 'ask'}` })
          next.delete(key)
          continue
        }
        const held = nowMs - cur.peakAt
        if (held <= 12_000 && cur.peak * lv.p >= wallMin) {
          events.push({ id: `${key}-pl-${nowMs}`, t: nowMs, type: 'pull', side, price: lv.p, size: cur.peak, note: `${fmtUsd(cur.peak * lv.p)} pulled after ${(held / 1000).toFixed(0)}s` })
          next.delete(key)
          continue
        }
      }
      if (lv.q > cur.size * 1.5 && drop >= 0.5) {
        cur.refills++
        if (cur.refills >= 3) {
          events.push({ id: `${key}-ic-${nowMs}`, t: nowMs, type: 'iceberg', side, price: lv.p, size: lv.q, note: `refill #${cur.refills} at same price` })
          cur.refills = 0
        }
      }
      cur.size = lv.q
      if (lv.q > cur.peak) { cur.peak = lv.q; cur.peakAt = nowMs }
      cur.lastTop = nowMs
      next.set(key, cur)
    }
  }
  const bestBid = bids[0]?.p ?? null
  const bestAsk = asks[0]?.p ?? null
  scan('bid', bids, bestBid)
  scan('ask', asks, bestAsk)
  return { events, next }
}

export default function L3Panel() {
  const { symbol } = useTerminal()
  const metaSym = symbolMeta(symbol)
  const [wallMin, setWallMin] = useState(250_000)
  const [filter, setFilter] = useState<'all' | L3Type>('all')
  const [events, setEvents] = useState<L3Event[]>([])
  const [counts, setCounts] = useState<Record<L3Type, number>>({ wall: 0, pull: 0, sweep: 0, iceberg: 0 })
  const prevBook = useRef<{ bids: Level[]; asks: Level[]; states: Map<string, LevelState>; t: number } | null>(null)

  const resetRef = useRef({ symbol, wallMin })

  useEffect(() => {
    const id = setInterval(() => {
      const s = getStream()
      if (!s.depth) return
      // reset counters when symbol or threshold changed since the last tick
      if (resetRef.current.symbol !== symbol || resetRef.current.wallMin !== wallMin) {
        resetRef.current = { symbol, wallMin }
        setEvents([])
        setCounts({ wall: 0, pull: 0, sweep: 0, iceberg: 0 })
        prevBook.current = null
        return
      }
      const d = s.depth
      const nowMs = Date.now()
      const last = prevBook.current
      if (!last || nowMs - last.t >= 200) {
        const { events: evs, next } = detect(last?.states ?? new Map(), d.bids, d.asks, wallMin, nowMs)
        prevBook.current = { bids: d.bids, asks: d.asks, states: next, t: nowMs }
        if (evs.length) {
          setEvents((old) => [...evs.reverse(), ...old].slice(0, 200))
          setCounts((c) => {
            const n = { ...c }
            for (const e of evs) n[e.type]++
            return n
          })
        }
      }
    }, 250)
    return () => clearInterval(id)
  }, [symbol, wallMin])

  const shown = useMemo(() => (filter === 'all' ? events : events.filter((e) => e.type === filter)).slice(0, 100), [events, filter])

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-l3">
      <PanelHeader
        title="L3-style liquidity events"
        sub="Heuristics on the live top-20 book: wall appearances, spoof-style pulls, sweeps at best price, iceberg refills"
        source="Binance depth20 @100ms"
        right={
          <>
            <SourceBadge label="detected" tone="est" />
            <span className="text-[10px] text-muted-foreground">wall ≥</span>
            {WALL_MIN.map((w) => (
              <button key={w} onClick={() => setWallMin(w)}
                className={cn('rounded border px-1.5 py-1 font-mono text-[10px]', wallMin === w ? 'border-[#f0b90b]/60 bg-[#f0b90b]/15 text-[#f0b90b]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {fmtUsd(w)}
              </button>
            ))}
            <div className="flex overflow-hidden rounded-md border border-border">
              {(['all', 'wall', 'pull', 'sweep', 'iceberg'] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn('px-2 py-1 text-[10px] capitalize', filter === f ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {f === 'iceberg' ? 'ice' : f}
                </button>
              ))}
            </div>
          </>
        }
      />
      <div className="grid grid-cols-4 gap-2 border-b border-border/60 px-3 py-2">
        <StatCard label="Walls" value={counts.wall} sub="appeared in session" />
        <StatCard label="Pulls (spoof-ish)" value={counts.pull} sub="cancelled, never traded" tone="down" />
        <StatCard label="Sweeps" value={counts.sweep} sub="level consumed at best" tone="up" />
        <StatCard label="Iceberg refills" value={counts.iceberg} sub="same level refilled ≥3×" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#0d1017] text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Time</th>
              <th className="px-2 py-1.5 font-medium">Event</th>
              <th className="px-2 py-1.5 font-medium">Side</th>
              <th className="px-2 py-1.5 font-medium text-right">Price</th>
              <th className="px-2 py-1.5 font-medium text-right">Size</th>
              <th className="px-3 py-1.5 font-medium">Detail</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id + e.t} className="border-t border-border/40 hover:bg-muted/30">
                <td className="px-3 py-1 text-muted-foreground">{fmtTime(e.t)}</td>
                <td className="px-2 py-1 font-bold" style={{ color: TYPE_META[e.type].color }}>{TYPE_META[e.type].label}</td>
                <td className={cn('px-2 py-1 font-semibold', e.side === 'bid' ? 'text-[#16c784]' : 'text-[#ea3943]')}>{e.side.toUpperCase()}</td>
                <td className="px-2 py-1 text-right">{fmtPrice(e.price, metaSym.tick)}</td>
                <td className="px-2 py-1 text-right">{fmtCompact(e.size)} · {fmtUsd(e.size * e.price)}</td>
                <td className="px-3 py-1 text-[10px] text-muted-foreground">{e.note}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  No events above {fmtUsd(wallMin)} yet — detection is running on every book update.<br />
                  <span className="text-[10px]">Heuristics, not exchange-provided L3 data: a “pull” can be a legitimate cancel and “iceberg” is inferred.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
        {TYPE_META.pull.desc} · {TYPE_META.sweep.desc} · {TYPE_META.iceberg.desc}
      </div>
    </div>
  )
}
