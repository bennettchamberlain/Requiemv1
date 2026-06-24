import { Injectable, NestMiddleware } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';

import { BODY_LIMIT_KEY } from '../decorators';

/**
 * Body size limit for the single POST /graphql endpoint. The GraphQL route is
 * mounted by the Apollo driver via `app.use('/graphql', expressMiddleware(...))`,
 * NOT as a Nest controller route, so `req.route` is undefined here and the
 * per-route @BodyLimit metadata path below can never match it — it would fall
 * back to the 100kb default and 413 on bulk batch mutations (the importer pushes
 * thousands of timeline items per createCommunications/createEvents call). Apollo
 * itself registers no body parser, so THIS middleware is the only thing parsing
 * the /graphql body; raise its limit here. 10mb comfortably fits the importer's
 * batches while still bounding a single request.
 */
const GRAPHQL_BODY_LIMIT = '10mb';
const GRAPHQL_PATH = '/graphql';

/**
 * Middleware that dynamically applies JSON body size limits based on route metadata.
 * Uses the @BodyLimit decorator to determine the appropriate limit for each route.
 * Falls back to a default of 100kb if no limit is specified.
 */
@Injectable()
export class BodyParserMiddleware implements NestMiddleware {
  constructor(private readonly reflector: Reflector) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Get the route handler from the request
    // Note: This is available after routing is resolved
    const handler = req.route?.stack?.[0]?.handle;

    // Look up the body limit metadata from the route handler
    const limit = handler ? this.reflector.get<string>(BODY_LIMIT_KEY, handler) : undefined;

    // The /graphql endpoint is a single Apollo-mounted POST route (no Nest route
    // metadata), so it needs an explicit limit here rather than via @BodyLimit.
    const isGraphql = req.path === GRAPHQL_PATH || req.path.startsWith(`${GRAPHQL_PATH}/`);

    // Use the specified limit, the GraphQL bulk-ingest limit, or default to 100kb.
    const bodyLimit = limit || (isGraphql ? GRAPHQL_BODY_LIMIT : '100kb');

    // Chain both parsers so each checks the Content-Type header and only the
    // matching one actually parses the body. `next` is called exactly once at the end.
    json({ limit: bodyLimit })(req, res, (err?: unknown) => {
      if (err) {
        return next(err as Error);
      }

      urlencoded({ extended: true, limit: bodyLimit })(req, res, next);
    });
  }
}
