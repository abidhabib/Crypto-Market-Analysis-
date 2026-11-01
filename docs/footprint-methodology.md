# Footprint data and reading rules

The panel uses Binance **spot aggregate executions**. It does not derive executions from OHLC candles, current depth, wallet labels or estimates. It cannot identify individual traders or establish an order's intent.

## Audit corrections

The previous panel changed its price grouping when the observed range changed, rendered overlapping row heights unrelated to the price bin, reversed the sell-imbalance condition, and reported a larger statistical window than the grid displayed. Symbol changes could retain previous backfill state. Incomplete boundaries and missing aggregate IDs were not disclosed.

The replacement separates the pure calculation model from collection and rendering. Historical and live observations merge by aggregate ID, invalid values are rejected, and observations after the playhead are excluded. The workspace remounts on market changes and aborts obsolete history requests. History reuses the existing bounded/cached exchange endpoint; recording is capped at 40,000 aggregate IDs. An aggregate ID can contain multiple fills, so it is never labelled a raw fill count.

## Definitions

- `m=true` means the buyer is maker: the seller was the aggressor. It contributes to the **left sell** cell. `m=false` contributes to the **right buy** cell.
- Rows are integer multiples of the market's tick size. User-selected grouping stays fixed until changed explicitly; it does not adapt to incoming price ranges. Labels show the lower edge of a bin, not an exact execution price.
- Delta = buyer-initiated coin quantity − seller-initiated coin quantity. Delta percent divides by combined coin volume. Quote totals sum actual `price × quantity` for each execution.
- POC is the row with maximum combined **coin** volume. Equal maxima resolve to the lowest price bin. Switching display to USDT does not redefine POC or imbalances.
- A buy imbalance compares buys at row `i` against sells at `i−1`. A sell imbalance compares sells at `i` against buys at `i+1`. The ratio defaults to 3. The dominant-side minimum quantity is configurable. Missing/zero opposing cells are excluded rather than treated as infinite ratios.
- A stack requires adjacent bin indices with the same imbalance side; skipped price bins break the run.
- Visible CVD, volume and buy share cover exactly the grid's six-bar window. CVD is an observed-window sum, not a session total. The grid scrolls on mobile; all six columns belong to that window.

## Quality and interpretation

The first observed candle is partial. A closed candle also needs recorded observations at/after its close to establish the right boundary. Missing aggregate IDs taint every candle intersecting that gap. Forming, partial and gapped candles withhold directional readings. A lack of recorded prints does not manufacture an empty candle.

Reading filters are explicit heuristics: at least 20 aggregate IDs, a fully recorded closed candle, ±15% coin delta, three adjacent same-side imbalances and a close moving in the same direction produce an **observed initiative** description. Opposite-sign delta versus open-to-close movement describes **price/flow disagreement**, not proven absorption. Without alignment, the panel reports no aligned setup. Stacks on incomplete candles remain visible observations but do not generate a directional reading.

POC migration requires two adjacent complete candles. Follow-through reports the next complete candle's actual close relative to the selected candle's high/low; it is explicitly an observed outcome, not a prediction available at the earlier close. Pausing fixes both observations and playhead. No probability, profit expectation or backtested win rate is claimed.

## Sources and checks

- [Binance Spot aggregate trade stream](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams#aggregate-trade-streams): aggregate IDs, prices, quantities and buyer-maker flag.
- [Binance aggregate trade REST history](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#compressedaggregate-trades-list): bounded history pagination.
- [Sierra Chart Numbers Bars](https://www.sierrachart.com/index.php?page=doc/NumbersBars.php#DiagonalComparisonOfBidVolumeAndAskVolume): bid/sell versus ask/buy diagonal comparison. Zero handling and reading filters above are this app's explicit conventions.

Focused regression cases: direction/volume conservation, deduplication, stable tick bins, both diagonal directions, zero/minimum filters, consecutive stacks, POC, gaps and boundaries, future exclusion, and interpretation gates. Run `node --experimental-strip-types tests/footprint-model.test.mjs`.
