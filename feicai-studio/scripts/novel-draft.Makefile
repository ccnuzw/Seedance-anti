# Run from any checkout; reuse an explicitly supplied installation when needed.
STUDIO := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/..)
.PHONY: verify
verify:
	@bash "$(STUDIO)/scripts/novel-draft-verify.sh" "$(STUDIO)"
