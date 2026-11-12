.PHONY: verify-batch verify-task-center

# Reuse an existing dependency tree; no install/network activity is allowed.
M1_SHARED_NODE_MODULES ?= $(HOME)/Progame/Seedance-anti/feicai-studio/node_modules
NODE_BIN ?= $(shell command -v node 2>/dev/null || printf '%s' /Users/apple/Tools/node/node-v23.9.0-darwin-arm64/bin/node)

verify-batch:
	M1_SHARED_NODE_MODULES='$(M1_SHARED_NODE_MODULES)' M1_NODE_BIN='$(NODE_BIN)' \
	python3 scripts/m1-verify.py bash -c ' \
		npx vitest run \
			src/renderer/pages/BatchPage.test.ts \
			src/renderer/stores/projectStore.test.ts \
			src/main/services/batch-execution-lease.test.ts \
			src/preload/index.test.ts; \
		npm run typecheck -- --force; \
		npm run lint; \
		npm run format:check; \
		git diff --check'

TASK_CENTER_FORMAT_FILES := src/renderer/components/pipeline/TaskCenter* \
	src/renderer/components/layout/{Header,AppShell}.tsx \
	src/renderer/stores/taskCenterStore* src/renderer/services/task-center* \
	src/renderer/services/{workflow-actions,pipeline-service,batch-service}.ts \
	src/shared/batch.ts src/preload/{index.ts,index.test.ts} \
	src/main/ipc/batch-handlers* src/main/services/batch-queue-service* \
	scripts/task-center-dom*

verify-task-center:
	M1_SHARED_NODE_MODULES='$(M1_SHARED_NODE_MODULES)' M1_NODE_BIN='$(NODE_BIN)' \
	python3 scripts/m1-verify.py bash -ec ' \
		npx vitest run src/renderer src/main/services/batch-queue-service.test.ts src/main/services/batch-execution-lease.test.ts src/main/ipc/batch-handlers.test.ts src/preload/index.test.ts; \
		node scripts/task-center-dom-smoke.mjs; \
		npm run typecheck -- --force; \
		npm run lint; \
		npx prettier --check $(TASK_CENTER_FORMAT_FILES); \
		git diff --check'
