FROM node:24-alpine AS deps
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN pnpm install --frozen-lockfile --filter frontend...

FROM node:24-alpine AS builder
WORKDIR /workspace
RUN corepack enable
ARG VITE_API_BASE_URL=http://localhost:13001/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/frontend/node_modules ./frontend/node_modules
COPY --from=deps /workspace/pnpm-lock.yaml ./pnpm-lock.yaml
COPY package.json pnpm-workspace.yaml ./
COPY frontend ./frontend
RUN pnpm --filter frontend build

FROM nginx:alpine AS runner
COPY deploy/nginx/frontend-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/frontend/dist /usr/share/nginx/html
EXPOSE 13000
CMD ["nginx", "-g", "daemon off;"]
