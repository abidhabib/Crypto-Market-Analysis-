'use client'

import { useEffect, useRef, useState } from 'react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, now } from '@/lib/terminal/stream-client'
import { usePoll, useRaf, useCanvasSize } from '@/lib/terminal/hooks'
import { symbolMeta, GREEN, RED, TEXT_DIM } from '@/lib/terminal/constants'
import { fmtCompact, fmtTime, fmtUsd } from '@/lib/terminal/format'
import { PanelHeader, StatCard } from './panel-kit'
import { cn } from '@/lib/utils'
import type { Trade } from '@/lib/terminal/types'

const BG = '#0b0d12'

interface FpBucket { buy: number; sell: number }
interface FpCandle { t: number; o: number; h: number; l: number; c: number; rows: Map<number, FpBucket>; delta: number }

function buildFootprint(trades: Trade[], tfMs: number, rowsPerCandle: number): FpCandle[] {
  if (!trades.length) return []
  const candles = new Map<number, FpCandle>()
  let minP = Infinity, maxP = 0
  for (const tr of trades) {
    const b = Math.floor(tr.t / tfMs) * tfMs
    let c = candles.get(b)
    if (!c) {
      c = { t: b, o: tr.p, h: tr.p, l: tr.p, c: tr.p, rows: new Map(), delta: 0 }
      candles.set(b, c)
    }
    c.h = Math.max(c.h, tr.p)
    c.l = Math.min(c.l, tr.p)
    c.c = tr.p
    const row = c.rows.get(tr.p) ?? { buy: 0, sell: 0 }
    // m=true → buyer is maker → aggressor was a seller (hit the bid)
    if (tr.m) row.sell += tr.q
    else row.buy += tr.q
    c.rows.set(tr.p, row)
    c.delta += tr.m ? -tr.q : tr.q
    if (tr.p < minP) minP = tr.p
    if (tr.p > maxP) maxP = tr.p
  }
  const out = [...candles.values()].sort((a, b) => a.t - b.t)
  const range = maxP - minP
  const binSize = Math.max((range / (rowsPerCandle * out.length)) * 1.2, ((maxP + minP) / 2) * 0.00002)
  for (const c of out) {
    const binned = new Map<number, FpBucket>()
    for (const [p, v] of c.rows) {
      const k = Math.round(p / binSize) * binSize
      const cur = binned.get(k) ?? { buy: 0, sell: 0 }
      cur.buy += v.buy
      cur.sell += v.sell
      binned.set(k, cur)
    }
    c.rows = binned
  }
  return out
}

