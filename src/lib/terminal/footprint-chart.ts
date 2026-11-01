import type { FootprintBar, FootprintRow } from './footprint-model'

export interface FootprintChartView {
  width: number; height: number; start: number; end: number; low: number; high: number
  interval: number; step: number; bars: readonly FootprintBar[]; selected: number | null
  units: 'coin' | 'usd'; showPoc: boolean; formatPrice: (n: number) => string
}
export const footprintVolume = (n: number): string => {
  const a = Math.abs(n)
  if (!a) return '0'
  if (a < 0.01) return n.toPrecision(2)
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toFixed(a < 10 ? 2 : 0)
}
const signed = (n: number) => `${n > 0 ? '+' : ''}${footprintVolume(n)}`
const buy = '#32c99a', sell = '#ef6372', dim = '#808080'
const utc = (t: number) => new Date(t).toISOString().slice(11, 16)

export function footprintGeometry(v: FootprintChartView) {
  const left = v.width < 500 ? 40 : 56, right = Math.max(left + 1, v.width - 78), top = 26
  const bottom = Math.max(top + 40, v.height - 146)
  return { left, right, top, bottom,
    x: (t: number) => left + (t - v.start) / Math.max(1, v.end - v.start) * (right - left),
    y: (p: number) => top + (v.high - p) / Math.max(1e-12, v.high - v.low) * (bottom - top),
    price: (y: number) => v.high - (y - top) / (bottom - top) * (v.high - v.low),
    time: (x: number) => v.start + (x - left) / (right - left) * (v.end - v.start),
  }
}
export function visibleFootprintBars(v: FootprintChartView) {
  return v.bars.filter(b => b.end > v.start && b.t < v.end)
}
export function footprintHit(v: FootprintChartView, p: { x: number; y: number } | null): { bar: FootprintBar; row?: FootprintRow; price: number } | null {
  if (!p) return null
  const g = footprintGeometry(v)
  if (p.x < g.left || p.x > g.right || p.y < g.top || p.y > v.height - 10) return null
  const time = g.time(p.x), bar = v.bars.find(b => b.t <= time && time < b.end)
  if (!bar) return null
  const price = g.price(p.y)
  const index = Math.floor((price + v.step * 1e-9) / v.step)
  return { bar, row: p.y <= g.bottom ? bar.rows.get(index) : undefined, price }
}

