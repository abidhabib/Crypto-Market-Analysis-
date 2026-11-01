import type { Candle } from './types'
import type { MapLine } from './heatmap-orderflow'
import { ema, valueArea } from './indicators'
import { fmtCompact, fmtPrice } from './format'
import { whaleRadius, type WhaleAnalysis, type WhaleEvent } from './whales-model'

export const WHALE_BUY = '#22c58b', WHALE_SELL = '#f15766'
const DIM = '#78889e', GRID = '#252525', BG = '#0c0c0c'
export interface WhalesView {
  width: number; height: number; start: number; end: number; low: number; high: number; timeframe: number; tick: number; step: number
  candles: readonly Candle[]; analysis: WhaleAnalysis; averages: boolean; zones: boolean; profile: boolean; allProfile: boolean
  ema: boolean; cvd: boolean; maxBubbles: number; minRadius: number; maxRadius: number; opacity: number; labels: number
  lines: readonly MapLine[]
}
export function whalesGeometry(width: number, height: number, profile = true, cvd = true) {
  const left = 10, right = Math.max(80, width - 82 - (profile ? width >= 900 ? 120 : width >= 600 ? 76 : 0 : 0))
  const top = 29, bottom = Math.max(120, height - 27)
  const mainBottom = top + (bottom - top) * (cvd ? 0.69 : 0.82)
  const volumeTop = mainBottom + 20, volumeBottom = cvd ? top + (bottom - top) * 0.845 : bottom
  const flowTop = volumeBottom + 22
  return { left, right, top, bottom, mainBottom, volumeTop, volumeBottom, flowTop, flowBottom: bottom, profileLeft: right + 8, profileRight: width - 79 }
}
export function whalesProjection(v: WhalesView) {
  const g = whalesGeometry(v.width, v.height, v.profile, v.cvd)
  return { ...g, x: (t: number) => g.left + (t - v.start) / (v.end - v.start) * (g.right - g.left),
    y: (price: number) => g.top + (v.high - price) / (v.high - v.low) * (g.mainBottom - g.top) }
}
export function whaleBubblePoints(v: WhalesView) {
  const p = whalesProjection(v), max = Math.max(1, ...v.analysis.events.map(e => e.total))
  const shown = [...v.analysis.events].sort((a, b) => b.total - a.total).slice(0, v.maxBubbles)
  return shown.map(event => ({ event, x: p.x(event.t), y: p.y(event.price), r: whaleRadius(event.total, max, v.minRadius, v.width < 600 ? Math.min(20, v.maxRadius) : v.maxRadius) }))
    .filter(b => b.y >= p.top - b.r && b.y <= p.mainBottom + b.r)
}
export type WhaleBubblePoint = ReturnType<typeof whaleBubblePoints>[number]

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color = GRID) {
  ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = DIM, align: CanvasTextAlign = 'left') {
  ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, y)
}
function priceLine(ctx: CanvasRenderingContext2D, v: WhalesView, price: number, name: string, color: string, dashed = true, occupied: number[] = []) {
  const p = whalesProjection(v), y = p.y(price)
  if (y < p.top + 10 || y > p.mainBottom - 8) return
  ctx.setLineDash(dashed ? [6, 4] : [2, 3]); line(ctx, p.left, y, p.right, y, color); ctx.setLineDash([])
  const text = `${name}  ${fmtPrice(price, v.tick)}`
  let baseline = y - 4
  while (occupied.some(previous => Math.abs(previous - baseline) < 15) && baseline + 15 < p.mainBottom - 4) baseline += 15
  occupied.push(baseline)
  ctx.fillStyle = '#0c0c0cef'; ctx.fillRect(p.left + 2, baseline - 11, Math.min(p.right - p.left - 10, ctx.measureText(text).width + 12), 14)
  label(ctx, text, p.left + 7, baseline, color)
}

