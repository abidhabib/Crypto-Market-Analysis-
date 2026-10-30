'use client'

/**
 * Heatmap v2 — Bookmap-style liquidity heatmap.
 *
 * Layers (bottom → top):
 *  1. depth pixels  — local order book @4Hz, blue=violet intensity (offscreen cached)
 *  2. trade bubbles — green buys / red sells, radius ∝ √notional
 *  3. pull × / sweep ◆ markers — spoof-style liquidity events
 *  4. traded price line (white dashed), POC (amber dotted)
 *  5. decision lines — nearest big walls (buy above / sell below)
 *  6. crosshair + rich tooltip, right DOM ladder, axes
 */

import { useEffect, useRef, useState } from 'react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream, now } from '@/lib/terminal/stream-client'
import { usePoll, useRaf, useCanvasSize } from '@/lib/terminal/hooks'
import { metaFor, GREEN, RED, AMBER } from '@/lib/terminal/constants'
import { fmtPrice, fmtCompact, fmtClock } from '@/lib/terminal/format'
import { PanelHeader, SourceBadge } from './panel-kit'
import { cn } from '@/lib/utils'

const BG = '#070a12'

/**
 * Color ramps for depth pixels: deep base → bright core with baked alpha.
 * Index = intensity 0..1 (64 steps). Bid = electric blue, ask = magenta-violet
 * — clearly opposing hues so direction reads at a glance.
 */
function buildRamp(stops: [number, number, number, number][]): string[] {
  const N = 64
  const lut: string[] = []
  for (let i = 0; i < N; i++) {
    const t = (i / (N - 1)) * (stops.length - 1)
    const k = Math.min(stops.length - 2, Math.floor(t))
    const f = t - k
    const a = stops[k], b = stops[k + 1]
    lut.push(`rgba(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)},${(a[3] + (b[3] - a[3]) * f).toFixed(3)})`)
  }
  return lut
}
const BID_RAMP = buildRamp([
  [14, 40, 92, 0.14],
  [24, 86, 210, 0.55],
  [66, 152, 255, 0.86],
  [168, 214, 255, 0.98],
])
const ASK_RAMP = buildRamp([
  [72, 16, 92, 0.14],
  [150, 40, 198, 0.55],
  [216, 94, 255, 0.86],
  [255, 230, 255, 0.98],
])
const BID_LEGEND = 'rgb(66,152,255)'
const ASK_LEGEND = 'rgb(216,94,255)'
const SPANS = [
  { label: '2m', ms: 120_000 },
  { label: '5m', ms: 300_000 },
  { label: '10m', ms: 600_000 },
  { label: '15m', ms: 900_000 },
]
const VSPANS = [0.1, 0.15, 0.3, 0.6]
const CONTRASTS = [
  { label: 'Low', v: 0.7 },
  { label: 'Med', v: 1 },
  { label: 'High', v: 1.45 },
]
const BUBBLE_MINS = [
  { label: '$2K', v: 2_000 },
  { label: '$5K', v: 5_000 },
  { label: '$25K', v: 25_000 },
]

interface Aggs {
  poc: number | null
  pocMap: Map<number, number>
  bubbles: { t: number; p: number; n: number; buy: boolean }[]
  dots: { t: number; p: number; n: number; buy: boolean }[]
  netBubble: number
  bubbleCount: number
  priceLine: { t: number; p: number }[]
  buyAbove: number | null
  sellBelow: number | null
  refQ: number
  tradeRate: number
}

