import * as crypto from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { SYSTEM_USER } from '@ci/common/context';
import type { PortalTokenVerifier } from '@ci/common/guards/PortalTokenVerifier';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { type User, UserService } from '@ci/domains/user';

/**
 * Validates CI-Portal-issued OIDC tokens and maps them to a CI-Server user.
 *
 * CI-Portal (better-auth) is the identity provider; it signs JWTs with EdDSA and
 * publishes a JWKS. This service verifies a Bearer token against that JWKS
 * (issuer + audience checked) and JIT-provisions the matching CI-Server user, so
 * any portal-authenticated app can write to memory with one brokered token.
 *
 * Gated behind `auth.portal.enabled` so it runs alongside the legacy JWT/api-key
 * paths during migration. See unified-identity-pipeline.md.
 */
@Injectable()
export class PortalTokenService implements PortalTokenVerifier {
  // Lazily built so a disabled/misconfigured portal never blocks startup.
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly userService: UserService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PortalTokenService.name);
  }

  get enabled(): boolean {
    return config.auth.portal.enabled === true;
  }

  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(config.auth.portal.jwksUri));
    }

    return this.jwks;
  }

  /**
   * Verify a portal token and return the corresponding CI-Server user, or null
   * if the token is not a valid portal token (so the caller can fall back to
   * the legacy strategies).
   */
  async verifyAndProvision(token: string): Promise<User | null> {
    if (!this.enabled) {
      return null;
    }

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.getJwks(), {
        issuer: config.auth.portal.issuer,
        // The portal issues per-client tokens (aud === client_id), so accept any
        // first-party client audience. PORTAL_OIDC_AUDIENCE is a comma-separated list.
        audience: config.auth.portal.audience
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean),
      }));
    } catch (error) {
      // Wrong signer / issuer / audience / expired — not a valid portal token,
      // so fall through to the legacy strategies.
      //
      // Log the reason. Returning a bare null made every rejection identical to
      // "no portal token present", which is why a misconfigured audience or
      // issuer surfaced only as a blanket 401 with nothing to go on — the
      // single hardest thing to diagnose in this auth path. `jose` codes are
      // specific (ERR_JWT_EXPIRED, ERR_JWT_CLAIM_VALIDATION_FAILED,
      // ERR_JWKS_NO_MATCHING_KEY), and none of them contain the token.
      this.logger.debug('Portal token rejected', {
        code: (error as { code?: string })?.code ?? 'unknown',
        reason: (error as Error)?.message,
        issuer: config.auth.portal.issuer,
        audience: config.auth.portal.audience,
      });

      return null;
    }

    return this.provisionUser(payload);
  }

  private async provisionUser(payload: JWTPayload): Promise<User | null> {
    const sub = payload.sub;
    if (!sub) {
      return null;
    }

    // Map by email when present (the portal id-token carries it); otherwise a
    // deterministic shadow address keyed on the stable OIDC subject.
    const email = typeof payload.email === 'string' ? payload.email : `oidc-${sub}@portal.local`;
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name : email;

    const existing = await this.userService.findByEmail(email);
    if (existing) {
      return existing;
    }

    // Portal-authenticated users have no CI-Server password; set a random one.
    return this.userService.create(
      { userId: SYSTEM_USER },
      { name, email, password: crypto.randomBytes(32).toString('hex') },
    );
  }
}
