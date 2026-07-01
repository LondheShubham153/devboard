# Stage 1 — Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2 — Secure Alpine runtime with Express proxy
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S nodeuser && adduser -S nodeuser -G nodeuser
COPY --from=build --chown=nodeuser:nodeuser /app/dist ./dist
COPY --from=build --chown=nodeuser:nodeuser /app/node_modules ./node_modules
COPY --chown=nodeuser:nodeuser package*.json ./
COPY --chown=nodeuser:nodeuser server.js ./server.js
RUN npm install --omit=dev express http-proxy-middleware && npm cache clean --force
USER nodeuser
EXPOSE 4173
CMD ["node", "server.js"]
