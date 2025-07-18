import {
  Controller,
  Get,
  Query,
  Res,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

import type { RequestContext } from '@ci/common/types';
import { ConnectionService } from '../services/ConnectionService';

@Controller('oauth')
export class OAuthCallbackController {
  private readonly logger = new Logger(OAuthCallbackController.name);

  constructor(private readonly connectionService: ConnectionService) {
    this.logger.log('********** OAuthCallbackController initialized **********');
    this.logger.log('Routes: GET /oauth/callback');
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('scope') scope: string,
    @Res() res: Response
  ) {
    this.logger.log('********** OAuth callback endpoint hit **********');
    this.logger.log('Query params:', { 
      code: code?.substring(0, 20) + '...', 
      state, 
      scope 
    });

    try {
      const context: RequestContext = {
        query: { code, state, scope }
      };
      
      const result = await this.connectionService.callback(context);
      
      if (result.redirect) {
        this.logger.log('Redirecting to:', result.redirect);
        return res.redirect(302, result.redirect);
      }
      
      return res.json(result);
    } catch (error) {
      this.logger.error('OAuth callback error:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://dev.companionintelligence.com';
      return res.redirect(302, `${frontendUrl}/connections?oauth=error&message=${encodeURIComponent('Authentication failed')}`);
    }
  }
}
