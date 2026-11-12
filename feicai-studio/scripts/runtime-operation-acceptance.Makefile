# Run the full isolated acceptance suite from any working directory.
.DEFAULT_GOAL := verify
runtime_acceptance_dir := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))

.PHONY: verify run_checks
verify: run_checks

run_checks:
	/usr/bin/python3 "$(runtime_acceptance_dir)runtime-operation-acceptance.py" run_checks
