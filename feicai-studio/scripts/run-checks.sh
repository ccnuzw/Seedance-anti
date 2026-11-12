#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$script_dir/.." && pwd)"
repo_root="$(git -C "$project_dir" rev-parse --show-toplevel)"
cd "$project_dir"

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" && -x /opt/homebrew/bin/node ]]; then
  node_bin=/opt/homebrew/bin/node
fi
if [[ -n "$node_bin" ]]; then
  export PATH="$(dirname "$node_bin"):$PATH"
fi

node_modules_dir="$project_dir/node_modules"
created_link=0
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/feicai-run-checks.XXXXXX")"

cleanup() {
  local status=$?
  set +e
  if [[ -f "$temp_dir/tsconfig.node.tsbuildinfo" ]]; then
    cp -p "$temp_dir/tsconfig.node.tsbuildinfo" "$project_dir/tsconfig.node.tsbuildinfo"
  fi
  if [[ -f "$temp_dir/tsconfig.web.tsbuildinfo" ]]; then
    cp -p "$temp_dir/tsconfig.web.tsbuildinfo" "$project_dir/tsconfig.web.tsbuildinfo"
  fi
  if (( created_link )); then
    rm -f "$node_modules_dir"
  fi
  rm -rf "$temp_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp -p "$project_dir/tsconfig.node.tsbuildinfo" "$temp_dir/tsconfig.node.tsbuildinfo"
cp -p "$project_dir/tsconfig.web.tsbuildinfo" "$temp_dir/tsconfig.web.tsbuildinfo"

if [[ ! -e "$node_modules_dir" ]]; then
  main_node_modules="${FEICAI_MAIN_NODE_MODULES:-}"
  if [[ -z "$main_node_modules" ]]; then
    while IFS= read -r worktree; do
      [[ "$worktree" == "$repo_root" ]] && continue
      candidate="$worktree/feicai-studio/node_modules"
      if [[ -d "$candidate" ]]; then
        main_node_modules="$candidate"
        break
      fi
    done < <(git -C "$repo_root" worktree list --porcelain | awk '$1 == "worktree" { print $2 }')
  fi
  if [[ -z "$main_node_modules" || ! -d "$main_node_modules" ]]; then
    printf 'Unable to find existing main-workspace node_modules. Set FEICAI_MAIN_NODE_MODULES.\n' >&2
    exit 1
  fi
  ln -s "$main_node_modules" "$node_modules_dir"
  created_link=1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required on PATH (or alongside node).\n' >&2
  exit 1
fi

npm run typecheck
npm run lint
npm test -- --run \
  src/main/io/production-commit-store.test.ts \
  src/main/services/project-service.test.ts \
  src/main/ipc/register.test.ts \
  src/main/services/production-integration.test.ts \
  src/main/asset/asset-manager.test.ts \
  src/main/workflow/workflow-engine.test.ts \
  src/main/engine/art-output-merger.test.ts \
  src/main/engine/state-machine-production-retry.test.ts \
  src/renderer/utils/refresh-settings-summary.test.ts

node_modules/.bin/prettier --check \
  src/main/asset/asset-manager.ts \
  src/main/db/queries.ts \
  src/main/engine/art-output-merger.ts \
  src/main/engine/state-machine.ts \
  src/main/io/production-commit-store.test.ts \
  src/main/io/production-commit-store.ts \
  src/main/ipc/register.test.ts \
  src/main/ipc/register.ts \
  src/main/services/production-commit-service.ts \
  src/main/services/production-integration.test.ts \
  src/main/services/project-service.ts \
  src/main/workflow/workflow-engine.ts \
  src/preload/index.ts \
  src/renderer/hooks/useProjectPageController.ts \
  src/renderer/services/project-service.ts \
  src/renderer/utils/refresh-settings-summary.ts \
  src/renderer/utils/refresh-settings-summary.test.ts \
  src/shared/ipc-channels.ts \
  src/shared/ipc-contracts.ts \
  src/shared/production-commit.ts

git -C "$repo_root" diff --check HEAD
