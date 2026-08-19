import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { type EntityIdentifierEntity, EntityIdentifierService } from '@ci/domains/graph';

import { Loader } from './Loader';

/** Batches PersonType.identifiers reads into one ci.entity_identifiers query. */
@Injectable()
export class PersonIdentifiersLoader extends Loader<EntityIdentifierEntity[]> {
  constructor(
    private readonly entityIdentifierService: EntityIdentifierService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(PersonIdentifiersLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    entityIds: readonly string[],
  ): Promise<readonly EntityIdentifierEntity[][]> {
    this.logger.log(`Loading identifiers for a batch of ${entityIds.length} people`);

    const byEntity = await this.entityIdentifierService.listForEntities(context.userId, [...entityIds]);

    return entityIds.map((id) => byEntity.get(id) ?? []);
  }
}
