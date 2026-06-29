import { Controller, Get, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';

import { PowerSyncTokenService, type PowerSyncCredentials } from '../services/PowerSyncTokenService';

@Controller('powersync')
export class PowerSyncController {
  constructor(private readonly tokenService: PowerSyncTokenService) {}

  /**
   * Issues PowerSync credentials for the authenticated user. The client SDK calls
   * this from its `fetchCredentials()` connector.
   *
   * JWT-only (`JwtAuthGuard`): it does NOT accept an `x-api-key`, mirroring the other
   * sensitive `/api/keys`-style endpoints. The native app authenticates data calls with
   * an API key, so wiring PowerSync into the native client would need API-key support
   * added here (a follow-up); for now this serves the web JWT session.
   */
  @UseGuards(JwtAuthGuard)
  @Get('token')
  issueToken(@Context() context: RequestContext): PowerSyncCredentials {
    const { userId } = toServiceContext(context);

    return this.tokenService.issueToken(userId);
  }
}
