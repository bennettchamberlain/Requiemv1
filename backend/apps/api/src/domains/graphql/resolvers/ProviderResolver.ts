import { UseGuards } from '@nestjs/common';
import { Args, ID, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtAuthGuard } from '@ci/common/guards';
import { ProviderService } from '@ci/domains/connections';

import { GlobalUID } from '../types/GlobalUID';
import { PaginationArgs } from '../types/PaginationArgs';
import { ProviderConnection } from '../types/ProviderConnection';
import { ProviderEdge } from '../types/ProviderEdge';
import { ProviderType } from '../types/ProviderType';
import { Paginator } from '../utils/Paginator';

@UseGuards(JwtAuthGuard)
@Resolver()
export class ProviderResolver {
  constructor(private readonly providerService: ProviderService) {}

  @Query(() => ProviderConnection)
  async providers(
    @Context() context: RequestContext,
    @Args() pagination: PaginationArgs,
  ): Promise<ProviderConnection> {
    const serviceContext = toServiceContext(context);

    const entities = await this.providerService.findAll(serviceContext);

    const { slice, pageInfo, totalCount } = Paginator.paginate(entities, {
      ...pagination,
      getId: (entity) => GlobalUID.encode('provider', entity.id),
    });

    const edges: ProviderEdge[] = slice.map((entity) => {
      const node = ProviderType.toType(entity);

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

  @Query(() => ProviderType, { nullable: true })
  async provider(
    @Context() context: RequestContext,
    @Args('id', { type: () => ID }) id: string,
  ): Promise<ProviderType | null> {
    const serviceContext = toServiceContext(context);
    const { id: decodedId } = GlobalUID.decode(id);

    const entity = await this.providerService.findById(serviceContext, decodedId);

    return entity ? ProviderType.toType(entity) : null;
  }
}
