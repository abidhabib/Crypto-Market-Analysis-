import { NextRequest, NextResponse } from 'next/server'

/**
 * Backfills historical aggTrades (pages backwards through Binance aggTrade ids)
 * so Footprint / Volume-profile / Whale panels have a data window before the
 * live stream fills it. Returns compact rows: [id, price, qty, ts, isBuyerMaker]
 */
const cache = new Map<string, { at: number; data: unknown }>()

async function fetchPage(symbol: string, fromId?: number): Promise<any[]> {
  const url = `https://api.binance.com/api/v3/aggTrades?symbol=${symbol}&limit=1000${fromId ? `&fromId=${fromId}` : ''}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`binance ${res.status}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const symbol = (sp.get('symbol') || 'BTCUSDT').toUpperCase()
  const pages = Math.min(8, Math.max(1, parseInt(sp.get('pages') || '5', 10) || 5))
  if (!/^[A-Z0-9]{5,12}$/.test(symbol)) return NextResponse.json({ error: 'bad params' }, { status: 400 })

  const key = `ft:${symbol}:${pages}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 15000) return NextResponse.json(hit.data, { headers: { 'Cache-Control': 'no-store' } })

  try {
    const all: any[] = []
    let firstId = Infinity
    for (let i = 0; i < pages; i++) {
      const page = await fetchPage(symbol, i === 0 ? undefined : Math.max(1, firstId - 1000))
      if (!page.length) break
      for (const t of page) all.push([t.a, +t.p, +t.q, t.T, t.m])
      firstId = page[0].a
      if (i === 0 && page.length < 1000) break
    }
    all.sort((a, b) => a[0] - b[0])
    const out = {
      symbol,
      trades: all,
      from: all.length ? all[0][3] : null,
      to: all.length ? all[all.length - 1][3] : null,
    }
    cache.set(key, { at: Date.now(), data: out })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: `upstream: ${(e as Error).message}` }, { status: 502 })
  }
}