/** Rendering changes with zoom; recorded price bins and statistics never do. */
export function drawFootprintChart(ctx: CanvasRenderingContext2D, v: FootprintChartView) {
  const { width: w, height: h } = v
  ctx.clearRect(0, 0, w, h); ctx.fillStyle = '#0c0c0c'; ctx.fillRect(0, 0, w, h)
  if (w < 140 || h < 230) return
  const g = footprintGeometry(v), bars = visibleFootprintBars(v)
  const scale = ctx.getTransform?.()?.a || 1
  const pixel = (n: number) => Math.round(n * scale) / scale
  const cw = (g.right - g.left) * v.interval / Math.max(1, v.end - v.start)
  const rowH = Math.abs(g.y(v.low) - g.y(v.low + v.step))
  const cellW = Math.min(220, cw * 0.8), labels = cellW >= 64 && rowH >= 12
  ctx.font = '10px ui-monospace, monospace'
  ctx.fillStyle = dim; ctx.textAlign = 'left'
  ctx.fillText(labels ? 'SELL × BUY · executed volume' : 'Scroll / pinch to reveal row values', g.left, 15)
  ctx.strokeStyle = '#222222'; ctx.lineWidth = 1
  const raw = (v.high - v.low) / Math.max(2, Math.floor((g.bottom - g.top) / 65))
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, v.step)))
  const axisStep = Math.max(v.step, Math.ceil(raw / power) * power)
  ctx.textAlign = 'left'
  for (let p = Math.ceil(v.low / axisStep) * axisStep; p <= v.high; p += axisStep) {
    const y = g.y(p); ctx.strokeStyle = '#ffffff09'; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke()
    ctx.fillStyle = dim; ctx.fillText(v.formatPrice(p), g.right + 8, y + 3)
  }
  ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.top, g.right - g.left, g.bottom - g.top); ctx.clip()
  for (const b of bars) {
    const x = g.x(b.t + v.interval / 2), x0 = x - cellW / 2, color = b.c >= b.o ? buy : sell
    const biggest = Math.max(1e-12, ...[...b.rows.values()].map(r => r.buy + r.sell))
    if (v.selected === b.t) { ctx.fillStyle = '#ffffff05'; ctx.fillRect(g.x(b.t), g.top, cw, g.bottom - g.top) }
    ctx.strokeStyle = '#ffffff08'; ctx.beginPath(); ctx.moveTo(g.x(b.t), g.top); ctx.lineTo(g.x(b.t), g.bottom); ctx.stroke()
    for (const r of b.rows.values()) {
      const y = pixel(g.y(r.price + v.step)), rh = Math.max(1 / scale, pixel(rowH - 0.7))
      if (y > g.bottom || y + rowH < g.top) continue
      for (const [side, sx, c] of [['sell', x0, sell], ['buy', x, buy]] as const) {
        const qty = r[side], imbalanced = side === 'buy' ? r.buyImbalance : r.sellImbalance
        if (!qty) continue
        ctx.globalAlpha = imbalanced ? 0.75 : 0.22 + 0.4 * qty / biggest
        ctx.fillStyle = c; ctx.fillRect(pixel(sx), y, pixel(sx + cellW / 2) - pixel(sx), rh); ctx.globalAlpha = 1
      }
      if (v.showPoc && r.price === b.poc) { ctx.strokeStyle = '#d9b54c'; ctx.strokeRect(x0 + 0.5, y + 0.5, cellW - 1, Math.max(1, rh - 1)) }
      if (labels) {
        ctx.font = `${r.buyImbalance || r.sellImbalance ? '600 ' : ''}${Math.min(11, Math.max(10, Math.floor(rowH * 0.55)))}px ui-monospace, monospace`
        ctx.textAlign = 'center'; const baseline = pixel(y + rowH / 2 + 3)
        ctx.fillStyle = r.sellImbalance ? '#ffe0e3' : '#ead8da'; ctx.fillText(footprintVolume(v.units === 'coin' ? r.sell : r.sellUsd), pixel(x0 + cellW / 4), baseline, cellW / 2 - 4)
        ctx.fillStyle = r.buyImbalance ? '#d6ffef' : '#d1e9df'; ctx.fillText(footprintVolume(v.units === 'coin' ? r.buy : r.buyUsd), pixel(x + cellW / 4), baseline, cellW / 2 - 4)
      }
    }
    const railX = pixel(x0 - Math.min(6, cw * 0.08))
    ctx.fillStyle = color
    ctx.fillRect(railX, pixel(g.y(b.h)), 1 / scale, Math.max(1 / scale, pixel(g.y(b.l) - g.y(b.h))))
    ctx.fillRect(pixel(railX - 1), pixel(Math.min(g.y(b.o), g.y(b.c))), 3, Math.max(2, pixel(Math.abs(g.y(b.o) - g.y(b.c)))))
    if (b.gaps || b.partial) { ctx.setLineDash([2, 3]); ctx.strokeStyle = '#d9b54c88'; ctx.strokeRect(x0, g.y(b.h + v.step), cellW, Math.max(rowH, g.y(b.l) - g.y(b.h + v.step))); ctx.setLineDash([]) }
    if (v.showPoc) {
      ctx.strokeStyle = '#d9b54c88'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x0 + cellW, g.y(b.poc + v.step / 2)); ctx.lineTo(g.x(b.end), g.y(b.poc + v.step / 2)); ctx.stroke(); ctx.setLineDash([])
      if (b.t === v.selected) {
        const py = g.y(b.poc + v.step / 2)
        ctx.strokeStyle = '#d9b54c66'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(g.x(b.end), py); ctx.lineTo(g.right, py); ctx.stroke(); ctx.setLineDash([])
        ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.fillStyle = '#d9b54c'; ctx.fillText(`POC ${v.formatPrice(b.poc)}`, g.right - 4, py - 5)
      }
    }
  }
  const latest = bars.at(-1)
  if (latest) {
    const y = g.y(latest.c)
    ctx.setLineDash([2, 4]); ctx.strokeStyle = '#dddddd55'; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke(); ctx.setLineDash([])
  }
  ctx.restore()
  if (latest && latest.c >= v.low && latest.c <= v.high) {
    const y = g.y(latest.c); ctx.fillStyle = '#d6d6d6'; ctx.fillRect(g.right + 1, y - 8, 75, 16); ctx.fillStyle = '#111111'; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillText(v.formatPrice(latest.c), g.right + 6, y + 3)
  }
  // Volume and statistics share the exact same time axis as the footprints.
  const maxVol = Math.max(1e-12, ...bars.map(b => b.buy + b.sell)), metricsTop = g.bottom + 62
  ctx.strokeStyle = '#303030'; ctx.beginPath(); ctx.moveTo(g.left, g.bottom + 16); ctx.lineTo(g.right, g.bottom + 16); ctx.stroke()
  ctx.save(); ctx.beginPath(); ctx.rect(g.left, g.bottom + 17, g.right - g.left, h - g.bottom); ctx.clip()
  let cvd = 0
  for (const b of bars) {
    const x = g.x(b.t + v.interval / 2), bw = Math.max(1, cw * 0.75), vh = (b.buy + b.sell) / maxVol * 30
    ctx.fillStyle = b.delta >= 0 ? '#32c99a77' : '#ef637277'; ctx.fillRect(x - bw / 2, g.bottom + 50 - vh, bw, vh)
    cvd += b.delta
    if (cw >= 40) {
      ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center'
      for (const [i, text, color] of [[0, footprintVolume(b.buy + b.sell), dim], [1, signed(b.delta), b.delta >= 0 ? buy : sell], [2, `${b.deltaPct.toFixed(0)}%`, b.delta >= 0 ? buy : sell], [3, signed(cvd), cvd >= 0 ? buy : sell]] as const) { ctx.fillStyle = color; ctx.fillText(text, x, metricsTop + i * 13, Math.max(20, cw - 4)) }
    }
    if (cw >= 45) { ctx.fillStyle = b.gaps || b.partial ? '#d9b54c' : dim; ctx.fillText(utc(b.t), x, h - 8) }
  }
  ctx.restore(); ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = dim
  for (const [i, label] of ['Vol', 'Delta', 'Δ %', 'CVD*'].entries()) ctx.fillText(label, 6, metricsTop + i * 13)
  if (v.bars[0] && v.bars[0].t > v.start && v.bars[0].t < v.end) {
    const x = g.x(v.bars[0].t)
    ctx.fillStyle = '#a38d4c'; ctx.fillText('Earlier trades not loaded', Math.max(g.left, x - 142), g.top + 12)
  }
  if (!bars.length) { ctx.textAlign = 'center'; ctx.fillText('No recorded executions in this time window', (g.left + g.right) / 2, (g.top + g.bottom) / 2) }
}

export function drawFootprintCursor(ctx: CanvasRenderingContext2D, v: FootprintChartView, point: { x: number; y: number } | null) {
  if (!point) return
  const g = footprintGeometry(v)
  if (point.x < g.left || point.x > g.right || point.y < g.top || point.y > g.bottom) return
  ctx.save(); ctx.strokeStyle = '#ffffff44'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(point.x, g.top); ctx.lineTo(point.x, g.bottom); ctx.moveTo(g.left, point.y); ctx.lineTo(g.right, point.y); ctx.stroke(); ctx.restore()
}
