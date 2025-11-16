import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { GqlJwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { PersonService } from '@ci/domains/memory';

import { GlobalUID } from '../types/GlobalUID';
import { PersonType } from '../types/PersonType';

@UseGuards(GqlJwtAuthGuard)
@Resolver(() => PersonType)
export class PersonResolver {
  constructor(private readonly personService: PersonService) {}

  @Query(() => [PersonType])
  async people(@Context() context: RequestContext): Promise<PersonType[]> {
    const entities = await this.personService.findAll(context);

    return entities.map((entity) => PersonType.fromEntity(entity));
  }

  @Query(() => PersonType, { nullable: true })
  async person(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<PersonType | null> {
    const id = GlobalUID.fromGUID('person', gid);

    const entity = await this.personService.findOne(context, id);

    return entity ? PersonType.fromEntity(entity) : null;
  }
}
