---
'@papra/app': minor
---

Added an MCP server endpoint at `/mcp`, enabled by default (turn it off with `MCP_SERVER_ENABLED=false`). MCP clients authenticate with an API key sent as a bearer token and can call the `ping` and `list_organizations` tools. A new MCP page in the user settings shows the server URL and how to connect a client.
