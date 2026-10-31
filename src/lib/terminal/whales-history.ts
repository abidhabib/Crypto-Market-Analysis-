import type { Trade } from './types'

export interface WhaleHistoryPage {
  symbol: string; trades: Trade[]; nextBefore: number | null; exhausted: boolean
  pages: number; error: string | null; retryAfter: number | null; source: string
}

/** Bounded ID pagination. Returns already-fetched observations if a later page fails. */
export async function fetchWhaleHistory(symbol: string, before: number | null, pages: number,
  request: typeof fetch = fetch, signal = AbortSignal.timeout(18000)): Promise<WhaleHistoryPage> {
  const result: WhaleHistoryPage = { symbol, trades: [], nextBefore: before, exhausted: false, pages: 0, error: null, retryAfter: null, source: 'Binance spot aggTrades' }
  const byId = new Map<number, Trade>()
  let cursor = before
  for (let page = 0; page < Math.min(4, Math.max(1, pages)); page++) {
    if (cursor !== null && cursor <= 1) { result.exhausted = true; break }
    const query = new URLSearchParams({ symbol, limit: '1000' })
    if (cursor !== null) query.set('fromId', String(Math.max(1, cursor - 1000)))
    let rows: unknown = null
    for (const host of ['https://data-api.binance.vision', 'https://api.binance.com']) {
      try {
        const response = await request(`${host}/api/v3/aggTrades?${query}`, { cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]) })
        if (response.status === 429 || response.status === 418) {
          const seconds = Number(response.headers.get('retry-after'))
          result.retryAfter = Math.max(30, Number.isFinite(seconds) ? seconds : 60)
          throw new Error('Exchange rate limit; history loading paused')
        }
        if (!response.ok) throw new Error(`Exchange history returned ${response.status}`)
        rows = await response.json()
        if (!Array.isArray(rows)) throw new Error('Invalid exchange history response')
        result.error = null
        break
      } catch (error) {
        result.error = error instanceof Error ? error.message : 'History source unavailable'
        if (result.retryAfter || signal.aborted) break
      }
    }
    if (!Array.isArray(rows)) break
    const normalized: Trade[] = []
    for (const value of rows) {
      if (!value || typeof value !== 'object') continue
      const row = value as Record<string, unknown>
      const a = Number(row.a), p = Number(row.p), q = Number(row.q), t = Number(row.T)
      if (!Number.isSafeInteger(a) || a < 0 || !(p > 0 && q > 0 && t > 0) || !Number.isFinite(p * q + t) || typeof row.m !== 'boolean' || (cursor !== null && a >= cursor)) continue
      normalized.push({ a, p, q, t, m: row.m })
    }
    normalized.sort((a, b) => a.a - b.a)
    if (!normalized.length) { result.exhausted = true; break }
    for (const t of normalized) byId.set(t.a, t)
    cursor = normalized[0].a
    result.pages++
    if (cursor <= 1) { result.exhausted = true; break }
  }
  result.trades = [...byId.values()].sort((a, b) => a.t - b.t || a.a - b.a)
  result.nextBefore = result.trades.length ? Math.min(...result.trades.map(t => t.a)) : before
  return result
}
