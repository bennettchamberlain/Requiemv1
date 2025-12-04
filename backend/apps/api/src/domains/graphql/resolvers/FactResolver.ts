import { UseGuards } from '@nestjs/common';
import { Query, Resolver, Args, ID } from '@nestjs/graphql';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';
import { toServiceContext } from '@ci/common/utils';
import { FactService } from '@ci/domains/memory';

import { FactConnection } from '../types/FactConnection';
import { FactEdge } from '../types/FactEdge';
import { FactType } from '../types/FactType';
import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver(() => FactType)
export class FactResolver {
  constructor(private readonly factService: FactService) {}

  @Query(() => FactConnection)
  async facts(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<FactConnection> {
    const serviceContext = toServiceContext(context);

    const facts = await this.factService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(facts, {
      ...pagination,
      getId: (fact) => GlobalUID.encode('fact', fact.id),
    });

    const edges: FactEdge[] = slice.map((fact) => {
      const node = FactType.toType(fact);

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

  @Query(() => FactType, { nullable: true })
  async fact(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) gid: string,
  ): Promise<FactType | null> {
    const serviceContext = toServiceContext(context);

    const id = GlobalUID.parse('fact', gid);

    const entity = await this.factService.findById(serviceContext, id);

    return entity ? FactType.toType(entity) : null;
  }
}
