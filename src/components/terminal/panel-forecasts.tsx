'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import type { Forecast, ForecastDashboard, MarketType } from '@/lib/forecasts/types'
import { cn } from '@/lib/utils'

const control = 'min-h-11 rounded-md border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:opacity-40'
const box = 'rounded-lg border border-border/70 bg-card/60 p-4'
const number = (v: number | null, digits = 2) => v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits })
const percent = (v: number | null) => v == null ? 'Awaiting outcomes' : `${number(v)}%`
const price = (v: number | null) => number(v, v != null && v < 1 ? 8 : 4)
const date = (v: number) => new Date(v).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

function ForecastCard({ record: f, now }: { record: Forecast; now: number }) {
  const t = f.tracking, trade = t.trade, p = f.plan
  return <article className={box}>
    <div className="flex flex-wrap items-center gap-3"><h4 className="font-mono text-base font-semibold">{f.symbol}</h4>
      <span className={cn('rounded px-2 py-1 text-sm font-semibold', f.direction === 'UP' ? 'bg-emerald-400/10 text-emerald-400' : f.direction === 'DOWN' ? 'bg-rose-400/10 text-rose-400' : 'bg-muted text-muted-foreground')}>{f.stance} bias</span>
      <span className="ml-auto text-sm">{t.correct == null ? now >= f.endsAt ? 'Evaluation delayed' : 'Forecast pending' : t.correct ? 'Direction correct' : 'Direction incorrect'}</span></div>
    <p className="mt-2 text-sm text-muted-foreground">{f.exchange} · {f.marketType === 'futures' ? 'USDT perpetual' : 'Spot'} · Issued {date(f.issuedAt)}</p>
    <dl className="mt-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
      <div><dt className="text-muted-foreground">Issued action</dt><dd className="font-semibold">{f.action}</dd></div>
      <div><dt className="text-muted-foreground">Directional votes</dt><dd>{f.score > 0 ? '+' : ''}{f.score} / ±7</dd></div>
      <div><dt className="text-muted-foreground">Forecast baseline</dt><dd className="font-mono">{price(t.baseline)}{t.baseline == null ? ' · next 5M open' : ''}</dd></div>
      <div><dt className="text-muted-foreground">4H price change</dt><dd>{t.returnPct == null ? 'Pending' : percent(t.returnPct)}</dd></div>
    </dl>
    <p className="mt-3 text-sm text-muted-foreground">Evaluation: {date(f.startsAt)} → {date(f.endsAt)}. Neutral band: ±{number(f.neutralBandPct)}%. Probability: unvalidated.</p>
    {t.error && <p className="mt-3 rounded border border-amber-400/40 p-2 text-sm text-amber-300">Tracking delayed: {t.error}</p>}
    <details className="mt-3 border-t border-border/60"><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium focus-visible:outline-amber-400">Evidence, entry conditions and recorded outcome</summary>
      <div className="space-y-4">
        <ul className="space-y-2 text-sm">{f.evidence.map(e => <li key={e.label}><span className="font-medium">{e.label}: {e.vote > 0 ? '+' : ''}{e.vote}</span><span className="text-muted-foreground"> · {e.detail}</span></li>)}</ul>
        {f.blockers.length > 0 && <div><h5 className="text-sm font-semibold">Why there was no paper entry</h5><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{f.blockers.map(b => <li key={b}>{b}</li>)}</ul></div>}
        {p && <div className="space-y-2 text-sm"><p>Entry rule: next complete 5M candle must open between <strong>{price(p.entryLow)}–{price(p.entryHigh)}</strong>; otherwise skip. This is the original instruction, not a renewed entry.</p>
          <p>Stop: <strong>{price(p.stop)}</strong> · Target: <strong>{price(p.target)}</strong> · Minimum 2 R after fees/slippage, before funding.</p>
          <p>Independent paper scenario: up to ${p.maxNotional} notional and ${p.riskBudget} modeled stop risk. No leverage or live order.</p></div>}
        <div className="rounded border border-border p-3 text-sm"><p className="font-semibold">Paper trade: {trade.status}</p><p className="mt-1 text-muted-foreground">{trade.detail}</p>
          {trade.entry != null && <p className="mt-2">Fill {price(trade.entry)} · Quantity {number(trade.quantity, 8)} · Exit {price(trade.exit)}</p>}
          {trade.beforeFundingPct != null && <p className="mt-2">After fees/slippage: {percent(trade.beforeFundingPct)} · Funding cost: {trade.fundingPct == null ? 'Pending' : percent(trade.fundingPct)} · Modeled net: {trade.netPct == null ? 'Pending funding' : percent(trade.netPct)}</p>}
          {f.marketType === 'futures' && trade.beforeFundingPct != null && <p className="mt-2 text-muted-foreground">Funding: {trade.fundingStatus}. Binance uses reported mark prices; missing funding mark prices use entry notional. Intrabar exit time is approximated by candle close. Margin and liquidation are not simulated.</p>}
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{f.coverage.map((c, i) => <li key={i}>{c}</li>)}</ul>
        <p className="text-xs text-muted-foreground">Strategy {f.version}. Original reference {price(f.referencePrice)}. {t.actual ? `Observed class: ${t.actual}.` : 'Outcome not yet known.'}</p>
      </div>
    </details>
  </article>
}

