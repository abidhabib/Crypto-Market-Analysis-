# Whales view: reference and measurement

The authenticated Tradfye Whales view was inspected on 2026-10-31: live BTC/USDT chart, detection tooltips, size selector, bubble settings and methodology help. No proprietary source was copied.

The observed layout uses candle-aligned execution bubbles, EMA20/50, buyer/seller average prices, top traded-price zones, a side buy/sell profile, volume bars and a lower net-flow pane. Its controls distinguish Sweep, Aggressive, Level and Big print, automatic/manual thresholds and shared or independent candle timeframes. Its help identifies grouping as inference and warns about partial history.

## Implementation

- Big print: one Binance aggregate-trade ID. Binance aggregates fills sharing price and taker order; a print does not expose an account or establish the complete order across prices.
- Sweep: consecutive IDs, one aggressor side, a bounded burst duration and at least two distinct observed prices. A possible sweep, not proof of a single order.
- Aggressive: consecutive same-side executions at the same actual price within the configured duration. No claim that quotes held unchanged or that absorption occurred.
- Level: executions in a fixed time bucket and price bin. Exact buy/sell quantities and notional are retained; mixed bubbles show both.
- Auto: upper 0.5% of observed candidate sizes for the selected mode and visible window, with a $1K floor. A small history gives a small calibration sample.
- VWAP: actual side notional divided by actual side quantity. Group prices and times use quantity and notional weighting respectively.
- Zones/profile: measured executed volume at binned prices, separate from resting orders. Totals use all selected executions even when drawing is capped.
- Volume/CVD: observed executions split into detected and remaining trades without double counting. CVD is rebased at the visible left edge. Each CVD line has its own scale; dollar totals carry magnitude.
- Coverage: deduplication by aggregate ID, explicit ID discontinuities, no invented trades before recording, and a 40K client recording bound. Historical candles do not populate missing whale executions.

The history route fetches at most four pages per request, caches/coalesces identical requests, respects exchange rate limits and retains successful pages when later requests fail. The UI loads bounded batches progressively while live data remains usable, with stop/retry controls. Market changes remount the workspace and abort obsolete requests. Candle history is tagged by timeframe to prevent drawing stale responses at another interval.

Plan uses existing Signals trigger levels, hidden in earlier historical views. Gamma uses the existing fresh Deribit computation and is hidden without matching historical options data. Liq uses the existing explicitly labelled leverage scenarios, not known future positions. These overlays do not enter execution totals.

The chart uses one time/price projection for candles, bubbles, averages, zones, profile and cursor. A cached scene keeps pointer movement independent of model calculation. Wheel/trackpad/touch use shared navigation with Whales-specific bounds; Heatmap defaults are preserved.

The live-execution badge uses receipt times of new trade events on the browser's own clock. VPS and exchange timestamp differences cannot falsely mark an active feed stale; historical snapshots alone do not count as a new live trade.

## Sources

- [Binance aggregate trade stream and maker flag](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [Binance aggregate-trade history and inclusive IDs](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)
- [Official market-data-only endpoints](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md)

## Validation

`tests/whales-model.test.mjs` checks deduplication, mode boundaries, exact mixed flow/VWAP, conservation, causal history, gap reporting, area scaling and partial higher-timeframe candles. `tests/whales-history.test.mjs` checks pagination, interrupted loads, rate-limit handling and cursor/row validation. Existing navigation tests retain Heatmap behavior.
