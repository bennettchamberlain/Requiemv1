import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Context } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';

import { AnswerService } from '../services/AnswerService';

@Controller('answers')
export class AnswersController {
  constructor(private readonly questionService: AnswerService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(@Context() context: RequestContext) {
    return this.questionService.findAll(context);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.questionService.findOne(context, id);
  }
}
