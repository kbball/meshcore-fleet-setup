VERSION := $(shell cat VERSION)

.PHONY: install test cover lint fmt build run
install:
	npm ci

test: ## type check + unit tests
	npm run typecheck
	npm test

cover: ## fails below the thresholds in vite.config.ts (80%)
	npm run cover

lint:
	npm run lint
	npm run format:check

fmt:
	npm run format

build:
	npm run build

run:
	npm run dev
