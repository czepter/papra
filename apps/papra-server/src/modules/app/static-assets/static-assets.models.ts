// Paths served by the backend, which must never fall back to the SPA index.html.
// /mcp and /.well-known are excluded whether or not the MCP server is enabled, so a disabled server answers with a plain 404.
export function isBackendRoute({ path }: { path: string }) {
  return (
    path.startsWith('/api/') ||
    path === '/api' ||
    path.startsWith('/mcp/') ||
    path === '/mcp' ||
    path.startsWith('/.well-known/') ||
    path === '/.well-known'
  );
}
