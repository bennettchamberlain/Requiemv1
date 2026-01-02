import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ConceptService } from '@ci/domains/memory';

import { ConceptConnection } from '../types/ConceptConnection';
import { ConceptEdge } from '../types/ConceptEdge';
import { ConceptType } from '../types/ConceptType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => ConceptType)
export class ConceptResolver {
  constructor(private readonly conceptService: ConceptService) {}

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
}