export default function FootprintPanel() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useCanvasSize(canvasRef)
  const [tf, setTf] = useState(60_000)
  const [rowsPerCandle, setRows] = useState(9)
  const [imb, setImb] = useState(3)
  const [backfill, setBackfill] = useState<Trade[]>([])
  const [bfState, setBfState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [bfWindow, setBfWindow] = useState<{ from: number | null; to: number | null }>({ from: null, to: null })

  useEffect(() => {
    let alive = true
    fetch(`/api/footprint-history?symbol=${symbol}&pages=8`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return
        if (j.trades) {
          setBackfill(j.trades.map((t: number[]) => ({ a: t[0], p: t[1], q: t[2], t: t[3], m: t[4] })))
          setBfWindow({ from: j.from, to: j.to })
          setBfState('ok')
        } else setBfState('err')
      })
      .catch(() => { if (alive) setBfState('err') })
    return () => { alive = false }
  }, [symbol])

  const merged = usePoll<Trade[]>(() => {
    const live = getStream().trades
    if (!backfill.length) return live
    if (!live.length) return backfill
    const lastId = backfill[backfill.length - 1].a
    const extra = live.filter((t) => t.a > lastId)
    return extra.length ? [...backfill, ...extra] : backfill
  }, 500)

  const stats = usePoll(() => {
    const all = merged
    const cutoff = now() - tf * 80
    let delta = 0, buy = 0, sell = 0, n = 0
    const seen = new Set<number>()
    for (const t of all) {
      if (t.t < cutoff) continue
      delta += t.m ? -t.q : t.q
      if (t.m) sell += t.q * t.p
      else buy += t.q * t.p
      const b = Math.floor(t.t / tf) * tf
      seen.add(b)
      n++
    }
    return { delta, buy, sell, candles: seen.size }
  }, 700)

  function draw() {
    const el = canvasRef.current
    if (!el || size.w === 0) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const W = size.w, H = size.h
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)

    const cutoff = now() - tf * 80
    const fp = buildFootprint(merged.filter((t) => t.t >= cutoff), tf, rowsPerCandle)
    if (!fp.length) {
      ctx.fillStyle = TEXT_DIM
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('waiting for trades…', W / 2, H / 2)
      return
    }

    const headH = 20, deltaH = 16
    const axisW = 70
    const plotW = W - axisW, plotH = H - headH - deltaH
    const show = fp.slice(-Math.max(3, Math.floor(plotW / 74)))
    const colW = plotW / show.length

    let pMin = Infinity, pMax = 0, maxRowQ = 0.0001
    for (const c of show) {
      pMin = Math.min(pMin, c.l)
      pMax = Math.max(pMax, c.h)
      for (const v of c.rows.values()) maxRowQ = Math.max(maxRowQ, v.buy + v.sell)
    }
    const pad = (pMax - pMin) * 0.04 || pMax * 0.0006
    pMin -= pad
    pMax += pad
    const p2y = (p: number) => headH + ((pMax - p) / (pMax - pMin)) * plotH
    const rowH = plotH / rowsPerCandle

    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    for (let i = 0; i < show.length; i++) {
      ctx.fillStyle = show[i].c >= show[i].o ? GREEN : RED
      ctx.fillText(fmtTime(show[i].t, false), i * colW + colW / 2, 13)
    }
    ctx.textAlign = 'right'
    ctx.fillStyle = TEXT_DIM
    for (let i = 0; i <= rowsPerCandle; i++) {
      const p = pMax - ((pMax - pMin) * i) / rowsPerCandle
      ctx.fillText(fmtPriceLocal(p, meta.tick), axisW - 6, p2y(p) + 3)
      ctx.strokeStyle = '#151922'
      ctx.beginPath(); ctx.moveTo(axisW, p2y(p)); ctx.lineTo(W, p2y(p)); ctx.stroke()
    }

    ctx.textAlign = 'center'
    for (let i = 0; i < show.length; i++) {
      const c = show[i]
      const x = i * colW + axisW
      let pocKey: number | null = null, pocTot = 0
      for (const [p, v] of c.rows) {
        const tot = v.buy + v.sell
        if (tot > pocTot) { pocTot = tot; pocKey = p }
      }
      const keys = [...c.rows.keys()].sort((a, b) => b - a)
      for (const p of keys) {
        const v = c.rows.get(p)!
        const y = p2y(p)
        const tot = v.buy + v.sell
        const inten = Math.min(0.85, 0.12 + 0.73 * (tot / maxRowQ))
        const binStep = keys.length > 1 ? keys[0] - keys[1] : 0
        const lower = binStep ? c.rows.get(p - binStep) : undefined
        const buyImb = lower && v.buy > 0 && lower.sell > 0 && v.buy >= imb * lower.sell
        const sellImb = lower && lower.buy > 0 && v.sell > 0 && lower.buy >= imb * v.sell
        const isPoc = p === pocKey
        ctx.fillStyle = isPoc ? 'rgba(240,185,11,0.14)' : 'rgba(255,255,255,0.02)'
        ctx.fillRect(x + 1, y - rowH / 2 + 1, colW - 2, Math.max(9, rowH - 2))
        if (buyImb) { ctx.fillStyle = 'rgba(22,199,132,0.30)'; ctx.fillRect(x + 1, y - rowH / 2 + 1, colW / 2 - 1, Math.max(9, rowH - 2)) }
        if (sellImb) { ctx.fillStyle = 'rgba(234,57,67,0.30)'; ctx.fillRect(x + colW / 2, y - rowH / 2 + 1, colW / 2 - 1, Math.max(9, rowH - 2)) }
        const fracB = v.buy / Math.max(v.buy, v.sell, 0.0001)
        const fracS = v.sell / Math.max(v.buy, v.sell, 0.0001)
        ctx.fillStyle = `rgba(22,199,132,${inten})`
        ctx.fillRect(x + 1, y - rowH / 2 + 1, Math.max(2, (colW / 2 - 2) * fracB), Math.max(9, rowH - 2))
        ctx.fillStyle = `rgba(234,57,67,${inten})`
        ctx.fillRect(x + colW / 2 + (colW / 2 - 2) * (1 - fracS), y - rowH / 2 + 1, Math.max(2, (colW / 2 - 2) * fracS), Math.max(9, rowH - 2))
        ctx.font = `${isPoc ? 'bold ' : ''}8.5px ui-monospace, monospace`
        ctx.fillStyle = '#dfe4ee'
        ctx.fillText(fmtCompact(v.buy), x + colW * 0.27, y - 1)
        ctx.fillText(fmtCompact(v.sell), x + colW * 0.74, y - 1)
      }
      ctx.font = 'bold 9px ui-monospace, monospace'
      ctx.fillStyle = c.delta >= 0 ? GREEN : RED
      ctx.fillText(`Δ ${fmtCompact(c.delta)}`, x + colW / 2, H - 4)
    }
  }

  useRaf(draw, true, 300)

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-footprint">
      <PanelHeader
        title="Footprint"
        sub="Bid×ask volume per price level · bold row = POC · shaded half = ≥imb× diagonal imbalance · Δ = candle delta"
        source="Binance aggTrades"
        right={
          <div className="flex flex-wrap items-center gap-1">
            {[[15_000, '15s'], [60_000, '1m'], [300_000, '5m'], [900_000, '15m']].map(([v, l]) => (
              <button key={l} onClick={() => setTf(v as number)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', tf === v ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {l}
              </button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">rows</span>
            {[6, 9, 12].map((r) => (
              <button key={r} onClick={() => setRows(r)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', rowsPerCandle === r ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {r}
              </button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">imb</span>
            {[2, 3, 4].map((r) => (
              <button key={r} onClick={() => setImb(r)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', imb === r ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {r}×
              </button>
            ))}
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-3 py-2 sm:grid-cols-4">
        <StatCard label={`Window (${fmtTime(bfWindow.from, false)}–${fmtTime(bfWindow.to, false)})`} value={`${stats.candles} candles`} sub={bfState === 'ok' ? 'history + live' : bfState === 'loading' ? 'loading history…' : 'live only'} />
        <StatCard label="Window delta" value={fmtCompact(stats.delta)} tone={stats.delta >= 0 ? 'up' : 'down'} />
        <StatCard label="Aggressive buys" value={fmtUsd(stats.buy)} tone="up" />
        <StatCard label="Aggressive sells" value={fmtUsd(stats.sell)} tone="down" />
      </div>
      <div className="min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  )
}

function fmtPriceLocal(v: number, tick: number): string {
  const dp = Math.max(0, Math.min(8, Math.ceil(-Math.log10(tick))))
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
