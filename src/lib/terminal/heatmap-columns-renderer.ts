import { columnInfo, type HeatmapColumn, type OrderFlow } from './heatmap-orderflow'
import type { HeatmapView, heatmapGeometry } from './heatmap-renderer'

export function columnLayout(width: number, selected: readonly HeatmapColumn[] = []) {
  let budget = width >= 900 ? width - 460 : width >= 640 ? width - 370 : 0
  const shown: { id: HeatmapColumn; width: number; offset: number }[] = []
  let offset = 0
  for (const id of selected) {
    const w = columnInfo[id].width
    if (w > budget) continue
    shown.push({ id, width: w, offset }); offset += w; budget -= w
  }
  return { shown, width: offset, hidden: selected.filter(id => !shown.some(c => c.id === id)) }
}
const compact = (n: number) => Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}K` : Math.abs(n) >= 1 ? n.toFixed(1) : n ? n.toPrecision(2) : '—'
const green = '#49dca6', red = '#ff7d89', muted = '#7f90a7'

export function drawOrderFlowColumns(ctx: CanvasRenderingContext2D, v: HeatmapView, flow: OrderFlow, g: ReturnType<typeof heatmapGeometry>) {
  const layout = columnLayout(v.width, v.selectedColumns)
  const rows = flow.sorted.filter(r => r.price >= g.low && r.price <= g.high)
  const height = Math.max(1, g.y(g.low + v.step / 2) - g.y(g.low + v.step * 1.5))
  const maxBook = Math.max(1, ...rows.flatMap(r => [r.bid, r.ask, r.removedBid, r.removedAsk]))
  const maxTrade = Math.max(1, ...rows.flatMap(r => [r.buy, r.sell]))
  const max = (fn: (r: typeof rows[number]) => number) => Math.max(1, ...rows.map(fn))
  const text = (s: string, x: number, y: number, color = muted, align: CanvasTextAlign = 'right') => { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y) }
  ctx.save()
  for (const col of layout.shown) {
    const x = g.right + 86 + col.offset, w = col.width
    ctx.fillStyle = '#111111'; ctx.fillRect(x, 0, w, g.bottom + 1)
    ctx.strokeStyle = '#ffffff12'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, g.bottom); ctx.stroke()
    ctx.font = '10px ui-monospace, monospace'
    if (col.id === 'tape') {
      text('TAPE · observed 60s', x + 6, 12, muted, 'left')
      const total = flow.tapeBuy + flow.tapeSell
      const share = total ? flow.tapeBuy / total : 0.5
      ctx.fillStyle = '#16c78430'; ctx.fillRect(x + 2, 17, (w - 4) * share, 13)
      ctx.fillStyle = '#ef444430'; ctx.fillRect(x + 2 + (w - 4) * share, 17, (w - 4) * (1 - share), 13)
      text(compact(flow.tapeBuy), x + 5, 27, green, 'left'); text(compact(flow.tapeSell), x + w - 5, 27, red)
      const prints = flow.tape.filter(t => t.p * t.q >= (v.tapeMin ?? 0)).slice(0, Math.max(0, Math.floor((g.bottom - 39) / 17)))
      for (let i = 0; i < prints.length; i++) {
        const t = prints[i], y = 44 + i * 17
        ctx.fillStyle = t.m ? '#ef444411' : '#16c78411'; ctx.fillRect(x + 2, y - 10, w - 4, 15)
        text(new Date(t.t).toISOString().slice(14, 23), x + 5, y, muted, 'left')
        text(v.formatPrice(t.p), x + w * 0.69, y, t.m ? red : green)
        text(compact(t.p * t.q), x + w - 5, y, t.p * t.q >= 100000 ? '#fbbf24' : '#e2e8f0')
      }
      if (!prints.length) text('No matching prints', x + 6, 50, muted, 'left')
      continue
    }
    if (col.id === 'dom') {
      const labels = ['sold', 'bid', 'price', 'ask', 'bought']
      labels.forEach((label, i) => text(label, x + w * (i + 0.5) / 5, 12, i === 0 ? red : i === 4 ? green : muted, 'center'))
      const total = (field: 'sell' | 'buy' | 'bid' | 'ask') => rows.reduce((n, r) => n + (v.domUnits === 'coin' ? field === 'sell' ? r.sellQty : field === 'buy' ? r.buyQty : r[field] / r.price : r[field]), 0)
      ;[total('sell'), total('bid'), v.domUnits === 'coin' ? 'coin' : 'USDT', total('ask'), total('buy')].forEach((value, i) => text(typeof value === 'string' ? value : compact(value), x + w * (i + 0.5) / 5, 26, i === 0 || i === 3 ? red : i === 1 || i === 4 ? green : muted, 'center'))
    } else {
      text(columnInfo[col.id].label, x + w / 2, 12, muted, 'center')
      text(col.id === 'quotes' ? 'sample changes' : col.id === 'svp' ? 'retained trades' : 'USDT', x + w / 2, 26, '#53647a', 'center')
    }
    ctx.save(); ctx.beginPath(); ctx.rect(x, g.top, w, g.bottom - g.top); ctx.clip()
    const divisor = max(r => col.id === 'depth' ? Math.max(r.bidCum, r.askCum) : col.id === 'volume' ? r.volume : col.id === 'delta' ? Math.abs(r.delta) : col.id === 'cumDelta' ? Math.abs(r.cumDelta) : col.id === 'svp' ? r.recordedBuy + r.recordedSell : col.id === 'quotes' ? r.bidChanges + r.askChanges : r.bid + r.ask)
    for (const r of rows) {
      const cy = g.y(r.price), top = cy - height / 2, h = Math.max(1, height - 0.8), cw = w / 5
      const best = [flow.bestBid, flow.bestAsk].some(p => p !== null && Math.round(p / v.step) === Math.round(r.price / v.step))
      const bar = (value: number, largest: number, bx: number, bw: number, color: string, alpha = 0.22) => {
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(bx, top, Math.min(1, value / largest) * bw, h); ctx.globalAlpha = 1
      }
      if (col.id === 'dom') {
        if (best) { ctx.fillStyle = '#ffffff09'; ctx.fillRect(x, top, w, h); ctx.strokeStyle = '#ffffff26'; ctx.strokeRect(x + cw * 2, top, cw, h) }
        bar(r.sell, maxTrade, x + 1, cw - 2, red); bar(r.bid, maxBook, x + cw + 1, cw - 2, green)
        bar(r.ask, maxBook, x + cw * 3 + 1, cw - 2, red); bar(r.buy, maxTrade, x + cw * 4 + 1, cw - 2, green)
        if (height >= 11) {
          const vals = [v.domUnits === 'coin' ? r.sellQty : r.sell, v.domUnits === 'coin' ? r.bid / r.price : r.bid, r.price, v.domUnits === 'coin' ? r.ask / r.price : r.ask, v.domUnits === 'coin' ? r.buyQty : r.buy]
          vals.forEach((value, i) => { ctx.font = `${(i === 0 && r.sell >= r.buy * 3 && r.sell > 0) || (i === 4 && r.buy >= r.sell * 3 && r.buy > 0) ? 'bold ' : ''}10px ui-monospace, monospace`; text(i === 2 ? v.formatPrice(value) : compact(value), x + cw * (i + 1) - 4, cy + 3, i === 0 || i === 3 ? red : i === 1 || i === 4 ? green : best ? '#f1f5f9' : muted) })
        }
      } else if (col.id === 'book') {
        const half = w / 2
        bar(r.removedBid, maxBook, x + 1, half - 2, green, 0.07); bar(r.removedAsk, maxBook, x + half + 1, half - 2, red, 0.07)
        bar(r.bid, maxBook, x + 1, half - 2, green, r.addedBid ? 0.42 : 0.2); bar(r.ask, maxBook, x + half + 1, half - 2, red, r.addedAsk ? 0.42 : 0.2)
        if (height >= 11) { text(compact(r.bid), x + half - 4, cy + 3, green); text(compact(r.ask), x + w - 4, cy + 3, red) }
      } else if (col.id === 'volume' || col.id === 'svp' || col.id === 'quotes') {
        const buy = col.id === 'quotes' ? r.bidChanges : col.id === 'svp' ? r.recordedBuy : r.buy
        const sell = col.id === 'quotes' ? r.askChanges : col.id === 'svp' ? r.recordedSell : r.sell
        if (col.id === 'svp' && flow.val !== null && flow.vah !== null && r.price >= flow.val && r.price <= flow.vah) { ctx.fillStyle = '#fbbf240a'; ctx.fillRect(x + 1, top, w - 2, h) }
        bar(buy, divisor, x + 2, w - 4, green); bar(sell, divisor, x + 2 + buy / divisor * (w - 4), w - 4, red)
        if (col.id === 'svp' && r.price === flow.poc) { ctx.strokeStyle = '#fbbf24'; ctx.strokeRect(x + 1, top, w - 2, h) }
        if (height >= 11 && buy + sell > 0) text(compact(buy + sell), x + w - 4, cy + 3, '#cbd5e1')
      } else if (col.id === 'delta' || col.id === 'cumDelta') {
        const n = col.id === 'delta' ? r.delta : r.cumDelta, bw = Math.abs(n) / divisor * (w / 2 - 3)
        ctx.fillStyle = n >= 0 ? '#16c78440' : '#ef444440'; ctx.fillRect(n >= 0 ? x + w / 2 : x + w / 2 - bw, top, bw, h)
        if (height >= 11 && n) text((n > 0 ? '+' : '') + compact(n), x + w - 4, cy + 3, n >= 0 ? green : red)
      } else {
        const n = col.id === 'depth' ? (r.price < v.mid ? r.bidCum : r.askCum) : r.bid + r.ask
        bar(n, divisor, x + 1, w - 2, r.price < v.mid ? green : red)
        if (height >= 11 && n) text(compact(n), x + w - 4, cy + 3, '#cbd5e1')
      }
    }
    if (v.pointer && v.pointer.y >= g.top && v.pointer.y <= g.bottom) { ctx.fillStyle = '#ffffff0c'; ctx.fillRect(x, v.pointer.y - height / 2, w, height) }
    ctx.restore()
  }
  ctx.restore()
}
