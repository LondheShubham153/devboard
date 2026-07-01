# Stage 1 — Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Stage 2 — Secure Alpine runtime with non-root user
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S nodeuser && adduser -S nodeuser -G nodeuser && \
    npm cache clean --force
COPY --from=build --chown=nodeuser:nodeuser /app/dist ./dist
COPY --from=build --chown=nodeuser:nodeuser /app/node_modules /app/node_modules
USER nodeuser
EXPOSE 4173
ENTRYPOINT ["node", "./node_modules/.bin/vite"]
CMD ["preview", "--host", "0.0.0.0", "--port", "4173"]
