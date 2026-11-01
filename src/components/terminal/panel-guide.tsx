'use client'

import { TABS, SYMBOLS } from '@/lib/terminal/constants'
import { PanelHeader, SourceBadge } from './panel-kit'

const SOURCES = [
  { name: 'Trades / candles / ticker', detail: 'Binance spot public WebSocket (aggTrade, kline_1m, 24h ticker, bookTicker)', tone: 'live' as const },
  { name: 'Order book & heatmap', detail: 'Binance diff-depth @100ms merged into a local full book (snapshot + buffered sync) — 4Hz heat columns, 10Hz top-of-book', tone: 'live' as const },
  { name: 'Funding, OI, liquidations', detail: 'Binance USDT-M futures (markPrice@1s, forceOrder, openInterest, premiumIndex)', tone: 'live' as const },
  { name: 'Options gamma', detail: 'Deribit public book summaries → Black-76 gamma computed in-app', tone: 'live' as const },
  { name: 'Fear & Greed', detail: 'alternative.me index', tone: 'live' as const },
  { name: 'Pulls / sweeps / icebergs / walls', detail: 'In-app level-lifecycle tracking on the local book with adaptive notional thresholds — spoof-style heuristics, not exchange-provided L3', tone: 'est' as const },
  { name: 'Liquidation map', detail: 'In-app estimate (volume distribution × leverage buckets) — not exchange data', tone: 'est' as const },
  { name: 'Signals & insights', detail: 'Computed in-browser at ~1Hz from the live stream (trend, flow, VPIN-style toxicity, R/R checklist)', tone: 'est' as const },
]

const METHOD = [
  ['Market picker', 'Top-150 Binance-spot USDT pairs by 24h quote volume, refreshed every 5s with range bars, spread and sparklines. Star pairs to pin a watchlist. Picking any pair streams it across every panel; exact tick size is fetched from exchangeInfo.'],
  ['Heatmap (v2)', 'A local order book is maintained from the diff-depth stream; every 250ms a column of resting liquidity is appended (blue = bids, violet = asks, intensity log-scaled; merge factor keeps wide spans readable). Overlaid: trade bubbles (radius ∝ √notional, green buys / red sells), × marks where a large level was cancelled before being traded (spoof-style), amber ◆ sweeps, white dashed traded-price line, POC dotted, and yellow decision lines at the nearest big walls. Hover any pixel for resting size, traded volume and pull history.'],
  ['Footprint', 'Actual spot executions: sell aggressors on the left, buy aggressors on the right. Fixed tick bins preserve historical rows. Diagonal buys compare against sells one bin lower; diagonal sells compare against buys one bin higher. Zero/missing opponents are excluded. POC uses combined coin volume. Three adjacent imbalances form a stack. Conditional readings require a closed, fully bracketed recording without ID gaps and at least 20 aggregate IDs; they are heuristics, not backtested prediction probabilities.'],
  ['Volume profile', 'Same trade classification bucketed by price; value area = tightest band around POC containing 70% of volume.'],
  ['Whales', 'Any print above the notional threshold. Markers aggregate to the candle bucket; the net-flow cards use a rolling 30-minute window.'],
  ['Gamma', 'GEX/1% = γ × OI × F² × 0.01 with Black-76 γ at Deribit mark IV. Dealers assumed short customer calls (+γ) / long customer puts (−γ). Flip = strike where cumulative GEX crosses zero. Max pain = settlement strike minimising total payout.'],
  ['L3 events', 'Server-side state machine per (side, price): WALL ≥ adaptive threshold (scaled to the symbol’s median level size); PULL = ≥85% cancelled with no trade at that price; SWEEP = large print consuming a big level at/near best; ICEBERG = level refilled ≥3× after consumption.'],
  ['Liquidation map', 'Last 2h of 1m candles distributed over 10×/25×/50×/100× leverage buckets (45/30/15/10%). liq price ≈ entry × (1 ∓ 1/leverage). Magnitude-only estimate.'],
  ['Sentiment', 'Consensus = weighted average of readings. Crowd gauges (Fear&Greed, funding, retail long/short) are inverted (contrarian); flow gauges (taker balance, top-trader positioning, RSI, trend) are scored with the trend. Weights: F&G 1.2, funding 1.2, retail L/S 1.0, top-trader 1.0, trend 1.0, taker 0.8, RSI 0.8.'],
  ['Signals (prediction)', 'Direction = 15m EMA structure + 30m CVD agreement. Strength = EMA spread + close-consistency. Checklist: strength ≥22, trade driver ≥55%, R/R after costs ≥1.10, target-cost ≤0.35%, volatility <92nd pctile, toxicity <90th pctile. ARMED only when every condition passes; otherwise WAIT with the blockers named. Buy-above / sell-below come from the nearest big walls (falls back to the 24h high/low).'],
  ['Insights', 'A rolling feed built from live events: spoof pulls, sweeps, icebergs, new/vanished walls, whale prints ≥$100K, liquidations, CVD flips, buy bursts, book-skew extremes, funding spikes, RSI stretches and regime changes — deduplicated and tagged. The summary paragraph composes trend + flow + book + volatility + toxicity into one read.'],
  ['Chart', 'Candles with EMA20/50, Bollinger, session VWAP, volume, RSI(14) and a live CVD pane bucketed to the timeframe. Levels toggle pins POC, value-area edges and the 24h high/low onto the price axis. ATR(14) and the last-candle delta show in the legend.'],
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
            <p>Defaults: {SYMBOLS.map((s) => s.label.replace('/USDT', '')).join(', ')} — or open the market picker (button in the top bar) to stream <span className="text-foreground">any of the top-150 USDT pairs</span> across every panel.</p>
            <p className="mt-1.5">Chart timeframes: 1m · 5m · 15m · 1h · 4h · 1d (live 1m stream aggregates into the selected bucket). Footprint runs on its own 15s/1m/5m/15m buckets, volume profile on 15m–4h lookbacks.</p>
            <p className="mt-1.5">Everything renders client-side; buffers hold ~8,000 trades, ~7 min of book columns (the canvas keeps painting older pixels while the tab stays open) and ~1,000 one-minute candles per symbol.</p>
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
