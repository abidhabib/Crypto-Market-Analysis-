import { NextRequest, NextResponse } from 'next/server'

const INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d'])
const cache = new Map<string, { at: number; data: unknown }>()

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T
  const data = await fn()
  cache.set(key, { at: Date.now(), data })
  if (cache.size > 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 50)
    for (const [k] of oldest) cache.delete(k)
  }
  return data
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const symbol = (sp.get('symbol') || 'BTCUSDT').toUpperCase()
  const interval = sp.get('interval') || '1m'
  const limit = Math.min(1000, Math.max(10, parseInt(sp.get('limit') || '600', 10) || 600))
  if (!/^[A-Z0-9]{5,12}$/.test(symbol) || !INTERVALS.has(interval)) {
    return NextResponse.json({ error: 'bad params' }, { status: 400 })
  }
  try {
    const rows = await cached(`kl:${symbol}:${interval}:${limit}`, 3000, async () => {
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`binance ${res.status}`)
      return res.json()
    })
    // compact: [openTime, o, h, l, c, v, quoteVol, trades]
    const out = (rows as any[][]).map((r) => [r[0], +r[1], +r[2], +r[3], +r[4], +r[5], +r[7], r[8]])
    return NextResponse.json({ symbol, interval, candles: out }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: `upstream: ${(e as Error).message}` }, { status: 502 })
  }
}
