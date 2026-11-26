# Override GO_IMAGE for local builds without a dhi.io login (see .env.example).
ARG GO_IMAGE=dhi.io/golang:1-alpine

FROM ${GO_IMAGE} AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o devboard-backend .

FROM ${GO_IMAGE}

WORKDIR /app

COPY --from=builder /app/devboard-backend ./devboard-backend

RUN chmod +x ./devboard-backend

USER 65532:65532

EXPOSE 8080

ENTRYPOINT ["./devboard-backend"]
