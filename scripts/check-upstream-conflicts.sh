#!/usr/bin/env bash
# Checks whether an incoming upstream branch touches any VS Code customization-scope files.
# Usage: check-upstream-conflicts.sh <remote/branch>
# Run from inside apps/authoring-ui-vscode/
# Exit 0 = clean (no customization files touched)
# Exit 1 = WARNING: at least one customization-scope file is in the diff

set -euo pipefail

REMOTE_BRANCH="${1:-upstream/master}"

# Files (or, for vscode-service, the whole directory) with hand-maintained VS Code
# integration code — acquireVsCodeApi()/vsCodeService calls, postMessage bridges, or
# VS-Code-only branches. Keep in sync with the "VS Code customizations" list in
# CLAUDE.md and docs/maintenance/upstream-sync.md.
PROTECTED_PATHS=(
  "app/shared/vscode-service"
  "app/app.js"
  "app/shared/concept-edit/conceptEdit.js"
  "app/components/edit/edit.js"
  "app/shared/sca-service/scaService.js"
  "app/shared/taxonomy-tree/taxonomyTree.js"
)

echo "[check-upstream-conflicts] Checking diff against ${REMOTE_BRANCH} for customization-scope files..."

MERGE_BASE=$(git merge-base HEAD "${REMOTE_BRANCH}" 2>/dev/null) || {
  echo "[check-upstream-conflicts] ERROR: Could not diff against ${REMOTE_BRANCH}. Did you run 'git fetch upstream'?" >&2
  exit 2
}

# Let git's own pathspec matching decide what counts as "touches a protected path" —
# an exact/prefix match, not a substring search, so an unrelated file that merely
# contains a protected path as a substring (e.g. "webapp/app.js" vs "app/app.js")
# can't false-positive. Passing "app/shared/vscode-service" as a directory pathspec
# also catches any file added to or renamed within it, not just the current filename.
# (Built with a read loop, not `mapfile`, since macOS ships bash 3.2 where it's unavailable.)
CONFLICTS=()
while IFS= read -r FILE; do
  CONFLICTS+=("$FILE")
done < <(git diff --name-only "${MERGE_BASE}" "${REMOTE_BRANCH}" -- "${PROTECTED_PATHS[@]}")

if [ ${#CONFLICTS[@]} -eq 0 ]; then
  echo "[check-upstream-conflicts] ✓ CLEAN — no customization-scope files touched by ${REMOTE_BRANCH}"
  exit 0
else
  echo "[check-upstream-conflicts] ⚠ WARNING — upstream modifies VS Code customization-scope files:"
  for F in "${CONFLICTS[@]}"; do
    echo "  → $F"
  done
  echo ""
  echo "  Review the diff before merging:"
  for F in "${CONFLICTS[@]}"; do
    echo "  git diff \$(git merge-base HEAD ${REMOTE_BRANCH}) ${REMOTE_BRANCH} -- ${F}"
  done
  exit 1
fi
