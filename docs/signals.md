# Spot signal desk
# Spot signal desk

The Signals tab runs a server-side spot scanner and a durable forward paper ledger. Existing selected-market order-flow calculations remain available under **Live flow diagnostics**. No order-placement endpoint or trading credential is used.

## Running

The long-running Next server starts the worker through `src/instrumentation.ts`. It screens the market every five minutes and checks paper outcomes every thirty seconds using closed 5M bars. Closing the browser does not stop it. Development hot reloads reuse a process singleton; a renewable SQLite lease prevents overlapping workers across processes sharing the same database.

Settings in `.env` / the process environment:

| Setting | Default | Meaning |
| --- | --- | --- |
| `SIGNALS_ENABLED` | `1` | `0` disables the embedded worker; history remains readable. |
| `SIGNALS_DATABASE_URL` | `file:<cwd>/db/signals.db` | Dedicated SQLite file. Must live on persistent storage in production. |
| `SIGNALS_EXCHANGE` | `auto` | Binance first, Bybit fallback; or explicitly `binance` / `bybit`. |
| `SIGNALS_PAPER_EQUITY` | `10000` | Initial USDT paper equity. Settled P&L adjusts subsequent sizing. Do not change mid-run without treating it as a new account. |
| `SIGNALS_REQUIRE_HEATMAP` | `0` | `1` makes fresh, favorable heatmap coverage mandatory. |
| `SIGNALS_HEATMAP_URL` | unset | Server-owned heatmap adapter URL. |
| `SIGNALS_HEATMAP_KEY` | unset | Optional Bearer credential; never sent to the browser. |

For a separate process supervisor or cron, disable the embedded worker and run the one-cycle command every minute (its durable five-minute schedule prevents unnecessary rescans):

```sh
node --env-file=.env --experimental-strip-types scripts/signals-worker.ts
```

SQLite initializes its own tables using additive `CREATE TABLE IF NOT EXISTS`; there is no destructive Prisma schema push. Signal records persist indefinitely. Detailed scan diagnostics expire after seven days. Signal IDs include exchange, symbol, confirmation candle, strategy version and execution mode. Only one active paper signal per symbol is permitted by the worker; the database also guards active duplicates per exchange/symbol. A restart retains entry evidence, events, target progress and outcome cursor. Back up the database with SQLite's backup mechanism, or stop writers before copying its database/WAL files.

This scheduler requires a persistent Node process and shared local storage. For horizontally scaled or serverless hosting, run a single supervised worker with a database service; separate SQLite files are separate accounts and do not coordinate.

## Data and rules

Public adapters normalize Binance and Bybit into one contract. All candles, instrument precision, order-book levels, futures confirmations and tracked fills for a signal belong to its recorded exchange. Other terminal panels remain Binance-based. Provider failover occurs before scanning when the market universe or BTC/ETH context cannot load; per-symbol failures are reported, not silently replaced with another exchange's prices.

The scanner lists active USDT spot pairs, excludes stablecoin bases and recognized leveraged tokens, and filters invalid instrument metadata, turnover below $5M and absolute daily changes of 30% or more. The first stage fetches 4H candles and screens EMA trend and proximity to repeated pivot levels. Only plausible candidates incur 1H/15M/5M, order-book and derivatives requests. Four bounded workers, per-host pacing, response caching, request coalescing, timeouts and rate-limit cooldowns contain API load. API errors do not become empty successful observations.

Technical inputs use 260 bars; decisions require at least 220 continuous 4H/1H bars and 80 continuous 15M/5M bars. Forming/future candles are excluded. Confirmed swing pivots require two bars on each side. Nearby pivots within 0.35 ATR form a zone; at least two independent pivots are required. Zones are formed before the potential breakout/retest candles.

Two eligible setups:

- Support reclaim: a closed bullish 4H candle rejects and closes above a repeated support zone, with limited extension from the zone. A low below the zone followed by reclaim is recorded as a sweep observation, not proof of stop hunting.
- Breakout retest: a recent 4H close crosses above a historical resistance zone, followed by a separate bullish retest that holds it.

