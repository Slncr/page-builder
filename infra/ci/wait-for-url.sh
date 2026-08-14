#!/usr/bin/env bash
set -euo pipefail

URL="${1:?Usage: wait-for-url.sh URL [timeout-seconds]}"
TIMEOUT="${2:-120}"
DEADLINE=$((SECONDS + TIMEOUT))

until curl --fail --silent --show-error --max-time 5 "$URL" >/dev/null; do
  if (( SECONDS >= DEADLINE )); then
    echo "Timed out after ${TIMEOUT}s waiting for $URL" >&2
    exit 1
  fi
  sleep 2
done

echo "Ready: $URL"
