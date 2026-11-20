import type { ServerInstance } from '../server.types';
import { HTTPException } from 'hono/http-exception';
import { formatPublicErrorPayload, isCustomError } from '../../shared/errors/errors';
import { createLogger } from '../../shared/logger/logger';

const logger = createLogger({ namespace: 'middlewares:error' });

export function registerErrorMiddleware({ app }: { app: ServerInstance }) {
  app.onError((error, context) => {
    logger.error({ error }, error.message ?? 'An error occurred');

    // For some status code browsers may tend to cache error responses and not play new requests
    // Happened with document share links and 410 responses when disabling/re-enabling share links
    context.header('Cache-Control', 'no-store');

    // Exceptions thrown with a ready-made response, like the 401 and its WWW-Authenticate header from the bearer auth of /mcp
    if (error instanceof HTTPException && error.res) {
      return error.getResponse();
    }

    if (isCustomError(error) && !error.isInternal) {
      return context.json(formatPublicErrorPayload(error), error.statusCode);
    }

    if (error.message === 'Malformed JSON in request body') {
      return context.json(
        formatPublicErrorPayload({
          message: 'Invalid request body',
          code: 'server.invalid_request.malformed_json',
        }),
        400,
      );
    }

    return context.json(
      formatPublicErrorPayload({
        message: 'An error occurred',
        code: 'internal.error',
      }),
      500,
    );
  });

  app.notFound((context) => {
    return context.json(
      formatPublicErrorPayload({
        message: 'API route not found',
        code: 'api.not-found',
      }),
      404,
    );
  });
}
