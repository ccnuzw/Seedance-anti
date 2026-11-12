#!/usr/bin/env bash
# Isolated verification for story-breakdown prompt assembly and entry flows.
set -euo pipefail
cd "$(dirname "$0")/.."

node node_modules/vitest/vitest.mjs run --no-cache \
  src/main/engine/prompt-assembler.test.ts \
  src/main/workflow/workflow-entry-flows.test.ts
npm run typecheck -- --force
npm run lint
node node_modules/prettier/bin/prettier.cjs --check \
  resources/builtin-skills/story-breakdown-skill/SKILL.md \
  resources/builtin-skills/story-breakdown-skill/adapt-method.md \
  resources/builtin-skills/story-breakdown-skill/output-style.md \
  resources/builtin-skills/story-breakdown-skill/templates/plot-breakdown-template.md \
  src/main/engine/prompt-assembler.ts \
  src/main/engine/prompt-assembler.test.ts \
  src/main/workflow/workflow-entry-flows.test.ts

git diff --check
