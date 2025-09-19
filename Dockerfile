# Multi-stage build for Bibliomanager
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
# Install all deps (need devDeps to build client/server); keep scripts so esbuild fetches binaries
RUN npm ci --no-audit --no-fund

# Build server and client
COPY . .
RUN npm run build

# Runtime image
FROM node:20-alpine AS runtime
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
