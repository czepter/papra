#!/usr/bin/env bash
# Usage: factory/stop.sh <worktree> [port]
# Without a port, stops every instance of the worktree.
set -uo pipefail
WORKTREE="$(cd "$1" && pwd)"
PORT="${2:-}"
BASE="${TMPDIR:-/tmp}/papra-factory-serve"
NAME="$(basename "$WORKTREE")"

if [ -n "$PORT" ]; then
  DIRS=("$BASE/$NAME-$PORT")
else
  DIRS=("$BASE/$NAME" "$BASE/$NAME"-*)
fi

for RUN in "${DIRS[@]}"; do
  [ -d "$RUN" ] || continue
  if [ -f "$RUN/pid" ]; then
    PID="$(cat "$RUN/pid")"
    kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true
  fi
  rm -rf "$RUN"
done
