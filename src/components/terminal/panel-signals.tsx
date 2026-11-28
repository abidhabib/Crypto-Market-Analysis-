'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { CheckCircle2, XCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Analysis, Performance, SignalDashboard, SignalRecord } from '@/lib/signals/types'
import { cn } from '@/lib/utils'

const FlowPanel = dynamic(() => import('./panel-signal-flow'), { ssr: false })
const num = (n: number | null | undefined, digits = 2) => n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits })
const price = (n: number | null | undefined) => num(n, n != null && n < 1 ? 8 : 4)
const date = (n: number | null | undefined) => n ? new Date(n).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—'
const control = 'min-h-11 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-40'
const box = 'rounded-lg border border-border/70 bg-card/60 p-4'

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="min-w-0 rounded-md border border-border/60 bg-background/50 p-3"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 break-words font-mono text-lg font-semibold tabular-nums">{value}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>
}

function Checklist({ analysis: a }: { analysis: Analysis }) {
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{a.setup?.replaceAll('-', ' ') ?? 'No confirmed setup'} · {a.version} · {date(a.at)}</p>
    <div className="grid gap-2 md:grid-cols-2">{a.checks.map(c => <div key={c.key} className="rounded-md border border-border/50 p-3">
      <div className="flex items-start gap-2">{c.pass ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden="true" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden="true" />}
        <span className="text-sm font-medium">{c.label}</span><span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">{c.pass ? 'Pass' : c.required ? 'Blocked' : 'Not confirmed'}{c.max ? ` · ${c.points}/${c.max}` : ''}</span></div>
      <p className="mt-1 text-sm text-muted-foreground">{c.detail}</p></div>)}</div>
    <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">{Object.entries(a.metrics).map(([key, value]) => <div key={key}><dt className="break-words text-muted-foreground">{key}</dt><dd className="font-mono">{typeof value === 'number' ? num(value, 6) : value ?? 'Unavailable'}</dd></div>)}</dl>
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{a.coverage.map((c, i) => <li key={i}>{c}</li>)}</ul>
  </div>
}

function SignalCard({ record: s }: { record: SignalRecord }) {
  const { plan: p, analysis: a } = s
  return <article className={box}>
    <div className="flex flex-wrap items-center gap-2"><h3 className="font-mono text-base font-semibold">{s.symbol}</h3><span className="text-sm uppercase text-muted-foreground">{s.exchange} spot</span>
      <span className={cn('ml-auto rounded px-2 py-1 text-sm font-semibold', s.status === 'WON' ? 'bg-emerald-400/10 text-emerald-400' : s.status === 'LOST' ? 'bg-rose-400/10 text-rose-400' : 'bg-amber-400/10 text-amber-300')}>{s.status}</span></div>
    <p className="mt-2 text-sm text-muted-foreground">{a.score}/100 confluence · {a.setup?.replaceAll('-', ' ')} · {date(s.generatedAt)}</p>
    {s.trackingError && <p role="status" className="mt-3 rounded border border-amber-400/40 p-2 text-sm text-amber-300">Tracking delayed: {s.trackingError}</p>}
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <Metric label="Entry" value={price(p.entry)} /><Metric label="Stop loss" value={price(p.stop)} />
      {p.targets.map((t, i) => <Metric key={i} label={`TP${i + 1}${s.targetsHit > i ? ' · reached' : ''}`} value={price(t)} />)}
      <Metric label="Net result" value={s.pnl == null ? 'Unsettled' : `$${num(s.pnl)}`} note={s.r == null ? 'After all exits' : `${num(s.r)} R`} />
    </div>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground"><span>TP1 R/R <b className="text-foreground">{num(p.rr)}</b></span><span>Quantity {num(p.quantity, 8)}</span><span>Reserved ${num(p.notional)}</span><span>Modeled risk ${num(p.riskUsd)} · ≤{p.riskPct}%</span><span>Entry expires {date(p.expiresAt)}</span></div>
    <details className="mt-3 border-t border-border/60 pt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-amber-400">Evidence, trade events and costs</summary>
      <div className="space-y-4 pt-2"><p className="text-sm text-muted-foreground">Paper account ${num(p.equity)}. Fee {p.feeBps} bps + slippage {p.slippageBps} bps per side. Exit one third at each target. Prices and outcomes belong to {s.exchange}; the terminal’s other charts use Binance.</p>
        <div className="grid gap-2 sm:grid-cols-3"><Metric label="Support" value={price(a.support?.price)} /><Metric label="Resistance" value={price(a.resistance?.price)} /><Metric label="Paper fill" value={price(s.fill)} /></div>
        <Checklist analysis={a} /><h4 className="text-sm font-semibold">Event history</h4>
        {s.events.length ? <ol className="space-y-2">{s.events.map((event, i) => <li key={i} className="border-l-2 border-border pl-3 text-sm"><span className="font-mono">{event.kind.toUpperCase()} · {price(event.price)}</span><p>{event.detail}</p><time className="text-xs text-muted-foreground">{date(event.at)}</time></li>)}</ol> : <p className="text-sm text-muted-foreground">Waiting for an eligible 5M candle after generation. No fill is assumed.</p>}
      </div></details>
  </article>
}

