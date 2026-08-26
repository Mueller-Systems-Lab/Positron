# Positron Web UI — Vite/React
FROM node:22-alpine AS builder

WORKDIR /app
ENV NODE_ENV=production

# Root workspace config (npm needs this for workspace resolution)
COPY package.json ./
COPY tsconfig.json ./tsconfig.json
COPY packages/shared/package.json ./packages/shared/
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/shared/src ./packages/shared/src

# Web package dependencies
COPY apps/web/package.json ./apps/web/

# Install dependencies including dev (needed for vite build)
RUN npm install --include=dev
RUN npx tsc -b packages/shared

# Copy web source
COPY apps/web/index.html ./apps/web/
COPY apps/web/src ./apps/web/src
COPY apps/web/vite.config.ts ./apps/web/
COPY apps/web/tailwind.config.js ./apps/web/
COPY apps/web/postcss.config.js ./apps/web/
COPY apps/web/tsconfig.json ./apps/web/

# Build
WORKDIR /app/apps/web
RUN npx vite build

# Serve via lightweight HTTP server
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/apps/web/dist ./dist
RUN npm install -g serve
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:5173 | grep -q 'Positron' || exit 1

CMD ["serve", "-s", "dist", "-l", "5173"]
