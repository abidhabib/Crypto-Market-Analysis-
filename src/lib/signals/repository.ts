import { PrismaClient } from '@prisma/client'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { ScanReport, SignalRecord } from './types.ts'
import type { BacktestSummary } from './backtest.ts'
import type { Forecast, ForecastBucket, ForecastScan, MarketType } from '../forecasts/types.ts'

/** Isolated SQLite tables; never runs db push or modifies the app's User/Post tables. */
export class SignalRepository {
  private client: PrismaClient
  private ready: Promise<void> | null = null
  private file: string
  constructor(url = process.env.SIGNALS_DATABASE_URL ?? `file:${resolve('db/signals.db')}`) {
    if (!url.startsWith('file:') || url.includes('?')) throw new Error('SIGNALS_DATABASE_URL must be a SQLite file URL without query parameters')
    this.file = resolve(url.slice(5))
    this.client = new PrismaClient({ datasources: { db: { url: `file:${this.file}` } } })
  }
  async init() {
    if (!this.ready) this.ready = (async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await this.client.$queryRawUnsafe('PRAGMA journal_mode = WAL')
      await this.client.$queryRawUnsafe('PRAGMA busy_timeout = 10000')
      await this.client.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS SignalRecord (
        id TEXT PRIMARY KEY, exchange TEXT NOT NULL, symbol TEXT NOT NULL, mode TEXT NOT NULL,
        status TEXT NOT NULL, generatedAt REAL NOT NULL, payload TEXT NOT NULL)`)
      await this.client.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS signal_history ON SignalRecord(mode, generatedAt DESC)')
      await this.client.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS signal_active ON SignalRecord(status, exchange, symbol)')
      await this.client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SignalScan (id TEXT PRIMARY KEY, startedAt REAL NOT NULL, payload TEXT NOT NULL)')
      await this.client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SignalLease (id TEXT PRIMARY KEY, owner TEXT NOT NULL, expiresAt REAL NOT NULL)')
      await this.client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS SignalBacktest (id TEXT PRIMARY KEY, generatedAt REAL NOT NULL, payload TEXT NOT NULL)')
      await this.client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS MarketForecast (id TEXT PRIMARY KEY, marketType TEXT NOT NULL, symbol TEXT NOT NULL, slot REAL NOT NULL, issuedAt REAL NOT NULL, pending INTEGER NOT NULL, payload TEXT NOT NULL)')
      await this.client.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS forecast_history ON MarketForecast(marketType, issuedAt DESC)')
      await this.client.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS forecast_latest ON MarketForecast(marketType, slot DESC)')
      await this.client.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS forecast_pending ON MarketForecast(pending)')
      await this.client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS ForecastScan (marketType TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    })().catch(e => { this.ready = null; throw e })
    return this.ready
  }
  async acquire(owner: string, now: number, name = 'scanner'): Promise<boolean> {
    await this.init()
    const changed = await this.client.$executeRawUnsafe(`INSERT INTO SignalLease (id, owner, expiresAt) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner = excluded.owner, expiresAt = excluded.expiresAt WHERE SignalLease.expiresAt < ? OR SignalLease.owner = ?`, name, owner, now + 120_000, now, owner)
    return changed === 1
  }
  async release(owner: string, name = 'scanner') {
    await this.client.$executeRawUnsafe('DELETE FROM SignalLease WHERE id = ? AND owner = ?', name, owner)
  }
  async insert(record: SignalRecord): Promise<boolean> {
    await this.init()
    const count = await this.client.$executeRawUnsafe(`INSERT OR IGNORE INTO SignalRecord (id, exchange, symbol, mode, status, generatedAt, payload)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM SignalRecord WHERE exchange = ? AND symbol = ? AND mode = ? AND status IN ('PENDING', 'OPEN'))`,
    record.id, record.exchange, record.symbol, record.mode, record.status, record.generatedAt, JSON.stringify(record), record.exchange, record.symbol, record.mode)
    return count === 1
  }
  async save(record: SignalRecord) {
    await this.init()
    await this.client.$executeRawUnsafe('UPDATE SignalRecord SET status = ?, payload = ? WHERE id = ?', record.status, JSON.stringify(record), record.id)
  }
  async active(): Promise<SignalRecord[]> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>("SELECT payload FROM SignalRecord WHERE status IN ('PENDING', 'OPEN') AND mode = 'paper' ORDER BY generatedAt DESC")
    return rows.map(r => JSON.parse(r.payload))
  }
  async realizedPnl(): Promise<number> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ pnl: number }[]>("SELECT COALESCE(SUM(CAST(json_extract(payload, '$.pnl') AS REAL)), 0) AS pnl FROM SignalRecord WHERE mode = 'paper'")
    return Number(rows[0].pnl)
  }
  async history(since: number, mode = 'paper'): Promise<SignalRecord[]> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM SignalRecord WHERE generatedAt >= ? AND mode = ? ORDER BY generatedAt DESC', since, mode)
    return rows.map(r => JSON.parse(r.payload))
  }
  async saveScan(report: ScanReport) {
    await this.init()
    await this.client.$executeRawUnsafe('INSERT INTO SignalScan (id, startedAt, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload', report.id, report.startedAt, JSON.stringify(report))
    // Scan diagnostics expire after a week; signal records and entry evidence never do.
    await this.client.$executeRawUnsafe('DELETE FROM SignalScan WHERE startedAt < ?', report.startedAt - 7 * 86400_000)
  }
  async lastScan(): Promise<ScanReport | null> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM SignalScan ORDER BY startedAt DESC LIMIT 1')
    return rows.length ? JSON.parse(rows[0].payload) : null
  }
  async saveBacktest(summary: BacktestSummary) {
    await this.init()
    await this.client.$executeRawUnsafe('INSERT INTO SignalBacktest (id, generatedAt, payload) VALUES (?, ?, ?)', summary.id, summary.generatedAt, JSON.stringify(summary))
  }
  async backtests(): Promise<BacktestSummary[]> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM SignalBacktest ORDER BY generatedAt DESC LIMIT 20')
    return rows.map(r => JSON.parse(r.payload))
  }
  async insertForecast(record: Forecast): Promise<boolean> {
    await this.init()
    return (await this.client.$executeRawUnsafe('INSERT OR IGNORE INTO MarketForecast (id, marketType, symbol, slot, issuedAt, pending, payload) VALUES (?, ?, ?, ?, ?, 1, ?)',
      record.id, record.marketType, record.symbol, record.slot, record.issuedAt, JSON.stringify(record))) === 1
  }
  async saveForecast(record: Forecast) {
    await this.init()
    const pending = record.tracking.settledAt == null || record.tracking.trade.beforeFundingPct != null && record.tracking.trade.netPct == null
    // Prediction, source, plan and issue-time evidence cannot be rewritten by the tracker.
    await this.client.$executeRawUnsafe("UPDATE MarketForecast SET pending = ?, payload = json_set(payload, '$.tracking', json(?)) WHERE id = ?",
      pending ? 1 : 0, JSON.stringify(record.tracking), record.id)
  }
  async pendingForecasts(): Promise<Forecast[]> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM MarketForecast WHERE pending = 1 ORDER BY issuedAt')
    return rows.map(r => JSON.parse(r.payload))
  }
  async forecasts(marketType: MarketType, since: number): Promise<Forecast[]> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM MarketForecast WHERE marketType = ? AND issuedAt >= ? ORDER BY issuedAt DESC, id', marketType, since)
    return rows.map(r => JSON.parse(r.payload))
  }
  async forecastPage(marketType: MarketType, since: number, page: number): Promise<Forecast[]> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM MarketForecast WHERE marketType = ? AND issuedAt >= ? ORDER BY issuedAt DESC, id LIMIT 25 OFFSET ?', marketType, since, page * 25)
    return rows.map(r => JSON.parse(r.payload))
  }
  async latestForecasts(marketType: MarketType): Promise<Forecast[]> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM MarketForecast WHERE marketType = ? AND slot = (SELECT MAX(slot) FROM MarketForecast WHERE marketType = ?) ORDER BY symbol', marketType, marketType)
    return rows.map(r => JSON.parse(r.payload))
  }
  async forecastBuckets(marketType: MarketType, since: number): Promise<ForecastBucket[]> {
    await this.init()
    // Aggregate in SQLite instead of transferring a year of evidence payloads on every poll.
    const rows = await this.client.$queryRawUnsafe<ForecastBucket[]>(`SELECT
      strftime('%Y-%m-%d', issuedAt / 1000, 'unixepoch') AS day,
      json_extract(payload, '$.direction') AS direction,
      json_extract(payload, '$.tracking.actual') AS actual,
      COUNT(*) AS total,
      SUM(json_extract(payload, '$.tracking.error') IS NOT NULL) AS delayed,
      SUM(json_extract(payload, '$.tracking.trade.netPct') IS NOT NULL) AS trades,
      SUM(COALESCE(json_extract(payload, '$.tracking.trade.netPct'), 0) > 0) AS wins,
      SUM(COALESCE(json_extract(payload, '$.tracking.trade.netPct'), 0)) AS netSum,
      SUM(json_extract(payload, '$.tracking.trade.beforeFundingPct') IS NOT NULL AND json_extract(payload, '$.tracking.trade.netPct') IS NULL) AS pendingFunding
      FROM MarketForecast WHERE marketType = ? AND issuedAt >= ? GROUP BY day, direction, actual ORDER BY day DESC`, marketType, since)
    return rows.map(r => ({ ...r, total: Number(r.total), delayed: Number(r.delayed), trades: Number(r.trades), wins: Number(r.wins), netSum: Number(r.netSum), pendingFunding: Number(r.pendingFunding) }))
  }
  async saveForecastScan(scan: ForecastScan) {
    await this.init()
    await this.client.$executeRawUnsafe('INSERT INTO ForecastScan (marketType, payload) VALUES (?, ?) ON CONFLICT(marketType) DO UPDATE SET payload = excluded.payload', scan.marketType, JSON.stringify(scan))
  }
  async forecastScan(marketType: MarketType): Promise<ForecastScan | null> {
    await this.init()
    const rows = await this.client.$queryRawUnsafe<{ payload: string }[]>('SELECT payload FROM ForecastScan WHERE marketType = ?', marketType)
    return rows.length ? JSON.parse(rows[0].payload) : null
  }
  async close() { await this.client.$disconnect() }
}

const globals = globalThis as typeof globalThis & { signalRepository?: SignalRepository }
export function repository() { return globals.signalRepository ??= new SignalRepository() }
