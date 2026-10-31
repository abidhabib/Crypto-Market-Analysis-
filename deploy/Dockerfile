# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@9.15.4
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile
COPY . .
ARG NEXT_PUBLIC_STREAM_URL=https://stream.abidhabib.pro
ENV NEXT_PUBLIC_STREAM_URL=$NEXT_PUBLIC_STREAM_URL
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=file:/tmp/unused.db
RUN node --experimental-strip-types tests/heatmap-model.test.mjs \
 && node --experimental-strip-types tests/heatmap-navigation.test.mjs \
 && node --experimental-strip-types tests/stream-snapshot.test.mjs \
 && node tests/heatmap-orderflow.test.mjs \
 && pnpm exec eslint src/components/terminal/panel-heatmap.tsx src/components/terminal/heatmap-orderflow-controls.tsx src/lib/terminal/heatmap-model.ts src/lib/terminal/heatmap-orderflow.ts src/lib/terminal/heatmap-columns-renderer.ts src/lib/terminal/heatmap-renderer.ts src/lib/terminal/use-heatmap-navigation.ts \
 && pnpm run build

FROM node:22-bookworm-slim AS dashboard
ARG APP_REVISION=local
LABEL org.opencontainers.image.source="https://github.com/abidhabib/Crypto-Market-Analysis-"
LABEL org.opencontainers.image.revision=$APP_REVISION
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:22-bookworm-slim AS stream
ARG APP_REVISION=local
LABEL org.opencontainers.image.source="https://github.com/abidhabib/Crypto-Market-Analysis-"
LABEL org.opencontainers.image.revision=$APP_REVISION
WORKDIR /app
ENV NODE_ENV=production
RUN npm install --omit=dev --ignore-scripts --package-lock=false socket.io@4.8.4 && npm cache clean --force
COPY --chown=node:node mini-services/terminal-stream/index.ts ./index.ts
COPY --chown=node:node mini-services/terminal-stream/snapshot-history.ts ./snapshot-history.ts
USER node
EXPOSE 3031
CMD ["node", "--experimental-strip-types", "index.ts"]
