#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ERRORS=0

check_submodule() {
  local name="$1"
  local dir="apps/$name"

  if [ ! -f "$dir/.git" ] && [ ! -d "$dir/.git" ]; then
    echo "[validate] ERROR: $dir not initialized. Run './scripts/sync-submodules.sh'."
    ERRORS=$((ERRORS + 1))
    return
  fi

  if [ ! -f "$dir/package.json" ]; then
    echo "[validate] ERROR: $dir/package.json missing — submodule may be empty."
    ERRORS=$((ERRORS + 1))
    return
  fi

  echo "[validate] OK: $name"
}

check_submodule "OntoGraph-lite"
check_submodule "authoring-ui-vscode"

if [ $ERRORS -gt 0 ]; then
  echo "[validate] $ERRORS error(s) found. Run './scripts/sync-submodules.sh' to fix."
  exit 1
fi

echo "[validate] All submodules validated successfully."
