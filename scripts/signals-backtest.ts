import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { backtest } from '../src/lib/signals/backtest.ts'
import { provider } from '../src/lib/signals/providers.ts'
import { repository } from '../src/lib/signals/repository.ts'
import { INTERVAL_MS } from '../src/lib/signals/types.ts'
import type { Bar, Timeframe } from '../src/lib/signals/types.ts'

const args = process.argv.slice(2)
const value = (name: string, fallback: string) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1] }
const exchange = value('--exchange', 'binance'), symbol = value('--symbol', 'BTCUSDT'), days = Number(value('--days', '180'))
if (!['binance', 'bybit'].includes(exchange) || !/^[A-Z0-9]{2,30}USDT$/.test(symbol) || !Number.isInteger(days) || days < 180 || days > 365) {
  throw new Error('Usage: signals-backtest.ts --exchange binance|bybit --symbol BTCUSDT --days 180..365 --out /absolute/report.json')
}
const feed = provider(exchange as 'binance' | 'bybit'), to = Math.floor(Date.now() / 300_000) * 300_000, from = to - days * 86400_000
const destination = resolve(value('--out', `/tmp/flowlens-${exchange}-${symbol}-${days}d-backtest.json`))
const market = (await feed.markets()).find(m => m.symbol === symbol)
if (!market) throw new Error('Symbol is not currently listed for spot trading on this exchange')

async function history(pair: string, tf: Timeframe): Promise<Bar[]> {
  const interval = INTERVAL_MS[tf], start = Math.floor((from - 260 * interval) / interval) * interval
  const all: Bar[] = []
  for (let cursor = start; cursor < to;) {
    const end = Math.min(to - 1, cursor + 1000 * interval - 1)
    const rows = await feed.bars(pair, tf, cursor, end)
    if (!rows.length) throw new Error(`Missing historical coverage for ${pair} ${tf} at ${new Date(cursor).toISOString()}`)
    all.push(...rows)
    cursor = end + 1
    console.log(`${pair} ${tf}: ${all.length} bars`)
  }
  return all
}

const bars = {} as Record<Timeframe, Bar[]>
for (const tf of ['4h', '1h', '15m', '5m'] as const) bars[tf] = await history(symbol, tf)
const btc = symbol === 'BTCUSDT' ? bars['4h'] : await history('BTCUSDT', '4h')
const eth = symbol === 'ETHUSDT' ? bars['4h'] : await history('ETHUSDT', '4h')
const result = backtest({ exchange: feed.exchange, market, from, to, bars, btc, eth })
await writeFile(destination, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
const { trades: _trades, ...summary } = result
console.log(`Recorded ${_trades.length} historical paper signals`)
const repo = repository()
try { await repo.saveBacktest(summary) } finally { await repo.close() }
console.log(JSON.stringify({ report: destination, ...summary }, null, 2))
