'use client'

import { useEffect, useRef, useState } from 'react'
import { getStream, now } from '@/lib/terminal/stream-client'
import { usePoll, useRaf, useCanvasSize } from '@/lib/terminal/hooks'
import { useTerminal } from '@/lib/terminal/store'
import { symbolMeta, GREEN, RED, TEXT_DIM } from '@/lib/terminal/constants'
import { fmtCompact, fmtPrice, fmtUsd } from '@/lib/terminal/format'
import { valueArea } from '@/lib/terminal/indicators'
import { PanelHeader, StatCard } from './panel-kit'
import { cn } from '@/lib/utils'
import type { Trade } from '@/lib/terminal/types'

const BG = '#0b0d12'
const LOOKBACKS = [
  { label: '15m', ms: 900_000 },
  { label: '30m', ms: 1_800_000 },
  { label: '1h', ms: 3_600_000 },
  { label: '2h', ms: 7_200_000 },
  { label: '4h', ms: 14_400_000 },
]

export default function ProfilePanel() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useCanvasSize(canvasRef)
  const [lookback, setLookback] = useState(3_600_000)
  const [binsN, setBinsN] = useState(60)
  const [backfill, setBackfill] = useState<Trade[]>([])
  const [coverage, setCoverage] = useState<number | null>(null)
  const [stats, setStats] = useState<{ poc: number; vah: number; val: number; total: number; buy: number; sell: number } | null>(null)
  const lastStats = useRef(0)

  useEffect(() => {
    let alive = true
    fetch(`/api/footprint-history?symbol=${symbol}&pages=8`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        if (j.trades) {
          setBackfill(j.trades.map((t: number[]) => ({ a: t[0], p: t[1], q: t[2], t: t[3], m: t[4] })))
          setCoverage(j.from ? (now() - j.from) / 60000 : null)
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [symbol])

  const merged = usePoll<Trade[]>(() => {
    const live = getStream().trades
    if (!backfill.length) return live
    if (!live.length) return backfill
    const extra = live.filter((t) => t.a > backfill[backfill.length - 1].a)
    return extra.length ? [...backfill, ...extra] : backfill
  }, 600)

  function draw() {
    const el = canvasRef.current
    if (!el || size.w === 0) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const W = size.w, H = size.h
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)

    const cutoff = now() - lookback
    const win = merged.filter((t) => t.t >= cutoff)
    const axisW = 70
    const plotW = W - axisW
    if (!win.length || plotW < 60) {
      ctx.fillStyle = TEXT_DIM
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('waiting for trade history…', W / 2, H / 2)
      return
    }

    let pMin = Infinity, pMax = 0, buy = 0, sell = 0
    for (const t of win) {
      if (t.p < pMin) pMin = t.p
      if (t.p > pMax) pMax = t.p
      if (t.m) sell += t.q
      else buy += t.q
    }
    const pad = (pMax - pMin) * 0.02 || pMax * 0.0004
    pMin -= pad
    pMax += pad
    const binSize = (pMax - pMin) / binsN
    const bins = Array.from({ length: binsN }, (_, i) => ({ price: pMin + (i + 0.5) * binSize, buy: 0, sell: 0 }))
    for (const t of win) {
      const idx = Math.min(binsN - 1, Math.max(0, Math.floor((t.p - pMin) / binSize)))
      if (t.m) bins[idx].sell += t.q
      else bins[idx].buy += t.q
    }
    const va = valueArea(bins)
    const maxTot = Math.max(...bins.map((b) => b.buy + b.sell), 0.0001)
    const barMax = plotW * 0.92
    const p2y = (p: number) => H - 16 - ((p - pMin) / (pMax - pMin)) * (H - 24)

    if (va) {
      const yTop = p2y(va.vah), yBot = p2y(va.val)
      ctx.fillStyle = 'rgba(77,163,255,0.06)'
      ctx.fillRect(0, yTop, plotW, yBot - yTop)
    }
    const rowH = (H - 24) / binsN
    for (const b of bins) {
      const y = p2y(b.price)
      const tot = b.buy + b.sell
      if (tot <= 0) continue
      const wBuy = (b.buy / maxTot) * barMax
      const wSell = (b.sell / maxTot) * barMax
      const isPoc = !!va && b.price === va.poc
      ctx.fillStyle = `rgba(22,199,132,${isPoc ? 0.85 : 0.55})`
      ctx.fillRect(0, y - rowH / 2 + 0.5, wBuy, Math.max(1.5, rowH - 1))
      ctx.fillStyle = `rgba(234,57,67,${isPoc ? 0.85 : 0.55})`
      ctx.fillRect(wBuy, y - rowH / 2 + 0.5, wSell, Math.max(1.5, rowH - 1))
    }
    if (va) {
      const y = p2y(va.poc)
      ctx.strokeStyle = '#f0b90b'
      ctx.setLineDash([5, 4])
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#f0b90b'
      ctx.font = 'bold 10px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(`POC ${fmtPrice(va.poc, meta.tick)}`, 6, y - 4)
    }
    ctx.fillStyle = TEXT_DIM
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'left'
    for (let i = 0; i <= 8; i++) {
      const p = pMin + ((pMax - pMin) * i) / 8
      ctx.fillText(fmtPrice(p, meta.tick), plotW + 6, p2y(p) + 3)
    }
    const t = Date.now()
    if (va && t - lastStats.current > 1200) {
      lastStats.current = t
      setStats({ poc: va.poc, vah: va.vah, val: va.val, total: buy + sell, buy, sell })
    }
  }

  useRaf(draw, true, 500)

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-profile">
      <PanelHeader
        title="Volume profile"
        sub="Traded volume by price (buy | sell split) · POC = highest-volume price · shaded band = 70% value area"
        source="Binance aggTrades"
        right={
          <div className="flex flex-wrap items-center gap-1">
            {LOOKBACKS.map((l) => (
              <button key={l.label} onClick={() => setLookback(l.ms)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', lookback === l.ms ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {l.label}
              </button>
            ))}
            {[40, 60, 90].map((b) => (
              <button key={b} onClick={() => setBinsN(b)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', binsN === b ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {b}
              </button>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-5">
        <StatCard label="POC" value={stats ? fmtPrice(stats.poc, meta.tick) : '—'} />
        <StatCard label="Value area high" value={stats ? fmtPrice(stats.vah, meta.tick) : '—'} />
        <StatCard label="Value area low" value={stats ? fmtPrice(stats.val, meta.tick) : '—'} />
        <StatCard label="Total volume" value={fmtCompact(stats?.total ?? null)} sub={coverage != null ? `history covers ≈ ${coverage.toFixed(0)} min` : 'live only'} />
        <StatCard label="Buy / Sell split" value={stats && stats.total > 0 ? `${((stats.buy / (stats.buy + stats.sell)) * 100).toFixed(1)}% / ${((stats.sell / (stats.buy + stats.sell)) * 100).toFixed(1)}%` : '—'} />
      </div>
      <div className="min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  )
}
