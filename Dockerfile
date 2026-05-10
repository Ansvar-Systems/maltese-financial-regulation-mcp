# ─────────────────────────────────────────────────────────────────────────────
# Maltese Financial Regulation MCP — multi-stage Dockerfile
# ─────────────────────────────────────────────────────────────────────────────
# Build:  docker build -t maltese-financial-regulation-mcp .
# Run:    docker run --rm -p 3000:3000 maltese-financial-regulation-mcp
#
# The image expects a pre-built database at /app/data/mfsa.db.
# Override with MFSA_DB_PATH for a custom location.
# ─────────────────────────────────────────────────────────────────────────────

# --- Stage 1: Build TypeScript + native bindings ---
FROM node:20-slim AS builder

WORKDIR /app
# Build deps for better-sqlite3 native module (Debian-based image; no apk)
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
# Allow postinstall scripts so better-sqlite3 builds its native .node binding
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Prune dev deps but keep the prebuilt native binding
RUN npm prune --omit=dev

# --- Stage 2: Production ---
FROM node:20-slim AS production

WORKDIR /app
ENV NODE_ENV=production
ENV MFSA_DB_PATH=/app/data/mfsa.db

COPY package.json package-lock.json* ./
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/

# Database baked into image (provisioned from Release by ghcr-build.yml)
COPY data/database.db data/mfsa.db

# Non-root user for security
RUN addgroup --system --gid 1001 mcp && \
    adduser --system --uid 1001 --ingroup mcp mcp && \
    chown -R mcp:mcp /app
USER mcp

# Health check: verify HTTP server responds
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/src/http-server.js"]
