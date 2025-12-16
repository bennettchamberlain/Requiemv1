import { Controller, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';

import { Context, type RequestContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ProxyService } from '@ci/common/services/ProxyService';
import config from '@ci/configuration';

@Controller('stt')
export class STTController {
  constructor(private readonly proxyService: ProxyService) {}

  @UseGuards(JwtAuthGuard)
  @Post('transcribe')
  async transcribe(@Context() context: RequestContext, @Req() req: Request, @Res() res: Response) {
    if (context.userId == null) {
      throw new UnauthorizedException();
    }

    return await this.proxyService.proxyRequest(req, res, `${config.services.stt.host}/stt/transcribe`);
  }
}
