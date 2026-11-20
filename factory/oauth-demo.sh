#!/usr/bin/env bash
# Drives the MCP OAuth flow by hand, the way an MCP client would.
#
#   factory/oauth-demo.sh start [base-url] [scope]
#       Registers a public client (dynamic registration), generates a PKCE pair and prints the authorize URL.
#       Open it in a browser, sign in (demo@example.com / factory-demo-1234 on a factory instance) and approve.
#       The browser then lands on http://127.0.0.1:33418/callback?code=...: nothing listens there, copy the
#       code from the address bar.
#   factory/oauth-demo.sh exchange <code> [base-url]
#       Exchanges the code with the saved PKCE verifier, then calls /mcp tools/list and list_organizations
#       with the access token, and shows the refresh-token response.
#   factory/oauth-demo.sh deny-url [base-url]
#       Same as start, to try the Deny button (the callback then carries error=access_denied).
#
# base-url defaults to http://localhost:15400 (or $BASE). State is kept in ${TMPDIR:-/tmp}/papra-oauth-demo.json.
set -euo pipefail

CMD="${1:-start}"
STATE_FILE="${TMPDIR:-/tmp}/papra-oauth-demo.json"
REDIRECT_URI="http://127.0.0.1:33418/callback"
DEFAULT_SCOPE="organizations:read documents:read offline_access"

urlencode() { jq -rn --arg v "$1" '$v|@uri'; }

case "$CMD" in
  start|deny-url)
    B="${2:-${BASE:-http://localhost:15400}}"
    SCOPE="${3:-$DEFAULT_SCOPE}"
    REG="$(curl -fsS -X POST "$B/api/auth/oauth2/register" -H 'content-type: application/json' -d "$(jq -n \
      --arg uri "$REDIRECT_URI" \
      '{client_name:"Demo MCP Client",redirect_uris:[$uri],token_endpoint_auth_method:"none",grant_types:["authorization_code","refresh_token"],response_types:["code"]}')")"
    CLIENT_ID="$(jq -r .client_id <<<"$REG")"
    VERIFIER="$(openssl rand -base64 48 | tr -d '=+/\n' | cut -c1-64)"
    CHALLENGE="$(printf %s "$VERIFIER" | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '=\n')"
    jq -n --arg b "$B" --arg c "$CLIENT_ID" --arg v "$VERIFIER" --arg r "$REDIRECT_URI" \
      '{base:$b,client_id:$c,verifier:$v,redirect_uri:$r}' >"$STATE_FILE"
    echo "Registered client $CLIENT_ID (public, no secret)."
    echo
    echo "Open this URL in a browser:"
    echo "$B/api/auth/oauth2/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=$(urlencode "$REDIRECT_URI")&scope=$(urlencode "$SCOPE")&state=demo-state&code_challenge=$CHALLENGE&code_challenge_method=S256&resource=$(urlencode "$B/mcp")"
    echo
    echo "Then run: factory/oauth-demo.sh exchange <code from the callback URL> $B"
    ;;

  exchange)
    CODE="${2:?usage: oauth-demo.sh exchange <code> [base-url]}"
    B="${3:-$(jq -r .base "$STATE_FILE")}"
    CLIENT_ID="$(jq -r .client_id "$STATE_FILE")"
    VERIFIER="$(jq -r .verifier "$STATE_FILE")"
    TOKENS="$(curl -sS -X POST "$B/api/auth/oauth2/token" \
      --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" \
      --data-urlencode "redirect_uri=$REDIRECT_URI" --data-urlencode "client_id=$CLIENT_ID" \
      --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$B/mcp")"
    echo "Token response (token values shortened):"
    jq '{token_type,expires_in,scope,access_token:(.access_token // "" | .[0:24] + "..."),refresh_token:(.refresh_token // "" | .[0:8] + "..."),error,error_description}' <<<"$TOKENS"
    ACCESS="$(jq -r .access_token <<<"$TOKENS")"
    [ "$ACCESS" != "null" ] || exit 1
    echo
    echo "JWT claims (payload):"
    cut -d. -f2 <<<"$ACCESS" | tr '_-' '/+' | base64 -d 2>/dev/null | jq . || true
    rpc() {
      curl -sS -X POST "$B/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
        -H "authorization: Bearer $ACCESS" -d "$1" | sed -n 's/^data: //p'
    }
    echo
    echo "tools/list:"
    rpc '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '[.result.tools[].name]'
    echo
    echo "tools/call list_organizations:"
    rpc '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_organizations","arguments":{}}}' | jq '.result'
    REFRESH="$(jq -r '.refresh_token // empty' <<<"$TOKENS")"
    if [ -n "$REFRESH" ]; then
      echo
      echo "Refresh grant (rotates the refresh token):"
      curl -sS -X POST "$B/api/auth/oauth2/token" \
        --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=$REFRESH" \
        --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "resource=$B/mcp" \
        | jq '{token_type,expires_in,scope,access_token:(.access_token // "" | .[0:24] + "..."),error}'
    fi
    ;;

  *)
    echo "usage: factory/oauth-demo.sh start|deny-url [base-url] [scope] | exchange <code> [base-url]" >&2
    exit 2
    ;;
esac
