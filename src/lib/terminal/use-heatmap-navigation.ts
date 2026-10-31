'use client'

import { useEffect, useRef, useState } from 'react'
import { panViewport, zoomViewport, type MapBounds, type MapViewport } from './heatmap-navigation'

/** Native non-passive wheel handling keeps trackpad pinch inside the chart. */
export function useHeatmapNavigation(canvas: React.RefObject<HTMLCanvasElement | null>, viewport: MapViewport,
  bounds: MapBounds, plot: { left: number; top: number; right: number; bottom: number }, onChange: (v: MapViewport) => void) {
  const current = useRef({ viewport, bounds, plot, onChange })
  const [dragging, setDragging] = useState(false)
  useEffect(() => { current.current = { viewport, bounds, plot, onChange } })
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    let frame = 0, queued: MapViewport | null = null
    const pointers = new Map<number, { x: number; y: number }>()
    const commit = (v: MapViewport) => {
      queued = v
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        if (queued) { current.current.viewport = queued; current.current.onChange(queued); queued = null }
      })
    }
    const point = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const within = (p: { x: number; y: number }) => {
      const g = current.current.plot; return p.x >= g.left && p.x <= g.right && p.y >= g.top && p.y <= g.bottom
    }
    const wheel = (e: WheelEvent) => {
      const p = point(e), c = current.current, g = c.plot
      const onPriceAxis = p.x > g.right && p.x <= g.right + 86 && p.y >= g.top && p.y <= g.bottom
      if ((!within(p) && !onPriceAxis) || c.bounds.mid <= 0) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      const v = queued ?? c.viewport
      if (!onPriceAxis && Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey && !e.metaKey) {
        commit(panViewport(v, c.bounds, -e.deltaX * unit / (g.right - g.left), 0))
      } else {
        const factor = Math.exp(Math.max(-0.35, Math.min(0.35, e.deltaY * unit * (e.ctrlKey ? 0.012 : 0.003))))
        commit(zoomViewport(v, c.bounds, factor, (p.x - g.left) / (g.right - g.left), (p.y - g.top) / (g.bottom - g.top), e.shiftKey || onPriceAxis ? 'price' : e.ctrlKey || e.metaKey ? 'both' : 'time'))
      }
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !within(point(e)) || current.current.bounds.mid <= 0) return
      pointers.set(e.pointerId, point(e)); el.setPointerCapture(e.pointerId); setDragging(true)
    }
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      const before = [...pointers.values()], old = pointers.get(e.pointerId)!, p = point(e)
      pointers.set(e.pointerId, p)
      const after = [...pointers.values()], c = current.current, g = c.plot, v = queued ?? c.viewport
      if (before.length === 2) {
        const distance = (a: typeof before) => Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y)
        const oldDistance = distance(before), newDistance = distance(after)
        if (oldDistance < 4 || newDistance < 4) return
        const anchor = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 }
        const next = zoomViewport(v, c.bounds, oldDistance / newDistance, (anchor.x - g.left) / (g.right - g.left), (anchor.y - g.top) / (g.bottom - g.top))
        commit(panViewport(next, c.bounds, ((after[0].x + after[1].x) / 2 - anchor.x) / (g.right - g.left), ((after[0].y + after[1].y) / 2 - anchor.y) / (g.bottom - g.top)))
      } else if (before.length === 1) commit(panViewport(v, c.bounds, (p.x - old.x) / (g.right - g.left), (p.y - old.y) / (g.bottom - g.top)))
    }
    const up = (e: PointerEvent) => { pointers.delete(e.pointerId); if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId); if (!pointers.size) setDragging(false) }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up)
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('wheel', wheel); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('lostpointercapture', up)
    }
  }, [canvas])
  return dragging
}
