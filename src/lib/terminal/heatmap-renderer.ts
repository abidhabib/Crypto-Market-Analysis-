import type { Candle, HeatCol, Trade } from './types'
import { binnedBook, bubbleRadius, groupTrades, reactionCodes, reactionColors, type HeatmapReaction, type LiquidityZone } from './heatmap-model'

import { columnLayout, drawOrderFlowColumns } from './heatmap-columns-renderer'
import { cumulativeFlow, type HeatmapColumn, type MapLine, type OrderFlow, type recordedLiquidations } from './heatmap-orderflow'

export const BID_COLOR = '#38bdf8'
export const ASK_COLOR = '#f5b94c'
export interface HeatmapView {
  width: number; height: number; end: number; span: number; mid: number
  priceCenter?: number
  selectedColumns?: HeatmapColumn[]
  flowData?: OrderFlow
  flowScope?: 'window' | 'recorded'
  domUnits?: 'usd' | 'coin'
  tapeMin?: number
  showCvd?: boolean
  showQuotes?: boolean
  candles?: Candle[]
  lines?: MapLine[]
  liquidations?: ReturnType<typeof recordedLiquidations>
  bubbleMode?: 'trades' | 'steps'
  bubbleInterval?: number
  range: number; step: number; contrast: number; minTrade: number
  bubbleScale: number
  bubbles?: ReturnType<typeof getTradeBubbles>
  zones?: readonly LiquidityZone[]
  reactions?: readonly HeatmapReaction[]
  showTrades: boolean; showProfile: boolean; columns: readonly HeatCol[]; trades: readonly Trade[]
  formatPrice: (price: number) => string
  pointer: { x: number; y: number } | null
}

export function heatmapGeometry(v: HeatmapView) {
  const left = 12, top = 36
  const cvdHeight = v.showCvd && v.height >= 320 ? 76 : 0
  const bottom = Math.max(top + 1, v.height - 32 - cvdHeight)
  const profile = !v.selectedColumns?.length && v.showProfile && v.width >= 560 ? 62 : 0
  const dataColumns = columnLayout(v.width, v.selectedColumns).width
  const right = Math.max(left + 1, v.width - 86 - profile - dataColumns)
  const center = v.priceCenter ?? v.mid
  const high = center + v.mid * v.range / 100, low = center - v.mid * v.range / 100
  const start = v.end - v.span
  return { left, top, bottom, right, profile, cvdHeight, high, low, start,
    x: (t: number) => left + (t - start) / v.span * (right - left),
    y: (p: number) => top + (high - p) / (high - low) * (bottom - top),
  }
}

