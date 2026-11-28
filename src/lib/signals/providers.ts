import { INTERVAL_MS } from './types.ts'
import type { Bar, Book, Derivatives, Exchange, Heatmap, Market, Timeframe } from './types.ts'

type Row = Record<string, unknown>
type Envelope = { retCode: number; time: number; result: { list: Row[]; [key: string]: unknown } }
const BINANCE = 'https://api.binance.com', FUTURES = 'https://fapi.binance.com', BYBIT = 'https://api.bybit.com'
const cache = new Map<string, { until: number; data: unknown }>()
const inFlight = new Map<string, Promise<unknown>>()
const nextRequest = new Map<string, number>(), bannedUntil = new Map<string, number>()
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const number = (v: unknown): number => typeof v === 'number' || typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Market data unavailable'

async function cached<T>(key: string, until: number, fn: () => Promise<T>): Promise<T> {
  const found = cache.get(key)
  if (found && found.until > Date.now()) return found.data as T
  const pending = inFlight.get(key)
  if (pending) return pending as Promise<T>
  const task = fn().then(data => {
    cache.set(key, { until, data })
    if (cache.size > 1800) for (const key of [...cache.keys()].slice(0, 300)) cache.delete(key)
    return data
  }).finally(() => inFlight.delete(key))
  inFlight.set(key, task)
  return task
}

export async function publicJson<T>(origin: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const host = new URL(origin).host
  const url = new URL(path, origin)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  for (let attempt = 0; attempt < 2; attempt++) {
    if ((bannedUntil.get(host) ?? 0) > Date.now()) throw new Error(`${host}: rate-limit cooldown active`)
    const slot = Math.max(Date.now(), nextRequest.get(host) ?? 0)
    nextRequest.set(host, slot + 150)
    if (slot > Date.now()) await sleep(slot - Date.now())
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: 'no-store' })
      if ([418, 429].includes(res.status)) {
        const retry = Number(res.headers.get('retry-after')) || 120
        bannedUntil.set(host, Date.now() + Math.min(3600, Math.max(60, retry)) * 1000)
        throw new Error(`${host}: rate limit ${res.status}`)
      }
      if (!res.ok) throw new Error(`${host}: HTTP ${res.status}`)
      const data = await res.json()
      if (data.retCode != null && data.retCode !== 0) {
        if (data.retCode === 10006) bannedUntil.set(host, Date.now() + 60_000)
        throw new Error(`${host}: exchange error ${data.retCode}`)
      }
      return data as T
    } catch (e) {
      if (attempt || /rate.limit|HTTP 4|exchange error/.test(errorText(e))) throw e
      await sleep(500)
    }
  }
  throw new Error('Market request failed')
}

export interface MarketProvider {
  exchange: Exchange
  markets(): Promise<Market[]>
  bars(symbol: string, tf: Timeframe, start?: number, end?: number): Promise<Bar[]>
  book(symbol: string): Promise<Book>
  derivatives(symbol: string): Promise<Derivatives>
}

