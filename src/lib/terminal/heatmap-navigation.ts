export interface MapViewport { end: number; span: number; center: number; halfRange: number }
export interface MapBounds { earliest: number; latest: number; mid: number }
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))

export function constrainViewport(v: MapViewport, b: MapBounds): MapViewport {
  const span = clamp(v.span, 10000, 600000)
  const earliestEnd = Math.min(b.latest, b.earliest + span)
  return { span, end: clamp(v.end, earliestEnd, b.latest),
    center: clamp(v.center, b.mid * 0.95, b.mid * 1.05),
    halfRange: clamp(v.halfRange, b.mid * 0.00005, b.mid * 0.02) }
}

/** Keep the time and price under the cursor fixed, unless a recording bound is hit. */
export function zoomViewport(v: MapViewport, b: MapBounds, factor: number, x: number, y: number, axis: 'time' | 'price' | 'both' = 'both') {
  x = clamp(x, 0, 1); y = clamp(y, 0, 1)
  const span = axis === 'price' ? v.span : clamp(v.span * factor, 10000, 600000)
  const halfRange = axis === 'time' ? v.halfRange : clamp(v.halfRange * factor, b.mid * 0.00005, b.mid * 0.02)
  return constrainViewport({ span, halfRange,
    end: v.end + (span - v.span) * (1 - x),
    center: v.center + (v.halfRange - halfRange) * (1 - 2 * y) }, b)
}

export function panViewport(v: MapViewport, b: MapBounds, dx: number, dy: number) {
  return constrainViewport({ ...v, end: v.end - dx * v.span, center: v.center + dy * v.halfRange * 2 }, b)
}
