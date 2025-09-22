# Multi-stage build for Bibliomanager
FROM node:20-bullseye-slim AS build
ARG BUILD_ID=dev
RUN echo "BUILD_ID=${BUILD_ID}"
WORKDIR /app

# Build prerequisites for native deps (node-gyp) and certificates
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     python3 make g++ git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
# Install all deps (need devDeps to build client/server); keep scripts so esbuild fetches binaries
# Add some resiliency/logging to diagnose build failures
ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false
RUN npm ci --no-audit --no-fund --loglevel=info

# Build server and client
COPY . .
RUN npm run build

# Runtime image
FROM node:20-bullseye-slim AS runtime
ARG BUILD_ID=dev
RUN echo "BUILD_ID=${BUILD_ID}"
WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts and static assets
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets

# Create mount points for persistent data and cache
VOLUME ["/app/data", "/app/cache"]

EXPOSE 3000

# Basic healthcheck hitting the backend health endpoint without extra deps
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
