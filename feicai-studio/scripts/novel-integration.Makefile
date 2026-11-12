# From the repository root: make -f feicai-studio/scripts/novel-integration.Makefile verify
STUDIO := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
M1_SHARED_NODE_MODULES ?= /Users/apple/Progame/Seedance-anti/feicai-studio/node_modules
export M1_SHARED_NODE_MODULES
.PHONY: verify
verify:
	@python3 "$(STUDIO)/scripts/m1-verify.py" bash "$(STUDIO)/scripts/novel-integration-verify.sh"
