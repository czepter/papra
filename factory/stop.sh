#!/usr/bin/env bash
set -uo pipefail
WORKTREE="$(cd "$1" && pwd)"
RUN="${TMPDIR:-/tmp}/papra-factory-serve/$(basename "$WORKTREE")"
if [ -f "$RUN/pid" ]; then
  PID="$(cat "$RUN/pid")"
  kill -TERM -- "-$PID" 2>/dev/null || kill -TERM "$PID" 2>/dev/null || true
fi
rm -rf "$RUN"
