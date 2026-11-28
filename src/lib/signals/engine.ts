import { DEFAULT_POLICY, INTERVAL_MS } from './types.ts'
import type { Analysis, AnalysisInput, Bar, Plan, Policy, Timeframe, Zone } from './types.ts'

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1)
const last = <T,>(a: T[]) => a[a.length - 1]
export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return []
  const out = [mean(values.slice(0, period))], k = 2 / (period + 1)
  for (let i = period; i < values.length; i++) out.push(values[i] * k + last(out) * (1 - k))
  return out
}
export function rsiSeries(values: number[], period = 14): number[] {
  if (values.length <= period) return []
  let gain = 0, loss = 0
  const out: number[] = []
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    if (i <= period) { gain += Math.max(0, d) / period; loss += Math.max(0, -d) / period }
    else { gain = (gain * (period - 1) + Math.max(0, d)) / period; loss = (loss * (period - 1) + Math.max(0, -d)) / period }
    if (i >= period) out.push(gain + loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  }
  return out
}
export function wilder(values: number[], period: number): number[] {
  if (values.length < period) return []
  const out = [mean(values.slice(0, period))]
  for (let i = period; i < values.length; i++) out.push((last(out) * (period - 1) + values[i]) / period)
  return out
}
export function indicators(bars: Bar[]) {
  const closes = bars.map(b => b.c), tail = bars.slice(-20), current = last(bars)
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26)
  const macd = e26.map((x, i) => e12[i + 14] - x), signal = emaSeries(macd, 9)
  const rsi = rsiSeries(closes), recentRsi = rsi.slice(-14)
  const tr = bars.map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - (bars[i - 1]?.c ?? b.o)), Math.abs(b.l - (bars[i - 1]?.c ?? b.o))))
  const smoothedTR = wilder(tr.slice(1), 14)
  const up = bars.slice(1).map((b, i) => { const u = b.h - bars[i].h, d = bars[i].l - b.l; return u > d && u > 0 ? u : 0 })
  const down = bars.slice(1).map((b, i) => { const u = b.h - bars[i].h, d = bars[i].l - b.l; return d > u && d > 0 ? d : 0 })
  const smUp = wilder(up, 14), smDown = wilder(down, 14)
  const dx = smoothedTR.map((_, i) => 100 * Math.abs(smUp[i] - smDown[i]) / (smUp[i] + smDown[i] || 1))
  let obv = 0, priorObv = 0
  bars.forEach((b, i) => { if (i) obv += Math.sign(b.c - bars[i - 1].c) * b.v; if (i === bars.length - 6) priorObv = obv })
  const mid = mean(tail.map(b => b.c)), sd = Math.sqrt(mean(tail.map(b => (b.c - mid) ** 2)))
  const v = tail.reduce((s, b) => s + b.v, 0)
  return {
    ema20: last(emaSeries(closes, 20)), ema50: last(emaSeries(closes, 50)), ema200: last(emaSeries(closes, 200)),
    rsi: last(rsi), previousRsi: rsi[rsi.length - 2], macd: last(macd), histogram: last(macd) - last(signal),
    atr: last(wilder(tr, 14)), adx: last(wilder(dx, 14)), obv, obvRising: obv > priorObv,
    relativeVolume: current.v / (mean(bars.slice(-21, -1).map(b => b.v)) || Infinity),
    vwap: v > 0 ? tail.reduce((s, b) => s + (b.h + b.l + b.c) / 3 * b.v, 0) / v : NaN,
    bollingerUpper: mid + 2 * sd, bollingerLower: mid - 2 * sd,
    stochRsi: 100 * (last(rsi) - Math.min(...recentRsi)) / (Math.max(...recentRsi) - Math.min(...recentRsi) || 1),
  }
}

