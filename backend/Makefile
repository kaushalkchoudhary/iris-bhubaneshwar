.PHONY: run build test clean deps

# Default target
all: deps build

# Install dependencies
deps:
	go mod download
	go mod tidy

# Build the application
build:
	go build -o backend main.go

# Run the application
run:
	go run main.go

# Run tests
test:
	go test ./...

# Clean build artifacts
clean:
	rm -f backend

# Format code
fmt:
	go fmt ./...

# Run linter (requires golangci-lint)
lint:
	golangci-lint run

# Seed violations data
seed-violations:
	go run cmd/seed/main.go

