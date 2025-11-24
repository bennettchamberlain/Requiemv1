import { Injectable } from '@nestjs/common';

import type { RequestContext } from '@ci/common/types';
import { MessageService, type Message } from '@ci/domains/conversations';

import { Loader } from './Loader';

@Injectable()
export class ThreadMessagesLoader extends Loader<Message[]> {
  constructor(private readonly messageService: MessageService) {
    super();
  }

  protected async batchLoad(
    context: RequestContext,
    threadIds: readonly string[],
  ): Promise<readonly Message[][]> {
    const messagesMap = await this.messageService.findByThreads(context, [...threadIds]);

    return threadIds.map((threadId) => messagesMap.get(threadId) ?? []);
  }
}
