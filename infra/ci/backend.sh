#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"
ACTION="${1:-}"
COVERAGE_MIN="${COVERAGE_MIN:-80}"
BACKEND_COVERAGE_TARGET="${BACKEND_COVERAGE_TARGET:-app}"
if command -v python >/dev/null 2>&1; then
  PYTHON_BIN="${PYTHON_BIN:-python}"
else
  PYTHON_BIN="${PYTHON_BIN:-python3}"
fi

[[ -d "$BACKEND_DIR" ]] || {
  echo "backend/ is required" >&2
  exit 1
}

cd "$BACKEND_DIR"

run_in_backend_env() {
  if [[ -f uv.lock ]]; then
    uv run "$@"
  elif [[ -f poetry.lock ]]; then
    poetry run "$@"
  else
    "$@"
  fi
}

install_dependencies() {
  "$PYTHON_BIN" -m pip install --upgrade pip

  if [[ -f uv.lock ]]; then
    command -v uv >/dev/null || "$PYTHON_BIN" -m pip install uv
    uv sync --frozen --all-extras
  elif [[ -f poetry.lock ]]; then
    command -v poetry >/dev/null || "$PYTHON_BIN" -m pip install poetry
    poetry install --no-interaction --with dev
  elif [[ -f requirements-dev.txt ]]; then
    "$PYTHON_BIN" -m pip install -r requirements-dev.txt
  elif [[ -f requirements.txt ]]; then
    "$PYTHON_BIN" -m pip install -r requirements.txt
    "$PYTHON_BIN" -m pip install ruff pytest pytest-cov build
  elif [[ -f pyproject.toml ]]; then
    "$PYTHON_BIN" -m pip install --editable ".[dev]"
    "$PYTHON_BIN" -m pip install ruff pytest pytest-cov build
  else
    echo "No supported backend dependency manifest found" >&2
    exit 1
  fi
}

check_migrations() {
  if [[ -f alembic.ini ]]; then
    run_in_backend_env alembic upgrade head
    run_in_backend_env alembic check
  elif [[ -f manage.py ]]; then
    run_in_backend_env "$PYTHON_BIN" manage.py migrate --noinput
    run_in_backend_env "$PYTHON_BIN" manage.py makemigrations --check --dry-run
  else
    echo "No Alembic or Django migration configuration found" >&2
    exit 1
  fi
}

audit_dependencies() {
  command -v pip-audit >/dev/null || "$PYTHON_BIN" -m pip install pip-audit

  if [[ -f uv.lock ]]; then
    local requirements_file
    requirements_file="$(mktemp)"
    trap 'rm -f "$requirements_file"' EXIT
    uv export --frozen --format requirements-txt --output-file "$requirements_file"
    pip-audit --requirement "$requirements_file"
  elif [[ -f requirements.txt ]]; then
    pip-audit --requirement requirements.txt
  else
    pip-audit
  fi
}

case "$ACTION" in
  install) install_dependencies ;;
  lint)
    run_in_backend_env ruff check .
    run_in_backend_env ruff format --check .
    ;;
  test)
    run_in_backend_env pytest \
      --cov="$BACKEND_COVERAGE_TARGET" \
      --cov-report=term-missing \
      --cov-report=xml \
      --cov-fail-under="$COVERAGE_MIN"
    ;;
  build) run_in_backend_env "$PYTHON_BIN" -m compileall -q . ;;
  migration-check) check_migrations ;;
  audit) audit_dependencies ;;
  *)
    echo "Usage: $0 {install|lint|test|build|migration-check|audit}" >&2
    exit 2
    ;;
esac
