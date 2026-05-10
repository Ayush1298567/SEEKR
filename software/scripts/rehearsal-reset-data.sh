#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${SEEKR_REHEARSAL_DATA_DIR:-$ROOT_DIR/.tmp/rehearsal-data}"

case "$DATA_DIR" in
  "$ROOT_DIR"/.tmp/rehearsal-data|"$ROOT_DIR"/.tmp/rehearsal-data/*)
    rm -rf "$DATA_DIR"
    mkdir -p "$DATA_DIR"
    echo "Reset rehearsal data at $DATA_DIR"
    ;;
  *)
    echo "Refusing to reset outside $ROOT_DIR/.tmp/rehearsal-data" >&2
    exit 1
    ;;
esac
