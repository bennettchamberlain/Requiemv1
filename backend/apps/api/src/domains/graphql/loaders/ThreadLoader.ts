import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { type Thread, ThreadService } from '@ci/domains/conversations';

import { Loader } from './Loader';

@Injectable()
export class ThreadLoader extends Loader<Thread | null, string> {
  constructor(
    private readonly threadService: ThreadService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(ThreadLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    ids: readonly string[],
  ): Promise<readonly (Thread | null)[]> {
    const threads = await this.threadService.findByIds(context, [...ids]);

    const threadMap = new Map<string, Thread>();

    for (const thread of threads) {
      threadMap.set(thread.id, thread);
    }

    return ids.map((id) => threadMap.get(id) ?? null);
  }
}
