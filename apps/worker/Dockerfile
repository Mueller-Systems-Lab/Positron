FROM node:22-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm ci --ignore-scripts
# Rebuild native modules (better-sqlite3) — skipped by --ignore-scripts above
RUN npm rebuild better-sqlite3
RUN npm run build

FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git wget python3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
# Workspace package manifests (npm needs these for resolution)
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/run-state/package.json ./packages/run-state/package.json
COPY --from=builder /app/packages/github-adapter/package.json ./packages/github-adapter/package.json
COPY --from=builder /app/packages/sandbox/package.json ./packages/sandbox/package.json
COPY --from=builder /app/packages/speckit-adapter/package.json ./packages/speckit-adapter/package.json
COPY --from=builder /app/packages/opencode-adapter/package.json ./packages/opencode-adapter/package.json
COPY --from=builder /app/packages/tool-gateway/package.json ./packages/tool-gateway/package.json
COPY --from=builder /app/packages/control-plane/package.json ./packages/control-plane/package.json
COPY --from=builder /app/packages/worker-pipeline/package.json ./packages/worker-pipeline/package.json
# Built dist files
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/run-state/dist ./packages/run-state/dist
COPY --from=builder /app/packages/github-adapter/dist ./packages/github-adapter/dist
COPY --from=builder /app/packages/sandbox/dist ./packages/sandbox/dist
COPY --from=builder /app/packages/speckit-adapter/dist ./packages/speckit-adapter/dist
COPY --from=builder /app/packages/opencode-adapter/dist ./packages/opencode-adapter/dist
COPY --from=builder /app/packages/tool-gateway/dist ./packages/tool-gateway/dist
COPY --from=builder /app/packages/control-plane/dist ./packages/control-plane/dist
COPY --from=builder /app/packages/worker-pipeline/dist ./packages/worker-pipeline/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/package.json ./package.json
RUN mkdir -p /app/.positron/runs /app/.opencode/audit /app/workspace && chown -R node:node /app/.positron /app/.opencode /app/workspace
RUN printf '#!/bin/sh\n\
for d in /home/xxammaxx/.local/share/uv/tools/specify-cli/lib/python3.*/site-packages; do\n\
  if [ -d "$d" ]; then export PYTHONPATH="$d"; break; fi\n\
done\n\
exec python3 /home/xxammaxx/.local/share/uv/tools/specify-cli/bin/specify "$@"\n' > /usr/local/bin/specify && chmod +x /usr/local/bin/specify
USER node
CMD ["node", "apps/worker/dist/index.js"]
