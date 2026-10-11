# syntax=docker/dockerfile:1
# Multi-stage build: compile with the full toolchain, ship only dist/ + production dependencies.
# Build from the repo root: docker build -t delivery-service ./delivery-service

# Pinned to an exact version (same Node as .nvmrc / engines) so builds are reproducible.
ARG NODE_IMAGE=node:24.21.0-alpine3.24

# 1) All dependencies, including dev ones (TypeScript, Nest CLI) needed to compile.
#    Only the manifests are copied first, so this layer is reused until dependencies change.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# 2) Compile TypeScript to dist/ (includes the compiled migrations).
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# 3) Production dependencies only: no compiler, test or lint tooling in the final image.
#    TypeORM declares ts-node (and so typescript) as an optional peer for its CLI; npm marks
#    them "devOptional", so they're only dropped when both dev and optional are omitted.
#    We never need them: migrations are compiled to dist/ and run with plain node.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# 4) Runtime image.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Files stay owned by root and are only readable by the app user, so the running process
# cannot modify its own code or dependencies.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Non-root user that ships with the official Node image (uid 1000).
USER node
EXPOSE 3000
# Liveness probe without curl (not in alpine): Node 24 has fetch built in.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# Exec form: node is PID 1 and receives SIGTERM directly for a graceful shutdown.
CMD ["node", "dist/main.js"]
