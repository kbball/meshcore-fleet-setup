VERSION := $(shell cat VERSION)
COVER_MIN := 80
IMAGE ?= ghcr.io/kbball/meshcore-fleet-setup
GO_PKGS := ./cmd/... ./internal/... ./web

.PHONY: install web build test cover lint fmt run image smoke bundle web-test web-cover check
install:
	cd web && npm ci

web: ## build the frontend into web/dist (embedded into the Go binary)
	cd web && npm ci && npm run build

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=$(VERSION)" -o bin/fleetsetup ./cmd/fleetsetup

run: web ## serve the built app on http://localhost:8080 (FLEET_FIRMWARE_DIR=./firmware by default)
	FLEET_FIRMWARE_DIR=$${FLEET_FIRMWARE_DIR:-firmware} go run -ldflags "-X main.version=$(VERSION)" ./cmd/fleetsetup serve

test: ## go vet + race tests
	go vet $(GO_PKGS)
	go test -race $(GO_PKGS)

cover: ## fails under COVER_MIN% for Go
	go test -coverprofile=coverage.out ./cmd/... ./internal/...
	@go tool cover -func=coverage.out | tail -1
	@go tool cover -func=coverage.out | awk -v min=$(COVER_MIN) '/^total:/ { sub("%","",$$3); if ($$3+0 < min) { print "Go coverage below " min "%"; exit 1 } }'

web-test: ## frontend type check + tests
	cd web && npm run typecheck && npm test

web-cover: ## fails under the thresholds in web/vite.config.ts (80%)
	cd web && npm run cover

check: test cover web-test web-cover lint ## everything CI runs apart from the image

lint:
	golangci-lint run $(GO_PKGS)
	cd web && npm run lint && npm run format:check

fmt:
	gofmt -w cmd internal web/embed.go
	cd web && npm run format

image: ## build the Docker image, tagged with VERSION and latest (no firmware inside; mount it)
	docker build --build-arg VERSION=$(VERSION) -t $(IMAGE):$(VERSION) -t $(IMAGE):latest .

smoke: image ## run the image and push real requests through it (the check CI runs)
	scripts/smoke-image.sh $(IMAGE):$(VERSION) $(VERSION)

bundle: ## offline zip: app + firmware + python server, for laptops without Docker (FIRMWARE=dir with manifest.json)
	scripts/bundle.sh $(or $(FIRMWARE),firmware)
