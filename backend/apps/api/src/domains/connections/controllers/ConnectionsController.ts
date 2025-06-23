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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import { ValidationPipe } from '@ci/common/pipes';
import type { RequestContext } from '@ci/common/types';

import { ConnectionService } from '../services/ConnectionService';
import type { CreateConnectionDto, UpdateConnectionDto } from '../types';

const createConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  providerId: z.string().uuid('Invalid provider ID'),
});

const updateConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
  active: z.boolean().optional(),
});

@Controller('connections')
export class ConnectionsController {
  constructor(private readonly connectionService: ConnectionService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  async findAll(@Context() context: RequestContext) {
    return this.connectionService.findAll(context);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.findOne(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post()
  async create(
    @Context() context: RequestContext,
    @Body(new ValidationPipe(createConnectionSchema)) input: CreateConnectionDto,
  ) {
    return this.connectionService.create(context, input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch(':id')
  async update(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Body(new ValidationPipe(updateConnectionSchema)) input: UpdateConnectionDto,
  ) {
    return this.connectionService.update(context, id, input);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/activate')
  @HttpCode(200)
  async activate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.activate(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/deactivate')
  @HttpCode(200)
  async deactivate(@Context() context: RequestContext, @Param('id') id: string) {
    return this.connectionService.deactivate(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  @HttpCode(204)
  async delete(@Context() context: RequestContext, @Param('id') id: string) {
    await this.connectionService.delete(context, id);
  }
}
