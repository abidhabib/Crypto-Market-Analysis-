import { NextResponse } from 'next/server'

/**
 * GET /api/symbol-info?symbol=BTCUSDT
 * → { symbol, tick } from Binance exchangeInfo (cached 1h).
 * Used to give scanner-picked symbols exact tick sizes.
 */

interface InfoCache { t: number; tick: number }
const cache = new Map<string, InfoCache>()
const TTL = 3_600_000

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const symbol = (searchParams.get('symbol') || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) {
    return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  }
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.t < TTL) return NextResponse.json({ symbol, tick: hit.tick })

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetch(`https://api.binance.com/api/v3/exchangeInfo?symbol=${symbol}`, {
      signal: ctrl.signal, cache: 'no-store',
    })
    clearTimeout(timer)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const filters = data?.symbols?.[0]?.filters ?? []
    const pf = filters.find((x: { filterType: string }) => x.filterType === 'PRICE_FILTER')
    const tick = pf ? +pf.tickSize : NaN
    if (!isFinite(tick) || tick <= 0) throw new Error('no tick')
    cache.set(symbol, { t: Date.now(), tick })
    return NextResponse.json({ symbol, tick })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'lookup failed' }, { status: 502 })
  }
}
