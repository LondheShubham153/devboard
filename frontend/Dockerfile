# Stage 1 — build the app into static files
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2 — install vite globally and prepare runtime
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app
RUN npm install -g vite@5
COPY --from=build /app/dist ./dist
COPY vite.preview.config.js ./vite.config.js

# Stage 3 — runtime
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
WORKDIR /app
RUN npm install -g vite@5 && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY vite.preview.config.js ./vite.config.js
EXPOSE 4173
CMD ["vite", "preview", "--host", "0.0.0.0", "--port", "4173"]
