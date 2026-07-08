import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Request } from 'express';

import { REQUIRE_SCOPES_KEY } from '@ci/common/decorators';

/**
 * Request augmentation set by {@link ApiKeyStrategy} once an api-key has been
 * validated. `undefined` means the caller did not authenticate with an api-key
 * (e.g. a session/JWT/Portal principal), which {@link ScopesGuard} treats as
 * full authority.
 */
export interface ApiKeyScopedRequest extends Request {
  apiKeyScopes?: string[];
}

/**
 * Enforces the scopes declared by {@link RequireScopes} against the scopes of
 * the api-key that authenticated the request.
 *
 * Must run **after** an api-key guard has authenticated the request (e.g.
 * `@UseGuards(ApiKeyGuard, ScopesGuard)`), so that `req.apiKeyScopes` is
 * populated. See {@link RequireScopes} for the full precedence rules; in short:
 * non-api-key callers and empty-scope (legacy) keys pass; a scoped key must
 * carry every required scope.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRE_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @RequireScopes on the route → nothing to enforce.
    if (!required || required.length === 0) {
      return true;
    }

    const req = this.getRequest(context);
    const scopes = req.apiKeyScopes;

    // Not an api-key principal (session/JWT/Portal) → carries full authority.
    if (scopes === undefined) {
      return true;
    }

    // Legacy key minted before scopes were enforced → grandfathered full-access.
    if (scopes.length === 0) {
      return true;
    }

    const missing = required.filter((scope) => !scopes.includes(scope));

    if (missing.length > 0) {
      throw new ForbiddenException(`API key is missing required scope(s): ${missing.join(', ')}`);
    }

    return true;
  }

  /**
   * Resolve the underlying HTTP request for both REST and GraphQL execution
   * contexts, mirroring the pattern used by the api-key auth guards.
   */
  private getRequest(context: ExecutionContext): ApiKeyScopedRequest {
    const type = context.getType<string>();

    if (type === 'graphql') {
      const { req } = GqlExecutionContext.create(context).getContext();

      if (req == null) {
        throw new InternalServerErrorException('Request object not found in GraphQL context');
      }

      return req;
    }

    if (type === 'http') {
      return context.switchToHttp().getRequest<ApiKeyScopedRequest>();
    }

    throw new InternalServerErrorException(`${ScopesGuard.name} does not support context type: ${type}`);
  }
}
