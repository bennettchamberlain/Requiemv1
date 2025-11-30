import { UnauthorizedException } from '@nestjs/common';

import type { RequestContext, UserServiceContext } from '../types';

/**
 * Converts a RequestContext to a ServiceContext. Throws UnauthorizedException
 * if userId is not present.
 *
 * @param context The RequestContext from the current request
 * @returns ServiceContext with guaranteed userId
 * @throws UnauthorizedException if userId is missing
 */
export function toServiceContext(context: RequestContext): UserServiceContext {
  if (!context.userId) {
    throw new UnauthorizedException('User authentication required');
  }

  return {
    userId: context.userId,
  };
}
