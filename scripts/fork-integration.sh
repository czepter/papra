#!/usr/bin/env bash
# Rebuild the fork integration branch: upstream main + every topic branch below, merged in order.
# Usage: scripts/fork-integration.sh   (run from a clean checkout of chore/integration)
set -euo pipefail

BASE="${BASE:-origin/main}"
INTEGRATION_BRANCH="chore/integration"

# Topic branches, in merge order. Add new fork topics here.
# A conflict in the migrations registry (both topics append) is resolved automatically by keeping both sides.
TOPICS=(
  feat/document-previews
  feat/mcp-tagging-rules # MCP stack: plan, skeleton, tools, OAuth, connected apps, tagging rules
)

if [[ "$(git branch --show-current)" != "$INTEGRATION_BRANCH" ]]; then
  echo "Check out $INTEGRATION_BRANCH first." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean." >&2
  exit 1
fi

git fetch origin --quiet

# Keep the integration-only files (this script, the image workflow) across the reset
INTEGRATION_FILES=(scripts/fork-integration.sh .github/workflows/fork-integration-image.yaml)
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
for file in "${INTEGRATION_FILES[@]}"; do
  mkdir -p "$TMP_DIR/$(dirname "$file")"
  cp "$file" "$TMP_DIR/$file"
done

git reset --hard "$BASE"

MIGRATIONS_REGISTRY="apps/papra-server/src/migrations/migrations.registry.ts"

for topic in "${TOPICS[@]}"; do
  echo "Merging $topic"
  if ! git merge --no-ff --quiet "$topic" -m "chore(integration): merge $topic"; then
    conflicts="$(git diff --name-only --diff-filter=U)"
    if [[ "$conflicts" != "$MIGRATIONS_REGISTRY" ]]; then
      echo "Unexpected merge conflicts, resolve by hand:" >&2
      echo "$conflicts" >&2
      exit 1
    fi
    # Both topics append migrations: keep both sides in merge order
    sed -i -e '/^<<<<<<< /d' -e '/^=======$/d' -e '/^>>>>>>> /d' "$MIGRATIONS_REGISTRY"
    git add "$MIGRATIONS_REGISTRY"
    git commit --quiet --no-edit
  fi
done

# Integration-only fixes for topics that compile alone but not together, reapplied after the merges
FIXUPS=(
  integration-fix/mcp-document-previews # MCP document tools need the previews repository
)
for fixup in "${FIXUPS[@]}"; do
  echo "Applying $fixup"
  git cherry-pick "$fixup"
done

for file in "${INTEGRATION_FILES[@]}"; do
  mkdir -p "$(dirname "$file")"
  cp "$TMP_DIR/$file" "$file"
done
git add "${INTEGRATION_FILES[@]}"
git commit --quiet -m "ci(integration): build fork integration image"

echo "Rebuilt $INTEGRATION_BRANCH on $BASE with ${#TOPICS[@]} topics. Push with: git push --force-with-lease fork $INTEGRATION_BRANCH --tags"