export default function ForecastsPanel() {
  const [market, setMarket] = useState<MarketType>('spot'), [view, setView] = useState<'latest' | 'history'>('latest')
  const [days, setDays] = useState(30), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0)
  const [loaded, setLoaded] = useState<{ key: string; body: ForecastDashboard } | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null)
  const key = `${market}:${days}:${page}`, data = loaded?.key === key ? loaded.body : null
  useEffect(() => {
    let active = true, busy = false
    const controller = new AbortController()
    const load = async () => {
      if (busy || document.hidden) return
      busy = true; setLoading(true); setError(null)
      try {
        const r = await fetch(`/api/forecasts?market=${market}&days=${days}&page=${page}`, { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) })
        const body = await r.json()
        if (!r.ok) throw new Error(body.error ?? 'Unable to load forecasts')
        if (active) setLoaded({ key, body })
      } catch (e) { if (active && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Forecasts unavailable') }
      finally { busy = false; if (active) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => { void load() }, 30_000)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [market, days, page, refresh, key])
  const scan = data?.scan, stats = data?.stats
  const stale = data && (!scan || data.serverAt - (scan.finishedAt ?? scan.startedAt) > 75 * 60_000)
  return <div className="space-y-4 p-4" data-testid="forecast-desk">
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1 text-sm"><label htmlFor="forecast-market">Market</label><select id="forecast-market" className={control} value={market} onChange={e => { setMarket(e.target.value as MarketType); setPage(0) }}><option value="spot">Spot · buy / sell / avoid</option><option value="futures">Futures · long / short</option></select></div>
      <div className="grid gap-1 text-sm"><label htmlFor="forecast-range">History range</label><select id="forecast-range" className={control} value={days} onChange={e => { setDays(Number(e.target.value)); setPage(0) }}>{[1, 7, 30, 90, 365].map(d => <option value={d} key={d}>{d} day{d > 1 ? 's' : ''}</option>)}</select></div>
      <button className={cn(control, 'ml-auto inline-flex items-center gap-2')} disabled={loading} onClick={() => setRefresh(r => r + 1)}><RefreshCw className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} aria-hidden="true" />Refresh forecasts</button>
    </div>
    <p className="text-sm text-muted-foreground">Hourly predictions · four-hour outcomes · paper only. Directional bias and entry approval are separate. Spot bearish views do not open short positions.</p>
    {error && <p role="alert" className="rounded border border-rose-400/40 p-3 text-sm text-rose-300">{error} Previously loaded forecasts may be stale.</p>}
    {!data && !error && <p role="status" className="p-6 text-sm text-muted-foreground">Loading saved forecasts…</p>}
    {data && stats && <>
      <section className={box} aria-label="Forecast coverage"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{!data.enabled ? 'Forecast worker disabled' : stale ? 'Awaiting fresh forecasts' : `Forecast scan: ${scan?.status}`}</h3><span className="ml-auto text-sm">{scan?.exchange ?? 'No provider yet'} · {market}</span></div>
        <p className="mt-2 text-sm text-muted-foreground">{scan ? `${scan.saved}/${scan.selected} selected markets recorded from ${scan.eligible} eligible. Last attempt: ${date(scan.finishedAt ?? scan.startedAt)}.` : 'The server will record the first forecasts on its next worker cycle.'} Selection uses 24H turnover; this is a bounded market sample.</p>
        {data.error && <p className="mt-2 text-sm text-amber-300">{data.error}</p>}
        {!!scan?.errors.length && <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-sm focus-visible:outline-amber-400">{scan.errors.length} data coverage errors</summary><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{scan.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details>}
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ['Direction accuracy', percent(stats.directionalAccuracy), `${stats.directionalCorrect}/${stats.directionalTotal} settled UP/DOWN predictions`],
        ['All-class accuracy', percent(stats.accuracy), `${stats.correct}/${stats.settled} settled; includes NEUTRAL`],
        ['Pending / delayed', `${stats.pending} / ${stats.delayed}`, `${stats.total} forecasts in selected UTC period`],
        ['Paper trade win rate', percent(stats.tradeWinRate), `${stats.wins}/${stats.trades} settled after modeled costs; ${stats.pendingFunding} await funding`],
      ].map(([label, value, note]) => <div className={box} key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>)}</div>
      <details className={box}><summary className="min-h-11 cursor-pointer py-2 font-medium focus-visible:outline-amber-400">Accuracy breakdown and measurement rules</summary>
        <div className="mt-3 space-y-3 text-sm"><p>A prediction is correct when its class matches the return from the first complete 5M candle open after issue to the close four hours later. Each forecast freezes its neutral band at issue time. Missing candles delay evaluation.</p>
          <p>Majority-class baseline on this sample: {percent(stats.baselineAccuracy)}. This descriptive benchmark uses the most common observed outcome; it is not a deployable prediction. Hourly four-hour forecasts overlap and are correlated.</p>
          <div className="overflow-x-auto"><table className="w-full text-left"><caption className="py-2 text-left">Predicted vs observed · counts</caption><thead><tr><th scope="col" className="p-2">Predicted</th>{(['UP', 'DOWN', 'NEUTRAL'] as const).map(d => <th scope="col" className="p-2" key={d}>{d}</th>)}</tr></thead><tbody>{stats.byDirection.map(r => <tr className="border-t border-border" key={r.direction}><th scope="row" className="p-2">{r.direction}</th>{(['UP', 'DOWN', 'NEUTRAL'] as const).map(d => <td className="p-2 font-mono" key={d}>{stats.confusion[r.direction][d]}</td>)}</tr>)}</tbody></table></div>
          <p>Mean modeled return per settled paper trade: {stats.meanNetPct == null ? 'Awaiting trades' : percent(stats.meanNetPct)}. Scenarios are independent and may overlap; this is not an account or portfolio return. Risk budgets do not aggregate across scenarios. Futures use 1× notional, adverse slippage, fees and funding; leverage, margin and liquidations are not simulated.</p>
          <p>Rules are unvalidated. Votes are not win probabilities. This version is evaluated prospectively; historical spot backtests do not validate it. News, events and BTC dominance are not connected. Liquidation heatmap coverage depends on the configured provider.</p>
        </div>
      </details>
      <div className="flex gap-2" aria-label="Forecast records">{(['latest', 'history'] as const).map(v => <button className={cn(control, view === v && 'border-amber-400/50 bg-amber-400/10 text-amber-300')} aria-pressed={view === v} key={v} onClick={() => setView(v)}>{v === 'latest' ? 'Latest forecasts' : 'Forecast history'}</button>)}</div>
      {view === 'history' && <details className={box}><summary className="min-h-11 cursor-pointer py-2 text-sm focus-visible:outline-amber-400">Daily accuracy · UTC issue date</summary><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Day', 'Issued', 'Settled', 'Correct', 'Accuracy'].map(c => <th scope="col" className="p-2" key={c}>{c}</th>)}</tr></thead><tbody>{data.periods.map(p => <tr className="border-t border-border" key={p.day}><th scope="row" className="p-2">{p.day}</th><td className="p-2">{p.stats.total}</td><td className="p-2">{p.stats.settled}</td><td className="p-2">{p.stats.correct}</td><td className="p-2">{percent(p.stats.accuracy)}</td></tr>)}</tbody></table></div></details>}
      {(view === 'latest' ? data.latest : data.history).map(f => <ForecastCard key={f.id} record={f} now={data.serverAt} />)}
      {!(view === 'latest' ? data.latest : data.history).length && <p className={cn(box, 'py-8 text-center text-sm text-muted-foreground')}>No recorded forecasts in this period. History begins when the worker obtains valid market data.</p>}
      {view === 'history' && <div className="flex flex-wrap items-center justify-between gap-3"><button className={control} disabled={page === 0 || loading} onClick={() => setPage(p => p - 1)}>Previous</button><span className="text-sm">Page {page + 1} · {data.historyTotal} forecasts</span><button className={control} disabled={(page + 1) * 25 >= data.historyTotal || loading} onClick={() => setPage(p => p + 1)}>Next</button></div>}
    </>}
  </div>
}
