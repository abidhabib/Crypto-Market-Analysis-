'use client'

import { TABS, SYMBOLS } from '@/lib/terminal/constants'
import { PanelHeader, SourceBadge } from './panel-kit'

const SOURCES = [
  { name: 'Trades / candles / book', detail: 'Binance spot public REST + WebSocket (aggTrade, depth20@100ms, kline_1m, 24h ticker, depth500 poll @1s)', tone: 'live' as const },
  { name: 'Funding, OI, liquidations', detail: 'Binance USDT-M futures (markPrice@1s, forceOrder, openInterest, futures/data endpoints)', tone: 'live' as const },
  { name: 'Options gamma', detail: 'Deribit public book summaries → Black-76 gamma computed in-app', tone: 'live' as const },
  { name: 'Fear & Greed', detail: 'alternative.me index', tone: 'live' as const },
  { name: 'Liquidation map', detail: 'In-app estimate (volume distribution × leverage buckets) — not exchange data', tone: 'est' as const },
  { name: 'L3 events', detail: 'In-app heuristics on the live top-20 book — not exchange-provided L3', tone: 'est' as const },
]

const METHOD = [
  ['Footprint', 'Aggressive buys = market buys (ask-lift), aggressive sells = market sells (bid-hit) from aggTrades. Diagonal imbalance compares buy volume at one level against sell volume one row lower; rows ≥ the chosen multiple are shaded. POC = busiest level of the candle.'],
  ['Volume profile', 'Same trade classification bucketed by price; value area = tightest band around POC containing 70% of volume.'],
  ['Heatmap', 'Depth-500 snapshots each second, binned by price; colour intensity is log-scaled resting size. Historical columns accumulate while the tab is open (and while the symbol is active).'],
  ['Whales', 'Any print above the notional threshold. Markers aggregate to the candle bucket; the net-flow cards use a rolling 30-minute window.'],
  ['Gamma', 'GEX/1% = γ × OI × F² × 0.01 with Black-76 γ at Deribit mark IV. Dealers assumed short customer calls (+γ) / long customer puts (−γ). Flip = strike where cumulative GEX crosses zero. Max pain = settlement strike minimising total payout.'],
  ['L3 events', 'State machine per (side, price): WALL appears ≥ threshold; PULL = ≥70% of the peak cancelled within 12s without best-price touch; SWEEP = ≥80% consumed while at best; ICEBERG = level refilled ≥3× after ≥50% drops.'],
  ['Liquidation map', 'Last 2h of 1m candles distributed over 10×/25×/50×/100× leverage buckets (45/30/15/10%). liq price ≈ entry × (1 ∓ 1/leverage). Magnitude-only estimate.'],
  ['Sentiment', 'Consensus = weighted average of readings. Crowd gauges (Fear&Greed, funding, retail long/short) are inverted (contrarian); flow gauges (taker balance, top-trader positioning, RSI, trend) are scored with the trend. Weights: F&G 1.2, funding 1.2, retail L/S 1.0, top-trader 1.0, trend 1.0, taker 0.8, RSI 0.8.'],
]

export default function GuidePanel() {
  return (
    <div className="h-full min-h-0 overflow-y-auto" data-testid="panel-guide">
      <PanelHeader title="Guide" sub="Shortcuts, data sources, methodology and limits" source="docs" />
      <div className="grid gap-3 p-3 xl:grid-cols-2">
        <section className="rounded-md border border-border/60">
          <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold">Keyboard shortcuts</div>
          <div className="p-3">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {TABS.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5">
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase">{t.key}</kbd>
                  <span className="text-[11px]">{t.label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold">B</kbd>
                <span className="text-[11px]">Toggle book rail</span>
              </div>
              <div className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-bold">Esc</kbd>
                <span className="text-[11px]">Exit H-line mode</span>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Shortcuts are ignored while typing in inputs.</p>
          </div>
        </section>

        <section className="rounded-md border border-border/60">
          <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold">Symbols & timeframes</div>
          <div className="p-3 text-[11px] text-muted-foreground">
            <p>Symbols: {SYMBOLS.map((s) => s.label.replace('/USDT', '')).join(', ')} (USDT pairs, streamed live on selection).</p>
            <p className="mt-1.5">Chart timeframes: 1m · 5m · 15m · 1h · 4h · 1d (live 1m stream aggregates into the selected bucket). Footprint runs on its own 15s/1m/5m/15m buckets, volume profile on 15m–4h lookbacks.</p>
            <p className="mt-1.5">Everything renders client-side; buffers hold ~6,000 trades, ~15 min of book history and ~1,000 one-minute candles per symbol.</p>
          </div>
        </section>

        <section className="rounded-md border border-border/60">
          <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold">Data sources</div>
          <div className="divide-y divide-border/40">
            {SOURCES.map((s) => (
              <div key={s.name} className="flex items-start gap-2 px-3 py-2">
                <div className="pt-0.5"><SourceBadge label={s.tone === 'live' ? 'live' : 'estimate'} tone={s.tone} /></div>
                <div className="min-w-0">
                  <div className="text-[11px] font-medium">{s.name}</div>
                  <div className="text-[10px] text-muted-foreground">{s.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-border/60">
          <div className="border-b border-border/60 px-3 py-1.5 text-[11px] font-semibold">Methodology per module</div>
          <div className="divide-y divide-border/40">
            {METHOD.map(([name, desc]) => (
              <div key={name} className="px-3 py-2">
                <div className="text-[11px] font-medium">{name}</div>
                <div className="text-[10px] leading-relaxed text-muted-foreground">{desc}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-[#f0b90b]/30 bg-[#f0b90b]/5 p-3 text-[10px] leading-relaxed text-muted-foreground xl:col-span-2">
          <span className="font-semibold text-[#f0b90b]">Honest limits:</span> the liquidation map and L3-style events are
          heuristic estimates, not exchange-provided Level-3 data; the gamma model assumes a single dealer-positioning
          convention; footprint history is limited by how many aggTrades the exchange exposes (the live stream keeps
          extending the window while the terminal is open). Nothing here is investment advice.
        </section>
      </div>
    </div>
  )
}
