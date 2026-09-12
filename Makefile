SHELL := /bin/sh
.DEFAULT_GOAL := help

.PHONY: help install website \
        pipeline-plan pipeline-local-proof pipeline-publish-proof pipeline-end-to-end \
        generate-spec normalize-spec provision-plan provision-client \
        verify verify-all verify-preflight verify-source verify-build verify-smoke \
        verify-form verify-analytics verify-crm verify-seo verify-rollback \
        verify-launch-env verify-visual-qa \
        site-test site-test-local evidence-validate evidence-show clean workspace-clean

help:
	@printf '%s\n' 'L9 Website Factory Bot — command surface'
	@printf '%s\n' ''
	@printf '%s\n' '── Primary operator surface ──'
	@printf '%-30s %s\n' 'make website' 'Find one domain_spec.source.yaml, normalize it, and build the site locally'
	@printf '%s\n' '  Drop one domain_spec.source.yaml into repo context; no flags or build id required.'
	@printf '%s\n' ''
	@printf '%s\n' '── Setup ──'
	@printf '%-30s %s\n' 'make install' 'Install dependencies (npm ci)'
	@printf '%s\n' ''
	@printf '%s\n' '── Pipeline (DomainSpec → site) ──'
	@printf '%-30s %s\n' 'make pipeline-plan' 'Dry-run: converge all stages, no files/mutations (no keys)'
	@printf '%-30s %s\n' 'make pipeline-local-proof' 'Materialize + Astro build a site locally (needs provider keys)'
	@printf '%-30s %s\n' 'make pipeline-publish-proof' 'Local proof + publish source to the client GitHub repo'
	@printf '%-30s %s\n' 'make pipeline-end-to-end' 'Full run: build, publish, Vercel deploy, SEO handoff'
	@printf '%s\n' '  (advanced surfaces remain available for debugging/automation)'
	@printf '%s\n' ''
	@printf '%s\n' '── Spec & provisioning ──'
	@printf '%-30s %s\n' 'make generate-spec' 'Generate a flat DomainSpec from a target URL (crawl + LLM)'
	@printf '%-30s %s\n' 'make normalize-spec' 'Normalize a rich source spec into the flat DomainSpec'
	@printf '%-30s %s\n' 'make provision-plan' 'Plan client repo/Vercel provisioning (no mutation)'
	@printf '%-30s %s\n' 'make provision-client' 'Provision the client GitHub repo and Vercel project'
	@printf '%s\n' ''
	@printf '%s\n' '── Verification ──'
	@printf '%-30s %s\n' 'make verify-all' 'Full offline gate (typecheck, tests, plan, boundaries)'
	@printf '%-30s %s\n' 'make verify' 'verify-all plus every launch validation profile'
	@printf '%-30s %s\n' 'make verify-launch-env' 'Validate launch environment variables (fail-closed)'
	@printf '%-30s %s\n' 'make verify-visual-qa' 'Run visual layout QA via LLM vision (requires OPENROUTER_API_KEY)'
	@printf '%-30s %s\n' 'make site-test' 'Run the full site-factory test suite'
	@printf '%s\n' ''
	@printf '%s\n' '── Evidence ──'
	@printf '%-30s %s\n' 'make evidence-validate' 'Validate a persisted evidence chain (ARGS=--client-id=.. --build-id=.. --mode=..)'
	@printf '%-30s %s\n' 'make evidence-show' 'Show persisted evidence for a build (ARGS as above)'
	@printf '%s\n' ''
	@printf '%s\n' '── Housekeeping ──'
	@printf '%-30s %s\n' 'make clean' 'Remove local build/generated-site/evidence artifacts'
	@printf '%-30s %s\n' 'make workspace-clean' 'Ship leftover work to scoped PRs (delegates to Cursor-Governance make clean)'

install:
	npm ci

# ── One-command operator entrypoint ──
# Human contract: place exactly one domain_spec.source.yaml in repo context and run `make website`.
# WEBSITE_SPEC is an automation escape hatch, not part of the normal operator ceremony.
WEBSITE_SPEC ?=
WEBSITE_NORMALIZED := build/intake/domain_spec.normalized.yaml

