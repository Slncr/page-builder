#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/frontend}"
ACTION="${1:-}"

[[ -f "$FRONTEND_DIR/package.json" ]] || {
  echo "frontend/package.json is required" >&2
  exit 1
}

cd "$FRONTEND_DIR"

if [[ -f pnpm-lock.yaml ]]; then
  PACKAGE_MANAGER="pnpm"
elif [[ -f yarn.lock ]]; then
  PACKAGE_MANAGER="yarn"
else
  PACKAGE_MANAGER="npm"
fi

enable_corepack() {
  if [[ "$PACKAGE_MANAGER" != "npm" ]]; then
    corepack enable
  fi
}

install_dependencies() {
  enable_corepack
  case "$PACKAGE_MANAGER" in
    pnpm) pnpm install --frozen-lockfile ;;
    yarn) yarn install --immutable 2>/dev/null || yarn install --frozen-lockfile ;;
    npm)
      if [[ -f package-lock.json ]]; then
        npm ci
      else
        npm install
      fi
      ;;
  esac
}

has_script() {
  node -e '
    const pkg = require("./package.json");
    process.exit(pkg.scripts && pkg.scripts[process.argv[1]] ? 0 : 1);
  ' "$1"
}

run_script() {
  local script="$1"
  has_script "$script" || {
    echo "frontend/package.json must define the '$script' script" >&2
    exit 1
  }
  enable_corepack
  "$PACKAGE_MANAGER" run "$script"
}

case "$ACTION" in
  install) install_dependencies ;;
  lint|test|build) run_script "$ACTION" ;;
  audit)
    enable_corepack
    case "$PACKAGE_MANAGER" in
      pnpm) pnpm audit --audit-level high ;;
      yarn)
        yarn npm audit --all --severity high 2>/dev/null || yarn audit --level high
        ;;
      npm) npm audit --audit-level=high ;;
    esac
    ;;
  *)
    echo "Usage: $0 {install|lint|test|build|audit}" >&2
    exit 2
    ;;
esac
