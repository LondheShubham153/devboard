# =========================
# Stage 1: Build
# =========================
FROM golang:1.26.8-alpine@sha256:51a7c389a5ddaf82f527191a1e9bff9928655130a44e4975dd1d7e0acf59f1ae AS builder

WORKDIR /app

# Install CA certificates and git
RUN apk add --no-cache ca-certificates git

# Copy Go dependency files
COPY go.mod go.sum* ./

# Download dependencies
RUN go mod download

# Copy source code
COPY . .

# Build Go application
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o devboard-backend .


# =========================
# Stage 2: Production
# =========================
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8

WORKDIR /app

# Install CA certificates for HTTPS/API calls
RUN apk add --no-cache ca-certificates \
    && apk upgrade --no-cache \
    && addgroup -S app \
    && adduser -S -G app -u 10001 app

# Copy compiled binary
COPY --from=builder /app/devboard-backend .

RUN chown app:app /app/devboard-backend

USER 10001:10001

# Backend port
EXPOSE 8080

# Start application
CMD ["./devboard-backend"]
