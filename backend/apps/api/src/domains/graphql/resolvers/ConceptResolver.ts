import { UseGuards } from '@nestjs/common';
import { Args, ID, Parent, Query, Resolver, ResolveField } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ConceptService } from '@ci/domains/memory';

import { TagLoader } from '../loaders/TagLoader';
import { ConceptConnection } from '../types/ConceptConnection';
import { ConceptEdge } from '../types/ConceptEdge';
import { ConceptType } from '../types/ConceptType';
import { EntityTagType } from '../types/EntityTagType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => ConceptType)
export class ConceptResolver {
  constructor(
    private readonly conceptService: ConceptService,
    private readonly tagLoader: TagLoader,
  ) {}

  @Query(() => ConceptConnection)
  async concepts(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<ConceptConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.conceptService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('concept', entity.id),
    });

    const edges: ConceptEdge[] = slice.map((entity) => {
      const node = ConceptType.toType(entity);

      return {
        node,
        cursor: node.id,
      };
    });

    return {
      edges,
      pageInfo,
      totalCount,
    };
  }

  @Query(() => ConceptType, { nullable: true })
  async concept(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<ConceptType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('concept', gid);

    const entity = await this.conceptService.findById(serviceContext, id);

    return entity ? ConceptType.toType(entity) : null;
  }

  @ResolveField(() => [EntityTagType])
  async tags(@Context() context: RequestContext, @Parent() parent: ConceptType): Promise<EntityTagType[]> {
    const serviceContext = toServiceContext(context);

    const tags = await this.tagLoader.load(serviceContext, {
      type: 'concept',
      id: parent.__source.id,
    });

    return tags.map((tag) => EntityTagType.toType(tag));
  }
}