export function provider(exchange: Exchange): MarketProvider {
  return {
    exchange,
    async markets() {
      if (exchange === 'binance') {
        const [info, tickers] = await Promise.all([
          cached('binance:instruments', Date.now() + 3_600_000, () => publicJson<{ symbols: Row[] }>(BINANCE, '/api/v3/exchangeInfo')),
          publicJson<Row[]>(BINANCE, '/api/v3/ticker/24hr'),
        ])
        const map = new Map(tickers.map(t => [t.symbol, t]))
        return info.symbols.filter(s => s.status === 'TRADING' && s.quoteAsset === 'USDT' && s.isSpotTradingAllowed !== false).flatMap(s => {
          const t = map.get(s.symbol)
          if (!t) return []
          const filters = s.filters as Row[]
          return [{ symbol: String(s.symbol), base: String(s.baseAsset), price: number(t.lastPrice), turnover: number(t.quoteVolume), change: number(t.priceChangePercent) / 100,
            tick: number(filters.find(f => f.filterType === 'PRICE_FILTER')?.tickSize), step: number(filters.find(f => f.filterType === 'LOT_SIZE')?.stepSize),
            minNotional: number(filters.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL')?.minNotional) }]
        })
      }
      const [info, tickers] = await Promise.all([
        cached('bybit:instruments', Date.now() + 3_600_000, () => publicJson<Envelope>(BYBIT, '/v5/market/instruments-info', { category: 'spot' })),
        publicJson<Envelope>(BYBIT, '/v5/market/tickers', { category: 'spot' }),
      ])
      const map = new Map(tickers.result.list.map(t => [t.symbol, t]))
      return info.result.list.filter(s => s.status === 'Trading' && s.quoteCoin === 'USDT' && String(s.innovation ?? '0') !== '1').flatMap(s => {
        const t = map.get(s.symbol), lot = s.lotSizeFilter as Row, price = s.priceFilter as Row
        if (!t) return []
        return [{ symbol: String(s.symbol), base: String(s.baseCoin), price: number(t.lastPrice), turnover: number(t.turnover24h), change: number(t.price24hPcnt),
          tick: number(price.tickSize), step: number(lot.basePrecision), minNotional: number(lot.minOrderAmt) }]
      })
    },
    async bars(symbol, tf, start, end) {
      if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) throw new Error('Invalid USDT symbol')
      const interval = INTERVAL_MS[tf], historical = start != null || end != null
      const key = `${exchange}:${symbol}:${tf}:${start ?? ''}:${end ?? Math.floor(Date.now() / interval)}`
      return cached(key, historical ? Date.now() + 30_000 : (Math.floor(Date.now() / interval) + 1) * interval + 2000, async () => {
        if (exchange === 'binance') {
          const rows = await publicJson<unknown[][]>(BINANCE, '/api/v3/klines', { symbol, interval: tf, limit: historical ? 1000 : 260,
            ...(start != null ? { startTime: start } : {}), ...(end != null ? { endTime: end } : {}) })
          return rows.map(r => ({ t: number(r[0]), o: number(r[1]), h: number(r[2]), l: number(r[3]), c: number(r[4]), v: number(r[5]), quote: number(r[7]), buy: number(r[9]) }))
        }
        const rows = await publicJson<{ retCode: number; result: { list: string[][] } }>(BYBIT, '/v5/market/kline', { category: 'spot', symbol, interval: interval / 60_000, limit: historical ? 1000 : 260,
          ...(start != null ? { start } : {}), ...(end != null ? { end } : {}) })
        return rows.result.list.map(r => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5], quote: +r[6] })).sort((a, b) => a.t - b.t)
      })
    },
    async book(symbol) {
      let bids: string[][], asks: string[][], at: number
      if (exchange === 'binance') {
        const r = await publicJson<{ bids: string[][]; asks: string[][] }>(BINANCE, '/api/v3/depth', { symbol, limit: 100 })
        bids = r.bids; asks = r.asks; at = Date.now()
      } else {
        const r = await publicJson<{ retCode: number; result: { b: string[][]; a: string[][]; ts: number } }>(BYBIT, '/v5/market/orderbook', { category: 'spot', symbol, limit: 100 })
        bids = r.result.b; asks = r.result.a; at = r.result.ts
      }
      if (!bids.length || !asks.length) throw new Error('Empty order book')
      const bid = +bids[0][0], ask = +asks[0][0], mid = (bid + ask) / 2
      return { at, bid, ask, bidUsd: bids.filter(r => +r[0] >= mid * 0.995).reduce((s, r) => s + +r[0] * +r[1], 0),
        askUsd: asks.filter(r => +r[0] <= mid * 1.005).reduce((s, r) => s + +r[0] * +r[1], 0) }
    },
    async derivatives(symbol) {
      if (exchange === 'binance') {
        const [mark, oi, ratios] = await Promise.all([
          publicJson<Row>(FUTURES, '/fapi/v1/premiumIndex', { symbol }),
          publicJson<Row[]>(FUTURES, '/futures/data/openInterestHist', { symbol, period: '5m', limit: 3 }),
          publicJson<Row[]>(FUTURES, '/futures/data/globalLongShortAccountRatio', { symbol, period: '5m', limit: 1 }),
        ])
        if (oi.length < 2 || !ratios.length) throw new Error('Insufficient derivatives history')
        oi.sort((a, b) => number(a.timestamp) - number(b.timestamp))
        const latest = oi[oi.length - 1]
        return { at: Math.min(number(latest.timestamp), number(ratios[0].timestamp), number(mark.time)), funding: number(mark.lastFundingRate),
          oi: number(latest.sumOpenInterest), oiChange: (number(latest.sumOpenInterest) / number(oi[0].sumOpenInterest) - 1) * 100,
          longShortRatio: number(ratios[0].longShortRatio) }
      }
      const [tickers, interest, ratios] = await Promise.all([
        publicJson<Envelope>(BYBIT, '/v5/market/tickers', { category: 'linear', symbol }),
        publicJson<Envelope>(BYBIT, '/v5/market/open-interest', { category: 'linear', symbol, intervalTime: '5min', limit: 3 }),
        publicJson<Envelope>(BYBIT, '/v5/market/account-ratio', { category: 'linear', symbol, period: '5min', limit: 1 }),
      ])
      const oi = interest.result.list.sort((a, b) => number(a.timestamp) - number(b.timestamp)), ratio = ratios.result.list[0], ticker = tickers.result.list[0]
      if (oi.length < 2 || !ratio || !ticker) throw new Error('Insufficient derivatives history')
      const latest = oi[oi.length - 1]
      return { at: Math.min(number(latest.timestamp), number(ratio.timestamp), tickers.time), funding: number(ticker.fundingRate),
        oi: number(latest.openInterest), oiChange: (number(latest.openInterest) / number(oi[0].openInterest) - 1) * 100,
        longShortRatio: number(ratio.buyRatio) / number(ratio.sellRatio) }
    },
  }
}