export function drawWhales(ctx: CanvasRenderingContext2D, v: WhalesView) {
  const p = whalesProjection(v), a = v.analysis
  ctx.clearRect(0, 0, v.width, v.height); ctx.fillStyle = BG; ctx.fillRect(0, 0, v.width, v.height)
  ctx.font = '10px ui-monospace, SFMono-Regular, monospace'; ctx.lineWidth = 1; ctx.textBaseline = 'alphabetic'
  ctx.save(); ctx.beginPath(); ctx.rect(p.left, p.top, p.right - p.left, p.mainBottom - p.top); ctx.clip()
  if (a.first !== null && a.first > v.start) {
    const x = p.x(a.first); ctx.fillStyle = '#fbbf2405'; ctx.fillRect(p.left, p.top, x - p.left, p.mainBottom - p.top)
  }
  for (const gap of a.gapRanges.slice(-100)) {
    const x = p.x(gap.from), width = Math.max(2, p.x(gap.to) - x)
    ctx.fillStyle = '#fbbf2410'; ctx.fillRect(x, p.top, width, p.mainBottom - p.top)
  }
  for (let i = 0; i <= 6; i++) {
    const y = p.top + (p.mainBottom - p.top) * i / 6
    line(ctx, p.left, y, p.right, y)
  }
  for (let i = 0; i <= 8; i++) {
    const x = p.left + (p.right - p.left) * i / 8
    line(ctx, x, p.top, x, p.mainBottom)
  }
  const occupiedZones: number[] = []
  const zoneLabels: { text: string; width: number; baseline: number; color: string }[] = []
  if (v.zones) for (const side of ['buy', 'sell'] as const) {
    const zones = side === 'buy' ? a.buyZones : a.sellZones
    for (const z of zones) {
      const y = p.y(z.price), band = Math.max(12, Math.abs(p.y(z.price + v.step / 2) - p.y(z.price - v.step / 2)))
      const color = side === 'buy' ? WHALE_BUY : WHALE_SELL
      ctx.fillStyle = color + '10'; ctx.fillRect(p.left, y - band / 2, p.right - p.left, band)
      if (v.width > 680 && y > p.top + 10 && y < p.mainBottom - 10) {
        let baseline = y - 4
        while (occupiedZones.some(previous => Math.abs(previous - baseline) < 14) && baseline + 14 < p.mainBottom - 4) baseline += 14
        occupiedZones.push(baseline)
        const text = `${fmtCompact(z[side], '$')} large ${side === 'buy' ? 'buying' : 'selling'} here`, width = ctx.measureText(text).width
        zoneLabels.push({ text, width, baseline, color })
      }
    }
  }
  const candleWidth = Math.max(1.5, Math.min(18, (p.right - p.left) * v.timeframe / (v.end - v.start) * 0.72))
  for (const c of v.candles) {
    if (c.t + v.timeframe < v.start || c.t > v.end) continue
    const x = p.x(c.t + v.timeframe / 2), color = c.c >= c.o ? WHALE_BUY : WHALE_SELL
    line(ctx, x, p.y(c.h), x, p.y(c.l), color)
    ctx.fillStyle = color; ctx.fillRect(x - candleWidth / 2, Math.min(p.y(c.o), p.y(c.c)), candleWidth, Math.max(1.5, Math.abs(p.y(c.c) - p.y(c.o))))
  }
  if (v.ema) for (const [period, color] of [[20, '#e5be35'], [50, '#a18bd6']] as const) {
    const values = ema(v.candles.map(c => c.c), period)
    ctx.strokeStyle = color; ctx.lineWidth = 1.25; ctx.beginPath(); let drawing = false
    v.candles.forEach((c, i) => {
      const value = values[i]
      if (value === null) return
      const x = p.x(c.t + v.timeframe / 2), y = p.y(value)
      if (!drawing) { ctx.moveTo(x, y); drawing = true } else ctx.lineTo(x, y)
    })
    ctx.stroke(); ctx.lineWidth = 1
  }
  const points = whaleBubblePoints(v)
  for (const b of points) {
    const buyShare = b.event.buy / b.event.total
    ctx.globalAlpha = v.opacity
    for (const [share, offset, color] of [[buyShare, 0, WHALE_BUY], [1 - buyShare, buyShare, WHALE_SELL]] as const) {
      if (share <= 0) continue
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.arc(b.x, b.y, b.r, -Math.PI / 2 + offset * Math.PI * 2, -Math.PI / 2 + (offset + share) * Math.PI * 2); ctx.closePath(); ctx.fillStyle = color; ctx.fill()
    }
    ctx.globalAlpha = 0.95; ctx.strokeStyle = b.event.buy >= b.event.sell ? WHALE_BUY : WHALE_SELL
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1
    if (b.r >= 9) {
      ctx.font = 'bold 10px ui-monospace, monospace'
      label(ctx, b.event.buy > b.event.sell * 1.5 ? '▲' : b.event.sell > b.event.buy * 1.5 ? '▼' : '↕', b.x, b.y + 3, '#f3f8fb', 'center')
      ctx.font = '10px ui-monospace, SFMono-Regular, monospace'
    }
  }
  const occupied: { x: number; y: number }[] = []
  for (const b of points.slice(0, v.labels)) {
    let y = b.y - b.r - 7
    if (occupied.some(o => Math.abs(o.x - b.x) < 65 && Math.abs(o.y - y) < 14)) y = b.y + b.r + 14
    if (y < p.top + 10 || y > p.mainBottom - 5) continue
    occupied.push({ x: b.x, y })
    const text = fmtCompact(b.event.total, '$'), width = ctx.measureText(text).width
    ctx.fillStyle = '#0c0c0cde'; ctx.fillRect(b.x - width / 2 - 3, y - 10, width + 6, 13)
    label(ctx, text, b.x, y, '#e1eaf1', 'center')
  }
  for (const z of zoneLabels) {
    ctx.fillStyle = '#0c0c0ceb'; ctx.fillRect(p.right - z.width - 12, z.baseline - 10, z.width + 8, 13)
    label(ctx, z.text, p.right - 8, z.baseline, z.color, 'right')
  }
  ctx.restore()
  for (let i = 0; i <= 6; i++) {
    const price = v.high - (v.high - v.low) * i / 6
    label(ctx, fmtPrice(price, v.tick), v.width - 9, p.y(price) + 3, DIM, 'right')
  }
  if (a.first !== null && a.first > v.start && a.first < v.end) {
    const x = p.x(a.first); ctx.setLineDash([3, 4]); line(ctx, x, p.top, x, p.mainBottom, '#b99a37'); ctx.setLineDash([])
    label(ctx, 'Trades recorded from here →', Math.min(p.right - 180, Math.max(p.left + 6, x + 7)), p.top + 13, '#d1b44b')
  }
  const occupiedLines: number[] = []
  if (v.averages) {
    if (a.buyVwap !== null) priceLine(ctx, v, a.buyVwap, 'Buyers’ avg', WHALE_BUY, true, occupiedLines)
    if (a.sellVwap !== null) priceLine(ctx, v, a.sellVwap, 'Sellers’ avg', WHALE_SELL, true, occupiedLines)
  }
  for (const overlay of v.lines) priceLine(ctx, v, overlay.price, overlay.label, overlay.color, true, occupiedLines)
  const lastPrice = a.observed.at(-1)?.p ?? v.candles.at(-1)?.c
  if (lastPrice) priceLine(ctx, v, lastPrice, 'Last execution', '#a7b7ca', false, occupiedLines)
  if (v.profile && p.profileRight - p.profileLeft > 20) {
    const rows = v.allProfile ? a.allProfile : a.profile, center = (p.profileLeft + p.profileRight) / 2, half = (p.profileRight - p.profileLeft) / 2
    const maximum = Math.max(1, ...rows.map(r => Math.max(r.buy, r.sell))), area = valueArea(rows)
    const rowHeight = Math.max(2, Math.min(40, v.step / (v.high - v.low) * (p.mainBottom - p.top) * 0.9))
    label(ctx, v.allProfile ? 'All recorded $' : 'Detected flow $', center, 17, DIM, 'center')
    for (const row of rows) {
      const y = p.y(row.price)
      if (y < p.top || y > p.mainBottom) continue
      ctx.fillStyle = WHALE_SELL + 'aa'; ctx.fillRect(center - row.sell / maximum * half, y - rowHeight / 2, row.sell / maximum * half, rowHeight)
      ctx.fillStyle = WHALE_BUY + 'aa'; ctx.fillRect(center, y - rowHeight / 2, row.buy / maximum * half, rowHeight)
      if (area?.poc === row.price) { ctx.strokeStyle = '#d5b851'; ctx.strokeRect(p.profileLeft, y - rowHeight / 2, p.profileRight - p.profileLeft, rowHeight) }
    }
  }
  line(ctx, 0, p.mainBottom + 1, v.width, p.mainBottom + 1)
  label(ctx, 'Recorded executions · buy / sell $', p.left + 2, p.volumeTop - 6)
  const volumeMax = Math.max(1, ...a.bars.map(b => b.buy + b.sell))
  const barWidth = Math.max(1, Math.min(24, (p.right - p.left) * v.timeframe / (v.end - v.start) * 0.78))
  for (const b of a.bars) {
    const x = p.x(b.t + v.timeframe / 2), scale = (p.volumeBottom - p.volumeTop - 5) / volumeMax
    if (x < p.left || x > p.right) continue
    ctx.fillStyle = WHALE_BUY + '88'; ctx.fillRect(x - barWidth / 2, p.volumeBottom - b.buy * scale, barWidth, b.buy * scale)
    ctx.fillStyle = WHALE_SELL + '88'; ctx.fillRect(x - barWidth / 2, p.volumeBottom - (b.buy + b.sell) * scale, barWidth, b.sell * scale)
  }
  if (v.cvd) {
    line(ctx, 0, p.volumeBottom + 4, v.width, p.volumeBottom + 4)
    const middle = (p.flowTop + p.flowBottom) / 2, half = Math.max(10, (p.flowBottom - p.flowTop) / 2 - 8)
    line(ctx, p.left, middle, p.right, middle)
    const largestCvd = Math.max(1, ...a.bars.map(b => Math.abs(b.largeCvd))), otherCvd = Math.max(1, ...a.bars.map(b => Math.abs(b.otherCvd))), barMax = Math.max(1, ...a.bars.map(b => Math.abs(b.largeNet)))
    label(ctx, `Large net ${fmtCompact(a.net, '$')} · bars: candle Δ (own scale)`, p.left + 2, p.flowTop - 6, a.net >= 0 ? WHALE_BUY : WHALE_SELL)
    if (v.width > 720) label(ctx, `Other trades ${fmtCompact(a.otherNet, '$')} · dashed · separate CVD scales`, p.right - 5, p.flowTop - 6, '#7cb8d7', 'right')
    let previous: { x: number; y: number; other: number } | null = null
    for (const b of a.bars) {
      const x = p.x(b.t + v.timeframe / 2)
      if (x < p.left || x > p.right) continue
      const y = middle - b.largeCvd / largestCvd * half, other = middle - b.otherCvd / otherCvd * half
      const height = b.largeNet / barMax * half * 0.55
      ctx.fillStyle = (b.largeNet >= 0 ? WHALE_BUY : WHALE_SELL) + '60'; ctx.fillRect(x - barWidth / 2, Math.min(middle, middle - height), barWidth, Math.abs(height))
      if (previous) {
        const color = b.largeCvd >= 0 ? WHALE_BUY : WHALE_SELL
        ctx.fillStyle = color + '14'; ctx.beginPath(); ctx.moveTo(previous.x, middle); ctx.lineTo(previous.x, previous.y); ctx.lineTo(x, y); ctx.lineTo(x, middle); ctx.closePath(); ctx.fill()
        line(ctx, previous.x, previous.y, x, y, color)
        ctx.setLineDash([4, 3]); line(ctx, previous.x, previous.other, x, other, '#7cb8d7'); ctx.setLineDash([])
      }
      previous = { x, y, other }
    }
  }
  for (let i = 0; i <= 7; i++) {
    const time = v.start + (v.end - v.start) * i / 7
    const date = new Date(time), text = v.end - v.start > 86400000 ? date.toISOString().slice(5, 10) : date.toISOString().slice(11, 16)
    label(ctx, text, p.left + (p.right - p.left) * i / 7, v.height - 8, DIM, i === 0 ? 'left' : i === 7 ? 'right' : 'center')
  }
  return points
}

