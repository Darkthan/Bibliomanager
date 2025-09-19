# Multi-stage build for Bibliomanager
FROM node:20-alpine AS build
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --ignore-scripts

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

# Basic healthcheck hitting the backend health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]

