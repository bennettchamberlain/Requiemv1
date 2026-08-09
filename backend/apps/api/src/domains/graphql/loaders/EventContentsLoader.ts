import { Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { ContentService, type Content } from '@ci/domains/memory';

import { Loader } from './Loader';

/**
 * Batch-loads `ci.content` rows linked to each event id for GraphQL
 * `Event.contents`. One query per request via {@link ContentService.findByEventIds}.
 */
@Injectable()
export class EventContentsLoader extends Loader<Content[]> {
  constructor(
    private readonly contentService: ContentService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(EventContentsLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    eventIds: readonly string[],
  ): Promise<readonly Content[][]> {
    return this.contentService.findByEventIds(context, [...eventIds]);
  }
}
