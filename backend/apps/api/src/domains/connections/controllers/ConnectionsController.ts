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
import config from '@ci/configuration';
import { EventService, Events, EventPayloads, OnEvent } from '@ci/domains/events';

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

  private logger = new LoggerService(ConnectionsController.name);

  constructor(
    private readonly connectionService: ConnectionService,
    private readonly eventService: EventService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get(':id/connect')
  async connect(@Context() context: RequestContext, @Param('id') id: string) {
    this.logger.debug('Connect endpoint called', {
      connectionId: id,
      userId: context.userId,
    });

    try {
      const result = await this.connectionService.connect(context, id);
      this.logger.debug('Connect endpoint returning', {
        connectionId: id,
        hasUrl: !!result.url,
        urlLength: result.url?.length,
      });

      return result;
    } catch (error) {
      this.logger.error('Connect endpoint error', {
        connectionId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('callback/complete')
  async completeCallback(
    @Context() context: RequestContext,
    @Body() body: { connectionId: string; success: boolean; error?: string; code?: string },
  ) {
    this.logger.debug('Completing OAuth callback', { 
      connectionId: body.connectionId, 
      success: body.success,
      hasCode: !!body.code,
      userId: context.userId
    });

    try {
      if (body.success && body.code) {
        // Handle OAuth code exchange for authenticated flow
        const callbackContext: RequestContext = {
          ...context,
          query: { code: body.code, state: body.connectionId },
        };

        const result = await this.connectionService.callback(callbackContext);

        if (result.success) {
          return {
            success: true,
            connection: result.connection,
            message: 'OAuth authentication completed successfully',
          };
        } else {
          throw new Error('Failed to complete OAuth token exchange');
        }
      } else if (body.success) {
        // For cases where OAuth was already completed
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
      this.logger.error('Error completing OAuth callback', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        connectionId: body.connectionId,
        userId: context.userId
      });

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
