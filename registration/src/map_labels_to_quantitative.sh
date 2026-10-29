#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ ! -x "$PYTHON_BIN" ]]; then
  printf '[ERROR] Interpréteur Python introuvable: %s\n' "$PYTHON_BIN" >&2
  exit 1
fi

exec "$PYTHON_BIN" "$SCRIPT_DIR/map_labels_to_quantitative.py" "$@"
