# syntax=docker/dockerfile:1
# Build a Computer: one Dockerfile, three targets.
#   dev   - Vite dev server with hot reload (compose service `web`)
#   build - installs and builds apps/web with Turbo
#   prod  - nginx:alpine serving the static site (compose service `web-prod`)

ARG NODE_IMAGE=node:24-slim
ARG NGINX_IMAGE=nginx:alpine

# --- base: Node 24 + pnpm via corepack (version from package.json "packageManager")
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_HOME=/usr/local/share/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app
COPY package.json ./
RUN corepack enable \
 && corepack install \
 && chmod -R a+rX "$COREPACK_HOME" \
 && mkdir -p "$PNPM_HOME" && chown node:node "$PNPM_HOME"

# --- dev: the repo is bind-mounted at /app; node_modules live in named volumes.
# Directories are pre-created and owned by `node` so fresh named volumes inherit
# that ownership and the container never writes root-owned files into the repo.
FROM base AS dev
RUN mkdir -p /app/node_modules /app/apps/web/node_modules \
      /app/packages/content/node_modules /app/packages/det/node_modules \
      /app/packages/schema/node_modules /app/packages/sim-logic/node_modules \
      /app/packages/worker/node_modules /pnpm/store \
 && chown -R node:node /app /pnpm
USER node
EXPOSE 5173
CMD ["sh", "-c", "pnpm install --frozen-lockfile && exec pnpm --filter @build-a-computer/web exec vite --host 0.0.0.0 --port 5173 --strictPort"]

# --- build: install from the lockfile, then build the web app and its deps.
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm/store
RUN pnpm exec turbo run build --filter=@build-a-computer/web...

# --- prod: static files behind nginx. No COEP header (ADR-002, E-PLAT-06).
FROM ${NGINX_IMAGE} AS prod
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
