import { AsyncLocalStorage } from 'async_hooks';

import { Injectable } from '@nestjs/common';

interface RequestContext {
  traceId?: string;
}

@Injectable()
export class RequestContextService {
  private static storage = new AsyncLocalStorage<RequestContext>();

  static getContext(): RequestContext | undefined {
    return this.storage.getStore();
  }

  static getTraceId(): string | undefined {
    const context = this.getContext();

    return context?.traceId;
  }

  static run<T>(context: RequestContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }
}
