import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { type Answer, AnswerService } from '@ci/domains/intelligence';

import { Loader } from './Loader';

@Injectable()
export class AnswerLoader extends Loader<Answer | null, string> {
  constructor(
    private readonly answerService: AnswerService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(AnswerLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    answerIds: readonly string[],
  ): Promise<readonly (Answer | null)[]> {
    return this.answerService.findByIds(context, [...answerIds]);
  }
}
