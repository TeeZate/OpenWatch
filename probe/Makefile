.PHONY: build build-linux build-arm tidy clean test

VERSION := 1.0.0
BINARY  := openwatch-probe

build:
	go build -ldflags="-w -s -X main.version=$(VERSION)" -o $(BINARY) ./cmd/probe

build-linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
	go build -ldflags="-w -s -X main.version=$(VERSION)" -o $(BINARY)-linux-amd64 ./cmd/probe

build-arm:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 \
	go build -ldflags="-w -s -X main.version=$(VERSION)" -o $(BINARY)-linux-arm64 ./cmd/probe

tidy:
	go mod tidy

test:
	go test ./...

clean:
	rm -f $(BINARY) $(BINARY)-linux-* $(BINARY)-darwin-*
