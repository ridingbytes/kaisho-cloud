# syntax=docker/dockerfile:1.7

# ── Stage 1: build the mobile PWA ────────────────────
FROM node:22-alpine AS mobile-builder
WORKDIR /build
RUN corepack enable
COPY mobile/package.json mobile/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY mobile/ ./
RUN pnpm build

# ── Stage 2: runtime ────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY api/ ./api/
COPY --from=mobile-builder /build/dist ./mobile/dist
EXPOSE 3000
CMD ["node", "api/server.js"]
