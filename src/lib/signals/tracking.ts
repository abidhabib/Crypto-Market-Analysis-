import type { Analysis, Bar, Performance, Policy, SignalRecord, TradeEvent } from './types.ts'
import { closedBars } from './engine.ts'

export const isActive = (s: SignalRecord) => s.status === 'PENDING' || s.status === 'OPEN'
const STEP = 300_000
export function createSignal(analysis: Analysis, policy: Policy): SignalRecord {
  if (analysis.decision !== 'BUY' || !analysis.plan) throw new Error('Only a confirmed BUY with a plan can become a signal')
  return { id: `${analysis.exchange}:${analysis.symbol}:${analysis.candleAt}:${analysis.version}:${policy.mode}`,
    mode: policy.mode, exchange: analysis.exchange, symbol: analysis.symbol, generatedAt: analysis.at,
    status: 'PENDING', analysis, plan: analysis.plan, filledAt: null, fill: null, closedAt: null,
    lastBarAt: Math.ceil(analysis.at / STEP) * STEP - STEP, remaining: 1, proceeds: 0,
    pnl: null, r: null, targetsHit: 0, events: [], trackingError: null }
}

/** Conservative OHLC paper fills. A candle touching both SL and TP exits at SL first. */
export function trackSignal(original: SignalRecord, candles: Bar[], now: number): SignalRecord {
  const s: SignalRecord = structuredClone(original)
  if (!isActive(s)) return s
  const plan = s.plan, fee = plan.feeBps / 10_000, slip = plan.slippageBps / 10_000
  const event = (at: number, kind: string, price: number | null, detail: string) => s.events.push({ at, kind, price, detail })
  const exit = (price: number, fraction: number) => { s.proceeds += price * (1 - slip) * (1 - fee) * plan.quantity * fraction; s.remaining = Math.max(0, s.remaining - fraction) }
  const finish = (at: number) => {
    s.closedAt = at; s.pnl = s.proceeds - (s.fill as number) * (1 + fee) * plan.quantity
    s.r = s.pnl / plan.riskUsd
    s.status = s.pnl > 0.01 ? 'WON' : s.pnl < -0.01 ? 'LOST' : 'BREAKEVEN'
  }
  s.trackingError = null
  for (const b of closedBars(candles, STEP, now)) {
    if (b.t <= s.lastBarAt) continue
    if (!isActive(s)) break
    if (b.t !== s.lastBarAt + STEP || ![b.o, b.h, b.l, b.c].every(x => Number.isFinite(x) && x > 0)
      || b.h < Math.max(b.o, b.c) || b.l > Math.min(b.o, b.c)) {
      s.trackingError = `Missing or invalid 5M bar at ${new Date(s.lastBarAt + STEP).toISOString()}; outcome paused until coverage recovers`
      break
    }
    s.lastBarAt = b.t
    const at = b.t + STEP
    if (s.status === 'PENDING') {
      if (b.t >= plan.expiresAt || at > plan.expiresAt) {
        s.status = 'EXPIRED'; s.closedAt = plan.expiresAt
        event(plan.expiresAt, 'expired', null, 'Entry window ended without a verified fill'); break
      }
      if (b.o <= plan.stop) {
        s.status = 'INVALIDATED'; s.closedAt = at
        event(at, 'invalidated', b.o, 'Price opened below stop before entry'); break
      }
      if (b.l > plan.entry) continue
      s.fill = plan.entry * (1 + slip); s.filledAt = at; s.status = 'OPEN'
      event(at, 'entry', s.fill, 'Paper limit touch; adverse slippage and fees applied; timestamp is bar close')
    }
    if (b.l <= plan.stop) {
      const price = Math.min(b.o, plan.stop), ambiguous = b.h >= plan.targets[s.targetsHit]
      exit(price, s.remaining)
      const supportLost = s.analysis.support && b.c < s.analysis.support.low
      event(at, 'stop', price, `${ambiguous ? 'Stop and target touched in one candle: stop-first assumption. ' : ''}${supportLost ? 'Candle closed below recorded support. ' : ''}Stop reached; the underlying cause is unproven.`)
      finish(at); break
    }
    // On the entry candle, target-before-entry cannot be resolved from OHLC.
    // Count targets only when entry was already executable at the candle open.
    if (s.filledAt !== at || b.o <= plan.entry) {
      while (s.targetsHit < 3 && b.h >= plan.targets[s.targetsHit]) {
        const target = plan.targets[s.targetsHit]
        exit(target, s.targetsHit === 2 ? s.remaining : 1 / 3)
        s.targetsHit++
        event(at, `tp${s.targetsHit}`, target, 'One third exited; fees and adverse slippage applied')
      }
    }
    if (s.remaining <= 1e-9) { finish(at); break }
    if (at >= plan.closeBy) {
      exit(b.c, s.remaining); event(at, 'timeout', b.c, '72-hour holding limit; remaining position closed'); finish(at); break
    }
  }
  return s
}

export function performance(records: SignalRecord[]): Performance {
  const count = (status: SignalRecord['status']) => records.filter(s => s.status === status).length
  const closed = records.filter(s => s.pnl != null && s.closedAt != null).sort((a, b) => (a.closedAt as number) - (b.closedAt as number) || a.id.localeCompare(b.id))
  const profits = closed.reduce((s, t) => s + Math.max(0, t.pnl as number), 0)
  const losses = closed.reduce((s, t) => s + Math.max(0, -(t.pnl as number)), 0)
  let equity = 0, peak = 0, maxDrawdown = 0
  for (const s of closed) { equity += s.pnl as number; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity) }
  return { total: records.length, won: count('WON'), lost: count('LOST'), breakeven: count('BREAKEVEN'),
    pending: count('PENDING'), open: count('OPEN'), expired: count('EXPIRED'), invalidated: count('INVALIDATED'),
    closed: closed.length, winRate: closed.length ? count('WON') / closed.length * 100 : null,
    profitFactor: losses > 0 ? profits / losses : null, netPnl: profits - losses,
    expectancyR: closed.length ? closed.reduce((s, t) => s + (t.r ?? 0), 0) / closed.length : null, maxDrawdown }
}

/** UTC cohorts by generation time. Late outcomes update their original cohort. */
export function periodStats(records: SignalRecord[], grouping: 'day' | 'week' | 'month') {
  const groups = new Map<string, SignalRecord[]>()
  for (const s of records) {
    const d = new Date(s.generatedAt)
    if (grouping === 'week') d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7)
    const key = d.toISOString().slice(0, grouping === 'month' ? 7 : 10)
    groups.set(key, [...(groups.get(key) ?? []), s])
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([period, rows]) => ({ period, stats: performance(rows) }))
}

export function failureSummary(records: SignalRecord[]) {
  const reasons = new Map<string, number>()
  for (const s of records.filter(r => r.status === 'LOST')) {
    const lastExit: TradeEvent | undefined = s.events.findLast(e => e.kind === 'stop' || e.kind === 'timeout')
    const reason = lastExit?.kind === 'timeout' ? 'Holding limit closed at a loss'
      : lastExit?.detail.includes('closed below recorded support') ? 'Stop hit; close below support observed'
      : 'Stop hit; market cause unproven'
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }
  return [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
}
