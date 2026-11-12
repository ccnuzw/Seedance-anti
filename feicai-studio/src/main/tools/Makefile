.PHONY: verify
# Existing dependencies only. m1-verify restores tsbuildinfo bytes and removes its
# temporary local dependency links/caches in finally, including on check failure.
verify:
	cd ../../.. && python3 scripts/m1-verify.py python3 src/main/tools/verify.py
