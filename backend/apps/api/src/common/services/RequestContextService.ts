import { AsyncLocalStorage } from 'async_hooks';

import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../types';

@Injectable()
export class RequestContextService {
  private static storage = new AsyncLocalStorage<RequestContext>();

  static getContext(): RequestContext | undefined {
    return this.storage.getStore();
  }

  static getTraceId(): string | null {
    const context = this.getContext();

    return context?.traceId ?? null;
  }

  static run<T>(context: RequestContext, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  static set(data: Partial<RequestContext>): void {
    const store = this.storage.getStore();

    if (store) {
      Object.assign(store, data);
    }
  }
}
