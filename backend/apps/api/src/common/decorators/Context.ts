import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestWithContext } from '../types';

export const Context = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request: RequestWithContext = ctx.switchToHttp().getRequest();

  return request.context;
});
