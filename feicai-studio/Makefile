.PHONY: run_checks verify-batch

run_checks:
	./scripts/run-checks.sh

# Reuse an existing dependency tree; no install/network activity is allowed.
M1_SHARED_NODE_MODULES ?= $(HOME)/Progame/Seedance-anti/feicai-studio/node_modules
NODE_BIN ?= $(shell command -v node 2>/dev/null || printf '%s' /Users/apple/Tools/node/node-v23.9.0-darwin-arm64/bin/node)
BATCH_PRETTIER ?= ./node_modules/.bin/prettier

verify-batch:
	M1_SHARED_NODE_MODULES='$(M1_SHARED_NODE_MODULES)' M1_NODE_BIN='$(NODE_BIN)' \
	BATCH_PRETTIER='$(BATCH_PRETTIER)' \
	python3 scripts/m1-verify.py bash -c 'set -e; \
		npx vitest run \
			src/renderer/pages/BatchPage.test.ts \
			src/renderer/stores/projectStore.test.ts \
			src/main/services/batch-execution-lease.test.ts \
			src/preload/index.test.ts; \
		npm run typecheck -- --force; \
		npm run lint; \
		"$$BATCH_PRETTIER" --check \
			src/main/ipc/register.ts \
			src/main/services/batch-execution-lease.ts \
			src/main/services/batch-execution-lease.test.ts \
			src/preload/index.ts \
			src/preload/index.test.ts \
			src/renderer/pages/BatchPage.tsx \
			src/renderer/pages/BatchPage.test.ts \
			src/renderer/services/pipeline-service.ts \
			src/renderer/stores/projectStore.ts \
			src/renderer/stores/projectStore.test.ts \
			src/renderer/utils/batch-page-state.ts \
			src/renderer/utils/batch-page-state.test.ts \
			src/shared/ipc-channels.ts \
			src/shared/ipc-contracts.ts; \
		git diff --check'
