.PHONY: help dev deploy env-check cli-build tri doctor typecheck codegen

# Export all variables from .env if present
ifneq (,$(wildcard ./.env))
include .env
export
endif

help:
	@echo "Triathlon — available commands:"
	@echo "  make dev        Start local dev server"
	@echo "  make deploy     Deploy to production (Cloudflare + Convex)"
	@echo "  make env-check  Verify required env vars are set"
	@echo "  make tri        Build and run the tri CLI"
	@echo "  make doctor     Run tri doctor"
	@echo "  make typecheck  Run TypeScript checks"
	@echo "  make codegen    Regenerate Convex bindings"
	@echo "  make build      Build frontend (vinext)"

dev:
	npm run dev

env-check:
	@test -n "$(NEXT_PUBLIC_SITE_URL)" || (echo "Missing NEXT_PUBLIC_SITE_URL"; exit 1)
	@test -n "$(NEXT_PUBLIC_CONVEX_URL_PROD)" || (echo "Missing NEXT_PUBLIC_CONVEX_URL_PROD"; exit 1)
	@test -n "$(NEXT_PUBLIC_CONVEX_SITE_URL_PROD)" || (echo "Missing NEXT_PUBLIC_CONVEX_SITE_URL_PROD"; exit 1)
	@echo "Env check passed"

deploy: env-check
	NEXT_PUBLIC_SITE_URL=$(NEXT_PUBLIC_SITE_URL) \
	NEXT_PUBLIC_CONVEX_URL=$(NEXT_PUBLIC_CONVEX_URL_PROD) \
	NEXT_PUBLIC_CONVEX_SITE_URL=$(NEXT_PUBLIC_CONVEX_SITE_URL_PROD) \
	npm run deploy:prod

typecheck:
	npm run typecheck

codegen:
	npm run convex:codegen

build:
	npm run build

cli-build:
	npm run cli:build

tri: cli-build
	@node cli-dist/index.js $(ARGS)

doctor: cli-build
	@node cli-dist/index.js doctor