// More size brings both lightness and color contrast, not only opacity.
const ramp = (side: 'bid' | 'ask') => Array.from({ length: 64 }, (_, i) => {
  const t = i / 63
  const stops = side === 'bid' ? [[8, 19, 40], [16, 68, 135], [22, 163, 211], [255, 249, 214]] : [[16, 20, 43], [53, 59, 121], [181, 134, 52], [255, 249, 214]]
  const scaled = t * 3, n = Math.min(2, Math.floor(scaled)), f = scaled - n
  const c = stops[n].map((v, k) => Math.round(v + (stops[n + 1][k] - v) * f))
  return `rgba(${c.join(',')},${0.25 + t * 0.7})`
})
const bids = ramp('bid'), asks = ramp('ask')
const usd = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}m` : `$${(v / 1000).toFixed(0)}k`

export function getTradeBubbles(v: HeatmapView) {
  if (v.mid <= 0) return []
  const g = heatmapGeometry(v)
  const timeStep = v.bubbleInterval || Math.max(500, Math.ceil(v.span / Math.max(1, g.right - g.left) * 26 / 500) * 500)
  const priceStep = v.step * Math.max(1, Math.ceil((g.high - g.low) / Math.max(1, g.bottom - g.top) * 22 / v.step))
  return groupTrades(v.trades, g.start, v.end, timeStep, v.bubbleMode === 'steps' ? Number.MAX_VALUE : priceStep, v.minTrade)
    .filter(tr => tr.p >= g.low && tr.p <= g.high)
    .map(tr => ({ ...tr, x: g.x(tr.t), y: g.y(tr.p), r: bubbleRadius(tr.usd, v.bubbleScale) }))
}

export function getReactionMarkers(v: HeatmapView) {
  const g = heatmapGeometry(v)
  const markers: (HeatmapReaction & { x: number; y: number })[] = []
  const candidates = [...(v.reactions ?? [])].filter(e => e.t >= g.start && e.t <= v.end && e.price >= g.low && e.price <= g.high)
    .sort((a, b) => Number(a.kind === 'touch') - Number(b.kind === 'touch') || b.t - a.t)
  for (const e of candidates) {
    const x = g.x(e.t), y = g.y(e.price)
    if (markers.length >= 12 || markers.some(m => Math.hypot(x - m.x, y - m.y) < 25)) continue
    markers.push({ ...e, x, y })
  }
  return markers
}

export function drawHeatmap(ctx: CanvasRenderingContext2D, v: HeatmapView) {
  const { width: w, height: h } = v
  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#070c13'; ctx.fillRect(0, 0, w, h)
  if (w < 130 || h < 90 || v.mid <= 0) return
  const g = heatmapGeometry(v), { left, top, bottom, right, profile, x, y, start, high, low } = g
  const visible = v.columns.filter(c => c.t >= start - 3000 && c.t <= v.end)
  const latest = visible[visible.length - 1]
  const reference = latest ? [...binnedBook(latest, v.step).bid.values(), ...binnedBook(latest, v.step).ask.values()].sort((a, b) => a - b) : []
  const ref = reference[Math.floor(reference.length * 0.9)] || 1
  const gradient = ctx.createLinearGradient(left, 0, left + 80, 0)
  gradient.addColorStop(0, '#081328'); gradient.addColorStop(0.45, '#104487'); gradient.addColorStop(0.75, '#16a3d3'); gradient.addColorStop(1, '#fff9d6')
  ctx.fillStyle = gradient; ctx.fillRect(left, 8, 80, 5)
  ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#70839a'
  ctx.fillText(`Depth USDT · bright ≈ ${usd(ref * (Math.pow(4, 63 / (50 * v.contrast)) - 1) / 3)}`, left, 27)
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip()

  // Timestamp-based sampling keeps a full rolling buffer scrolling correctly.
  // Each screen bucket uses its most recent observed snapshot, never a replay.
  const sampled = new Map<number, HeatCol>()
  const columnWidth = Math.max(1, (right - left) / 700)
  for (const col of visible) sampled.set(Math.floor((x(col.t) - left) / columnWidth), col)
  const samples = [...sampled.values()]
  for (let i = 0; i < samples.length; i++) {
    const col = samples[i], cx = x(col.t)
    const nextTime = Math.min(samples[i + 1]?.t ?? v.end, col.t + 3000)
    const cw = Math.max(1, x(nextTime) - cx + 0.3)
    for (const [levels, colors] of [[binnedBook(col, v.step).bid, bids], [binnedBook(col, v.step).ask, asks]] as const) {
      for (const [price, notional] of levels) {
        if (price < low || price > high) continue
        const intensity = Math.min(63, Math.floor(Math.log1p(notional / ref * 3) / Math.log(4) * 50 * v.contrast))
        ctx.fillStyle = colors[intensity]
        const cy = y(price + v.step / 2), ch = Math.max(1, y(price - v.step / 2) - cy - 0.25)
        ctx.fillRect(cx, cy, cw, ch)
      }
    }
  }

  // Time and price grids share the exact projection used by the data and cursor.
  ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff0b'
  for (let i = 0; i <= 6; i++) {
    const cy = top + (bottom - top) * i / 6
    ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(right, cy); ctx.stroke()
  }
  for (let i = 0; i <= 4; i++) {
    const cx = left + (right - left) * i / 4
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, bottom); ctx.stroke()
  }

  // Candles and quotes are from the same bounded recording as the heatmap.
  if (v.candles?.length) {
    const candleWidth = Math.max(2, Math.min(12, (right - left) / v.span * 45000))
    for (const c of v.candles) {
      if (c.t > v.end || c.t + 60000 < start) continue
      const cx = x(c.t + 30000), up = c.c >= c.o
      ctx.strokeStyle = up ? '#34d39988' : '#fb718588'; ctx.fillStyle = up ? '#16c78455' : '#ef444455'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(cx, y(c.h)); ctx.lineTo(cx, y(c.l)); ctx.stroke()
      ctx.fillRect(cx - candleWidth / 2, Math.min(y(c.o), y(c.c)), candleWidth, Math.max(1, Math.abs(y(c.o) - y(c.c))))
    }
  }
  if (v.showQuotes) for (const side of ['bids', 'asks'] as const) {
    ctx.beginPath(); let previousTime = 0, previousY = 0
    for (const c of visible) {
      if (!c[side].length) { previousTime = 0; continue }
      const p = side === 'bids' ? Math.max(...c.bids.map(l => l.p)) : Math.min(...c.asks.map(l => l.p)), cy = y(p), cx = x(c.t)
      if (!previousTime || c.t - previousTime > 3000) ctx.moveTo(cx, cy)
      else { ctx.lineTo(cx, previousY); ctx.lineTo(cx, cy) }
      previousTime = c.t; previousY = cy
    }
    ctx.lineWidth = 1; ctx.strokeStyle = side === 'bids' ? '#34d399aa' : '#fb7185aa'; ctx.stroke()
  }
  const lineLabels: number[] = []
  for (const l of v.lines ?? []) {
    if (l.price < low || l.price > high) continue
    const cy = y(l.price)
    ctx.lineWidth = 1; ctx.strokeStyle = l.color; ctx.globalAlpha = 0.7; ctx.setLineDash(l.kind === 'liq' ? [2, 5] : [6, 4])
    ctx.beginPath(); ctx.moveTo(left, cy); ctx.lineTo(right, cy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
    if (!lineLabels.some(p => Math.abs(p - cy) < 15)) {
      const label = `${l.label} ${v.formatPrice(l.price)}`
      ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'
      ctx.fillStyle = '#070c13dd'; ctx.fillRect(left + 2, cy - 15, ctx.measureText(label).width + 8, 14)
      ctx.fillStyle = l.color; ctx.fillText(label, left + 6, cy - 5); lineLabels.push(cy)
    }
  }

  // Persistence outlines describe observed duration; no extrapolation before recording.
  const persistent = (v.zones ?? []).filter(z => z.lastSeen - z.firstSeen >= 15000 && z.price >= low && z.price <= high).slice(0, 4)
  const labelRows: number[] = []
  for (const z of persistent) {
    const cy = y(z.price), cx = Math.max(left, x(z.firstSeen))
    const color = z.side === 'bid' ? BID_COLOR : ASK_COLOR
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash([3, 5]); ctx.globalAlpha = 0.6
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(right, cy); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
    if (Math.abs(cy - y(v.mid)) < 22 || labelRows.some(row => Math.abs(row - cy) < 18)) continue
    const age = Math.floor((z.lastSeen - z.firstSeen) / 1000)
    const text = `≥${age}s${z.replenishments ? ` · +${z.replenishments} refills` : ''}`
    ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'right'
    const tw = ctx.measureText(text).width + 10
    ctx.fillStyle = '#090f18df'; ctx.fillRect(right - tw - 4, cy - 16, tw, 14)
    ctx.fillStyle = color; ctx.fillText(text, right - 8, cy - 6); labelRows.push(cy)
  }

  if (v.showTrades) {
    const bubbles = v.bubbles ?? getTradeBubbles(v)
    const whaleThreshold = Math.max(50000, [...bubbles].sort((a, b) => a.usd - b.usd)[Math.floor(bubbles.length * 0.9)]?.usd ?? Infinity)
    for (const tr of bubbles) {
      const fraction = tr.buy / tr.usd, angle = -Math.PI / 2 + Math.PI * 2 * fraction
      ctx.shadowBlur = 3; ctx.shadowColor = tr.buy >= tr.sell ? '#22c55e55' : '#ef444455'
      ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r + 1.5, 0, Math.PI * 2)
      ctx.fillStyle = '#07111c'; ctx.fill(); ctx.shadowBlur = 0
      for (const [from, to, fill, edge] of [
        [-Math.PI / 2, angle, '#16c784cc', '#55dfaa'],
        [angle, Math.PI * 1.5, '#eb4d5ccc', '#ff8790'],
      ] as const) {
        if (to - from < 0.001) continue
        ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.arc(tr.x, tr.y, tr.r, from, to); ctx.closePath()
        ctx.fillStyle = fill; ctx.fill()
        ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, from, to)
        ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke()
      }
    }
    for (const tr of bubbles) if (tr.usd >= whaleThreshold) { ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r + 3.5, 0, Math.PI * 2); ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5; ctx.stroke() }
    // Label only the largest clusters and avoid colliding labels.
    const labels: { x: number; y: number; w: number }[] = []
    ctx.font = '600 11px ui-monospace, monospace'; ctx.textAlign = 'center'
    for (const tr of [...bubbles].reverse()) {
      if (labels.length >= 6 || tr.r < 15) continue
      const text = usd(tr.usd), tw = ctx.measureText(text).width + 12
      const tx = Math.min(right - tw / 2, Math.max(left + tw / 2, tr.x)), ty = tr.y - tr.r - 14
      if (ty < top + 5 || labels.some(l => Math.abs(l.x - tx) < (l.w + tw) / 2 + 6 && Math.abs(l.y - ty) < 20)) continue
      ctx.fillStyle = '#07111ce8'; ctx.fillRect(tx - tw / 2, ty - 9, tw, 18)
      ctx.fillStyle = '#f1f5f9'; ctx.fillText(text, tx, ty + 4)
      labels.push({ x: tx, y: ty, w: tw })
    }
  }

  // Break the mid-price trace across missing snapshots rather than inventing continuity.
  ctx.beginPath()
  let previous = 0
  for (const col of visible) {
    if (!previous || col.t - previous > 3000) ctx.moveTo(x(col.t), y(col.mid))
    else ctx.lineTo(x(col.t), y(col.mid))
    previous = col.t
  }
  ctx.strokeStyle = '#08101b'; ctx.lineWidth = v.showQuotes ? 1.5 : 4; ctx.stroke()
  ctx.strokeStyle = v.showQuotes ? '#e2e8f055' : '#e2e8f0'; ctx.lineWidth = v.showQuotes ? 0.75 : 1.7; ctx.stroke()
  const midY = y(v.mid)
  ctx.setLineDash([4, 5]); ctx.strokeStyle = '#e2e8f04d'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(left, midY); ctx.lineTo(right, midY); ctx.stroke(); ctx.setLineDash([])
  if (latest) {
    ctx.beginPath(); ctx.arc(Math.min(right, x(latest.t)), y(latest.mid), 3, 0, Math.PI * 2)
    ctx.fillStyle = '#f8fafc'; ctx.fill()
  }
  for (const l of v.liquidations ?? []) {
    if (l.p < low || l.p > high) continue
    const cx = x(l.t), cy = y(l.p), r = Math.min(10, Math.max(4, Math.sqrt(l.usd / 10000) * 3))
    ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy); ctx.closePath()
    ctx.fillStyle = '#f472b6aa'; ctx.strokeStyle = '#fbcfe8'; ctx.lineWidth = 1; ctx.fill(); ctx.stroke()
  }
  for (const e of getReactionMarkers(v)) {
    const color = reactionColors[e.kind]
    ctx.fillStyle = '#101827'; ctx.strokeStyle = color; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.rect(e.x - 8, e.y - 8, 16, 16); ctx.fill(); ctx.stroke()
    ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color
    ctx.fillText(reactionCodes[e.kind], e.x, e.y + 3.5)
  }
  ctx.restore()

  ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'
  for (let i = 0; i <= 6; i++) {
    const p = high - (high - low) * i / 6, cy = y(p)
    ctx.fillStyle = '#8494ab'; ctx.fillText(v.formatPrice(p), right + 10, cy + 3)
  }
  if (midY > top && midY < bottom) {
    ctx.fillStyle = '#e2e8f0'; ctx.fillRect(right + 4, midY - 10, 78, 20)
    ctx.font = '600 10px ui-monospace, monospace'; ctx.fillStyle = '#0f172a'
    ctx.fillText(v.formatPrice(v.mid), right + 10, midY + 3)
  }
  const tagged: number[] = [midY]
  for (const l of v.lines ?? []) {
    const cy = y(l.price)
    if (l.price < low || l.price > high || tagged.some(p => Math.abs(p - cy) < 18)) continue
    ctx.fillStyle = l.color; ctx.fillRect(right + 4, cy - 8, 78, 16)
    ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#07111c'
    ctx.fillText(v.formatPrice(l.price), right + 10, cy + 3); tagged.push(cy)
  }
  ctx.font = '10px ui-monospace, monospace'
  const clock = (t: number) => new Date(t).toISOString().slice(11, 19)
  for (let i = 0; i <= 4; i++) {
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center'
    ctx.fillStyle = '#8494ab'; ctx.fillText(clock(start + v.span * i / 4), left + (right - left) * i / 4, h - 12)
  }
  if (profile && latest) {
    const bx = right + 86
    ctx.fillStyle = '#0d1522'; ctx.fillRect(bx, top, profile, bottom - top)
    const binned = [binnedBook(latest, v.step).bid, binnedBook(latest, v.step).ask]
    const max = Math.max(1, ...binned.flatMap(m => [...m].filter(([p]) => p >= low && p <= high).map(([, n]) => n)))
    for (let side = 0; side < 2; side++) for (const [p, n] of binned[side]) {
      if (p < low || p > high) continue
      ctx.fillStyle = side === 0 ? BID_COLOR : ASK_COLOR; ctx.globalAlpha = 0.65
      ctx.fillRect(bx + 3, y(p + v.step / 2), n / max * (profile - 7), Math.max(2, y(p - v.step / 2) - y(p + v.step / 2) - 1))
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#8494ab'; ctx.textAlign = 'left'
    ctx.fillText('DEPTH', bx + 4, 13)
    ctx.fillText(usd(max), bx + 3, h - 12)
  }
  if (v.flowData) drawOrderFlowColumns(ctx, v, v.flowData, g)
  if (g.cvdHeight) {
    const series = cumulativeFlow(v.trades, start, v.end, Math.max(1000, v.span / 120))
    const yTop = bottom + 16, yBottom = h - 34, middle = (yTop + yBottom) / 2
    ctx.fillStyle = '#080f18'; ctx.fillRect(left, yTop - 8, right - left, yBottom - yTop + 9)
    ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#8392a8'; ctx.fillText('CVD · chart-window buy − sell', left + 4, yTop)
    const maxDelta = Math.max(1, ...series.map(s => Math.abs(s.delta))), maxCvd = Math.max(1, ...series.map(s => Math.abs(s.cvd)))
    ctx.strokeStyle = '#ffffff16'; ctx.beginPath(); ctx.moveTo(left, middle); ctx.lineTo(right, middle); ctx.stroke()
    for (const s of series) { const bh = s.delta / maxDelta * 16; ctx.fillStyle = s.delta >= 0 ? '#16c78466' : '#ef444466'; ctx.fillRect(x(s.t), Math.min(middle, middle - bh), Math.max(1, (right - left) / 125), Math.abs(bh)) }
    ctx.beginPath(); series.forEach((s, i) => { const cy = middle - s.cvd / maxCvd * (yBottom - yTop) * 0.35; if (!i) ctx.moveTo(x(s.t), cy); else ctx.lineTo(x(s.t), cy) })
    ctx.strokeStyle = '#7dd3fc'; ctx.lineWidth = 1.3; ctx.stroke()
  }

}

/** Cheap cursor overlay: called without rebuilding the liquidity raster. */
export function drawHeatmapCursor(ctx: CanvasRenderingContext2D, v: HeatmapView) {
  const p = v.pointer, g = heatmapGeometry(v)
  const activeColumn = p ? columnLayout(v.width, v.selectedColumns).shown.find(c => p.x >= g.right + 86 + c.offset && p.x <= g.right + 86 + c.offset + c.width && c.id !== 'tape') : null
  if (!p || v.mid <= 0 || p.x < g.left || (p.x > g.right && !activeColumn) || p.y < g.top || p.y > g.bottom) return
  ctx.save()
  ctx.lineWidth = 1; ctx.strokeStyle = '#cbd5e17a'; ctx.setLineDash([3, 4])
  ctx.beginPath()
  if (p.x <= g.right) { ctx.moveTo(p.x, g.top); ctx.lineTo(p.x, g.bottom) }
  ctx.moveTo(g.left, p.y); ctx.lineTo(g.right, p.y)
  for (const c of columnLayout(v.width, v.selectedColumns).shown) if (c.id !== 'tape') {
    ctx.moveTo(g.right + 86 + c.offset, p.y); ctx.lineTo(g.right + 86 + c.offset + c.width, p.y)
  }
  ctx.stroke(); ctx.setLineDash([])
  const price = g.high - (p.y - g.top) / (g.bottom - g.top) * (g.high - g.low)
  const t = activeColumn ? v.end : g.start + (p.x - g.left) / (g.right - g.left) * v.span
  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(g.right + 4, p.y - 9, 78, 18)
  ctx.fillStyle = '#0b1220'; ctx.textAlign = 'left'; ctx.fillText(v.formatPrice(price), g.right + 10, p.y + 3)
  const tx = Math.max(g.left + 31, Math.min(g.right - 31, p.x))
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(tx - 31, v.height - 25, 62, 18)
  ctx.fillStyle = '#0b1220'; ctx.textAlign = 'center'
  ctx.fillText(new Date(t).toISOString().slice(11, 19), tx, v.height - 12)
  ctx.restore()
}
