#!/bin/bash

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo "❌ Go is not installed!"
    echo ""
    echo "Install Go first:"
    echo "  Option 1: sudo snap install go --classic"
    echo "  Option 2: sudo apt install golang-go"
    echo "  Option 3: Download from https://go.dev/dl/"
    exit 1
fi

# Check Go version
GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')
REQUIRED_VERSION="1.21"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$GO_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "⚠️  Go version $GO_VERSION detected. Version 1.21+ is recommended."
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cat > .env << EOF
DATABASE_URL=postgresql://<db_user>:<strong_db_password>@localhost:5432/irisdrone?sslmode=disable
PORT=3001
ENV=development
JWT_SECRET=<strong_random_secret>
WASENDER_API_TOKEN=<wasender_token>
EOF
    echo "✅ Created .env file. Please update placeholders before starting."
fi

# Download dependencies
echo "📦 Downloading Go dependencies..."
go mod download

# Run the server
echo "🚀 Starting server..."
go run main.go
