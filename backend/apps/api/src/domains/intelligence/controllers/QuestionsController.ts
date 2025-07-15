import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Context } from '@ci/common/decorators';
import { EventService, Events, EventPayloads, OnEvent } from '@ci/domains/events';
import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';

import { QuestionService } from '../services/QuestionService';

@Controller('questions')
export class QuestionsController {
  private logger = new LoggerService(QuestionsController.name);

  constructor(
    private readonly eventService: EventService,
    private readonly questionService: QuestionService,
  ) {}

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

  @Cron(CronExpression.EVERY_MINUTE)
  handleCron() {
    this.logger.log('Question cron has been invoked');

    this.eventService.send(Events.INFER_QUESTION_ANSWER, {
      ownerId: 'mock',
      questionId: 'mock',
    });
  }

  @OnEvent(Events.INFER_QUESTION_ANSWER)
  async inferQuestionAnswer(payload: EventPayloads[Events.INFER_QUESTION_ANSWER]) {
    const context: RequestContext = {
      userId: payload.ownerId,
    };

    this.logger.log('Inferring answer to question', {
      userId: context.userId,
      questionId: payload.questionId,
    });
  }
}
