# syntax=docker/dockerfile:1.7
# PrismGEO: dashboard, crawler and scheduler in one container.
# The Playwright image ships Node.js, Chromium and its system libraries.
# Keep this tag equal to the playwright version in pnpm-lock.yaml so the bundled browsers match
# (CI fails when they drift).
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.64.0-noble

# ---- build: install every dependency and build the web app ----
FROM ${PLAYWRIGHT_IMAGE} AS build
WORKDIR /app
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/crawler/package.json packages/crawler/
COPY packages/db/package.json packages/db/
COPY packages/mcp/package.json packages/mcp/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

COPY . .
# The build opens a throwaway database; the real one lives in the /app/data volume.
# The result is copied to /out without node_modules: the runtime stage installs production
# dependencies only.
RUN PRISMGEO_DB_PATH=/tmp/build.db pnpm --filter @prismgeo/web build \
 && rm -rf apps/web/.next/cache /tmp/build.db* \
 && mkdir /out && tar --exclude=node_modules -cf - . | tar -xf - -C /out

# ---- runtime: the built app and production dependencies, run as the unprivileged pwuser ----
FROM ${PLAYWRIGHT_IMAGE} AS runtime
ENV NODE_ENV=production \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1 \
    PRISMGEO_IN_DOCKER=1 \
    PRISMGEO_HOST=0.0.0.0 \
    PRISMGEO_PORT=3333 \
    PRISMGEO_DB_PATH=/app/data/prismgeo.db
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/crawler/package.json packages/crawler/
COPY packages/db/package.json packages/db/
COPY packages/mcp/package.json packages/mcp/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --store-dir /pnpm/store
COPY --from=build --chown=pwuser:pwuser /out /app
RUN install -d -o pwuser -g pwuser -m 700 /app/data
USER pwuser
VOLUME ["/app/data"]
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3333/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
WORKDIR /app/apps/web
# node itself is the server process (no pnpm or shell wrapper), so SIGTERM reaches it directly;
# run it under an init (compose: init: true, or docker run --init) to reap Chromium's processes
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3333"]