export function drawWhalesCursor(ctx: CanvasRenderingContext2D, v: WhalesView, point: { x: number; y: number } | null, bubble: WhaleBubblePoint | null) {
  if (!point) return
  const p = whalesProjection(v)
  if (point.x < p.left || point.x > p.right || point.y < p.top || point.y > p.flowBottom) return
  ctx.save(); ctx.lineWidth = 1; line(ctx, point.x, p.top, point.x, p.flowBottom, '#71869b80')
  if (point.y <= p.mainBottom) line(ctx, p.left, point.y, p.right, point.y, '#71869b80')
  if (bubble) { ctx.strokeStyle = '#f2ca54'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bubble.x, bubble.y, bubble.r + 3, 0, Math.PI * 2); ctx.stroke() }
  ctx.restore()
}

export function nearestWhale(points: readonly WhaleBubblePoint[], pointer: { x: number; y: number } | null): WhaleBubblePoint | null {
  if (!pointer) return null
  let found: WhaleBubblePoint | null = null, distance = Infinity
  for (const point of points) {
    const d = Math.hypot(point.x - pointer.x, point.y - pointer.y)
    if (d <= Math.max(12, point.r + 4) && d < distance) { found = point; distance = d }
  }
  return found
}

export function whaleTooltipPriceChange(event: WhaleEvent, currentPrice: number | null) {
  return currentPrice !== null && currentPrice > 0 ? (currentPrice / event.price - 1) * 100 : null
}
