import { NextResponse } from 'next/server'

/**
 * GET /api/market                       → all Binance-spot USDT pairs, 24h stats
 * GET /api/market?sparks=BTCUSDT,ETHUSDT → 24h of 15m closes per symbol (sparklines)
 *
 * The tickers payload is cached in memory for 30s and concurrent requests
 * share one in-flight upstream fetch, so a busy server does not re-fetch the
 * full Binance 24h ticker set per request. If the upstream fetch fails or
 * times out, the last good payload is served (however old) with an
 * `x-market-stale: 1` header instead of an error; `x-market-as-of` always
 * carries the cache timestamp of the payload being served.
 */

interface CacheEntry { t: number; data: unknown }
const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<unknown>>()
const TTL_TICKERS = 30_000
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

/** Run `fn` at most once per key at a time; concurrent callers share the promise. */
function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) return existing
  const p = fn().finally(() => { inflight.delete(key) })
  inflight.set(key, p as Promise<unknown>)
  return p
}

interface TickerRow {
  s: string; c: number; P: number; h: number; l: number; o: number
  q: number; v: number; n: number; b: number; a: number
}

async function fetchTickerRows(): Promise<TickerRow[]> {
  const all: Record<string, unknown>[] = await jget('https://api.binance.com/api/v3/ticker/24hr', 10_000)
  return all
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
      s: String(d.symbol),
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
    if (hit && Date.now() - hit.t < TTL_TICKERS) {
      return NextResponse.json(hit.data, { headers: { 'x-market-as-of': String(hit.t) } })
    }

    try {
      const rows = await coalesce('tickers', async () => {
        const data = await fetchTickerRows()
        cache.set('tickers', { t: Date.now(), data })
        return data
      })
      const entry = cache.get('tickers')
      return NextResponse.json(rows, { headers: { 'x-market-as-of': String(entry?.t ?? Date.now()) } })
    } catch (e) {
      // Upstream failed or timed out: serve the last good payload, marked
      // stale, rather than an error. Only a cold cache is a hard failure.
      const stale = cache.get('tickers')
      if (stale) {
        return NextResponse.json(stale.data, {
          headers: { 'x-market-stale': '1', 'x-market-as-of': String(stale.t) },
        })
      }
      throw e
    }
  } catch (e) {
    return NextResponse.json({ error: `market data unavailable: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
}
