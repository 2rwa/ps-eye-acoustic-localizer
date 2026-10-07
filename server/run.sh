#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec python3 "$ROOT/server/server.py" --bind "${BIND:-127.0.0.1}" --port "${PORT:-8000}" --directory "$ROOT/web"
