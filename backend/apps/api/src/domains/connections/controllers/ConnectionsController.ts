import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
  Res,
  Query,
} from '@nestjs/common';

import { Cron, CronExpression } from '@nestjs/schedule';
import { Response } from 'express';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import { EventService, Events, EventPayloads, OnEvent } from '@ci/domains/events';
import config from '@ci/configuration';

import { ConnectionService } from '../services/ConnectionService';
import type { CreateConnectionDto, UpdateConnectionDto } from '../types';

const createConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  providerId: z.string().uuid('Invalid provider ID'),
  clientid: z.string().optional(),
  clientkey: z.string().optional(),
  clientsecret: z.string().optional(),
  schedule: z.string().optional(),
});

const updateConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  providerId: z.string().uuid('Invalid provider ID').optional(),
  active: z.boolean().optional(),
  clientid: z.string().optional(),
  clientkey: z.string().optional(),
  clientsecret: z.string().optional(),
  schedule: z.string().optional(),
});

@Controller('connections')
export class ConnectionsController {
  private readonly frontendUrl = config.frontend.url;

  private logger = new LoggerService(ConnectionsController.name);

  constructor(
    private readonly connectionService: ConnectionService,
    private readonly eventService: EventService,
  ) {}

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('scope') scope: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ) {
    console.log('OAuth callback received:', { code, state, scope, error, errorDescription });

    // Handle OAuth errors
    if (error) {
      console.log('OAuth error received:', error, errorDescription);
      const redirectUrl = `${this.frontendUrl}/oauth-callback.html?error=${encodeURIComponent(error)}&error_description=${encodeURIComponent(errorDescription || '')}&state=${encodeURIComponent(state || '')}`;
      return res.redirect(redirectUrl);
    }

    // If no code or state, this might be a test request
    if (!code || !state) {
      console.log('No code or state provided, returning test response');

      return res.json({
        message: 'OAuth callback endpoint is working',
        received: { code, state, scope },
        frontendUrl: this.frontendUrl,
      });
    }

    try {
      // Create a minimal context for the callback
      const context: RequestContext = {
        query: { code, state, scope },
      };

      const result = await this.connectionService.callback(context);

      console.log('OAuth callback result:', result);

      // Redirect to the frontend OAuth callback page with the code and state
      // The frontend will then make an API call to complete the OAuth flow
      const redirectUrl = `${this.frontendUrl}/oauth-callback.html?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      console.log('Redirecting to frontend:', redirectUrl);

      return res.redirect(redirectUrl);
    } catch (error) {
      // Log the error and redirect with error
      console.error('OAuth callback error:', error);

      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      const redirectUrl = `${this.frontendUrl}/oauth-callback.html?error=server_error&error_description=${encodeURIComponent(errorMessage)}&state=${encodeURIComponent(state || '')}`;
      
      return res.redirect(redirectUrl);
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/connect')
  async connect(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.connect(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('callback/complete')
  async completeCallback(
    @Context() context: RequestContext,
    @Body() body: { connectionId: string; success: boolean; error?: string },
  ) {
    console.log('Completing OAuth callback:', body);

    try {
      if (body.success) {
        // Get the updated connection data
        const connection = await this.connectionService.findOne(context, body.connectionId);

        return {
          success: true,
          connection,
          message: 'OAuth authentication completed successfully',
        };
      } else {
        return {
          success: false,
          error: body.error || 'OAuth authentication failed',
          message: 'Failed to complete OAuth authentication',
        };
      }
    } catch (error) {
      console.error('Error completing OAuth callback:', error);

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        message: 'Failed to complete OAuth authentication',
      };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Context() context: RequestContext) {
    return this.connectionService.findAll(context);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.findOne(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createConnectionSchema)) input: CreateConnectionDto,
  ) {
    return this.connectionService.create(context, input);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Body(new ValidationPipe(updateConnectionSchema)) input: UpdateConnectionDto,
  ) {
    return this.connectionService.update(context, id, input);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.activate(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.deactivate(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/sync')
  async sync(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.sync(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  async delete(@Context() context: RequestContext, @Param('id') id: string) {
    await this.connectionService.delete(context, id);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cronProcessConnections() {
    this.logger.log('Processing connection sync cron');

    const activeConnections = await this.connectionService.findAllActive();

    for (const connection of activeConnections) {
      this.eventService.send(Events.SYNC_CONNECTION, {
        connectionId: connection.id,
        userId: connection.userId,
      });
    }
  }

  @OnEvent(Events.SYNC_CONNECTION)
  async syncConnection(payload: EventPayloads[Events.SYNC_CONNECTION]) {
    const context: RequestContext = {
      userId: payload.userId,
    };

    this.logger.log('Syncing connection', {
      connectionId: payload.connectionId,
      userId: payload.userId,
    });

    try {
      const result = await this.connectionService.sync(context, payload.connectionId);

      this.logger.log('Connection sync completed', {
        connectionId: payload.connectionId,
        success: result.success,
        message: result.message,
      });
    } catch (error) {
      this.logger.error('Connection sync failed', {
        connectionId: payload.connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
