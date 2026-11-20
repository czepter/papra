#!/usr/bin/env bash
# Usage: factory/serve.sh <worktree> <port>
# Serves API and built client on <port> only (the server serves the client from ./public).
set -euo pipefail
WORKTREE="$(cd "$1" && pwd)"
PORT="$2"
export PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"
PNPM="npx -y pnpm@12.4.2"
RUN="${TMPDIR:-/tmp}/papra-factory-serve/$(basename "$WORKTREE")"
SERVER="$WORKTREE/apps/papra-server"
EMAIL="demo@example.com"
PASSWORD="factory-demo-1234"

"$WORKTREE/factory/stop.sh" "$WORKTREE" >/dev/null 2>&1 || true
mkdir -p "$RUN/documents"

cd "$WORKTREE"
$PNPM install --no-frozen-lockfile >&2
$PNPM build:packages >&2
$PNPM --filter "@papra/app-client..." run build >&2
rm -rf "$RUN/public" && cp -R "$WORKTREE/apps/papra-client/dist" "$RUN/public"

export PORT APP_BASE_URL="http://localhost:$PORT" SERVER_SERVE_PUBLIC_DIR=true
export DATABASE_URL="file:$RUN/db.sqlite" DOCUMENT_STORAGE_FILESYSTEM_ROOT="$RUN/documents"
export AUTH_SECRET="factory-serve-secret-0123456789abcdef0123456789"
export EMAILS_DRY_RUN=true BETTER_AUTH_TELEMETRY=0
export MCP_SERVER_ENABLED="${MCP_SERVER_ENABLED:-true}"

# The server resolves ./public from the working directory, so run from $RUN.
cd "$RUN"
TSX="$SERVER/node_modules/.bin/tsx"
"$TSX" --tsconfig "$SERVER/tsconfig.json" "$SERVER/src/scripts/migrate-up.script.ts" >"$RUN/migrate.log" 2>&1
setsid nohup "$TSX" --tsconfig "$SERVER/tsconfig.json" "$SERVER/src/index.ts" >"$RUN/server.log" 2>&1 &
echo $! >"$RUN/pid"

for _ in $(seq 1 120); do
  curl -sf "http://localhost:$PORT/api/ping" >/dev/null && break
  sleep 0.5
done
curl -sf "http://localhost:$PORT/api/ping" >/dev/null || { tail -20 "$RUN/server.log" >&2; exit 1; }

curl -sf -c "$RUN/cookies" -X POST "http://localhost:$PORT/api/auth/sign-up/email" \
  -H 'content-type: application/json' -H "origin: http://localhost:$PORT" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Demo\"}" >/dev/null
# Best effort: one organization so the app opens on a usable screen.
curl -sf -b "$RUN/cookies" -X POST "http://localhost:$PORT/api/organizations" \
  -H 'content-type: application/json' -H "origin: http://localhost:$PORT" \
  -d '{"name":"Demo Org"}' >/dev/null || true

echo "Sign in with $EMAIL / $PASSWORD. MCP settings: http://localhost:$PORT/mcp-settings. Logs: $RUN/server.log"
echo "http://localhost:$PORT"
