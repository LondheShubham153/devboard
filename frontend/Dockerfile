# =========================
# Stage 1: Build
# =========================
FROM node:22-alpine@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85 AS build

WORKDIR /app

# Copy dependency files first for better Docker caching
COPY package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy application source
COPY . .

# Build Vite application
RUN npm run build


# =========================
# Stage 2: Production
# =========================
FROM nginxinc/nginx-unprivileged:1.29-alpine-slim@sha256:59678856b05324b7f6371f26eb1520be7fcd8bdc8ab380fc4913db8503e5a842

# Refresh base-image packages so security fixes released after the image
# build are included in the immutable application image.
USER root
RUN apk upgrade --no-cache


# harmless and is replaced by the custom error handling at runtime if used.
COPY --from=build /app/dist/ /usr/share/nginx/html/

# SPA configuration for React Router
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

USER 101
CMD ["nginx", "-g", "daemon off;"]
