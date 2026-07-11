import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { REQUIRE_SCOPES_KEY } from '@ci/common/decorators';

import type { ApiKeyScopedRequest } from './ScopesGuard';

/**
 * Deny-by-default scope enforcement for api-key principals.
 *
 * Runs from inside the api-key auth guards ({@link ApiKeyGuard},
 * {@link JwtOrApiKeyAuthGuard}) *after* the strategy has populated
 * `req.apiKeyScopes` — it MUST NOT be a global `APP_GUARD`, which would run
 * before authentication sets the scopes.
 *
 * This is the inverse of {@link ScopesGuard}: instead of only restricting the
 * handful of routes that opt in with `@RequireScopes`, a **scope-limited** key
 * is confined to routes that explicitly grant one of its scopes. Precedence:
 *
 * - `apiKeyScopes === undefined` — not an api-key principal (session/JWT/Portal)
 *   → full authority, unaffected.
 * - `apiKeyScopes.length === 0` — an empty-scope key: legacy full-access keys and
 *   the connect keys minted for broad-access apps (e.g. the bulk importer) →
 *   full authority, unaffected.
 * - non-empty scopes → the route MUST declare `@RequireScopes` and the key must
 *   carry every required scope, else 403. A scoped key on an un-annotated route
 *   is denied (this is what confines e.g. a memory-scoped chat-agent key to the
 *   memory endpoints and off `/graphql`, `/files`, `/v1`, …).
 */
export function enforceApiKeyScopes(
  reflector: Reflector,
  context: ExecutionContext,
  request: ApiKeyScopedRequest,
): void {
  const scopes = request.apiKeyScopes;

  // Non-api-key principal, or an empty-scope (full-access) key → nothing to enforce.
  if (scopes === undefined || scopes.length === 0) {
    return;
  }

  const required = reflector.getAllAndOverride<string[] | undefined>(REQUIRE_SCOPES_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);

  // Scope-limited key on a route that grants no scope → deny.
  if (!required || required.length === 0) {
    throw new ForbiddenException('This API key is scope-limited and cannot access this endpoint');
  }

  const missing = required.filter((scope) => !scopes.includes(scope));

  if (missing.length > 0) {
    throw new ForbiddenException(`API key is missing required scope(s): ${missing.join(', ')}`);
  }
}
