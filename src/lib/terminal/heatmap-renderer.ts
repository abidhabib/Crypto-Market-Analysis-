import type { HeatCol, Trade } from './types'
import { binDepth, bubbleRadius, groupTrades, reactionCodes, reactionColors, type HeatmapReaction, type LiquidityZone } from './heatmap-model'

export const BID_COLOR = '#38bdf8'
export const ASK_COLOR = '#f5b94c'
export interface HeatmapView {
  width: number; height: number; end: number; span: number; mid: number
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
  const left = 12, top = 22, bottom = Math.max(top + 1, v.height - 32)
  const profile = v.showProfile && v.width >= 560 ? 62 : 0
  const right = Math.max(left + 1, v.width - 86 - profile)
  const high = v.mid * (1 + v.range / 100), low = v.mid * (1 - v.range / 100)
  const start = v.end - v.span
  return { left, top, bottom, right, profile, high, low, start,
    x: (t: number) => left + (t - start) / v.span * (right - left),
    y: (p: number) => top + (high - p) / (high - low) * (bottom - top),
  }
}

const ramp = (r: number, g: number, b: number) => Array.from({ length: 64 }, (_, i) =>
  `rgba(${r},${g},${b},${0.02 + Math.pow(i / 63, 1.15) * 0.43})`)
