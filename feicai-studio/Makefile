.PHONY: run_checks

# Run focused regression and static checks without leaving TypeScript build-info changes.
run_checks:
	@set -eu; \
	shared=$${M1_SHARED_NODE_MODULES:-/Users/apple/Progame/Seedance-anti/feicai-studio/node_modules}; \
	if [ ! -d "$$shared" ]; then echo "missing M1_SHARED_NODE_MODULES: $$shared" >&2; exit 1; fi; \
	linked=0; node_saved=""; node_tmp=$$(mktemp -d); \
	if [ ! -e node_modules ]; then ln -s "$$shared" node_modules; linked=1; \
	elif [ -L node_modules ]; then \
		[ "$$(readlink node_modules)" = "$$shared" ] || { echo "node_modules symlink points elsewhere" >&2; rm -rf "$$node_tmp"; exit 1; }; \
	elif [ ! -d node_modules ]; then echo "node_modules is not a directory" >&2; rm -rf "$$node_tmp"; exit 1; \
	elif [ ! -x node_modules/.bin/tsc ] && [ "$$(find node_modules -mindepth 1 -maxdepth 1 -not -name .vite | head -1)" = "" ]; then \
		mv node_modules "$$node_tmp/node_modules"; node_saved="$$node_tmp/node_modules"; \
		ln -s "$$shared" node_modules; linked=1; fi; \
	backup=$$(mktemp -d); \
	cleanup() { \
		for file in tsconfig.node.tsbuildinfo tsconfig.web.tsbuildinfo; do \
			if [ -f "$$backup/$$file" ]; then cp "$$backup/$$file" "$$file"; else rm -f "$$file"; fi; \
		done; \
		if [ "$$linked" -eq 1 ]; then rm -f node_modules; fi; \
		if [ -n "$$node_saved" ] && [ ! -e node_modules ]; then mv "$$node_saved" node_modules; fi; \
		rm -rf "$$backup" "$$node_tmp"; \
	}; \
	trap cleanup EXIT INT TERM; \
	for file in tsconfig.node.tsbuildinfo tsconfig.web.tsbuildinfo; do \
		if [ -f "$$file" ]; then cp "$$file" "$$backup/$$file"; fi; \
	done; \
	PATH=/opt/homebrew/bin:$$PWD/node_modules/.bin:$$PATH npm run typecheck; \
	PATH=/opt/homebrew/bin:$$PWD/node_modules/.bin:$$PATH npm run lint; \
	PATH=/opt/homebrew/bin:$$PWD/node_modules/.bin:$$PATH npm run format:check; \
	PATH=/opt/homebrew/bin:$$PWD/node_modules/.bin:$$PATH npm test -- --run src/main/ipc/register.test.ts
