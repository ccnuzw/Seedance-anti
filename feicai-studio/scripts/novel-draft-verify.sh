#!/usr/bin/env bash
set -euo pipefail
cd "$1"
novel_tmp=$(mktemp -d)
novel_linked=0
cleanup() {
  while IFS= read -r -d '' file; do
    if [ -f "$novel_tmp/$file" ]; then cp "$novel_tmp/$file" "$file"; else rm -f "$file"; fi
  done < <(find . -path './node_modules' -prune -o -name '*.tsbuildinfo' -print0)
  if [ "$novel_linked" = 1 ]; then rm node_modules; fi
  rm -rf "$novel_tmp"
}
trap cleanup EXIT
while IFS= read -r -d '' file; do
  mkdir -p "$novel_tmp/$(dirname "$file")"
  cp "$file" "$novel_tmp/$file"
done < <(find . -path './node_modules' -prune -o -name '*.tsbuildinfo' -print0)
if [ ! -d node_modules ]; then
  : "${NOVEL_DRAFT_NODE_MODULES:?Set NOVEL_DRAFT_NODE_MODULES to an existing dependency installation}"
  ln -s "$NOVEL_DRAFT_NODE_MODULES" node_modules
  novel_linked=1
fi
npx vitest run src/renderer/utils/novel-draft-state.test.ts src/renderer/utils/editor-workflow-actions.test.ts
npm run typecheck
npm run lint
npx prettier --check src/renderer/pages/StoryBeatEditorPage.tsx src/renderer/pages/SourceEditorPage.tsx src/renderer/pages/ProjectHealthPage.tsx src/renderer/utils/novel-draft-state*.ts scripts/novel-draft-dom-smoke.mjs scripts/novel-draft-dom
node scripts/novel-draft-dom-smoke.mjs
git diff --check
