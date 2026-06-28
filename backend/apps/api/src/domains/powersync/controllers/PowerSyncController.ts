import { Controller, Get, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';

import { PowerSyncTokenService, type PowerSyncCredentials } from '../services/PowerSyncTokenService';

@Controller('powersync')
export class PowerSyncController {
  constructor(private readonly tokenService: PowerSyncTokenService) {}

  /**
   * Issues PowerSync credentials for the authenticated user. The client SDK calls
   * this from its `fetchCredentials()` connector. JWT-guarded (so it works for both
   * the web JWT session and — once the native client mints one — does NOT accept an
   * API key, mirroring the other /api/keys-style sensitive endpoints).
   */
  @UseGuards(JwtAuthGuard)
  @Get('token')
  issueToken(@Context() context: RequestContext): PowerSyncCredentials {
    const { userId } = toServiceContext(context);

    return this.tokenService.issueToken(userId);
  }
}
