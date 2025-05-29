import { Injectable, Scope } from '@nestjs/common';
import type { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { RequestContext } from './types';

type SettableRequestContext = Omit<RequestContext, 'requestId'>;

@Injectable({ scope: Scope.DEFAULT })
export class RequestContextService {
  private readonly contextMap = new WeakMap<Request, RequestContext>();

  get(req: Request): RequestContext {
    if (!this.contextMap.has(req)) {
      this.contextMap.set(req, {
        requestId: uuidv4(),
      });
    }

    return this.contextMap.get(req)!;
  }

  extend(req: Request, context: SettableRequestContext) {
    const { requestId, ...baseContext } = this.get(req);

    this.contextMap.set(req, {
      ...baseContext,
      ...context,
      requestId,
    });
  }
}
