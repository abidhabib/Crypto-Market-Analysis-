import { barsValid, closedBars, indicators, zones } from '../signals/engine.ts'
import { INTERVAL_MS } from '../signals/types.ts'
import type { Bar } from '../signals/types.ts'
import type { Direction, Forecast, ForecastBucket, ForecastInput, ForecastPlan, ForecastStats } from './types.ts'

export const FORECAST_VERSION = 'direction-4h-v1'
export const STEP = INTERVAL_MS['5m'], HOUR = INTERVAL_MS['1h']
const last = <T,>(a: T[]) => a[a.length - 1]
const fresh = (t: number, now: number, age: number) => Number.isFinite(t) && t <= now && now - t <= age
const round = (v: number, tick: number, up: boolean) => (up ? Math.ceil(v / tick) : Math.floor(v / tick)) * tick
const trend = (bars: Bar[]) => {
  const i = indicators(bars), p = last(bars).c
  return p > i.ema50 && i.ema20 > i.ema50 ? 1 : p < i.ema50 && i.ema20 < i.ema50 ? -1 : 0
}

/** Frozen rules and labels. Scores are directional votes, never probabilities. */
export function forecast(input: ForecastInput): Forecast {
  const { at, market: m, marketType } = input
  const frames = {
    '4h': closedBars(input.bars['4h'], INTERVAL_MS['4h'], at),
    '1h': closedBars(input.bars['1h'], HOUR, at),
    '15m': closedBars(input.bars['15m'], INTERVAL_MS['15m'], at),
  }
  const btc = closedBars(input.btc, INTERVAL_MS['4h'], at)
  if (!Object.entries(frames).every(([tf, b]) => barsValid(b, INTERVAL_MS[tf as keyof typeof frames], at, 220))
    || !barsValid(btc, INTERVAL_MS['4h'], at, 220)) throw new Error('Missing, stale or discontinuous forecast candles')
  if (![m.tick, m.step, m.minNotional].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid instrument rules')
  const h4 = indicators(frames['4h']), h1 = indicators(frames['1h']), m15 = indicators(frames['15m'])
  const bar = last(frames['15m']), price = bar.c
  const momentum = m15.histogram > 0 && m15.rsi > 50 ? 1 : m15.histogram < 0 && m15.rsi < 50 ? -1 : 0
  const evidence = [
    { label: '4H trend', vote: 2 * trend(frames['4h']), detail: 'Price vs EMA50 and EMA20/50 alignment' },
    { label: '1H trend', vote: 2 * trend(frames['1h']), detail: 'Price vs EMA50 and EMA20/50 alignment' },
    { label: '15M trend', vote: trend(frames['15m']), detail: 'Closed-candle entry timeframe trend' },
    { label: '15M momentum', vote: momentum, detail: `RSI ${m15.rsi.toFixed(1)}; MACD histogram ${m15.histogram.toPrecision(4)}` },
    { label: 'BTC context', vote: trend(btc), detail: 'Same exchange and market type, closed 4H bars' },
  ]
  const score = evidence.reduce((n, e) => n + e.vote, 0)
  const direction: Direction = score >= 3 ? 'UP' : score <= -3 ? 'DOWN' : 'NEUTRAL'
  const sign = direction === 'UP' ? 1 : direction === 'DOWN' ? -1 : 0
  const blockers: string[] = []
  if (!sign) blockers.push('Mixed directional evidence')
  if (marketType === 'spot' && sign < 0) blockers.push('Spot bearish view: sell/avoid context only; no borrowed short or assumed holdings')
  if (Math.abs(score) < 6) blockers.push('Paper entry requires at least 6 of 7 directional votes')
  if (m15.relativeVolume < 1.2) blockers.push('15M volume below 1.2× its prior 20-bar average')
  if (sign * (bar.c - bar.o) <= 0 || sign * m15.histogram <= 0 || sign * h1.histogram <= 0) blockers.push('Closed price action / momentum not aligned')
  const support = zones(frames['4h'].slice(-120, -3), h4.atr * .35, 'support').filter(z => z.touches >= 2)
  const resistance = zones(frames['4h'].slice(-120, -3), h4.atr * .35, 'resistance').filter(z => z.touches >= 2)
  const setup = (sign > 0 ? support : resistance).some(z => sign > 0
    ? bar.l <= z.high && bar.c > z.high && bar.c - z.high <= h4.atr
    : bar.h >= z.low && bar.c < z.low && z.low - bar.c <= h4.atr)
  if (!setup) blockers.push('No confirmed 15M rejection/reclaim of a repeated 4H level')
  const book = input.book
  if (!book || !fresh(book.at, at, 60_000) || ![book.bid, book.ask, book.bidUsd, book.askUsd].every(Number.isFinite)
    || book.bid <= 0 || book.ask < book.bid || (book.ask - book.bid) / book.bid > .0015 || Math.min(book.bidUsd, book.askUsd) < 20_000
    || Math.abs((book.bid + book.ask) / 2 - price) > m15.atr) blockers.push('Fresh, nearby price and liquid order book not confirmed')
  const d = input.derivatives
  if (marketType === 'futures' && (!d || !fresh(d.at, at, 900_000) || ![d.oi, d.oiChange, d.funding, d.longShortRatio].every(Number.isFinite)
    || d.oi <= 0 || Math.abs(d.funding) > .001 || d.oiChange < -5 || d.oiChange > 20 || d.longShortRatio < .3 || d.longShortRatio > 3)) blockers.push('Futures funding / OI / positioning unavailable or outside limits')
  const heat = input.heatmap && fresh(input.heatmap.at, at, 300_000) ? input.heatmap : null
  if (input.requireHeatmap && !heat) blockers.push('Required liquidation heatmap unavailable')
  if (heat && heat.clusters.some(c => c.usd >= 1_000_000 && (sign > 0 ? c.side === 'long' && c.price < price && price - c.price < m15.atr : c.side === 'short' && c.price > price && c.price - price < m15.atr))) blockers.push('Large liquidation cluster close to the adverse side')
  if (m.turnover < 5_000_000 || Math.abs(m.change) >= .3 || h4.atr / last(frames['4h']).c >= .08) blockers.push('Market liquidity / volatility limits')
  const fee = marketType === 'spot' ? .001 : .0005, slip = .0005
  const stop = round(price - sign * 1.5 * m15.atr, m.tick, sign < 0)
  const entryLow = round(price - .25 * m15.atr, m.tick, true), entryHigh = round(price + .25 * m15.atr, m.tick, false)
  const worstEntry = (sign > 0 ? entryHigh : entryLow) * (1 + sign * slip)
  const stopFill = stop * (1 - sign * slip)
  const unitRisk = sign * (worstEntry - stopFill) + fee * (worstEntry + stopFill)
  const targetRaw = (2 * unitRisk + worstEntry * (sign + fee)) / ((sign - fee) * (1 - sign * slip))
  const target = round(targetRaw, m.tick, sign > 0)
  const obstacle = sign > 0 ? resistance.find(z => z.low > price)?.low : support.filter(z => z.high < price).at(-1)?.high
  if (obstacle != null && sign * (target - obstacle) >= 0) blockers.push('Insufficient room to the next opposing 4H level')
  if (![stop, target, unitRisk, entryLow, entryHigh].every(v => Number.isFinite(v) && v > 0) || entryLow > entryHigh
    || sign * (price - stop) <= 0 || sign * (target - price) <= 0 || Math.abs(price - stop) / price > .08) blockers.push('Invalid stop, target or entry range')
  const quantity = Math.floor(Math.min(100 / unitRisk, 1000 / worstEntry) / m.step) * m.step
  if (!(quantity > 0) || quantity * worstEntry < m.minNotional) blockers.push('Instrument minimum exceeds the paper risk/notional budget')
  const plan: ForecastPlan | null = blockers.length ? null : { side: sign > 0 ? 'LONG' : 'SHORT', entryLow, entryHigh, stop, target,
    feeBps: fee * 10000, slippageBps: slip * 10000, step: m.step, minNotional: m.minNotional, riskBudget: 100, maxNotional: 1000 }
  const startsAt = (Math.floor(at / STEP) + 1) * STEP, slot = Math.floor(at / HOUR) * HOUR
  return { id: `${FORECAST_VERSION}:${marketType}:${m.symbol}:${slot}`, version: FORECAST_VERSION, exchange: input.exchange, marketType,
    symbol: m.symbol, issuedAt: at, slot, startsAt, endsAt: startsAt + 4 * HOUR, referencePrice: price,
    neutralBandPct: Math.max(.2, .5 * m15.atr / price * 100), direction,
    stance: direction === 'NEUTRAL' ? 'NEUTRAL' : marketType === 'spot' ? sign > 0 ? 'BUY' : 'SELL / AVOID' : sign > 0 ? 'LONG' : 'SHORT',
    action: plan ? 'PAPER ENTRY' : marketType === 'spot' && sign < 0 ? 'AVOID' : 'WAIT', score, evidence, blockers, plan,
    coverage: ['Closed 4H / 1H / 15M candles', `${marketType} prices and BTC context`, book ? 'Order book sampled; entry checks apply' : 'Order book unavailable',
      d ? 'Derivatives sampled; entry checks apply' : 'Derivatives unavailable', heat ? `Heatmap: ${heat.source}` : 'Liquidation heatmap unavailable',
      'News / economic events / BTC dominance not connected', 'Rule-based forecast; probability uncalibrated'],
    tracking: { lastBarAt: startsAt - STEP, baseline: null, endPrice: null, returnPct: null, actual: null, correct: null, settledAt: null, error: null,
      trade: { status: plan ? 'PENDING' : 'NONE', entry: null, entryAt: null, exit: null, exitAt: null, quantity: null,
        beforeFundingPct: null, fundingPct: null, netPct: null, fundingStatus: marketType === 'spot' ? 'NOT_APPLICABLE' : 'PENDING', detail: plan ? 'Next full 5M open must remain inside the recorded entry range' : 'No paper entry issued' } } }
}

export function trackForecast(original: Forecast, candles: Bar[], now: number): Forecast {
  const f = structuredClone(original), t = f.tracking, p = f.plan, trade = t.trade
  if (t.settledAt != null) return f
  t.error = null
  for (const b of closedBars(candles, STEP, now)) {
    if (b.t <= t.lastBarAt || b.t >= f.endsAt) continue
    if (b.t !== t.lastBarAt + STEP || ![b.o, b.h, b.l, b.c].every(v => Number.isFinite(v) && v > 0)
      || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c)) { t.error = 'Missing or invalid 5M candles; evaluation paused'; break }
    t.lastBarAt = b.t
    if (t.baseline == null) t.baseline = b.o
    if (p) {
      const sign = p.side === 'LONG' ? 1 : -1, fee = p.feeBps / 10000, slip = p.slippageBps / 10000
      if (trade.status === 'PENDING') {
        const entry = b.o * (1 + sign * slip), stopFill = p.stop * (1 - sign * slip), targetFill = p.target * (1 - sign * slip)
        const risk = sign * (entry - stopFill) + fee * (entry + stopFill)
        const reward = sign * (targetFill - entry) - fee * (entry + targetFill)
        const quantity = Math.floor(Math.min(p.riskBudget / risk, p.maxNotional / entry) / p.step) * p.step
        if (b.o < p.entryLow || b.o > p.entryHigh || !(risk > 0) || reward / risk < 2 - 1e-8 || !(quantity > 0) || quantity * entry < p.minNotional) {
          trade.status = 'SKIPPED'; trade.detail = 'Next candle opened outside the permitted entry / risk limits; no fill'
        } else { trade.status = 'OPEN'; trade.entry = entry; trade.entryAt = b.t; trade.quantity = quantity; trade.detail = 'Paper market entry at next full 5M open with adverse slippage' }
      }
      if (trade.status === 'OPEN' && trade.entry != null) {
        const stopped = sign > 0 ? b.l <= p.stop : b.h >= p.stop
        const targeted = sign > 0 ? b.h >= p.target : b.l <= p.target
        if (stopped || targeted || b.t + STEP >= f.endsAt) {
          const raw = stopped ? sign > 0 ? Math.min(b.o, p.stop) : Math.max(b.o, p.stop) : targeted ? p.target : b.c
          trade.exit = raw * (1 - sign * slip); trade.exitAt = b.t + STEP
          trade.status = stopped ? 'STOP' : targeted ? 'TARGET' : 'TIMEOUT'
          trade.beforeFundingPct = 100 * (sign * (trade.exit - trade.entry) - fee * (trade.entry + trade.exit)) / trade.entry
          trade.detail = stopped ? `${targeted ? 'Stop and target touched: stop-first. ' : ''}Stop reached; causal explanation unproven.` : targeted ? 'Recorded target reached' : 'Four-hour holding limit reached'
          if (f.marketType === 'spot') { trade.fundingPct = 0; trade.netPct = trade.beforeFundingPct }
        }
      }
    }
    if (b.t + STEP === f.endsAt) {
      t.endPrice = b.c; t.returnPct = 100 * (b.c / t.baseline - 1)
      t.actual = t.returnPct > f.neutralBandPct ? 'UP' : t.returnPct < -f.neutralBandPct ? 'DOWN' : 'NEUTRAL'
      t.correct = t.actual === f.direction; t.settledAt = f.endsAt
    }
  }
  if (t.settledAt == null && t.lastBarAt + 2 * STEP <= now && !t.error) t.error = 'No next closed candle available; evaluation delayed'
  return f
}

