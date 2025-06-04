import type { Request as ExpressRequest } from 'express';

export interface RequestContext {
  requestId?: string;
  userId?: string;
}

export interface RequestWithContext extends ExpressRequest {
  context?: RequestContext;
}
