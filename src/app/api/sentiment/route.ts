import { NextRequest, NextResponse } from 'next/server'

/** Sentiment inputs: Fear&Greed index + Binance futures positioning ratios. */
const cache = new Map<string, { at: number; data: unknown }>()

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T
  const data = await fn()
  cache.set(key, { at: Date.now(), data })
  return data
}

async function jget(url: string): Promise<any> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

export async function GET(req: NextRequest) {
  const symbol = (req.nextUrl.searchParams.get('symbol') || 'BTCUSDT').toUpperCase()
  if (!/^[A-Z0-9]{5,12}$/.test(symbol)) return NextResponse.json({ error: 'bad params' }, { status: 400 })

  try {
    const out = await cached(`sent:${symbol}`, 60000, async () => {
      const [fng, glsr, toplsr, taker] = await Promise.all([
        cached('fng', 1800000, () => jget('https://api.alternative.me/fng/?limit=30')),
        jget(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=2`).catch(() => []),
        jget(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=2`).catch(() => []),
        jget(`https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${symbol}&period=5m&limit=2`).catch(() => []),
      ])
      return {
        fng: {
          value: parseInt(fng?.data?.[0]?.value ?? 'NaN', 10),
          label: fng?.data?.[0]?.value_classification ?? null,
          ts: fng?.data?.[0]?.timestamp ? +fng.data[0].timestamp * 1000 : null,
          history: (fng?.data ?? []).map((d: any) => ({ t: +d.timestamp * 1000, v: +d.value })).reverse(),
        },
        globalLongShort: glsr.length ? { ratio: +glsr.at(-1).longShortRatio, longPct: +glsr.at(-1).longAccount * 100, t: +glsr.at(-1).timestamp } : null,
        topLongShort: toplsr.length ? { ratio: +toplsr.at(-1).longShortRatio, longPct: +toplsr.at(-1).longAccount * 100, t: +toplsr.at(-1).timestamp } : null,
        takerFlow: taker.length ? { buySellRatio: +taker.at(-1).buySellRatio, t: +taker.at(-1).timestamp } : null,
      }
    })
    return NextResponse.json({ ...out, asOf: Date.now() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: `upstream: ${(e as Error).message}` }, { status: 502 })
  }
}
