# Stage 1 — build the app into static files
FROM dhi.io/node:22-alpine-dev AS build

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies with pinned versions
RUN npm install --legacy-peer-deps

# Copy application source
COPY . .

# Build the application
RUN npm run build

# Stage 2 — Production image (minimal, secure, non-root)
FROM dhi.io/node:22-alpine-dev

WORKDIR /app

# Install http-server with pinned version (production-grade HTTP server)
RUN npm install -g http-server@14.2.0 && npm cache clean --force

# Copy only built artifacts from build stage
COPY --from=build /app/dist ./dist

# DHI runs as nonroot user by default (UID 65532)
# Ensure correct permissions
RUN chown -R 65532:65532 /app

EXPOSE 4173

# Healthcheck to ensure container is healthy
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4173', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["http-server", "dist", "-p", "4173", "--gzip"]
