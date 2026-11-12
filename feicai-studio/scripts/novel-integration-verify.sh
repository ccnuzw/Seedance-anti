#!/usr/bin/env bash
# Invoked by novel-integration.Makefile through m1-verify.py, which isolates
# dependency caches and restores both tsbuildinfo files even on failure.
set -euo pipefail
cd "$(dirname "$0")/.."

# Both renderer suites and the selected cross-file publication/retry regressions
# share one Vitest invocation. No installation, native rebuild, or real provider.
node node_modules/vitest/vitest.mjs run --no-cache \
  src/renderer/utils/novel-draft-state.test.ts \
  src/renderer/utils/editor-workflow-actions.test.ts \
  src/renderer/utils/batch-presentation.test.ts \
  src/renderer/utils/pipeline-view.test.ts \
  src/renderer/utils/pipeline-card-actions.test.ts \
  src/renderer/utils/project-production-view.test.ts \
  src/renderer/utils/novel-production-readiness.test.ts \
  src/renderer/components/pipeline/PipelineCommandCenter.test.ts \
  src/renderer/components/project/ProjectProductionMatrix.test.ts \
  src/renderer/pages/ProjectPage.test.ts \
  src/main/services/production-integration.test.ts \
  src/main/engine/state-machine-production-retry.test.ts \
  src/main/io/production-commit-store.test.ts \
  src/main/project/plot-breakdown-store.test.ts \
  src/main/workflow/workflow-entry-flows.test.ts \
  src/shared/plot-breakdown.test.ts \
  src/shared/project-bootstrap.test.ts \
  src/shared/batch.test.ts

# Always compare both implementations from this checkout (not selector alone).
node scripts/novel-production-dom/readiness-fixtures.mjs \
  "$PWD/src/renderer/utils/novel-draft-state.ts"
node scripts/novel-draft-dom-smoke.mjs
node scripts/novel-production-dom-smoke.mjs
npm run typecheck -- --force
npm run lint
npm run build
git diff --check
