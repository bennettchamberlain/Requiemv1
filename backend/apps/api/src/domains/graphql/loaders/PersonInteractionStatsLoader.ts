import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { PersonActivityService, type PersonInteractionStats } from '@ci/domains/memory';

import { Loader } from './Loader';

const EMPTY: PersonInteractionStats = { eventCount: 0, communicationCount: 0, lastInteractionAt: null };

/** Batches PersonType.interactionStats reads into two grouped queries. */
@Injectable()
export class PersonInteractionStatsLoader extends Loader<PersonInteractionStats> {
  constructor(
    private readonly personActivityService: PersonActivityService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(PersonInteractionStatsLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    personIds: readonly string[],
  ): Promise<readonly PersonInteractionStats[]> {
    this.logger.log(`Loading interaction stats for a batch of ${personIds.length} people`);

    const stats = await this.personActivityService.getInteractionStats(context, [...personIds]);

    return personIds.map((id) => stats.get(id) ?? EMPTY);
  }
}
