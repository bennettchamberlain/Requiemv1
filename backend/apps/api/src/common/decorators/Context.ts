import { createParamDecorator, InternalServerErrorException } from '@nestjs/common';

import { RequestContextService } from '../services';
import type { RequestContext } from '../types';

export const Context = createParamDecorator((): RequestContext => {
  const context = RequestContextService.getContext();

  if (context == null) {
    throw new InternalServerErrorException('Request context not found');
  }

  return context;
});