/** Only confirmed bars enter calculations. Malformed bars and time gaps fail closed. */
export function closedBars(bars: Bar[], interval: number, at: number): Bar[] {
  const sorted = [...bars].filter(b => b.t + interval <= at).sort((a, b) => a.t - b.t)
  return [...new Map(sorted.map(b => [b.t, b])).values()]
}
export function barsValid(bars: Bar[], interval: number, at: number, min: number): boolean {
  if (bars.length < min || at - (last(bars).t + interval) >= interval + 30_000) return false
  return bars.every((b, i) => [b.t, b.o, b.h, b.l, b.c, b.v].every(Number.isFinite)
    && b.t % interval === 0 && Math.min(b.o, b.h, b.l, b.c) > 0 && b.v >= 0
    && b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c)
    && (!i || b.t - bars[i - 1].t === interval))
}

export function zones(bars: Bar[], tolerance: number, side: 'support' | 'resistance'): Zone[] {
  const points: number[] = []
  for (let i = 2; i < bars.length - 2; i++) {
    const p = side === 'support' ? bars[i].l : bars[i].h
    const neighbors = [bars[i - 2], bars[i - 1], bars[i + 1], bars[i + 2]]
    if (neighbors.every(b => side === 'support' ? p < b.l : p > b.h)) points.push(p)
  }
  const out: Zone[] = []
  for (const p of points) {
    const zone = out.find(z => Math.abs(z.price - p) <= tolerance)
    if (zone) { zone.price = (zone.price * zone.touches + p) / (zone.touches + 1); zone.touches++; zone.low = Math.min(zone.low, p - tolerance / 2); zone.high = Math.max(zone.high, p + tolerance / 2) }
    else out.push({ price: p, low: p - tolerance / 2, high: p + tolerance / 2, touches: 1 })
  }
  return out.sort((a, b) => a.price - b.price)
}

export function bullishPattern(bars: Bar[]): string | null {
  const b = last(bars), p = bars[bars.length - 2]
  const range = b.h - b.l, body = Math.abs(b.c - b.o)
  if (!(range > 0 && b.c > b.o && (b.c - b.l) / range >= 0.65)) return null
  if (p.c < p.o && b.o <= p.c && b.c >= p.o) return 'Bullish engulfing'
  if (Math.min(b.o, b.c) - b.l >= 2 * body) return 'Hammer / rejection wick'
  return body / range >= 0.55 ? 'Strong bullish close' : null
}
const fresh = (at: number | undefined, now: number, age: number) => at != null && at <= now + 5_000 && now - at <= age
const roundDown = (v: number, step: number) => Math.floor((v + step * 1e-8) / step) * step
const roundUp = (v: number, step: number) => Math.ceil((v - step * 1e-8) / step) * step

export function makePlan(entry: number, anchor: number, atr: number, resistance: number | null, tick: number, step: number, at: number, policy: Policy): Plan | null {
  if (![entry, anchor, atr, tick, step, policy.equity, policy.riskPct, policy.feeBps, policy.slippageBps].every(Number.isFinite)
    || Math.min(entry, anchor, atr, tick, step, policy.equity, policy.riskPct) <= 0 || policy.riskPct > 1
    || policy.feeBps < 0 || policy.slippageBps < 0 || policy.minRR < 2) return null
  entry = roundUp(entry, tick)
  const stop = roundDown(Math.min(anchor - 0.25 * atr, entry - 1.5 * atr), tick)
  const buyCost = (1 + policy.feeBps / 10_000) * (1 + policy.slippageBps / 10_000)
  const sellNet = (1 - policy.feeBps / 10_000) * (1 - policy.slippageBps / 10_000)
  const risk = entry * buyCost - stop * sellNet
  if (stop <= 0 || risk <= 0 || (entry - stop) / entry > 0.08) return null
  const target = (multiple: number) => roundUp((entry * buyCost + multiple * risk) / sellNet, tick)
  const targets: [number, number, number] = [target(policy.minRR), target(policy.minRR + 1), target(policy.minRR + 2)]
  if (resistance != null && targets[0] >= resistance) return null
  const quantity = roundDown(Math.min(policy.equity * policy.riskPct / 100 / risk, policy.equity / (entry * buyCost)), step)
  if (quantity <= 0) return null
  return { entry, stop, targets, rr: (targets[0] * sellNet - entry * buyCost) / risk,
    quantity, notional: quantity * entry, riskUsd: quantity * risk, equity: policy.equity, riskPct: policy.riskPct,
    feeBps: policy.feeBps, slippageBps: policy.slippageBps, expiresAt: at + 3_600_000, closeBy: at + 72 * 3_600_000 }
}

