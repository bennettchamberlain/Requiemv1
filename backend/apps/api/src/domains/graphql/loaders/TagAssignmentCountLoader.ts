import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { TagService } from '@ci/domains/search-next';

import { Loader } from './Loader';

/** Batches TagType.entityCount reads into one grouped entity_tag query. */
@Injectable()
export class TagAssignmentCountLoader extends Loader<number> {
  constructor(
    private readonly tagService: TagService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(TagAssignmentCountLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    tagIds: readonly string[],
  ): Promise<readonly number[]> {
    this.logger.log(`Loading assignment counts for a batch of ${tagIds.length} tags`);

    const counts = await this.tagService.getAssignmentCounts(context, [...tagIds]);

    return tagIds.map((id) => counts.get(id) ?? 0);
  }
}
