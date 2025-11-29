import { ExecutionContext, Injectable, InternalServerErrorException } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class GqlJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    // This guard is specifically for GraphQL resolvers. If used elsewhere, it's
    // a developer error.
    if (context.getType<'graphql' | 'http'>() !== 'graphql') {
      throw new InternalServerErrorException('GqlJwtAuthGuard can only be used with GraphQL resolvers');
    }

    return super.canActivate(context);
  }

  getRequest(context: ExecutionContext) {
    const gqlCtx = GqlExecutionContext.create(context);
    const { req } = gqlCtx.getContext();

    // This should not happen in a standard GraphQL HTTP request, but this check
    // adds a layer of safety for use cases like subscriptions.
    if (!req) {
      throw new InternalServerErrorException('Request object not found in GraphQL context');
    }

    return req;
  }
}
