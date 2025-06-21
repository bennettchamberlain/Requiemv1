import { Controller, Delete, Get, HttpCode, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Context } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';

import { MessageService } from '../services/MessageService';
import { ThreadService } from '../services/ThreadService';

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
  async findOne(@Context() context: RequestContext, @Param('id') id: string) {
    const thread = await this.threadService.findOne(context, id);
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
