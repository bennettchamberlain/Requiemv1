import { Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ProxyService } from '@ci/common/services/ProxyService';
import type { RequestContext } from '@ci/common/types';

@Controller('tts')
export class TTSController {
  constructor(private readonly proxyService: ProxyService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  convert(@Context() context: RequestContext, @Req() req: Request, @Res() res: Response) {
    return this.proxyService.proxyRequest(req, res, 'http://localhost:9002');
  }
}
