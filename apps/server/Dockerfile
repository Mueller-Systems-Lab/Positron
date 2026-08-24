# Positron Server — self-contained Node.js build and runtime image
FROM node:22-slim AS builder

WORKDIR /app

# Systemabhängigkeiten für npm ci, better-sqlite3 und den TypeScript-Build
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ && rm -rf /var/lib/apt/lists/*

# Build from source so a clean checkout does not need host-generated dist files.
COPY . .
RUN npm ci --ignore-scripts
RUN npm rebuild better-sqlite3
RUN npm run build

FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Runtime system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends git wget python3 && rm -rf /var/lib/apt/lists/*

# Runtime dependencies and compiled workspace artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/run-state/package.json ./packages/run-state/package.json
COPY --from=builder /app/packages/github-adapter/package.json ./packages/github-adapter/package.json
COPY --from=builder /app/packages/speckit-adapter/package.json ./packages/speckit-adapter/package.json
COPY --from=builder /app/packages/opencode-adapter/package.json ./packages/opencode-adapter/package.json
COPY --from=builder /app/packages/sandbox/package.json ./packages/sandbox/package.json
COPY --from=builder /app/packages/tool-gateway/package.json ./packages/tool-gateway/package.json
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/run-state/dist ./packages/run-state/dist
COPY --from=builder /app/packages/github-adapter/dist ./packages/github-adapter/dist
COPY --from=builder /app/packages/speckit-adapter/dist ./packages/speckit-adapter/dist
COPY --from=builder /app/packages/opencode-adapter/dist ./packages/opencode-adapter/dist
COPY --from=builder /app/packages/sandbox/dist ./packages/sandbox/dist
COPY --from=builder /app/packages/tool-gateway/dist ./packages/tool-gateway/dist
COPY --from=builder /app/apps/server/dist ./apps/server/dist

RUN mkdir -p /app/.positron/runs /app/.opencode/audit /app/workspace && chown -R node:node /app/.positron /app/.opencode /app/workspace

# Wrapper: use system python3 with mounted site-packages (uv Python needs host libs)
RUN printf '#!/bin/sh\n\
for d in /home/xxammaxx/.local/share/uv/tools/specify-cli/lib/python3.*/site-packages; do\n\
  if [ -d "$d" ]; then export PYTHONPATH="$d"; break; fi\n\
done\n\
exec python3 /home/xxammaxx/.local/share/uv/tools/specify-cli/bin/specify "$@"\n' > /usr/local/bin/specify && chmod +x /usr/local/bin/specify

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health | grep -q '"status"' || exit 1

USER node

CMD ["node", "apps/server/dist/index.js"]
