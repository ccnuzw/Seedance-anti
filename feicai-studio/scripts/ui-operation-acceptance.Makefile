.PHONY: verify

M1_SHARED_NODE_MODULES ?= $(HOME)/Progame/Seedance-anti/feicai-studio/node_modules
NODE_BIN ?= /Users/apple/Tools/node/node-v23.9.0-darwin-arm64/bin/node
UI_DOM_ARTIFACT_DIR ?= /tmp/feicai-ui-operation-acceptance-task-3

verify:
	M1_SHARED_NODE_MODULES='$(M1_SHARED_NODE_MODULES)' M1_NODE_BIN='$(NODE_BIN)' \
	UI_DOM_ARTIFACT_DIR='$(UI_DOM_ARTIFACT_DIR)' \
	python3 scripts/m1-verify.py '$(NODE_BIN)' scripts/ui-operation-acceptance-verify.mjs
