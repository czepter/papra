---
'@papra/app': minor
---

MCP clients can now connect to Papra with the server URL alone: Papra acts as an OAuth 2.1 authorization server (dynamic client registration, authorization code with PKCE, refresh tokens and revocation). The client sends you to a new consent page where you sign in and choose to allow or deny the access it requests, and the access token only grants the approved permissions on `/mcp` and only for organizations you belong to. API keys keep working, and OAuth tokens are never accepted by the REST API. Access tokens expire after 15 minutes. The authorization server metadata is served at `/.well-known/oauth-authorization-server` and the protected resource metadata at `/.well-known/oauth-protected-resource/mcp`, and `/mcp` answers 401 with a `WWW-Authenticate` header pointing at it. Everything is switched off with `MCP_SERVER_ENABLED=false`.
