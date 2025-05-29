import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

import { RequestContextService } from '../../domains/context/RequestContextService';

export const REQUEST_ID_HEADER = 'X-Request-Id';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly contextService: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const context = this.contextService.get(req);

    res.setHeader(REQUEST_ID_HEADER, context.requestId);

    next();
  }
}
