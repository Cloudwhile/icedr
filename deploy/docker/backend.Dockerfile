FROM node:24-alpine AS deps
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN pnpm install --frozen-lockfile --filter backend...

FROM node:24-alpine AS builder
WORKDIR /workspace
RUN corepack enable
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/backend/node_modules ./backend/node_modules
COPY --from=deps /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY package.json pnpm-workspace.yaml ./
COPY prisma.config.ts ./prisma.config.ts
COPY database ./database
COPY backend ./backend
RUN pnpm --filter backend build

FROM node:24-alpine AS runner
WORKDIR /workspace/backend
ENV NODE_ENV=production
RUN corepack enable
COPY --from=builder /workspace/package.json /workspace/pnpm-lock.yaml /workspace/pnpm-workspace.yaml ../
COPY --from=builder /workspace/prisma.config.ts ../prisma.config.ts
COPY --from=builder /workspace/database ../database
COPY --from=builder /workspace/node_modules ../node_modules
COPY --from=builder /workspace/backend/node_modules ./node_modules
COPY --from=builder /workspace/backend/package.json ./package.json
COPY --from=builder /workspace/backend/scripts ./scripts
COPY --from=builder /workspace/backend/dist ./dist
EXPOSE 13001
CMD ["pnpm", "start:prod"]
