#!/usr/bin/env bash
# Checks whether an incoming upstream branch touches any VS Code customization-scope files.
# Usage: check-upstream-conflicts.sh <remote/branch>
# Run from inside apps/authoring-ui-vscode/
# Exit 0 = clean (no customization files touched)
# Exit 1 = WARNING: at least one customization-scope file is in the diff

set -euo pipefail

REMOTE_BRANCH="${1:-upstream/master}"

PROTECTED_PATHS=(
  "src/app/core/services/vscode.service.ts"
  "src/app/app.module.ts"
  "src/app/app-routing.module.ts"
)
GLOB_PATTERNS=(
  "src/app/core/services/vscode*.ts"
)

echo "[check-upstream-conflicts] Checking diff against ${REMOTE_BRANCH} for customization-scope files..."

# Collect files changed in the incoming branch relative to common ancestor
CHANGED_FILES=$(git diff --name-only "$(git merge-base HEAD "${REMOTE_BRANCH}")" "${REMOTE_BRANCH}" 2>/dev/null) || {
  echo "[check-upstream-conflicts] ERROR: Could not diff against ${REMOTE_BRANCH}. Did you run 'git fetch upstream'?" >&2
  exit 2
}

CONFLICTS=()

for PROTECTED in "${PROTECTED_PATHS[@]}"; do
  if echo "$CHANGED_FILES" | grep -qF "$PROTECTED"; then
    CONFLICTS+=("$PROTECTED")
  fi
done

# Glob pattern check (vscode*.ts)
for GLOB in "${GLOB_PATTERNS[@]}"; do
  MATCHES=$(echo "$CHANGED_FILES" | grep -E "$(echo "$GLOB" | sed 's/\*/[^\/]*/g')" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r MATCH; do
      # Avoid duplicates from exact path check
      if ! printf '%s\n' "${CONFLICTS[@]+"${CONFLICTS[@]}"}" | grep -qF "$MATCH"; then
        CONFLICTS+=("$MATCH")
      fi
    done <<< "$MATCHES"
  fi
done

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
