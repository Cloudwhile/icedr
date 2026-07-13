ARG ALPINE_MIRROR=
ARG NPM_REGISTRY=
ARG COREPACK_NPM_REGISTRY=

FROM node:24-alpine AS base
WORKDIR /workspace
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ARG ALPINE_MIRROR
ARG NPM_REGISTRY
ARG COREPACK_NPM_REGISTRY
RUN set -eux; \
  if [ -n "$ALPINE_MIRROR" ]; then \
    sed -i "s|https://dl-cdn.alpinelinux.org/alpine|${ALPINE_MIRROR%/}|g" /etc/apk/repositories; \
  fi; \
  apk add --no-cache libstdc++ openssl; \
  corepack enable; \
  if [ -n "$NPM_REGISTRY" ]; then \
    npm config set registry "$NPM_REGISTRY"; \
  fi; \
  corepack_registry="$COREPACK_NPM_REGISTRY"; \
  if [ -z "$corepack_registry" ]; then \
    corepack_registry="$NPM_REGISTRY"; \
  fi; \
  if [ -n "$corepack_registry" ]; then \
    COREPACK_NPM_REGISTRY="$corepack_registry" corepack prepare pnpm@10.18.1 --activate; \
  else \
    corepack prepare pnpm@10.18.1 --activate; \
  fi; \
  if [ -n "$NPM_REGISTRY" ]; then \
    pnpm config set registry "$NPM_REGISTRY"; \
  fi

FROM base AS deps
RUN apk add --no-cache python3 make g++
ENV npm_config_build_from_source=true
ENV npm_config_nodedir=/usr/local
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /workspace
ENV VITE_API_BASE_URL=/api
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/frontend/node_modules ./frontend/node_modules
COPY --from=deps /workspace/backend/node_modules ./backend/node_modules
COPY --from=deps /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY package.json pnpm-workspace.yaml prisma.config.ts ./
COPY database ./database
COPY frontend ./frontend
COPY backend ./backend
RUN pnpm --filter frontend build
RUN pnpm --filter backend build

FROM builder AS backend-prod
RUN pnpm --filter backend deploy --legacy --prod /workspace/backend-prod

FROM base AS runner
WORKDIR /workspace/backend
ENV NODE_ENV=production
ENV APP_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=13000
ENV FRONTEND_DIST_DIR=/workspace/backend/public
COPY --from=builder /workspace/prisma.config.ts ../prisma.config.ts
COPY --from=builder /workspace/database ../database
COPY --from=backend-prod /workspace/backend-prod/node_modules ./node_modules
COPY --from=backend-prod /workspace/backend-prod/package.json ./package.json
COPY --from=backend-prod /workspace/backend-prod/scripts ./scripts
COPY --from=builder /workspace/backend/dist ./dist
COPY --from=builder /workspace/frontend/dist ./public
EXPOSE 13000
CMD ["pnpm", "start:prod"]
