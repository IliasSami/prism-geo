# PrismGEO: dashboard, crawler and scheduler in one container.
# The Playwright image ships Node.js, Chromium and its system libraries.
# Keep this tag equal to the playwright version in pnpm-lock.yaml so the bundled browsers match.
FROM mcr.microsoft.com/playwright:v1.64.0-noble

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/crawler/package.json packages/crawler/
COPY packages/db/package.json packages/db/
COPY packages/mcp/package.json packages/mcp/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @prismgeo/web build

ENV NODE_ENV=production \
    PRISMGEO_HOST=0.0.0.0 \
    PRISMGEO_PORT=3333 \
    PRISMGEO_DB_PATH=/app/data/prismgeo.db
VOLUME ["/app/data"]
EXPOSE 3333
CMD ["pnpm", "start"]
