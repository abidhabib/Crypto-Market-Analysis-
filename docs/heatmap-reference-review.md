# Heatmap interaction and order-flow review

Reference inspected through its authenticated UI: [Tradfye terminal](https://tradfye.com/terminal). This review describes visible controls, tooltips, help text and interactions; no proprietary source was copied. Account credentials and access codes are not included.

## What was missing

The reference's main improvement is the shared price projection: its heatmap, executed-volume columns and resting order book all use the same vertical price coordinates. A separate order-book sidebar with unrelated row spacing cannot provide that comparison. Its buyer/seller display is an order-flow ladder, rather than a count of people buying or selling.

The reference separates chart span from candle timeframe and keeps secondary controls in expandable menus. Its right-side presets combine a ladder, executed volume, per-price delta and tape. Its overlay controls separately enable planning levels, modeled liquidation clusters and computed options levels. Trade bubbles and resting-liquidity brightness encode different quantities.

## Implemented behavior

- The heatmap owns its price-aligned columns. Its old independent global rail and rail toggle are omitted on this tab; the other tabs keep their rail.
- The default SuperDOM and tape show executed selling, resting bids, price, resting asks and executed buying, with separate visible-row totals. USDT and coin-unit modes are available for the ladder. These do not identify individual buyers, sellers or whales.
- Columns can be selected, reordered or set using presets. Available views include the resting book, resting size, cumulative depth, executed volume, per-price delta, cumulative per-price delta, retained-buffer volume profile, observed quote-size changes and tape. Columns share the heatmap's price transform and bin size.
- Buy/sell execution VWAP is computed as total notional divided by coin quantity for each aggressor side, within the selected window or retained-buffer scope. It is not trader inventory or position cost basis.
- The tape is newest first, with observed last-minute buy/sell totals. Its minimum-size filter affects only tape rows, not totals. The bubble filter likewise does not change flow metrics.
- The recorded volume profile uses retained executions through the playhead, with a point-of-control outline and contiguous 70% value area. It is explicitly a rolling buffer, not a guaranteed complete trading session.
- Quote-change counts compare binned snapshot sizes, skipping gaps, stale source observations and book rebuilds. Five-second additions and removals require a continuous comparable baseline; a removal is not proof of a cancellation or spoofing.
- Price-cluster and time-step bubble modes are selectable; automatic mode changes to time steps on longer chart windows. Step length and size remain configurable. Gold outlines highlight the largest displayed clusters, not verified individual whale orders.
- Recorded best bid/ask paths, optional 1m candles, and an optional chart-window CVD strip provide context. Historical candles are shown only after their minute has completed.
- Plan shows the existing Signals buy/sell reference triggers, or optional manually entered entry/stop/target levels. Manual inputs do not submit orders. Historical exploration recalculates reference walls from recorded snapshots instead of reading present-day Signals levels.
- Gamma fetches the existing Deribit computation for supported BTC/ETH/SOL markets. It shows the nearest eligible expiry within 30 days, call/put gamma walls, the computed flip and max pain. It excludes expired, future-dated and stale snapshots. Gamma is hidden during historical exploration because the app does not record an options history. API errors and unsupported markets are stated rather than filled with sample data.
- Liq separates reported Binance futures forced-order events from modeled leverage scenarios. BUY forced orders close short positions; SELL forced orders close long positions. Reported events appear as pink diamonds. Scenario lines use completed spot-candle typical prices, volume, assumed 25x/50x/100x leverage and 0.5% maintenance margin. They do not use actual account positions or a known leverage distribution, do not claim dollar liquidation amounts, and differ from futures mark-price liquidation rules.
- Price tags and hover details explain each overlay. Out-of-view levels are reported so a missing visible line is not mistaken for missing data.
- Wheel zoom, trackpad pinch, drag-to-pan and horizontal swipe remain available. Scrolling on the price axis also zooms price. A reset returns to the live chart. Cursor drawing reuses the cached chart image instead of rebuilding liquidity on every pointer move.
- On narrow screens, columns are omitted rather than squeezed into unreadable widths. An expandable HTML ladder provides the same row values on mobile and for keyboard/screen-reader access. Insights remain available behind a toggle.

## Deliberate limits

The reference advertises longer-resolution history. This implementation retains the existing bounded recording and does not pretend to have day-long historical order books. Refreshes or stream restarts can shorten replay. Trade history may be shorter than depth history.

The reference's help discusses additional event detectors and user alerts. This change keeps the existing qualified reaction model and adds reported liquidation prints; it does not claim order-level identities, calibrated trade predictions, exchange execution, alert sounds or a backtested decision strategy.

Gamma and liquidation scenarios are computed overlays. A visually similar line is not evidence that the underlying exchange positions are known. No changes were made to the production VPS or stream service as part of this local UI implementation.

## Verification

Pure tests cover notional/quantity separation, cumulative sides, scope selection, causal replay boundaries, VWAP, quote reset/gap behavior, profile value area, liquidation direction, future/incomplete candle exclusion, options freshness, CVD, adaptive columns and time-step aggregation. Browser checks cover presets, order changes, row inspection, manual Plan inputs, overlay toggles, unavailable/successful options responses, replay boundaries, live data and the mobile ladder.

Options-response and market fixtures used for deterministic browser checks exist only in a disconnected local test browser. Production code does not generate synthetic market observations. Full-project type checking still reports pre-existing issues outside this heatmap work.
