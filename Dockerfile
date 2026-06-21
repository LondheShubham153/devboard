# DevBoard — Fundamentals (UI only)
FROM node:20-alpine

# Create a dedicated non-root user. Running as root inside a container is a
RUN addgroup -S app && adduser -S -G app app

# All app files live under /app.
WORKDIR /app

# `npm ci` installs the exact versions from package-lock.json.
COPY package*.json ./
RUN npm ci

# Now copy the rest of the source and build the production bundle into /dist.
COPY . .
RUN npm run build

# Give the non-root user ownership of the app, then switch to it.
RUN chown -R app:app /app
USER app

# The preview server listens on this port — document it for tooling/humans.
EXPOSE 4173

# Bind to 0.0.0.0 so the server is reachable from outside the container
# (the default 127.0.0.1 would only accept connections from inside it).
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
