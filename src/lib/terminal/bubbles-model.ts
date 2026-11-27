/**
 * bubbles-model — normalization for /api/market payloads feeding the
 * Crypto Bubbles panel. Pure and defensive: the panel must render for any
 * payload shape the route (or a proxy in front of it) produces — a bare
 * array, {rows}, or {data} — and must never let a malformed row produce a
 * NaN diameter or crash the render.
 */

export interface BubbleRow {
  s: string
  c: number
  P: number
  h: number
  l: number
  o: number
  q: number
  v: number
}

const num = (x: unknown): number => {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : NaN
  return isFinite(n) ? n : NaN
}

/** Extract and validate rows from an unknown /api/market payload. */
export function normalizeMarketRows(json: unknown, limit = 80): BubbleRow[] {
  const arr: unknown[] = Array.isArray(json)
    ? json
    : Array.isArray((json as { rows?: unknown })?.rows)
      ? (json as { rows: unknown[] }).rows
      : Array.isArray((json as { data?: unknown })?.data)
        ? (json as { data: unknown[] }).data
        : []
  const out: BubbleRow[] = []
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const s = typeof r.s === 'string' ? r.s : typeof r.symbol === 'string' ? r.symbol : ''
    if (!s.endsWith('USDT')) continue
    const row: BubbleRow = {
      s,
      c: num(r.c ?? r.lastPrice),
      P: num(r.P ?? r.priceChangePercent),
      h: num(r.h ?? r.highPrice),
      l: num(r.l ?? r.lowPrice),
      o: num(r.o ?? r.openPrice),
      q: num(r.q ?? r.quoteVolume),
      v: num(r.v ?? r.volume),
    }
    // a bubble needs a real price and real volume; anything else is dropped
    if (!isFinite(row.c) || row.c <= 0 || !isFinite(row.q) || row.q <= 0) continue
    if (!isFinite(row.P)) row.P = 0
    if (!isFinite(row.h) || row.h <= 0) row.h = row.c
    if (!isFinite(row.l) || row.l <= 0) row.l = row.c
    if (!isFinite(row.o) || row.o <= 0) row.o = row.c
    if (!isFinite(row.v) || row.v < 0) row.v = 0
    out.push(row)
  }
  out.sort((a, b) => b.q - a.q)
  return out.slice(0, limit)
}

/** Bubble diameter in px: area ∝ quote volume, hard-clamped, NaN-proof. */
export function bubbleDiameter(q: number, maxQ: number): number {
  if (!isFinite(q) || q <= 0 || !isFinite(maxQ) || maxQ <= 0) return 44
  const d = 44 + Math.sqrt(q / maxQ) * 116
  return Math.round(Math.max(40, Math.min(168, d)))
}