Mandatory gates include 1H higher-low/EMA structure, bullish candle confirmation, 15M relative volume ≥1.2 and rising OBV with 4H volume confirmation, RSI 50–72 and rising, positive 15M/1H MACD histograms, 4H EMA200 and EMA20/50 alignment, rolling 20-bar 15M VWAP, 5M momentum, BTC/ETH trend, and manageable volatility. ADX, Bollinger Bands and Stochastic RSI are recorded diagnostics. Buying pressure is inferred from these observations; candle direction alone does not identify actual buyer identities.

Live order-book gates: uncrossed spread ≤15 bps, at least $20K on each side within 0.5%, bid/ask notional ratio ≥0.8, and freshness within 60 seconds. A shallow snapshot's depth is a lower bound. Futures gates: positive finite OI; recent OI change −1% to +15%; absolute funding ≤0.1%; long/short account ratio 0.3–3; observations no older than 15 minutes. These are versioned heuristics, not validated predictive thresholds.

The weighted score totals 100. Levels, pattern quality, volume intensity, RSI location and sweeps earn graded points. At least 85 points are required, independently of mandatory gates. A failed gate always blocks BUY. The score is not a probability or a claimed accuracy percentage.

## Heatmaps and external context

No liquidation heatmap subscription is bundled. The adapter receives GET parameters `exchange` and `symbol` and must return:

```json
{
  "exchange": "binance",
  "symbol": "BTCUSDT",
  "at": 1795887300000,
  "source": "Provider name / methodology",
  "clusters": [
    { "price": 58000, "usd": 2500000, "side": "long" },
    { "price": 62000, "usd": 3200000, "side": "short" }
  ]
}
```

The timestamp must be fresh (five minutes), and symbol/exchange must match. The adapter must disclose the provider's estimation method in `source`. Missing values are never converted into leverage-derived fictional clusters. Large nearby long clusters compared with short clusters block a signal whenever a fresh heatmap is connected. Strict mode also blocks on missing/stale heatmaps. News, economic calendar and BTC dominance are explicitly listed as unconnected; this implementation does not pretend to have confirmed them. A dedicated feed can be integrated later without changing technical history.

## Risk and outcome accounting

Entry is the current ask rounded up to tick size. Stop lies below the setup's low with a quarter-ATR buffer and at least 1.5 × 15M ATR distance. Setups with stop distances above 8% are rejected. TP1/TP2/TP3 target at least 2/3/4 R, including the exact multiplicative fee/slippage model, and TP1 must lie before the next known resistance. Entries extending more than one 15M ATR from confirmation are rejected. Quantities round down to lot precision, cannot exceed available spot capital, and must meet minimum notional.

Each position risks at most 1% of initial equity plus settled P&L. Pending orders and open positions reserve their full entry cost; the aggregate initial modeled risk is capped at 3%. Reservations are conservative after partial exits. Unsettled proceeds do not fund new positions. There is no leverage. Gap execution can lose more than modeled stop risk.

Signals are recorded immediately, before outcome tracking. Entry eligibility begins with the first complete 5M candle after generation; the partly elapsed generation candle is never reused as an entry. Entries expire after one hour. A gap opening below the stop invalidates an unfilled signal. Stop/target collisions assume stop first. On an entry candle, targets are ignored unless entry was already executable at the open; OHLC cannot prove the intrabar path. Each target exits one third; the remainder closes at the first complete bar reaching the 72-hour limit. Default fees are 10 bps and slippage 5 bps on each side.

Missing/invalid candles pause settlement instead of fabricating a fill, expiry or win. The tracker can catch up in bounded pages after downtime. Event timestamps are candle-close observations, not exact execution timestamps. Reprocessing the same data is idempotent.

