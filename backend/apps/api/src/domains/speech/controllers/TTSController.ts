import { Controller, Post, Req, Res, UnauthorizedException, UseGuards, Body } from '@nestjs/common';
import { Request, Response } from 'express';

import { Context, type RequestContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ProxyService } from '@ci/common/services/ProxyService';
import config from '@ci/configuration';

import type { TTSConvertRequest } from '../types';

@Controller('tts')
export class TTSController {
  constructor(private readonly proxyService: ProxyService) {}

  @UseGuards(JwtAuthGuard)
  @Post('convert')
  async convert(
    @Context() context: RequestContext,
    @Body() body: TTSConvertRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (context.userId == null) {
      throw new UnauthorizedException();
    }

    // Ensure voice parameter is included in the request body
    const requestBody = {
      text: body.text,
      voice: body.voice || 'ryan',
    };

    // Update the request body with the voice parameter
    req.body = requestBody;

    return await this.proxyService.proxyRequest(req, res, `${config.services.tts.host}/tts/convert`);
  }

  @UseGuards(JwtAuthGuard)
  @Post('switch')
  async switch(
    @Context() context: RequestContext,
    @Body() body: TTSConvertRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (context.userId == null) {
      throw new UnauthorizedException();
    }

    // Ensure voice parameter is included in the request body
    const requestBody = {
      text: '', // Not needed for switch
      voice: body.voice || 'ryan',
    };

    // Update the request body with the voice parameter
    req.body = requestBody;

    return await this.proxyService.proxyRequest(req, res, `${config.services.tts.host}/tts/switch`);
  }

  @UseGuards(JwtAuthGuard)
  @Post('preload')
  async preload(
    @Context() context: RequestContext,
    @Body() body: TTSConvertRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (context.userId == null) {
      throw new UnauthorizedException();
    }

    // Ensure voice parameter is included in the request body
    const requestBody = {
      text: '', // Not needed for preload
      voice: body.voice || 'ryan',
    };

    // Update the request body with the voice parameter
    req.body = requestBody;

    return await this.proxyService.proxyRequest(req, res, `${config.services.tts.host}/tts/preload`);
  }
}
