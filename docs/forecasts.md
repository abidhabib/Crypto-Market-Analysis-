# Spot and futures forecasts

Open **Signals → Spot & futures forecasts**, then select **Spot** or **Futures**. This is a separate, prospective rule-based system (`direction-4h-v1`). The existing spot-confluence scanner/history and live-flow diagnostics remain available. Historical spot backtests do not validate this forecast strategy. There are no trading credentials, order endpoints, real executions or calibrated win probabilities.

## Prediction contract

Once per UTC hour, select up to 20 eligible instruments per market type by 24H turnover. `FORECASTS_MARKET_LIMIT` configures 1–50; invalid values use 20. Existing liquidity, stablecoin and leveraged-token filters apply. This is a bounded sample, not a whole-universe claim. Binance is primary and Bybit is fallback according to `SIGNALS_EXCHANGE`. Each record retains its original exchange and market type for all subsequent tracking. Spot uses spot candles/books. Futures uses only active USDT-settled perpetual instruments and futures candles/books; delivery, inverse, USDC and pre-market contracts are excluded.

Use only closed, continuous 4H, 1H and 15M candles plus same-market BTC context, with at least 220 bars per series. No valid candles means no invented forecast: the scan reports an error. Optional-data failures remain explicit and can block entries while the price-based direction forecast is retained.

Directional votes: 4H trend ±2, 1H trend ±2, 15M trend ±1, 15M RSI/MACD agreement ±1, BTC 4H trend ±1. Trend compares price against EMA50 and EMA20 against EMA50. Missing alignment contributes zero. Total ≥3 predicts UP; ≤−3 predicts DOWN; otherwise NEUTRAL. Votes are correlated heuristics and are **not probability estimates**. All three classes, including WAIT/AVOID, are persisted before their outcomes exist.

The baseline is the open of the next full 5M candle strictly after issuance. The endpoint is the close exactly four hours after that baseline. Neutral band is frozen at issuance: max(0.2%, half the 15M ATR as a percent of the reference price). Returns above/below that band label UP/DOWN; the boundaries and everything between label NEUTRAL. Compare predicted and observed classes for correctness. Forecasts are never backdated to compensate for a slow scan, and past forecasts are never generated after a missed worker interval.

## Entry and execution

Spot UP displays BUY bias. Spot DOWN displays SELL / AVOID context; holdings are unknown, so it neither simulates selling owned assets nor borrows a short position. Futures UP/DOWN display LONG/SHORT. Bias and action are separate: most predictions can legitimately be WAIT.

Paper entry requires at least six aligned votes, 15M relative volume ≥1.2, aligned closed price action and 15M/1H MACD, and a 15M reclaim/rejection of a repeated confirmed 4H pivot zone. Fresh nearby order book, spread ≤15 bps and ≥$20K per side within 0.5% are required. Futures additionally require fresh finite OI, funding and account-ratio observations with conservative versioned bounds. Heatmap data, when present, checks adverse clusters; `SIGNALS_REQUIRE_HEATMAP=1` vetoes entries if missing. News, macro calendar and BTC dominance are not connected.

The recorded entry range is reference ±0.25 ATR. Entry is simulated at the next full 5M candle open only if still within that range and risk limits. Otherwise the paper trade is SKIPPED; directional tracking continues. Stop is 1.5 ATR from reference, rounded outward to the instrument tick. Target is at least 2 R after modeled fees/slippage at the worst permitted entry, before funding; an intervening confirmed opposing 4H level blocks the trade. A second risk/quantity check runs at the actual simulated fill.

Each paper scenario independently caps initial notional at $1,000 and modeled stop loss at $100, rounds quantity to the lot step, and checks minimum notional. These are independent research scenarios; overlapping forecasts do **not** form a funded portfolio, reserve shared capital or obey the legacy spot scanner's 3% portfolio cap. UI returns are per trade, not account returns. Gap losses can exceed the modeled stop budget. Futures are evaluated at 1× notional; margin, leverage, liquidation, borrow and live exchange order constraints are not simulated.

Fees: 10 bps per side spot, 5 bps per side futures. Slippage: 5 bps adverse per side. Fees are configurable only by a new code/strategy version, not fetched account fee tiers. Stop-first if a closed 5M bar touches both stop and target. Stop gaps use the worse opening price; favorable target gaps do not assume price improvement. Exit remaining exposure at the four-hour endpoint. Fill/exit timing within OHLC bars is approximate; exit timestamps use candle close.

Futures funding settles after a five-minute publication allowance using historical rates from the recorded exchange. Positive rates debit longs and credit shorts. Binance's reported funding mark price determines funding notional. If mark price is unavailable (including Bybit history), entry notional is used and the result is explicitly ESTIMATED. Events from entry through the modeled exit timestamp are included; this boundary convention and intrabar timing can differ from actual fills. Funding failures remain pending and exclude that trade from net-return/win-rate metrics until resolved. Empty successful history means no reported funding event in the interval. Rates may be revised upstream; this implementation does not audit revisions after settlement.

## Accuracy and history

SQLite `MarketForecast` stores original direction, reference, evidence, source, horizon, neutral band, action and plan. Issue IDs deduplicate by strategy/market/symbol/hour across provider failover. Tracking updates replace only the `tracking` JSON subtree. The legacy spot `SignalRecord` table is untouched. A separate renewable lease guards forecast work across processes.

The worker starts through Next instrumentation, checks outcomes every 30 seconds and makes hourly forecasts. Partial scans retry after five minutes without replacing already issued forecasts. Disabling `SIGNALS_ENABLED` disables both embedded workers; `FORECASTS_ENABLED=0` disables forecasts only. A persistent Node process and persistent `SIGNALS_DATABASE_URL` are required. Restarting recovers pending forecasts, including funding. Data gaps pause outcomes until original exchange coverage recovers; they never become automatic losses or neutral results. Forecast records are retained indefinitely; back up the SQLite database/WAL correctly.

Dashboard shows UP/DOWN accuracy, all-class accuracy including neutral, pending/delayed counts, confusion matrix, daily issue-date cohorts and paper trade win rate. Only settled outcomes enter accuracy denominators; only cost-settled executed trades enter trade metrics. Mean per-trade return is not compounded portfolio performance. The majority-class baseline is descriptive on the observed sample, not a deployable forecast. Hourly four-hour forecasts overlap, so observations are correlated and sample counts must not be treated as independent trials. No verified profitability or accuracy target is claimed.

Server queries aggregate performance in SQLite; detail history is paginated to 25 records. Candle requests are coalesced across overlapping forecasts and bounded to 1,000 bars for restart recovery. Shared provider pacing, caching, timeouts and cooldowns limit API load. API reads do not start scans or mutate records.

## Operations and validation

```sh
pnpm test:forecasts
pnpm test:signals
# Explicit one-cycle operator command (also runs when embedded workers are disabled):
node --env-file=.env --experimental-strip-types scripts/forecasts-worker.ts
```

`GET /api/forecasts?market=spot&days=30&page=0` returns no-store data. Markets: spot/futures; days: 1/7/30/90/365. Tests exercise both directions, spot restrictions, future-data exclusion, missing data, entry gaps, stop/target ambiguity, funding sign and estimates, exact horizons, statistics and durable immutable predictions. High predictive accuracy remains to be demonstrated prospectively and with independently held-out historical data.

Provider contracts: [Binance USDⓈ-M market data](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Exchange-Information), [Binance funding history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [Bybit instruments and pagination](https://bybit-exchange.github.io/docs/v5/market/instrument), [Bybit funding history](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate).
