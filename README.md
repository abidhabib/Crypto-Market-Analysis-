# Crypto-Market-Analysis-

A crypto market analysis terminal built with Next.js, React, TypeScript and Canvas. It includes a live liquidity heatmap with grouped trade bubbles, charts, footprint, volume profile, whale activity, futures data, options gamma and market context.

## Run locally

Requires Node.js 22.12+ (or Bun) and pnpm 9.15.4. Public market data connections require access to Binance and the other configured upstream sources.

```sh
corepack pnpm@9.15.4 install --frozen-lockfile
cp .env.example .env
corepack pnpm@9.15.4 dev
```

In another terminal, from the repository root, start the live market data service:

```sh
node --experimental-strip-types mini-services/terminal-stream/index.ts
```

Open http://localhost:3000. The live Socket.IO service listens on port 3031. Running the web app alone does not provide the live order book or trade feed.

The heatmap uses recorded order book snapshots and trades. Its history is held in memory and resets when the stream service restarts. Nearby executions are grouped into bubbles; these do not identify individual traders or wallets.

## Heatmap analysis and replay

- Nearby liquidity shows its observed age and replenishment count. Ages are lower bounds from the available recording and restart after gaps or book rebuilds.
- The Reactions toggle adds compact touch, rejection, replenishment, possible consumption/withdrawal and possible absorption markers. Hover markers or expand an observed reaction for its evidence and limitations.
- Data quality reports synchronized versus partial/unknown books, source depth age, missing intervals, book rebuilds and sampled history. Expand it for the detection rules and available trade history.
- Replay history captures the current in-memory recording. Scrub, step through snapshots, play at different speeds, or inspect an event in replay. Price, volume metrics and annotations use only observations at or before the playhead. Return to live resumes the incoming feed.

Absorption and order-removal classifications are snapshot heuristics, not proof of hidden orders, cancellations or future price direction. Missing trade history is not reconstructed or filled with synthetic executions.

## Vercel deployment

Vercel's [Hobby plan](https://vercel.com/docs/plans/hobby) is free within its quotas for personal, non-commercial use. The Next.js dashboard can be hosted there. Use the Next.js preset, pnpm install, and `pnpm build`.

**The complete live app is not configured for one-click Vercel deployment.** `mini-services/terminal-stream/index.ts` is a separate long-running server; importing the repository does not start it. Deploy this service separately and set `NEXT_PUBLIC_STREAM_URL` to its public HTTPS origin before building the dashboard. The service currently uses Socket.IO path `/`.

Alternatively, adapt the stream service to [Vercel WebSocket Functions](https://vercel.com/docs/functions/websockets). This requires routing and lifecycle changes: connections have a maximum duration, and in-memory history is not guaranteed across instances. This repository does not yet implement that adaptation. Free operation of the full streaming system has not been verified.

Local `.env` files and SQLite databases are excluded from new commits. Copy `.env.example` for local setup. The terminal currently reads public market data; exchange trading credentials are not required.

## Checks

```sh
node --experimental-strip-types tests/heatmap-model.test.mjs
pnpm lint
```

The heatmap calculation tests cover historical inspection, liquidity binning, aggressor flow, trade clustering, bubble area scaling, persistence/replenishment, reactions, data quality and replay without future-data leakage. Existing project-wide TypeScript errors remain in other panels, and `next.config.ts` currently permits builds with type errors.

Market context and displayed analytics are descriptive; they are not validated profitability predictions.

Heatmap navigation: scroll to zoom the time axis, pinch on a trackpad (or Ctrl + wheel) to zoom both axes, Shift + scroll to zoom price, drag to pan, and swipe horizontally to pan time. Zoom stays anchored to the cursor within the recorded history. Navigation holds a snapshot; **Return to live** resumes the feed. Use the chart’s +/− buttons or keyboard +/−, and double-click, press 0/Escape, or use Reset to restore the chart. **Insights** toggles the analysis sidebar. Touch supports drag and two-finger pinch inside the chart.
