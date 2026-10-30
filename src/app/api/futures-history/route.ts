import { NextRequest, NextResponse } from 'next/server'

/** Funding-rate history + open-interest history from Binance futures public data. */
const cache = new Map<string, { at: number; data: unknown }>()

async function jget(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') || 'BTCUSDT').toUpperCase()
  if (!/^[A-Z0-9]{5,12}$/.test(symbol)) return NextResponse.json({ error: 'bad params' }, { status: 400 })

  const key = `futh:${symbol}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 60000) return NextResponse.json(hit.data, { headers: { 'Cache-Control': 'no-store' } })

  try {
    const [funding, oiHist] = await Promise.all([
      jget(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=120`).catch(() => []),
      jget(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=180`).catch(() => []),
    ])
    const out = {
      symbol,
      funding: (Array.isArray(funding) ? funding : []).map((f: any) => ({ t: +f.fundingTime, rate: +f.fundingRate })),
      oiHistory: (Array.isArray(oiHist) ? oiHist : []).map((o: any) => ({ t: +o.timestamp, oi: +o.sumOpenInterest, usd: +o.sumOpenInterestValue })),
      asOf: Date.now(),
    }
    cache.set(key, { at: Date.now(), data: out })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: `upstream: ${(e as Error).message}` }, { status: 502 })
  }
}
