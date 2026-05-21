# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install git (needed by go mod download for some deps)
RUN apk add --no-cache git

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Static binary — no CGO, no external .so dependencies
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -o openwatch-probe ./cmd/probe

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/openwatch-probe .

# The probe reads config from environment variables in Railway mode:
#   OPENWATCH_TOKEN_JSON       — full JSON of the token object
#   OPENWATCH_CLIENT_CERT_PEM  — PEM content of client.crt
#   OPENWATCH_CLIENT_KEY_PEM   — PEM content of client.key
#   DATABASE_URL               — auto-discovered PostgreSQL check
#   REDIS_URL                  — auto-discovered Redis check

CMD ["./openwatch-probe", "start"]
