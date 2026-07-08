import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { ScopesGuard, type ApiKeyScopedRequest } from '../ScopesGuard';

/**
 * Unit tests for ScopesGuard — the least-privilege enforcement layer on top of
 * api-key auth. Covers the four precedence rules documented on @RequireScopes:
 *  - no @RequireScopes → allow
 *  - non-api-key principal (apiKeyScopes undefined) → allow (full authority)
 *  - legacy key (empty scopes) → grandfathered allow
 *  - scoped key → must carry EVERY required scope, else 403
 */
function makeContext(
  required: string[] | undefined,
  apiKeyScopes: string[] | undefined,
): { ctx: ExecutionContext; reflector: Reflector } {
  const req = { apiKeyScopes } as ApiKeyScopedRequest;

  const ctx = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;

  return { ctx, reflector };
}

describe('ScopesGuard', () => {
  it('allows a route with no @RequireScopes declared', () => {
    const { ctx, reflector } = makeContext(undefined, ['memory']);
    expect(new ScopesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('allows an empty required-scopes list', () => {
    const { ctx, reflector } = makeContext([], ['unrelated']);
    expect(new ScopesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('allows a non-api-key principal (apiKeyScopes undefined = full authority)', () => {
    const { ctx, reflector } = makeContext(['memory'], undefined);
    expect(new ScopesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('grandfathers a legacy key with empty scopes as full-access', () => {
    const { ctx, reflector } = makeContext(['memory'], []);
    expect(new ScopesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('allows a scoped key that carries the required scope', () => {
    const { ctx, reflector } = makeContext(['memory'], ['memory', 'graph']);
    expect(new ScopesGuard(reflector).canActivate(ctx)).toBe(true);
  });

  it('rejects a scoped key missing the required scope', () => {
    const { ctx, reflector } = makeContext(['memory'], ['graph']);
    expect(() => new ScopesGuard(reflector).canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects unless ALL required scopes are present', () => {
    const { ctx, reflector } = makeContext(['memory', 'files'], ['memory']);
    expect(() => new ScopesGuard(reflector).canActivate(ctx)).toThrow(/files/);
  });
});