function PerformanceCards({ stats: s }: { stats: Performance }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <Metric label="Signals" value={num(s.total)} note={`${s.pending} pending · ${s.open} open`} />
    <Metric label="Settled outcomes" value={`${s.won} won / ${s.lost} lost`} note={`${s.breakeven} breakeven · ${s.expired} expired · ${s.invalidated} invalidated`} />
    <Metric label="Paper win rate" value={s.winRate == null ? 'No settled trades' : `${num(s.winRate)}%`} note={`${s.closed} settled trades; expiry excluded`} />
    <Metric label="Net paper P&L" value={`$${num(s.netPnl)}`} note="Fees and modeled slippage included" />
    <Metric label="Profit factor" value={num(s.profitFactor)} note="Undefined until a loss is recorded" />
    <Metric label="Expectancy" value={s.expectancyR == null ? '—' : `${num(s.expectancyR)} R`} />
    <Metric label="Closed-equity drawdown" value={`$${num(s.maxDrawdown)}`} note="Unrealized drawdown not measured" />
    <Metric label="Execution mode" value="Paper only" note="No real orders or verified live returns" />
  </div>
}

export default function SignalsPanel() {
  const [view, setView] = useState<'scanner' | 'history' | 'method' | 'flow'>('scanner')
  const [data, setData] = useState<SignalDashboard | null>(null), [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false), [days, setDays] = useState(30), [group, setGroup] = useState('day'), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true, busy = false
    const ctrl = new AbortController()
    const load = async () => {
      if (busy || document.hidden) return
      busy = true; setLoading(true)
      try {
        const r = await fetch(`/api/signals?days=${days}&group=${group}&page=${page}`, { signal: ctrl.signal, cache: 'no-store' })
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? 'Unable to load signal history')
        if (active) { setData(body); setError(null) }
      } catch (e) { if (active && !ctrl.signal.aborted) setError(e instanceof Error ? e.message : 'Signal service unavailable') }
      finally { busy = false; if (active) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => { void load() }, 15_000)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; ctrl.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [days, group, page, refresh])
  const scan = data?.lastScan
  const stale = !!scan && data != null && data.serverAt - (scan.finishedAt ?? scan.startedAt) > 600_000
  const state = !data ? 'CONNECTING' : !data.enabled ? 'SCANNER DISABLED' : stale ? 'STALE DATA' : scan?.status === 'error' ? 'DATA UNAVAILABLE' : scan?.status === 'partial' ? 'PARTIAL COVERAGE' : scan?.status === 'running' ? 'SCANNING' : !scan ? 'STARTING' : data.active.length ? 'TRACKING SIGNALS' : 'NO SIGNAL'

  return <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="panel-signals">
    <header className="flex flex-wrap items-center gap-3 border-b border-border/60 p-4"><ShieldCheck className="size-5 text-amber-300" aria-hidden="true" /><div><h2 className="text-lg font-semibold">Spot signal desk</h2><p className="text-sm text-muted-foreground">4H setups · multi-timeframe confirmation · recorded paper outcomes</p></div><button className={cn(control, 'ml-auto inline-flex items-center gap-2')} onClick={() => setRefresh(v => v + 1)} disabled={loading}><RefreshCw className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh</button></header>
    <nav aria-label="Signal views" className="flex flex-wrap gap-2 border-b border-border/60 px-4 py-3">{(['scanner', 'history', 'method', 'flow'] as const).map(tab => <button key={tab} onClick={() => setView(tab)} aria-pressed={view === tab} className={cn(control, view === tab && 'border-amber-400/50 bg-amber-400/10 text-amber-300')}>{({ scanner: 'Scanner & active', history: 'History & performance', method: 'Method & validation', flow: 'Live flow diagnostics' })[tab]}</button>)}</nav>
    {view === 'flow' ? <FlowPanel /> : <div className="space-y-4 p-4">
      {error && <div role="alert" className="rounded-md border border-rose-400/40 bg-rose-400/10 p-3 text-sm text-rose-300">{error} {data ? 'Previously loaded records are shown; freshness is unverified.' : ''}</div>}
      {!data && !error && <p role="status" className="p-8 text-center text-muted-foreground">Loading scanner and saved history…</p>}
      {data && <>
        {(data.error || stale) && <p role="status" className="rounded-md border border-amber-400/40 p-3 text-sm text-amber-300">{data.error ?? 'The scanner has not completed recently. Treat displayed analysis as stale.'}</p>}
        {view === 'scanner' && <>
          <section className={box} aria-label="Scanner status"><div className="flex flex-wrap items-center gap-3"><h3 className="font-mono text-xl font-semibold">{state}</h3><span className="ml-auto text-sm uppercase text-muted-foreground">{scan?.exchange ?? 'Automatic exchange selection'} · SPOT BUY</span></div>
            <p className="mt-3 text-sm text-muted-foreground">{!data.enabled ? 'Background scanning is disabled on this server. Enable the signal worker with a persistent database to collect signals while the app is closed.' : scan?.message ?? 'The background worker is preparing its first scan.'}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4"><Metric label="USDT markets" value={num(scan?.universe)} /><Metric label="Eligible / screened" value={scan ? `${scan.eligible} / ${scan.analyzed}` : '—'} /><Metric label="New signals" value={num(scan?.emitted)} /><Metric label="Data errors" value={num(scan?.errors)} /></div>
            <p className="mt-3 text-sm text-muted-foreground">Every 5 minutes; no overlapping scans. Last completed: {date(scan?.finishedAt)}. All timestamps UTC.</p>
          </section>
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-base font-semibold">Active paper signals ({data.active.length})</h3><p className="text-sm text-muted-foreground">≤1% modeled risk per trade · 3% portfolio cap · no leverage</p></div>
          {data.active.length ? data.active.map(s => <SignalCard key={s.id} record={s} />) : <div className={cn(box, 'py-8 text-center')}><h4 className="font-medium">No active paper signals</h4><p className="mt-2 text-sm text-muted-foreground">A BUY is recorded only after all required checks pass. Market-data failures are shown separately.</p></div>}
          <section className={box}><h3 className="text-base font-semibold">Candidate evidence</h3><p className="mt-1 text-sm text-muted-foreground">Up to 30 fully analyzed candidates from the latest scan. Obvious trend and liquidity failures are filtered first.</p>
            {scan?.candidates.length ? <div className="mt-3 divide-y divide-border">{scan.candidates.map(a => <details key={`${a.exchange}:${a.symbol}`}><summary className="min-h-11 cursor-pointer py-3 text-sm focus-visible:outline-amber-400"><span className="font-mono font-semibold">{a.symbol}</span><span className="ml-3 text-amber-300">{a.score}/100 · {a.decision}</span><span className="ml-3 text-muted-foreground">{a.blockers.slice(0, 2).join(' · ') || 'Required checks passed'}</span></summary><div className="pb-4"><Checklist analysis={a} /></div></details>)}</div> : <p className="py-6 text-sm text-muted-foreground">No complete candidate analyses in this scan.</p>}</section>
        </>}
        {view === 'history' && <>
          <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm">Generated in<select className={control} value={days} onChange={e => { setDays(+e.target.value); setPage(0) }}>{[1, 7, 30, 90, 365].map(d => <option key={d} value={d}>{d === 1 ? 'Today (UTC)' : `Last ${d} days`}</option>)}</select></label><label className="flex items-center gap-2 text-sm">Group by<select className={control} value={group} onChange={e => setGroup(e.target.value)}><option value="day">Day</option><option value="week">Week (Monday)</option><option value="month">Month</option></select></label><span className="text-sm text-muted-foreground">Paper results · UTC generation cohorts</span></div>
          <PerformanceCards stats={data.performance} />
          <section className={box}><h3 className="text-base font-semibold">Period performance</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Paper outcomes grouped by generation date in UTC</caption><thead><tr>{['Period', 'Total', 'Won', 'Lost', 'Open', 'Pending', 'Expired / invalid', 'Net P&L'].map(h => <th key={h} scope="col" className="whitespace-nowrap border-b border-border p-2 text-muted-foreground">{h}</th>)}</tr></thead><tbody>{data.periods.map(({ period, stats: s }) => <tr key={period}>{[period, s.total, s.won, s.lost, s.open, s.pending, `${s.expired} / ${s.invalidated}`, `$${num(s.netPnl)}`].map((v, i) => <td key={i} className="whitespace-nowrap border-b border-border/40 p-2 font-mono">{v}</td>)}</tr>)}</tbody></table></div>{!data.periods.length && <p className="py-6 text-sm text-muted-foreground">No recorded signals in this period. Performance will appear as paper trades settle.</p>}</section>
          {!!data.failures.length && <section className={box}><h3 className="font-semibold">Observed failure evidence</h3><ul className="mt-3 space-y-2 text-sm">{data.failures.map(f => <li key={f.reason}>{f.reason} — {f.count}</li>)}</ul><p className="mt-3 text-sm text-muted-foreground">These are recorded observations, not proven explanations of market behavior. Strategy rules are versioned; they do not silently change after losses.</p></section>}
          <h3 className="text-base font-semibold">Signal ledger ({data.historyTotal})</h3>{data.history.map(s => <SignalCard key={s.id} record={s} />)}
          <div className="flex items-center justify-between gap-3"><button className={control} disabled={page === 0 || loading} onClick={() => setPage(v => v - 1)}>Previous</button><span className="text-sm">Page {page + 1} of {Math.max(1, Math.ceil(data.historyTotal / 25))}</span><button className={control} disabled={(page + 1) * 25 >= data.historyTotal || loading} onClick={() => setPage(v => v + 1)}>Next</button></div>
        </>}
        {view === 'method' && <section className={cn(box, 'max-w-4xl space-y-5 text-sm leading-relaxed')}>
          <h3 className="text-lg font-semibold">Measurable rules, recorded evidence</h3>
          <p>The scanner screens active liquid USDT spot markets. Binance is the default source, with Bybit failover when the universe or market context cannot load. Each signal stays tied to its source exchange through tracking.</p>
          <p>4H levels come from repeated, confirmed swing pivots. Support requires a bullish reclaim; a breakout requires a closed candle above resistance followed by a successful retest. 1H structure, 15M momentum and volume, and 5M timing must agree. Only closed, continuous candles enter the analysis.</p>
          <p>Required confirmations include RSI, MACD, EMA, rolling VWAP, OBV, BTC/ETH trend, order-book liquidity, and matching futures OI, funding and positioning. ATR sets the stop buffer. ADX, Bollinger Bands and Stochastic RSI provide diagnostics. The score must reach {data.policy.minScore}/100; a high score cannot override a failed required check.</p>
          <p>Heatmap policy: <strong>{data.policy.requireHeatmap ? 'required; missing or unfavorable data blocks signals' : 'optional; unavailable data earns no confirmation'}</strong>. Fresh connected heatmaps can reveal nearby liquidation clusters. Missing heatmap data is never reconstructed from assumed leverage. News, economic events and BTC dominance are outside the connected coverage.</p>
          <p>The paper account starts at ${num(data.policy.equity)} and includes settled gains and losses when sizing new signals. Each plan allows at most 1% modeled stop risk and at least 2 R to TP1 after costs. Pending and open positions reserve capital; combined modeled risk is capped at 3%. Gaps and actual execution can exceed modeled risk.</p>
          <p>Entries expire after one hour. Tracking starts with the first complete 5M candle after generation. Stop wins when a candle touches both stop and target. Targets are one-third exits. Remaining positions close after 72 hours. Missing candles pause settlement. Fees ({data.policy.feeBps} bps) and slippage ({data.policy.slippageBps} bps) apply on each side.</p>
          <h4 className="font-semibold">Validation status</h4><p>No verified profitability or live execution results are claimed. History contains forward paper observations. The historical replay tool uses the same technical rules with fees and conservative fills, and labels results separately because historical books, positioning and liquidation heatmaps are not available in candle data. A score measures confluence, not the probability of winning.</p>
          <h4 className="font-semibold">Historical baseline reports</h4>
          {!data.backtests?.length ? <p className="text-muted-foreground">No historical runs have been recorded. The 180–365 day replay command saves its summary here and a complete trade ledger to a JSON report.</p> : data.backtests.map(b => <details key={b.id} className="rounded border border-border p-3"><summary className="min-h-11 cursor-pointer py-2">{b.symbol} · {b.exchange} · technical baseline · {b.performance.closed} settled · ${num(b.performance.netPnl)}</summary><p>{date(b.from)} through {date(b.to)} · {b.evaluations} evaluations · {b.dataFailures} data gaps</p><PerformanceCards stats={b.performance} /><ul className="mt-3 list-disc pl-5 text-muted-foreground">{b.limitations.map(l => <li key={l}>{l}</li>)}</ul></details>)}
        </section>}
      </>}
    </div>}
  </div>
}
