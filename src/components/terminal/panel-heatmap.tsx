'use client'

import { useRef, useState } from 'react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, now } from '@/lib/terminal/stream-client'
import { usePoll, useRaf, useCanvasSize } from '@/lib/terminal/hooks'
import { symbolMeta, GREEN, RED, TEXT_DIM } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtClock } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge } from './panel-kit'
import { cn } from '@/lib/utils'

const BG = '#0b0d12'
const SPANS = [
  { label: '2m', ms: 120_000 },
  { label: '5m', ms: 300_000 },
  { label: '10m', ms: 600_000 },
  { label: '15m', ms: 900_000 },
]
const VSPAN = [0.15, 0.3, 0.6] // ±% price window options

export default function HeatmapPanel() {
  const { symbol } = useTerminal()
  const meta = symbolMeta(symbol)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useCanvasSize(canvasRef)
  const [span, setSpan] = useState(300_000)
  const [vspan, setVspan] = useState(0.3)
  const [bin, setBin] = useState(1) // multiplier over meta.bin
  const [hover, setHover] = useState<{ p: number; q: number; side: 'bid' | 'ask'; t: number } | null>(null)
  const [showLadder, setShowLadder] = useState(true)

  function draw() {
    const el = canvasRef.current
    if (!el || size.w === 0) return
    const ctx = el.getContext('2d')!
    const W = size.w, H = size.h
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)

    const cols = getStream().heatCols
    const tNow = now()
    const tMin = tNow - span
    const window = cols.filter((c) => c.t >= tMin - 1500)
    const axisW = 64, ladderW = showLadder ? 130 : 0
    const plotW = W - axisW - ladderW
    const padB = 18
    const plotH = H - padB
    if (!window.length || plotW < 40) {
      ctx.fillStyle = TEXT_DIM
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('collecting order-book snapshots…', W / 2, H / 2)
      return
    }

    const mid = window[window.length - 1].mid
    const pTop = mid * (1 + vspan / 100)
    const pBot = mid * (1 - vspan / 100)
    const binSize = meta.bin * bin
    const p2y = (p: number) => ((pTop - p) / (pTop - pBot)) * plotH

    // column layout: fixed column width ~1.5px, latest at right edge
    const colW = 1.6
    const maxCols = Math.floor(plotW / colW)
    const view = window.slice(-maxCols)
    const x0 = plotW - view.length * colW

    // grid + labels
    ctx.strokeStyle = '#161a22'
    ctx.lineWidth = 1
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillStyle = TEXT_DIM
    ctx.textAlign = 'left'
    const lines = 8
    for (let i = 0; i <= lines; i++) {
      const p = pBot + ((pTop - pBot) * i) / lines
      const y = p2y(p)
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke()
      ctx.fillText(fmtPrice(p, meta.tick), plotW + 6, y + 3)
    }

    // heat cells: intensity = log-scaled resting size
    const refQ = Math.max(
      1,
      ...view[view.length - 1].bids.slice(0, 80).map((l) => l.q),
      ...view[view.length - 1].asks.slice(0, 80).map((l) => l.q),
    ) / 2
    for (let ci = 0; ci < view.length; ci++) {
      const col = view[ci]
      const x = x0 + ci * colW
      for (const side of [0, 1]) {
        const levels = side === 0 ? col.bids : col.asks
        for (const lv of levels) {
          if (lv.p > pTop || lv.p < pBot || lv.q <= 0) continue
          const y = p2y(lv.p)
          const h = Math.max(1.4, Math.abs(p2y(lv.p - binSize) - y))
          const a = Math.min(0.92, Math.log10(1 + lv.q / (refQ * 0.05)) * 0.42)
          ctx.fillStyle = side === 0 ? `rgba(22,199,132,${a})` : `rgba(234,57,67,${a})`
          ctx.fillRect(x, y - h / 2, colW + 0.4, h)
        }
      }
    }

    // mid line + current price label
    ctx.strokeStyle = 'rgba(240,185,11,0.8)'
    ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(0, p2y(mid)); ctx.lineTo(plotW, p2y(mid)); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = '#f0b90b'
    ctx.fillRect(plotW, p2y(mid) - 8, axisW, 16)
    ctx.fillStyle = '#111'
    ctx.textAlign = 'center'
    ctx.font = 'bold 10px ui-monospace, monospace'
    ctx.fillText(fmtPrice(mid, meta.tick), plotW + axisW / 2, p2y(mid) + 3)

    // ladder overlay (current aggregated book on right side)
    if (showLadder) {
      const lx = plotW + axisW
      const cur = view[view.length - 1]
      const maxQ = Math.max(
        ...cur.bids.filter((l) => l.p >= pBot).map((l) => l.q),
        ...cur.asks.filter((l) => l.p <= pTop).map((l) => l.q), 0.0001,
      )
      ctx.fillStyle = '#0d1017'
      ctx.fillRect(lx, 0, ladderW, plotH)
      ctx.strokeStyle = '#1c1f26'
      ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, plotH); ctx.stroke()
      const barMax = ladderW * 0.62
      for (const side of [0, 1]) {
        const levels = (side === 0 ? cur.bids : cur.asks).filter((l) => l.p >= pBot && l.p <= pTop)
        for (const lv of levels) {
          const y = p2y(lv.p)
          const w = (lv.q / maxQ) * barMax
          ctx.fillStyle = side === 0 ? 'rgba(22,199,132,0.55)' : 'rgba(234,57,67,0.55)'
          ctx.fillRect(side === 0 ? lx : lx + ladderW - w, y - 1, w, 2)
        }
      }
    }

    // time axis
    ctx.fillStyle = TEXT_DIM
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    for (let i = 0; i <= 4; i++) {
      const t = tMin + ((tNow - tMin) * i) / 4
      ctx.fillText(fmtClock(t), (plotW * i) / 4, H - 5)
    }
  }

  usePoll(() => getStream().heatCols.length, 500)
  useRaf(draw, true, 400)

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const cols = getStream().heatCols
    if (!cols.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const axisW = 64, ladderW = showLadder ? 130 : 0
    const plotW = size.w - axisW - ladderW
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    if (x > plotW) { setHover(null); return }
    const cur = cols[cols.length - 1]
    const pTop = cur.mid * (1 + vspan / 100), pBot = cur.mid * (1 - vspan / 100)
    const p = pTop - (y / Math.max(1, size.h - 18)) * (pTop - pBot)
    // find nearest resting level at that price in latest ladder
    let best: { q: number; side: 'bid' | 'ask' } | null = null
    let bestD = Infinity
    for (const lv of cur.bids) { const d = Math.abs(lv.p - p); if (d < bestD) { bestD = d; best = { q: lv.q, side: 'bid' } } }
    for (const lv of cur.asks) { const d = Math.abs(lv.p - p); if (d < bestD) { bestD = d; best = { q: lv.q, side: 'ask' } } }
    if (best && bestD < meta.bin * bin * 3) setHover({ p, q: best.q, side: best.side, t: cur.t })
    else setHover(null)
  }

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-heatmap">
      <PanelHeader
        title="Liquidity heatmap"
        sub="Resting limit-order size over time · green = bids, red = asks · hover for level detail"
        source="Binance spot · depth500 @1s"
        right={
          <div className="flex flex-wrap items-center gap-1">
            {SPANS.map((s) => (
              <button key={s.label} onClick={() => setSpan(s.ms)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', span === s.ms ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {s.label}
              </button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">±%</span>
            {VSPAN.map((v) => (
              <button key={v} onClick={() => setVspan(v)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', vspan === v ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {v}
              </button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">bin</span>
            {[1, 2, 5].map((b) => (
              <button key={b} onClick={() => setBin(b)}
                className={cn('rounded border px-1.5 py-1 text-[10px]', bin === b ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')}>
                {b}×
              </button>
            ))}
            <button onClick={() => setShowLadder((v) => !v)}
              className={cn('rounded border px-1.5 py-1 text-[10px]', showLadder ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground')}>
              Ladder
            </button>
          </div>
        }
      />
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        {hover && (
          <div className="pointer-events-none absolute bottom-6 left-2 rounded border border-border bg-black/80 px-2 py-1 font-mono text-[10px]">
            <span style={{ color: hover.side === 'bid' ? GREEN : RED }}>{hover.side === 'bid' ? 'BID' : 'ASK'}</span>{' '}
            {fmtPrice(hover.p, meta.tick)} · {fmtCompact(hover.q)} {symbol.replace('USDT', '')} · {fmtCompact(hover.q * hover.p)}
          </div>
        )}
      </div>
    </div>
  )
}