website:
	@set -eu; \
		spec="$(WEBSITE_SPEC)"; \
		if [ -n "$$spec" ]; then \
			if [ ! -f "$$spec" ]; then \
				echo "[website] WEBSITE_SPEC does not exist: $$spec"; \
				exit 2; \
			fi; \
		else \
			specs="$$(find . -maxdepth 4 -type f -name 'domain_spec.source.yaml' \
				! -path './examples/*' \
				! -path './node_modules/*' \
				! -path './build/*' \
				! -path './.git/*' | sort)"; \
			count="$$(printf '%s\n' "$$specs" | awk 'NF { n += 1 } END { print n + 0 }')"; \
			if [ "$$count" -eq 0 ]; then \
				echo "[website] No domain_spec.source.yaml found."; \
				echo "[website] Drop one source spec into repo context, then run: make website"; \
				exit 2; \
			fi; \
			if [ "$$count" -ne 1 ]; then \
				echo "[website] Expected exactly one domain_spec.source.yaml outside examples/build; found $$count:"; \
				printf '%s\n' "$$specs"; \
				exit 2; \
			fi; \
			spec="$$specs"; \
		fi; \
		mkdir -p "$(dir $(WEBSITE_NORMALIZED))"; \
		echo "[website] source: $$spec"; \
		echo "[website] normalize -> $(WEBSITE_NORMALIZED)"; \
		npm run normalize-spec -- --in="$$spec" --out="$(WEBSITE_NORMALIZED)"; \
		echo "[website] build -> local-proof"; \
		npm run pipeline:local-proof -- --spec="$(WEBSITE_NORMALIZED)"

# ── Pipeline ── ARGS forwards flags, e.g. ARGS="--spec=<path> --build-id=<id>"
pipeline-plan:
	npm run pipeline:plan -- $(ARGS)

pipeline-local-proof:
	npm run pipeline:local-proof -- $(ARGS)

pipeline-publish-proof:
	npm run pipeline:publish-proof -- $(ARGS)

pipeline-end-to-end:
	npm run pipeline:end-to-end -- $(ARGS)

# ── Spec & provisioning ──
generate-spec:
	npm run generate-spec -- $(ARGS)

normalize-spec:
	npm run normalize-spec -- $(ARGS)

provision-plan:
	npm run provision:plan -- $(ARGS)

provision-client:
	npm run provision:client -- $(ARGS)

# ── Verification ──
verify: verify-all verify-preflight verify-source verify-build verify-smoke verify-form verify-analytics verify-crm verify-seo verify-rollback verify-launch-env

verify-all:
	npm run verify:all

verify-preflight:
	npm run verify:preflight

verify-source:
	npm run verify:source

verify-build:
	npm run verify:build

verify-smoke:
	npm run verify:smoke

verify-form:
	npm run verify:form

verify-analytics:
	npm run verify:analytics

verify-crm:
	npm run verify:crm

verify-seo:
	npm run verify:seo

verify-rollback:
	npm run verify:rollback

verify-launch-env:
	npm run verify:launch-env

verify-visual-qa:
	npm run verify:visual-qa

# ── Tests & evidence ──
site-test:
	npm run site:test

site-test-local:
	npm run site:test:local

evidence-validate:
	npm run evidence:validate -- $(ARGS)

evidence-show:
	npm run evidence:show -- $(ARGS)

clean:
	rm -rf dist .astro build/sites build/evidence build/intake

# Ship leftover work to the owning repo as a scoped PR, then prime main.
# Artifact wipe stays `make clean`. Orchestrator lives in Cursor-Governance.
workspace-clean:
	$(MAKE) -C "$(HOME)/.cursor-governance" clean WS="$(CURDIR)"

# ── Publish (L9 sanctioned surface) ──────────────────────────────────────
# make pr is the ONLY push/PR route (48-make-pr-remediation). Checkers run
# before any remote mutation; OPEN_PR=0 runs the gate only.
GOV_ROOT ?= $(HOME)/.cursor-governance
OPEN_PR ?= 1
PR_REMEDIATE ?= 1
PR_BASE ?= origin/main

.PHONY: pr pr-check

pr-check:
	@echo "--- pr-check: Website-Bot repository gates ---"
	npm run typecheck
	npm run normalize-spec:check
	npm run evidence:schemas
	npm run evidence:contract-parity
	node scripts/run-site-factory-tests.mjs --scope=local
	node scripts/validate-recursive-schemas.mjs
	node scripts/run-recursive-tests.mjs
	npm run llm:wiring
	npm run alignment:boundaries
	# Lint scoped to the branch-owned surface. packages/validation-executor is
	# excluded from the local gate because its working tree carries other
	# sessions' uncommitted edits; CI lints its committed state on the branch.
	npx biome check src scripts tests astro_template config contracts schemas examples validation packages/bot-interop
	@echo "--- pr-check PASS ---"

pr: pr-check
	@if [ "$(OPEN_PR)" = "1" ]; then \
		PR_BASE="$(PR_BASE)" PR_REMEDIATE="$(PR_REMEDIATE)" \
			bash "$(GOV_ROOT)/ops/scripts/open_pr_after_gate.sh" "$(PWD)"; \
	else \
		echo "OPEN_PR=0 — skipped GitHub PR open (gate already PASS)"; \
	fi
