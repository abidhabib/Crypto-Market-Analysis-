import { NextRequest, NextResponse } from 'next/server'

/**
 * Gamma exposure (GEX) from Deribit public options data.
 *
 * One call to public/get_book_summary_by_currency returns every active option
 * with open_interest, mark_iv and underlying_price. Gamma is computed with the
 * Black-76 model on the forward (Deribit underlying_index is a dated future).
 *
 * Dealer-positioning convention (stated on the panel): customers are assumed
 * net long calls and net short puts, i.e. dealers are short calls (+GEX) and
 * long puts (-GEX). GEX per 1% move = gamma * OI * F^2 * 0.01 (contract size 1).
 */

const cache = new Map<string, { at: number; data: unknown }>()

interface Summary {
  instrument_name: string
  open_interest: number
  mark_iv: number | null
  underlying_price: number
  mark_price: number
}

function parseInstrument(name: string) {
  // e.g. BTC-31OCT25-110000-C
  const m = /^([A-Z]+)-(\d{1,2})([A-Z]{3})(\d{2})-(\d+)-([CP])$/.exec(name)
  if (!m) return null
  const months: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }
  const year = 2000 + parseInt(m[4], 10)
  const expiry = Date.UTC(year, months[m[3]], parseInt(m[2], 10), 8, 0, 0) // 08:00 UTC settlement
  return { currency: m[1], expiry, strike: parseInt(m[5], 10), type: m[6] as 'C' | 'P' }
}

// standard normal pdf / cdf
const npdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
function ncdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 via erf approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * npdf(x) * t * (1.330274429 * t ** 4 - 1.821255978 * t ** 3 + 1.781477937 * t ** 2 - 0.356563782 * t + 0.319381530)
  return x >= 0 ? 1 - d : d
}

function black76Gamma(F: number, K: number, T: number, vol: number): number {
  if (T <= 0 || vol <= 0 || F <= 0 || K <= 0) return 0
  const st = vol * Math.sqrt(T)
  const d1 = Math.log(F / K) / st + 0.5 * st
  return npdf(d1) / (F * st)
}

export async function GET(req: NextRequest) {
  const currency = (req.nextUrl.searchParams.get('currency') || 'BTC').toUpperCase()
  if (!['BTC', 'ETH', 'SOL'].includes(currency)) {
    return NextResponse.json({ error: 'options data available for BTC, ETH, SOL only' }, { status: 400 })
  }
  const key = `gex:${currency}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 120000) return NextResponse.json(hit.data, { headers: { 'Cache-Control': 'no-store' } })

  try {
    const res = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`deribit ${res.status}`)
    const json = await res.json()
    const rows: Summary[] = json.result || []
    if (!rows.length) throw new Error('no option data')

    const spot = rows[0]?.underlying_price ?? 0
    const now = Date.now()

    // distinct expiries, nearest first
    const expiries = [...new Set(rows.map((r) => parseInstrument(r.instrument_name)?.expiry).filter(Boolean) as number[])].sort((a, b) => a - b)
    const live = expiries.filter((e) => e > now)
    const list = live.slice(0, 12).map((e) => ({ expiry: e, dte: Math.max(0, (e - now) / 86400000) }))

    // analyse nearest three expiries in detail
    const details = list.slice(0, 3).map(({ expiry }) => {
      const T = Math.max((expiry - now) / (365 * 86400000), 1 / (365 * 24))
      const legs = rows
        .map((r) => ({ r, p: parseInstrument(r.instrument_name) }))
        .filter(({ p, r }) => p && p.expiry === expiry && r.open_interest > 0 && r.mark_iv)
        .map(({ r, p }) => ({
          strike: p!.strike,
          type: p!.type,
          oi: r.open_interest,
          iv: (r.mark_iv ?? 0) / 100,
          F: r.underlying_price,
        }))
        .filter((x) => Math.abs(x.F / spot - 1) < 0.25 && x.iv > 0)
      const strikes = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b)
      const perStrike = strikes.map((K) => {
        let callGex = 0, putGex = 0, callOi = 0, putOi = 0
        for (const l of legs) {
          if (l.strike !== K) continue
          const g = black76Gamma(l.F, K, T, l.iv) * l.oi * l.F * l.F * 0.01
          if (l.type === 'C') { callGex += g; callOi += l.oi } else { putGex -= g; putOi += l.oi }
        }
        return { strike: K, callGex, putGex, gex: callGex + putGex, callOi, putOi }
      })
      // cumulative GEX by strike -> flip point (first sign change of running total from downside)
      const cum: { strike: number; cum: number }[] = []
      let run = 0
      for (const s of perStrike) { run += s.gex; cum.push({ strike: s.strike, cum: run }) }
      let flip: number | null = null
      for (let i = 1; i < cum.length; i++) {
        if (cum[i - 1].cum < 0 && cum[i].cum >= 0) { flip = cum[i].strike; break }
        if (cum[i - 1].cum > 0 && cum[i].cum <= 0) { flip = cum[i].strike; break }
      }
      // max pain: settlement price that minimises total option payout
      let maxPain: number | null = null, minPain = Infinity
      for (const K of strikes) {
        let pain = 0
        for (const l of legs) {
          if (l.type === 'C') pain += Math.max(0, K - l.strike) * l.oi
          else pain += Math.max(0, l.strike - K) * l.oi
        }
        if (pain < minPain) { minPain = pain; maxPain = K }
      }
      const walls = [...perStrike].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 5)
        .map((s) => ({ strike: s.strike, gex: s.gex, side: s.gex >= 0 ? 'call' : 'put' }))
      const totalCallOi = perStrike.reduce((a, s) => a + s.callOi, 0)
      const totalPutOi = perStrike.reduce((a, s) => a + s.putOi, 0)
      const netGex = perStrike.reduce((a, s) => a + s.gex, 0)
      return { expiry, strikes: perStrike, cum, flip, maxPain, walls, totalCallOi, totalPutOi, netGex, dte: Math.max(0, (expiry - now) / 86400000) }
    })

    const out = { currency, spot, asOf: Date.now(), expiries: list, details }
    cache.set(key, { at: Date.now(), data: out })
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json({ error: `upstream: ${(e as Error).message}` }, { status: 502 })
  }
}
