import type { Request as ExpressRequest } from 'express';

export interface RequestContext {
  traceId?: string;
  userId?: string;
}

export interface RequestWithContext extends ExpressRequest {
  context?: RequestContext;
}

export interface ServiceContext {
  userId: string;
}
