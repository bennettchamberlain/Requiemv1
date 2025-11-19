import { Injectable } from '@nestjs/common';

import type { RequestContext } from '@ci/common/types';
import { MessageService, type Message } from '@ci/domains/conversations';

import { ContextDataLoader } from './ContextDataLoader';

@Injectable()
export class ThreadMessagesLoader extends ContextDataLoader<Message[]> {
  constructor(private readonly messageService: MessageService) {
    super();
  }

  protected async batchLoad(
    context: RequestContext,
    threadIds: readonly string[],
  ): Promise<readonly Message[][]> {
    const results = await Promise.all(
      threadIds.map((threadId) => this.messageService.findByThread(context, threadId)),
    );

    return results;
  }
}