A win/loss is the final net result across all exits. Hitting TP1 does not automatically mean a win. Pending, open, expired and invalidated records do not enter settled win rate. Profit factor is undefined until there is a loss. Drawdown is measured on settled equity, not intratrade mark-to-market. Daily/weekly/monthly UTC cohorts use generation time, so late outcomes remain attached to their original day. Records already exist at day end; reports update as open signals settle. Failure analysis reports observed stop hits, support closes or timeouts and does not invent causal explanations. Rules are versioned and do not auto-optimize themselves on losing trades.

## Historical validation

Run a 180–365 day technical baseline using public historical candles:

```sh
node --env-file=.env --experimental-strip-types scripts/signals-backtest.ts \
  --exchange binance --symbol BTCUSDT --days 180 --out /tmp/btc-180d.json
```

The command downloads candles in bounded pages with indicator warmup, replays at 15M closes, tracks fills on subsequent 5M candles, and includes fees/slippage. Binary-search windows expose only data known at each playhead. It saves the full ledger as a new JSON file (refuses to overwrite) and a separate summary under **Method & validation**. Live paper records are never overwritten or mixed into historical metrics.

This is a technical-only baseline, not a backtest of unavailable historical order-book/derivatives/heatmap confirmations. Missing derivative points are not granted, and the 85/100 threshold is retained. Historical turnover/change come from contemporaneous candles. Current instrument tick/lot rules and a selected currently listed symbol introduce limitations and survivorship bias. Open trades at the end remain open. No return is claimed until an actual report exists. Full-strategy historical verification needs archived auxiliary observations and a historical symbol universe; prospective paper history begins collecting evidence now.

## Checks

```sh
node --experimental-strip-types tests/signals.test.mjs
node node_modules/eslint/bin/eslint.js src/lib/signals src/app/api/signals \
  src/components/terminal/panel-signals.tsx src/instrumentation.ts scripts/signals-*.ts
```

Tests cover accepted setups, mandatory vetoes, stale/future data, exact risk arithmetic, entry/exit ambiguity, gaps and replay determinism, partial targets, expiry, UTC attribution, drawdown, provider normalization, database persistence/deduplication and worker leases.

API contracts were checked against [Binance spot market data](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints), [Binance futures market data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), and Bybit's [candles](https://bybit-exchange.github.io/docs/v5/market/kline), [instruments](https://bybit-exchange.github.io/docs/v5/market/instrument), [OI](https://bybit-exchange.github.io/docs/v5/market/open-interest), [account ratios](https://bybit-exchange.github.io/docs/v5/market/long-short-ratio), and [order book](https://bybit-exchange.github.io/docs/v5/market/orderbook).

## Implementation verification — 28 November 2026

- 22 focused signal tests passed, including support-reclaim and breakout-retest acceptance, plus mandatory rejection cases.
- Existing heatmap, navigation, order-flow, stream snapshot and six deployment tests passed. Focused signal lint passed. The project-wide typecheck reports 29 existing error entries outside the signal implementation.
- Public Binance and Bybit instrument lists, candle histories, order books, OI, funding and account ratios returned successfully. A Binance scan screened 531 markets, found 42 eligible, completed in approximately nine seconds with zero data errors and emitted no signals.
- An actual 180-day BTC Binance technical replay evaluated 17,280 checkpoints with no candle-data failures and no qualifying trades. This establishes replay coverage, not a profitable edge or a measurable win rate. No thresholds were relaxed to manufacture results. The temporary report is `/tmp/flowlens-btc-180d-validation.json`; verification data was kept separate from the application's default ledger.
- The production compilation and route build passed with a temporary font-response fixture pointing to the already-installed Geist files. The ordinary build's external Google Fonts download timed out; the application's font configuration was not changed.
- Interactive browser verification remains incomplete. Automatic approval review could not authorize the browser test because the account usage limit had been reached. No production push or deployment was performed.

Pre-existing obfuscated remote-code loader blocks were removed from the root/stream `init`, ESLint, PostCSS and `.vscode/eslint` files. The original setup/configuration was retained. The loaders had fetched and evaluated external payloads when development/build tooling ran; they were not needed for this feature.
