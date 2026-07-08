import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key under which required API-key scopes are stored for a route.
 */
export const REQUIRE_SCOPES_KEY = 'require_scopes';

/**
 * Declares the API-key scopes a route requires.
 *
 * Enforced by {@link ScopesGuard}, which runs after an api-key strategy has
 * authenticated the request. Semantics (least-privilege with back-compat):
 *
 * - Callers authenticated by something other than an api-key (session/JWT/
 *   Portal bearer) are unaffected — they carry full user authority.
 * - An api-key with an **empty** `scopes` array is grandfathered as full-access
 *   (keys minted before scopes were enforced keep working).
 * - An api-key with a **non-empty** `scopes` array must contain **every** scope
 *   listed here, otherwise the request is rejected with 403.
 *
 * @param scopes - one or more scope identifiers the route requires (e.g. `'memory'`)
 *
 * @example
 * ```typescript
 * @UseGuards(ApiKeyGuard, ScopesGuard)
 * @RequireScopes('memory')
 * @Post('write')
 * async write() { ... }
 * ```
 */
export const RequireScopes = (...scopes: string[]) => SetMetadata(REQUIRE_SCOPES_KEY, scopes);
