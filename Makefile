.PHONY: help dev server server-test build cli-build tri doctor typecheck generated

# Export all variables from .env if present
ifneq (,$(wildcard ./.env))
include .env
export
endif

help:
	@echo "Triathlon — available commands:"
	@echo "  make dev        Start local dev server"
	@echo "  make server     Start the self-hosted API server"
	@echo "  make server-test Run backend tests"
	@echo "  make tri        Build and run the tri CLI"
	@echo "  make doctor     Run tri doctor"
	@echo "  make typecheck  Run TypeScript checks"
	@echo "  make generated  Regenerate OpenAPI client artifacts"
	@echo "  make build      Build frontend and backend packages"

dev:
	npm run dev

server:
	npm run server:dev

server-test:
	npm run server:test

typecheck:
	npm run typecheck

generated:
	npm run generated

build:
	npm run build && npm run build -w @triathlon/server && npm run cli:build

cli-build:
	npm run cli:build

tri: cli-build
	@npm run -s tri -- $(ARGS)

doctor: cli-build
	@npm run -s tri -- doctor
