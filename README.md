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

The heatmap calculation tests cover historical inspection, liquidity binning, aggressor flow, trade clustering and bubble area scaling. Existing project-wide TypeScript errors remain in other panels, and `next.config.ts` currently permits builds with type errors.

Market context and displayed analytics are descriptive; they are not validated profitability predictions.
