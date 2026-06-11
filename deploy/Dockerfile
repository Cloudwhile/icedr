FROM node:24-alpine AS deps
WORKDIR /workspace
RUN corepack enable
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS builder
WORKDIR /workspace
RUN corepack enable
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
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

FROM node:24-alpine AS runner
WORKDIR /workspace/backend
ENV NODE_ENV=production
ENV APP_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=13000
ENV FRONTEND_DIST_DIR=/workspace/backend/public
RUN apk add --no-cache libstdc++ openssl
RUN corepack enable
COPY --from=builder /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ../
COPY --from=builder /workspace/prisma.config.ts ../prisma.config.ts
COPY --from=builder /workspace/database ../database
COPY --from=builder /workspace/node_modules ../node_modules
COPY --from=builder /workspace/backend/node_modules ./node_modules
COPY --from=builder /workspace/backend/package.json ./package.json
COPY --from=builder /workspace/backend/scripts ./scripts
COPY --from=builder /workspace/backend/dist ./dist
COPY --from=builder /workspace/frontend/dist ./public
EXPOSE 13000
CMD ["pnpm", "start:prod"]
