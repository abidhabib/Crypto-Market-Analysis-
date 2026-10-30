import { NextResponse } from 'next/server'

/**
 * GET /api/market                       → all Binance-spot USDT pairs, 24h stats
 * GET /api/market?sparks=BTCUSDT,ETHUSDT → 24h of 15m closes per symbol (sparklines)
 */

interface CacheEntry { t: number; data: unknown }
const cache = new Map<string, CacheEntry>()
const TTL_TICKERS = 5_000
const TTL_SPARK = 90_000

const EXCLUDE = /UPUSDT|DOWNUSDT|BULLUSDT|BEARUSDT$/
const STABLE_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'DAI', 'USDP', 'EURI', 'AEUR', 'XUSD', 'USD1', 'BUSD', 'PAXG', 'EUR', 'TRY', 'BRL', 'ARS', 'JPY', 'USDE', 'USDT',
])

async function jget(url: string, timeoutMs = 10_000) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(timer) }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sparks = searchParams.get('sparks')

  try {
    if (sparks) {
      const symbols = sparks.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 12)
      const key = `spark:${symbols.join(',')}`
      const hit = cache.get(key)
      if (hit && Date.now() - hit.t < TTL_SPARK) return NextResponse.json(hit.data)
      const out: Record<string, number[]> = {}
      await Promise.all(symbols.map(async (s) => {
        try {
          const k = await jget(`https://api.binance.com/api/v3/klines?symbol=${s}&interval=15m&limit=32`)
          out[s] = k.map((x: unknown[]) => +(x[4] as string))
        } catch { out[s] = [] }
      }))
      cache.set(key, { t: Date.now(), data: out })
      return NextResponse.json(out)
    }

    const hit = cache.get('tickers')
    if (hit && Date.now() - hit.t < TTL_TICKERS) return NextResponse.json(hit.data)

    const all: Record<string, unknown>[] = await jget('https://api.binance.com/api/v3/ticker/24hr')
    const rows = all
      .filter((d) => {
        const s = String(d.symbol)
        if (!s.endsWith('USDT')) return false
        if (EXCLUDE.test(s)) return false
        const base = s.slice(0, -4)
        if (STABLE_BASES.has(base)) return false
        const q = Number(d.quoteVolume)
        return isFinite(q) && q > 0
      })
      .map((d) => ({
        s: d.symbol,
        c: +d.lastPrice,
        P: +d.priceChangePercent,
        h: +d.highPrice,
        l: +d.lowPrice,
        o: +d.openPrice,
        q: +d.quoteVolume,
        v: +d.volume,
        n: +d.count,
        b: +d.bidPrice,
        a: +d.askPrice,
      }))
      .sort((x, y) => y.q - x.q)
      .slice(0, 150)
    cache.set('tickers', { t: Date.now(), data: rows })
    return NextResponse.json(rows)
  } catch (e) {
    return NextResponse.json({ error: `market data unavailable: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
}