export function analyze(input: AnalysisInput, policy: Policy = DEFAULT_POLICY): Analysis {
  const { market, at } = input
  const out: Analysis = { exchange: input.exchange, symbol: market.symbol, at, candleAt: 0, price: market.price,
    decision: 'NO SIGNAL', setup: null, score: 0, checks: [], blockers: [], support: null, resistance: null,
    metrics: {}, coverage: [], plan: null, version: policy.version }
  const add = (key: string, label: string, pass: boolean, max: number, detail: string, required = true) => {
    out.checks.push({ key, label, pass, max, points: pass ? max : 0, detail, required })
  }
  const bars = Object.fromEntries(Object.entries(input.bars).map(([tf, b]) => [tf, closedBars(b, INTERVAL_MS[tf as Timeframe], at)])) as Record<Timeframe, Bar[]>
  const btc = closedBars(input.btc, INTERVAL_MS['4h'], at), eth = closedBars(input.eth, INTERVAL_MS['4h'], at)
  const valid = Object.entries(bars).every(([tf, b]) => barsValid(b, INTERVAL_MS[tf as Timeframe], at, ['4h', '1h'].includes(tf) ? 220 : 80))
    && barsValid(btc, INTERVAL_MS['4h'], at, 220) && barsValid(eth, INTERVAL_MS['4h'], at, 220)
  add('data', 'Closed, continuous multi-timeframe data', valid, 0, valid ? '4H / 1H / 15M / 5M and BTC / ETH bars verified' : 'Missing, stale, malformed or discontinuous candles')
  if (!valid) { out.blockers = ['Missing, stale, malformed or discontinuous candles']; return out }
  const h4 = bars['4h'], h1 = bars['1h'], m15 = bars['15m'], m5 = bars['5m']
  out.candleAt = last(m15).t
  const a = indicators(h4), b = indicators(h1), c = indicators(m15), d = indicators(m5), btcI = indicators(btc), ethI = indicators(eth)
  const current = last(h4), lower = last(m15), previous = h4[h4.length - 2]
  // Levels are formed before the potential breakout/retest, using confirmed pivots.
  const supports = zones(h4.slice(-120, -3), a.atr * 0.35, 'support').filter(z => z.touches >= 2)
  const resistances = zones(h4.slice(-120, -3), a.atr * 0.35, 'resistance').filter(z => z.touches >= 2)
  const support = supports.filter(z => z.price <= current.c).at(-1) ?? null
  const reclaim = !!support && current.l <= support.high && current.c > support.high && current.c > current.o
    && current.c - support.high <= a.atr * 1.5
  const breakout = resistances.filter(z => {
    const recent = h4.slice(-4, -1)
    return recent.some((bar, i) => bar.c > z.high && h4[h4.length - 5 + i].c <= z.high
      && bar.v >= 1.2 * mean(h4.slice(h4.length - 24 + i, h4.length - 4 + i).map(b => b.v)))
      && previous.c > z.high && current.l <= z.high + a.atr * 0.15 && current.l >= z.low - a.atr * 0.3
      && current.c > z.high && current.c > current.o && current.c - z.high <= a.atr * 1.5
  }).at(-1)
  out.setup = breakout ? 'breakout-retest' : reclaim ? 'support-reclaim' : null
  out.support = breakout ?? support
  out.resistance = resistances.find(z => z.low > market.price) ?? null
  const swept = !!support && current.l < support.low && current.c > support.high
  const structure = last(h1).c > b.ema50 && b.ema20 > b.ema50
    && Math.min(...h1.slice(-6).map(x => x.l)) > Math.min(...h1.slice(-12, -6).map(x => x.l))
  const pattern = bullishPattern(m15) ?? bullishPattern(h1)
  const volume = c.relativeVolume >= 1.2 && a.relativeVolume >= 1 && c.obvRising
  const technical = c.rsi >= 50 && c.rsi <= 72 && c.rsi >= c.previousRsi && c.histogram > 0 && b.histogram > 0
  const trend = current.c > a.ema200 && a.ema20 >= a.ema50 && lower.c >= c.vwap && last(h1).c >= b.ema20
  const btcSafe = last(btc).c >= btcI.ema50 && btcI.ema20 >= btcI.ema50 && btcI.atr / last(btc).c < 0.06
  const ethSafe = last(eth).c >= ethI.ema50
  const timing = last(m5).c > d.ema20 && d.histogram > 0 && last(m5).c >= last(m5).o
  const book = input.book, deriv = input.derivatives
  const bookOK = !!book && fresh(book.at, at, 60_000) && [book.bid, book.ask, book.bidUsd, book.askUsd].every(Number.isFinite)
    && book.bid > 0 && book.ask >= book.bid && book.bidUsd >= 20_000 && book.askUsd >= 20_000
    && (book.ask - book.bid) / book.bid * 10_000 <= policy.maxSpreadBps && book.bidUsd / book.askUsd >= 0.8
  const derivOK = !!deriv && fresh(deriv.at, at, 900_000) && [deriv.oi, deriv.oiChange, deriv.funding, deriv.longShortRatio].every(Number.isFinite)
    && deriv.oi > 0 && deriv.oiChange >= -1 && deriv.oiChange <= 15 && Math.abs(deriv.funding) <= 0.001
    && deriv.longShortRatio >= 0.3 && deriv.longShortRatio <= 3
  const technicalOnly = policy.mode === 'technical-backtest'
  const heatmap = input.heatmap && fresh(input.heatmap.at, at, 300_000) ? input.heatmap : null
  const nearLong = heatmap?.clusters.filter(x => x.side === 'long' && x.price < market.price && market.price - x.price < a.atr)
    .reduce((sum, x) => sum + x.usd, 0) ?? 0
  const nearShort = heatmap?.clusters.filter(x => x.side === 'short' && x.price > market.price && x.price - market.price < a.atr * 3)
    .reduce((sum, x) => sum + x.usd, 0) ?? 0
  const heatOK = !!heatmap && nearLong <= Math.max(nearShort * 2, 100_000)
  const liquidity = swept || (reclaim && !!pattern) || !!breakout
  add('levels', '4H support / resistance', !!out.setup, 15, out.setup ? `${out.setup} at ${out.support?.price}, ${out.support?.touches} confirmed pivots` : 'No repeated support reclaim or closed breakout with retest')
  add('structure', '1H market structure', structure, 10, structure ? 'Higher low and EMA20 above EMA50' : 'Higher low / bullish trend not confirmed')
  add('price-action', 'Bullish price action', !!pattern, 10, pattern ?? 'No strong bullish close, engulfing or rejection')
  add('volume', 'Buying volume', volume, 15, `15M relative volume ${c.relativeVolume.toFixed(2)}×; 4H ${a.relativeVolume.toFixed(2)}×; OBV ${c.obvRising ? 'rising' : 'falling'}`)
  add('momentum', 'RSI / MACD', technical, 10, `RSI ${c.rsi.toFixed(1)}; 15M and 1H MACD histogram must be positive`)
  add('trend', 'EMA / rolling VWAP', trend, 10, '4H EMA200 / EMA20–50 alignment; 1H EMA20 and 15M rolling VWAP')
  add('liquidity', 'Liquidity reclaim / retest', liquidity, 10, swept ? 'Observed low swept and reclaimed; stop hunting is not provable' : 'Price-based reclaim / retest; resting liquidity checked separately')
  add('derivatives', 'OI / funding / positioning', derivOK, 10, deriv ? `OI change ${deriv.oiChange.toFixed(2)}%; funding ${(deriv.funding * 100).toFixed(4)}%; long/short ${deriv.longShortRatio.toFixed(2)}` : 'Matching futures confirmation unavailable', !technicalOnly)
  add('market', 'BTC / ETH context', btcSafe && ethSafe, 5, `BTC ${btcSafe ? 'aligned' : 'opposing'}; ETH ${ethSafe ? 'aligned' : 'opposing'}`)
  add('entry', 'Lower-timeframe entry', timing && !!out.setup, 5, '5M momentum confirms the 15M / 1H entry after the 4H setup')
  add('book', 'Spread / available liquidity', bookOK, 0, book ? `Bid $${Math.round(book.bidUsd)}, ask $${Math.round(book.askUsd)} within 0.5%` : 'Order book unavailable', !technicalOnly)
  add('heatmap', 'Liquidation clusters', heatOK, 0, heatmap ? `${heatmap.source}; nearby long $${Math.round(nearLong)}, short $${Math.round(nearShort)}` : 'No fresh provider heatmap; not included as confirmation', policy.requireHeatmap || !!heatmap)
  add('market-quality', 'Market liquidity / volatility', Number.isFinite(market.price) && market.price > 0 && market.turnover >= policy.minTurnover && Math.abs(market.change) < 0.3 && a.atr / current.c < 0.08, 0, '24H turnover ≥ $5M; absolute 24H change <30%; 4H ATR <8%')
  const entry = bookOK && book ? book.ask : market.price
  out.plan = out.support ? makePlan(entry, Math.min(out.support.low, current.l), c.atr, out.resistance?.low ?? null, market.tick, market.step, at, policy) : null
  add('risk', 'Risk / reward after costs', !!out.plan && out.plan.notional >= market.minNotional && Math.abs(entry - lower.c) <= c.atr, 0,
    out.plan ? `${out.plan.rr.toFixed(2)} R to TP1; $${out.plan.riskUsd.toFixed(2)} modeled stop risk` : 'Insufficient room to resistance, invalid stop or invalid size')
  // Passing the directional gate earns a base score; stronger evidence earns the remaining points.
  const earned: Record<string, number> = {
    levels: (out.support?.touches ?? 0) >= 3 ? 15 : 12,
    'price-action': pattern === 'Strong bullish close' ? 7 : 10,
    volume: c.relativeVolume >= 1.5 ? 15 : 10,
    momentum: c.rsi >= 55 && c.rsi <= 65 ? 10 : 7,
    liquidity: swept ? 10 : 7,
  }
  for (const check of out.checks) if (check.pass && earned[check.key] != null) check.points = earned[check.key]
  out.score = out.checks.reduce((s, x) => s + x.points, 0)
  add('score', 'Minimum confluence score', out.score >= policy.minScore, 0, `${out.score}/100; requires ${policy.minScore}. Score is not win probability.`)
  out.blockers = out.checks.filter(x => x.required && !x.pass).map(x => x.label)
  out.decision = out.blockers.length === 0 ? 'BUY' : 'NO SIGNAL'
  out.metrics = { rsi15m: c.rsi, macd15m: c.macd, macdHistogram: c.histogram, ema20: a.ema20, ema50: a.ema50, ema200: a.ema200,
    atr15m: c.atr, adx4h: a.adx, vwap15m: c.vwap, bollingerUpper: c.bollingerUpper, bollingerLower: c.bollingerLower,
    stochRsi: c.stochRsi, relativeVolume: c.relativeVolume, obv: c.obv, funding: deriv?.funding ?? null,
    oi: deriv?.oi ?? null, oiChange: deriv?.oiChange ?? null, longShortRatio: deriv?.longShortRatio ?? null,
    btcTrend: btcSafe ? 'aligned' : 'opposing', ethTrend: ethSafe ? 'aligned' : 'opposing', pattern,
    buyVolumeShare: lower.buy != null && lower.v > 0 ? lower.buy / lower.v : null }
  out.coverage = ['Closed exchange candles', bookOK ? 'Fresh order book' : 'Order book unavailable / failed',
    derivOK ? 'Derivatives checked' : 'Derivatives unavailable / failed', heatmap ? `Heatmap: ${heatmap.source}` : 'Liquidation heatmap unavailable',
    'News / economic events / BTC dominance not connected', ...(technicalOnly ? ['Technical-only historical test: no historical book or derivatives confirmation'] : [])]
  return out
}
