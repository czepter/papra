import type { MiddlewareHandler } from 'hono';
import type { Config } from '../../config/config.types';
import { cors } from 'hono/cors';

// Called by browser-based MCP clients from any origin. Never with credentials: these endpoints
// authenticate with the request body (client id, code, PKCE verifier) and need no cookie.
const OAUTH_PUBLIC_PATHS = new Set([
  '/api/auth/oauth2/register',
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/revoke',
  '/api/auth/jwks',
]);

export function isOauthPublicPath({ path }: { path: string }) {
  return path.startsWith('/.well-known/') || OAUTH_PUBLIC_PATHS.has(path);
}

export function createCorsMiddleware({ config }: { config: Config }): MiddlewareHandler {
  const defaultCors = cors({
    origin: (origin) => {
      const allowedOrigins = config.server.corsOrigins;

      if (allowedOrigins[0] === '*' && allowedOrigins.length === 1) {
        return origin;
      }

      return allowedOrigins.find((allowedOrigin) => allowedOrigin === origin);
    },
    credentials: true,
  });

  const oauthPublicCors = cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  return async (context, next) => {
    if (config.mcp.enabled && isOauthPublicPath({ path: context.req.path })) {
      return oauthPublicCors(context, next);
    }

    return defaultCors(context, next);
  };
}
