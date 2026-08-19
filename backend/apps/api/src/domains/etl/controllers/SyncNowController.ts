import { Controller, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';

import { SyncNowService } from '../services/SyncNowService';

@Controller('connections')
export class SyncNowController {
  constructor(private readonly syncNowService: SyncNowService) {}

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('sync-now')
  syncNow(@Context() context: RequestContext) {
    return this.syncNowService.enqueueForUser(toServiceContext(context));
  }
}
