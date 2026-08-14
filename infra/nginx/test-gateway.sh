#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUFFIX="$$-${RANDOM}"
NETWORK="page-builder-gateway-test-${SUFFIX}"
UPSTREAMS="page-builder-upstreams-${SUFFIX}"
GATEWAY="page-builder-gateway-${SUFFIX}"
GATEWAY_URL=""

cleanup() {
  docker rm -f "$GATEWAY" "$UPSTREAMS" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "$*" >&2
  docker logs "$GATEWAY" >&2 2>/dev/null || true
  exit 1
}

start_gateway() {
  local enabled="$1"
  docker rm -f "$GATEWAY" >/dev/null 2>&1 || true
  docker run -d --rm \
    --name "$GATEWAY" \
    --network "$NETWORK" \
    -p 127.0.0.1::8080 \
    -e LEGACY_UPSTREAM_HOST=legacy.test \
    -e LEGACY_UPSTREAM_PORT=80 \
    -e PAGE_BUILDER_ROUTE_ENABLED="$enabled" \
    -e 'NGINX_ENVSUBST_FILTER=LEGACY_UPSTREAM_HOST|LEGACY_UPSTREAM_PORT|PAGE_BUILDER_ROUTE_ENABLED' \
    -v "$ROOT_DIR/infra/nginx/page-builder.conf.template:/etc/nginx/templates/default.conf.template:ro" \
    nginx:alpine >/dev/null
  GATEWAY_URL="http://$(docker port "$GATEWAY" 8080/tcp)"

  for _ in $(seq 1 30); do
    if curl --fail --silent "$GATEWAY_URL/" >/dev/null; then
      return
    fi
    sleep 1
  done
  fail "Gateway did not become ready"
}

assert_body() {
  local path="$1"
  local expected="$2"
  local actual
  if ! actual="$(curl --fail --silent --show-error "$GATEWAY_URL$path")"; then
    fail "Request failed for '$path'"
  fi
  [[ "$actual" == "$expected" ]] || fail "Expected '$expected' for '$path', got '$actual'"
}

docker network create "$NETWORK" >/dev/null
docker run -d --rm \
  --name "$UPSTREAMS" \
  --network "$NETWORK" \
  --network-alias legacy.test \
  --network-alias backend \
  --network-alias frontend \
  -v "$ROOT_DIR/infra/nginx/tests/mock-upstreams.conf:/etc/nginx/conf.d/default.conf:ro" \
  nginx:alpine >/dev/null

start_gateway 1
assert_body "/" "legacy:/"
assert_body "/assets/legacy.css" "legacy:/assets/legacy.css"
assert_body "/api/legacy" "legacy:/api/legacy"
assert_body "/api/page-builder/v2/pages" "legacy:/api/page-builder/v2/pages"
assert_body "/page-builder/" "frontend:/page-builder/"
assert_body "/page-builder/assets/app.js" "frontend:/page-builder/assets/app.js"
assert_body "/api/page-builder/v1/pages?site=one" "backend:/api/v1/pages?site=one"

redirect_result="$(curl --silent --output /dev/null --write-out '%{http_code} %{redirect_url}' "$GATEWAY_URL/page-builder")"
[[ "$redirect_result" == "308 $GATEWAY_URL/page-builder/" ]] \
  || fail "Unexpected /page-builder redirect: $redirect_result"

start_gateway 0
assert_body "/page-builder" "legacy:/page-builder"
assert_body "/page-builder/" "legacy:/page-builder/"
assert_body "/api/page-builder/v1/pages" "legacy:/api/page-builder/v1/pages"

echo "Gateway routing tests passed"
