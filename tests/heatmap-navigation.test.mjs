import { test } from 'node:test'
import assert from 'node:assert/strict'
import { panViewport, zoomViewport, constrainViewport } from '../src/lib/terminal/heatmap-navigation.ts'
const b = { earliest: 0, latest: 1000000, mid: 100 }
const v = { end: 800000, span: 120000, center: 100, halfRange: 0.3 }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)

test('cursor anchored zoom preserves the inspected time and price', () => {
  const x = 0.32, y = 0.71
  const next = zoomViewport(v, b, 0.7, x, y)
  near(v.end - v.span * (1 - x), next.end - next.span * (1 - x))
  near(v.center + v.halfRange * (1 - 2 * y), next.center + next.halfRange * (1 - 2 * y))
  const back = zoomViewport(next, b, 1 / 0.7, x, y)
  near(back.end, v.end); near(back.span, v.span); near(back.center, v.center); near(back.halfRange, v.halfRange)
})
test('time-only and price-only zoom leave the other axis untouched', () => {
  const time = zoomViewport(v, b, 0.5, 0.5, 0.5, 'time')
  near(time.center, v.center); near(time.halfRange, v.halfRange)
  const price = zoomViewport(v, b, 0.5, 0.5, 0.5, 'price')
  near(price.end, v.end); near(price.span, v.span)
})
test('panning respects recording edges and never moves into the future', () => {
  near(panViewport(v, b, 0.25, 0).end, v.end - v.span * 0.25)
  near(panViewport(v, b, 0, 0.2).center, v.center + v.halfRange * 0.4)
  near(panViewport(v, b, -100, 0).end, b.latest)
  near(panViewport(v, b, 100, 0).end, b.earliest + v.span)
  const short = panViewport(v, { ...b, earliest: 990000 }, 100, 0)
  near(short.end, b.latest)
})
test('extreme gestures are bounded so chart scales stay usable', () => {
  const tiny = zoomViewport(v, b, 1e-9, 0.5, 0.5)
  near(tiny.span, 10000); near(tiny.halfRange, 0.005)
  const huge = zoomViewport(v, b, 1e9, 0.5, 0.5)
  near(huge.span, 600000); near(huge.halfRange, 2)
  near(constrainViewport({ ...v, center: -50 }, b).center, 95)
})
