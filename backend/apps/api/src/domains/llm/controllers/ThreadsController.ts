import { Controller, Delete, Get, HttpCode, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { z } from 'zod';

import { Context } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';

import { MessageService } from '../services/MessageService';
import { ThreadService } from '../services/ThreadService';
import { ValidationPipe } from '@ci/common/pipes';

export const includeMessagesSchema = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v !== 'false');

@Controller('threads')
export class ThreadsController {
  constructor(
    private readonly messageService: MessageService,
    private readonly threadService: ThreadService,
  ) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  async findAll(@Context() context: RequestContext) {
    const threads = await this.threadService.findAll(context);

    return threads;
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  async findOne(
    @Context() context: RequestContext,
    @Param('id') id: string,
    @Query('includeMessages', new ValidationPipe(includeMessagesSchema)) includeMessages: boolean,
  ) {
    const thread = await this.threadService.findOne(context, id);

    if (!includeMessages) {
      return thread;
    }

    const messages = await this.messageService.findByThread(context, thread.id);

    return {
      ...thread,
      messages,
    };
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete(':id')
  @HttpCode(204)
  async delete(@Context() context: RequestContext, @Param('id') id: string) {
    await this.threadService.softDelete(context, id);
  }
}
