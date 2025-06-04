import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Context } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';

import { QuestionService } from '../services/QuestionService';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionService: QuestionService) {}

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
