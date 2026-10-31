import { NextRequest, NextResponse } from 'next/server'
import { fetchWhaleHistory, type WhaleHistoryPage } from '@/lib/terminal/whales-history'

const cache = new Map<string, { at: number; page: Promise<WhaleHistoryPage> }>()
let blockedUntil = 0

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const symbol = (params.get('symbol') || 'BTCUSDT').toUpperCase()
  const before = params.has('before') ? Number(params.get('before')) : null
  if (!/^[A-Z0-9]{5,20}$/.test(symbol) || !symbol.endsWith('USDT') || (before !== null && (!Number.isSafeInteger(before) || before < 1))) {
    return NextResponse.json({ error: 'Invalid market or history cursor' }, { status: 400 })
  }
  if (Date.now() < blockedUntil) return NextResponse.json({ error: 'Exchange rate limit; live recording remains available' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((blockedUntil - Date.now()) / 1000)) } })
  const key = `${symbol}:${before ?? 'latest'}`, previous = cache.get(key)
  let page: Promise<WhaleHistoryPage>
  if (previous && Date.now() - previous.at < 15000) page = previous.page
  else {
    for (const [k, v] of cache) if (Date.now() - v.at > 15000) cache.delete(k)
    if (cache.size >= 24) cache.delete(cache.keys().next().value!)
    page = fetchWhaleHistory(symbol, before, 4)
    cache.set(key, { at: Date.now(), page })
  }
  const data = await page
  if (data.retryAfter) blockedUntil = Date.now() + data.retryAfter * 1000
  return NextResponse.json(data, { status: !data.trades.length && data.error ? 502 : 200, headers: { 'Cache-Control': 'no-store' } })
}