/** Optional server-owned adapter. No guessed liquidation levels are substituted. */
export async function liquidationHeatmap(exchange: Exchange, symbol: string): Promise<Heatmap | undefined> {
  if (!process.env.SIGNALS_HEATMAP_URL) return undefined
  const url = new URL(process.env.SIGNALS_HEATMAP_URL)
  url.searchParams.set('exchange', exchange); url.searchParams.set('symbol', symbol)
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store',
    headers: process.env.SIGNALS_HEATMAP_KEY ? { Authorization: `Bearer ${process.env.SIGNALS_HEATMAP_KEY}` } : {} })
  if (!r.ok) throw new Error(`Heatmap provider HTTP ${r.status}`)
  const data = await r.json()
  if (data.exchange !== exchange || data.symbol !== symbol || !Number.isFinite(data.at) || typeof data.source !== 'string'
    || !Array.isArray(data.clusters) || data.clusters.length > 5000 || !data.clusters.every((c: Row) =>
      Number.isFinite(c.price) && number(c.price) > 0 && Number.isFinite(c.usd) && number(c.usd) >= 0 && ['long', 'short'].includes(String(c.side)))) {
    throw new Error('Invalid heatmap provider response')
  }
  return { at: data.at, source: data.source.slice(0, 100), clusters: data.clusters }
}

export function eligibleMarket(m: Market, minTurnover: number): boolean {
  return /^[A-Z0-9]{2,30}USDT$/.test(m.symbol) && !/(UP|DOWN|BULL|BEAR|[235]L|[235]S)USDT$/.test(m.symbol)
    && !['USDC', 'USDP', 'TUSD', 'FDUSD', 'DAI', 'USDE', 'USD1'].includes(m.base)
    && [m.price, m.turnover, m.change, m.tick, m.step, m.minNotional].every(Number.isFinite)
    && m.price > 0 && m.tick > 0 && m.step > 0 && m.minNotional > 0 && m.turnover >= minTurnover && Math.abs(m.change) < 0.3
}

/** Bounded workers: a large universe never causes an unbounded Promise.all. */
export async function mapConcurrent<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) { const item = items[cursor++]; await fn(item) }
  }))
}
