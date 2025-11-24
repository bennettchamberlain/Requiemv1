import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';

import type { RequestContext, RequestWithContext } from '../types';

export const Context = createParamDecorator((data: unknown, ctx: ExecutionContext): RequestContext => {
  if (ctx.getType<'graphql' | 'http'>() === 'graphql') {
    const gqlCtx = GqlExecutionContext.create(ctx);

    return gqlCtx.getContext<RequestContext>();
  }

  const req = ctx.switchToHttp().getRequest<RequestWithContext>();

  return req.context ?? {};
});
