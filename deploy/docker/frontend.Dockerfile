FROM node:24-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace frontend --include-workspace-root

FROM node:24-alpine AS builder
WORKDIR /workspace
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:13001/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/frontend/node_modules ./frontend/node_modules
COPY package.json package-lock.json ./
COPY frontend ./frontend
RUN npm run build --workspace frontend

FROM node:24-alpine AS runner
WORKDIR /workspace/frontend
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /workspace/package.json /workspace/package-lock.json ../
COPY --from=builder /workspace/node_modules ../node_modules
COPY --from=builder /workspace/frontend/node_modules ./node_modules
COPY --from=builder /workspace/frontend/package.json ./package.json
COPY --from=builder /workspace/frontend/.next ./.next
COPY --from=builder /workspace/frontend/public ./public
EXPOSE 13000
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "13000"]
