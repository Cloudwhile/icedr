FROM node:24-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace backend --include-workspace-root

FROM node:24-alpine AS builder
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/backend/node_modules ./backend/node_modules
COPY package.json package-lock.json ./
COPY backend ./backend
RUN npm run build --workspace backend

FROM node:24-alpine AS runner
WORKDIR /workspace/backend
ENV NODE_ENV=production
COPY --from=builder /workspace/package.json /workspace/package-lock.json ../
COPY --from=builder /workspace/node_modules ../node_modules
COPY --from=builder /workspace/backend/node_modules ./node_modules
COPY --from=builder /workspace/backend/package.json ./package.json
COPY --from=builder /workspace/backend/dist ./dist
EXPOSE 13001
CMD ["npm", "run", "start:prod"]
