'use client'

import { useMemo, useState } from 'react'
import { getStream } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { useTerminal } from '@/lib/terminal/store'
import { symbolMeta, GREEN, RED, AMBER } from '@/lib/terminal/constants'
import { fmtPrice, fmtTime, fmtUsd, fmtQty } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge, StatCard } from './panel-kit'
import { cn } from '@/lib/utils'
import type { L3Event, L3Type } from '@/lib/terminal/types'

const WALL_MIN = [50_000, 100_000, 250_000, 1_000_000]
const TYPE_META: Record<L3Type, { label: string; color: string; desc: string }> = {
  wall: { label: 'WALL', color: AMBER, desc: 'large resting order in the full book' },
  pull: { label: 'PULL', color: RED, desc: 'large order vanished without being traded (spoof-style)' },
  sweep: { label: 'SWEEP', color: GREEN, desc: 'level consumed at best price (real aggression)' },
  iceberg: { label: 'ICE', color: '#4da3ff', desc: 'level refilled repeatedly (iceberg suspicion)' },
}

/**
 * L3-style events come from the terminal-stream's own detector, which tracks
 * every level of the LOCAL FULL BOOK (snapshot + diff-depth) — the same
 * walls/pulls/sweeps/icebergs state the Insights feed and Signals use.
 * (The previous version re-detected events from top-20 snapshots inside the
 * panel and routinely reported zero walls while the stream's full-book
 * detector saw several — two detectors, two truths.)
 */
export default function L3Panel() {
  const { symbol } = useTerminal()
  const metaSym = symbolMeta(symbol)
  const [wallMin, setWallMin] = useState(250_000)
  const [filter, setFilter] = useState<'all' | L3Type>('all')

  const data = usePoll(() => {
    const s = getStream()
    return { walls: s.walls, pulls: s.pulls, sweeps: s.sweeps, icebergs: s.icebergs, status: s.status }
  }, 500)

  const { events, counts } = useMemo(() => {
    const evs: L3Event[] = []
    // stream WallRec.q / PullEv.size / SweepEv.size / IceEv.size are USD
    // notionals; L3Event.size is coin quantity (the table derives USD from it)
    const walls = data.walls.filter((w) => w.q >= wallMin)
    for (const w of walls) {
      evs.push({
        id: `wall-${w.side}-${w.p}`, t: w.firstSeen, type: 'wall', side: w.side, price: w.p,
        size: w.p > 0 ? w.q / w.p : 0,
        note: `resting ${fmtUsd(w.q)}${w.pulls ? ` · pulled ×${w.pulls} before` : ''}`,
      })
    }
    for (const p of data.pulls) {
      evs.push({
        id: `pull-${p.t}-${p.p}`, t: p.t, type: 'pull', side: p.side, price: p.p,
        size: p.p > 0 ? p.size / p.p : 0,
        note: `${fmtUsd(p.size)} pulled after ${(p.lasted / 1000).toFixed(0)}s${p.count > 1 ? ` (×${p.count})` : ''}`,
      })
    }
    for (const sw of data.sweeps) {
      evs.push({
        id: `sweep-${sw.t}-${sw.p}`, t: sw.t, type: 'sweep', side: sw.side, price: sw.p,
        size: sw.p > 0 ? sw.size / sw.p : 0,
        note: `level consumed · aggressive print ${fmtUsd(sw.trade)}`,
      })
    }
    for (const ic of data.icebergs) {
      evs.push({
        id: `ice-${ic.t}-${ic.p}`, t: ic.t, type: 'iceberg', side: ic.side, price: ic.p,
        size: ic.p > 0 ? ic.size / ic.p : 0,
        note: `refilled ×${ic.refills} (~${fmtUsd(ic.size)} seen)`,
      })
    }
    evs.sort((a, b) => b.t - a.t)
    return {
      events: evs.slice(0, 200),
      counts: { wall: walls.length, pull: data.pulls.length, sweep: data.sweeps.length, iceberg: data.icebergs.length },
    }
  }, [data, wallMin])

  const shown = useMemo(() => (filter === 'all' ? events : events.filter((e) => e.type === filter)).slice(0, 100), [events, filter])

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-l3">
      <PanelHeader
        title="L3-style liquidity events"
        sub="Stream detector on the full local book: resting walls, spoof-style pulls, sweeps at best price, iceberg refills"
        source="Binance spot · full book"
        right={
          <>
            <SourceBadge label={data.status === 'live' ? 'detected · live' : 'detected'} tone="est" />
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
        <StatCard label="Walls" value={counts.wall} sub={`resting now ≥ ${fmtUsd(wallMin)}`} />
        <StatCard label="Pulls (spoof-ish)" value={counts.pull} sub="cancelled, never traded" tone="down" />
        <StatCard label="Sweeps" value={counts.sweep} sub="level consumed at best" tone="up" />
        <StatCard label="Iceberg refills" value={counts.iceberg} sub="same level refilled ≥3×" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#0d1017] text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 font-medium">Time (UTC)</th>
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
                <td className="px-2 py-1 text-right">{fmtQty(e.size)} · {fmtUsd(e.size * e.price)}</td>
                <td className="px-3 py-1 text-[10px] text-muted-foreground">{e.note}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {data.status !== 'live'
                    ? 'Waiting for the live book — events appear once the stream is live.'
                    : <>No events above {fmtUsd(wallMin)} yet — the stream detector is running on every book update.<br />
                      <span className="text-[10px]">Heuristics, not exchange-provided L3 data: a “pull” can be a legitimate cancel and “iceberg” is inferred.</span></>}
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
