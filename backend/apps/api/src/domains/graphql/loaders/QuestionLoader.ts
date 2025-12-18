import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { type Question, QuestionService } from '@ci/domains/intelligence';

import { Loader } from './Loader';

@Injectable()
export class QuestionLoader extends Loader<Question | null, string> {
  constructor(
    private readonly questionService: QuestionService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(QuestionLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    ids: readonly string[],
  ): Promise<readonly (Question | null)[]> {
    const questions = await this.questionService.findByIds(context, [...ids]);

    const questionMap = new Map<string, Question>();

    for (const question of questions) {
      questionMap.set(question.id, question);
    }

    return ids.map((id) => questionMap.get(id) ?? null);
  }
}
