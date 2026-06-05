#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[sync-submodules] Initializing and updating submodules..."
git submodule update --init --recursive

echo "[sync-submodules] Installing root dependencies..."
npm install

echo "[sync-submodules] Installing OntoGraph-lite dependencies..."
(cd apps/OntoGraph-lite && npm install)

echo "[sync-submodules] Installing authoring-ui-vscode dependencies..."
(cd apps/authoring-ui-vscode && npm install --legacy-peer-deps)

echo "[sync-submodules] Done. Run 'npm run build-all' to build."
