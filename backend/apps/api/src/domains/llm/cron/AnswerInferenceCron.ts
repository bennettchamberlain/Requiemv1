import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { Cron } from '@ci/common/decorators';
import { LoggerService } from '@ci/common/services';
import config from '@ci/configuration';
import { EventService, Events } from '@ci/domains/events';
import { QuestionService } from '@ci/domains/intelligence';

@Injectable()
export class AnswerInferenceCron {
  private logger = new LoggerService(AnswerInferenceCron.name);

  constructor(
    private readonly eventService: EventService,
    private readonly questionService: QuestionService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async cronInferAnswers() {
    if (!config.features['scheduled.answer.inferencing']) {
      return;
    }

    this.logger.log('Processing question answer inference cron');

    const unansweredQuestions = await this.questionService.findUnansweredByUserId();

    for (const [userId, questionIds] of unansweredQuestions) {
      for (const questionId of questionIds) {
        this.eventService.send(Events.INFER_QUESTION_ANSWER, {
          ownerId: userId,
          questionId: questionId,
        });
      }
    }
  }
}
