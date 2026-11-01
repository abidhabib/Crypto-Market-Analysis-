'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

/** Re-render at a fixed cadence with the latest value produced by select(). */
export function usePoll<T>(select: () => T, intervalMs: number): T {
  const [value, setValue] = useState<T>(select)
  const selectRef = useRef(select)
  useEffect(() => {
    selectRef.current = select
  })
  useEffect(() => {
    const id = setInterval(() => setValue(selectRef.current()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return value
}

/** rAF-driven draw loop for canvas panels, throttled to minMs (0 = every frame). */
export function useRaf(draw: () => void, active = true, minMs = 0) {
  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
  })
  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = 0
    const loop = (t: number) => {
      if (t - last >= minMs) {
        last = t
        drawRef.current()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [active, minMs])
}

/** ResizeObserver-driven canvas sizing with devicePixelRatio scaling. */
export function useCanvasSize(canvasRef: React.RefObject<HTMLCanvasElement | null>, maxDpr = 2) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const parent = el.parentElement
    if (!parent) return
    const ro = new ResizeObserver(() => {
      const w = parent.clientWidth
      const h = parent.clientHeight
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1)
      el.width = Math.max(1, Math.floor(w * dpr))
      el.height = Math.max(1, Math.floor(h * dpr))
      el.style.width = `${w}px`
      el.style.height = `${h}px`
      const ctx = el.getContext('2d')
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      setSize({ w, h })
    })
    ro.observe(parent)
    return () => ro.disconnect()
  }, [canvasRef, maxDpr])
  return size
}

/** Global keyboard shortcuts; ignores typing contexts and modifier combos. */
export function useHotkeys(handler: (key: string) => void) {
  const hRef = useRef(handler)
  useEffect(() => {
    hRef.current = handler
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      hRef.current(e.key.toLowerCase())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** UTC clock ticking every interval; 0 during SSR/hydration. */
export function useNow(intervalMs = 1000): number {
  return useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, intervalMs)
      return () => clearInterval(id)
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => 0,
  )
}