export function applyFunding(original: Forecast, rows: { at: number; rate: number; mark: number | null }[]): Forecast {
  const f = structuredClone(original), t = f.tracking.trade
  if (f.marketType !== 'futures' || t.entry == null || t.entryAt == null || t.exitAt == null || t.beforeFundingPct == null || !f.plan) return f
  const events = rows.filter(r => r.at >= t.entryAt! && r.at <= t.exitAt!)
  if (events.some(r => !Number.isFinite(r.rate) || !Number.isFinite(r.at) || r.mark != null && (!Number.isFinite(r.mark) || r.mark <= 0))) throw new Error('Invalid funding observation')
  t.fundingPct = events.reduce((n, r) => n + (f.plan!.side === 'LONG' ? 1 : -1) * r.rate * (r.mark ?? t.entry!) / t.entry! * 100, 0)
  t.netPct = t.beforeFundingPct - t.fundingPct
  t.fundingStatus = events.some(r => r.mark == null) ? 'ESTIMATED' : 'RECORDED'
  return f
}

export function forecastStats(rows: Forecast[]): ForecastStats {
  return bucketStats(rows.map(r => ({ day: '', direction: r.direction, actual: r.tracking.actual, total: 1,
    delayed: r.tracking.error ? 1 : 0, trades: r.tracking.trade.netPct != null ? 1 : 0, wins: (r.tracking.trade.netPct ?? 0) > 0 ? 1 : 0,
    netSum: r.tracking.trade.netPct ?? 0, pendingFunding: r.tracking.trade.beforeFundingPct != null && r.tracking.trade.netPct == null ? 1 : 0 })))
}

