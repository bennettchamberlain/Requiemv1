import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { type Place, PlaceService } from '@ci/domains/memory';

import { Loader } from './Loader';

@Injectable()
export class PlaceLoader extends Loader<Place | null> {
  constructor(
    private readonly personService: PlaceService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(PlaceLoader.name);
  }

  protected async batchLoad(
    context: UserServiceContext,
    personIds: readonly string[],
  ): Promise<readonly (Place | null)[]> {
    this.logger.log(`Loading a batch of ${personIds.length} people`);

    return this.personService.findByIds(context, [...personIds]);
  }
}