const bids = ramp(56, 189, 248), asks = ramp(245, 185, 76)
const usd = (v: number) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}m` : `$${(v / 1000).toFixed(0)}k`

export function getTradeBubbles(v: HeatmapView) {
  if (v.mid <= 0) return []
  const g = heatmapGeometry(v)
  const timeStep = Math.max(500, Math.ceil(v.span / Math.max(1, g.right - g.left) * 26 / 500) * 500)
  const priceStep = v.step * Math.max(1, Math.ceil((g.high - g.low) / Math.max(1, g.bottom - g.top) * 22 / v.step))
  return groupTrades(v.trades, g.start, v.end, timeStep, priceStep, v.minTrade)
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
  ctx.fillStyle = '#090f18'; ctx.fillRect(0, 0, w, h)
  if (w < 130 || h < 90 || v.mid <= 0) return
  const g = heatmapGeometry(v), { left, top, bottom, right, profile, x, y, start, high, low } = g
  const visible = v.columns.filter(c => c.t >= start - 3000 && c.t <= v.end)
  const latest = visible[visible.length - 1]
  const reference = latest ? [...binDepth(latest.bids, v.step).values(), ...binDepth(latest.asks, v.step).values()].sort((a, b) => a - b) : []
  const ref = reference[Math.floor(reference.length * 0.9)] || 1
  ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, bottom - top); ctx.clip()

  // Timestamp-based sampling keeps a full rolling buffer scrolling correctly.
  // Each screen bucket uses its most recent observed snapshot, never a replay.
  const sampled = new Map<number, HeatCol>()
  const columnWidth = Math.max(3, (right - left) / 260)
  for (const col of visible) sampled.set(Math.floor((x(col.t) - left) / columnWidth), col)
  const samples = [...sampled.values()]
  for (let i = 0; i < samples.length; i++) {
    const col = samples[i], cx = x(col.t)
    const nextTime = Math.min(samples[i + 1]?.t ?? v.end, col.t + 3000)
    const cw = Math.max(1, x(nextTime) - cx + 0.3)
    for (const [levels, colors] of [[col.bids, bids], [col.asks, asks]] as const) {
      for (const [price, notional] of binDepth(levels, v.step)) {
        if (price < low || price > high) continue
        const intensity = Math.min(63, Math.floor(Math.log1p(notional / ref * 3) / Math.log(4) * 50 * v.contrast))
        ctx.fillStyle = colors[intensity]
        const cy = y(price + v.step / 2), ch = Math.max(1.5, y(price - v.step / 2) - cy - 0.6)
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
    for (const tr of bubbles) {
      const fraction = tr.buy / tr.usd, angle = -Math.PI / 2 + Math.PI * 2 * fraction
      ctx.shadowBlur = 7; ctx.shadowColor = tr.buy >= tr.sell ? '#22c55e55' : '#ef444455'
      ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r + 1.5, 0, Math.PI * 2)
      ctx.fillStyle = '#07111c'; ctx.fill(); ctx.shadowBlur = 0
      for (const [from, to, fill, edge] of [
        [-Math.PI / 2, angle, '#22c55eaa', '#4ade80'],
        [angle, Math.PI * 1.5, '#ef4444aa', '#fb7185'],
      ] as const) {
        if (to - from < 0.001) continue
        ctx.beginPath(); ctx.moveTo(tr.x, tr.y); ctx.arc(tr.x, tr.y, tr.r, from, to); ctx.closePath()
        ctx.fillStyle = fill; ctx.fill()
        ctx.beginPath(); ctx.arc(tr.x, tr.y, tr.r, from, to)
        ctx.strokeStyle = edge; ctx.lineWidth = 1.5; ctx.stroke()
      }
    }
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
  ctx.strokeStyle = '#08101b'; ctx.lineWidth = 4; ctx.stroke()
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1.7; ctx.stroke()
  const midY = y(v.mid)
  ctx.setLineDash([4, 5]); ctx.strokeStyle = '#e2e8f04d'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(left, midY); ctx.lineTo(right, midY); ctx.stroke(); ctx.setLineDash([])
  if (latest) {
    ctx.beginPath(); ctx.arc(Math.min(right, x(latest.t)), y(latest.mid), 3, 0, Math.PI * 2)
    ctx.fillStyle = '#f8fafc'; ctx.fill()
  }
  for (const e of getReactionMarkers(v)) {
    const color = reactionColors[e.kind]
    ctx.fillStyle = '#101827'; ctx.strokeStyle = color; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.rect(e.x - 8, e.y - 8, 16, 16); ctx.fill(); ctx.stroke()
    ctx.font = 'bold 10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillStyle = color
    ctx.fillText(reactionCodes[e.kind], e.x, e.y + 3.5)
  }
  if (v.pointer && v.pointer.x >= left && v.pointer.x <= right && v.pointer.y >= top && v.pointer.y <= bottom) {
    ctx.strokeStyle = '#dbeafe70'; ctx.setLineDash([3, 4])
    ctx.beginPath(); ctx.moveTo(v.pointer.x, top); ctx.lineTo(v.pointer.x, bottom)
    ctx.moveTo(left, v.pointer.y); ctx.lineTo(right, v.pointer.y); ctx.stroke(); ctx.setLineDash([])
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
  ctx.font = '10px ui-monospace, monospace'
  const clock = (t: number) => new Date(t).toISOString().slice(11, 19)
  for (let i = 0; i <= 4; i++) {
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center'
    ctx.fillStyle = '#8494ab'; ctx.fillText(clock(start + v.span * i / 4), left + (right - left) * i / 4, h - 12)
  }
  if (profile && latest) {
    const bx = right + 86
    ctx.fillStyle = '#0d1522'; ctx.fillRect(bx, top, profile, bottom - top)
    const binned = [binDepth(latest.bids, v.step), binDepth(latest.asks, v.step)]
    const max = Math.max(1, ...binned.flatMap(m => [...m].filter(([p]) => p >= low && p <= high).map(([, n]) => n)))
    for (let side = 0; side < 2; side++) for (const [p, n] of binned[side]) {
      if (p < low || p > high) continue
      ctx.fillStyle = side === 0 ? BID_COLOR : ASK_COLOR; ctx.globalAlpha = 0.65
      ctx.fillRect(bx + 3, y(p + v.step / 2), n / max * (profile - 7), Math.max(2, y(p - v.step / 2) - y(p + v.step / 2) - 1))
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#8494ab'; ctx.textAlign = 'left'
    ctx.fillText('NOW', bx + 4, 13)
    ctx.fillText(usd(max), bx + 3, h - 12)
  }
}
