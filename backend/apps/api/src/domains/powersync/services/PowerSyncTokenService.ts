import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import config from '@ci/configuration';

export interface PowerSyncCredentials {
  /** Short-lived JWT the PowerSync client SDK presents to the PowerSync service. */
  token: string;
  /** The PowerSync service endpoint the client connects to. */
  powersync_url: string;
}

/**
 * Issues the short-lived JWT a PowerSync client uses to authenticate against the
 * self-hosted PowerSync service. The token's `sub` is the CI-Server user id, which
 * the sync rules read via `request.user_id()` to scope each user's buckets.
 *
 * Dev scaffold: HS256 with a shared secret (POWERSYNC_JWT_SECRET) that the PowerSync
 * service's `client_auth` is configured to trust. For production, switch to
 * asymmetric keys (RS256/EdDSA) exposed via a JWKS endpoint — see
 * infrastructure/powersync/README.md.
 */
@Injectable()
export class PowerSyncTokenService {
  constructor(private readonly jwtService: JwtService) {}

  issueToken(userId: string): PowerSyncCredentials {
    if (!config.powersync.jwtSecret || !config.powersync.url) {
      // The feature is scaffolded but not configured for this deployment.
      throw new ServiceUnavailableException('PowerSync is not configured');
    }

    const token = this.jwtService.sign(
      {},
      {
        secret: config.powersync.jwtSecret,
        subject: userId,
        audience: config.powersync.audience,
        expiresIn: config.powersync.tokenTtl,
        keyid: config.powersync.jwtKid,
      },
    );

    return { token, powersync_url: config.powersync.url };
  }
}
