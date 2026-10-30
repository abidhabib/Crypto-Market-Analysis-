'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTerminal } from '@/lib/terminal/store'
import { getStream } from '@/lib/terminal/stream-client'
import { usePoll } from '@/lib/terminal/hooks'
import { ema, rsi, atr, timeframeMs, aggregate } from '@/lib/terminal/indicators'
import { fmtPct, fmtClock } from '@/lib/terminal/format'
import { PanelHeader, Meter, StatCard, AsOf, toneColor } from './panel-kit'
import { cn } from '@/lib/utils'
import { GREEN, RED } from '@/lib/terminal/constants'
import type { SentimentData } from '@/lib/terminal/types'

interface Reading {
  key: string
  label: string
  score: number      // -100..100 (positive = bullish read)
  display: string
  note: string
  weight: number
  crowd: boolean     // contrarian handling
}

export default function SentimentPanel() {
  const { symbol } = useTerminal()
  const [data, setData] = useState<SentimentData | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => fetch(`/api/sentiment?symbol=${symbol}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive) { if (j.error && !j.fng) setErr(j.error); else { setData(j); setErr(null) } } })
      .catch(() => {})
    load()
    const id = setInterval(load, 60_000)
    return () => { alive = false; clearInterval(id) }
  }, [symbol])

  const klines = usePoll(() => getStream().klines, 5000)
  const computed = useMemo(() => {
    const h1 = aggregate(klines, timeframeMs('1h'))
    const closes = klines.map((c) => c.c)
    const R = rsi(closes, 14)
    const rsiNow = R[R.length - 1] ?? null
    const E = ema(closes, 50)
    const emaNow = E[E.length - 1] ?? null
    const priceNow = closes[closes.length - 1] ?? null
    const A = atr(h1, 14)
    const atrNow = A[A.length - 1] ?? null
    const atrPct = atrNow && priceNow ? (atrNow / priceNow) * 100 : null
    // ATR percentile vs last 30 days of 1h bars
    let atrRank: number | null = null
    if (atrNow && h1.length > 50) {
      const trs: number[] = []
      for (let i = 1; i < h1.length; i++) {
        const pc = h1[i - 1].c
        trs.push(Math.max(h1[i].h - h1[i].l, Math.abs(h1[i].h - pc), Math.abs(h1[i].l - pc)))
      }
      const below = trs.filter((t) => t < (atrNow ?? 0)).length
      atrRank = (below / trs.length) * 100
    }
    const mom = priceNow && emaNow ? ((priceNow - emaNow) / emaNow) * 100 : null
    return { rsiNow, mom, atrPct, atrRank, priceNow }
  }, [klines])

  const mark = usePoll(() => getStream().mark, 1000)

  const readings: Reading[] = useMemo(() => {
    const out: Reading[] = []
    if (data?.fng?.value != null && isFinite(data.fng.value)) {
      const v = data.fng.value
      out.push({
        key: 'fng', label: 'Fear & Greed index', score: (50 - v) * 2, // contrarian
        display: `${v} — ${data.fng.label ?? ''}`,
        note: 'Crypto-wide index. Extreme greed often precedes pullbacks, extreme fear precedes bounces → scored contrarian.',
        weight: 1.2, crowd: true,
      })
    }
    if (data?.globalLongShort) {
      const r = data.globalLongShort.ratio
      out.push({
        key: 'gls', label: 'Global long/short accounts', score: -(Math.min(100, Math.max(-100, (r - 1) * 200))),
        display: `${r.toFixed(2)} · ${data.globalLongShort.longPct.toFixed(1)}% long`,
        note: 'Retail account positioning. Crowded longs = squeeze fuel → scored contrarian.',
        weight: 1, crowd: true,
      })
    }
    if (data?.topLongShort) {
      const r = data.topLongShort.ratio
      out.push({
        key: 'tls', label: 'Top-trader positioning', score: (Math.min(100, Math.max(-100, (r - 1) * 200))),
        display: `${r.toFixed(2)} · ${data.topLongShort.longPct.toFixed(1)}% long`,
        note: 'Top traders by position size. Smart-money proxy → scored with the trend.',
        weight: 1, crowd: false,
      })
    }
    if (data?.takerFlow) {
      const r = data.takerFlow.buySellRatio
      out.push({
        key: 'taker', label: 'Taker buy/sell volume (5m)', score: Math.min(100, Math.max(-100, (r - 1) * 250)),
        display: r.toFixed(2),
        note: 'Aggressive flow balance — momentum confirmation, scored with the trend.',
        weight: 0.8, crowd: false,
      })
    }
    if (mark) {
      const f = mark.funding
      out.push({
        key: 'funding', label: 'Perp funding rate', score: -Math.min(100, Math.max(-100, f * 100 * 100)),
        display: `${fmtPct(f * 100, 4)} (8h)`,
        note: 'Crowded side pays. Rich positive funding = overheated longs → scored contrarian.',
        weight: 1.2, crowd: true,
      })
    }
    if (computed.rsiNow != null) {
      const r = computed.rsiNow
      out.push({
        key: 'rsi', label: 'RSI (14, 1m base)', score: Math.min(100, Math.max(-100, (r - 50) * 3.3)),
        display: r.toFixed(1),
        note: r > 70 ? 'Overbought zone — momentum strong but stretched.' : r < 30 ? 'Oversold zone — capitulation territory.' : 'Neutral momentum band.',
        weight: 0.8, crowd: false,
      })
    }
    if (computed.mom != null) {
      const m = computed.mom
      out.push({
        key: 'mom', label: 'Price vs EMA50', score: Math.min(100, Math.max(-100, m * 40)),
        display: fmtPct(m),
        note: 'Trend-following read: above/below the 50-period mean on the live 1m series.',
        weight: 1, crowd: false,
      })
    }
    if (computed.atrRank != null) {
      const v = computed.atrRank
      out.push({
        key: 'vol', label: 'Volatility (ATR rank 30d)', score: 0,
        display: `${v.toFixed(0)}th pct · ${computed.atrPct?.toFixed(2)}%`,
        note: 'Context meter — high percentile means crowded stops and wider ranges, not a direction bet.',
        weight: 0, crowd: false,
      })
    }
    return out
  }, [data, mark, computed])

  const consensus = useMemo(() => {
    let num = 0, den = 0
    for (const r of readings) {
      const s = r.crowd ? r.score : r.score // crowd ones already inverted in score
      if (r.weight > 0) { num += s * r.weight; den += r.weight }
    }
    return den ? num / den : 0
  }, [readings])

  const label = consensus > 25 ? 'Bullish' : consensus < -25 ? 'Bearish' : 'Mixed'

  return (
    <div className="h-full min-h-0 overflow-y-auto" data-testid="panel-sentiment">
      <PanelHeader
        title="Sentiment"
        sub="Every reading as a meter · crowd gauges scored contrarian, flow gauges with the trend · weights shown in the guide"
        source="alternative.me + Binance futures"
        right={<AsOf ts={data?.asOf} />}
      />
      {err && <div className="mx-3 mt-2 rounded border border-[#ea3943]/40 bg-[#ea3943]/10 px-3 py-2 text-[11px] text-muted-foreground">Some inputs unavailable: {err}. Meters render as data arrives.</div>}
      <div className="grid gap-3 p-3 lg:grid-cols-[300px_1fr]">
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border/60 bg-card/60 p-4">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Consensus (weighted)</div>
            <div className="mt-2 flex items-end justify-between">
              <span className="text-3xl font-bold font-mono" style={{ color: toneColor(consensus) }}>{consensus >= 0 ? '+' : ''}{consensus.toFixed(0)}</span>
              <span className="text-sm font-semibold" style={{ color: toneColor(consensus) }}>{label}</span>
            </div>
            <div className="relative mt-3 h-2 rounded-full bg-muted">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              <div className="absolute inset-y-0 rounded-full" style={{
                left: `${Math.min(50, 50 + consensus / 2)}%`,
                width: `${Math.abs(consensus) / 2}%`,
                background: toneColor(consensus),
              }} />
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground"><span>−100 bearish</span><span>0</span><span>bullish +100</span></div>
            {data?.fng?.history?.length ? (
              <div className="mt-3">
                <div className="text-[10px] text-muted-foreground">Fear & Greed, 30d</div>
                <svg viewBox="0 0 280 40" className="mt-1 h-10 w-full">
                  {(() => {
                    const h = data.fng.history.slice(-30)
                    const max = Math.max(...h.map((p) => p.v), 100)
                    return h.map((p, i) => {
                      const x = (i / Math.max(1, h.length - 1)) * 278 + 1
                      const y = 38 - (p.v / max) * 36
                      return <rect key={i} x={x} y={y} width={4} height={40 - y} fill={p.v >= 55 ? GREEN : p.v <= 45 ? RED : '#8b93a7'} />
                    })
                  })()}
                </svg>
              </div>
            ) : null}
          </div>
          {computed.priceNow != null && (
            <StatCard label="Live price (spot 1m)" value={computed.priceNow.toLocaleString('en-US')} sub={`mark ${getStream().mark?.p?.toLocaleString('en-US') ?? '—'} · funding ${mark ? fmtPct(mark.funding * 100, 4) : '—'}`} />
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {readings.map((r) => (
            <Meter
              key={r.key}
              label={r.label}
              value={r.score}
              display={r.display}
              tone={r.score > 15 ? 'up' : r.score < -15 ? 'down' : 'neutral'}
              note={r.note}
            />
          ))}
          {readings.length === 0 && (
            <div className="col-span-2 rounded-md border border-border/60 bg-card/60 p-6 text-center text-xs text-muted-foreground">Loading sentiment inputs…</div>
          )}
        </div>
      </div>
    </div>
  )
}
