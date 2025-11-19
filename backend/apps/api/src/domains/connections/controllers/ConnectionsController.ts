import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { ValidationPipe } from '@ci/common/pipes';
import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import { EventService, Events } from '@ci/domains/events';

import { ConnectionService } from '../services/ConnectionService';
import type { CompleteConnectionDto, CreateConnectionDto, UpdateConnectionDto } from '../types';

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
  active: z.boolean().optional(),
  clientid: z.string().optional(),
  clientkey: z.string().optional(),
  clientsecret: z.string().optional(),
  schedule: z
    .enum(
      ['1 min', '5 min', '10 min', '30 min', '1 hour', '2 hours', '6 hours', '12 hours', 'daily', 'weekly'],
      {
        errorMap: () => ({
          message:
            'Schedule must be one of: 1 min, 5 min, 10 min, 30 min, 1 hour, 2 hours, 6 hours, 12 hours, daily, weekly',
        }),
      },
    )
    .optional(),
});

const completeConnectionSchema = z.object({
  state: z.string(),
  code: z.string(),
});

@Controller('connections')
export class ConnectionsController {
  private logger = new LoggerService(ConnectionsController.name);

  constructor(
    private readonly connectionService: ConnectionService,
    private readonly eventService: EventService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createConnectionSchema)) input: CreateConnectionDto,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { accessToken, refreshToken, ...returnedConnection } = await this.connectionService.create(
      context,
      input,
    );

    return returnedConnection;
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@Context() context: RequestContext) {
    const connections = await this.connectionService.findAll(context);

    return connections.map((connection) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { accessToken, refreshToken, ...returnedConnection } = connection;

      return returnedConnection;
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Context() context: RequestContext, @Param('id') id: string) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { accessToken, refreshToken, ...returnedConnection } = await this.connectionService.findOne(
      context,
      id,
    );

    return returnedConnection;
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Body(new ValidationPipe(updateConnectionSchema)) input: UpdateConnectionDto,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { accessToken, refreshToken, ...returnedConnection } = await this.connectionService.update(
      context,
      id,
      input,
    );

    return returnedConnection;
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(204)
  async delete(@Context() context: RequestContext, @Param('id') id: string) {
    await this.connectionService.delete(context, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/connect')
  async connect(@Context() context: RequestContext, @Param('id') id: string) {
    try {
      return this.connectionService.connect(context, id);
    } catch (error) {
      this.logger.error('Connect endpoint error', {
        connectionId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('complete')
  @HttpCode(200)
  async completeCallback(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(completeConnectionSchema)) body: CompleteConnectionDto,
  ) {
    const { state, code } = body;

    try {
      const result = await this.connectionService.callback(context, state, code);

      return {
        success: true,
        connection: result,
      };
    } catch (error) {
      this.logger.error('Error completing OAuth callback', {
        error: error instanceof Error ? error.message : 'Unknown error',
        connectionId: state,
        userId: context.userId,
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/sync')
  @HttpCode(200)
  async sync(@Context() context: RequestContext, @Param('id') id: string) {
    this.logger.log('Manual sync requested', {
      connectionId: id,
      userId: context.userId,
    });

    try {
      await this.eventService.send(Events.SYNC_CONNECTION, {
        connectionId: id,
        userId: context.userId!,
      });

      return {
        success: true,
        message: 'Sync queued successfully',
      };
    } catch (error) {
      this.logger.error('Manual sync failed', {
        connectionId: id,
        userId: context.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