export default function HeatmapPanel() {
  const { symbol } = useTerminal()
  const meta = metaFor(symbol)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useCanvasSize(canvasRef)
  const heatRef = useRef<HTMLCanvasElement | null>(null)
  const anchorRef = useRef<{ mid: number } | null>(null)
  const drawStateRef = useRef<{
    pxTotal: number     // pixels of visual columns ever drawn since reset
    pxShifted: number   // pixels shifted off the left edge
    rawDrawn: number    // raw columns consumed since reset
    lastColsLen: number
    acc: { h: number; bids: Float32Array; asks: Float32Array; n: number } | null
  }>({ pxTotal: 0, pxShifted: 0, rawDrawn: 0, lastColsLen: -1, acc: null })
  const sigRef = useRef('')
  const aggsRef = useRef<Aggs | null>(null)
  const mouseRef = useRef<{ x: number; y: number } | null>(null)
  const [hover, setHover] = useState<null | {
    x: number; y: number; p: number; t: number
    bidQ: number; askQ: number; traded: number
    pulls: { size: number; side: 'bid' | 'ask'; lasted: number; count: number }[]
    wall: { side: 'bid' | 'ask'; q: number; firstSeen: number; pulls: number } | null
    sweep: number
  }>(null)

  const [span, setSpan] = useState(120_000)
  const [vspan, setVspan] = useState(0.15)
  const [binMult, setBinMult] = useState(1)
  const [contrast, setContrast] = useState(1)
  const [bubbleMin, setBubbleMin] = useState(5_000)
  const [showBubbles, setShowBubbles] = useState(true)
  const [showEvents, setShowEvents] = useState(true)
  const [showLadder, setShowLadder] = useState(true)

  const beat = usePoll(() => getStream().lastMsgAt, 1000)

  // ------------------------------------------------ heavy aggregates @1Hz
  useEffect(() => {
    const st = getStream()
    const tNow = now()
    const tMin = tNow - span
    const binSize = meta.bin * binMult
    const trades = st.trades
    const win = trades.length && trades[trades.length - 1].t >= tMin - 60_000
      ? trades.filter((x) => x.t >= tMin)
      : []

    // traded volume per price bin + POC
    const pocMap = new Map<number, number>()
    let buyNot = 0, sellNot = 0
    const bubbles: Aggs['bubbles'] = []
    const dots: Aggs['dots'] = []
    for (const tr of win) {
      const n = tr.p * tr.q
      const buy = !tr.m
      const bucket = Math.round(tr.p / binSize) * binSize
      pocMap.set(bucket, (pocMap.get(bucket) ?? 0) + n)
      if (buy) buyNot += n; else sellNot += n
      if (n >= bubbleMin) bubbles.push({ t: tr.t, p: tr.p, n, buy })
      else if (n >= bubbleMin / 4) dots.push({ t: tr.t, p: tr.p, n, buy })
    }
    bubbles.sort((a, b) => a.n - b.n)
    if (bubbles.length > 1600) bubbles.splice(0, bubbles.length - 1600)
    if (dots.length > 1400) { // stride-sample small dots
      const stride = Math.ceil(dots.length / 1400)
      const kept = dots.filter((_, i) => i % stride === 0)
      dots.length = 0; dots.push(...kept)
    }
    let poc: number | null = null
    let bestV = 0
    for (const [p, v] of pocMap) if (v > bestV) { bestV = v; poc = p }

    // decimated traded price line (≤ 500 points)
    const priceLine: Aggs['priceLine'] = []
    if (win.length > 500) {
      const stride = win.length / 500
      for (let i = 0; i < 500; i++) {
        const tr = win[Math.floor(i * stride)]
        priceLine.push({ t: tr.t, p: tr.p })
      }
      priceLine.push({ t: win[win.length - 1].t, p: win[win.length - 1].p })
    } else {
      for (const tr of win) priceLine.push({ t: tr.t, p: tr.p })
    }

    // decision levels from walls
    const mid = st.heatCols.length ? st.heatCols[st.heatCols.length - 1].mid : 0
    let buyAbove: number | null = null
    let sellBelow: number | null = null
    for (const w of st.walls) {
      if (w.side === 'ask' && w.p > mid && (buyAbove === null || w.p < buyAbove)) buyAbove = w.p
      if (w.side === 'bid' && w.p < mid && (sellBelow === null || w.p > sellBelow)) sellBelow = w.p
    }

    // intensity reference: median level notional of latest column
    let refQ = 1
    const last = st.heatCols[st.heatCols.length - 1]
    if (last) {
      const arr: number[] = []
      for (const lv of last.bids.slice(0, 120)) arr.push(lv.q * lv.p)
      for (const lv of last.asks.slice(0, 120)) arr.push(lv.q * lv.p)
      if (arr.length > 10) {
        arr.sort((a, b) => a - b)
        refQ = arr[Math.floor(arr.length / 2)] || 1
      }
    }

    // window trade rate
    const dt = win.length > 1 ? (win[win.length - 1].t - win[0].t) / 1000 : 1
    const tradeRate = dt > 0 ? win.length / dt : 0

    aggsRef.current = { poc, pocMap, bubbles, dots, netBubble: buyNot - sellNot, bubbleCount: bubbles.length + dots.length, priceLine, buyAbove, sellBelow, refQ, tradeRate }
  }, [beat, span, binMult, bubbleMin, symbol])

  // ------------------------------------------------ geometry helpers per frame
  function geom(plotW: number, plotH: number) {
    const st = getStream()
    const cols = st.heatCols
    const tNow = now()
    const tMin = tNow - span
    if (!cols.length) return null
    const midNow = cols[cols.length - 1].mid
    let anchor = anchorRef.current
    const windowH = midNow * (vspan / 100) * 2
    if (!anchor || Math.abs(midNow - anchor.mid) > windowH * 0.35) {
      anchor = { mid: midNow }
      anchorRef.current = anchor
      drawStateRef.current = { pxTotal: 0, pxShifted: 0, rawDrawn: 0, lastColsLen: -1, acc: null }
    }
    const m = anchor.mid
    const pTop = m * (1 + (vspan * 1.12) / 100)
    const pBot = m * (1 - (vspan * 1.12) / 100)
    const binSize = meta.bin * binMult
    // time-proportional depth columns: each visual column is as wide as the
    // time it covers (≥1.1px), so depth stays perfectly aligned with the time
    // axis and fills the full plot width at every span once history exists
    const pxPerMs = plotW / span
    const g = Math.max(1, Math.ceil(1.15 / (250 * pxPerMs)))
    return { st, cols, tNow, tMin, anchor: m, pTop, pBot, binSize, g, pxPerMs, midNow }
  }

  const p2yOf = (p: number, pTop: number, pBot: number, plotH: number) =>
    ((pTop - p) / (pTop - pBot)) * plotH

  // ------------------------------------------------ incremental depth render
  // Bookmap-grade rendering: depth levels are aggregated per PIXEL ROW (max
  // notional wins), so every row is exactly 1px — no sub-pixel overdraw, no
  // alpha stacking mush. Columns are time-proportional (width = the time they
  // cover), packed from the right edge, so depth aligns with trade bubbles and
  // the price line at every zoom level, including merged history replay.
  function renderDepthInto(hc: HTMLCanvasElement, G: NonNullable<ReturnType<typeof geom>>, plotW: number, plotH: number) {
    const { cols, tMin, pTop, pBot, g, pxPerMs } = G
    const ctx = hc.getContext('2d')!
    const ds = drawStateRef.current
    if (!ds.acc || ds.acc.h !== plotH)
      ds.acc = { h: plotH, bids: new Float32Array(plotH), asks: new Float32Array(plotH), n: 0 }
    if (cols.length === ds.lastColsLen) return
    ds.lastColsLen = cols.length

    const inView = cols.filter((c) => c.t >= tMin - 1200)
    // on reset / span change: start from the first in-view column
    if (ds.rawDrawn > inView.length) ds.rawDrawn = 0
    const start = ds.rawDrawn
    if (inView.length - start <= 0) return

    // pass 1 — group raw columns (g each) into visual columns; each gets the
    // pixel width of the time interval it represents
    const groups: { w: number }[] = []
    let cnt = ds.acc.n
    let accMs = 0
    for (let i = start; i < inView.length; i++) {
      const prev = i > 0 ? inView[i - 1].t : inView[i].t - 250
      const iv = Math.min(3000, Math.max(40, inView[i].t - prev))
      accMs += iv
      if (++cnt >= g) {
        groups.push({ w: Math.max(1.1, accMs * pxPerMs) })
        cnt = 0; accMs = 0
      }
    }
    if (!groups.length) return

    const totalPx = groups.reduce((s, gr) => s + gr.w, 0)
    // shift out what scrolled past the left edge
    const needShift = Math.max(0, ds.pxTotal - ds.pxShifted + totalPx - plotW)
    if (needShift > 0) {
      ctx.drawImage(hc, -needShift, 0)
      ds.pxShifted += needShift
    }

    // pass 2 — accumulate levels per pixel row (max), emit visual columns
    const refQ = aggsRef.current?.refQ ?? 1
    const contrastLut = Math.pow(contrast, 0.9)
    const acc = ds.acc
    let gi = 0
    let x = plotW - totalPx // left edge of this batch

    const emitColumn = (cx: number, w: number) => {
      for (let row = 0; row < plotH; row++) {
        const bn = acc.bids[row], an = acc.asks[row]
        if (bn <= 0 && an <= 0) continue
        if (bn >= an) {
          let t = Math.log10(1 + (3 * bn) / refQ) * 0.5 * contrastLut
          t = Math.pow(Math.min(1, Math.max(0, t)), 0.85)
          const idx = (t * 63) | 0
          if (idx > 0) { ctx.fillStyle = BID_RAMP[idx]; ctx.fillRect(cx, row, w + 0.5, 1) }
        } else {
          let t = Math.log10(1 + (3 * an) / refQ) * 0.5 * contrastLut
          t = Math.pow(Math.min(1, Math.max(0, t)), 0.85)
          const idx = (t * 63) | 0
          if (idx > 0) { ctx.fillStyle = ASK_RAMP[idx]; ctx.fillRect(cx, row, w + 0.5, 1) }
        }
      }
    }

    for (let i = start; i < inView.length; i++) {
      const col = inView[i]
      for (const lv of col.bids) {
        if (lv.p > pTop || lv.p < pBot || lv.q <= 0) continue
        const row = Math.round(p2yOf(lv.p, pTop, pBot, plotH))
        if (row < 0 || row >= plotH) continue
        const not = lv.q * lv.p
        if (not > acc.bids[row]) acc.bids[row] = not
      }
      for (const lv of col.asks) {
        if (lv.p > pTop || lv.p < pBot || lv.q <= 0) continue
        const row = Math.round(p2yOf(lv.p, pTop, pBot, plotH))
        if (row < 0 || row >= plotH) continue
        const not = lv.q * lv.p
        if (not > acc.asks[row]) acc.asks[row] = not
      }
      if (++acc.n >= g) {
        const gr = groups[gi++]
        emitColumn(x, gr.w)
        x += gr.w
        acc.bids.fill(0); acc.asks.fill(0); acc.n = 0
      }
    }
    ds.rawDrawn = inView.length
    ds.pxTotal += totalPx
  }

  // ------------------------------------------------ main draw loop
  function draw() {
    const el = canvasRef.current
    if (!el || size.w === 0) return
    const ctx = el.getContext('2d')!
    const W = size.w, H = size.h
    const axisW = 62
    const ladderW = showLadder ? 110 : 0
    const padB = 18
    const plotW = W - axisW - ladderW
    const plotH = H - padB
    if (plotW < 60 || plotH < 60) return

    ctx.fillStyle = BG
    ctx.fillRect(0, 0, W, H)

    const G = geom(plotW, plotH)
    const tNow = now()
    const tMin = tNow - span
    if (!G || !G.cols.length) {
      ctx.fillStyle = '#8b93a7'
      ctx.font = '12px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('building local order book…', W / 2, H / 2)
      return
    }
    const { pTop, pBot, binSize, midNow } = G
    const p2y = (p: number) => p2yOf(p, pTop, pBot, plotH)

    // offscreen depth layer (rebuild when geometry signature changes)
    const sig = `${span}|${vspan}|${binMult}|${contrast}|${plotW}x${plotH}|${G.anchor.toFixed(0)}`
    if (!heatRef.current || sigRef.current !== sig) {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const hc = heatRef.current ?? document.createElement('canvas')
      hc.width = Math.max(1, Math.floor(plotW * dpr))
      hc.height = Math.max(1, Math.floor(plotH * dpr))
      const hctx = hc.getContext('2d')!
      hctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      heatRef.current = hc
      sigRef.current = sig
      drawStateRef.current = { pxTotal: 0, pxShifted: 0, rawDrawn: 0, lastColsLen: -1, acc: null }
    }
    const hc = heatRef.current!
    renderDepthInto(hc, G, plotW, plotH)

    // 1. depth layer
    ctx.drawImage(hc, 0, 0, plotW, plotH)

    // 1b. left-edge fade — old columns dissolve instead of hard-cutting
    const fade = ctx.createLinearGradient(0, 0, 96, 0)
    fade.addColorStop(0, 'rgba(7,10,18,0.95)')
    fade.addColorStop(1, 'rgba(7,10,18,0)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, 96, plotH)

    const aggs = aggsRef.current
    const xOf = (t: number) => ((t - tMin) / span) * plotW

    // 2. grid (above depth, subtle) + brighter labels
    ctx.strokeStyle = 'rgba(255,255,255,0.055)'
    ctx.lineWidth = 1
    ctx.font = '10px ui-monospace, monospace'
    const rows = 10
    ctx.textAlign = 'left'
    for (let i = 0; i <= rows; i++) {
      const p = pBot + ((pTop - pBot) * i) / rows
      const y = p2y(p)
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke()
      ctx.fillStyle = '#9aa3b8'
      ctx.fillText(fmtPrice(p, meta.tick), plotW + 5, y + 3)
    }

    // 2. decision lines (nearest big walls)
    if (aggs?.buyAbove) {
      const y = p2y(aggs.buyAbove)
      if (y > 8 && y < plotH - 8) {
        ctx.strokeStyle = 'rgba(240,185,11,0.75)'
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke()
        ctx.setLineDash([])
        label(ctx, `SELL BELOW ${fmtPrice(aggs.buyAbove, meta.tick)}`, 6, y - 5, '#f0b90b')
      }
    }
    if (aggs?.sellBelow) {
      const y = p2y(aggs.sellBelow)
      if (y > 8 && y < plotH - 8) {
        ctx.strokeStyle = 'rgba(240,185,11,0.75)'
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke()
        ctx.setLineDash([])
        label(ctx, `BUY ABOVE ${fmtPrice(aggs.sellBelow, meta.tick)}`, 6, y + 12, '#f0b90b')
      }
    }

    // 3. last-price guide line across the plot
    {
      const y = p2y(midNow)
      ctx.strokeStyle = 'rgba(240,185,11,0.32)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke()
    }

    // 4. POC
    if (aggs?.poc) {
      const y = p2y(aggs.poc)
      if (y > 4 && y < plotH - 4) {
        ctx.strokeStyle = 'rgba(240,185,11,0.5)'
        ctx.setLineDash([2, 4]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke()
        ctx.setLineDash([])
        label(ctx, 'POC', plotW - 34, y - 5, '#f0b90b')
      }
    }

    // 5-7. trade bubbles, event markers, price line — clipped to the plot so
    // nothing bleeds into the axis / ladder (trade timestamps can skew ±clock)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, plotW, plotH)
    ctx.clip()

    // 5. trade bubbles — BIG, glowing, value-tagged
    if (showBubbles && aggs) {
      for (const d of aggs.dots) {
        const x = xOf(d.t), y = p2y(d.p)
        if (x < -3 || x > plotW + 3 || y < -3 || y > plotH + 3) continue
        ctx.fillStyle = d.buy ? 'rgba(22,199,132,0.55)' : 'rgba(234,57,67,0.55)'
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill()
      }
      const tagged: { x: number; y: number; r: number; n: number; buy: boolean }[] = []
      for (const b of aggs.bubbles) {
        const x = xOf(b.t), y = p2y(b.p)
        if (x < -30 || x > plotW + 30 || y < -30 || y > plotH + 30) continue
        const r = Math.min(27, 5 + 17 * Math.sqrt(b.n / Math.max(1000, bubbleMin * 25)))
        const g0 = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.12, x, y, r)
        if (b.buy) {
          g0.addColorStop(0, 'rgba(120,255,195,0.95)')
          g0.addColorStop(0.55, 'rgba(22,199,132,0.55)')
          g0.addColorStop(1, 'rgba(22,199,132,0.10)')
        } else {
          g0.addColorStop(0, 'rgba(255,135,145,0.95)')
          g0.addColorStop(0.55, 'rgba(234,57,67,0.55)')
          g0.addColorStop(1, 'rgba(234,57,67,0.10)')
        }
        ctx.shadowColor = b.buy ? 'rgba(22,199,132,0.8)' : 'rgba(234,57,67,0.8)'
        ctx.shadowBlur = Math.min(15, r * 0.65)
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = g0
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.lineWidth = 1.3
        ctx.strokeStyle = b.buy ? 'rgba(150,255,205,0.9)' : 'rgba(255,150,158,0.9)'
        ctx.stroke()
        if (r >= 11 && x > 34 && x < plotW - 10 && y > 16 && y < plotH - 16)
          tagged.push({ x, y, r, n: b.n, buy: b.buy })
      }
      // notional tags on the six largest visible trades
      tagged.sort((a, b) => b.n - a.n)
      ctx.font = 'bold 9px ui-monospace, monospace'
      ctx.textAlign = 'center'
      for (const tg of tagged.slice(0, 6)) {
        const txt = fmtCompact(tg.n, '$')
        const w = ctx.measureText(txt).width + 10
        ctx.fillStyle = 'rgba(5,8,14,0.8)'
        ctx.fillRect(tg.x - w / 2, tg.y - tg.r - 18, w, 13)
        ctx.fillStyle = tg.buy ? '#8dffc4' : '#ffa3a9'
        ctx.fillText(txt, tg.x, tg.y - tg.r - 8)
      }
    }

    // 6. pull × and sweep ◆ markers — oversized for visibility
    if (showEvents) {
      const st = getStream()
      ctx.lineWidth = 2.2
      for (const ev of st.pulls.slice(-260)) {
        if (ev.t < tMin) continue
        const x = xOf(ev.t), y = p2y(ev.p)
        if (x < -8 || x > plotW + 8 || y < -8 || y > plotH + 8) continue
        const col = ev.side === 'ask' ? '#ff5d6c' : '#2ee6a8'
        ctx.strokeStyle = col
        ctx.shadowColor = col; ctx.shadowBlur = 7
        ctx.beginPath()
        ctx.moveTo(x - 5.5, y - 5.5); ctx.lineTo(x + 5.5, y + 5.5)
        ctx.moveTo(x + 5.5, y - 5.5); ctx.lineTo(x - 5.5, y + 5.5)
        ctx.stroke()
        ctx.shadowBlur = 0
      }
      for (const ev of st.sweeps.slice(-160)) {
        if (ev.t < tMin) continue
        const x = xOf(ev.t), y = p2y(ev.p)
        if (x < -10 || x > plotW + 10 || y < -10 || y > plotH + 10) continue
        ctx.save()
        ctx.translate(x, y); ctx.rotate(Math.PI / 4)
        ctx.lineWidth = 2.4
        ctx.strokeStyle = AMBER
        ctx.shadowColor = AMBER; ctx.shadowBlur = 8
        ctx.strokeRect(-5, -5, 10, 10)
        ctx.restore()
        ctx.shadowBlur = 0
      }
    }

    // 7. traded price line — dark under-stroke + bright solid line + live dot
    if (aggs?.priceLine.length) {
      ctx.beginPath()
      let started = false
      for (const pt of aggs.priceLine) {
        const x = xOf(pt.t), y = p2y(pt.p)
        if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y)
      }
      ctx.lineWidth = 3.6
      ctx.strokeStyle = 'rgba(4,7,12,0.65)'
      ctx.stroke()
      ctx.lineWidth = 1.7
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.stroke()
      const lp = aggs.priceLine[aggs.priceLine.length - 1]
      ctx.beginPath(); ctx.arc(Math.min(xOf(lp.t), plotW), p2y(lp.p), 3.4, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 9
      ctx.fill()
      ctx.shadowBlur = 0
    }
    ctx.restore()

    // 8. right DOM ladder
    if (showLadder) {
      const lx = plotW + axisW
      const cur = G.cols[G.cols.length - 1]
      const maxQ = Math.max(
        ...cur.bids.filter((l) => l.p >= pBot && l.p <= pTop).map((l) => l.q),
        ...cur.asks.filter((l) => l.p >= pBot && l.p <= pTop).map((l) => l.q), 0.0001,
      )
      const walls = getStream().walls
      const wallSet = new Map(walls.map((w) => [`${w.side}:${Math.round(w.p / binSize)}`, w]))
      ctx.fillStyle = '#0a0d16'
      ctx.fillRect(lx, 0, ladderW, plotH)
      ctx.strokeStyle = '#1a1f2e'
      ctx.beginPath(); ctx.moveTo(lx - 0.5, 0); ctx.lineTo(lx - 0.5, plotH); ctx.stroke()
      const barMax = ladderW - 8
      for (const side of [0, 1]) {
        const levels = (side === 0 ? cur.bids : cur.asks).filter((l) => l.p >= pBot && l.p <= pTop)
        for (const lv of levels) {
          const y = p2y(lv.p)
          const h = Math.max(2, Math.abs(p2y(lv.p - binSize) - y) - 0.5)
          const w = (lv.q / maxQ) * barMax
          const isWall = wallSet.has(`${side === 0 ? 'bid' : 'ask'}:${Math.round(lv.p / binSize)}`)
          ctx.fillStyle = side === 0 ? 'rgba(66,152,255,0.65)' : 'rgba(216,94,255,0.6)'
          ctx.fillRect(side === 0 ? lx + 2 : lx + ladderW - 2 - w, y - h / 2, w, h)
          if (isWall) {
            ctx.strokeStyle = 'rgba(240,185,11,0.9)'
            ctx.lineWidth = 1
            ctx.strokeRect((side === 0 ? lx + 2 : lx + ladderW - 2 - w), y - h / 2, Math.max(6, w), h)
          }
        }
      }
    }

    // current price tag (right axis)
    ctx.fillStyle = '#f0b90b'
    ctx.fillRect(plotW, p2y(midNow) - 8, axisW, 16)
    ctx.fillStyle = '#111318'
    ctx.textAlign = 'center'
    ctx.font = 'bold 10px ui-monospace, monospace'
    ctx.fillText(fmtPrice(midNow, meta.tick), plotW + axisW / 2, p2y(midNow) + 3)

    // time axis
    ctx.fillStyle = '#5b6478'
    ctx.font = '10px ui-monospace, monospace'
    ctx.textAlign = 'center'
    for (let i = 0; i <= 4; i++) {
      const t = tMin + (span * i) / 4
      ctx.fillText(fmtClock(t), Math.min(plotW - 24, Math.max(24, (plotW * i) / 4)), H - 5)
    }

    // crosshair
    const m0 = mouseRef.current
    if (m0 && m0.x < plotW) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(m0.x, 0); ctx.lineTo(m0.x, plotH); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, m0.y); ctx.lineTo(plotW, m0.y); ctx.stroke()
      ctx.setLineDash([])
    }
  }

  function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
    ctx.font = 'bold 9px ui-monospace, monospace'
    const w = ctx.measureText(text).width + 8
    ctx.fillStyle = 'rgba(7,10,18,0.85)'
    ctx.fillRect(x, y - 8, w, 13)
    ctx.fillStyle = color
    ctx.textAlign = 'left'
    ctx.fillText(text, x + 4, y + 2)
  }

  useRaf(draw, true, 33)

  // ------------------------------------------------ hover tooltip
  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    mouseRef.current = { x, y }
    const axisW = 62, ladderW = showLadder ? 110 : 0
    const plotW = size.w - axisW - ladderW
    if (x > plotW) { setHover(null); return }
    const G = geom(plotW, size.h - 18)
    if (!G) { setHover(null); return }
    const { pTop, pBot, binSize, tMin } = G
    const plotH = size.h - 18
    const p = pTop - (y / plotH) * (pTop - pBot)
    const t = tMin + (x / plotW) * span
    const st = getStream()
    const col = st.heatCols[st.heatCols.length - 1]
    let bidQ = 0, askQ = 0
    if (col) {
      for (const lv of col.bids) if (Math.abs(lv.p - p) < binSize) { bidQ = lv.q * lv.p; break }
      for (const lv of col.asks) if (Math.abs(lv.p - p) < binSize) { askQ = lv.q * lv.p; break }
    }
    const aggs = aggsRef.current
    let traded = 0
    if (aggs) {
      const bucket = Math.round(p / binSize) * binSize
      for (const [bp, v] of aggs.pocMap) if (Math.abs(bp - bucket) < binSize) { traded = v; break }
    }
    const pulls = st.pulls.filter((ev) => ev.t >= tMin && Math.abs(ev.p - p) < binSize * 1.5).slice(-3)
      .map((ev) => ({ size: ev.size, side: ev.side, lasted: ev.lasted, count: ev.count }))
    const wall = getStream().walls.find((w) => Math.abs(w.p - p) < binSize * 1.5)
      ?? null
    const sweep = st.sweeps.filter((ev) => ev.t >= tMin && Math.abs(ev.p - p) < binSize).length
    setHover({ x, y, p, t, bidQ, askQ, traded, pulls, wall: wall ? { side: wall.side, q: wall.q, firstSeen: wall.firstSeen, pulls: wall.pulls } : null, sweep })
  }

  // ------------------------------------------------ HTML: walls banner + stats
  const walls = usePoll(() => getStream().walls, 1000)
  const bookTop = usePoll(() => getStream().bookTop, 250)
  const stBeat = usePoll(() => getStream().status, 1000)
  const aggsBeat = usePoll(() => getStream().lastMsgAt, 1000)
  const pressure = usePoll(() => {
    const stt = getStream()
    const col = stt.heatCols[stt.heatCols.length - 1]
    if (!col || !col.mid) return null
    const lo = col.mid * 0.995, hi = col.mid * 1.005
    let b = 0, a = 0
    for (const l of col.bids) if (l.p >= lo) b += l.q * l.p
    for (const l of col.asks) if (l.p <= hi) a += l.q * l.p
    return b + a > 0 ? { b, a, pct: b / (b + a) } : null
  }, 500)
  const spreadTicks = bookTop && bookTop.a > 0 ? Math.max(1, Math.round((bookTop.a - bookTop.b) / meta.tick)) : null
  const bidWalls = (walls ?? []).filter((w) => w.side === 'bid').slice(0, 2)
  const askWalls = (walls ?? []).filter((w) => w.side === 'ask').slice(0, 2)
  const aggs = aggsRef.current
  const lastTrade = getStream().trades[getStream().trades.length - 1]
  const prevTrade = getStream().trades[getStream().trades.length - 2]
  const tickUp = lastTrade && prevTrade ? lastTrade.p >= prevTrade.p : true

  return (
    <div className="flex h-full flex-col min-h-0" data-testid="panel-heatmap">
      <PanelHeader
        title="Liquidity heatmap"
        sub="Order-book depth over time · big trade bubbles · spoof pull / sweep detection — hover any pixel for L2 detail"
        source={`Binance · local book @4Hz · ${stBeat === 'live' ? 'LIVE' : stBeat.toUpperCase()}`}
        right={
          <div className="flex flex-wrap items-center gap-1">
            {SPANS.map((s) => (
              <button key={s.label} onClick={() => setSpan(s.ms)}
                className={cn(btnCls(span === s.ms))}>{s.label}</button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">±%</span>
            {VSPANS.map((v) => (
              <button key={v} onClick={() => setVspan(v)}
                className={cn(btnCls(vspan === v))}>{v}</button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">bin</span>
            {[1, 2, 5].map((b) => (
              <button key={b} onClick={() => setBinMult(b)}
                className={cn(btnCls(binMult === b))}>{b}×</button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">contrast</span>
            {CONTRASTS.map((c) => (
              <button key={c.label} onClick={() => setContrast(c.v)}
                className={cn(btnCls(contrast === c.v))}>{c.label}</button>
            ))}
            <span className="mx-1 text-[10px] text-muted-foreground">bubbles ≥</span>
            {BUBBLE_MINS.map((b) => (
              <button key={b.v} onClick={() => setBubbleMin(b.v)}
                className={cn(btnCls(bubbleMin === b.v))}>{b.label}</button>
            ))}
            <button onClick={() => setShowBubbles((v) => !v)} className={cn(btnCls(showBubbles))}>Bubbles</button>
            <button onClick={() => setShowEvents((v) => !v)} className={cn(btnCls(showEvents))}>Spoof</button>
            <button onClick={() => setShowLadder((v) => !v)} className={cn(btnCls(showLadder))}>Ladder</button>
          </div>
        }
      />

      {/* wall banner */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-[#0a0d15] px-3 py-1.5">
        {(bidWalls.length || askWalls.length) ? (
          <>
            {bidWalls.map((w) => (
              <WallChip key={`b${w.p}`} w={w} tick={meta.tick} />
            ))}
            {askWalls.map((w) => (
              <WallChip key={`a${w.p}`} w={w} tick={meta.tick} />
            ))}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground">no significant walls within ±1% of mid</span>
        )}
        <span className="ml-auto flex items-center gap-2 font-mono text-[10px]">
          <LegendDot color={BID_LEGEND} label="bid depth" />
          <LegendDot color={ASK_LEGEND} label="ask depth" />
          <LegendDot color={GREEN} label="buy" />
          <LegendDot color={RED} label="sell" />
          <LegendDot color="#2ee6a8" label="pull ×" />
          <LegendDot color={AMBER} label="sweep ◆ / wall" />
          <span className="ml-1 flex items-center gap-1 text-muted-foreground" title="bubble size ≈ trade notional">
            bubble
            <span className="inline-block size-2.5 rounded-full border border-[#16c784]/60 bg-[#16c784]/20" />
            <span className="inline-block size-4 rounded-full border border-[#16c784]/60 bg-[#16c784]/20" />
            <span className="inline-block size-6 rounded-full border border-[#16c784]/60 bg-[#16c784]/20" />
            <span>{BUBBLE_MINS.find((b) => b.v === bubbleMin)?.label}→big</span>
          </span>
        </span>
      </div>

      {/* stats strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-3 py-1.5 font-mono text-[11px]">
        <span className={cn('font-bold', tickUp ? 'text-[#16c784]' : 'text-[#ea3943]')}>
          {fmtPrice(bookTop ? (bookTop.b + bookTop.a) / 2 : null, meta.tick)}
        </span>
        <span className="text-muted-foreground">
          bid <span className="text-[#16c784]">{fmtPrice(bookTop?.b, meta.tick)}</span>
          {' · '}ask <span className="text-[#ea3943]">{fmtPrice(bookTop?.a, meta.tick)}</span>
        </span>
        <span className="text-muted-foreground">spread <span className="text-foreground">{spreadTicks ?? '—'} tick{spreadTicks === 1 ? '' : 's'}</span></span>
        {pressure && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            depth ±0.5%
            <span className="relative h-2 w-20 overflow-hidden rounded-sm bg-[#ea3943]/60">
              <span className="absolute inset-y-0 left-0 bg-[#16c784]/85" style={{ width: `${(pressure.pct * 100).toFixed(1)}%` }} />
            </span>
            <span><span className="text-[#16c784]">{(pressure.pct * 100).toFixed(0)}%</span><span className="text-muted-foreground"> bid</span></span>
            <span><span className="text-[#ea3943]">{(100 - pressure.pct * 100).toFixed(0)}%</span><span className="text-muted-foreground"> ask</span></span>
          </span>
        )}
        <span className="text-muted-foreground">CVD <span className={cn((aggs?.netBubble ?? 0) >= 0 ? 'text-[#16c784]' : 'text-[#ea3943]')}>{fmtCompact(aggs?.netBubble, '$')}</span> <span className="text-[9px]">({span / 1000}s bubbles)</span></span>
        <span className="text-muted-foreground">POC <span className="text-[#f0b90b]">{fmtPrice(aggs?.poc, meta.tick)}</span></span>
        <span className="text-muted-foreground">prints <span className="text-foreground">{aggs?.tradeRate != null ? `${aggs.tradeRate.toFixed(1)}/s` : '—'}</span></span>
        <span className="text-muted-foreground">bubbles <span className="text-foreground">{aggs?.bubbleCount ?? 0}</span></span>
      </div>

      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="block h-full w-full"
          onMouseMove={onMove}
          onMouseLeave={() => { mouseRef.current = null; setHover(null) }} />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-60 rounded-md border border-border/80 bg-[#0b0e17]/95 px-2.5 py-2 font-mono text-[10px] leading-relaxed shadow-xl"
            style={{
              left: Math.min(hover.x + 14, Math.max(8, size.w - 260)),
              top: Math.min(hover.y + 14, Math.max(8, size.h - 140)),
            }}
          >
            <div className="mb-1 flex justify-between text-[9px] text-muted-foreground">
              <span>{fmtPrice(hover.p, meta.tick)}</span>
              <span>{fmtClock(hover.t)}</span>
            </div>
            <div>
              resting: <span className="text-[#16c784]">bid {fmtCompact(hover.bidQ, '$')}</span>
              {' · '}
              <span className="text-[#ea3943]">ask {fmtCompact(hover.askQ, '$')}</span>
            </div>
            <div className="text-muted-foreground">traded in window: {fmtCompact(hover.traded, '$')}</div>
            {hover.pulls.map((pl, i) => (
              <div key={i} className={pl.side === 'ask' ? 'text-[#ff5d6c]' : 'text-[#2ee6a8]'}>
                × {pl.side} {fmtCompact(pl.size, '$')} pulled before trading · {(pl.lasted / 1000).toFixed(0)}s{pl.count > 1 ? ` · ×${pl.count}` : ''}
              </div>
            ))}
            {hover.sweep > 0 && <div className="text-[#f0b90b]">◆ {hover.sweep} sweep{hover.sweep > 1 ? 's' : ''} consumed here</div>}
            {hover.wall && (
              <div className="text-[#f0b90b]">
                wall: {hover.wall.side} {fmtCompact(hover.wall.q, '$')} · {((Date.now() - hover.wall.firstSeen) / 1000).toFixed(0)}s old
                {hover.wall.pulls > 0 ? ` · ${hover.wall.pulls} pull${hover.wall.pulls > 1 ? 's' : ''} · possible spoof` : ''}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function btnCls(active: boolean) {
  return cn('rounded border px-1.5 py-1 text-[10px]',
    active ? 'border-[#4da3ff]/60 bg-[#4da3ff]/15 text-[#4da3ff]' : 'border-border text-muted-foreground hover:text-foreground')
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-muted-foreground">
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function WallChip({ w, tick }: { w: { side: 'bid' | 'ask'; p: number; q: number; firstSeen: number; pulls: number }; tick: number }) {
  const age = (Date.now() - w.firstSeen) / 1000
  const spoofish = w.pulls >= 2 || age < 12
  const bid = w.side === 'bid'
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-medium',
        bid ? 'border-[#16c784]/40 bg-[#16c784]/10 text-[#16c784]' : 'border-[#ea3943]/40 bg-[#ea3943]/10 text-[#ea3943]')}
    >
      {bid ? 'bid wall' : 'ask wall'} {fmtCompact(w.q, '$')}@{fmtPrice(w.p, tick)}
      <span className="text-muted-foreground">{age < 90 ? `${age.toFixed(0)}s` : `${(age / 60).toFixed(0)}m`}</span>
      {w.pulls > 0 && <span className="text-muted-foreground">· {w.pulls} pulls</span>}
      {spoofish && <span className="rounded bg-[#f0b90b]/15 px-1 text-[9px] text-[#f0b90b]">possible spoof</span>}
    </span>
  )
}