export function bucketStats(rows: ForecastBucket[]): ForecastStats {
  const sum = (a: ForecastBucket[], field: 'total' | 'delayed' | 'trades' | 'wins' | 'netSum' | 'pendingFunding' = 'total') => a.reduce((n, r) => n + r[field], 0)
  const settled = rows.filter(r => r.actual != null), directional = settled.filter(r => r.direction !== 'NEUTRAL')
  const correct = (a: ForecastBucket[]) => sum(a.filter(r => r.actual === r.direction))
  const rate = (n: number, d: number) => d ? n / d * 100 : null
  const trades = sum(rows, 'trades'), wins = sum(rows, 'wins')
  const directions: Direction[] = ['UP', 'DOWN', 'NEUTRAL']
  const confusion = { UP: { UP: 0, DOWN: 0, NEUTRAL: 0 }, DOWN: { UP: 0, DOWN: 0, NEUTRAL: 0 }, NEUTRAL: { UP: 0, DOWN: 0, NEUTRAL: 0 } }
  for (const row of settled) confusion[row.direction][row.actual!] += row.total
  const neutral = settled.filter(r => r.direction === 'NEUTRAL')
  return { total: sum(rows), settled: sum(settled), pending: sum(rows) - sum(settled), delayed: sum(rows, 'delayed'),
    correct: correct(settled), accuracy: rate(correct(settled), sum(settled)), directionalTotal: sum(directional), directionalCorrect: correct(directional),
    directionalAccuracy: rate(correct(directional), sum(directional)), neutralTotal: sum(neutral), neutralCorrect: correct(neutral),
    baselineAccuracy: rate(Math.max(...directions.map(d => sum(settled.filter(r => r.actual === d)))), sum(settled)),
    byDirection: directions.map(direction => { const items = settled.filter(r => r.direction === direction); return { direction, total: sum(items), correct: correct(items), accuracy: rate(correct(items), sum(items)) } }),
    confusion, trades, wins, tradeWinRate: rate(wins, trades), meanNetPct: trades ? sum(rows, 'netSum') / trades : null,
    pendingFunding: sum(rows, 'pendingFunding') }
}
